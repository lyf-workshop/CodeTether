import {
  canonicalFailure,
  type AgentEvent,
  type CanonicalFailure,
} from '@codetether/agent-core'
import {
  ConversationIdSchema,
  MachineIdSchema,
  ProjectIdSchema,
  type ConversationId,
  type MachineId,
  type ProjectId,
} from '@codetether/protocol'

import {
  ProviderConversationUnavailableError,
  type AgentHostRuntime,
  type ProviderApprovalRequest,
  type ProviderApprovalResolution,
  type ProviderConversationResult,
  type ProviderRuntimeContext,
  type ProviderTurnResult,
} from './agent-runtime.js'
import {
  decodeRemoteProviderSessionBinding,
  encodeRemoteProviderSessionBinding,
} from './remote-provider-session-binding.js'

export type RemoteCodexRuntimeTurnEvent =
  | {
      readonly type: 'message.delta'
      readonly text: string
      readonly sequence: number
    }
  | { readonly type: 'message.completed'; readonly sequence: number }
  | { readonly type: 'turn.completed'; readonly sequence: number }
  | {
      readonly type: 'turn.failed'
      readonly code: string
      readonly message: string
      readonly failure?: CanonicalFailure
      readonly sequence: number
    }

export interface RemoteCodexRuntimeTurn {
  readonly events?: () => AsyncIterable<RemoteCodexRuntimeTurnEvent>
  readonly [Symbol.asyncIterator]?: () => AsyncIterator<RemoteCodexRuntimeTurnEvent>
}

export interface RemoteCodexRuntimeSession {
  readonly machineId: MachineId
  readonly conversationId: ConversationId
  /** Native Provider identity. It never leaves this Host-private adapter. */
  readonly providerThreadId: string
  /** Dedicated transport liveness; no network probe or Provider work. */
  readonly closed: boolean
  startTurn(input: {
    readonly actionId: string
    readonly turnId: string
    readonly prompt: string
  }): Promise<RemoteCodexRuntimeTurn>
  close(): Promise<void> | void
}

export interface RemoteCodexSessionOpener {
  open(input: {
    readonly machineId: MachineId
    readonly conversationId: ConversationId
    readonly projectId: ProjectId
    readonly rootPath: string
    readonly providerThreadId?: string
  }): Promise<RemoteCodexRuntimeSession>
}

export interface RemoteCodexHostRuntimeOptions {
  readonly machineId: MachineId
  readonly opener: RemoteCodexSessionOpener
  readonly now?: () => Date
}

/**
 * Per-Machine adapter for the exact authenticated remote Codex operation.
 * It cannot choose an executable, argv, environment, shell, or arbitrary cwd.
 */
export class RemoteCodexHostRuntime implements AgentHostRuntime {
  readonly provider = 'codex' as const
  readonly #machineId: MachineId
  readonly #opener: RemoteCodexSessionOpener
  readonly #now: () => Date
  readonly #sessions = new Map<string, RemoteCodexRuntimeSession>()
  readonly #eventListeners = new Set<(event: AgentEvent) => void>()
  readonly #failureListeners = new Set<(failure: Error) => void>()
  readonly #turnPumps = new Set<Promise<void>>()
  readonly #openingConversations = new Set<ConversationId>()
  readonly #sessionCleanups = new Map<string, Promise<void>>()
  readonly #conversationCleanups = new Map<ConversationId, Promise<void>>()
  #closed = false
  #closePromise?: Promise<void>

  constructor(options: RemoteCodexHostRuntimeOptions) {
    this.#machineId = MachineIdSchema.parse(options.machineId)
    this.#opener = options.opener
    this.#now = options.now ?? (() => new Date())
  }

  get available(): boolean {
    return !this.#closed
  }

  subscribeEvents(listener: (event: AgentEvent) => void): () => void {
    this.#eventListeners.add(listener)
    return () => this.#eventListeners.delete(listener)
  }

  subscribeFailures(listener: (failure: Error) => void): () => void {
    this.#failureListeners.add(listener)
    return () => this.#failureListeners.delete(listener)
  }

  subscribeApprovals(
    onRequest: (request: ProviderApprovalRequest) => void,
    onResolved: (resolution: ProviderApprovalResolution) => void,
  ): () => void {
    // The Phase 6C.2 remote profile has no Approval primitive.
    void onRequest
    void onResolved
    return () => undefined
  }

  async startConversation(
    options: {
      readonly cwd: string
    } & ProviderRuntimeContext,
  ): Promise<ProviderConversationResult> {
    this.#assertOpen()
    const identity = requiredContext(options, this.#machineId)
    return await this.#openAndRetainSession(
      identity.conversationId,
      async () =>
        await this.#opener.open({
          machineId: this.#machineId,
          conversationId: identity.conversationId,
          projectId: identity.projectId,
          rootPath: options.cwd,
        }),
    )
  }

  async resumeConversation(
    options: {
      readonly providerThreadId: string
      readonly cwd: string
      readonly providerSessionMaterialized: boolean
    } & ProviderRuntimeContext,
  ): Promise<ProviderConversationResult> {
    this.#assertOpen()
    const identity = requiredContext(options, this.#machineId)
    const decoded = decodeRemoteProviderThreadId(
      options.providerThreadId,
      this.#machineId,
    )
    const existing = this.#sessions.get(options.providerThreadId)
    if (existing !== undefined) {
      if (existing.closed) {
        this.#removeStaleSession(options.providerThreadId, existing)
      } else {
        if (existing.conversationId !== identity.conversationId) {
          throw new Error(
            'Remote Codex Session belongs to another Conversation',
          )
        }
        return { providerThreadId: options.providerThreadId }
      }
    }
    const retained = await this.#openAndRetainSession(
      identity.conversationId,
      async () =>
        await this.#opener.open({
          machineId: this.#machineId,
          conversationId: identity.conversationId,
          projectId: identity.projectId,
          rootPath: options.cwd,
          providerThreadId: decoded,
        }),
    )
    if (retained.providerThreadId !== options.providerThreadId) {
      await this.disposeConversation({
        providerThreadId: retained.providerThreadId,
      })
      throw new Error('Remote Codex resumed a different native Session')
    }
    return retained
  }

  async startTurn(
    options: {
      readonly providerThreadId: string
      readonly cwd: string
      readonly input: string
    } & ProviderRuntimeContext,
  ): Promise<ProviderTurnResult> {
    this.#assertOpen()
    const identity = requiredTurnContext(options, this.#machineId)
    const session = this.#sessions.get(options.providerThreadId)
    if (
      session === undefined ||
      session.conversationId !== identity.conversationId
    ) {
      throw new Error('Remote Codex Session is not active in this Host')
    }
    const providerTurnId = remoteProviderTurnId(
      this.#machineId,
      identity.turnId,
    )
    const turn = await session.startTurn({
      actionId: identity.actionId,
      turnId: identity.turnId,
      prompt: options.input,
    })
    const pump = this.#pumpTurn(turn, options.providerThreadId, providerTurnId)
    this.#turnPumps.add(pump)
    void pump.finally(() => this.#turnPumps.delete(pump)).catch(() => undefined)
    return { providerTurnId }
  }

  async interruptTurn(): Promise<void> {
    throw new Error('Remote Codex interruption is unsupported')
  }

  async disposeConversation(options: {
    readonly providerThreadId: string
  }): Promise<void> {
    const session = this.#sessions.get(options.providerThreadId)
    if (session !== undefined) {
      this.#sessions.delete(options.providerThreadId)
      this.#trackSessionCleanup(options.providerThreadId, session)
    }
    await this.#awaitSessionCleanup(options.providerThreadId)
  }

  hasConversationSession(providerThreadId: string): boolean {
    const session = this.#sessions.get(providerThreadId)
    if (session === undefined) return false
    if (!session.closed) return true
    this.#removeStaleSession(providerThreadId, session)
    return false
  }

  async close(): Promise<void> {
    if (this.#closePromise === undefined) {
      this.#closed = true
      this.#closePromise = this.#closeOwnedSessions()
    }
    await this.#closePromise
  }

  async #closeOwnedSessions(): Promise<void> {
    const sessions = [...this.#sessions.values()]
    this.#sessions.clear()
    const sessionCloses = sessions.map((session) => {
      const providerThreadId = encodeRemoteProviderThreadId(
        this.#machineId,
        session.providerThreadId,
      )
      return this.#trackSessionCleanup(providerThreadId, session)
    })
    const results = await Promise.allSettled([
      ...new Set([
        ...this.#sessionCleanups.values(),
        ...this.#conversationCleanups.values(),
        ...sessionCloses,
      ]),
      ...this.#turnPumps,
    ])
    this.#eventListeners.clear()
    this.#failureListeners.clear()
    this.#sessionCleanups.clear()
    this.#conversationCleanups.clear()
    const rejected = results.find((result) => result.status === 'rejected')
    if (rejected?.status === 'rejected') throw rejected.reason
  }

  async #pumpTurn(
    turn: RemoteCodexRuntimeTurn,
    providerThreadId: string,
    providerTurnId: string,
  ): Promise<void> {
    let message = ''
    let messageCompleted = false
    let terminal = false
    try {
      const events = turn.events?.() ?? turn
      if (events[Symbol.asyncIterator] === undefined) {
        throw new Error('Remote Codex Turn has no event stream')
      }
      for await (const event of events as AsyncIterable<RemoteCodexRuntimeTurnEvent>) {
        if (terminal) continue
        const timestamp = this.#now().toISOString()
        switch (event.type) {
          case 'message.delta':
            if (messageCompleted) {
              throw new Error('Remote Codex emitted text after completion')
            }
            message += event.text
            this.#emit({
              type: 'message.delta',
              provider: 'codex',
              timestamp,
              threadId: providerThreadId,
              turnId: providerTurnId,
              itemId: `${providerTurnId}:message`,
              delta: event.text,
            })
            break
          case 'message.completed':
            if (messageCompleted) {
              throw new Error('Remote Codex completed its message twice')
            }
            messageCompleted = true
            this.#emit({
              type: 'message.completed',
              provider: 'codex',
              timestamp,
              threadId: providerThreadId,
              turnId: providerTurnId,
              itemId: `${providerTurnId}:message`,
              message,
            })
            break
          case 'turn.completed':
            if (!messageCompleted) {
              throw new Error(
                'Remote Codex completed before its message was finalized',
              )
            }
            terminal = true
            this.#emit({
              type: 'turn.completed',
              provider: 'codex',
              timestamp,
              threadId: providerThreadId,
              turnId: providerTurnId,
              ...(message.length === 0 ? {} : { finalMessage: message }),
            })
            break
          case 'turn.failed':
            terminal = true
            this.#emit({
              type: 'turn.failed',
              provider: 'codex',
              timestamp,
              threadId: providerThreadId,
              turnId: providerTurnId,
              error: {
                code: safeRemoteFailureCode(event.code),
                message: 'Remote Codex Turn failed',
                ...(event.failure === undefined
                  ? {}
                  : { failure: event.failure }),
              },
            })
            this.#invalidateSession(providerThreadId)
            break
        }
      }
      if (!terminal) {
        this.#emitTurnLost(providerThreadId, providerTurnId)
        this.#invalidateSession(providerThreadId)
      }
    } catch {
      if (!terminal) {
        this.#emitTurnLost(providerThreadId, providerTurnId)
        this.#invalidateSession(providerThreadId)
      }
    }
  }

  async #openAndRetainSession(
    conversationId: ConversationId,
    open: () => Promise<RemoteCodexRuntimeSession>,
  ): Promise<ProviderConversationResult> {
    await this.#awaitConversationCleanup(conversationId)
    this.#assertOpen()
    if (
      this.#openingConversations.has(conversationId) ||
      [...this.#sessions.values()].some(
        (session) => session.conversationId === conversationId,
      )
    ) {
      throw new ProviderConversationUnavailableError(
        this.provider,
        conversationId,
      )
    }
    this.#openingConversations.add(conversationId)
    try {
      const session = await open()
      return await this.#retainSession(session, conversationId)
    } finally {
      this.#openingConversations.delete(conversationId)
    }
  }

  async #retainSession(
    session: RemoteCodexRuntimeSession,
    conversationId: ConversationId,
  ): Promise<ProviderConversationResult> {
    if (
      session.machineId !== this.#machineId ||
      session.conversationId !== conversationId ||
      session.providerThreadId.trim().length === 0
    ) {
      await session.close()
      throw new Error('Remote Codex returned mismatched Session identity')
    }
    const providerThreadId = encodeRemoteProviderThreadId(
      this.#machineId,
      session.providerThreadId,
    )
    const pendingCleanup =
      this.#sessionCleanups.get(providerThreadId) ??
      this.#conversationCleanups.get(conversationId)
    if (pendingCleanup !== undefined) {
      const results = await Promise.allSettled([
        pendingCleanup,
        Promise.resolve().then(async () => await session.close()),
      ])
      const rejected = results.find((result) => result.status === 'rejected')
      if (rejected?.status === 'rejected') throw rejected.reason
      throw new ProviderConversationUnavailableError(
        this.provider,
        providerThreadId,
      )
    }
    if (this.#closed) {
      await session.close()
      throw new Error('Remote Codex runtime is closed')
    }
    const existing = this.#sessions.get(providerThreadId)
    if (existing !== undefined && existing !== session) {
      await session.close()
      throw new Error('Remote Codex Session identity is already active')
    }
    this.#sessions.set(providerThreadId, session)
    return { providerThreadId }
  }

  #emit(event: AgentEvent): void {
    for (const listener of [...this.#eventListeners]) listener(event)
  }

  #emitTurnLost(providerThreadId: string, providerTurnId: string): void {
    const timestamp = this.#now().toISOString()
    this.#emit({
      type: 'turn.failed',
      provider: 'codex',
      timestamp,
      threadId: providerThreadId,
      turnId: providerTurnId,
      error: {
        code: 'provider_unavailable',
        message: 'Remote Codex execution was lost',
        failure: canonicalFailure('execution_lost', timestamp),
      },
    })
  }

  #invalidateSession(providerThreadId: string): void {
    const session = this.#sessions.get(providerThreadId)
    if (session === undefined) return
    this.#sessions.delete(providerThreadId)
    this.#trackSessionCleanup(providerThreadId, session)
  }

  #removeStaleSession(
    providerThreadId: string,
    session: RemoteCodexRuntimeSession,
  ): void {
    if (this.#sessions.get(providerThreadId) !== session) return
    this.#sessions.delete(providerThreadId)
    this.#trackSessionCleanup(providerThreadId, session)
  }

  #trackSessionCleanup(
    providerThreadId: string,
    session: RemoteCodexRuntimeSession,
  ): Promise<void> {
    const existing =
      this.#sessionCleanups.get(providerThreadId) ??
      this.#conversationCleanups.get(session.conversationId)
    if (existing !== undefined) return existing
    let cleanup: Promise<void>
    try {
      cleanup = Promise.resolve(session.close())
    } catch (error) {
      cleanup = Promise.reject(error)
    }
    this.#sessionCleanups.set(providerThreadId, cleanup)
    this.#conversationCleanups.set(session.conversationId, cleanup)
    void cleanup.then(
      () => {
        if (this.#sessionCleanups.get(providerThreadId) === cleanup) {
          this.#sessionCleanups.delete(providerThreadId)
        }
        if (
          this.#conversationCleanups.get(session.conversationId) === cleanup
        ) {
          this.#conversationCleanups.delete(session.conversationId)
        }
      },
      () => undefined,
    )
    return cleanup
  }

  async #awaitSessionCleanup(providerThreadId: string): Promise<void> {
    const cleanup = this.#sessionCleanups.get(providerThreadId)
    if (cleanup === undefined) return
    try {
      await cleanup
    } catch {
      throw new ProviderConversationUnavailableError(
        this.provider,
        providerThreadId,
      )
    }
  }

  async #awaitConversationCleanup(
    conversationId: ConversationId,
  ): Promise<void> {
    const cleanup = this.#conversationCleanups.get(conversationId)
    if (cleanup === undefined) return
    try {
      await cleanup
    } catch {
      throw new ProviderConversationUnavailableError(
        this.provider,
        conversationId,
      )
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('Remote Codex runtime is closed')
  }
}

function requiredContext(
  context: ProviderRuntimeContext,
  machineId: MachineId,
): { readonly conversationId: ConversationId; readonly projectId: ProjectId } {
  if (context.machineId !== machineId) {
    throw new Error('Remote Codex Machine identity is missing or mismatched')
  }
  return {
    conversationId: ConversationIdSchema.parse(context.conversationId),
    projectId: ProjectIdSchema.parse(context.projectId),
  }
}

function requiredTurnContext(
  context: ProviderRuntimeContext,
  machineId: MachineId,
): {
  readonly conversationId: ConversationId
  readonly projectId: ProjectId
  readonly actionId: string
  readonly turnId: string
} {
  const identity = requiredContext(context, machineId)
  if (context.actionId === undefined || context.turnId === undefined) {
    throw new Error('Remote Codex Turn correlation identity is missing')
  }
  return {
    ...identity,
    actionId: String(context.actionId),
    turnId: String(context.turnId),
  }
}

function encodeRemoteProviderThreadId(
  machineId: MachineId,
  providerThreadId: string,
): string {
  return encodeRemoteProviderSessionBinding(
    'codex',
    machineId,
    providerThreadId,
  )
}

function decodeRemoteProviderThreadId(
  value: string,
  machineId: MachineId,
): string {
  try {
    return decodeRemoteProviderSessionBinding('codex', machineId, value)
  } catch {
    throw new Error('Remote Codex Session identity is malformed')
  }
}

function remoteProviderTurnId(machineId: MachineId, turnId: string): string {
  return `remote-codex-turn-v1:${Buffer.from(
    JSON.stringify({ machineId, turnId }),
    'utf8',
  ).toString('base64url')}`
}

function safeRemoteFailureCode(code: string): string {
  switch (code) {
    case 'provider_session_lost':
      return 'provider_session_lost'
    case 'provider_unavailable':
    case 'remote_execution_unavailable':
    case 'remote_execution_lost':
      return 'provider_unavailable'
    case 'provider_start_failed':
      return 'provider_start_failed'
    default:
      return 'provider_error'
  }
}

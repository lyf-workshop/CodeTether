import type { AgentEvent, ToolKind } from '@codetether/agent-core'
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

const REMOTE_SESSION_PREFIX = 'remote-claude-v1:'
const REMOTE_TURN_PREFIX = 'remote-claude-turn-v1:'

export const REMOTE_CLAUDE_EFFORT_LEVELS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

export type RemoteClaudeEffort = (typeof REMOTE_CLAUDE_EFFORT_LEVELS)[number]
export type RemoteClaudeToolKind = Extract<ToolKind, 'read' | 'search'>
export type RemoteClaudeToolName = 'Read' | 'Search'

export type RemoteClaudeRuntimeTurnEvent =
  | {
      readonly type: 'message.delta'
      readonly text: string
      readonly sequence: number
    }
  | { readonly type: 'message.completed'; readonly sequence: number }
  | {
      readonly type: 'tool.started'
      readonly itemId: string
      readonly kind: RemoteClaudeToolKind
      readonly name: RemoteClaudeToolName
      readonly command?: string
      readonly summary?: string
      readonly sequence: number
    }
  | {
      readonly type: 'tool.output'
      readonly itemId: string
      readonly output: string
      readonly sequence: number
    }
  | {
      readonly type: 'tool.completed'
      readonly itemId: string
      readonly kind: RemoteClaudeToolKind
      readonly name: RemoteClaudeToolName
      readonly command?: string
      readonly success?: boolean
      readonly summary?: string
      readonly sequence: number
    }
  | { readonly type: 'turn.completed'; readonly sequence: number }
  | {
      readonly type: 'turn.failed'
      readonly code: string
      readonly message: string
      readonly sequence: number
    }

export interface RemoteClaudeRuntimeTurn {
  readonly events?: () => AsyncIterable<RemoteClaudeRuntimeTurnEvent>
  readonly [Symbol.asyncIterator]?: () => AsyncIterator<RemoteClaudeRuntimeTurnEvent>
}

export interface RemoteClaudeRuntimeSession {
  readonly machineId: MachineId
  readonly conversationId: ConversationId
  /** Native Claude identity. It never leaves this Host-private adapter. */
  readonly providerSessionId: string
  readonly effort?: RemoteClaudeEffort
  /** Dedicated transport liveness; no network probe or Provider work. */
  readonly closed: boolean
  startTurn(input: {
    readonly actionId: string
    readonly turnId: string
    readonly prompt: string
  }): Promise<RemoteClaudeRuntimeTurn>
  close(): Promise<void> | void
}

export interface RemoteClaudeSessionOpener {
  open(input: {
    readonly machineId: MachineId
    readonly conversationId: ConversationId
    readonly projectId: ProjectId
    readonly rootPath: string
    readonly providerSessionId?: string
    readonly providerSessionMaterialized?: boolean
    readonly effort?: RemoteClaudeEffort
  }): Promise<RemoteClaudeRuntimeSession>
}

export interface RemoteClaudeHostRuntimeOptions {
  readonly machineId: MachineId
  readonly opener: RemoteClaudeSessionOpener
  readonly now?: () => Date
}

/**
 * Per-Machine adapter for the authenticated restricted Claude Code operation.
 * It cannot choose an executable, argv, environment, shell, or arbitrary cwd.
 */
export class RemoteClaudeHostRuntime implements AgentHostRuntime {
  readonly provider = 'claude-code' as const
  readonly #machineId: MachineId
  readonly #opener: RemoteClaudeSessionOpener
  readonly #now: () => Date
  readonly #sessions = new Map<string, RemoteClaudeRuntimeSession>()
  readonly #eventListeners = new Set<(event: AgentEvent) => void>()
  readonly #failureListeners = new Set<(failure: Error) => void>()
  readonly #turnPumps = new Set<Promise<void>>()
  readonly #sessionCleanups = new Map<string, Promise<void>>()
  #closed = false
  #closePromise?: Promise<void>

  constructor(options: RemoteClaudeHostRuntimeOptions) {
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
    // The restricted remote Claude profile has no Approval primitive.
    void onRequest
    void onResolved
    return () => undefined
  }

  async startConversation(
    options: {
      readonly cwd: string
      readonly model?: string
      readonly reasoning?: string
    } & ProviderRuntimeContext,
  ): Promise<ProviderConversationResult> {
    this.#assertOpen()
    assertModelUnsupported(options.model)
    const effort = parseRemoteClaudeEffort(options.reasoning)
    const identity = requiredContext(options, this.#machineId)
    const session = await this.#opener.open({
      machineId: this.#machineId,
      conversationId: identity.conversationId,
      projectId: identity.projectId,
      rootPath: options.cwd,
      ...(effort === undefined ? {} : { effort }),
    })
    return await this.#retainSession(session, identity.conversationId, effort)
  }

  async resumeConversation(
    options: {
      readonly providerThreadId: string
      readonly cwd: string
      readonly providerSessionMaterialized: boolean
      readonly model?: string
      readonly reasoning?: string
    } & ProviderRuntimeContext,
  ): Promise<ProviderConversationResult> {
    this.#assertOpen()
    assertModelUnsupported(options.model)
    const effort = parseRemoteClaudeEffort(options.reasoning)
    const identity = requiredContext(options, this.#machineId)
    const decoded = decodeRemoteProviderSessionId(
      options.providerThreadId,
      this.#machineId,
    )
    const existing = this.#sessions.get(options.providerThreadId)
    if (existing !== undefined) {
      if (existing.closed) {
        this.#removeStaleSession(options.providerThreadId, existing)
      } else {
        if (
          existing.conversationId !== identity.conversationId ||
          existing.effort !== effort
        ) {
          throw new ProviderConversationUnavailableError(
            this.provider,
            options.providerThreadId,
          )
        }
        return { providerThreadId: options.providerThreadId }
      }
    }
    await this.#awaitSessionCleanup(options.providerThreadId)
    this.#assertOpen()
    const session = await this.#opener.open({
      machineId: this.#machineId,
      conversationId: identity.conversationId,
      projectId: identity.projectId,
      rootPath: options.cwd,
      providerSessionId: decoded,
      providerSessionMaterialized: options.providerSessionMaterialized,
      ...(effort === undefined ? {} : { effort }),
    })
    const retained = await this.#retainSession(
      session,
      identity.conversationId,
      effort,
    )
    if (retained.providerThreadId !== options.providerThreadId) {
      await session.close()
      this.#sessions.delete(retained.providerThreadId)
      throw new ProviderConversationUnavailableError(
        this.provider,
        options.providerThreadId,
      )
    }
    return retained
  }

  async startTurn(
    options: {
      readonly providerThreadId: string
      readonly cwd: string
      readonly input: string
      readonly model?: string
      readonly reasoning?: string
    } & ProviderRuntimeContext,
  ): Promise<ProviderTurnResult> {
    this.#assertOpen()
    assertModelUnsupported(options.model)
    const effort = parseRemoteClaudeEffort(options.reasoning)
    const identity = requiredTurnContext(options, this.#machineId)
    const session = this.#sessions.get(options.providerThreadId)
    if (
      session === undefined ||
      session.conversationId !== identity.conversationId ||
      session.effort !== effort
    ) {
      throw new ProviderConversationUnavailableError(
        this.provider,
        options.providerThreadId,
      )
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

  async interruptTurn(): Promise<never> {
    throw new Error('Remote Claude Code interruption is unsupported')
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
      const providerThreadId = encodeRemoteProviderSessionId(
        this.#machineId,
        session.providerSessionId,
      )
      return this.#trackSessionCleanup(providerThreadId, session)
    })
    const results = await Promise.allSettled([
      ...new Set([...this.#sessionCleanups.values(), ...sessionCloses]),
      ...this.#turnPumps,
    ])
    this.#eventListeners.clear()
    this.#failureListeners.clear()
    this.#sessionCleanups.clear()
    const rejected = results.find((result) => result.status === 'rejected')
    if (rejected?.status === 'rejected') throw rejected.reason
  }

  async #pumpTurn(
    turn: RemoteClaudeRuntimeTurn,
    providerThreadId: string,
    providerTurnId: string,
  ): Promise<void> {
    let message = ''
    let messageCompleted = false
    let terminal = false
    const tools = new Map<
      string,
      {
        readonly kind: RemoteClaudeToolKind
        readonly name: RemoteClaudeToolName
        readonly command?: string
        completed: boolean
      }
    >()
    try {
      const events = turn.events?.() ?? turn
      if (events[Symbol.asyncIterator] === undefined) {
        throw new Error('Remote Claude Code Turn has no event stream')
      }
      for await (const event of events as AsyncIterable<RemoteClaudeRuntimeTurnEvent>) {
        if (terminal) continue
        const timestamp = this.#now().toISOString()
        switch (event.type) {
          case 'message.delta':
            if (messageCompleted) {
              throw new Error(
                'Remote Claude Code emitted text after completion',
              )
            }
            message += event.text
            this.#emit({
              type: 'message.delta',
              provider: this.provider,
              timestamp,
              threadId: providerThreadId,
              turnId: providerTurnId,
              itemId: `${providerTurnId}:message`,
              delta: event.text,
            })
            break
          case 'message.completed':
            if (messageCompleted) {
              throw new Error('Remote Claude Code completed its message twice')
            }
            messageCompleted = true
            this.#emit({
              type: 'message.completed',
              provider: this.provider,
              timestamp,
              threadId: providerThreadId,
              turnId: providerTurnId,
              itemId: `${providerTurnId}:message`,
              message,
            })
            break
          case 'tool.started': {
            assertSafeTool(event)
            if (tools.has(event.itemId)) {
              throw new Error('Remote Claude Code reused a Tool identity')
            }
            tools.set(event.itemId, {
              kind: event.kind,
              name: event.name,
              ...(event.command === undefined
                ? {}
                : { command: event.command }),
              completed: false,
            })
            this.#emit({
              type: 'tool.started',
              provider: this.provider,
              timestamp,
              threadId: providerThreadId,
              turnId: providerTurnId,
              itemId: event.itemId,
              kind: event.kind,
              name: event.name,
              ...(event.command === undefined
                ? {}
                : { command: event.command }),
              ...(event.summary === undefined
                ? {}
                : { summary: event.summary }),
            })
            break
          }
          case 'tool.output': {
            const tool = tools.get(event.itemId)
            if (tool === undefined || tool.completed) {
              throw new Error('Remote Claude Code Tool output was out of order')
            }
            this.#emit({
              type: 'tool.output',
              provider: this.provider,
              timestamp,
              threadId: providerThreadId,
              turnId: providerTurnId,
              itemId: event.itemId,
              output: event.output,
            })
            break
          }
          case 'tool.completed': {
            assertSafeTool(event)
            const tool = tools.get(event.itemId)
            if (
              tool === undefined ||
              tool.completed ||
              tool.kind !== event.kind ||
              tool.name !== event.name ||
              tool.command !== event.command
            ) {
              throw new Error(
                'Remote Claude Code Tool completion identity was invalid',
              )
            }
            tool.completed = true
            this.#emit({
              type: 'tool.completed',
              provider: this.provider,
              timestamp,
              threadId: providerThreadId,
              turnId: providerTurnId,
              itemId: event.itemId,
              kind: event.kind,
              name: event.name,
              ...(event.command === undefined
                ? {}
                : { command: event.command }),
              ...(event.success === undefined
                ? {}
                : { success: event.success }),
              ...(event.summary === undefined
                ? {}
                : { summary: event.summary }),
            })
            break
          }
          case 'turn.completed':
            if (
              !messageCompleted ||
              [...tools.values()].some((tool) => !tool.completed)
            ) {
              throw new Error(
                'Remote Claude Code completed with unfinished output',
              )
            }
            terminal = true
            this.#emit({
              type: 'turn.completed',
              provider: this.provider,
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
              provider: this.provider,
              timestamp,
              threadId: providerThreadId,
              turnId: providerTurnId,
              error: {
                code: safeRemoteFailureCode(event.code),
                message: 'Remote Claude Code Turn failed',
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

  async #retainSession(
    session: RemoteClaudeRuntimeSession,
    conversationId: ConversationId,
    effort: RemoteClaudeEffort | undefined,
  ): Promise<ProviderConversationResult> {
    if (
      session.machineId !== this.#machineId ||
      session.conversationId !== conversationId ||
      session.providerSessionId.trim().length === 0 ||
      session.effort !== effort
    ) {
      await session.close()
      throw new Error('Remote Claude Code returned mismatched Session identity')
    }
    const providerThreadId = encodeRemoteProviderSessionId(
      this.#machineId,
      session.providerSessionId,
    )
    const pendingCleanup = this.#sessionCleanups.get(providerThreadId)
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
      throw new Error('Remote Claude Code runtime is closed')
    }
    const existing = this.#sessions.get(providerThreadId)
    if (existing !== undefined && existing !== session) {
      await session.close()
      throw new Error('Remote Claude Code Session identity is already active')
    }
    this.#sessions.set(providerThreadId, session)
    return { providerThreadId }
  }

  #emit(event: AgentEvent): void {
    for (const listener of [...this.#eventListeners]) listener(event)
  }

  #emitTurnLost(providerThreadId: string, providerTurnId: string): void {
    this.#emit({
      type: 'turn.failed',
      provider: this.provider,
      timestamp: this.#now().toISOString(),
      threadId: providerThreadId,
      turnId: providerTurnId,
      error: {
        code: 'provider_unavailable',
        message: 'Remote Claude Code execution was lost',
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
    session: RemoteClaudeRuntimeSession,
  ): void {
    if (this.#sessions.get(providerThreadId) !== session) return
    this.#sessions.delete(providerThreadId)
    this.#trackSessionCleanup(providerThreadId, session)
  }

  #trackSessionCleanup(
    providerThreadId: string,
    session: RemoteClaudeRuntimeSession,
  ): Promise<void> {
    const existing = this.#sessionCleanups.get(providerThreadId)
    if (existing !== undefined) return existing
    const cleanup = Promise.resolve().then(async () => await session.close())
    this.#sessionCleanups.set(providerThreadId, cleanup)
    void cleanup.then(
      () => {
        if (this.#sessionCleanups.get(providerThreadId) === cleanup) {
          this.#sessionCleanups.delete(providerThreadId)
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

  #assertOpen(): void {
    if (this.#closed) throw new Error('Remote Claude Code runtime is closed')
  }
}

function requiredContext(
  context: ProviderRuntimeContext,
  machineId: MachineId,
): { readonly conversationId: ConversationId; readonly projectId: ProjectId } {
  if (context.machineId !== machineId) {
    throw new Error(
      'Remote Claude Code Machine identity is missing or mismatched',
    )
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
    throw new Error('Remote Claude Code Turn correlation identity is missing')
  }
  return {
    ...identity,
    actionId: String(context.actionId),
    turnId: String(context.turnId),
  }
}

function encodeRemoteProviderSessionId(
  machineId: MachineId,
  providerSessionId: string,
): string {
  return `${REMOTE_SESSION_PREFIX}${Buffer.from(
    JSON.stringify({ version: 1, machineId, providerSessionId }),
    'utf8',
  ).toString('base64url')}`
}

function decodeRemoteProviderSessionId(
  value: string,
  machineId: MachineId,
): string {
  if (!value.startsWith(REMOTE_SESSION_PREFIX)) {
    throw new ProviderConversationUnavailableError('claude-code', value)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(
      Buffer.from(
        value.slice(REMOTE_SESSION_PREFIX.length),
        'base64url',
      ).toString('utf8'),
    )
  } catch {
    throw new ProviderConversationUnavailableError('claude-code', value)
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('version' in parsed) ||
    parsed.version !== 1 ||
    !('machineId' in parsed) ||
    parsed.machineId !== machineId ||
    !('providerSessionId' in parsed) ||
    typeof parsed.providerSessionId !== 'string' ||
    parsed.providerSessionId.trim().length === 0 ||
    parsed.providerSessionId.length > 2048
  ) {
    throw new ProviderConversationUnavailableError('claude-code', value)
  }
  return parsed.providerSessionId
}

function remoteProviderTurnId(machineId: MachineId, turnId: string): string {
  return `${REMOTE_TURN_PREFIX}${Buffer.from(
    JSON.stringify({ machineId, turnId }),
    'utf8',
  ).toString('base64url')}`
}

function assertModelUnsupported(model: string | undefined): void {
  if (model !== undefined) {
    throw new TypeError('Remote Claude Code model selection is unavailable')
  }
}

function parseRemoteClaudeEffort(
  reasoning: string | undefined,
): RemoteClaudeEffort | undefined {
  if (reasoning === undefined) return undefined
  if (!(REMOTE_CLAUDE_EFFORT_LEVELS as readonly string[]).includes(reasoning)) {
    throw new TypeError('Remote Claude Code effort is unsupported')
  }
  return reasoning as RemoteClaudeEffort
}

function assertSafeTool(event: {
  readonly kind: RemoteClaudeToolKind
  readonly name: RemoteClaudeToolName
}): void {
  if (
    (event.kind === 'read' && event.name === 'Read') ||
    (event.kind === 'search' && event.name === 'Search')
  ) {
    return
  }
  throw new Error('Remote Claude Code emitted an unsupported Tool')
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

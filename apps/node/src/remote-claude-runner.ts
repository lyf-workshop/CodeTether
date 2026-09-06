import { createHash, randomUUID } from 'node:crypto'

import {
  ClaudeCodeError,
  ClaudeCodeOwnedProcessCleanupError,
  ClaudeCodeSessionRuntime,
  type ClaudeCodeEffort,
  type ClaudeCodeLauncher,
  type ClaudeCodeProcessSpecification,
  type ClaudeCodeTurnResult,
} from '@codetether/adapter-claude'
import {
  canonicalFailure,
  isCanonicalFailureReason,
  type AgentEvent,
  type CanonicalFailure,
  type CanonicalFailureReason,
} from '@codetether/agent-core'
import {
  MachineTransportError,
  RemoteClaudePromptSchema,
  RemoteClaudeProviderIdentitySchema,
  machineTransportLimits,
  type ClaudeSessionOpenMessage,
  type ClaudeTurnStartMessage,
  type RemoteClaudeTurnEventPayload,
  type RemoteClaudeTurnFailureCode,
} from '@codetether/machine-transport'

import { validateProjectLocationPath } from './project-location-validation.js'
import { spawnNodeProviderProcess } from './provider-process-guardian.js'
import { supportsRemoteClaudeExecutionPlatform } from './provider-discovery.js'
import { NodeClaudeInstallation } from './claude-installation.js'
import type { RemoteProviderSessionConnectionOwner } from './remote-provider-session-owner.js'

interface RemoteClaudeSessionRuntime {
  readonly sessionId: string
  readonly cwd: string
  subscribeEvents(listener: (event: AgentEvent) => void): () => void
  startTurn(options: {
    readonly turnId: string
    readonly prompt: string
    readonly effort?: ClaudeCodeEffort
  }): Promise<ClaudeCodeTurnResult>
  startTurnExecution?(options: {
    readonly turnId: string
    readonly prompt: string
    readonly effort?: ClaudeCodeEffort
  }): {
    readonly ownershipEstablished: Promise<void>
    readonly completion: Promise<ClaudeCodeTurnResult>
  }
  close(): Promise<void>
}

export interface RemoteClaudeRuntimeFactoryOptions {
  readonly cwd: string
  readonly providerSessionId?: string
  readonly resume: boolean
}

export type RemoteClaudeRuntimeFactory = (
  options: RemoteClaudeRuntimeFactoryOptions,
) => Promise<RemoteClaudeSessionRuntime>

export interface RemoteClaudeRunnerPoolOptions {
  /** Internal test seam; the Machine protocol cannot select a launcher. */
  readonly runtimeFactory?: RemoteClaudeRuntimeFactory
  /** Node-private lifecycle selection; never populated from Machine input. */
  readonly claudeInstallation?: NodeClaudeInstallation
  /** Internal test seam; remote callers cannot select the Node platform. */
  readonly platform?: NodeJS.Platform
  readonly maximumSessions?: number
}

class RemoteClaudeOwnedCleanupError extends MachineTransportError {
  constructor(cause: unknown) {
    super(
      'remote_execution_lost',
      'Remote Claude owned process cleanup could not be verified',
      { cause, failureReason: 'execution_ownership_uncertain' },
    )
    this.name = 'RemoteClaudeOwnedCleanupError'
  }
}

class RemoteClaudeOutputLimitError extends MachineTransportError {
  readonly failureReason: CanonicalFailureReason = 'output_limit_exceeded'

  constructor() {
    super('remote_execution_lost', 'Remote Claude output exceeded its bound')
    this.name = 'RemoteClaudeOutputLimitError'
  }
}

export class RemoteClaudeRunnerPool {
  readonly #runtimeFactory: RemoteClaudeRuntimeFactory
  readonly #maximumSessions: number
  readonly #runners = new Map<string, RemoteClaudeRunner>()
  readonly #opening = new Map<string, Promise<RemoteClaudeRunner>>()
  readonly #cleanupTasks = new Set<Promise<void>>()
  readonly #cleanupFailures = new Set<unknown>()
  readonly #executionSupported: boolean
  readonly #lifecycleAbort = new AbortController()
  #closed = false
  #closePromise: Promise<void> | undefined

  constructor(options: RemoteClaudeRunnerPoolOptions = {}) {
    this.#maximumSessions =
      options.maximumSessions ??
      machineTransportLimits.maximumRemoteClaudeSessions
    if (
      !Number.isSafeInteger(this.#maximumSessions) ||
      this.#maximumSessions <= 0 ||
      this.#maximumSessions > machineTransportLimits.maximumRemoteClaudeSessions
    ) {
      throw new TypeError('Remote Claude session limit is invalid')
    }
    this.#executionSupported =
      options.runtimeFactory !== undefined ||
      supportsRemoteClaudeExecutionPlatform(options.platform)
    if (options.runtimeFactory !== undefined) {
      this.#runtimeFactory = options.runtimeFactory
    } else {
      const claudeInstallation =
        options.claudeInstallation ?? new NodeClaudeInstallation()
      this.#runtimeFactory = makeDefaultRuntimeFactory(
        claudeInstallation,
        this.#lifecycleAbort.signal,
      )
    }
  }

  get activeCount(): number {
    return this.#runners.size
  }

  async open(
    request: ClaudeSessionOpenMessage,
    owner?: RemoteProviderSessionConnectionOwner,
  ): Promise<RemoteClaudeRunner> {
    if (
      this.#closed ||
      !this.#executionSupported ||
      this.#cleanupFailures.size > 0
    ) {
      throw executionUnavailable()
    }
    if (this.#opening.has(request.conversationId)) {
      throw new MachineTransportError(
        'conversation_busy',
        'Remote Claude Conversation already has an owned session',
      )
    }
    const existing = this.#runners.get(request.conversationId)
    if (
      existing === undefined &&
      this.#runners.size + this.#opening.size >= this.#maximumSessions
    ) {
      throw new MachineTransportError(
        'busy',
        'Remote Claude session limit was reached',
      )
    }

    const opening =
      existing === undefined
        ? this.#openRunner(request, owner)
        : this.#supersedeIdleRunner(existing, request, owner)
    this.#opening.set(request.conversationId, opening)
    try {
      return await opening
    } catch (error) {
      if (error instanceof RemoteClaudeOwnedCleanupError) {
        this.#cleanupFailures.add(error)
      }
      throw error
    } finally {
      if (this.#opening.get(request.conversationId) === opening) {
        this.#opening.delete(request.conversationId)
      }
    }
  }

  async release(runner: RemoteClaudeRunner): Promise<void> {
    const cleanup = runner.close()
    this.#trackCleanup(cleanup)
    await cleanup
    if (this.#runners.get(runner.conversationId) === runner) {
      // A closing native session still owns this Conversation. Do not admit a
      // reconnect until exact Provider-process cleanup has completed.
      this.#runners.delete(runner.conversationId)
    }
  }

  async close(): Promise<void> {
    this.#closePromise ??= this.#close()
    await this.#closePromise
  }

  async #openRunner(
    request: ClaudeSessionOpenMessage,
    owner?: RemoteProviderSessionConnectionOwner,
  ): Promise<RemoteClaudeRunner> {
    const validated = await validateProjectLocationPath(request.rootPath)
    if (validated.canonicalPath !== request.rootPath) {
      throw new MachineTransportError(
        'project_location_path_invalid',
        'Registered Project Location is no longer canonical',
      )
    }
    return await this.#openValidatedRunner(
      request,
      validated.canonicalPath,
      owner,
    )
  }

  async #openValidatedRunner(
    request: ClaudeSessionOpenMessage,
    canonicalRoot: string,
    owner?: RemoteProviderSessionConnectionOwner,
  ): Promise<RemoteClaudeRunner> {
    if (this.#closed) throw executionUnavailable()
    const runner = await RemoteClaudeRunner.open({
      request,
      canonicalRoot,
      runtimeFactory: this.#runtimeFactory,
      onFatal: (ownedRunner) => this.#releaseAfterFatal(ownedRunner),
      owner,
    })
    if (this.#closed) {
      await runner.close()
      throw executionUnavailable()
    }
    this.#runners.set(request.conversationId, runner)
    return runner
  }

  async #supersedeIdleRunner(
    existing: RemoteClaudeRunner,
    request: ClaudeSessionOpenMessage,
    owner?: RemoteProviderSessionConnectionOwner,
  ): Promise<RemoteClaudeRunner> {
    const validated = await validateProjectLocationPath(request.rootPath)
    if (validated.canonicalPath !== request.rootPath) {
      throw new MachineTransportError(
        'project_location_path_invalid',
        'Registered Project Location is no longer canonical',
      )
    }
    const current = this.#runners.get(request.conversationId)
    if (current === undefined) {
      return await this.#openValidatedRunner(
        request,
        validated.canonicalPath,
        owner,
      )
    }
    if (
      current !== existing ||
      !existing.canBeSupersededBy(request, validated.canonicalPath, owner)
    ) {
      throw new MachineTransportError(
        'conversation_busy',
        'Remote Claude Conversation already has an owned session',
      )
    }

    const cleanup = this.release(existing)
    existing.retireConnection()
    await cleanup
    return await this.#openValidatedRunner(
      request,
      validated.canonicalPath,
      owner,
    )
  }

  async #close(): Promise<void> {
    this.#closed = true
    this.#lifecycleAbort.abort()
    const cleanupFailures = new Set<unknown>(this.#cleanupFailures)
    while (
      this.#runners.size > 0 ||
      this.#opening.size > 0 ||
      this.#cleanupTasks.size > 0
    ) {
      const runners = [...this.#runners.values()]
      const openings = [...this.#opening.values()]
      const cleanups = [...this.#cleanupTasks]
      this.#runners.clear()
      const work = [
        ...runners.map((runner) => ({
          cleanup: true,
          task: runner.close(),
        })),
        ...openings.map((task) => ({ cleanup: false, task })),
        ...cleanups.map((task) => ({ cleanup: true, task })),
      ]
      const results = await Promise.allSettled(work.map(({ task }) => task))
      for (const [index, result] of results.entries()) {
        if (
          result.status === 'rejected' &&
          (work[index]?.cleanup === true ||
            result.reason instanceof RemoteClaudeOwnedCleanupError)
        ) {
          cleanupFailures.add(result.reason)
        }
      }
    }
    for (const failure of this.#cleanupFailures) {
      cleanupFailures.add(failure)
    }
    if (cleanupFailures.size > 0) {
      throw new AggregateError(
        [...cleanupFailures],
        'Remote Claude owned process cleanup did not complete',
      )
    }
  }

  #releaseAfterFatal(runner: RemoteClaudeRunner): void {
    queueMicrotask(() => {
      if (this.#runners.get(runner.conversationId) !== runner) return
      void this.release(runner).catch(() => undefined)
    })
  }

  #trackCleanup(task: Promise<void>): void {
    this.#cleanupTasks.add(task)
    void task
      .catch((error: unknown) => {
        this.#cleanupFailures.add(error)
      })
      .finally(() => this.#cleanupTasks.delete(task))
  }
}

function makeDefaultRuntimeFactory(
  claudeInstallation: NodeClaudeInstallation,
  signal: AbortSignal,
): RemoteClaudeRuntimeFactory {
  return async (options) =>
    await defaultRemoteClaudeRuntimeFactory(options, signal, claudeInstallation)
}

interface OpenRemoteClaudeRunnerOptions {
  readonly request: ClaudeSessionOpenMessage
  readonly canonicalRoot: string
  readonly runtimeFactory: RemoteClaudeRuntimeFactory
  readonly onFatal: (runner: RemoteClaudeRunner) => void
  readonly owner?: RemoteProviderSessionConnectionOwner
}

export class RemoteClaudeRunner {
  readonly conversationId: ClaudeSessionOpenMessage['conversationId']
  readonly projectId: ClaudeSessionOpenMessage['projectId']
  readonly canonicalRoot: string
  readonly providerSessionId: string
  readonly resumed: boolean
  readonly effort?: ClaudeCodeEffort
  readonly #runtime: RemoteClaudeSessionRuntime
  readonly #unsubscribe: () => void
  readonly #onFatal: (runner: RemoteClaudeRunner) => void
  readonly #owner?: RemoteProviderSessionConnectionOwner
  readonly #actions = new Map<string, RemoteClaudeRunnerTurn>()
  #activeTurn: RemoteClaudeRunnerTurn | undefined
  #closed = false
  #cleanupPromise: Promise<void> | undefined

  private constructor(options: {
    request: ClaudeSessionOpenMessage
    canonicalRoot: string
    runtime: RemoteClaudeSessionRuntime
    onFatal: (runner: RemoteClaudeRunner) => void
    owner?: RemoteProviderSessionConnectionOwner
  }) {
    this.conversationId = options.request.conversationId
    this.projectId = options.request.projectId
    this.canonicalRoot = options.canonicalRoot
    this.#runtime = options.runtime
    this.providerSessionId = RemoteClaudeProviderIdentitySchema.parse(
      options.runtime.sessionId,
    )
    this.resumed = options.request.providerSessionMaterialized === true
    this.effort = options.request.effort
    this.#onFatal = options.onFatal
    this.#owner = options.owner
    this.#unsubscribe = this.#runtime.subscribeEvents((event) =>
      this.handleProviderEvent(event),
    )
  }

  static async open(
    options: OpenRemoteClaudeRunnerOptions,
  ): Promise<RemoteClaudeRunner> {
    let runtime: RemoteClaudeSessionRuntime | undefined
    try {
      runtime = await options.runtimeFactory({
        cwd: options.canonicalRoot,
        ...(options.request.providerSessionId === undefined
          ? {}
          : { providerSessionId: options.request.providerSessionId }),
        resume: options.request.providerSessionMaterialized === true,
      })
      const providerSessionId = RemoteClaudeProviderIdentitySchema.parse(
        runtime.sessionId,
      )
      if (
        options.request.providerSessionId !== undefined &&
        providerSessionId !== options.request.providerSessionId
      ) {
        throw new MachineTransportError(
          'provider_session_lost',
          'Remote Claude opened a different native session',
        )
      }
      if (runtime.cwd !== options.canonicalRoot) {
        throw new MachineTransportError(
          'remote_policy_violation',
          'Remote Claude working directory identity changed',
        )
      }
      return new RemoteClaudeRunner({
        request: options.request,
        canonicalRoot: options.canonicalRoot,
        runtime,
        onFatal: options.onFatal,
        owner: options.owner,
      })
    } catch (error) {
      if (
        runtime === undefined &&
        error instanceof ClaudeCodeOwnedProcessCleanupError
      ) {
        throw new RemoteClaudeOwnedCleanupError(error)
      }
      if (runtime !== undefined) {
        try {
          await runtime.close()
        } catch (cleanupError) {
          throw new RemoteClaudeOwnedCleanupError(
            new AggregateError(
              [error, cleanupError],
              'Remote Claude startup and owned cleanup both failed',
            ),
          )
        }
      }
      throw mapProviderStartError(error)
    }
  }

  canBeSupersededBy(
    request: ClaudeSessionOpenMessage,
    canonicalRoot: string,
    owner?: RemoteProviderSessionConnectionOwner,
  ): boolean {
    const materialized = this.resumed || this.#actions.size > 0
    return (
      !this.#closed &&
      this.#activeTurn === undefined &&
      this.#owner !== undefined &&
      owner !== undefined &&
      owner.controllerId === this.#owner.controllerId &&
      owner.generation > this.#owner.generation &&
      request.conversationId === this.conversationId &&
      request.projectId === this.projectId &&
      canonicalRoot === this.canonicalRoot &&
      request.providerSessionId !== undefined &&
      request.providerSessionId === this.providerSessionId &&
      request.providerSessionMaterialized === materialized &&
      request.effort === this.effort
    )
  }

  retireConnection(): void {
    this.#owner?.retire()
  }

  async startTurn(
    request: ClaudeTurnStartMessage,
  ): Promise<RemoteClaudeRunnerTurn> {
    if (this.#closed) throw sessionLost()
    if (
      request.conversationId !== this.conversationId ||
      request.providerSessionId !== this.providerSessionId
    ) {
      throw new MachineTransportError(
        'identity_mismatch',
        'Remote Claude Turn did not match the owned session',
      )
    }
    RemoteClaudePromptSchema.parse(request.prompt)
    const validated = await validateProjectLocationPath(this.canonicalRoot)
    if (validated.canonicalPath !== this.canonicalRoot) {
      throw new MachineTransportError(
        'project_location_path_invalid',
        'Registered Project Location identity changed',
      )
    }
    if (this.#closed) throw sessionLost()
    const requestHash = turnRequestHash(request)
    const previous = this.#actions.get(request.actionId)
    if (previous !== undefined) {
      if (previous.requestHash !== requestHash || previous.terminal) {
        throw new MachineTransportError(
          'duplicate_action_conflict',
          'Remote Claude action identity conflicted',
        )
      }
      return previous
    }
    if (this.#activeTurn !== undefined) {
      throw new MachineTransportError(
        'conversation_busy',
        'Remote Claude Conversation already has an active Turn',
      )
    }

    const providerTurnId =
      RemoteClaudeProviderIdentitySchema.parse(randomUUID())
    const turn = new RemoteClaudeRunnerTurn(
      request,
      requestHash,
      providerTurnId,
      () => {
        if (this.#activeTurn === turn) this.#activeTurn = undefined
      },
    )
    this.#activeTurn = turn
    this.#rememberAction(request.actionId, turn)
    const turnOptions = {
      turnId: providerTurnId,
      prompt: request.prompt,
      ...(this.effort === undefined ? {} : { effort: this.effort }),
    }
    let execution:
      | ReturnType<
          NonNullable<RemoteClaudeSessionRuntime['startTurnExecution']>
        >
      | undefined
    let completion: Promise<ClaudeCodeTurnResult>
    try {
      execution = this.#runtime.startTurnExecution?.(turnOptions)
      completion = execution?.completion ?? this.#runtime.startTurn(turnOptions)
    } catch (error) {
      const code = mapProviderFailure(error)
      this.#terminate(
        code,
        error instanceof ClaudeCodeOwnedProcessCleanupError ? error : undefined,
        canonicalFailureFromError(error, defaultFailureReason(code)),
      )
      await this.#cleanupPromise
      throw mapProviderStartError(error)
    }
    void completion.then(
      () => {
        if (this.#closed || turn.terminal) return
        try {
          turn.complete()
        } catch {
          this.#terminate('remote_execution_lost')
        }
      },
      (error: unknown) => {
        if (this.#closed || turn.terminal) return
        const code = mapProviderFailure(error)
        this.#terminate(
          code,
          error instanceof ClaudeCodeOwnedProcessCleanupError
            ? error
            : undefined,
          canonicalFailureFromError(error, defaultFailureReason(code)),
        )
      },
    )
    if (execution !== undefined) {
      try {
        await execution.ownershipEstablished
      } catch (error) {
        const code = mapProviderFailure(error)
        this.#terminate(
          code,
          undefined,
          canonicalFailureFromError(error, defaultFailureReason(code)),
        )
        throw mapProviderStartError(error)
      }
    }
    return turn
  }

  handleProviderEvent(event: AgentEvent): void {
    if (this.#closed) return
    const turn = this.#activeTurn
    if (
      turn === undefined ||
      event.provider !== 'claude-code' ||
      event.threadId !== this.providerSessionId ||
      ('turnId' in event && event.turnId !== turn.providerTurnId)
    ) {
      this.#terminate('remote_policy_violation')
      return
    }
    if (event.type === 'conversation.started') {
      if (event.cwd !== this.canonicalRoot) {
        this.#terminate('remote_policy_violation')
      }
      return
    }
    if (event.type === 'turn.started') return
    if (event.type === 'message.delta') {
      try {
        turn.pushMessageDelta(event.itemId, event.delta)
      } catch (error) {
        this.#terminate(
          'remote_execution_lost',
          undefined,
          canonicalFailureFromError(error, 'execution_lost'),
        )
      }
      return
    }
    if (event.type === 'message.completed') {
      try {
        turn.observeMessageCompleted(event.itemId, event.message)
      } catch (error) {
        // The tested stream-json profile must deliver partial text deltas and
        // an exact full snapshot. Never synthesize deltas from a snapshot.
        this.#terminate(
          'remote_execution_lost',
          undefined,
          canonicalFailureFromError(error, 'execution_lost'),
        )
      }
      return
    }
    if (event.type === 'tool.started') {
      if (!isAllowedTool(event)) {
        this.#terminate('remote_policy_violation')
        return
      }
      try {
        turn.pushToolStarted(event)
      } catch (error) {
        this.#terminate(
          'remote_policy_violation',
          undefined,
          canonicalFailureFromError(error, 'provider_protocol_error'),
        )
      }
      return
    }
    if (event.type === 'tool.output') {
      try {
        turn.pushToolOutput(event.itemId, event.output)
      } catch (error) {
        this.#terminate(
          'remote_policy_violation',
          undefined,
          canonicalFailureFromError(error, 'provider_protocol_error'),
        )
      }
      return
    }
    if (event.type === 'tool.completed') {
      if (!isAllowedTool(event) || event.success === undefined) {
        this.#terminate('remote_policy_violation')
        return
      }
      try {
        turn.pushToolCompleted(event)
      } catch (error) {
        this.#terminate(
          'remote_policy_violation',
          undefined,
          canonicalFailureFromError(error, 'provider_protocol_error'),
        )
      }
      return
    }
    if (event.type === 'turn.completed') {
      try {
        turn.observeProviderCompleted()
      } catch (error) {
        this.#terminate(
          'remote_execution_lost',
          undefined,
          canonicalFailureFromError(error, 'execution_lost'),
        )
      }
      return
    }
    if (event.type === 'turn.failed') {
      // The adapter's completion rejection is the terminal authority after
      // exact process-group cleanup. Raw Provider details stay Node-private.
      return
    }
    this.#terminate('remote_policy_violation')
  }

  async close(): Promise<void> {
    if (this.#cleanupPromise !== undefined) {
      await this.#cleanupPromise
      return
    }
    this.#closed = true
    const active = this.#activeTurn
    this.#cleanupPromise = this.#closeOwnedRuntime(
      active,
      'remote_execution_lost',
    )
    await this.#cleanupPromise
  }

  #terminate(
    code: RemoteClaudeTurnFailureCode,
    priorCleanupError?: ClaudeCodeOwnedProcessCleanupError,
    failure?: CanonicalFailure,
  ): void {
    if (this.#closed) return
    this.#closed = true
    const active = this.#activeTurn
    this.#cleanupPromise ??= this.#closeOwnedRuntime(
      active,
      code,
      priorCleanupError,
      failure,
    ).finally(() => this.#onFatal(this))
    void this.#cleanupPromise.catch(() => undefined)
  }

  async #closeOwnedRuntime(
    active: RemoteClaudeRunnerTurn | undefined,
    terminalCode: RemoteClaudeTurnFailureCode,
    priorCleanupError?: ClaudeCodeOwnedProcessCleanupError,
    failure?: CanonicalFailure,
  ): Promise<void> {
    let cleanupError: unknown = priorCleanupError
    try {
      await this.#runtime.close()
    } catch (error) {
      cleanupError =
        cleanupError === undefined
          ? error
          : new AggregateError(
              [cleanupError, error],
              'Remote Claude owned cleanup failed more than once',
            )
    }
    let finalizationError: unknown
    try {
      this.#unsubscribe()
    } catch (error) {
      finalizationError = error
    }
    try {
      active?.fail(
        terminalCode,
        cleanupError === undefined
          ? failure
          : canonicalFailureFromError(
              cleanupError,
              'execution_ownership_uncertain',
            ),
      )
    } catch (error) {
      finalizationError ??= error
    }
    if (cleanupError !== undefined) {
      throw new RemoteClaudeOwnedCleanupError(
        finalizationError === undefined
          ? cleanupError
          : new AggregateError(
              [cleanupError, finalizationError],
              'Remote Claude cleanup and lifecycle finalization both failed',
            ),
      )
    }
    if (finalizationError !== undefined) throw finalizationError
  }

  #rememberAction(actionId: string, turn: RemoteClaudeRunnerTurn): void {
    this.#actions.set(actionId, turn)
    while (this.#actions.size > 64) {
      const oldest = this.#actions.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.#actions.delete(oldest)
    }
  }
}

interface AllowedToolStateBase {
  readonly itemId: string
  readonly command?: string
  readonly summary?: string
  completed: boolean
}

type AllowedToolState = AllowedToolStateBase &
  (
    | { readonly kind: 'read'; readonly name: 'Read' }
    | { readonly kind: 'search'; readonly name: 'Search' }
  )

interface MessageState {
  text: string
  completed: boolean
}

export class RemoteClaudeRunnerTurn {
  readonly actionId: ClaudeTurnStartMessage['actionId']
  readonly conversationId: ClaudeTurnStartMessage['conversationId']
  readonly turnId: ClaudeTurnStartMessage['turnId']
  readonly providerTurnId: string
  readonly requestHash: string
  readonly #queue = new BoundedTurnEventQueue()
  readonly #release: () => void
  readonly #tools = new Map<string, AllowedToolState>()
  readonly #messages = new Map<string, MessageState>()
  #providerCompleted = false
  #terminal = false

  constructor(
    request: ClaudeTurnStartMessage,
    requestHash: string,
    providerTurnId: string,
    release: () => void,
  ) {
    this.actionId = request.actionId
    this.conversationId = request.conversationId
    this.turnId = request.turnId
    this.providerTurnId = providerTurnId
    this.requestHash = requestHash
    this.#release = release
  }

  get terminal(): boolean {
    return this.#terminal
  }

  pushMessageDelta(itemId: string, text: string): void {
    if (text.length === 0) return
    if (
      !this.#messages.has(itemId) &&
      this.#messages.size + this.#tools.size >=
        machineTransportLimits.maximumRemoteClaudeTurnItems
    ) {
      throw remoteExecutionLost()
    }
    const state = this.#messages.get(itemId) ?? { text: '', completed: false }
    if (state.completed) throw remotePolicyViolation()
    for (const chunk of splitUtf8(
      text,
      machineTransportLimits.maximumRemoteClaudeDeltaBytes,
    )) {
      state.text += chunk
      this.#push({ type: 'message.delta', text: chunk })
    }
    this.#messages.set(itemId, state)
  }

  observeMessageCompleted(itemId: string, message: string): void {
    const state = this.#messages.get(itemId)
    if (state === undefined || state.completed || state.text !== message) {
      throw remoteExecutionLost()
    }
    state.completed = true
  }

  pushToolStarted(event: Extract<AgentEvent, { type: 'tool.started' }>): void {
    if (this.#tools.has(event.itemId) || !isAllowedTool(event)) {
      throw remotePolicyViolation()
    }
    if (
      this.#messages.size + this.#tools.size >=
      machineTransportLimits.maximumRemoteClaudeTurnItems
    ) {
      throw remotePolicyViolation()
    }
    const state = toolStateFromEvent(event)
    this.#tools.set(event.itemId, state)
    this.#push({ type: 'tool.started', ...publicToolIdentity(state) })
  }

  pushToolOutput(itemId: string, output: string): void {
    const state = this.#tools.get(itemId)
    if (state === undefined || state.completed || output.length === 0) {
      throw remotePolicyViolation()
    }
    for (const chunk of splitUtf8(
      output,
      machineTransportLimits.maximumRemoteClaudeToolOutputBytes,
    )) {
      this.#push({ type: 'tool.output', itemId, output: chunk })
    }
  }

  pushToolCompleted(
    event: Extract<AgentEvent, { type: 'tool.completed' }>,
  ): void {
    const state = this.#tools.get(event.itemId)
    const command =
      event.command === undefined
        ? undefined
        : boundUtf8(
            event.command,
            machineTransportLimits.maximumRemoteClaudeToolCommandBytes,
          )
    if (
      state === undefined ||
      state.completed ||
      !isAllowedTool(event) ||
      state.kind !== event.kind ||
      state.name !== event.name ||
      state.command !== command ||
      event.success === undefined
    ) {
      throw remotePolicyViolation()
    }
    state.completed = true
    this.#push({
      type: 'tool.completed',
      ...publicToolIdentity(state),
      success: event.success,
      ...(event.summary === undefined
        ? {}
        : {
            summary: boundUtf8(
              event.summary,
              machineTransportLimits.maximumRemoteClaudeToolSummaryBytes,
            ),
          }),
    })
  }

  observeProviderCompleted(): void {
    if (this.#providerCompleted) throw remoteExecutionLost()
    this.#providerCompleted = true
  }

  complete(): void {
    if (
      !this.#providerCompleted ||
      this.#messages.size === 0 ||
      [...this.#messages.values()].some((message) => !message.completed) ||
      [...this.#tools.values()].some((tool) => !tool.completed)
    ) {
      throw remoteExecutionLost()
    }
    this.#push({ type: 'message.completed' })
    this.#push({ type: 'turn.completed' })
  }

  fail(code: RemoteClaudeTurnFailureCode, failure?: CanonicalFailure): void {
    if (this.#terminal) return
    this.#terminal = true
    this.#queue.forceTerminal({
      type: 'turn.failed',
      code,
      message: safeFailureMessage(code),
      failure:
        failure ??
        canonicalFailure(defaultFailureReason(code), new Date().toISOString()),
    })
    this.#release()
  }

  events(): AsyncIterable<RemoteClaudeTurnEventPayload> {
    return this.#queue
  }

  #push(event: RemoteClaudeTurnEventPayload): void {
    if (this.#terminal) return
    this.#queue.push(event)
    if (event.type === 'turn.completed') {
      this.#terminal = true
      this.#release()
    }
  }
}

class BoundedTurnEventQueue implements AsyncIterable<RemoteClaudeTurnEventPayload> {
  readonly #queue: RemoteClaudeTurnEventPayload[] = []
  readonly #waiters: Array<{
    resolve: (result: IteratorResult<RemoteClaudeTurnEventPayload>) => void
  }> = []
  #queuedBytes = 0
  #totalOutputBytes = 0
  #totalEvents = 0
  #closed = false

  push(event: RemoteClaudeTurnEventPayload): void {
    if (this.#closed) return
    const bytes = eventBytes(event)
    this.#totalEvents += 1
    if (event.type === 'message.delta' || event.type === 'tool.output') {
      this.#totalOutputBytes += bytes
    }
    if (
      this.#totalEvents >
        machineTransportLimits.maximumRemoteClaudeTurnEvents ||
      this.#totalOutputBytes >
        machineTransportLimits.maximumRemoteClaudeOutputBytes ||
      !this.#enqueueBounded(event, bytes)
    ) {
      throw new RemoteClaudeOutputLimitError()
    }
    if (isTerminal(event)) this.#closed = true
  }

  #enqueueBounded(event: RemoteClaudeTurnEventPayload, bytes: number): boolean {
    const waiter = this.#waiters.shift()
    if (waiter !== undefined) {
      waiter.resolve({ value: event, done: false })
      return true
    }
    const tail = this.#queue.at(-1)
    const coalesced = coalesceClaudeEvent(tail, event)
    if (coalesced !== undefined) {
      const previousBytes = eventBytes(tail!)
      const nextBytes = eventBytes(coalesced)
      if (
        this.#queuedBytes - previousBytes + nextBytes >
        machineTransportLimits.maximumRemoteClaudeQueuedOutputBytes
      ) {
        return false
      }
      this.#queue[this.#queue.length - 1] = coalesced
      this.#queuedBytes = this.#queuedBytes - previousBytes + nextBytes
      return true
    }
    if (
      this.#queue.length >=
        machineTransportLimits.maximumRemoteClaudeQueuedEvents ||
      this.#queuedBytes + bytes >
        machineTransportLimits.maximumRemoteClaudeQueuedOutputBytes
    ) {
      return false
    }
    this.#queue.push(event)
    this.#queuedBytes += bytes
    return true
  }

  forceTerminal(event: RemoteClaudeTurnEventPayload): void {
    if (this.#closed) return
    this.#queue.splice(0)
    this.#queuedBytes = 0
    const waiter = this.#waiters.shift()
    if (waiter !== undefined) waiter.resolve({ value: event, done: false })
    else this.#queue.push(event)
    this.#closed = true
    for (const pending of this.#waiters.splice(0)) {
      pending.resolve({ value: undefined, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<RemoteClaudeTurnEventPayload> {
    return {
      next: async () => {
        const event = this.#queue.shift()
        if (event !== undefined) {
          this.#queuedBytes = Math.max(0, this.#queuedBytes - eventBytes(event))
          return { value: event, done: false }
        }
        if (this.#closed) return { value: undefined, done: true }
        return await new Promise((resolve) => this.#waiters.push({ resolve }))
      },
    }
  }
}

function coalesceClaudeEvent(
  previous: RemoteClaudeTurnEventPayload | undefined,
  next: RemoteClaudeTurnEventPayload,
): RemoteClaudeTurnEventPayload | undefined {
  if (previous?.type === 'message.delta' && next.type === 'message.delta') {
    const text = previous.text + next.text
    return Buffer.byteLength(text, 'utf8') <=
      machineTransportLimits.maximumRemoteClaudeDeltaBytes
      ? { type: 'message.delta', text }
      : undefined
  }
  if (
    previous?.type === 'tool.output' &&
    next.type === 'tool.output' &&
    previous.itemId === next.itemId
  ) {
    const output = previous.output + next.output
    return Buffer.byteLength(output, 'utf8') <=
      machineTransportLimits.maximumRemoteClaudeToolOutputBytes
      ? { type: 'tool.output', itemId: next.itemId, output }
      : undefined
  }
  return undefined
}

async function defaultRemoteClaudeRuntimeFactory(
  options: RemoteClaudeRuntimeFactoryOptions,
  signal: AbortSignal,
  claudeInstallation: NodeClaudeInstallation,
): Promise<RemoteClaudeSessionRuntime> {
  let preparation
  try {
    preparation = await claudeInstallation.prepare({
      signal,
      processOwnership: 'posix-process-group',
    })
  } catch (error) {
    if (error instanceof ClaudeCodeOwnedProcessCleanupError) throw error
    throw new MachineTransportError(
      'provider_unavailable',
      'Remote Claude is unavailable',
      {
        failureReason:
          error instanceof ClaudeCodeError
            ? error.failureReason
            : 'provider_error',
      },
    )
  }
  if (preparation.detection.status !== 'available') {
    throw new MachineTransportError(
      'provider_unavailable',
      'Remote Claude is unavailable',
      {
        failureReason: preparation.failureReason ?? 'provider_error',
      },
    )
  }
  const sessionOptions = {
    launcher: privateLauncher(preparation.detection.launcher),
    cwd: options.cwd,
    environment: preparation.runtimeEnvironment(),
    testedVersion: preparation.detection.version,
    processOwnership: 'posix-process-group' as const,
    processFactory: (specification: ClaudeCodeProcessSpecification) =>
      spawnNodeProviderProcess({
        provider: 'claude-code',
        ...specification,
      }),
    ...(options.providerSessionId === undefined
      ? {}
      : { sessionId: options.providerSessionId }),
  }
  return options.resume
    ? ClaudeCodeSessionRuntime.resumeSession({
        ...sessionOptions,
        sessionId: RemoteClaudeProviderIdentitySchema.parse(
          options.providerSessionId,
        ),
      })
    : ClaudeCodeSessionRuntime.createSession(sessionOptions)
}

function privateLauncher(launcher: ClaudeCodeLauncher): ClaudeCodeLauncher {
  return {
    kind: launcher.kind,
    executable: launcher.executable,
    prefixArguments: [...launcher.prefixArguments],
    sourcePath: launcher.sourcePath,
  }
}

function isAllowedTool(
  event:
    | Extract<AgentEvent, { type: 'tool.started' }>
    | Extract<AgentEvent, { type: 'tool.completed' }>,
): event is typeof event &
  (
    | { readonly kind: 'read'; readonly name: 'Read' }
    | { readonly kind: 'search'; readonly name: 'Search' }
  ) {
  return (
    (event.kind === 'read' && event.name === 'Read') ||
    (event.kind === 'search' && event.name === 'Search')
  )
}

function publicToolIdentity(state: AllowedToolState) {
  const common = {
    itemId: state.itemId,
    ...(state.command === undefined ? {} : { command: state.command }),
    ...(state.summary === undefined ? {} : { summary: state.summary }),
  }
  return state.kind === 'read'
    ? { ...common, kind: 'read' as const, name: 'Read' as const }
    : { ...common, kind: 'search' as const, name: 'Search' as const }
}

function toolStateFromEvent(
  event: Extract<AgentEvent, { type: 'tool.started' }> &
    (
      | { readonly kind: 'read'; readonly name: 'Read' }
      | { readonly kind: 'search'; readonly name: 'Search' }
    ),
): AllowedToolState {
  const common: AllowedToolStateBase = {
    itemId: event.itemId,
    ...(event.command === undefined
      ? {}
      : {
          command: boundUtf8(
            event.command,
            machineTransportLimits.maximumRemoteClaudeToolCommandBytes,
          ),
        }),
    ...(event.summary === undefined
      ? {}
      : {
          summary: boundUtf8(
            event.summary,
            machineTransportLimits.maximumRemoteClaudeToolSummaryBytes,
          ),
        }),
    completed: false,
  }
  return event.kind === 'read'
    ? { ...common, kind: 'read', name: 'Read' }
    : { ...common, kind: 'search', name: 'Search' }
}

function splitUtf8(value: string, maximumBytes: number): string[] {
  if (value.length === 0) return []
  if (Buffer.byteLength(value, 'utf8') <= maximumBytes) return [value]
  const chunks: string[] = []
  let chunk = ''
  let bytes = 0
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8')
    if (bytes + characterBytes > maximumBytes && chunk.length > 0) {
      chunks.push(chunk)
      chunk = ''
      bytes = 0
    }
    chunk += character
    bytes += characterBytes
  }
  if (chunk.length > 0) chunks.push(chunk)
  return chunks
}

function boundUtf8(value: string, maximumBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maximumBytes) return value
  const suffix = '...'
  const contentLimit = maximumBytes - Buffer.byteLength(suffix, 'utf8')
  let result = ''
  let bytes = 0
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8')
    if (bytes + characterBytes > contentLimit) break
    result += character
    bytes += characterBytes
  }
  return result + suffix
}

function eventBytes(event: RemoteClaudeTurnEventPayload): number {
  return Buffer.byteLength(JSON.stringify(event), 'utf8')
}

function isTerminal(event: RemoteClaudeTurnEventPayload): boolean {
  return event.type === 'turn.completed' || event.type === 'turn.failed'
}

function turnRequestHash(request: ClaudeTurnStartMessage): string {
  return createHash('sha256')
    .update(request.conversationId)
    .update('\0')
    .update(request.turnId)
    .update('\0')
    .update(request.providerSessionId)
    .update('\0')
    .update(request.prompt)
    .digest('base64url')
}

function mapProviderFailure(error: unknown): RemoteClaudeTurnFailureCode {
  if (error instanceof Error && 'code' in error) {
    switch (error.code) {
      case 'provider_session_lost':
        return 'provider_session_lost'
      case 'provider_start_failed':
        return 'provider_start_failed'
      case 'provider_not_installed':
      case 'provider_version_unsupported':
      case 'provider_unavailable':
        return 'provider_unavailable'
    }
  }
  return 'provider_failed'
}

function canonicalFailureFromError(
  error: unknown,
  fallback: CanonicalFailureReason,
): CanonicalFailure {
  return canonicalFailure(
    controlledFailureReason(error, fallback),
    new Date().toISOString(),
  )
}

function controlledFailureReason(
  error: unknown,
  fallback: CanonicalFailureReason,
): CanonicalFailureReason {
  return error instanceof Error &&
    'failureReason' in error &&
    isCanonicalFailureReason(error.failureReason)
    ? error.failureReason
    : fallback
}

function defaultFailureReason(
  code: RemoteClaudeTurnFailureCode,
): CanonicalFailureReason {
  switch (code) {
    case 'provider_start_failed':
      return 'provider_start_failed'
    case 'provider_session_lost':
      return 'provider_session_lost'
    case 'provider_unavailable':
      return 'provider_service_unavailable'
    case 'remote_execution_lost':
      return 'execution_lost'
    case 'remote_policy_violation':
      return 'provider_protocol_error'
    case 'provider_failed':
      return 'provider_error'
  }
}

function mapProviderStartError(error: unknown): MachineTransportError {
  if (error instanceof MachineTransportError) return error
  const code = mapProviderFailure(error)
  return new MachineTransportError(
    code === 'provider_session_lost'
      ? 'provider_session_lost'
      : code === 'provider_unavailable'
        ? 'provider_unavailable'
        : 'provider_start_failed',
    code === 'provider_session_lost'
      ? 'Remote Claude native session is unavailable'
      : code === 'provider_unavailable'
        ? 'Remote Claude is unavailable'
        : 'Remote Claude could not start',
    {
      cause: error,
      failureReason: controlledFailureReason(error, defaultFailureReason(code)),
    },
  )
}

function safeFailureMessage(code: RemoteClaudeTurnFailureCode): string {
  switch (code) {
    case 'provider_session_lost':
      return 'Remote Claude native session was lost'
    case 'provider_start_failed':
      return 'Remote Claude could not start'
    case 'provider_unavailable':
      return 'Remote Claude is unavailable'
    case 'remote_execution_lost':
      return 'Remote Claude execution was lost'
    case 'remote_policy_violation':
      return 'Remote Claude emitted an unsupported operation'
    case 'provider_failed':
      return 'Remote Claude could not complete this Turn'
  }
}

function executionUnavailable(): MachineTransportError {
  return new MachineTransportError(
    'remote_execution_unavailable',
    'Remote Claude execution is unavailable',
  )
}

function sessionLost(): MachineTransportError {
  return new MachineTransportError(
    'provider_session_lost',
    'Remote Claude native session is unavailable',
  )
}

function remotePolicyViolation(): MachineTransportError {
  return new MachineTransportError(
    'remote_policy_violation',
    'Remote Claude emitted an unsupported operation',
  )
}

function remoteExecutionLost(): MachineTransportError {
  return new MachineTransportError(
    'remote_execution_lost',
    'Remote Claude stream contract was incomplete',
  )
}

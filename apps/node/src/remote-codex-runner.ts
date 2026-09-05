import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

import {
  CodexAppServerClient,
  isRecord,
  type JsonRpcNotification,
  type ThreadResumeResult,
  type ThreadStartResult,
  type TurnStartResult,
} from '@codetether/adapter-codex'
import {
  canonicalFailure,
  isCanonicalFailureReason,
  type AgentEvent,
  type CanonicalFailure,
  type CanonicalFailureReason,
} from '@codetether/agent-core'
import {
  MachineTransportError,
  RemoteCodexProviderIdentitySchema,
  RemoteCodexPromptSchema,
  machineTransportLimits,
  type CodexSessionOpenMessage,
  type CodexTurnStartMessage,
  type RemoteCodexTurnEventPayload,
} from '@codetether/machine-transport'

import { validateProjectLocationPath } from './project-location-validation.js'
import { spawnNodeProviderProcess } from './provider-process-guardian.js'
import { supportsRemoteCodexExecutionPlatform } from './provider-discovery.js'
import type { RemoteProviderSessionConnectionOwner } from './remote-provider-session-owner.js'

interface RemoteCodexClient {
  readonly startRemoteTextThread: (options: {
    readonly cwd: string
  }) => Promise<ThreadStartResult>
  readonly resumeRemoteTextThread: (options: {
    readonly threadId: string
    readonly cwd: string
  }) => Promise<ThreadResumeResult>
  readonly startRemoteTextTurn: (options: {
    readonly threadId: string
    readonly prompt: string
  }) => Promise<TurnStartResult>
  readonly waitForTurn: (
    threadId: string,
    turnId: string,
    timeoutMs?: number | null,
  ) => Promise<unknown>
  readonly shutdown: () => Promise<void>
}

export interface RemoteCodexClientFactoryOptions {
  readonly onEvent: (event: AgentEvent) => void
  readonly onError: (error: Error) => void
}

export type RemoteCodexClientFactory = (
  options: RemoteCodexClientFactoryOptions,
) => Promise<RemoteCodexClient>

export interface RemoteCodexRunnerPoolOptions {
  /** Internal Node-owned state only; never supplied by the Machine protocol. */
  readonly codexHome?: string
  /** Internal test seam; the Machine protocol cannot select an executable. */
  readonly clientFactory?: RemoteCodexClientFactory
  readonly maximumSessions?: number
}

class RemoteCodexOwnedCleanupError extends MachineTransportError {
  constructor(cause: unknown) {
    super(
      'remote_execution_lost',
      'Remote Codex owned process cleanup could not be verified',
      { cause, failureReason: 'execution_ownership_uncertain' },
    )
    this.name = 'RemoteCodexOwnedCleanupError'
  }
}

export class RemoteCodexRunnerPool {
  readonly #clientFactory: RemoteCodexClientFactory
  readonly #maximumSessions: number
  readonly #runners = new Map<string, RemoteCodexRunner>()
  readonly #opening = new Map<string, Promise<RemoteCodexRunner>>()
  readonly #cleanupTasks = new Set<Promise<void>>()
  readonly #cleanupFailures = new Set<unknown>()
  readonly #executionSupported: boolean
  #closed = false
  #closePromise: Promise<void> | undefined

  constructor(options: RemoteCodexRunnerPoolOptions = {}) {
    const codexHome = options.codexHome ?? defaultRemoteCodexHome()
    if (!isAbsolute(codexHome)) {
      throw new TypeError('Remote Codex home must be an absolute path')
    }
    this.#maximumSessions =
      options.maximumSessions ??
      machineTransportLimits.maximumRemoteCodexSessions
    if (
      !Number.isSafeInteger(this.#maximumSessions) ||
      this.#maximumSessions <= 0 ||
      this.#maximumSessions > machineTransportLimits.maximumRemoteCodexSessions
    ) {
      throw new TypeError('Remote Codex session limit is invalid')
    }
    this.#executionSupported =
      options.clientFactory !== undefined ||
      supportsRemoteCodexExecutionPlatform()
    this.#clientFactory =
      options.clientFactory ??
      (async ({ onEvent, onError }) =>
        await CodexAppServerClient.launchRemote({
          codexHome,
          clientInfo: {
            name: 'codetether-node',
            title: 'CodeTether Node',
            version: '1',
          },
          onEvent,
          onError,
          validateNotification: validateRemoteCodexTextNotification,
          onStderr: () => undefined,
          processFactory: (specification) =>
            spawnNodeProviderProcess({
              provider: 'codex',
              ...specification,
            }),
        }))
  }

  get activeCount(): number {
    return this.#runners.size
  }

  async open(
    request: CodexSessionOpenMessage,
    owner?: RemoteProviderSessionConnectionOwner,
  ): Promise<RemoteCodexRunner> {
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
        'Remote Codex Conversation already has an owned session',
      )
    }
    const existing = this.#runners.get(request.conversationId)
    if (
      existing === undefined &&
      this.#runners.size + this.#opening.size >= this.#maximumSessions
    ) {
      throw new MachineTransportError(
        'busy',
        'Remote Codex session limit was reached',
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
      if (error instanceof RemoteCodexOwnedCleanupError) {
        this.#cleanupFailures.add(error)
      }
      throw error
    } finally {
      if (this.#opening.get(request.conversationId) === opening) {
        this.#opening.delete(request.conversationId)
      }
    }
  }

  async release(runner: RemoteCodexRunner): Promise<void> {
    const cleanup = runner.close()
    this.#trackCleanup(cleanup)
    await cleanup
    if (this.#runners.get(runner.conversationId) === runner) {
      // Keep the exact Conversation occupied until owned-process cleanup has
      // been verified. A reconnect must never open a replacement alongside a
      // closing Provider tree.
      this.#runners.delete(runner.conversationId)
    }
  }

  async close(): Promise<void> {
    this.#closePromise ??= this.#close()
    await this.#closePromise
  }

  async #openRunner(
    request: CodexSessionOpenMessage,
    owner?: RemoteProviderSessionConnectionOwner,
  ): Promise<RemoteCodexRunner> {
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
    request: CodexSessionOpenMessage,
    canonicalRoot: string,
    owner?: RemoteProviderSessionConnectionOwner,
  ): Promise<RemoteCodexRunner> {
    if (this.#closed) throw executionUnavailable()
    const runner = await RemoteCodexRunner.open({
      request,
      canonicalRoot,
      clientFactory: this.#clientFactory,
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
    existing: RemoteCodexRunner,
    request: CodexSessionOpenMessage,
    owner?: RemoteProviderSessionConnectionOwner,
  ): Promise<RemoteCodexRunner> {
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
        'Remote Codex Conversation already has an owned session',
      )
    }

    // close() marks the old runner closed synchronously before its first
    // await. Retire the exact stale transport in the same turn of the event
    // loop, then wait for verified Provider cleanup before resuming it on the
    // new authenticated connection. An active Turn is never superseded.
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
        ...runners.map((runner) => ({ cleanup: true, task: runner.close() })),
        ...openings.map((task) => ({ cleanup: false, task })),
        ...cleanups.map((task) => ({ cleanup: true, task })),
      ]
      const results = await Promise.allSettled(work.map(({ task }) => task))
      for (const [index, result] of results.entries()) {
        if (
          result.status === 'rejected' &&
          (work[index]?.cleanup === true ||
            result.reason instanceof RemoteCodexOwnedCleanupError)
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
        'Remote Codex owned process cleanup did not complete',
      )
    }
  }

  #releaseAfterFatal(runner: RemoteCodexRunner): void {
    // Adapter callbacks run inside the protocol notification stack. Defer
    // exact release so shutdown cannot re-enter that stack; runner.close() is
    // idempotent if shutdown itself reports another failure.
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

interface OpenRemoteCodexRunnerOptions {
  readonly request: CodexSessionOpenMessage
  readonly canonicalRoot: string
  readonly clientFactory: RemoteCodexClientFactory
  readonly onFatal: (runner: RemoteCodexRunner) => void
  readonly owner?: RemoteProviderSessionConnectionOwner
}

export class RemoteCodexRunner {
  readonly conversationId: CodexSessionOpenMessage['conversationId']
  readonly projectId: CodexSessionOpenMessage['projectId']
  readonly canonicalRoot: string
  readonly providerThreadId: string
  readonly resumed: boolean
  readonly #client: RemoteCodexClient
  readonly #onFatal: (runner: RemoteCodexRunner) => void
  readonly #owner?: RemoteProviderSessionConnectionOwner
  readonly #actions = new Map<string, RemoteCodexRunnerTurn>()
  #activeTurn: RemoteCodexRunnerTurn | undefined
  #closed = false
  #cleanupPromise: Promise<void> | undefined
  #fatalScheduled = false

  private constructor(options: {
    request: CodexSessionOpenMessage
    canonicalRoot: string
    client: RemoteCodexClient
    providerThreadId: string
    resumed: boolean
    onFatal: (runner: RemoteCodexRunner) => void
    owner?: RemoteProviderSessionConnectionOwner
  }) {
    this.conversationId = options.request.conversationId
    this.projectId = options.request.projectId
    this.canonicalRoot = options.canonicalRoot
    this.#client = options.client
    this.providerThreadId = options.providerThreadId
    this.resumed = options.resumed
    this.#onFatal = options.onFatal
    this.#owner = options.owner
  }

  static async open(
    options: OpenRemoteCodexRunnerOptions,
  ): Promise<RemoteCodexRunner> {
    let runner: RemoteCodexRunner | undefined
    let startupFailure: Error | undefined
    const client = await options.clientFactory({
      onEvent: (event) => runner?.handleProviderEvent(event),
      onError: (error) => {
        startupFailure = error
        runner?.failOwnedSession(
          'provider_session_lost',
          canonicalFailureFromError(error, 'provider_session_lost'),
        )
      },
    })
    try {
      if (startupFailure !== undefined) throw startupFailure
      const thread =
        options.request.providerThreadId === undefined
          ? await client.startRemoteTextThread({ cwd: options.canonicalRoot })
          : await client.resumeRemoteTextThread({
              threadId: options.request.providerThreadId,
              cwd: options.canonicalRoot,
            })
      const providerThreadId = RemoteCodexProviderIdentitySchema.parse(
        thread.thread.id,
      )
      if (
        options.request.providerThreadId !== undefined &&
        providerThreadId !== options.request.providerThreadId
      ) {
        throw new MachineTransportError(
          'provider_session_lost',
          'Remote Codex resumed a different native session',
        )
      }
      runner = new RemoteCodexRunner({
        request: options.request,
        canonicalRoot: options.canonicalRoot,
        client,
        providerThreadId,
        resumed: options.request.providerThreadId !== undefined,
        onFatal: options.onFatal,
        owner: options.owner,
      })
      if (startupFailure !== undefined) throw startupFailure
      return runner
    } catch (error) {
      try {
        await client.shutdown()
      } catch (cleanupError) {
        throw new RemoteCodexOwnedCleanupError(
          new AggregateError(
            [error, cleanupError],
            'Remote Codex startup and owned cleanup both failed',
          ),
        )
      }
      throw mapProviderStartError(error)
    }
  }

  canBeSupersededBy(
    request: CodexSessionOpenMessage,
    canonicalRoot: string,
    owner?: RemoteProviderSessionConnectionOwner,
  ): boolean {
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
      request.providerThreadId !== undefined &&
      request.providerThreadId === this.providerThreadId
    )
  }

  retireConnection(): void {
    this.#owner?.retire()
  }

  async startTurn(
    request: CodexTurnStartMessage,
  ): Promise<RemoteCodexRunnerTurn> {
    if (this.#closed) throw sessionLost()
    if (
      request.conversationId !== this.conversationId ||
      request.providerThreadId !== this.providerThreadId
    ) {
      throw new MachineTransportError(
        'identity_mismatch',
        'Remote Codex Turn did not match the owned session',
      )
    }
    RemoteCodexPromptSchema.parse(request.prompt)
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
      if (previous.requestHash !== requestHash) {
        throw new MachineTransportError(
          'duplicate_action_conflict',
          'Remote Codex action identity was reused with different input',
        )
      }
      if (previous.terminal) {
        throw new MachineTransportError(
          'duplicate_action_conflict',
          'Remote Codex action already reached a terminal state',
        )
      }
      return previous
    }
    if (this.#activeTurn !== undefined) {
      throw new MachineTransportError(
        'conversation_busy',
        'Remote Codex Conversation already has an active Turn',
      )
    }

    const turn = new RemoteCodexRunnerTurn(
      request,
      requestHash,
      () => {
        if (this.#activeTurn === turn) this.#activeTurn = undefined
      },
      () => this.#terminate('remote_execution_lost'),
    )
    this.#activeTurn = turn
    this.#rememberAction(request.actionId, turn)
    let started: TurnStartResult
    try {
      started = await this.#client.startRemoteTextTurn({
        threadId: this.providerThreadId,
        prompt: request.prompt,
      })
    } catch (error) {
      turn.fail(
        'provider_start_failed',
        canonicalFailureFromError(error, 'provider_start_failed'),
      )
      await this.close()
      throw mapProviderStartError(error)
    }

    try {
      turn.bindProviderTurn(started.turn.id)
      void Promise.resolve()
        .then(
          async () =>
            await this.#client.waitForTurn(
              this.providerThreadId,
              turn.providerTurnId,
              null,
            ),
        )
        .catch((error: unknown) =>
          this.failActiveTurn(
            'provider_session_lost',
            canonicalFailureFromError(error, 'provider_session_lost'),
          ),
        )
      return turn
    } catch (error) {
      turn.fail(
        'remote_execution_lost',
        canonicalFailureFromError(error, 'execution_ownership_uncertain'),
      )
      await this.close()
      throw new MachineTransportError(
        'remote_execution_lost',
        'Remote Codex Turn ownership could not be verified',
        { cause: error, failureReason: 'execution_ownership_uncertain' },
      )
    }
  }

  handleProviderEvent(event: AgentEvent): void {
    if (this.#closed) return
    if (
      event.type === 'conversation.started' &&
      this.#activeTurn === undefined
    ) {
      return
    }
    const turn = this.#activeTurn
    if (turn === undefined) {
      this.failActiveTurn('remote_policy_violation')
      void this.close()
      return
    }
    if (event.threadId !== this.providerThreadId) {
      turn.fail('remote_policy_violation')
      void this.close()
      return
    }
    if ('turnId' in event && !turn.observeProviderTurn(event.turnId)) {
      turn.fail('remote_policy_violation')
      void this.close()
      return
    }
    if (event.type === 'turn.started') return
    if (event.type === 'message.delta') {
      turn.pushDelta(event.delta)
      return
    }
    if (event.type === 'message.completed') {
      turn.push({ type: 'message.completed' })
      return
    }
    if (event.type === 'turn.completed') {
      turn.push({ type: 'turn.completed' })
      return
    }
    if (event.type === 'turn.failed') {
      turn.fail('provider_failed', event.error.failure)
      return
    }
    if (event.type === 'turn.interrupted') {
      turn.fail('remote_execution_lost')
      return
    }

    // Tool, file and approval events are impossible in the shipped text-only
    // profile. Treat any occurrence as a policy violation and terminate the
    // exact owned App Server rather than publishing it.
    turn.fail('remote_policy_violation')
    void this.close()
  }

  failActiveTurn(
    code: 'provider_session_lost' | 'remote_policy_violation',
    failure?: CanonicalFailure,
  ): void {
    this.#activeTurn?.fail(code, failure)
  }

  failOwnedSession(
    code: 'provider_session_lost' | 'remote_policy_violation',
    failure?: CanonicalFailure,
  ): void {
    this.#terminate(code, failure)
  }

  #terminate(
    code:
      | 'provider_session_lost'
      | 'remote_policy_violation'
      | 'remote_execution_lost',
    failure?: CanonicalFailure,
  ): void {
    if (this.#fatalScheduled) return
    this.#fatalScheduled = true
    this.#activeTurn?.fail(code, failure)
    void this.close().then(
      () => this.#onFatal(this),
      () => this.#onFatal(this),
    )
  }

  async close(): Promise<void> {
    if (this.#cleanupPromise !== undefined) {
      await this.#cleanupPromise
      return
    }
    this.#closed = true
    this.#activeTurn?.fail('remote_execution_lost')
    this.#cleanupPromise = this.#client.shutdown().catch((error: unknown) => {
      throw new RemoteCodexOwnedCleanupError(error)
    })
    await this.#cleanupPromise
  }

  #rememberAction(actionId: string, turn: RemoteCodexRunnerTurn): void {
    this.#actions.set(actionId, turn)
    while (this.#actions.size > 64) {
      const oldest = this.#actions.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.#actions.delete(oldest)
    }
  }
}

export class RemoteCodexRunnerTurn {
  readonly actionId: CodexTurnStartMessage['actionId']
  readonly conversationId: CodexTurnStartMessage['conversationId']
  readonly turnId: CodexTurnStartMessage['turnId']
  readonly requestHash: string
  readonly #queue = new BoundedTurnEventQueue()
  readonly #release: () => void
  readonly #onOverflow: () => void
  #observedProviderTurnId: string | undefined
  #providerTurnId: string | undefined
  #terminal = false

  get terminal(): boolean {
    return this.#terminal
  }

  constructor(
    request: CodexTurnStartMessage,
    requestHash: string,
    release: () => void,
    onOverflow: () => void,
  ) {
    this.actionId = request.actionId
    this.conversationId = request.conversationId
    this.turnId = request.turnId
    this.requestHash = requestHash
    this.#release = release
    this.#onOverflow = onOverflow
  }

  get providerTurnId(): string {
    if (this.#providerTurnId === undefined) {
      throw new MachineTransportError(
        'provider_start_failed',
        'Remote Codex did not establish Turn ownership',
      )
    }
    return this.#providerTurnId
  }

  bindProviderTurn(value: string): void {
    const providerTurnId = RemoteCodexProviderIdentitySchema.parse(value)
    if (
      this.#observedProviderTurnId !== undefined &&
      this.#observedProviderTurnId !== providerTurnId
    ) {
      throw new MachineTransportError(
        'provider_start_failed',
        'Remote Codex Turn identity changed during startup',
      )
    }
    this.#providerTurnId = providerTurnId
  }

  observeProviderTurn(value: string): boolean {
    const parsed = RemoteCodexProviderIdentitySchema.safeParse(value)
    if (!parsed.success) return false
    this.#observedProviderTurnId ??= parsed.data
    return (
      this.#observedProviderTurnId === parsed.data &&
      (this.#providerTurnId === undefined ||
        this.#providerTurnId === parsed.data)
    )
  }

  pushDelta(text: string): void {
    for (const chunk of splitUtf8(text)) {
      this.push({ type: 'message.delta', text: chunk })
    }
  }

  push(event: RemoteCodexTurnEventPayload): void {
    if (this.#terminal) return
    try {
      this.#queue.push(event)
      if (isTerminal(event)) {
        this.#terminal = true
        this.#release()
      }
    } catch {
      this.fail(
        'remote_execution_lost',
        canonicalFailure('output_limit_exceeded', new Date().toISOString()),
      )
      this.#onOverflow()
    }
  }

  fail(
    code:
      | 'provider_start_failed'
      | 'provider_session_lost'
      | 'remote_execution_lost'
      | 'remote_policy_violation'
      | 'provider_failed',
    failure?: CanonicalFailure,
  ): void {
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

  events(): AsyncIterable<RemoteCodexTurnEventPayload> {
    return this.#queue
  }
}

class BoundedTurnEventQueue implements AsyncIterable<RemoteCodexTurnEventPayload> {
  readonly #queue: RemoteCodexTurnEventPayload[] = []
  readonly #waiters: Array<{
    resolve: (result: IteratorResult<RemoteCodexTurnEventPayload>) => void
  }> = []
  #queuedBytes = 0
  #totalOutputBytes = 0
  #totalEvents = 0
  #closed = false

  push(event: RemoteCodexTurnEventPayload): void {
    if (this.#closed) return
    const bytes = eventBytes(event)
    this.#totalEvents += 1
    if (event.type === 'message.delta') this.#totalOutputBytes += bytes
    if (
      this.#totalEvents > machineTransportLimits.maximumRemoteCodexTurnEvents ||
      this.#totalOutputBytes >
        machineTransportLimits.maximumRemoteCodexOutputBytes ||
      !this.#enqueueBounded(event, bytes)
    ) {
      throw new MachineTransportError(
        'remote_execution_lost',
        'Remote Codex output exceeded its bound',
      )
    }
    if (isTerminal(event)) this.#closed = true
  }

  #enqueueBounded(event: RemoteCodexTurnEventPayload, bytes: number): boolean {
    const waiter = this.#waiters.shift()
    if (waiter !== undefined) {
      waiter.resolve({ value: event, done: false })
      return true
    }
    const tail = this.#queue.at(-1)
    const coalesced = coalesceCodexEvent(tail, event)
    if (coalesced !== undefined) {
      const previousBytes = eventBytes(tail!)
      const nextBytes = eventBytes(coalesced)
      if (
        this.#queuedBytes - previousBytes + nextBytes >
        machineTransportLimits.maximumRemoteCodexQueuedOutputBytes
      ) {
        return false
      }
      this.#queue[this.#queue.length - 1] = coalesced
      this.#queuedBytes = this.#queuedBytes - previousBytes + nextBytes
      return true
    }
    if (
      this.#queue.length >=
        machineTransportLimits.maximumRemoteCodexQueuedEvents ||
      this.#queuedBytes + bytes >
        machineTransportLimits.maximumRemoteCodexQueuedOutputBytes
    ) {
      return false
    }
    this.#queue.push(event)
    this.#queuedBytes += bytes
    return true
  }

  forceTerminal(event: RemoteCodexTurnEventPayload): void {
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

  [Symbol.asyncIterator](): AsyncIterator<RemoteCodexTurnEventPayload> {
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

function coalesceCodexEvent(
  previous: RemoteCodexTurnEventPayload | undefined,
  next: RemoteCodexTurnEventPayload,
): RemoteCodexTurnEventPayload | undefined {
  if (previous?.type !== 'message.delta' || next.type !== 'message.delta') {
    return undefined
  }
  const text = previous.text + next.text
  return Buffer.byteLength(text, 'utf8') <=
    machineTransportLimits.maximumRemoteCodexDeltaBytes
    ? { type: 'message.delta', text }
    : undefined
}

function splitUtf8(value: string): string[] {
  if (value.length === 0) return []
  const chunks: string[] = []
  let current = ''
  let currentBytes = 0
  for (const character of value) {
    const bytes = Buffer.byteLength(character, 'utf8')
    if (
      current.length > 0 &&
      currentBytes + bytes > machineTransportLimits.maximumRemoteCodexDeltaBytes
    ) {
      chunks.push(current)
      current = ''
      currentBytes = 0
    }
    current += character
    currentBytes += bytes
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

function eventBytes(event: RemoteCodexTurnEventPayload): number {
  return event.type === 'message.delta'
    ? Buffer.byteLength(event.text, 'utf8')
    : Buffer.byteLength(JSON.stringify(event), 'utf8')
}

function isTerminal(event: RemoteCodexTurnEventPayload): boolean {
  return event.type === 'turn.completed' || event.type === 'turn.failed'
}

function turnRequestHash(request: CodexTurnStartMessage): string {
  return createHash('sha256')
    .update(request.conversationId)
    .update('\0')
    .update(request.turnId)
    .update('\0')
    .update(request.providerThreadId)
    .update('\0')
    .update(request.prompt)
    .digest('base64url')
}

/**
 * Fail-closed raw App Server notification policy for the remote text profile.
 * This check runs before the shared normalizer, so an unknown Provider event
 * can never be silently ignored. Reasoning lifecycle is admitted only because
 * Codex can emit it while producing text; it is deliberately not normalized or
 * sent over the Machine transport.
 */
export function validateRemoteCodexTextNotification(
  notification: JsonRpcNotification,
): void {
  switch (notification.method) {
    case 'configWarning': {
      const params = requireRawRecord(notification.params)
      requireAllowedRawKeys(params, ['details', 'path', 'range', 'summary'])
      requireBoundedRawMetadataText(params.summary)
      if (params.details !== undefined && params.details !== null) {
        requireBoundedRawMetadataText(params.details)
      }
      if (params.path !== undefined && params.path !== null) {
        requireBoundedRawMetadataText(params.path)
      }
      if (params.range !== undefined && params.range !== null) {
        const range = requireExactRawRecord(params.range, ['end', 'start'])
        requireRawTextPosition(range.start)
        requireRawTextPosition(range.end)
      }
      return
    }
    case 'remoteControl/status/changed': {
      const params = requireExactRawRecord(notification.params, [
        'environmentId',
        'installationId',
        'serverName',
        'status',
      ])
      if (params.environmentId !== null) throw remotePolicyViolation()
      requireRawIdentity(params.installationId)
      requireBoundedRawMetadataText(params.serverName)
      requireBoundedRawMetadataText(params.status)
      return
    }
    case 'account/rateLimits/updated': {
      const params = requireExactRawRecord(notification.params, ['rateLimits'])
      requireRawRateLimitSnapshot(params.rateLimits)
      return
    }
    case 'deprecationNotice': {
      const params = requireExactRawRecord(notification.params, [
        'details',
        'summary',
      ])
      requireBoundedRawMetadataText(params.details)
      requireBoundedRawMetadataText(params.summary)
      return
    }
    case 'warning': {
      const params = requireExactRawRecord(notification.params, [
        'message',
        'threadId',
      ])
      requireBoundedRawMetadataText(params.message)
      requireRawIdentity(params.threadId)
      return
    }
    case 'thread/started': {
      const params = requireRawRecord(notification.params)
      const thread = requireRawRecord(params.thread)
      requireRawIdentity(thread.id)
      return
    }
    case 'turn/started':
    case 'turn/completed': {
      const params = requireRawRecord(notification.params)
      requireRawIdentity(params.threadId)
      const turn = requireRawRecord(params.turn)
      requireRawIdentity(turn.id)
      return
    }
    case 'item/agentMessage/delta': {
      const params = requireRawTurnItemParams(notification.params)
      requireBoundedRawText(params.delta)
      return
    }
    case 'item/started':
    case 'item/completed': {
      const params = requireRawRecord(notification.params)
      requireRawIdentity(params.threadId)
      requireRawIdentity(params.turnId)
      const item = requireRawRecord(params.item)
      requireRawIdentity(item.id)
      if (item.type === 'userMessage') {
        validateRawUserMessageItem(notification.method, params, item)
        return
      }
      if (item.type !== 'agentMessage' && item.type !== 'reasoning') {
        throw remotePolicyViolation()
      }
      if (
        notification.method === 'item/completed' &&
        item.type === 'agentMessage'
      ) {
        requireBoundedRawText(item.text)
      }
      return
    }
    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/textDelta': {
      const params = requireRawTurnItemParams(notification.params)
      requireBoundedRawText(params.delta)
      return
    }
    case 'item/reasoning/summaryPartAdded': {
      requireRawTurnItemParams(notification.params)
      return
    }
    case 'thread/status/changed':
    case 'thread/tokenUsage/updated': {
      const params = requireRawRecord(notification.params)
      requireRawIdentity(params.threadId)
      return
    }
    case 'error':
      requireRawRecord(notification.params)
      return
    default:
      throw remotePolicyViolation()
  }
}

function validateRawUserMessageItem(
  method: 'item/started' | 'item/completed',
  params: Record<string, unknown>,
  item: Record<string, unknown>,
): void {
  requireExactRawKeys(
    params,
    method === 'item/started'
      ? ['item', 'startedAtMs', 'threadId', 'turnId']
      : ['completedAtMs', 'item', 'threadId', 'turnId'],
  )
  requireRawTimestamp(
    method === 'item/started' ? params.startedAtMs : params.completedAtMs,
  )
  requireExactRawKeys(item, ['clientId', 'content', 'id', 'type'])
  if (item.clientId !== null) throw remotePolicyViolation()
  if (!Array.isArray(item.content) || item.content.length !== 1) {
    throw remotePolicyViolation()
  }
  const content = requireExactRawRecord(item.content[0], [
    'text',
    'text_elements',
    'type',
  ])
  if (
    content.type !== 'text' ||
    !Array.isArray(content.text_elements) ||
    content.text_elements.length !== 0 ||
    !RemoteCodexPromptSchema.safeParse(content.text).success
  ) {
    throw remotePolicyViolation()
  }
}

function requireRawTurnItemParams(value: unknown): Record<string, unknown> {
  const params = requireRawRecord(value)
  requireRawIdentity(params.threadId)
  requireRawIdentity(params.turnId)
  requireRawIdentity(params.itemId)
  return params
}

function requireRawRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw remotePolicyViolation()
  return value
}

function requireExactRawRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  const record = requireRawRecord(value)
  requireExactRawKeys(record, keys)
  return record
}

function requireExactRawKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw remotePolicyViolation()
  }
}

function requireAllowedRawKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): void {
  const allowed = new Set(allowedKeys)
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw remotePolicyViolation()
  }
}

function requireRawTextPosition(value: unknown): void {
  const position = requireExactRawRecord(value, ['column', 'line'])
  requireRawTimestamp(position.column)
  requireRawTimestamp(position.line)
}

function requireRawRateLimitSnapshot(value: unknown): void {
  const snapshot = requireRawRecord(value)
  requireAllowedRawKeys(snapshot, [
    'credits',
    'individualLimit',
    'limitId',
    'limitName',
    'planType',
    'primary',
    'rateLimitReachedType',
    'secondary',
    'spendControlReached',
  ])
  if (Object.hasOwn(snapshot, 'limitId')) {
    requireNullableBoundedRawMetadataText(snapshot.limitId)
  }
  if (Object.hasOwn(snapshot, 'limitName')) {
    requireNullableBoundedRawMetadataText(snapshot.limitName)
  }
  if (Object.hasOwn(snapshot, 'primary')) {
    requireRawRateLimitWindow(snapshot.primary)
  }
  if (Object.hasOwn(snapshot, 'secondary')) {
    requireRawRateLimitWindow(snapshot.secondary)
  }
  if (Object.hasOwn(snapshot, 'credits')) {
    requireRawCreditsSnapshot(snapshot.credits)
  }
  if (Object.hasOwn(snapshot, 'individualLimit')) {
    requireRawSpendControlLimit(snapshot.individualLimit)
  }
  if (Object.hasOwn(snapshot, 'spendControlReached')) {
    requireNullableRawBoolean(snapshot.spendControlReached)
  }
  if (Object.hasOwn(snapshot, 'planType')) {
    requireNullableBoundedRawMetadataText(snapshot.planType)
  }
  if (Object.hasOwn(snapshot, 'rateLimitReachedType')) {
    requireNullableBoundedRawMetadataText(snapshot.rateLimitReachedType)
  }
}

function requireRawRateLimitWindow(value: unknown): void {
  if (value === null) return
  const window = requireRawRecord(value)
  requireAllowedRawKeys(window, [
    'resetsAt',
    'usedPercent',
    'windowDurationMins',
  ])
  if (!Object.hasOwn(window, 'usedPercent')) throw remotePolicyViolation()
  requireRawInt32(window.usedPercent)
  if (Object.hasOwn(window, 'windowDurationMins')) {
    requireNullableRawTimestamp(window.windowDurationMins)
  }
  if (Object.hasOwn(window, 'resetsAt')) {
    requireNullableRawTimestamp(window.resetsAt)
  }
}

function requireRawCreditsSnapshot(value: unknown): void {
  if (value === null) return
  const credits = requireRawRecord(value)
  requireAllowedRawKeys(credits, ['balance', 'hasCredits', 'unlimited'])
  if (
    !Object.hasOwn(credits, 'hasCredits') ||
    !Object.hasOwn(credits, 'unlimited') ||
    typeof credits.hasCredits !== 'boolean' ||
    typeof credits.unlimited !== 'boolean'
  ) {
    throw remotePolicyViolation()
  }
  if (Object.hasOwn(credits, 'balance')) {
    requireNullableBoundedRawMetadataText(credits.balance)
  }
}

function requireRawSpendControlLimit(value: unknown): void {
  if (value === null) return
  const limit = requireExactRawRecord(value, [
    'limit',
    'remainingPercent',
    'resetsAt',
    'used',
  ])
  requireBoundedRawMetadataText(limit.limit)
  requireBoundedRawMetadataText(limit.used)
  requireRawInt32(limit.remainingPercent)
  requireRawTimestamp(limit.resetsAt)
}

function requireNullableRawBoolean(value: unknown): void {
  if (value !== null && typeof value !== 'boolean') {
    throw remotePolicyViolation()
  }
}

function requireNullableBoundedRawMetadataText(value: unknown): void {
  if (value !== null) requireBoundedRawMetadataText(value)
}

function requireNullableRawTimestamp(value: unknown): void {
  if (value !== null) requireRawTimestamp(value)
}

function requireRawInt32(value: unknown): void {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < -2_147_483_648 ||
    Number(value) > 2_147_483_647
  ) {
    throw remotePolicyViolation()
  }
}

function requireRawIdentity(value: unknown): void {
  if (!RemoteCodexProviderIdentitySchema.safeParse(value).success) {
    throw remotePolicyViolation()
  }
}

function requireBoundedRawText(value: unknown): void {
  if (
    typeof value !== 'string' ||
    Buffer.byteLength(value, 'utf8') >
      machineTransportLimits.maximumRemoteCodexOutputBytes
  ) {
    throw remotePolicyViolation()
  }
}

function requireBoundedRawMetadataText(value: unknown): void {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\0') ||
    Buffer.byteLength(value, 'utf8') > 4 * 1024
  ) {
    throw remotePolicyViolation()
  }
}

function requireRawTimestamp(value: unknown): void {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw remotePolicyViolation()
  }
}

function remotePolicyViolation(): MachineTransportError {
  return new MachineTransportError(
    'remote_policy_violation',
    'Remote Codex emitted an unsupported operation',
  )
}

function defaultRemoteCodexHome(): string {
  const configured = process.env.CODEX_HOME
  return configured !== undefined && isAbsolute(configured)
    ? configured
    : join(homedir(), '.codex')
}

function safeFailureMessage(
  code:
    | 'provider_start_failed'
    | 'provider_session_lost'
    | 'remote_execution_lost'
    | 'remote_policy_violation'
    | 'provider_failed',
): string {
  return code === 'provider_start_failed'
    ? 'Remote Codex could not start the Turn'
    : code === 'provider_session_lost'
      ? 'Remote Codex session was lost'
      : code === 'remote_policy_violation'
        ? 'Remote Codex emitted an unsupported operation'
        : code === 'provider_failed'
          ? 'Remote Codex failed the Turn'
          : 'Remote Codex execution was lost'
}

function executionUnavailable(): MachineTransportError {
  return new MachineTransportError(
    'remote_execution_unavailable',
    'Remote Codex execution is unavailable',
  )
}

function sessionLost(): MachineTransportError {
  return new MachineTransportError(
    'provider_session_lost',
    'Remote Codex session is unavailable',
  )
}

function mapProviderStartError(error: unknown): MachineTransportError {
  if (error instanceof MachineTransportError) return error
  return new MachineTransportError(
    'provider_start_failed',
    'Remote Codex could not establish Provider ownership',
    {
      cause: error,
      failureReason: controlledFailureReason(error, 'provider_start_failed'),
    },
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

function canonicalFailureFromError(
  error: unknown,
  fallback: CanonicalFailureReason,
): CanonicalFailure {
  return canonicalFailure(
    controlledFailureReason(error, fallback),
    new Date().toISOString(),
  )
}

function defaultFailureReason(
  code:
    | 'provider_start_failed'
    | 'provider_session_lost'
    | 'remote_execution_lost'
    | 'remote_policy_violation'
    | 'provider_failed',
): CanonicalFailureReason {
  switch (code) {
    case 'provider_start_failed':
      return 'provider_start_failed'
    case 'provider_session_lost':
      return 'provider_session_lost'
    case 'remote_execution_lost':
      return 'execution_lost'
    case 'remote_policy_violation':
      return 'provider_protocol_error'
    case 'provider_failed':
      return 'provider_error'
  }
}

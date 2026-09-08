import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { isAbsolute, resolve } from 'node:path'

import type { AgentEvent, ApprovalRequestedEvent } from '@codetether/agent-core'

import {
  CodexOwnedProcessCleanupError,
  CodexProcessError,
  CodexProtocolError,
} from './errors.js'
import type { ProtocolLogger } from './logging.js'
import { CodexEventNormalizer, normalizeApprovalRequest } from './normalizer.js'
import {
  spawnCodexAppServer,
  spawnRemoteCodexAppServer,
  stopCodexAppServer,
  stopRemoteCodexAppServer,
  type RemoteCodexProcessFactory,
} from './process.js'
import type {
  CodexStoredThread,
  CodexStoredThreadPage,
  CodexStoredThreadSource,
  CodexStoredThreadStatus,
  CodexThread,
  CodexTurn,
  InitializeResult,
  JsonRpcNotification,
  JsonRpcRequest,
  ThreadResumeResult,
  ThreadStartResult,
  TurnInterruptResult,
  TurnStartResult,
  TurnTerminalResult,
} from './protocol.js'
import { isRecord, readString } from './protocol.js'
import { JsonRpcTransport } from './transport.js'
import { TurnLifecycleRegistry } from './turn-lifecycle.js'

export type ApprovalDecision = 'allow' | 'deny'
export type CodexApprovalPolicy = 'untrusted' | 'on-request' | 'never'
export type CodexSandboxMode =
  'read-only' | 'workspace-write' | 'danger-full-access'

export interface ApprovalPrompt {
  readonly event: ApprovalRequestedEvent
  readonly request: JsonRpcRequest
}

export type ApprovalWireResponse =
  | { readonly result: unknown }
  | {
      readonly error: {
        readonly code: number
        readonly message: string
      }
    }

export interface ApprovalResolution extends ApprovalPrompt {
  readonly decision: ApprovalDecision
  readonly response: ApprovalWireResponse
}

export interface CodexAppServerClientOptions {
  readonly requestTimeoutMs?: number
  readonly protocolLogger?: ProtocolLogger
  readonly onStderr?: (text: string) => void
  readonly onEvent?: (event: AgentEvent) => void
  readonly onUnknownNotification?: (notification: JsonRpcNotification) => void
  readonly onUnknownServerRequest?: (request: JsonRpcRequest) => void
  readonly onUnknownResponse?: (id: string | number) => void
  readonly onError?: (error: Error) => void
  /** A fail-closed policy hook invoked before any notification is normalized. */
  readonly validateNotification?: (notification: JsonRpcNotification) => void
  readonly approvalHandler?: (
    prompt: ApprovalPrompt,
  ) => ApprovalDecision | Promise<ApprovalDecision>
  readonly onApprovalResolved?: (resolution: ApprovalResolution) => void
}

export interface StartThreadOptions {
  readonly cwd: string
  readonly ephemeral?: boolean
  readonly approvalPolicy?: CodexApprovalPolicy
  readonly sandbox?: CodexSandboxMode
  readonly model?: string
}

export interface ResumeThreadOptions {
  readonly threadId: string
  readonly cwd?: string
  readonly approvalPolicy?: CodexApprovalPolicy
  readonly sandbox?: CodexSandboxMode
}

export interface LaunchCodexClientOptions extends CodexAppServerClientOptions {
  readonly executable?: string
  /** Exact Machine-local environment selected for this installation. */
  readonly environment?: NodeJS.ProcessEnv
  readonly clientInfo: {
    readonly name: string
    readonly title: string
    readonly version: string
  }
}

export interface LaunchRemoteCodexClientOptions extends Omit<
  CodexAppServerClientOptions,
  'approvalHandler'
> {
  readonly executable?: string
  /** Isolated Node-owned auth and native-session state. */
  readonly codexHome: string
  /** Node-local environment; it is reduced to the fixed safe allowlist. */
  readonly environment?: NodeJS.ProcessEnv
  /** Node-private ownership seam; never accepted from public protocol input. */
  readonly processFactory?: RemoteCodexProcessFactory
  readonly clientInfo: {
    readonly name: string
    readonly title: string
    readonly version: string
  }
}

export type CodexExecutionProfile = 'local' | 'remote-text-only'

export interface RemoteTextThreadOptions {
  readonly cwd: string
}

export interface RemoteTextResumeOptions {
  readonly threadId: string
  readonly cwd: string
}

export interface RemoteTextTurnOptions {
  readonly threadId: string
  readonly prompt: string
}

export interface ListStoredThreadsOptions {
  readonly cwd: string
  readonly cursor?: string
  readonly limit: number
  readonly sourceKinds?: readonly CodexStoredThreadSource[]
}

export interface ReadStoredThreadOptions {
  readonly threadId: string
}

const SERVER_REQUEST_DRAIN_TIMEOUT_MS = 2_000
export const MAX_CODEX_STORED_THREAD_PAGE_SIZE = 100
export const MAX_CODEX_STORED_THREAD_CURSOR_CODE_UNITS = 512
export const MAX_CODEX_STORED_THREAD_ID_CODE_UNITS = 512
const MAX_CODEX_STORED_THREAD_VERSION_CODE_UNITS = 120
const DEFAULT_CODEX_DISCOVERY_SOURCES = [
  'cli',
  'exec',
  'vscode',
  'appServer',
] as const satisfies readonly CodexStoredThreadSource[]

/** Coordinates the App Server handshake and the small Thread/Turn spike API. */
export class CodexAppServerClient {
  readonly #transport: JsonRpcTransport
  readonly #normalizer = new CodexEventNormalizer()
  readonly #lifecycle = new TurnLifecycleRegistry((threadId, turnId) =>
    this.#normalizer.releaseTurn(threadId, turnId),
  )
  readonly #options: CodexAppServerClientOptions
  readonly #observedMethods = new Set<string>()
  readonly #serverRequestTasks = new Set<Promise<void>>()
  #closing = false
  #shutdownPromise?: Promise<void>

  constructor(
    readonly process: ChildProcessWithoutNullStreams,
    options: CodexAppServerClientOptions = {},
    readonly executionProfile: CodexExecutionProfile = 'local',
  ) {
    this.#options = options
    this.#transport = new JsonRpcTransport(process, {
      requestTimeoutMs: options.requestTimeoutMs,
      logger: options.protocolLogger,
      onStderr: options.onStderr,
    })
    this.#transport.onNotification((notification) => {
      this.#handleNotification(notification)
    })
    this.#transport.onServerRequest((request) => {
      if (this.#closing) return
      const task = this.#handleServerRequest(request)
      this.#serverRequestTasks.add(task)
      void task
        .catch((error: unknown) => {
          this.#fail(toError(error))
        })
        .finally(() => {
          this.#serverRequestTasks.delete(task)
        })
    })
    this.#transport.onUnknownResponse((id) => {
      try {
        options.onUnknownResponse?.(id)
      } catch (error) {
        this.#reportDiagnostic(toError(error))
      }
    })
    this.#transport.onError((error) => this.#fail(error))
  }

  static async launch(
    options: LaunchCodexClientOptions,
  ): Promise<CodexAppServerClient> {
    const process = spawnCodexAppServer(options.executable, {
      ...(options.environment === undefined
        ? {}
        : { environment: options.environment }),
    })
    const client = new CodexAppServerClient(process, options)
    return await initializeCodexClientForLaunch(client, () =>
      client.initialize(options.clientInfo),
    )
  }

  static async launchRemote(
    options: LaunchRemoteCodexClientOptions,
  ): Promise<CodexAppServerClient> {
    const process = spawnRemoteCodexAppServer(options)
    const client = new CodexAppServerClient(
      process,
      options,
      'remote-text-only',
    )
    return await initializeCodexClientForLaunch(client, () =>
      client.initialize(options.clientInfo, { experimentalApi: true }),
    )
  }

  get observedRawMethods(): readonly string[] {
    return [...this.#observedMethods]
  }

  async initialize(
    clientInfo: {
      readonly name: string
      readonly title: string
      readonly version: string
    },
    capabilities: { readonly experimentalApi?: boolean } = {},
  ): Promise<InitializeResult> {
    this.#assertOpen()
    const result = await this.#transport.request<unknown>('initialize', {
      clientInfo,
      capabilities: {
        experimentalApi: capabilities.experimentalApi ?? false,
        requestAttestation: false,
      },
    })
    const response = parseInitializeResult(result)
    await this.#transport.notify('initialized')
    return response
  }

  async startThread(options: StartThreadOptions): Promise<ThreadStartResult> {
    this.#assertExecutionProfile('local')
    if (!isAbsolute(options.cwd)) {
      throw new CodexProtocolError('thread/start cwd must be an absolute path')
    }
    const result = await this.#transport.request<unknown>('thread/start', {
      cwd: options.cwd,
      ...(options.model === undefined ? {} : { model: options.model }),
      approvalPolicy: options.approvalPolicy ?? 'on-request',
      approvalsReviewer: 'user',
      sandbox: options.sandbox ?? 'workspace-write',
      ephemeral: options.ephemeral ?? true,
      serviceName: 'CodeTether',
    })
    const parsed = parseThreadResult(result, 'thread/start response')
    if (!samePath(parsed.cwd, options.cwd)) {
      throw new CodexProtocolError(
        `thread/start returned unexpected cwd ${parsed.cwd}`,
      )
    }
    return parsed
  }

  async resumeThread(
    options: ResumeThreadOptions,
  ): Promise<ThreadResumeResult> {
    this.#assertExecutionProfile('local')
    if (options.cwd !== undefined && !isAbsolute(options.cwd)) {
      throw new CodexProtocolError('thread/resume cwd must be an absolute path')
    }
    const result = await this.#transport.request<unknown>('thread/resume', {
      threadId: options.threadId,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.approvalPolicy === undefined
        ? {}
        : { approvalPolicy: options.approvalPolicy }),
      approvalsReviewer: 'user',
      ...(options.sandbox === undefined ? {} : { sandbox: options.sandbox }),
    })
    const parsed = parseThreadResult(result, 'thread/resume response')
    if (parsed.thread.id !== options.threadId) {
      throw new CodexProtocolError(
        `thread/resume returned unexpected thread ${parsed.thread.id}`,
      )
    }
    if (options.cwd !== undefined && !samePath(parsed.cwd, options.cwd)) {
      throw new CodexProtocolError(
        `thread/resume returned unexpected cwd ${parsed.cwd}`,
      )
    }
    return parsed
  }

  async startTurn(options: {
    readonly threadId: string
    readonly prompt: string
    readonly model?: string
    readonly reasoning?: string
  }): Promise<TurnStartResult> {
    this.#assertExecutionProfile('local')
    const result = await this.#transport.request<unknown>('turn/start', {
      threadId: options.threadId,
      input: [
        {
          type: 'text',
          text: options.prompt,
          text_elements: [],
        },
      ],
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.reasoning === undefined ? {} : { effort: options.reasoning }),
    })
    const parsed = parseTurnStartResult(result)
    this.#lifecycle.activate(options.threadId, parsed.turn.id)
    return parsed
  }

  async startRemoteTextThread(
    options: RemoteTextThreadOptions,
  ): Promise<ThreadStartResult> {
    this.#assertExecutionProfile('remote-text-only')
    assertAbsoluteCwd(options.cwd, 'thread/start')
    const result = await this.#transport.request<unknown>('thread/start', {
      cwd: options.cwd,
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandbox: 'read-only',
      ephemeral: false,
      environments: [],
      runtimeWorkspaceRoots: [],
      dynamicTools: [],
      selectedCapabilityRoots: [],
      config: remoteTextOnlyConfig(),
      serviceName: 'CodeTether',
    })
    const parsed = parseThreadResult(result, 'thread/start response')
    if (!samePath(parsed.cwd, options.cwd)) {
      throw new CodexProtocolError(
        `thread/start returned unexpected cwd ${parsed.cwd}`,
      )
    }
    return parsed
  }

  async resumeRemoteTextThread(
    options: RemoteTextResumeOptions,
  ): Promise<ThreadResumeResult> {
    this.#assertExecutionProfile('remote-text-only')
    assertAbsoluteCwd(options.cwd, 'thread/resume')
    const result = await this.#transport.request<unknown>('thread/resume', {
      threadId: options.threadId,
      cwd: options.cwd,
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandbox: 'read-only',
      runtimeWorkspaceRoots: [],
      config: remoteTextOnlyConfig(),
    })
    const parsed = parseThreadResult(result, 'thread/resume response')
    if (parsed.thread.id !== options.threadId) {
      throw new CodexProtocolError(
        `thread/resume returned unexpected thread ${parsed.thread.id}`,
      )
    }
    if (!samePath(parsed.cwd, options.cwd)) {
      throw new CodexProtocolError(
        `thread/resume returned unexpected cwd ${parsed.cwd}`,
      )
    }
    return parsed
  }

  async startRemoteTextTurn(
    options: RemoteTextTurnOptions,
  ): Promise<TurnStartResult> {
    this.#assertExecutionProfile('remote-text-only')
    const result = await this.#transport.request<unknown>('turn/start', {
      threadId: options.threadId,
      input: [
        {
          type: 'text',
          text: options.prompt,
          text_elements: [],
        },
      ],
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
      environments: [],
      runtimeWorkspaceRoots: [],
    })
    const parsed = parseTurnStartResult(result)
    this.#lifecycle.activate(options.threadId, parsed.turn.id)
    return parsed
  }

  /**
   * Reads only bounded persisted-thread metadata. useStateDbOnly prevents the
   * Provider's default rollout scan-and-repair path; no execution method is
   * issued by this operation.
   */
  async listStoredThreads(
    options: ListStoredThreadsOptions,
  ): Promise<CodexStoredThreadPage> {
    this.#assertOpen()
    assertAbsoluteCwd(options.cwd, 'thread/list')
    assertStoredThreadPageSize(options.limit)
    assertStoredThreadCursor(options.cursor)
    const result = await this.#transport.request<unknown>('thread/list', {
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      limit: options.limit,
      cwd: options.cwd,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      modelProviders: [],
      sourceKinds: options.sourceKinds ?? DEFAULT_CODEX_DISCOVERY_SOURCES,
      archived: false,
      useStateDbOnly: true,
    })
    return parseStoredThreadPage(result, options.limit)
  }

  /** Reads one stored thread's metadata without loading turns or resuming it. */
  async readStoredThread(
    options: ReadStoredThreadOptions,
  ): Promise<CodexStoredThread> {
    this.#assertOpen()
    if (
      options.threadId.length === 0 ||
      options.threadId.length > MAX_CODEX_STORED_THREAD_ID_CODE_UNITS ||
      options.threadId.includes('\0')
    ) {
      throw new CodexProtocolError('thread/read threadId is invalid')
    }
    const result = await this.#transport.request<unknown>('thread/read', {
      threadId: options.threadId,
      includeTurns: false,
    })
    const record = requireRecord(result, 'thread/read response')
    return parseStoredThread(record.thread, 'thread/read response')
  }

  async interruptTurn(options: {
    readonly threadId: string
    readonly turnId: string
  }): Promise<TurnInterruptResult> {
    this.#assertExecutionProfile('local')
    const result = await this.#transport.request<unknown>('turn/interrupt', {
      threadId: options.threadId,
      turnId: options.turnId,
    })
    requireRecord(result, 'turn/interrupt response')
    return {}
  }

  waitForTurn(
    threadId: string,
    turnId: string,
    timeoutMs: number | null = 300_000,
  ): Promise<TurnTerminalResult> {
    return this.#lifecycle.wait(threadId, turnId, timeoutMs)
  }

  async shutdown(): Promise<void> {
    this.#shutdownPromise ??= this.#shutdown()
    await this.#shutdownPromise
  }

  #handleNotification(notification: JsonRpcNotification): void {
    if (this.#closing || this.#lifecycle.failure !== undefined) return
    try {
      this.#options.validateNotification?.(notification)
    } catch (error) {
      this.#fail(
        new CodexProtocolError(
          'Codex notification was rejected by the execution policy',
          { cause: error },
        ),
      )
      return
    }
    this.#observedMethods.add(notification.method)
    let result
    try {
      result = this.#normalizer.normalize(notification)
    } catch (error) {
      this.#fail(toError(error))
      return
    }

    if (!result.recognized) {
      try {
        this.#options.onUnknownNotification?.(notification)
      } catch (error) {
        this.#reportDiagnostic(toError(error))
      }
    }
    for (const event of result.events) {
      this.#emitEvent(this.#recordAndEnrichEvent(event))
    }

    if (notification.method === 'turn/started') {
      const params = isRecord(notification.params)
        ? notification.params
        : undefined
      const turn =
        params !== undefined && isRecord(params.turn) ? params.turn : undefined
      const threadId = readString(params ?? {}, 'threadId')
      const turnId = readString(turn ?? {}, 'id')
      if (threadId !== undefined && turnId !== undefined) {
        try {
          this.#lifecycle.activate(threadId, turnId)
        } catch (error) {
          this.#fail(toError(error))
        }
      }
    }
    if (notification.method === 'turn/completed') {
      this.#completeTurn(notification)
    }
  }

  #emitEvent(event: AgentEvent): void {
    try {
      this.#options.onEvent?.(event)
    } catch (error) {
      this.#reportDiagnostic(
        new CodexProtocolError('CodeTether event consumer failed', {
          cause: error,
        }),
      )
    }
  }

  #recordAndEnrichEvent(event: AgentEvent): AgentEvent {
    if (event.type === 'message.completed') {
      this.#lifecycle.completeMessage(
        event.threadId,
        event.turnId,
        event.message,
      )
      return event
    }
    if (event.type === 'turn.completed') {
      const finalMessage = this.#lifecycle.finalMessage(
        event.threadId,
        event.turnId,
      )
      return {
        ...event,
        ...(finalMessage === undefined ? {} : { finalMessage }),
      }
    }
    return event
  }

  #completeTurn(notification: JsonRpcNotification): void {
    if (!isRecord(notification.params) || !isRecord(notification.params.turn)) {
      this.#fail(
        new CodexProtocolError('turn/completed has invalid parameters'),
      )
      return
    }
    const threadId = readString(notification.params, 'threadId')
    let turn: CodexTurn
    try {
      turn = parseTurn(notification.params.turn, 'turn/completed')
    } catch (error) {
      this.#fail(toError(error))
      return
    }
    if (threadId === undefined) {
      this.#fail(new CodexProtocolError('turn/completed is missing threadId'))
      return
    }

    const finalMessage = this.#lifecycle.finalMessage(threadId, turn.id)
    const result: TurnTerminalResult = {
      threadId,
      turn,
      ...(finalMessage === undefined ? {} : { finalMessage }),
    }
    this.#lifecycle.settle(result)
    // A waiter timeout may have released turn state before late provider file
    // events arrived. Terminal notification is the final cleanup authority.
    this.#normalizer.releaseTurn(threadId, turn.id)
  }

  async #handleServerRequest(request: JsonRpcRequest): Promise<void> {
    this.#observedMethods.add(request.method)
    if (this.executionProfile === 'remote-text-only') {
      await this.#transport.respondError(
        request.id,
        -32601,
        'Remote text-only execution does not accept server requests',
      )
      this.#fail(
        new CodexProtocolError(
          'Remote text-only Codex emitted an unsupported server request',
        ),
      )
      return
    }
    const params = isRecord(request.params) ? request.params : {}
    const threadId =
      readString(params, 'threadId') ?? readString(params, 'conversationId')
    let approvalEvent: AgentEvent | undefined
    try {
      approvalEvent = normalizeApprovalRequest(
        request,
        threadId === undefined
          ? undefined
          : this.#lifecycle.activeTurn(threadId),
      )
    } catch (error) {
      await this.#transport.respondError(
        request.id,
        -32602,
        `Invalid approval request: ${toError(error).message}`,
      )
      this.#reportDiagnostic(toError(error))
      return
    }
    if (approvalEvent === undefined) {
      if (isApprovalRequestMethod(request.method)) {
        await this.#transport.respondError(
          request.id,
          -32602,
          `Approval request cannot be bound to a thread and turn: ${request.method}`,
        )
        return
      }
      try {
        this.#options.onUnknownServerRequest?.(request)
      } catch (error) {
        this.#reportDiagnostic(toError(error))
      }
      await this.#transport.respondError(
        request.id,
        -32601,
        `Unsupported server request: ${request.method}`,
      )
      return
    }
    if (approvalEvent.type !== 'approval.requested') {
      await this.#transport.respondError(
        request.id,
        -32603,
        `Approval normalizer returned an invalid event: ${request.method}`,
      )
      return
    }

    this.#emitEvent(approvalEvent)
    let decision: ApprovalDecision
    try {
      decision =
        (await this.#options.approvalHandler?.({
          event: approvalEvent,
          request,
        })) ?? 'deny'
    } catch (error) {
      await this.#transport.respondError(
        request.id,
        -32603,
        'CodeTether approval handler failed',
      )
      this.#reportDiagnostic(toError(error))
      return
    }

    const response = await this.#respondToApproval(request, decision)
    try {
      this.#options.onApprovalResolved?.({
        event: approvalEvent,
        request,
        decision,
        response,
      })
    } catch (error) {
      this.#reportDiagnostic(toError(error))
    }
  }

  async #respondToApproval(
    request: JsonRpcRequest,
    decision: ApprovalDecision,
  ): Promise<ApprovalWireResponse> {
    if (
      request.method === 'item/commandExecution/requestApproval' ||
      request.method === 'item/fileChange/requestApproval'
    ) {
      const result = {
        decision: decision === 'allow' ? 'accept' : 'decline',
      }
      await this.#transport.respond(request.id, result)
      return { result }
    }
    if (
      request.method === 'execCommandApproval' ||
      request.method === 'applyPatchApproval'
    ) {
      const result = {
        decision:
          decision === 'allow'
            ? 'approved'
            : { denied: { rejection: 'Denied by the CodeTether user' } },
      }
      await this.#transport.respond(request.id, result)
      return { result }
    }
    if (request.method === 'item/permissions/requestApproval') {
      if (decision === 'deny') {
        const error = {
          code: -32001,
          message: 'Permission request denied by the CodeTether user',
        }
        await this.#transport.respondError(
          request.id,
          error.code,
          error.message,
        )
        return { error }
      }
      const params = isRecord(request.params) ? request.params : {}
      const requested = isRecord(params.permissions) ? params.permissions : {}
      const result = {
        permissions: {
          ...(requested.network === null || requested.network === undefined
            ? {}
            : { network: requested.network }),
          ...(requested.fileSystem === null ||
          requested.fileSystem === undefined
            ? {}
            : { fileSystem: requested.fileSystem }),
        },
        scope: 'turn',
      }
      await this.#transport.respond(request.id, result)
      return { result }
    }

    const error = {
      code: -32601,
      message: `Unsupported approval request: ${request.method}`,
    }
    await this.#transport.respondError(request.id, error.code, error.message)
    return { error }
  }

  #fail(error: Error): void {
    if (this.#lifecycle.failure !== undefined) return
    this.#lifecycle.failAll(error)
    this.#reportDiagnostic(error)
  }

  #reportDiagnostic(error: Error): void {
    try {
      this.#options.onError?.(error)
    } catch {
      // A diagnostic callback must not change protocol or lifecycle behavior.
    }
  }

  #assertOpen(): void {
    if (this.#closing) {
      throw new CodexProcessError('Codex App Server client is closing')
    }
    if (this.#lifecycle.failure !== undefined) throw this.#lifecycle.failure
  }

  #assertExecutionProfile(expected: CodexExecutionProfile): void {
    this.#assertOpen()
    if (this.executionProfile !== expected) {
      throw new CodexProtocolError(
        `Operation is unavailable for Codex execution profile ${this.executionProfile}`,
      )
    }
  }

  async #shutdown(): Promise<void> {
    this.#closing = true
    this.#lifecycle.failAll(new CodexProcessError('Codex App Server closed'))
    await this.#drainServerRequests()
    this.#transport.beginShutdown()
    if (this.executionProfile === 'remote-text-only') {
      await stopRemoteCodexAppServer(this.process)
    } else {
      await stopCodexAppServer(this.process)
    }
  }

  async #drainServerRequests(): Promise<void> {
    const tasks = [...this.#serverRequestTasks]
    if (tasks.length === 0) return

    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        Promise.allSettled(tasks),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, SERVER_REQUEST_DRAIN_TIMEOUT_MS)
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}

/**
 * @internal Test seam for the launch handshake's exact cleanup invariant.
 * A client is never returned unless initialize succeeds, and failed initialize
 * does not relinquish ownership until shutdown has completed successfully.
 */
export async function initializeCodexClientForLaunch<
  Client extends Pick<CodexAppServerClient, 'shutdown'>,
>(client: Client, initialize: () => Promise<unknown>): Promise<Client> {
  try {
    await initialize()
    return client
  } catch (initializationError) {
    try {
      await client.shutdown()
    } catch (cleanupError) {
      if (cleanupError instanceof CodexOwnedProcessCleanupError) {
        throw cleanupError
      }
      throw new CodexOwnedProcessCleanupError({ cause: cleanupError })
    }
    throw initializationError
  }
}

function assertAbsoluteCwd(cwd: string, operation: string): void {
  if (!isAbsolute(cwd)) {
    throw new CodexProtocolError(`${operation} cwd must be an absolute path`)
  }
}

function remoteTextOnlyConfig(): Record<string, unknown> {
  return {
    web_search: 'disabled',
    tools: {
      update_plan: { enabled: false },
      experimental_request_user_input: { enabled: false },
    },
    orchestrator: {
      skills: { enabled: false },
      mcp: { enabled: false },
    },
  }
}

function parseInitializeResult(value: unknown): InitializeResult {
  const record = requireRecord(value, 'initialize response')
  return {
    userAgent: requireString(record, 'userAgent', 'initialize response'),
    codexHome: requireString(record, 'codexHome', 'initialize response'),
    platformFamily: requireString(
      record,
      'platformFamily',
      'initialize response',
    ),
    platformOs: requireString(record, 'platformOs', 'initialize response'),
  }
}

function assertStoredThreadPageSize(limit: number): void {
  if (
    !Number.isSafeInteger(limit) ||
    limit <= 0 ||
    limit > MAX_CODEX_STORED_THREAD_PAGE_SIZE
  ) {
    throw new RangeError(
      `thread/list limit must be between 1 and ${MAX_CODEX_STORED_THREAD_PAGE_SIZE}`,
    )
  }
}

function assertStoredThreadCursor(cursor: string | undefined): void {
  if (
    cursor !== undefined &&
    (cursor.length === 0 ||
      cursor.length > MAX_CODEX_STORED_THREAD_CURSOR_CODE_UNITS)
  ) {
    throw new RangeError('thread/list cursor is invalid')
  }
}

function parseStoredThreadPage(
  value: unknown,
  requestedLimit: number,
): CodexStoredThreadPage {
  const record = requireRecord(value, 'thread/list response')
  if (!Array.isArray(record.data)) {
    throw new CodexProtocolError('thread/list response is missing data')
  }
  if (record.data.length > requestedLimit) {
    throw new CodexProtocolError(
      'thread/list response exceeded requested limit',
    )
  }

  const threads: CodexStoredThread[] = []
  let invalidEntryCount = 0
  for (const value of record.data) {
    try {
      threads.push(parseStoredThread(value, 'thread/list response'))
    } catch {
      invalidEntryCount += 1
    }
  }

  const nextCursor = record.nextCursor
  if (
    nextCursor !== undefined &&
    nextCursor !== null &&
    (typeof nextCursor !== 'string' ||
      nextCursor.length > MAX_CODEX_STORED_THREAD_CURSOR_CODE_UNITS)
  ) {
    throw new CodexProtocolError('thread/list response has invalid nextCursor')
  }
  return {
    threads,
    invalidEntryCount,
    ...(typeof nextCursor === 'string' && nextCursor.length > 0
      ? { nextCursor }
      : {}),
  }
}

function parseStoredThread(value: unknown, context: string): CodexStoredThread {
  const record = requireRecord(value, context)
  const source = requireString(record, 'source', context)
  if (!isCodexStoredThreadSource(source)) {
    throw new CodexProtocolError(`${context} has unsupported source`)
  }
  const statusRecord = requireRecord(record.status, context)
  const status = requireString(statusRecord, 'type', context)
  if (!isCodexStoredThreadStatus(status)) {
    throw new CodexProtocolError(`${context} has unsupported status`)
  }
  if (typeof record.ephemeral !== 'boolean') {
    throw new CodexProtocolError(`${context} is missing ephemeral`)
  }
  const createdAt = requireTimestamp(record, 'createdAt', context)
  const updatedAt = requireTimestamp(record, 'updatedAt', context)
  const recencyAt = readOptionalTimestamp(record, 'recencyAt', context)
  const name = readString(record, 'name')
  return {
    id: requireBoundedString(
      record,
      'id',
      context,
      MAX_CODEX_STORED_THREAD_ID_CODE_UNITS,
    ),
    cwd: requireString(record, 'cwd', context),
    ...(name === undefined ? {} : { name }),
    createdAt,
    updatedAt,
    ...(recencyAt === undefined ? {} : { recencyAt }),
    cliVersion: requireBoundedString(
      record,
      'cliVersion',
      context,
      MAX_CODEX_STORED_THREAD_VERSION_CODE_UNITS,
    ),
    modelProvider: requireBoundedString(
      record,
      'modelProvider',
      context,
      MAX_CODEX_STORED_THREAD_VERSION_CODE_UNITS,
    ),
    source,
    status,
    ephemeral: record.ephemeral,
  }
}

function requireBoundedString(
  value: Record<string, unknown>,
  key: string,
  context: string,
  maximumCodeUnits: number,
): string {
  const result = requireString(value, key, context)
  if (
    result.length === 0 ||
    result.length > maximumCodeUnits ||
    result.includes('\0')
  ) {
    throw new CodexProtocolError(`${context} has invalid ${key}`)
  }
  return result
}

function requireTimestamp(
  value: Record<string, unknown>,
  key: string,
  context: string,
): number {
  const result = value[key]
  if (!Number.isSafeInteger(result) || Number(result) < 0) {
    throw new CodexProtocolError(`${context} has invalid ${key}`)
  }
  return Number(result)
}

function readOptionalTimestamp(
  value: Record<string, unknown>,
  key: string,
  context: string,
): number | undefined {
  const result = value[key]
  if (result === undefined || result === null) return undefined
  return requireTimestamp(value, key, context)
}

function isCodexStoredThreadSource(
  value: string,
): value is CodexStoredThreadSource {
  return DEFAULT_CODEX_DISCOVERY_SOURCES.some((source) => source === value)
}

function isCodexStoredThreadStatus(
  value: string,
): value is CodexStoredThreadStatus {
  return ['notLoaded', 'idle', 'active', 'systemError'].includes(value)
}

function parseThreadResult(value: unknown, context: string): ThreadStartResult {
  const record = requireRecord(value, context)
  const threadRecord = requireRecord(record.thread, context)
  const thread: CodexThread = {
    id: requireString(threadRecord, 'id', context),
    ...(readString(threadRecord, 'cwd') === undefined
      ? {}
      : { cwd: readString(threadRecord, 'cwd') }),
  }
  return {
    thread,
    model: requireString(record, 'model', context),
    modelProvider: requireString(record, 'modelProvider', context),
    cwd: requireString(record, 'cwd', context),
  }
}

function parseTurnStartResult(value: unknown): TurnStartResult {
  const record = requireRecord(value, 'turn/start response')
  return { turn: parseTurn(record.turn, 'turn/start response') }
}

function parseTurn(value: unknown, context: string): CodexTurn {
  const record = requireRecord(value, context)
  const status = requireString(record, 'status', context)
  if (!['completed', 'interrupted', 'failed', 'inProgress'].includes(status)) {
    throw new CodexProtocolError(`${context} has unknown turn status ${status}`)
  }
  const error = isRecord(record.error)
    ? {
        message: requireString(record.error, 'message', context),
        codexErrorInfo: record.error.codexErrorInfo,
        additionalDetails:
          typeof record.error.additionalDetails === 'string' ||
          record.error.additionalDetails === null
            ? record.error.additionalDetails
            : null,
      }
    : null
  return {
    id: requireString(record, 'id', context),
    status: status as CodexTurn['status'],
    error,
  }
}

function requireRecord(
  value: unknown,
  context: string,
): Record<string, unknown> {
  if (!isRecord(value))
    throw new CodexProtocolError(`${context} is not an object`)
  return value
}

function requireString(
  value: Record<string, unknown>,
  key: string,
  context: string,
): string {
  const result = readString(value, key)
  if (result === undefined)
    throw new CodexProtocolError(`${context} is missing ${key}`)
  return result
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left)
  const normalizedRight = resolve(right)
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

function isApprovalRequestMethod(method: string): boolean {
  return (
    method === 'item/commandExecution/requestApproval' ||
    method === 'item/fileChange/requestApproval' ||
    method === 'item/permissions/requestApproval' ||
    method === 'execCommandApproval' ||
    method === 'applyPatchApproval'
  )
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

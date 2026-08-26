import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { isAbsolute, resolve } from 'node:path'

import type { AgentEvent, ApprovalRequestedEvent } from '@codetether/agent-core'

import { CodexProtocolError } from './errors.js'
import type { ProtocolLogger } from './logging.js'
import { CodexEventNormalizer, normalizeApprovalRequest } from './normalizer.js'
import { spawnCodexAppServer, stopCodexAppServer } from './process.js'
import type {
  CodexThread,
  CodexTurn,
  InitializeResult,
  JsonRpcNotification,
  JsonRpcRequest,
  ThreadStartResult,
  TurnStartResult,
  TurnTerminalResult,
} from './protocol.js'
import { isRecord, readString } from './protocol.js'
import { JsonRpcTransport } from './transport.js'

export type ApprovalDecision = 'allow' | 'deny'

export interface ApprovalPrompt {
  readonly event: ApprovalRequestedEvent
  readonly request: JsonRpcRequest
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
  readonly approvalHandler?: (
    prompt: ApprovalPrompt,
  ) => ApprovalDecision | Promise<ApprovalDecision>
}

export interface LaunchCodexClientOptions extends CodexAppServerClientOptions {
  readonly executable?: string
  readonly clientInfo: {
    readonly name: string
    readonly title: string
    readonly version: string
  }
}

interface TurnWaiter {
  readonly resolve: (result: TurnTerminalResult) => void
  readonly reject: (error: Error) => void
  readonly timer: NodeJS.Timeout
}

/** Coordinates the App Server handshake and the small Thread/Turn spike API. */
export class CodexAppServerClient {
  readonly #transport: JsonRpcTransport
  readonly #normalizer = new CodexEventNormalizer()
  readonly #options: CodexAppServerClientOptions
  readonly #observedMethods = new Set<string>()
  readonly #activeTurns = new Map<string, string>()
  readonly #finalMessages = new Map<string, string>()
  readonly #terminalTurns = new Map<string, TurnTerminalResult>()
  readonly #turnWaiters = new Map<string, Set<TurnWaiter>>()
  #runtimeFailure?: Error

  constructor(
    readonly process: ChildProcessWithoutNullStreams,
    options: CodexAppServerClientOptions = {},
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
      void this.#handleServerRequest(request).catch((error: unknown) => {
        this.#fail(toError(error))
      })
    })
    this.#transport.onUnknownResponse((id) => options.onUnknownResponse?.(id))
    this.#transport.onError((error) => this.#fail(error))
  }

  static async launch(
    options: LaunchCodexClientOptions,
  ): Promise<CodexAppServerClient> {
    const process = spawnCodexAppServer(options.executable)
    const client = new CodexAppServerClient(process, options)
    try {
      await client.initialize(options.clientInfo)
      return client
    } catch (error) {
      await client.shutdown()
      throw error
    }
  }

  get observedRawMethods(): readonly string[] {
    return [...this.#observedMethods]
  }

  async initialize(clientInfo: {
    readonly name: string
    readonly title: string
    readonly version: string
  }): Promise<InitializeResult> {
    const result = await this.#transport.request<unknown>('initialize', {
      clientInfo,
      capabilities: {
        experimentalApi: false,
        requestAttestation: false,
      },
    })
    const response = parseInitializeResult(result)
    await this.#transport.notify('initialized')
    return response
  }

  async startThread(options: {
    readonly cwd: string
    readonly ephemeral?: boolean
  }): Promise<ThreadStartResult> {
    if (!isAbsolute(options.cwd)) {
      throw new CodexProtocolError('thread/start cwd must be an absolute path')
    }
    const result = await this.#transport.request<unknown>('thread/start', {
      cwd: options.cwd,
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      sandbox: 'workspace-write',
      ephemeral: options.ephemeral ?? true,
      serviceName: 'CodeTether',
    })
    const parsed = parseThreadStartResult(result)
    if (!samePath(parsed.cwd, options.cwd)) {
      throw new CodexProtocolError(
        `thread/start returned unexpected cwd ${parsed.cwd}`,
      )
    }
    return parsed
  }

  async startTurn(options: {
    readonly threadId: string
    readonly prompt: string
  }): Promise<TurnStartResult> {
    const result = await this.#transport.request<unknown>('turn/start', {
      threadId: options.threadId,
      input: [
        {
          type: 'text',
          text: options.prompt,
          text_elements: [],
        },
      ],
    })
    const parsed = parseTurnStartResult(result)
    this.#activeTurns.set(options.threadId, parsed.turn.id)
    return parsed
  }

  waitForTurn(
    threadId: string,
    turnId: string,
    timeoutMs = 300_000,
  ): Promise<TurnTerminalResult> {
    const key = turnKey(threadId, turnId)
    const terminal = this.#terminalTurns.get(key)
    if (terminal !== undefined) return Promise.resolve(terminal)
    if (this.#runtimeFailure !== undefined)
      return Promise.reject(this.#runtimeFailure)

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiters = this.#turnWaiters.get(key)
        if (waiters !== undefined) {
          for (const waiter of waiters) {
            if (waiter.resolve === resolve) waiters.delete(waiter)
          }
          if (waiters.size === 0) this.#turnWaiters.delete(key)
        }
        reject(new CodexProtocolError(`Timed out waiting for turn ${turnId}`))
      }, timeoutMs)
      const waiter: TurnWaiter = { resolve, reject, timer }
      const waiters = this.#turnWaiters.get(key) ?? new Set<TurnWaiter>()
      waiters.add(waiter)
      this.#turnWaiters.set(key, waiters)
    })
  }

  async shutdown(): Promise<void> {
    this.#transport.beginShutdown()
    await stopCodexAppServer(this.process)
  }

  #handleNotification(notification: JsonRpcNotification): void {
    this.#observedMethods.add(notification.method)
    let result
    try {
      result = this.#normalizer.normalize(notification)
    } catch (error) {
      this.#fail(toError(error))
      return
    }

    if (!result.recognized) {
      this.#options.onUnknownNotification?.(notification)
    }
    for (const event of result.events) this.#emitEvent(event)

    if (notification.method === 'turn/started') {
      const params = isRecord(notification.params)
        ? notification.params
        : undefined
      const turn =
        params !== undefined && isRecord(params.turn) ? params.turn : undefined
      const threadId = readString(params ?? {}, 'threadId')
      const turnId = readString(turn ?? {}, 'id')
      if (threadId !== undefined && turnId !== undefined) {
        this.#activeTurns.set(threadId, turnId)
      }
    }
    if (notification.method === 'turn/completed') {
      this.#completeTurn(notification)
    }
  }

  #emitEvent(event: AgentEvent): void {
    const key =
      'turnId' in event ? turnKey(event.threadId, event.turnId) : undefined
    let emitted = event

    if (key !== undefined && event.type === 'message.delta') {
      this.#finalMessages.set(
        key,
        `${this.#finalMessages.get(key) ?? ''}${event.delta}`,
      )
    }
    if (key !== undefined && event.type === 'message.completed') {
      this.#finalMessages.set(key, event.message)
    }
    if (key !== undefined && event.type === 'turn.completed') {
      const finalMessage = this.#finalMessages.get(key)
      emitted = {
        ...event,
        ...(finalMessage === undefined ? {} : { finalMessage }),
      }
    }
    this.#options.onEvent?.(emitted)
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

    const key = turnKey(threadId, turn.id)
    const result: TurnTerminalResult = {
      threadId,
      turn,
      ...(this.#finalMessages.get(key) === undefined
        ? {}
        : { finalMessage: this.#finalMessages.get(key) }),
    }
    this.#terminalTurns.set(key, result)
    this.#activeTurns.delete(threadId)
    const waiters = this.#turnWaiters.get(key)
    if (waiters === undefined) return
    this.#turnWaiters.delete(key)
    for (const waiter of waiters) {
      clearTimeout(waiter.timer)
      waiter.resolve(result)
    }
  }

  async #handleServerRequest(request: JsonRpcRequest): Promise<void> {
    this.#observedMethods.add(request.method)
    const params = isRecord(request.params) ? request.params : {}
    const threadId =
      readString(params, 'threadId') ?? readString(params, 'conversationId')
    const approvalEvent = normalizeApprovalRequest(
      request,
      threadId === undefined ? undefined : this.#activeTurns.get(threadId),
    )
    if (
      approvalEvent === undefined ||
      approvalEvent.type !== 'approval.requested'
    ) {
      this.#options.onUnknownServerRequest?.(request)
      await this.#transport.respondError(
        request.id,
        -32601,
        `Unsupported server request: ${request.method}`,
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
      this.#options.onError?.(toError(error))
      return
    }

    await this.#respondToApproval(request, decision)
  }

  async #respondToApproval(
    request: JsonRpcRequest,
    decision: ApprovalDecision,
  ): Promise<void> {
    if (
      request.method === 'item/commandExecution/requestApproval' ||
      request.method === 'item/fileChange/requestApproval'
    ) {
      await this.#transport.respond(request.id, {
        decision: decision === 'allow' ? 'accept' : 'decline',
      })
      return
    }
    if (
      request.method === 'execCommandApproval' ||
      request.method === 'applyPatchApproval'
    ) {
      await this.#transport.respond(request.id, {
        decision:
          decision === 'allow'
            ? 'approved'
            : { denied: { rejection: 'Denied by the CodeTether user' } },
      })
      return
    }
    if (request.method === 'item/permissions/requestApproval') {
      if (decision === 'deny') {
        await this.#transport.respondError(
          request.id,
          -32001,
          'Permission request denied by the CodeTether user',
        )
        return
      }
      const params = isRecord(request.params) ? request.params : {}
      const requested = isRecord(params.permissions) ? params.permissions : {}
      await this.#transport.respond(request.id, {
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
      })
      return
    }

    await this.#transport.respondError(
      request.id,
      -32601,
      `Unsupported approval request: ${request.method}`,
    )
  }

  #fail(error: Error): void {
    if (
      this.#runtimeFailure !== undefined &&
      this.#runtimeFailure.message === error.message
    ) {
      return
    }
    this.#runtimeFailure = error
    for (const waiters of this.#turnWaiters.values()) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timer)
        waiter.reject(error)
      }
    }
    this.#turnWaiters.clear()
    this.#options.onError?.(error)
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

function parseThreadStartResult(value: unknown): ThreadStartResult {
  const record = requireRecord(value, 'thread/start response')
  const threadRecord = requireRecord(record.thread, 'thread/start response')
  const thread: CodexThread = {
    id: requireString(threadRecord, 'id', 'thread/start response'),
    ...(readString(threadRecord, 'cwd') === undefined
      ? {}
      : { cwd: readString(threadRecord, 'cwd') }),
  }
  return {
    thread,
    model: requireString(record, 'model', 'thread/start response'),
    modelProvider: requireString(
      record,
      'modelProvider',
      'thread/start response',
    ),
    cwd: requireString(record, 'cwd', 'thread/start response'),
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

function turnKey(threadId: string, turnId: string): string {
  return `${threadId}\u0000${turnId}`
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left)
  const normalizedRight = resolve(right)
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

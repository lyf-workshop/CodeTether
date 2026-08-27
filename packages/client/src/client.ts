import {
  BootstrapSchema,
  ApprovalIdSchema,
  ConversationIdSchema,
  CreateConversationRequestSchema,
  CreateConversationResponseSchema,
  CreateProjectRequestSchema,
  CreateProjectResponseSchema,
  DeleteProjectRequestSchema,
  DeleteProjectResponseSchema,
  GetProjectResponseSchema,
  HostSnapshotSchema,
  InterruptTurnRequestSchema,
  InterruptTurnResponseSchema,
  LastEventIdSchema,
  ListProjectsResponseSchema,
  ProjectIdSchema,
  ResolveApprovalRequestSchema,
  ResolveApprovalResponseSchema,
  SafeErrorEnvelopeSchema,
  StartTurnRequestSchema,
  StartTurnResponseSchema,
  TurnIdSchema,
  type ApprovalId,
  type Bootstrap,
  type ConversationId,
  type CreateConversationRequest,
  type CreateConversationResponse,
  type CreateProjectRequest,
  type CreateProjectResponse,
  type DeleteProjectRequest,
  type DeleteProjectResponse,
  type GetProjectResponse,
  type HostSnapshot,
  type InterruptTurnRequest,
  type InterruptTurnResponse,
  type LastEventId,
  type ListProjectsResponse,
  type ProjectId,
  type ResolveApprovalRequest,
  type ResolveApprovalResponse,
  type StartTurnRequest,
  type StartTurnResponse,
  type TurnId,
  protocolVersion,
} from '@codetether/protocol'

import {
  CodeTetherIncompatibleProtocolError,
  CodeTetherProtocolError,
  CodeTetherResponseError,
} from './errors.js'
import { CodeTetherEventStream, linkedAbortController } from './event-stream.js'

interface RuntimeSchema<T> {
  parse(value: unknown): T
}

export interface CodeTetherClientOptions {
  readonly baseUrl: string
  readonly fetch?: typeof globalThis.fetch
  readonly maxResponseBytes?: number
  readonly maxEventFrameBytes?: number
}

export interface RequestOptions {
  readonly signal?: AbortSignal
}

export interface ConnectEventsOptions extends RequestOptions {
  readonly lastEventId?: LastEventId
}

export class CodeTetherClient {
  readonly #baseUrl: string
  readonly #fetch: typeof globalThis.fetch
  readonly #maxResponseBytes: number
  readonly #maxEventFrameBytes: number

  constructor(options: CodeTetherClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '')
    const fetchImplementation = options.fetch ?? globalThis.fetch
    if (fetchImplementation === undefined) {
      throw new Error('CodeTetherClient requires a Fetch API implementation')
    }
    this.#fetch = fetchImplementation.bind(globalThis)
    this.#maxResponseBytes = positiveInteger(
      options.maxResponseBytes,
      64 * 1024 * 1024,
      'maxResponseBytes',
    )
    this.#maxEventFrameBytes = positiveInteger(
      options.maxEventFrameBytes,
      10 * 1024 * 1024,
      'maxEventFrameBytes',
    )
  }

  async bootstrap(options: RequestOptions = {}): Promise<Bootstrap> {
    return await this.#request(
      '/api/v1/bootstrap',
      BootstrapSchema,
      {
        method: 'GET',
        signal: options.signal,
      },
      undefined,
      assertCompatibleBootstrapVersion,
    )
  }

  async snapshot(options: RequestOptions = {}): Promise<HostSnapshot> {
    return await this.#request('/api/v1/snapshot', HostSnapshotSchema, {
      method: 'GET',
      signal: options.signal,
    })
  }

  async listProjects(
    options: RequestOptions = {},
  ): Promise<ListProjectsResponse> {
    return await this.#request('/api/v1/projects', ListProjectsResponseSchema, {
      method: 'GET',
      signal: options.signal,
    })
  }

  async getProject(
    projectId: ProjectId,
    options: RequestOptions = {},
  ): Promise<GetProjectResponse> {
    const project = parseProtocol(ProjectIdSchema, projectId, 'get-project id')
    const response = await this.#request(
      `/api/v1/projects/${encodeURIComponent(project)}`,
      GetProjectResponseSchema,
      {
        method: 'GET',
        signal: options.signal,
      },
    )
    assertProtocolIdentity(
      response.project.projectId === project,
      'Project response does not match the requested Project',
    )
    return response
  }

  async createProject(
    input: CreateProjectRequest,
    options: RequestOptions = {},
  ): Promise<CreateProjectResponse> {
    const request = parseProtocol(
      CreateProjectRequestSchema,
      input,
      'create-project request',
    )
    return await this.#request(
      '/api/v1/projects',
      CreateProjectResponseSchema,
      jsonRequest(request, options.signal),
      request.actionId,
    )
  }

  async deleteProject(
    projectId: ProjectId,
    input: DeleteProjectRequest,
    options: RequestOptions = {},
  ): Promise<DeleteProjectResponse> {
    const project = parseProtocol(
      ProjectIdSchema,
      projectId,
      'delete-project id',
    )
    const request = parseProtocol(
      DeleteProjectRequestSchema,
      input,
      'delete-project request',
    )
    const response = await this.#request(
      `/api/v1/projects/${encodeURIComponent(project)}`,
      DeleteProjectResponseSchema,
      {
        ...jsonRequest(request, options.signal),
        method: 'DELETE',
      },
      request.actionId,
    )
    assertProtocolIdentity(
      response.data.projectId === project,
      'Delete Project response does not match the requested Project',
    )
    return response
  }

  async createConversation(
    input: CreateConversationRequest,
    options: RequestOptions = {},
  ): Promise<CreateConversationResponse> {
    const request = parseProtocol(
      CreateConversationRequestSchema,
      input,
      'create-conversation request',
    )
    return await this.#request(
      '/api/v1/conversations',
      CreateConversationResponseSchema,
      jsonRequest(request, options.signal),
      request.actionId,
    )
  }

  async startTurn(
    conversationId: ConversationId,
    input: StartTurnRequest,
    options: RequestOptions = {},
  ): Promise<StartTurnResponse> {
    const conversation = parseProtocol(
      ConversationIdSchema,
      conversationId,
      'start-turn conversation id',
    )
    const request = parseProtocol(
      StartTurnRequestSchema,
      input,
      'start-turn request',
    )
    const response = await this.#request(
      `/api/v1/conversations/${encodeURIComponent(conversation)}/turns`,
      StartTurnResponseSchema,
      jsonRequest(request, options.signal),
      request.actionId,
    )
    assertProtocolIdentity(
      response.data.turn.conversationId === conversation,
      'Start Turn response does not match the requested Conversation',
    )
    return response
  }

  async interruptTurn(
    conversationId: ConversationId,
    turnId: TurnId,
    input: InterruptTurnRequest,
    options: RequestOptions = {},
  ): Promise<InterruptTurnResponse> {
    const conversation = parseProtocol(
      ConversationIdSchema,
      conversationId,
      'interrupt-turn conversation id',
    )
    const turn = parseProtocol(TurnIdSchema, turnId, 'interrupt-turn turn id')
    const request = parseProtocol(
      InterruptTurnRequestSchema,
      input,
      'interrupt-turn request',
    )
    const response = await this.#request(
      `/api/v1/conversations/${encodeURIComponent(conversation)}/turns/${encodeURIComponent(turn)}/interrupt`,
      InterruptTurnResponseSchema,
      jsonRequest(request, options.signal),
      request.actionId,
    )
    assertProtocolIdentity(
      response.data.turn.conversationId === conversation &&
        response.data.turn.turnId === turn,
      'Interrupt response does not match the requested Turn',
    )
    return response
  }

  async resolveApproval(
    approvalId: ApprovalId,
    input: ResolveApprovalRequest,
    options: RequestOptions = {},
  ): Promise<ResolveApprovalResponse> {
    const approval = parseProtocol(
      ApprovalIdSchema,
      approvalId,
      'resolve-approval id',
    )
    const request = parseProtocol(
      ResolveApprovalRequestSchema,
      input,
      'resolve-approval request',
    )
    const response = await this.#request(
      `/api/v1/approvals/${encodeURIComponent(approval)}/resolve`,
      ResolveApprovalResponseSchema,
      jsonRequest(request, options.signal),
      request.actionId,
    )
    assertProtocolIdentity(
      response.data.approval.approvalId === approval,
      'Approval response does not match the requested Approval',
    )
    return response
  }

  async connectEvents(
    options: ConnectEventsOptions = {},
  ): Promise<CodeTetherEventStream> {
    const lastEventId =
      options.lastEventId === undefined
        ? undefined
        : parseProtocol(LastEventIdSchema, options.lastEventId, 'Last-Event-ID')
    const linked = linkedAbortController(options.signal)
    let response: Response
    try {
      response = await this.#fetch(this.#url('/api/v1/events'), {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          ...(lastEventId === undefined
            ? {}
            : { 'Last-Event-ID': lastEventId }),
        },
        signal: linked.controller.signal,
      })
    } catch (error) {
      linked.detach()
      throw error
    }

    if (!response.ok) {
      try {
        throw await responseError(response, this.#maxResponseBytes)
      } finally {
        linked.detach()
      }
    }
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.toLowerCase().startsWith('text/event-stream')) {
      linked.controller.abort()
      linked.detach()
      await response.body?.cancel().catch(() => undefined)
      throw new CodeTetherProtocolError(
        `CodeTether event endpoint returned ${contentType || 'no content type'}`,
      )
    }
    if (response.body === null) {
      linked.controller.abort()
      linked.detach()
      throw new CodeTetherProtocolError(
        'CodeTether event endpoint returned no response body',
      )
    }
    return new CodeTetherEventStream(
      response.body,
      linked.controller,
      linked.detach,
      lastEventId,
      this.#maxEventFrameBytes,
    )
  }

  async #request<T>(
    path: string,
    schema: RuntimeSchema<T>,
    init: RequestInit,
    expectedActionId?: CreateConversationRequest['actionId'],
    inspectPayload?: (value: unknown) => void,
  ): Promise<T> {
    const response = await this.#fetch(this.#url(path), {
      ...init,
      headers: {
        Accept: 'application/json',
        ...init.headers,
      },
    })
    if (!response.ok) {
      throw await responseError(
        response,
        this.#maxResponseBytes,
        expectedActionId,
      )
    }
    const payload = await readJson(response, this.#maxResponseBytes)
    inspectPayload?.(payload)
    const value = parseProtocol(schema, payload, `response from ${path}`)
    if (expectedActionId !== undefined) {
      assertProtocolIdentity(
        readActionId(value) === expectedActionId,
        'Mutation response actionId does not match the request',
      )
    }
    return value
  }

  #url(path: string): string {
    return `${this.#baseUrl}${path}`
  }
}

function assertCompatibleBootstrapVersion(value: unknown): void {
  if (
    typeof value === 'object' &&
    value !== null &&
    'protocolVersion' in value &&
    value.protocolVersion !== protocolVersion
  ) {
    throw new CodeTetherIncompatibleProtocolError(value.protocolVersion)
  }
}

function jsonRequest(body: unknown, signal?: AbortSignal): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  }
}

async function responseError(
  response: Response,
  maxResponseBytes: number,
  expectedActionId?: CreateConversationRequest['actionId'],
): Promise<Error> {
  const payload = await readJson(response, maxResponseBytes)
  const envelope = parseProtocol(
    SafeErrorEnvelopeSchema,
    payload,
    `error response with HTTP ${response.status}`,
  )
  if (expectedActionId !== undefined && envelope.actionId !== undefined) {
    assertProtocolIdentity(
      envelope.actionId === expectedActionId,
      'Mutation error actionId does not match the request',
    )
  }
  return new CodeTetherResponseError(response.status, envelope)
}

async function readJson(
  response: Response,
  maxResponseBytes: number,
): Promise<unknown> {
  const body = await readBoundedText(response, maxResponseBytes)
  try {
    return JSON.parse(body)
  } catch (error) {
    throw new CodeTetherProtocolError(
      `CodeTether returned invalid JSON with HTTP ${response.status}`,
      { cause: error },
    )
  }
}

async function readBoundedText(
  response: Response,
  maxResponseBytes: number,
): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new CodeTetherProtocolError(
      'CodeTether HTTP response exceeded its inbound body limit',
    )
  }
  if (response.body === null) return ''

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  let completed = false
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      bytes += result.value.byteLength
      if (bytes > maxResponseBytes) {
        throw new CodeTetherProtocolError(
          'CodeTether HTTP response exceeded its inbound body limit',
        )
      }
      text += decoder.decode(result.value, { stream: true })
    }
    text += decoder.decode()
    completed = true
    return text
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

function parseProtocol<T>(
  schema: RuntimeSchema<T>,
  value: unknown,
  context: string,
): T {
  try {
    return schema.parse(value)
  } catch (error) {
    throw new CodeTetherProtocolError(
      `CodeTether protocol validation failed for ${context}`,
      { cause: error },
    )
  }
}

function readActionId(value: unknown): unknown {
  return typeof value === 'object' && value !== null && 'actionId' in value
    ? value.actionId
    : undefined
}

function assertProtocolIdentity(
  condition: boolean,
  message: string,
): asserts condition {
  if (!condition) throw new CodeTetherProtocolError(message)
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return resolved
}

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'

import {
  ApprovalIdSchema,
  AttentionIdSchema,
  AttentionListResponseSchema,
  BootstrapResponseSchema,
  ConversationIdSchema,
  ConversationListResponseSchema,
  CreateConversationRequestSchema,
  CreateConversationResponseSchema,
  CreateProjectRequestSchema,
  CreateProjectResponseSchema,
  DeleteProjectRequestSchema,
  DeleteProjectResponseSchema,
  GetConversationResponseSchema,
  GetProjectResponseSchema,
  HostSnapshotSchema,
  InterruptTurnRequestSchema,
  InterruptTurnResponseSchema,
  ListAttentionQuerySchema,
  ResolveApprovalRequestSchema,
  ResolveApprovalResponseSchema,
  ResolveAttentionRequestSchema,
  ResolveAttentionResponseSchema,
  ListProjectsResponseSchema,
  ListProjectConversationsQuerySchema,
  ProjectIdSchema,
  StartTurnRequestSchema,
  StartTurnResponseSchema,
  TurnIdSchema,
} from '@codetether/protocol'

import { HostService } from './host-service.js'
import {
  HttpBoundary,
  HttpBoundaryError,
  type HttpRequestContext,
} from './http-boundary.js'
import { serveSseResponse } from './sse-http-response.js'
import {
  SseConnectionPool,
  type SseConnectionPoolOptions,
} from './sse-connections.js'

const LOOPBACK_HOST = '127.0.0.1'
const DEFAULT_HEARTBEAT_MS = 20_000

export interface LocalHttpServerOptions extends SseConnectionPoolOptions {
  readonly service: HostService
  readonly allowedOrigins: readonly string[]
  readonly bodyLimitBytes?: number
  readonly heartbeatMs?: number
}

export class LocalHttpServer {
  readonly #service: HostService
  readonly #http: HttpBoundary
  readonly #heartbeatMs: number
  readonly #sse: SseConnectionPool
  readonly #server = createServer((request, response) => {
    void this.#handle(request, response)
  })
  #stopHeartbeat?: () => void
  #unsubscribePublisher?: () => void
  #baseUrl?: string
  #closePromise?: Promise<void>

  constructor(options: LocalHttpServerOptions) {
    this.#service = options.service
    this.#http = new HttpBoundary({
      allowedOrigins: options.allowedOrigins,
      ...(options.bodyLimitBytes === undefined
        ? {}
        : { bodyLimitBytes: options.bodyLimitBytes }),
    })
    this.#heartbeatMs = positiveInteger(
      options.heartbeatMs,
      DEFAULT_HEARTBEAT_MS,
      'heartbeatMs',
    )
    this.#sse = new SseConnectionPool(options)
  }

  get baseUrl(): string {
    if (this.#baseUrl === undefined) {
      throw new Error('Local HTTP server has not started')
    }
    return this.#baseUrl
  }

  async start(port = 0): Promise<string> {
    if (this.#baseUrl !== undefined) {
      throw new Error('Local HTTP server already started')
    }
    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
      throw new Error('HTTP port must be an integer from 0 to 65535')
    }
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        this.#server.off('listening', onListening)
        reject(error)
      }
      const onListening = (): void => {
        this.#server.off('error', onError)
        resolve()
      }
      this.#server.once('error', onError)
      this.#server.once('listening', onListening)
      this.#server.listen(port, LOOPBACK_HOST)
    })
    const address = this.#server.address() as AddressInfo | null
    if (address === null || address.address !== LOOPBACK_HOST) {
      await this.close()
      throw new Error('Host API did not bind to the required loopback address')
    }
    this.#baseUrl = `http://${LOOPBACK_HOST}:${String(address.port)}`
    this.#unsubscribePublisher = this.#service.publisher.subscribe((event) => {
      this.#sse.publish(event)
    })
    this.#stopHeartbeat = this.#sse.startHeartbeat(this.#heartbeatMs, 'ping')
    return this.#baseUrl
  }

  async close(): Promise<void> {
    this.#closePromise ??= this.#close()
    await this.#closePromise
  }

  async #handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const context: HttpRequestContext = {}
    try {
      this.#http.authorizeAuthority(request, this.baseUrl)
      context.allowedOrigin = this.#http.authorizeOrigin(request)
      if (request.method === 'OPTIONS') {
        this.#http.writePreflight(response, context.allowedOrigin)
        return
      }
      const url = this.#http.parseRequestUrl(
        request.url ?? '/',
        this.#baseUrl ?? 'http://local',
      )
      const projectConversationsRoute = this.#http.matchPath(
        url.pathname,
        /^\/api\/v1\/projects\/([^/]+)\/conversations$/u,
      )
      const acceptsQuery =
        request.method === 'GET' &&
        (projectConversationsRoute !== undefined ||
          url.pathname === '/api/v1/attention')
      if (url.search !== '' && !acceptsQuery) {
        throw new HttpBoundaryError(
          'invalid_request',
          'Query parameters are not supported for this endpoint',
          400,
        )
      }

      if (request.method === 'GET' && url.pathname === '/api/v1/bootstrap') {
        this.#http.writeJson(
          response,
          200,
          BootstrapResponseSchema.parse(this.#service.bootstrap()),
          context.allowedOrigin,
        )
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/snapshot') {
        this.#http.writeJson(
          response,
          200,
          HostSnapshotSchema.parse(this.#service.snapshot()),
          context.allowedOrigin,
        )
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/events') {
        await serveSseResponse({
          request,
          response,
          baseHeaders: this.#http.baseHeaders(context.allowedOrigin),
          service: this.#service,
          connections: this.#sse,
        })
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/projects') {
        this.#http.writeJson(
          response,
          200,
          ListProjectsResponseSchema.parse(await this.#service.listProjects()),
          context.allowedOrigin,
        )
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/attention') {
        const query = this.#http.parseValidatedQuery(
          url.searchParams,
          ListAttentionQuerySchema,
        )
        this.#http.writeJson(
          response,
          200,
          AttentionListResponseSchema.parse(this.#service.listAttention(query)),
          context.allowedOrigin,
        )
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/projects') {
        const body = await this.#http.readValidatedBody(
          request,
          CreateProjectRequestSchema,
        )
        context.actionId = body.actionId
        const result = await this.#service.createProject(body)
        this.#http.writeJson(
          response,
          result.data.created ? 201 : 200,
          CreateProjectResponseSchema.parse(result),
          context.allowedOrigin,
        )
        return
      }

      if (request.method === 'GET' && projectConversationsRoute !== undefined) {
        const projectId = this.#http.parseRouteId(
          ProjectIdSchema,
          projectConversationsRoute[0],
          'projectId',
        )
        const query = this.#http.parseValidatedQuery(
          url.searchParams,
          ListProjectConversationsQuerySchema,
        )
        this.#http.writeJson(
          response,
          200,
          ConversationListResponseSchema.parse(
            await this.#service.listProjectConversations(projectId, query),
          ),
          context.allowedOrigin,
        )
        return
      }

      const projectRoute = this.#http.matchPath(
        url.pathname,
        /^\/api\/v1\/projects\/([^/]+)$/u,
      )
      if (projectRoute !== undefined) {
        const projectId = this.#http.parseRouteId(
          ProjectIdSchema,
          projectRoute[0],
          'projectId',
        )
        if (request.method === 'GET') {
          this.#http.writeJson(
            response,
            200,
            GetProjectResponseSchema.parse(
              await this.#service.getProject(projectId),
            ),
            context.allowedOrigin,
          )
          return
        }
        if (request.method === 'DELETE') {
          const body = await this.#http.readValidatedBody(
            request,
            DeleteProjectRequestSchema,
          )
          context.actionId = body.actionId
          this.#http.writeJson(
            response,
            200,
            DeleteProjectResponseSchema.parse(
              await this.#service.deleteProject(projectId, body),
            ),
            context.allowedOrigin,
          )
          return
        }
      }
      if (
        request.method === 'POST' &&
        url.pathname === '/api/v1/conversations'
      ) {
        const body = await this.#http.readValidatedBody(
          request,
          CreateConversationRequestSchema,
        )
        context.actionId = body.actionId
        const result = await this.#service.createConversation(body)
        this.#http.writeJson(
          response,
          201,
          CreateConversationResponseSchema.parse(result),
          context.allowedOrigin,
        )
        return
      }

      const conversationRoute = this.#http.matchPath(
        url.pathname,
        /^\/api\/v1\/conversations\/([^/]+)$/u,
      )
      if (request.method === 'GET' && conversationRoute !== undefined) {
        const conversationId = this.#http.parseRouteId(
          ConversationIdSchema,
          conversationRoute[0],
          'conversationId',
        )
        this.#http.writeJson(
          response,
          200,
          GetConversationResponseSchema.parse(
            this.#service.getConversation(conversationId),
          ),
          context.allowedOrigin,
        )
        return
      }

      const turnStart = this.#http.matchPath(
        url.pathname,
        /^\/api\/v1\/conversations\/([^/]+)\/turns$/u,
      )
      if (request.method === 'POST' && turnStart !== undefined) {
        const conversationId = this.#http.parseRouteId(
          ConversationIdSchema,
          turnStart[0],
          'conversationId',
        )
        const body = await this.#http.readValidatedBody(
          request,
          StartTurnRequestSchema,
        )
        context.actionId = body.actionId
        const result = await this.#service.startTurn(conversationId, body)
        this.#http.writeJson(
          response,
          202,
          StartTurnResponseSchema.parse(result),
          context.allowedOrigin,
        )
        return
      }

      const turnInterrupt = this.#http.matchPath(
        url.pathname,
        /^\/api\/v1\/conversations\/([^/]+)\/turns\/([^/]+)\/interrupt$/u,
      )
      if (request.method === 'POST' && turnInterrupt !== undefined) {
        const conversationId = this.#http.parseRouteId(
          ConversationIdSchema,
          turnInterrupt[0],
          'conversationId',
        )
        const turnId = this.#http.parseRouteId(
          TurnIdSchema,
          turnInterrupt[1],
          'turnId',
        )
        const body = await this.#http.readValidatedBody(
          request,
          InterruptTurnRequestSchema,
        )
        context.actionId = body.actionId
        const result = await this.#service.interruptTurn(
          conversationId,
          turnId,
          body,
        )
        this.#http.writeJson(
          response,
          202,
          InterruptTurnResponseSchema.parse(result),
          context.allowedOrigin,
        )
        return
      }

      const approvalResolve = this.#http.matchPath(
        url.pathname,
        /^\/api\/v1\/approvals\/([^/]+)\/resolve$/u,
      )
      if (request.method === 'POST' && approvalResolve !== undefined) {
        const approvalId = this.#http.parseRouteId(
          ApprovalIdSchema,
          approvalResolve[0],
          'approvalId',
        )
        const body = await this.#http.readValidatedBody(
          request,
          ResolveApprovalRequestSchema,
        )
        context.actionId = body.actionId
        const result = await this.#service.resolveApproval(approvalId, body)
        this.#http.writeJson(
          response,
          202,
          ResolveApprovalResponseSchema.parse(result),
          context.allowedOrigin,
        )
        return
      }

      const attentionResolve = this.#http.matchPath(
        url.pathname,
        /^\/api\/v1\/attention\/([^/]+)\/resolve$/u,
      )
      if (request.method === 'POST' && attentionResolve !== undefined) {
        const attentionId = this.#http.parseRouteId(
          AttentionIdSchema,
          attentionResolve[0],
          'attentionId',
        )
        const body = await this.#http.readValidatedBody(
          request,
          ResolveAttentionRequestSchema,
        )
        context.actionId = body.actionId
        const result = await this.#service.resolveAttention(attentionId, body)
        this.#http.writeJson(
          response,
          200,
          ResolveAttentionResponseSchema.parse(result),
          context.allowedOrigin,
        )
        return
      }

      throw new HttpBoundaryError(
        'not_found',
        'API endpoint was not found',
        404,
      )
    } catch (error) {
      if (!response.headersSent) {
        this.#http.writeError(response, error, context)
      } else if (!response.destroyed) {
        response.destroy()
      }
    }
  }

  async #close(): Promise<void> {
    this.#stopHeartbeat?.()
    this.#unsubscribePublisher?.()
    this.#sse.close()
    const failures: unknown[] = []
    if (this.#server.listening) {
      try {
        await new Promise<void>((resolve, reject) => {
          this.#server.close((error) => {
            if (error === undefined) resolve()
            else reject(error)
          })
        })
      } catch (error) {
        failures.push(error)
      }
    }
    try {
      await this.#service.close()
    } catch (error) {
      failures.push(error)
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) {
      throw new AggregateError(failures, 'Local Host shutdown failed')
    }
  }
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

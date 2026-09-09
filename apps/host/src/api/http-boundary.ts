import type { IncomingMessage, ServerResponse } from 'node:http'

import {
  protocolVersion,
  SafeErrorEnvelopeSchema,
  type ActionId,
  type CanonicalFailure,
  type HostError,
  type HostErrorCode,
  type SafeErrorEnvelope,
} from '@codetether/protocol'

import { safeErrorNameForLog } from './safe-log.js'

import { HostServiceError } from './host-service.js'

const DEFAULT_BODY_LIMIT = 64 * 1024
const TAURI_POSIX_ORIGIN = 'tauri://localhost'

interface ParseSchema<T> {
  safeParse(value: unknown):
    | { readonly success: true; readonly data: T }
    | {
        readonly success: false
        readonly error: { readonly issues: readonly unknown[] }
      }
}

export interface HttpRequestContext {
  actionId?: ActionId
  allowedOrigin?: string
}

interface HttpBoundaryOptions {
  readonly allowedOrigins: readonly string[]
  readonly bodyLimitBytes?: number
}

export class HttpBoundaryError extends Error {
  constructor(
    readonly code: HostErrorCode,
    message: string,
    readonly httpStatus: number,
    readonly details?: HostError['details'],
    readonly failure?: CanonicalFailure,
  ) {
    super(message)
    this.name = 'HttpBoundaryError'
  }
}

export class HttpBoundary {
  readonly #allowedOrigins: ReadonlySet<string>
  readonly #bodyLimitBytes: number

  constructor(options: HttpBoundaryOptions) {
    this.#allowedOrigins = new Set(
      options.allowedOrigins.map((origin) => normalizeOrigin(origin)),
    )
    this.#bodyLimitBytes = positiveInteger(
      options.bodyLimitBytes,
      DEFAULT_BODY_LIMIT,
      'bodyLimitBytes',
    )
  }

  authorizeOrigin(request: IncomingMessage): string | undefined {
    const origin = singleHeader(request.headers.origin)
    if (origin === undefined) return undefined
    let normalized: string
    try {
      normalized = normalizeOrigin(origin)
    } catch {
      throw new HttpBoundaryError(
        'invalid_request',
        'Request Origin is invalid',
        403,
      )
    }
    if (!this.#allowedOrigins.has(normalized)) {
      throw new HttpBoundaryError(
        'invalid_request',
        'Request Origin is not allowed',
        403,
      )
    }
    return normalized
  }

  authorizeAuthority(request: IncomingMessage, expectedBaseUrl: string): void {
    const authority = singleHeader(request.headers.host)
    const expectedAuthority = new URL(expectedBaseUrl).host
    if (authority !== expectedAuthority) {
      throw new HttpBoundaryError(
        'invalid_request',
        'Request Host is not the local Host API authority',
        403,
      )
    }
  }

  parseRequestUrl(value: string, base: string): URL {
    try {
      const url = new URL(value, base)
      if (url.origin !== new URL(base).origin) {
        throw new Error('Request URL authority does not match the Host API')
      }
      return url
    } catch {
      throw new HttpBoundaryError(
        'invalid_request',
        'Request URL is invalid',
        400,
      )
    }
  }

  matchPath(path: string, pattern: RegExp): string[] | undefined {
    const match = pattern.exec(path)
    if (match === null) return undefined
    try {
      return match.slice(1).map((part) => decodeURIComponent(part ?? ''))
    } catch {
      throw new HttpBoundaryError(
        'invalid_request',
        'Route contains invalid percent encoding',
        400,
      )
    }
  }

  parseRouteId<T>(
    schema: ParseSchema<T>,
    value: string | undefined,
    name: string,
  ): T {
    const parsed = schema.safeParse(value)
    if (!parsed.success) {
      throw new HttpBoundaryError(
        'invalid_request',
        `Route ${name} is invalid`,
        400,
      )
    }
    return parsed.data
  }

  parseValidatedQuery<T>(
    parameters: URLSearchParams,
    schema: ParseSchema<T>,
  ): T {
    const value: Record<string, string> = {}
    for (const [name, entry] of parameters) {
      if (Object.hasOwn(value, name)) {
        throw new HttpBoundaryError(
          'invalid_request',
          `Query parameter ${name} must not be repeated`,
          400,
        )
      }
      value[name] = entry
    }
    const parsed = schema.safeParse(value)
    if (!parsed.success) {
      throw new HttpBoundaryError(
        'invalid_request',
        'Query parameters do not match Protocol v1',
        400,
        { issueCount: parsed.error.issues.length },
      )
    }
    return parsed.data
  }

  async readValidatedBody<T>(
    request: IncomingMessage,
    schema: ParseSchema<T>,
  ): Promise<T> {
    const contentType = singleHeader(request.headers['content-type'])
    if (
      contentType === undefined ||
      !/^application\/json(?:\s*;|$)/iu.test(contentType)
    ) {
      throw new HttpBoundaryError(
        'invalid_request',
        'Content-Type must be application/json',
        400,
      )
    }
    const declaredLength = Number(request.headers['content-length'])
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > this.#bodyLimitBytes
    ) {
      throw new HttpBoundaryError(
        'invalid_request',
        'Request body exceeds the configured limit',
        413,
      )
    }

    const chunks: Buffer[] = []
    let bytes = 0
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytes += buffer.length
      if (bytes > this.#bodyLimitBytes) {
        throw new HttpBoundaryError(
          'invalid_request',
          'Request body exceeds the configured limit',
          413,
        )
      }
      chunks.push(buffer)
    }
    let value: unknown
    try {
      value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    } catch {
      throw new HttpBoundaryError(
        'invalid_request',
        'Request body is not valid JSON',
        400,
      )
    }
    const parsed = schema.safeParse(value)
    if (!parsed.success) {
      throw new HttpBoundaryError(
        'invalid_request',
        'Request body does not match Protocol v1',
        422,
        { issueCount: parsed.error.issues.length },
      )
    }
    return parsed.data
  }

  writePreflight(response: ServerResponse, allowedOrigin?: string): void {
    response.writeHead(204, {
      ...this.baseHeaders(allowedOrigin),
      'Access-Control-Allow-Headers': 'Content-Type, Last-Event-ID',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Max-Age': '600',
    })
    response.end()
  }

  writeJson(
    response: ServerResponse,
    status: number,
    value: unknown,
    allowedOrigin?: string,
  ): void {
    const body = `${JSON.stringify(value)}\n`
    response.writeHead(status, {
      ...this.baseHeaders(allowedOrigin),
      'Content-Length': Buffer.byteLength(body, 'utf8'),
      'Content-Type': 'application/json; charset=utf-8',
    })
    response.end(body)
  }

  writeError(
    response: ServerResponse,
    error: unknown,
    context: HttpRequestContext,
  ): void {
    const safe = toSafeHttpError(error)
    const candidate = {
      protocolVersion,
      ...(context.actionId === undefined ? {} : { actionId: context.actionId }),
      code: safe.code,
      message: safe.message,
      ...(safe.failure === undefined ? {} : { failure: safe.failure }),
      ...(safe.details === undefined ? {} : { details: safe.details }),
    }
    const parsed = SafeErrorEnvelopeSchema.safeParse(candidate)
    const envelope: SafeErrorEnvelope = parsed.success
      ? parsed.data
      : SafeErrorEnvelopeSchema.parse({
          protocolVersion,
          ...(context.actionId === undefined
            ? {}
            : { actionId: context.actionId }),
          code: 'internal',
          message: 'The Host could not safely present this failure',
        })
    this.writeJson(
      response,
      parsed.success ? safe.httpStatus : 500,
      envelope,
      context.allowedOrigin,
    )
  }

  baseHeaders(allowedOrigin?: string): Record<string, string> {
    return {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(allowedOrigin === undefined
        ? {}
        : {
            'Access-Control-Allow-Origin': allowedOrigin,
            Vary: 'Origin',
          }),
    }
  }
}

export function singleHeader(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    throw new HttpBoundaryError(
      'invalid_request',
      'Repeated request header is not allowed',
      400,
    )
  }
  return value
}

function normalizeOrigin(origin: string): string {
  if (origin === TAURI_POSIX_ORIGIN) return origin

  const url = new URL(origin)
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.origin !== origin ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw new Error('Origin must be an exact HTTP or Tauri origin')
  }
  return url.origin
}

function toSafeHttpError(error: unknown): HttpBoundaryError {
  if (error instanceof HttpBoundaryError) return error
  if (error instanceof HostServiceError) {
    return new HttpBoundaryError(
      error.code,
      error.message,
      error.httpStatus,
      error.details,
      error.failure,
    )
  }
  process.stderr.write(
    `[codetether:http-error] ${safeErrorNameForLog(error)}\n`,
  )
  return new HttpBoundaryError(
    'internal',
    'The Host could not complete the request',
    500,
  )
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

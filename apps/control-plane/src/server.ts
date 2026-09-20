import { createServer, type Server } from 'node:http'
import {
  HumanAuthFailure,
  HumanAuthNotConfiguredError,
  type HumanAuthVerifier,
} from './auth/human-auth-verifier.js'
import type { ControlPlaneDatabase } from './persistence/database.js'
import type { AuthenticatedAccountService } from './services/authenticated-account-service.js'

export interface ControlPlaneServerOptions {
  readonly database: ControlPlaneDatabase
  readonly host: string
  readonly port: number
  readonly humanAuthVerifier?: HumanAuthVerifier
  readonly authenticatedAccountService?: AuthenticatedAccountService
}

export interface RunningControlPlaneServer {
  readonly server: Server
  readonly address: { readonly host: string; readonly port: number }
  close(): Promise<void>
}

function sendJson(
  response: import('node:http').ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
  headOnly: boolean,
): void {
  const encoded = Buffer.from(JSON.stringify(body))
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-length': headOnly ? '0' : String(encoded.byteLength),
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(headOnly ? undefined : encoded)
}

function bearerToken(authorization: string | undefined): string {
  if (!authorization) throw new HumanAuthFailure('missing_authentication')
  if (authorization.length > 16_512) {
    throw new HumanAuthFailure('malformed_token')
  }
  const match = /^Bearer ([^\s]+)$/.exec(authorization)
  if (!match?.[1]) throw new HumanAuthFailure('malformed_token')
  return match[1]
}

function authFailureStatus(error: HumanAuthFailure): number {
  if (error.code === 'auth_verification_unavailable') return 503
  return error.code === 'suspended_user' ? 403 : 401
}

export async function startControlPlaneServer(
  options: ControlPlaneServerOptions,
): Promise<RunningControlPlaneServer> {
  const server = createServer(async (request, response) => {
    const method = request.method ?? ''
    const headOnly = method === 'HEAD'
    if (method !== 'GET' && !headOnly) {
      sendJson(response, 405, { status: 'method_not_allowed' }, false)
      return
    }

    const requestUrl = new URL(request.url ?? '/', 'http://control-plane.local')
    const pathname = requestUrl.pathname
    if (pathname === '/healthz') {
      sendJson(response, 200, { status: 'ok' }, headOnly)
      return
    }

    if (pathname === '/readyz') {
      try {
        await options.database.query('SELECT 1 AS ready')
        sendJson(response, 200, { status: 'ready' }, headOnly)
      } catch {
        sendJson(response, 503, { status: 'unavailable' }, headOnly)
      }
      return
    }

    if (pathname === '/v1/account/me') {
      if (method !== 'GET') {
        sendJson(response, 405, { status: 'method_not_allowed' }, false)
        return
      }
      if (requestUrl.search) {
        sendJson(response, 400, { status: 'invalid_request' }, false)
        return
      }
      if (!options.humanAuthVerifier || !options.authenticatedAccountService) {
        sendJson(response, 503, { status: 'auth_unavailable' }, false)
        return
      }
      try {
        const account =
          await options.authenticatedAccountService.verifyAndResolve(
            options.humanAuthVerifier,
            bearerToken(request.headers.authorization),
          )
        sendJson(
          response,
          200,
          {
            userId: account.userId,
            status: account.status,
            personalSpaceId: account.personalSpaceId,
            deviceAuthentication: 'not_implemented_phase9a4',
          },
          false,
        )
      } catch (error) {
        if (error instanceof HumanAuthFailure) {
          sendJson(
            response,
            authFailureStatus(error),
            { status: 'authentication_failed', code: error.code },
            false,
          )
          return
        }
        if (error instanceof HumanAuthNotConfiguredError) {
          sendJson(response, 503, { status: 'auth_unavailable' }, false)
          return
        }
        sendJson(response, 500, { status: 'internal_error' }, false)
      }
      return
    }

    sendJson(response, 404, { status: 'not_found' }, headOnly)
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = (): void => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(options.port, options.host)
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Control Plane did not bind a TCP address')
  }

  return {
    server,
    address: { host: options.host, port: address.port },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      }),
  }
}

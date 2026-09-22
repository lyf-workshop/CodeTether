import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import {
  HumanAuthFailure,
  HumanAuthNotConfiguredError,
  type HumanAuthVerifier,
} from './auth/human-auth-verifier.js'
import { PRODUCT_DEVICE_PROOF_HEADER } from './auth/product-device-protocol.js'
import type { ControlPlaneDatabase } from './persistence/database.js'
import type { AuthenticatedAccountService } from './services/authenticated-account-service.js'
import {
  ProductDeviceAuthFailure,
  type ProductDeviceAuthenticationService,
} from './services/product-device-authentication-service.js'
import {
  HostIdentityFailure,
  type HostIdentityService,
} from './services/host-identity-service.js'

export interface ControlPlaneServerOptions {
  readonly database: ControlPlaneDatabase
  readonly host: string
  readonly port: number
  readonly humanAuthVerifier?: HumanAuthVerifier
  readonly authenticatedAccountService?: AuthenticatedAccountService
  readonly productDeviceAuthenticationService?: ProductDeviceAuthenticationService
  readonly hostIdentityService?: HostIdentityService
}

export interface RunningControlPlaneServer {
  readonly server: Server
  readonly address: { readonly host: string; readonly port: number }
  close(): Promise<void>
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: object,
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

class InvalidRequestBodyError extends Error {}

async function readBoundedBody(
  request: IncomingMessage,
  maximumBytes: number,
): Promise<Buffer> {
  const contentLength = request.headers['content-length']
  if (contentLength) {
    const parsed = Number(contentLength)
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximumBytes) {
      throw new InvalidRequestBodyError('Request body is outside its bound')
    }
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += bytes.byteLength
    if (total > maximumBytes) {
      throw new InvalidRequestBodyError('Request body is outside its bound')
    }
    chunks.push(bytes)
  }
  return Buffer.concat(chunks, total)
}

function parseJsonObject(body: Buffer): Record<string, unknown> {
  if (body.byteLength === 0) {
    throw new InvalidRequestBodyError('A JSON body is required')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(body.toString('utf8'))
  } catch {
    throw new InvalidRequestBodyError('Malformed JSON body')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new InvalidRequestBodyError('A JSON object is required')
  }
  return parsed as Record<string, unknown>
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

function deviceAuthFailureStatus(error: ProductDeviceAuthFailure): number {
  if (error.code === 'device_auth_unavailable') return 503
  if (
    error.code === 'device_owner_mismatch' ||
    error.code === 'device_revoked' ||
    error.code === 'device_key_generation_stale'
  ) {
    return 403
  }
  if (
    error.code === 'device_proof_replayed' ||
    error.code === 'device_registration_challenge_consumed'
  ) {
    return 409
  }
  if (error.code === 'device_registration_challenge_expired') return 410
  return error.code.startsWith('device_registration_') ? 400 : 401
}

function productDeviceProof(request: IncomingMessage): string | undefined {
  const value = request.headers[PRODUCT_DEVICE_PROOF_HEADER]
  return typeof value === 'string' ? value : undefined
}

function hostIdentityFailureStatus(error: HostIdentityFailure): number {
  if (error.code.endsWith('_expired')) return 410
  if (
    error.code.endsWith('_consumed') ||
    error.code === 'host_already_claimed' ||
    error.code === 'host_claim_unavailable'
  ) {
    return 409
  }
  if (error.code === 'host_space_not_permitted') return 403
  return error.code === 'host_identity_unavailable' ? 503 : 400
}

export async function startControlPlaneServer(
  options: ControlPlaneServerOptions,
): Promise<RunningControlPlaneServer> {
  const server = createServer(async (request, response) => {
    const method = request.method ?? ''
    const headOnly = method === 'HEAD'
    const requestUrl = new URL(request.url ?? '/', 'http://control-plane.local')
    const pathname = requestUrl.pathname
    if (pathname === '/healthz') {
      if (method !== 'GET' && !headOnly) {
        sendJson(response, 405, { status: 'method_not_allowed' }, false)
        return
      }
      sendJson(response, 200, { status: 'ok' }, headOnly)
      return
    }

    if (pathname === '/readyz') {
      if (method !== 'GET' && !headOnly) {
        sendJson(response, 405, { status: 'method_not_allowed' }, false)
        return
      }
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
            deviceAuthentication: 'not_asserted_on_human_account_route',
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

    if (
      pathname === '/v1/devices/registration-challenge' ||
      pathname === '/v1/devices/register'
    ) {
      if (method !== 'POST') {
        sendJson(response, 405, { status: 'method_not_allowed' }, false)
        return
      }
      if (requestUrl.search) {
        sendJson(response, 400, { status: 'invalid_request' }, false)
        return
      }
      if (
        !options.humanAuthVerifier ||
        !options.authenticatedAccountService ||
        !options.productDeviceAuthenticationService
      ) {
        sendJson(response, 503, { status: 'auth_unavailable' }, false)
        return
      }
      try {
        const body = await readBoundedBody(request, 16_384)
        const input = parseJsonObject(body)
        const human =
          await options.authenticatedAccountService.verifyAndResolveRequestContext(
            options.humanAuthVerifier,
            bearerToken(request.headers.authorization),
          )
        if (pathname === '/v1/devices/registration-challenge') {
          const result =
            await options.productDeviceAuthenticationService.createRegistrationChallenge(
              human,
              input,
            )
          sendJson(response, 201, result, false)
        } else {
          const device =
            await options.productDeviceAuthenticationService.registerProductDevice(
              human,
              input,
            )
          sendJson(response, 201, { device }, false)
        }
      } catch (error) {
        if (error instanceof InvalidRequestBodyError) {
          sendJson(response, 400, { status: 'invalid_request' }, false)
          return
        }
        if (error instanceof HumanAuthFailure) {
          sendJson(
            response,
            authFailureStatus(error),
            { status: 'authentication_failed', code: error.code },
            false,
          )
          return
        }
        if (error instanceof ProductDeviceAuthFailure) {
          sendJson(
            response,
            deviceAuthFailureStatus(error),
            { status: 'device_authentication_failed', code: error.code },
            false,
          )
          return
        }
        sendJson(response, 400, { status: 'invalid_request' }, false)
      }
      return
    }

    if (
      pathname === '/v1/hosts/registration-challenge' ||
      pathname === '/v1/hosts/register'
    ) {
      if (method !== 'POST') {
        sendJson(response, 405, { status: 'method_not_allowed' }, false)
        return
      }
      if (requestUrl.search) {
        sendJson(response, 400, { status: 'invalid_request' }, false)
        return
      }
      if (!options.hostIdentityService) {
        sendJson(response, 503, { status: 'host_identity_unavailable' }, false)
        return
      }
      try {
        const input = parseJsonObject(await readBoundedBody(request, 16_384))
        const result =
          pathname === '/v1/hosts/registration-challenge'
            ? await options.hostIdentityService.createRegistrationChallenge(
                input,
              )
            : await options.hostIdentityService.registerHost(input)
        sendJson(response, 201, result, false)
      } catch (error) {
        if (error instanceof InvalidRequestBodyError) {
          sendJson(response, 400, { status: 'invalid_request' }, false)
          return
        }
        if (error instanceof HostIdentityFailure) {
          sendJson(
            response,
            hostIdentityFailureStatus(error),
            { status: 'host_identity_failed', code: error.code },
            false,
          )
          return
        }
        sendJson(response, 400, { status: 'invalid_request' }, false)
      }
      return
    }

    const claimChallengeMatch =
      /^\/v1\/hosts\/(host_[A-Za-z0-9][A-Za-z0-9_-]{15,95})\/claim-challenge$/.exec(
        pathname,
      )
    const claimConfirmMatch =
      /^\/v1\/hosts\/(host_[A-Za-z0-9][A-Za-z0-9_-]{15,95})\/claim-confirm$/.exec(
        pathname,
      )
    const claimStateMatch =
      /^\/v1\/hosts\/(host_[A-Za-z0-9][A-Za-z0-9_-]{15,95})\/claims\/(hclaim_[A-Za-z0-9][A-Za-z0-9_-]{15,95})$/.exec(
        pathname,
      )
    if (claimChallengeMatch || claimConfirmMatch || claimStateMatch) {
      if (
        ((claimChallengeMatch || claimConfirmMatch) && method !== 'POST') ||
        (claimStateMatch && method !== 'GET')
      ) {
        sendJson(response, 405, { status: 'method_not_allowed' }, false)
        return
      }
      if (
        !options.humanAuthVerifier ||
        !options.authenticatedAccountService ||
        !options.productDeviceAuthenticationService ||
        !options.hostIdentityService
      ) {
        sendJson(response, 503, { status: 'auth_unavailable' }, false)
        return
      }
      try {
        const body = await readBoundedBody(request, 16_384)
        const input =
          method === 'POST'
            ? parseJsonObject(body)
            : body.byteLength === 0
              ? undefined
              : (() => {
                  throw new InvalidRequestBodyError(
                    'This route requires an empty body',
                  )
                })()
        const human =
          await options.authenticatedAccountService.verifyAndResolveRequestContext(
            options.humanAuthVerifier,
            bearerToken(request.headers.authorization),
          )
        const device =
          await options.productDeviceAuthenticationService.authenticateProductDeviceRequest(
            human,
            {
              compactProof: productDeviceProof(request),
              method,
              rawResource: request.url ?? pathname,
              body,
            },
          )
        if (claimChallengeMatch?.[1]) {
          const result = await options.hostIdentityService.requestClaim(
            human,
            device,
            input,
          )
          sendJson(response, 201, result, false)
        } else if (claimConfirmMatch?.[1]) {
          const result = await options.hostIdentityService.confirmClaim(
            human,
            device,
            claimConfirmMatch[1],
            input,
          )
          sendJson(response, 200, result, false)
        } else if (claimStateMatch?.[1] && claimStateMatch[2]) {
          const claim = await options.hostIdentityService.readClaim(
            claimStateMatch[2],
          )
          if (!claim || claim.hostId !== claimStateMatch[1]) {
            sendJson(response, 404, { status: 'not_found' }, false)
            return
          }
          sendJson(
            response,
            200,
            {
              claimId: claim.claimId,
              hostId: claim.hostId,
              state: claim.state,
              expiresAt: claim.expiresAt.toISOString(),
              completedAt: claim.completedAt?.toISOString() ?? null,
            },
            false,
          )
        }
      } catch (error) {
        if (error instanceof InvalidRequestBodyError) {
          sendJson(response, 400, { status: 'invalid_request' }, false)
          return
        }
        if (error instanceof HumanAuthFailure) {
          sendJson(
            response,
            authFailureStatus(error),
            { status: 'authentication_failed', code: error.code },
            false,
          )
          return
        }
        if (error instanceof ProductDeviceAuthFailure) {
          sendJson(
            response,
            deviceAuthFailureStatus(error),
            { status: 'device_authentication_failed', code: error.code },
            false,
          )
          return
        }
        if (error instanceof HostIdentityFailure) {
          sendJson(
            response,
            hostIdentityFailureStatus(error),
            { status: 'host_identity_failed', code: error.code },
            false,
          )
          return
        }
        sendJson(response, 400, { status: 'invalid_request' }, false)
      }
      return
    }

    const revokeMatch =
      /^\/v1\/devices\/(dev_[A-Za-z0-9][A-Za-z0-9_-]{15,95})\/revoke$/.exec(
        pathname,
      )
    const deviceBoundRoute = pathname === '/v1/device/me' || revokeMatch
    if (deviceBoundRoute) {
      if (
        (pathname === '/v1/device/me' && method !== 'GET') ||
        (revokeMatch && method !== 'POST')
      ) {
        sendJson(response, 405, { status: 'method_not_allowed' }, false)
        return
      }
      if (
        !options.humanAuthVerifier ||
        !options.authenticatedAccountService ||
        !options.productDeviceAuthenticationService
      ) {
        sendJson(response, 503, { status: 'auth_unavailable' }, false)
        return
      }
      try {
        const body = await readBoundedBody(request, 1_024)
        if (body.byteLength !== 0) {
          throw new InvalidRequestBodyError('This route requires an empty body')
        }
        const human =
          await options.authenticatedAccountService.verifyAndResolveRequestContext(
            options.humanAuthVerifier,
            bearerToken(request.headers.authorization),
          )
        const deviceContext =
          await options.productDeviceAuthenticationService.authenticateProductDeviceRequest(
            human,
            {
              compactProof: productDeviceProof(request),
              method,
              rawResource: request.url ?? pathname,
              body,
            },
          )
        if (revokeMatch?.[1]) {
          await options.productDeviceAuthenticationService.revokeProductDevice(
            deviceContext,
            revokeMatch[1],
          )
          sendJson(response, 200, { status: 'revoked' }, false)
        } else {
          const device =
            await options.productDeviceAuthenticationService.readProductDevice(
              deviceContext.deviceId,
            )
          if (!device) {
            throw new ProductDeviceAuthFailure('device_not_found')
          }
          sendJson(
            response,
            200,
            {
              userId: deviceContext.userId,
              device,
              deviceAuthentication: 'device_bound',
            },
            false,
          )
        }
      } catch (error) {
        if (error instanceof InvalidRequestBodyError) {
          sendJson(response, 400, { status: 'invalid_request' }, false)
          return
        }
        if (error instanceof HumanAuthFailure) {
          sendJson(
            response,
            authFailureStatus(error),
            { status: 'authentication_failed', code: error.code },
            false,
          )
          return
        }
        if (error instanceof ProductDeviceAuthFailure) {
          sendJson(
            response,
            deviceAuthFailureStatus(error),
            { status: 'device_authentication_failed', code: error.code },
            false,
          )
          return
        }
        sendJson(response, 500, { status: 'internal_error' }, false)
      }
      return
    }

    if (method !== 'GET' && !headOnly) {
      sendJson(response, 405, { status: 'method_not_allowed' }, false)
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

import { createHash } from 'node:crypto'
import {
  createRemoteJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  errors,
  jwtVerify,
  type JWTVerifyGetKey,
} from 'jose'
import { z } from 'zod'
import {
  HumanAuthFailure,
  type HumanAuthVerifier,
  type VerifiedHumanAuthContext,
} from './human-auth-verifier.js'

const maxAccessTokenLength = 16_384
const supportedAlgorithms = ['ES256', 'RS256'] as const

const subjectSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value === value.trim())
const emailSchema = z.string().trim().email().max(320)

export interface SupabaseHumanAuthVerifierOptions {
  readonly supabaseUrl: string
  readonly audience?: string
  readonly publishableKey?: string
  readonly fetch?: typeof fetch
  readonly keyResolver?: JWTVerifyGetKey
  readonly jwksTimeoutMilliseconds?: number
  readonly jwksCacheMilliseconds?: number
  readonly jwksCooldownMilliseconds?: number
}

function projectAuthIssuer(supabaseUrl: string): string {
  const url = new URL(supabaseUrl)
  const pathname = url.pathname.replace(/\/+$/, '')
  if (
    pathname !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error('Supabase URL must not include an application path')
  }
  if (
    url.protocol !== 'https:' &&
    url.hostname !== '127.0.0.1' &&
    url.hostname !== 'localhost'
  ) {
    throw new Error('Supabase URL must use HTTPS outside local tests')
  }
  return `${url.origin}/auth/v1`
}

function normalizeVerifiedEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return emailSchema.parse(value.normalize('NFC').toLowerCase())
}

function classifyJoseError(error: unknown): HumanAuthFailure {
  if (error instanceof errors.JWTExpired) {
    return new HumanAuthFailure('expired_token')
  }
  if (error instanceof errors.JWTClaimValidationFailed) {
    if (error.claim === 'iss') return new HumanAuthFailure('wrong_issuer')
    if (error.claim === 'exp' || error.claim === 'nbf') {
      return new HumanAuthFailure('expired_token')
    }
    return new HumanAuthFailure('malformed_token')
  }
  if (
    error instanceof errors.JWSSignatureVerificationFailed ||
    error instanceof errors.JWKSNoMatchingKey
  ) {
    return new HumanAuthFailure('invalid_signature')
  }
  if (
    error instanceof errors.JWKSTimeout ||
    error instanceof errors.JWKSInvalid ||
    error instanceof errors.JWKSMultipleMatchingKeys ||
    error instanceof TypeError
  ) {
    return new HumanAuthFailure('auth_verification_unavailable')
  }
  return new HumanAuthFailure('malformed_token')
}

export class SupabaseHumanAuthVerifier implements HumanAuthVerifier {
  readonly #issuer: string
  readonly #audience: string
  readonly #keyResolver: JWTVerifyGetKey
  readonly #publishableKey: string | undefined
  readonly #fetch: typeof fetch

  public constructor(options: SupabaseHumanAuthVerifierOptions) {
    this.#issuer = projectAuthIssuer(options.supabaseUrl)
    this.#audience = options.audience ?? 'authenticated'
    this.#publishableKey = options.publishableKey
    this.#fetch = options.fetch ?? fetch
    this.#keyResolver =
      options.keyResolver ??
      createRemoteJWKSet(new URL(`${this.#issuer}/.well-known/jwks.json`), {
        timeoutDuration: options.jwksTimeoutMilliseconds ?? 5_000,
        cacheMaxAge: options.jwksCacheMilliseconds ?? 10 * 60_000,
        cooldownDuration: options.jwksCooldownMilliseconds ?? 30_000,
      })
  }

  async #verifyLegacySymmetric(
    accessToken: string,
  ): Promise<VerifiedHumanAuthContext> {
    if (!this.#publishableKey?.startsWith('sb_publishable_')) {
      throw new HumanAuthFailure('unsupported_signing_mode')
    }
    let payload: ReturnType<typeof decodeJwt>
    try {
      payload = decodeJwt(accessToken)
    } catch {
      throw new HumanAuthFailure('malformed_token')
    }
    const now = Math.floor(Date.now() / 1_000)
    if (payload.iss !== this.#issuer) {
      throw new HumanAuthFailure('wrong_issuer')
    }
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
    if (!audiences.includes(this.#audience)) {
      throw new HumanAuthFailure('malformed_token')
    }
    if (typeof payload.exp !== 'number' || payload.exp <= now) {
      throw new HumanAuthFailure('expired_token')
    }
    if (typeof payload.nbf === 'number' && payload.nbf > now) {
      throw new HumanAuthFailure('malformed_token')
    }
    const subject = subjectSchema.parse(payload.sub)

    let response: Response
    try {
      response = await this.#fetch(`${this.#issuer}/user`, {
        method: 'GET',
        headers: {
          apikey: this.#publishableKey,
          authorization: `Bearer ${accessToken}`,
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(5_000),
      })
    } catch {
      throw new HumanAuthFailure('auth_verification_unavailable')
    }
    if (response.status === 401 || response.status === 403) {
      throw new HumanAuthFailure('invalid_signature')
    }
    if (!response.ok) {
      throw new HumanAuthFailure('auth_verification_unavailable')
    }
    const responseBytes = new Uint8Array(await response.arrayBuffer())
    if (responseBytes.byteLength > 65_536) {
      throw new HumanAuthFailure('malformed_token')
    }
    let user: unknown
    try {
      user = JSON.parse(new TextDecoder().decode(responseBytes))
    } catch {
      throw new HumanAuthFailure('malformed_token')
    }
    const userSchema = z.object({
      id: subjectSchema,
      email: emailSchema.optional(),
    })
    const authenticatedUser = userSchema.parse(user)
    if (authenticatedUser.id !== subject) {
      throw new HumanAuthFailure('invalid_signature')
    }

    return {
      issuer: this.#issuer,
      subject,
      externalSessionIdHash: `sha256:${createHash('sha256')
        .update(accessToken)
        .digest('base64url')}`,
      expiresAt: new Date(payload.exp * 1_000),
      verifiedNormalizedEmail: normalizeVerifiedEmail(authenticatedUser.email),
    }
  }

  public async verifyAccessToken(
    accessToken: string,
  ): Promise<VerifiedHumanAuthContext> {
    if (
      accessToken.length === 0 ||
      accessToken.length > maxAccessTokenLength ||
      accessToken.split('.').length !== 3
    ) {
      throw new HumanAuthFailure('malformed_token')
    }

    try {
      const protectedHeader = decodeProtectedHeader(accessToken)
      if (protectedHeader.alg === 'HS256') {
        return await this.#verifyLegacySymmetric(accessToken)
      }
      if (
        typeof protectedHeader.alg !== 'string' ||
        !supportedAlgorithms.includes(
          protectedHeader.alg as (typeof supportedAlgorithms)[number],
        ) ||
        typeof protectedHeader.kid !== 'string' ||
        protectedHeader.kid.length === 0 ||
        protectedHeader.kid.length > 256
      ) {
        throw new HumanAuthFailure('unsupported_signing_mode')
      }

      const { payload } = await jwtVerify(accessToken, this.#keyResolver, {
        algorithms: [...supportedAlgorithms],
        audience: this.#audience,
        issuer: this.#issuer,
        requiredClaims: ['iss', 'sub', 'aud', 'exp'],
      })
      const subject = subjectSchema.parse(payload.sub)
      if (typeof payload.exp !== 'number') {
        throw new HumanAuthFailure('malformed_token')
      }

      return {
        issuer: this.#issuer,
        subject,
        externalSessionIdHash: `sha256:${createHash('sha256')
          .update(accessToken)
          .digest('base64url')}`,
        expiresAt: new Date(payload.exp * 1_000),
        verifiedNormalizedEmail: normalizeVerifiedEmail(payload.email),
      }
    } catch (error) {
      if (error instanceof HumanAuthFailure) throw error
      throw classifyJoseError(error)
    }
  }
}

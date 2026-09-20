/**
 * Provider-neutral boundary for the managed human-auth authority. Verifiers
 * validate external access tokens; the Control Plane never mints or refreshes
 * them.
 */
export interface VerifiedHumanAuthContext {
  readonly issuer: string
  readonly subject: string
  readonly externalSessionIdHash: string
  readonly expiresAt: Date
  readonly verifiedNormalizedEmail: string | null
}

export interface HumanAuthVerifier {
  verifyAccessToken(accessToken: string): Promise<VerifiedHumanAuthContext>
}

export const humanAuthFailureCodes = [
  'missing_authentication',
  'malformed_token',
  'expired_token',
  'invalid_signature',
  'wrong_issuer',
  'unsupported_signing_mode',
  'auth_verification_unavailable',
  'suspended_user',
] as const

export type HumanAuthFailureCode = (typeof humanAuthFailureCodes)[number]

export class HumanAuthFailure extends Error {
  public constructor(public readonly code: HumanAuthFailureCode) {
    super(code)
    this.name = 'HumanAuthFailure'
  }
}

export class HumanAuthNotConfiguredError extends Error {
  public constructor() {
    super('Human authentication is not configured')
    this.name = 'HumanAuthNotConfiguredError'
  }
}

export class UnconfiguredHumanAuthVerifier implements HumanAuthVerifier {
  public async verifyAccessToken(
    accessToken: string,
  ): Promise<VerifiedHumanAuthContext> {
    void accessToken
    throw new HumanAuthNotConfiguredError()
  }
}

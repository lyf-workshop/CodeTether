/**
 * Boundary for the future managed human-auth authority. Implementations verify
 * external access tokens; the Control Plane does not mint or refresh them.
 */
export interface VerifiedHumanAuthContext {
  readonly issuer: string
  readonly subject: string
  readonly externalSessionIdHash: string
  readonly expiresAt: Date
}

export interface HumanAuthVerifier {
  verifyAccessToken(accessToken: string): Promise<VerifiedHumanAuthContext>
}

export class HumanAuthNotConfiguredError extends Error {
  public constructor() {
    super('Human authentication is not configured')
    this.name = 'HumanAuthNotConfiguredError'
  }
}

/** Phase 9A.2 deliberately has no Supabase or other Auth implementation. */
export class UnconfiguredHumanAuthVerifier implements HumanAuthVerifier {
  public async verifyAccessToken(
    accessToken: string,
  ): Promise<VerifiedHumanAuthContext> {
    void accessToken
    throw new HumanAuthNotConfiguredError()
  }
}

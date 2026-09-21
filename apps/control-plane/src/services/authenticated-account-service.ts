import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  HumanAuthFailure,
  type HumanAuthVerifier,
  type VerifiedHumanAuthContext,
} from '../auth/human-auth-verifier.js'
import {
  createLoginIdentityId,
  createSpaceId,
  createUserId,
  type SpaceId,
  type UserId,
} from '../domain/ids.js'
import type { ControlPlaneDatabase } from '../persistence/database.js'
import {
  ControlPlaneRepository,
  type AuthenticatedAccountRecord,
} from '../persistence/control-plane-repository.js'

const verifiedContextSchema = z.object({
  issuer: z.string().url().min(1).max(120),
  subject: z
    .string()
    .min(1)
    .max(256)
    .refine((value) => value === value.trim()),
  externalSessionIdHash: z.string().regex(/^sha256:[A-Za-z0-9_-]{32,128}$/),
  expiresAt: z.date(),
  verifiedNormalizedEmail: z.string().email().max(320).nullable(),
})

export interface AuthenticatedAccount {
  readonly userId: UserId
  readonly status: 'active'
  readonly personalSpaceId: SpaceId
}

export interface AuthenticatedHumanRequestContext extends AuthenticatedAccount {
  readonly authTokenHash: string
}

function advisoryLockParts(issuer: string, subject: string): [number, number] {
  const digest = createHash('sha256')
    .update(issuer)
    .update('\0')
    .update(subject)
    .digest()
  return [digest.readInt32BE(0), digest.readInt32BE(4)]
}

function toActiveAccount(
  record: AuthenticatedAccountRecord,
): AuthenticatedAccount {
  if (record.status !== 'active') {
    throw new HumanAuthFailure('suspended_user')
  }
  return {
    userId: record.userId,
    status: 'active',
    personalSpaceId: record.personalSpaceId,
  }
}

export class AuthenticatedAccountService {
  public constructor(
    private readonly database: ControlPlaneDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async verifyAndResolve(
    verifier: HumanAuthVerifier,
    accessToken: string,
  ): Promise<AuthenticatedAccount> {
    return this.resolveVerifiedHuman(
      await verifier.verifyAccessToken(accessToken),
    )
  }

  public async verifyAndResolveRequestContext(
    verifier: HumanAuthVerifier,
    accessToken: string,
  ): Promise<AuthenticatedHumanRequestContext> {
    const verified = await verifier.verifyAccessToken(accessToken)
    const account = await this.resolveVerifiedHuman(verified)
    return {
      ...account,
      authTokenHash: `sha256:${createHash('sha256')
        .update(accessToken)
        .digest('base64url')}`,
    }
  }

  public async resolveVerifiedHuman(
    untrustedContext: VerifiedHumanAuthContext,
  ): Promise<AuthenticatedAccount> {
    const context = verifiedContextSchema.parse(untrustedContext)
    const now = this.now()
    if (context.expiresAt <= now) {
      throw new HumanAuthFailure('expired_token')
    }

    return this.database.transaction(async (transaction) => {
      const [lockPartOne, lockPartTwo] = advisoryLockParts(
        context.issuer,
        context.subject,
      )
      await transaction.query('SELECT pg_advisory_xact_lock($1, $2)', [
        lockPartOne,
        lockPartTwo,
      ])
      const repository = new ControlPlaneRepository(transaction)
      const existing = await repository.findAuthenticatedAccountByLoginIdentity(
        context.issuer,
        context.subject,
      )
      if (existing) {
        const account = toActiveAccount(existing)
        await repository.touchLoginIdentity(
          existing.loginIdentityId,
          context.verifiedNormalizedEmail,
          now,
        )
        return account
      }

      const userId = createUserId()
      const personalSpaceId = createSpaceId()
      await repository.createUserWithPersonalSpaceRecords({
        userId,
        status: 'active',
        displayName: null,
        spaceId: personalSpaceId,
        spaceName: 'Personal',
        now,
      })
      await repository.createLoginIdentity({
        loginIdentityId: createLoginIdentityId(),
        userId,
        issuer: context.issuer,
        subject: context.subject,
        verifiedNormalizedEmail: context.verifiedNormalizedEmail,
        now,
      })
      return { userId, status: 'active', personalSpaceId }
    })
  }
}

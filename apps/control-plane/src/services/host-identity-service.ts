import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import {
  HOST_AUDIENCE,
  HOST_KEY_ALGORITHM,
  HOST_PROOF_VERSION,
  HOST_PROTOCOL_VERSION,
  admitHostPublicJwk,
  hostClaimConfirmationPayloadSchema,
  hostDeviceAuthorizationPayloadSchema,
  hostRegistrationChallengePayloadSchema,
  verifyHostClaimConfirmationProof,
  verifyHostDeviceAuthorizationProof,
  verifyHostRegistrationProof,
  type HostClaimConfirmationPayload,
  type HostDeviceAuthorizationPayload,
  type HostRegistrationChallengePayload,
} from '../auth/host-identity-protocol.js'
import { sha256Digest } from '../auth/product-device-protocol.js'
import {
  createEnrollmentChallengeId,
  createHostClaimId,
  createSecurityEventId,
  hostAuthorizationIdSchema,
  hostClaimIdSchema,
  hostIdSchema,
  spaceIdSchema,
} from '../domain/ids.js'
import {
  fingerprintSchema,
  type AppendSecurityEvent,
} from '../domain/models.js'
import { ControlPlaneRepository } from '../persistence/control-plane-repository.js'
import type { ControlPlaneDatabase } from '../persistence/database.js'
import {
  HostIdentityRepository,
  type HostClaimRecord,
  type HostDeviceAuthorizationChallengeRecord,
  type HostDeviceAuthorizationRecord,
  type HostRegistrationChallengeRecord,
} from '../persistence/host-identity-repository.js'
import { ProductDeviceRepository } from '../persistence/product-device-repository.js'
import type { AuthenticatedHumanRequestContext } from './authenticated-account-service.js'
import type { AuthenticatedProductDeviceContext } from './product-device-authentication-service.js'

const registrationCandidateSchema = z
  .object({
    hostId: hostIdSchema,
    publicKey: z.unknown(),
    keyAlgorithm: z.literal(HOST_KEY_ALGORITHM),
    safeLabel: z.string().trim().min(1).max(120),
    coarsePlatform: z.enum(['windows', 'macos', 'linux', 'unknown']),
    protocolVersionMin: z.literal(HOST_PROTOCOL_VERSION),
    protocolVersionMax: z.literal(HOST_PROTOCOL_VERSION),
  })
  .strict()
const registrationCompletionSchema = z
  .object({
    challenge: hostRegistrationChallengePayloadSchema,
    proof: z.string().min(1).max(8192),
  })
  .strict()
const claimRequestSchema = z
  .object({
    hostId: hostIdSchema,
    hostFingerprint: fingerprintSchema,
    spaceId: spaceIdSchema,
  })
  .strict()
const claimCompletionSchema = z
  .object({
    payload: hostClaimConfirmationPayloadSchema,
    proof: z.string().min(1).max(8192),
  })
  .strict()
const claimExpirationSchema = z
  .object({
    spaceId: spaceIdSchema,
    hostFingerprint: fingerprintSchema,
    claimGeneration: z.number().int().nonnegative(),
  })
  .strict()
const authorizationRequestSchema = z
  .object({
    spaceId: spaceIdSchema,
    hostFingerprint: fingerprintSchema,
    hostIdentityGeneration: z.number().int().positive(),
  })
  .strict()
const authorizationCompletionSchema = z
  .object({
    payload: hostDeviceAuthorizationPayloadSchema,
    proof: z.string().min(1).max(8192),
  })
  .strict()
const authorizationRevocationSchema = z
  .object({ authorizationId: hostAuthorizationIdSchema })
  .strict()
const CHALLENGE_LIFETIME_MS = 5 * 60 * 1000
const AUTHORIZATION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000

function sameSecond(date: Date, value: number): boolean {
  return Math.floor(date.getTime() / 1000) === value
}
function event(
  input: Omit<AppendSecurityEvent, 'eventId'>,
): AppendSecurityEvent {
  return { eventId: createSecurityEventId(), ...input }
}
function registrationMatches(
  record: HostRegistrationChallengeRecord,
  payload: HostRegistrationChallengePayload,
): boolean {
  return (
    record.challengeId === payload.challengeId &&
    record.hostId === payload.hostId &&
    record.fingerprint === payload.publicKeyFingerprint &&
    record.safeLabel === payload.safeLabel &&
    record.coarsePlatform === payload.coarsePlatform &&
    record.protocolVersionMin === payload.protocolVersionMin &&
    record.protocolVersionMax === payload.protocolVersionMax &&
    record.nonceHash === sha256Digest(payload.nonce) &&
    sameSecond(record.createdAt, payload.iat) &&
    sameSecond(record.expiresAt, payload.exp)
  )
}
function claimMatches(
  record: HostClaimRecord,
  fingerprint: string,
  payload: HostClaimConfirmationPayload,
): boolean {
  return (
    payload.claimId === record.claimId &&
    payload.challengeId === record.challengeId &&
    payload.hostId === record.hostId &&
    payload.hostFingerprint === fingerprint &&
    payload.claimGeneration === record.claimGeneration &&
    payload.spaceId === record.spaceId &&
    payload.userId === record.requestingUserId &&
    payload.deviceId === record.requestingDeviceId &&
    sha256Digest(payload.nonce) === record.nonceHash &&
    sameSecond(record.expiresAt, payload.exp) &&
    payload.iat >= Math.floor(record.requestedAt.getTime() / 1000)
  )
}

function authorizationIdForChallenge(
  challengeId: HostDeviceAuthorizationChallengeRecord['challengeId'],
) {
  return hostAuthorizationIdSchema.parse(
    `hauth_${challengeId.slice('enroll_'.length)}`,
  )
}

function authorizationChallengeMatches(
  challenge: HostDeviceAuthorizationChallengeRecord,
  payload: HostDeviceAuthorizationPayload,
): boolean {
  return (
    payload.authorizationId ===
      authorizationIdForChallenge(challenge.challengeId) &&
    payload.challengeId === challenge.challengeId &&
    payload.hostId === challenge.hostId &&
    payload.spaceId === challenge.spaceId &&
    payload.userId === challenge.userId &&
    payload.deviceId === challenge.deviceId &&
    sha256Digest(payload.nonce) === challenge.nonceHash &&
    sameSecond(challenge.createdAt, payload.iat) &&
    sameSecond(challenge.expiresAt, payload.exp) &&
    payload.authorizationExpiresAt ===
      Math.floor(
        (challenge.createdAt.getTime() + AUTHORIZATION_LIFETIME_MS) / 1000,
      )
  )
}

function authorizationMatchesPayload(
  authorization: HostDeviceAuthorizationRecord,
  payload: HostDeviceAuthorizationPayload,
): boolean {
  return (
    authorization.authorizationId === payload.authorizationId &&
    authorization.hostId === payload.hostId &&
    authorization.hostIdentityGeneration === payload.hostIdentityGeneration &&
    authorization.deviceId === payload.deviceId &&
    authorization.deviceKeyGeneration === payload.deviceKeyGeneration &&
    authorization.deviceFingerprint === payload.deviceFingerprint &&
    authorization.userId === payload.userId &&
    authorization.spaceId === payload.spaceId &&
    authorization.scope === payload.scope &&
    sameSecond(authorization.issuedAt, payload.iat) &&
    sameSecond(authorization.expiresAt, payload.authorizationExpiresAt)
  )
}

function publicAuthorization(authorization: HostDeviceAuthorizationRecord) {
  return {
    authorizationId: authorization.authorizationId,
    hostId: authorization.hostId,
    deviceId: authorization.deviceId,
    userId: authorization.userId,
    spaceId: authorization.spaceId,
    hostIdentityGeneration: authorization.hostIdentityGeneration,
    deviceKeyGeneration: authorization.deviceKeyGeneration,
    scope: authorization.scope,
    state:
      authorization.revokedAt === null
        ? ('authorized' as const)
        : ('revoked' as const),
    issuedAt: authorization.issuedAt.toISOString(),
    expiresAt: authorization.expiresAt.toISOString(),
    revokedAt: authorization.revokedAt?.toISOString() ?? null,
  }
}

export class HostIdentityFailure extends Error {
  public constructor(public readonly code: string) {
    super('Host identity operation failed')
    this.name = 'HostIdentityFailure'
  }
}

export class HostIdentityService {
  public constructor(
    private readonly database: ControlPlaneDatabase,
    private readonly now: () => Date = () => new Date(),
    private readonly random: (size: number) => Buffer = randomBytes,
  ) {}

  public async createRegistrationChallenge(untrusted: unknown) {
    const input = registrationCandidateSchema.parse(untrusted)
    let admitted
    try {
      admitted = await admitHostPublicJwk(input.publicKey)
    } catch {
      throw new HostIdentityFailure('host_key_invalid')
    }
    const createdAt = this.now()
    const expiresAt = new Date(createdAt.getTime() + CHALLENGE_LIFETIME_MS)
    const nonce = this.random(32).toString('base64url')
    const challenge = hostRegistrationChallengePayloadSchema.parse({
      v: HOST_PROOF_VERSION,
      aud: HOST_AUDIENCE,
      purpose: 'host_registration',
      challengeId: createEnrollmentChallengeId(),
      hostId: input.hostId,
      publicKeyFingerprint: admitted.fingerprint,
      keyAlgorithm: HOST_KEY_ALGORITHM,
      safeLabel: input.safeLabel,
      coarsePlatform: input.coarsePlatform,
      protocolVersionMin: input.protocolVersionMin,
      protocolVersionMax: input.protocolVersionMax,
      nonce,
      iat: Math.floor(createdAt.getTime() / 1000),
      exp: Math.floor(expiresAt.getTime() / 1000),
    })
    await new HostIdentityRepository(this.database).createRegistrationChallenge(
      {
        challengeId: challenge.challengeId,
        hostId: challenge.hostId,
        publicKey: admitted.canonicalPublicJwk,
        keyAlgorithm: HOST_KEY_ALGORITHM,
        fingerprint: admitted.fingerprint,
        safeLabel: input.safeLabel,
        coarsePlatform: input.coarsePlatform,
        protocolVersionMin: input.protocolVersionMin,
        protocolVersionMax: input.protocolVersionMax,
        nonceHash: sha256Digest(nonce),
        createdAt,
        expiresAt,
      },
    )
    return { challenge, publicKeyFingerprint: admitted.fingerprint }
  }

  public async registerHost(untrusted: unknown) {
    const input = registrationCompletionSchema.parse(untrusted)
    const repository = new HostIdentityRepository(this.database)
    const challenge = await repository.findRegistrationChallenge(
      input.challenge.challengeId,
    )
    const now = this.now()
    if (!challenge || !registrationMatches(challenge, input.challenge))
      throw new HostIdentityFailure('host_registration_challenge_invalid')
    if (challenge.consumedAt)
      throw new HostIdentityFailure('host_registration_challenge_consumed')
    if (challenge.expiresAt <= now)
      throw new HostIdentityFailure('host_registration_challenge_expired')
    try {
      const admitted = await admitHostPublicJwk(JSON.parse(challenge.publicKey))
      if (
        admitted.canonicalPublicJwk !== challenge.publicKey ||
        admitted.fingerprint !== challenge.fingerprint
      )
        throw new Error('identity mismatch')
      await verifyHostRegistrationProof(
        input.proof,
        admitted.publicJwk,
        input.challenge,
      )
    } catch {
      throw new HostIdentityFailure('host_signature_invalid')
    }
    const registered = await this.database.transaction(async (transaction) => {
      const tx = new HostIdentityRepository(transaction)
      const current = await tx.findRegistrationChallenge(challenge.challengeId)
      if (
        !current ||
        current.consumedAt ||
        current.expiresAt <= now ||
        !registrationMatches(current, input.challenge)
      )
        return false
      if (!(await tx.registerHostFromChallenge(current, now))) {
        throw new HostIdentityFailure('host_registration_challenge_consumed')
      }
      await new ControlPlaneRepository(transaction).appendSecurityEvent(
        event({
          eventType: 'host_identity_registered',
          actorKind: 'host',
          actorId: current.hostId,
          targetKind: 'host',
          targetId: current.hostId,
          outcome: 'success',
          reasonCode: null,
          correlationId: current.challengeId,
          occurredAt: now,
        }),
      )
      return true
    })
    if (!registered)
      throw new HostIdentityFailure('host_registration_challenge_consumed')
    return {
      hostId: challenge.hostId,
      fingerprint: challenge.fingerprint,
      identityGeneration: 1,
      claimState: 'unclaimed' as const,
    }
  }

  public async requestClaim(
    human: AuthenticatedHumanRequestContext,
    device: AuthenticatedProductDeviceContext,
    untrusted: unknown,
  ) {
    const input = claimRequestSchema.parse(untrusted)
    if (
      input.spaceId !== human.personalSpaceId ||
      device.userId !== human.userId
    )
      throw new HostIdentityFailure('host_space_not_permitted')
    const repository = new HostIdentityRepository(this.database)
    const host = await repository.findHost(input.hostId)
    if (
      !host ||
      host.fingerprint !== input.hostFingerprint ||
      host.claimState !== 'unclaimed' ||
      host.owningSpaceId !== null ||
      host.revokedAt
    )
      throw new HostIdentityFailure(
        host?.owningSpaceId ? 'host_already_claimed' : 'host_identity_mismatch',
      )
    const requestedAt = this.now()
    const expiresAt = new Date(requestedAt.getTime() + CHALLENGE_LIFETIME_MS)
    const nonce = this.random(32).toString('base64url')
    const claimId = createHostClaimId()
    const challengeId = createEnrollmentChallengeId()
    const created = await this.database.transaction(async (transaction) => {
      const tx = new HostIdentityRepository(transaction)
      if (
        !(await tx.createClaim({
          claimId,
          hostId: host.hostId,
          spaceId: human.personalSpaceId,
          userId: human.userId,
          deviceId: device.deviceId,
          claimGeneration: host.claimGeneration,
          challengeId,
          nonceHash: sha256Digest(nonce),
          requestedAt,
          expiresAt,
          proofVersion: HOST_PROOF_VERSION,
          audience: HOST_AUDIENCE,
        }))
      )
        throw new HostIdentityFailure('host_claim_unavailable')
      await new ControlPlaneRepository(transaction).appendSecurityEvent(
        event({
          eventType: 'host_claim_requested',
          actorKind: 'device',
          actorId: device.deviceId,
          targetKind: 'host',
          targetId: host.hostId,
          outcome: 'success',
          reasonCode: null,
          correlationId: claimId,
          occurredAt: requestedAt,
        }),
      )
      return true
    })
    if (!created) throw new HostIdentityFailure('host_claim_unavailable')
    return {
      claimId,
      challengeId,
      hostId: host.hostId,
      hostFingerprint: host.fingerprint,
      claimGeneration: host.claimGeneration,
      spaceId: human.personalSpaceId,
      userId: human.userId,
      deviceId: device.deviceId,
      nonce,
      issuedAt: Math.floor(requestedAt.getTime() / 1000),
      expiresAt: Math.floor(expiresAt.getTime() / 1000),
      audience: HOST_AUDIENCE,
      proofVersion: HOST_PROOF_VERSION,
    }
  }

  public async confirmClaim(
    human: AuthenticatedHumanRequestContext,
    device: AuthenticatedProductDeviceContext,
    untrustedHostId: string,
    untrusted: unknown,
  ) {
    const hostId = hostIdSchema.parse(untrustedHostId)
    const input = claimCompletionSchema.parse(untrusted)
    const repository = new HostIdentityRepository(this.database)
    const claim = await repository.findClaim(input.payload.claimId)
    const now = this.now()
    if (
      !claim ||
      claim.hostId !== hostId ||
      claim.requestingUserId !== human.userId ||
      claim.requestingDeviceId !== device.deviceId ||
      device.userId !== human.userId
    )
      throw new HostIdentityFailure('host_claim_invalid')
    if (claim.state !== 'requested')
      throw new HostIdentityFailure('host_claim_consumed')
    if (claim.expiresAt <= now) {
      throw new HostIdentityFailure('host_claim_expired')
    }
    const host = await repository.findHost(hostId)
    if (
      !host ||
      host.claimState !== 'pending' ||
      host.owningSpaceId !== null ||
      host.claimGeneration !== claim.claimGeneration ||
      !claimMatches(claim, host.fingerprint, input.payload)
    )
      throw new HostIdentityFailure('host_claim_payload_mismatch')
    try {
      const admitted = await admitHostPublicJwk(JSON.parse(host.publicKey))
      if (
        admitted.canonicalPublicJwk !== host.publicKey ||
        admitted.fingerprint !== host.fingerprint
      )
        throw new Error('identity mismatch')
      await verifyHostClaimConfirmationProof(
        input.proof,
        admitted.publicJwk,
        input.payload,
      )
    } catch {
      throw new HostIdentityFailure('host_signature_invalid')
    }
    const completed = await this.database.transaction(async (transaction) => {
      const tx = new HostIdentityRepository(transaction)
      const current = await tx.findClaim(claim.claimId)
      if (
        !current ||
        current.state !== 'requested' ||
        current.expiresAt <= now ||
        !claimMatches(current, host.fingerprint, input.payload)
      )
        return false
      if (!(await tx.completeClaim(current, now))) {
        throw new HostIdentityFailure('host_claim_unavailable')
      }
      const events = new ControlPlaneRepository(transaction)
      await events.appendSecurityEvent(
        event({
          eventType: 'host_claim_confirmed',
          actorKind: 'host',
          actorId: host.hostId,
          targetKind: 'host',
          targetId: host.hostId,
          outcome: 'success',
          reasonCode: null,
          correlationId: current.claimId,
          occurredAt: now,
        }),
      )
      await events.appendSecurityEvent(
        event({
          eventType: 'host_claim_completed',
          actorKind: 'control_plane',
          actorId: 'control-plane',
          targetKind: 'space',
          targetId: current.spaceId,
          outcome: 'success',
          reasonCode: null,
          correlationId: current.claimId,
          occurredAt: now,
        }),
      )
      return true
    })
    if (!completed) throw new HostIdentityFailure('host_claim_consumed')
    return {
      claimId: claim.claimId,
      hostId: host.hostId,
      ownerSpaceId: claim.spaceId,
      state: 'completed' as const,
    }
  }

  public async expireExactHostClaim(
    human: AuthenticatedHumanRequestContext,
    device: AuthenticatedProductDeviceContext,
    untrustedHostId: string,
    untrustedClaimId: string,
    untrusted: unknown,
  ) {
    const hostId = hostIdSchema.parse(untrustedHostId)
    const claimId = hostClaimIdSchema.parse(untrustedClaimId)
    const input = claimExpirationSchema.parse(untrusted)
    if (
      input.spaceId !== human.personalSpaceId ||
      device.userId !== human.userId
    ) {
      throw new HostIdentityFailure('host_space_not_permitted')
    }

    return this.database.transaction(async (transaction) => {
      const repository = new HostIdentityRepository(transaction)
      const host = await repository.findHostForUpdate(hostId)
      if (!host) throw new HostIdentityFailure('host_claim_identity_mismatch')

      const claim = await repository.findClaimForUpdate(claimId)
      if (!claim) throw new HostIdentityFailure('host_claim_not_found')

      const currentDevice = await new ProductDeviceRepository(
        transaction,
      ).findProductDeviceForUpdate(device.deviceId)
      if (
        !currentDevice ||
        currentDevice.ownerUserId !== human.userId ||
        currentDevice.revokedAt ||
        currentDevice.keyGeneration !== device.keyGeneration
      ) {
        throw new HostIdentityFailure('host_claim_device_unavailable')
      }
      if (
        claim.requestingUserId !== human.userId ||
        claim.requestingDeviceId !== device.deviceId ||
        claim.spaceId !== input.spaceId
      ) {
        throw new HostIdentityFailure('host_claim_requester_mismatch')
      }
      if (!(await repository.userCanOwnSpace(input.spaceId, human.userId))) {
        throw new HostIdentityFailure('host_space_not_permitted')
      }
      if (
        claim.hostId !== hostId ||
        claim.claimGeneration !== input.claimGeneration ||
        claim.challengePurpose !== 'host_claim' ||
        claim.challengeTargetHostId !== hostId ||
        claim.challengeTargetSpaceId !== input.spaceId ||
        claim.challengeTargetUserId !== human.userId ||
        claim.challengeTargetDeviceId !== device.deviceId ||
        claim.challengeExpiresAt.getTime() !== claim.expiresAt.getTime() ||
        host.claimGeneration !== input.claimGeneration ||
        host.fingerprint !== input.hostFingerprint ||
        host.revokedAt
      ) {
        throw new HostIdentityFailure('host_claim_identity_mismatch')
      }
      if (claim.challengeConsumedAt !== null) {
        throw new HostIdentityFailure('host_claim_state_conflict')
      }

      const activeReservationClaimIds =
        await repository.findActiveReservationClaimIds(
          hostId,
          input.claimGeneration,
        )
      const expirationEvents =
        await repository.findClaimExpirationEvents(claimId)
      const serverTime = await repository.readServerTime()
      const expiredByServerTime =
        serverTime > claim.expiresAt && serverTime > claim.challengeExpiresAt

      if (claim.state === 'expired') {
        if (
          !expiredByServerTime ||
          host.owningSpaceId !== null ||
          host.claimState !== 'unclaimed' ||
          claim.confirmedAt !== null ||
          claim.completedAt !== null ||
          claim.revokedAt !== null ||
          activeReservationClaimIds.length !== 0 ||
          expirationEvents.length !== 1 ||
          expirationEvents[0]?.actorKind !== 'device' ||
          expirationEvents[0].actorId !== device.deviceId ||
          expirationEvents[0].targetKind !== 'host' ||
          expirationEvents[0].targetId !== hostId ||
          expirationEvents[0].outcome !== 'success' ||
          expirationEvents[0].reasonCode !== null
        ) {
          throw new HostIdentityFailure('host_claim_state_conflict')
        }
        return {
          result: 'already_expired' as const,
          claimId,
          hostId,
          state: 'expired' as const,
          hostState: 'unclaimed' as const,
          ownerSpaceId: null,
        }
      }
      if (claim.state === 'confirmed' || claim.confirmedAt !== null) {
        throw new HostIdentityFailure(
          'host_claim_confirmation_recovery_required',
        )
      }
      if (
        claim.state !== 'requested' ||
        claim.completedAt !== null ||
        claim.revokedAt !== null ||
        host.owningSpaceId !== null ||
        host.claimState !== 'pending' ||
        activeReservationClaimIds.length !== 1 ||
        activeReservationClaimIds[0] !== claimId ||
        expirationEvents.length !== 0
      ) {
        throw new HostIdentityFailure('host_claim_state_conflict')
      }
      if (!expiredByServerTime) {
        throw new HostIdentityFailure('host_claim_not_expired')
      }

      if (
        !(await repository.expireRequestedClaim({
          claimId,
          hostId,
          spaceId: input.spaceId,
          requestingUserId: human.userId,
          requestingDeviceId: device.deviceId,
          claimGeneration: input.claimGeneration,
          serverTime,
        })) ||
        !(await repository.releasePendingHostReservation({
          hostId,
          fingerprint: input.hostFingerprint,
          claimGeneration: input.claimGeneration,
          serverTime,
        }))
      ) {
        throw new HostIdentityFailure('host_claim_state_conflict')
      }

      await new ControlPlaneRepository(transaction).appendSecurityEvent(
        event({
          eventType: 'host_claim_expired',
          actorKind: 'device',
          actorId: device.deviceId,
          targetKind: 'host',
          targetId: hostId,
          outcome: 'success',
          reasonCode: null,
          correlationId: claimId,
          occurredAt: serverTime,
        }),
      )
      return {
        result: 'expired' as const,
        claimId,
        hostId,
        state: 'expired' as const,
        hostState: 'unclaimed' as const,
        ownerSpaceId: null,
      }
    })
  }

  public async requestDeviceAuthorization(
    human: AuthenticatedHumanRequestContext,
    device: AuthenticatedProductDeviceContext,
    untrustedHostId: string,
    untrusted: unknown,
  ) {
    const hostId = hostIdSchema.parse(untrustedHostId)
    const input = authorizationRequestSchema.parse(untrusted)
    if (
      human.status !== 'active' ||
      human.personalSpaceId !== input.spaceId ||
      device.userId !== human.userId
    ) {
      throw new HostIdentityFailure('host_device_authorization_owner_mismatch')
    }

    const createdAt = this.now()
    const result = await this.database.transaction(async (transaction) => {
      const repository = new HostIdentityRepository(transaction)
      const host = await repository.findHostForUpdate(hostId)
      const currentDevice = await new ProductDeviceRepository(
        transaction,
      ).findProductDeviceForUpdate(device.deviceId)
      if (
        !currentDevice ||
        currentDevice.ownerUserId !== human.userId ||
        currentDevice.keyGeneration !== device.keyGeneration ||
        currentDevice.revokedAt
      ) {
        throw new HostIdentityFailure(
          'host_device_authorization_device_unavailable',
        )
      }
      if (
        !host ||
        host.owningSpaceId !== input.spaceId ||
        host.claimState !== 'claimed' ||
        host.fingerprint !== input.hostFingerprint ||
        host.claimGeneration !== input.hostIdentityGeneration ||
        host.revokedAt
      ) {
        throw new HostIdentityFailure('host_device_authorization_host_mismatch')
      }
      if (!(await repository.userCanOwnSpace(input.spaceId, human.userId))) {
        throw new HostIdentityFailure(
          'host_device_authorization_owner_mismatch',
        )
      }
      const existing = await repository.findEffectiveDeviceAuthorization(
        hostId,
        device.deviceId,
        human.userId,
        input.spaceId,
        createdAt,
      )
      if (existing) {
        return {
          status: 'authorized' as const,
          authorization: publicAuthorization(existing),
        }
      }

      const challengeId = createEnrollmentChallengeId()
      const nonce = this.random(32).toString('base64url')
      const expiresAt = new Date(createdAt.getTime() + CHALLENGE_LIFETIME_MS)
      const authorizationExpiresAt = new Date(
        createdAt.getTime() + AUTHORIZATION_LIFETIME_MS,
      )
      const payload = hostDeviceAuthorizationPayloadSchema.parse({
        v: HOST_PROOF_VERSION,
        aud: HOST_AUDIENCE,
        purpose: 'host_device_authorization',
        authorizationId: authorizationIdForChallenge(challengeId),
        challengeId,
        hostId,
        hostFingerprint: host.fingerprint,
        hostIdentityGeneration: host.claimGeneration,
        spaceId: input.spaceId,
        userId: human.userId,
        deviceId: currentDevice.deviceId,
        deviceKeyGeneration: currentDevice.keyGeneration,
        deviceFingerprint: currentDevice.fingerprint,
        scope: 'supervisor_read',
        nonce,
        iat: Math.floor(createdAt.getTime() / 1000),
        exp: Math.floor(expiresAt.getTime() / 1000),
        authorizationExpiresAt: Math.floor(
          authorizationExpiresAt.getTime() / 1000,
        ),
      })
      await repository.createDeviceAuthorizationChallenge({
        challengeId,
        userId: human.userId,
        spaceId: input.spaceId,
        deviceId: currentDevice.deviceId,
        hostId,
        nonceHash: sha256Digest(nonce),
        createdAt,
        expiresAt,
      })
      return {
        status: 'confirmation_required' as const,
        authorization: null,
        payload,
      }
    })
    return result
  }

  public async confirmDeviceAuthorization(
    human: AuthenticatedHumanRequestContext,
    device: AuthenticatedProductDeviceContext,
    untrustedHostId: string,
    untrusted: unknown,
  ) {
    const hostId = hostIdSchema.parse(untrustedHostId)
    const input = authorizationCompletionSchema.parse(untrusted)
    const payload = input.payload
    if (
      human.status !== 'active' ||
      payload.hostId !== hostId ||
      payload.userId !== human.userId ||
      payload.spaceId !== human.personalSpaceId ||
      payload.deviceId !== device.deviceId ||
      payload.deviceKeyGeneration !== device.keyGeneration ||
      device.userId !== human.userId
    ) {
      throw new HostIdentityFailure('host_device_authorization_owner_mismatch')
    }

    const repository = new HostIdentityRepository(this.database)
    const challenge = await repository.findDeviceAuthorizationChallenge(
      payload.challengeId,
    )
    const host = await repository.findHost(hostId)
    if (
      !challenge ||
      !host ||
      !authorizationChallengeMatches(challenge, payload) ||
      host.fingerprint !== payload.hostFingerprint ||
      host.claimGeneration !== payload.hostIdentityGeneration
    ) {
      throw new HostIdentityFailure('host_device_authorization_request_invalid')
    }
    try {
      const admitted = await admitHostPublicJwk(JSON.parse(host.publicKey))
      if (
        admitted.canonicalPublicJwk !== host.publicKey ||
        admitted.fingerprint !== host.fingerprint
      ) {
        throw new Error('identity mismatch')
      }
      await verifyHostDeviceAuthorizationProof(
        input.proof,
        admitted.publicJwk,
        payload,
      )
    } catch {
      throw new HostIdentityFailure(
        'host_device_authorization_signature_invalid',
      )
    }

    const now = this.now()
    return this.database.transaction(async (transaction) => {
      const tx = new HostIdentityRepository(transaction)
      const currentHost = await tx.findHostForUpdate(hostId)
      const currentChallenge = await tx.findDeviceAuthorizationChallenge(
        payload.challengeId,
        true,
      )
      const currentDevice = await new ProductDeviceRepository(
        transaction,
      ).findProductDeviceForUpdate(device.deviceId)
      if (
        !currentHost ||
        currentHost.owningSpaceId !== payload.spaceId ||
        currentHost.claimState !== 'claimed' ||
        currentHost.fingerprint !== payload.hostFingerprint ||
        currentHost.claimGeneration !== payload.hostIdentityGeneration ||
        currentHost.revokedAt
      ) {
        throw new HostIdentityFailure('host_device_authorization_host_mismatch')
      }
      if (
        !currentDevice ||
        currentDevice.ownerUserId !== human.userId ||
        currentDevice.keyGeneration !== payload.deviceKeyGeneration ||
        currentDevice.fingerprint !== payload.deviceFingerprint ||
        currentDevice.revokedAt
      ) {
        throw new HostIdentityFailure(
          'host_device_authorization_device_unavailable',
        )
      }
      if (
        !currentChallenge ||
        !authorizationChallengeMatches(currentChallenge, payload)
      ) {
        throw new HostIdentityFailure(
          'host_device_authorization_request_invalid',
        )
      }
      if (
        !(await tx.userCanOwnSpace(payload.spaceId, human.userId)) ||
        new Date(payload.authorizationExpiresAt * 1000) <= now
      ) {
        throw new HostIdentityFailure(
          'host_device_authorization_owner_mismatch',
        )
      }

      const exact = await tx.findDeviceAuthorization(payload.authorizationId)
      if (currentChallenge.consumedAt) {
        if (
          exact &&
          exact.revokedAt === null &&
          exact.expiresAt > now &&
          authorizationMatchesPayload(exact, payload)
        ) {
          return {
            result: 'already_authorized' as const,
            authorization: publicAuthorization(exact),
          }
        }
        throw new HostIdentityFailure(
          'host_device_authorization_request_consumed',
        )
      }
      if (currentChallenge.expiresAt <= now) {
        throw new HostIdentityFailure(
          'host_device_authorization_request_expired',
        )
      }

      const existing = await tx.findEffectiveDeviceAuthorization(
        hostId,
        device.deviceId,
        human.userId,
        payload.spaceId,
        now,
      )
      if (
        !(await tx.consumeDeviceAuthorizationChallenge(
          currentChallenge.challengeId,
          now,
        ))
      ) {
        throw new HostIdentityFailure(
          'host_device_authorization_request_consumed',
        )
      }
      if (existing) {
        return {
          result: 'already_authorized' as const,
          authorization: publicAuthorization(existing),
        }
      }

      const sequence = await tx.nextDeviceAuthorizationSequence(
        hostId,
        device.deviceId,
      )
      const issuedAt = new Date(payload.iat * 1000)
      const expiresAt = new Date(payload.authorizationExpiresAt * 1000)
      const created = await new ControlPlaneRepository(
        transaction,
      ).createHostDeviceAuthorization({
        authorizationId: payload.authorizationId,
        hostId,
        claimGeneration: payload.hostIdentityGeneration,
        deviceId: payload.deviceId,
        deviceKeyGeneration: payload.deviceKeyGeneration,
        deviceFingerprint: payload.deviceFingerprint,
        userId: payload.userId,
        spaceId: payload.spaceId,
        scope: payload.scope,
        authorizationSerial: sequence.serial,
        authorizationGeneration: sequence.generation,
        issuedAt,
        expiresAt,
      })
      if (!created) {
        throw new HostIdentityFailure('host_device_authorization_conflict')
      }
      await new ControlPlaneRepository(transaction).appendSecurityEvent(
        event({
          eventType: 'supervisor_authorized',
          actorKind: 'host',
          actorId: hostId,
          targetKind: 'authorization',
          targetId: payload.authorizationId,
          outcome: 'success',
          reasonCode: null,
          correlationId: currentChallenge.challengeId,
          occurredAt: now,
        }),
      )
      const authorization = await tx.findDeviceAuthorization(
        payload.authorizationId,
      )
      if (!authorization) {
        throw new HostIdentityFailure('host_device_authorization_conflict')
      }
      return {
        result: 'authorized' as const,
        authorization: publicAuthorization(authorization),
      }
    })
  }

  public async authorizeHostRequest(
    human: AuthenticatedHumanRequestContext,
    device: AuthenticatedProductDeviceContext,
    untrustedHostId: string,
  ) {
    const hostId = hostIdSchema.parse(untrustedHostId)
    if (human.status !== 'active' || device.userId !== human.userId) {
      throw new HostIdentityFailure('host_device_authorization_owner_mismatch')
    }
    const authorization = await new HostIdentityRepository(
      this.database,
    ).findEffectiveDeviceAuthorization(
      hostId,
      device.deviceId,
      human.userId,
      human.personalSpaceId,
      this.now(),
    )
    if (!authorization) {
      throw new HostIdentityFailure('host_device_authorization_required')
    }
    return publicAuthorization(authorization)
  }

  public async listAuthorizedHostDirectory(
    human: AuthenticatedHumanRequestContext,
    device: AuthenticatedProductDeviceContext,
  ) {
    if (human.status !== 'active' || device.userId !== human.userId) {
      throw new HostIdentityFailure('host_device_authorization_owner_mismatch')
    }
    const rows = await new HostIdentityRepository(
      this.database,
    ).listEffectiveAuthorizedHosts(
      device.deviceId,
      human.userId,
      human.personalSpaceId,
      this.now(),
    )
    return {
      hosts: rows.map(({ host, authorization }) => ({
        hostId: host.hostId,
        safeLabel: host.safeLabel,
        coarsePlatform: host.coarsePlatform,
        identityGeneration: host.claimGeneration,
        fingerprint: host.fingerprint,
        protocolVersionMin: host.protocolVersionMin,
        protocolVersionMax: host.protocolVersionMax,
        authorization: {
          state: 'authorized' as const,
          authorizationId: authorization.authorizationId,
          scope: authorization.scope,
          expiresAt: authorization.expiresAt.toISOString(),
        },
      })),
    }
  }

  public async readDeviceAuthorization(
    human: AuthenticatedHumanRequestContext,
    device: AuthenticatedProductDeviceContext,
    untrustedHostId: string,
  ) {
    try {
      const authorization = await this.authorizeHostRequest(
        human,
        device,
        untrustedHostId,
      )
      return { state: 'authorized' as const, authorization }
    } catch (error) {
      if (
        error instanceof HostIdentityFailure &&
        error.code === 'host_device_authorization_required'
      ) {
        return { state: 'unauthorized' as const, authorization: null }
      }
      throw error
    }
  }

  public async revokeDeviceAuthorization(
    human: AuthenticatedHumanRequestContext,
    device: AuthenticatedProductDeviceContext,
    untrustedHostId: string,
    untrusted: unknown,
  ) {
    const hostId = hostIdSchema.parse(untrustedHostId)
    const input = authorizationRevocationSchema.parse(untrusted)
    const now = this.now()
    return this.database.transaction(async (transaction) => {
      const repository = new HostIdentityRepository(transaction)
      const host = await repository.findHostForUpdate(hostId)
      const currentDevice = await new ProductDeviceRepository(
        transaction,
      ).findProductDeviceForUpdate(device.deviceId)
      const authorization = await repository.findDeviceAuthorization(
        input.authorizationId,
      )
      if (
        human.status !== 'active' ||
        device.userId !== human.userId ||
        !currentDevice ||
        currentDevice.ownerUserId !== human.userId ||
        currentDevice.keyGeneration !== device.keyGeneration ||
        currentDevice.revokedAt
      ) {
        throw new HostIdentityFailure(
          'host_device_authorization_device_unavailable',
        )
      }
      if (
        !host ||
        host.owningSpaceId !== human.personalSpaceId ||
        host.claimState !== 'claimed' ||
        host.revokedAt ||
        !(await repository.userCanOwnSpace(human.personalSpaceId, human.userId))
      ) {
        throw new HostIdentityFailure(
          'host_device_authorization_owner_mismatch',
        )
      }
      if (
        !authorization ||
        authorization.hostId !== hostId ||
        authorization.deviceId !== device.deviceId ||
        authorization.userId !== human.userId ||
        authorization.spaceId !== human.personalSpaceId
      ) {
        throw new HostIdentityFailure('host_device_authorization_not_found')
      }
      if (authorization.revokedAt) {
        return {
          result: 'already_revoked' as const,
          authorization: publicAuthorization(authorization),
        }
      }
      if (
        !(await repository.revokeDeviceAuthorization({
          authorizationId: authorization.authorizationId,
          hostId,
          deviceId: device.deviceId,
          userId: human.userId,
          spaceId: human.personalSpaceId,
          revokedAt: now,
        }))
      ) {
        throw new HostIdentityFailure('host_device_authorization_conflict')
      }
      await new ControlPlaneRepository(transaction).appendSecurityEvent(
        event({
          eventType: 'supervisor_revoked',
          actorKind: 'device',
          actorId: device.deviceId,
          targetKind: 'authorization',
          targetId: authorization.authorizationId,
          outcome: 'success',
          reasonCode: null,
          correlationId: authorization.authorizationId,
          occurredAt: now,
        }),
      )
      const revoked = await repository.findDeviceAuthorization(
        authorization.authorizationId,
      )
      if (!revoked) {
        throw new HostIdentityFailure('host_device_authorization_conflict')
      }
      return {
        result: 'revoked' as const,
        authorization: publicAuthorization(revoked),
      }
    })
  }

  public async readClaim(untrusted: string): Promise<HostClaimRecord | null> {
    return new HostIdentityRepository(this.database).findClaim(
      hostClaimIdSchema.parse(untrusted),
    )
  }
  public async readHost(untrusted: string) {
    return new HostIdentityRepository(this.database).findHost(
      hostIdSchema.parse(untrusted),
    )
  }
}

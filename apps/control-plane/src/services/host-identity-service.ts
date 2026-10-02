import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import {
  sha256Digest as supervisorSha256Digest,
  signedSupervisorGrantSchema,
  signedSupervisorTransportDescriptorSchema,
  supervisorChallengeSchema,
  supervisorGrantDigest,
  supervisorTransportLimits,
  verifySupervisorDescriptor,
  verifySupervisorGrant,
  type SignedSupervisorGrant,
  type SupervisorGrantPayload,
} from '@codetether/supervisor-transport'
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
  createHostAccessRequestId,
  createHostClaimId,
  createSecurityEventId,
  hostAccessRequestIdSchema,
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
import {
  HostAccessRequestRepository,
  type HostAccessRequestRecord,
} from '../persistence/host-access-request-repository.js'
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
const accessRequestSchema = z
  .object({
    spaceId: spaceIdSchema,
    hostFingerprint: fingerprintSchema,
    hostIdentityGeneration: z.number().int().positive(),
    scope: z.literal('supervisor_read'),
  })
  .strict()
const accessRequestApprovalSchema = z
  .object({
    payload: hostDeviceAuthorizationPayloadSchema,
    proof: z.string().min(1).max(8192),
  })
  .strict()
const supervisorGrantMaterializationSchema = signedSupervisorGrantSchema
const supervisorTransportPublicationSchema = z
  .object({
    grant: signedSupervisorGrantSchema,
    descriptor: signedSupervisorTransportDescriptorSchema,
  })
  .strict()
const CHALLENGE_LIFETIME_MS = 5 * 60 * 1000
const ACCESS_REQUEST_LIFETIME_MS = 30 * 60 * 1000
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

function buildAuthorizationPayload(input: {
  readonly challengeId: HostDeviceAuthorizationChallengeRecord['challengeId']
  readonly hostId: string
  readonly hostFingerprint: string
  readonly hostIdentityGeneration: number
  readonly spaceId: string
  readonly userId: string
  readonly deviceId: string
  readonly deviceKeyGeneration: number
  readonly deviceFingerprint: string
  readonly nonce: string
  readonly createdAt: Date
  readonly challengeExpiresAt: Date
  readonly authorizationExpiresAt: Date
}): HostDeviceAuthorizationPayload {
  return hostDeviceAuthorizationPayloadSchema.parse({
    v: HOST_PROOF_VERSION,
    aud: HOST_AUDIENCE,
    purpose: 'host_device_authorization',
    authorizationId: authorizationIdForChallenge(input.challengeId),
    challengeId: input.challengeId,
    hostId: input.hostId,
    hostFingerprint: input.hostFingerprint,
    hostIdentityGeneration: input.hostIdentityGeneration,
    spaceId: input.spaceId,
    userId: input.userId,
    deviceId: input.deviceId,
    deviceKeyGeneration: input.deviceKeyGeneration,
    deviceFingerprint: input.deviceFingerprint,
    scope: 'supervisor_read',
    nonce: input.nonce,
    iat: Math.floor(input.createdAt.getTime() / 1000),
    exp: Math.floor(input.challengeExpiresAt.getTime() / 1000),
    authorizationExpiresAt: Math.floor(
      input.authorizationExpiresAt.getTime() / 1000,
    ),
  })
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

function publicAccessRequest(request: HostAccessRequestRecord) {
  return {
    requestId: request.requestId,
    hostId: request.targetHostId,
    deviceId: request.requestingDeviceId,
    spaceId: request.spaceId,
    scope: request.requestedScope,
    status: request.status,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    expiresAt: request.expiresAt.toISOString(),
    completedAuthorizationId: request.completedAuthorizationId,
    payload: request.authorizationPayload,
  }
}

function accessPayloadMatches(
  expected: HostDeviceAuthorizationPayload,
  actual: HostDeviceAuthorizationPayload,
): boolean {
  return (
    expected.authorizationId === actual.authorizationId &&
    expected.challengeId === actual.challengeId &&
    expected.hostId === actual.hostId &&
    expected.hostFingerprint === actual.hostFingerprint &&
    expected.hostIdentityGeneration === actual.hostIdentityGeneration &&
    expected.spaceId === actual.spaceId &&
    expected.userId === actual.userId &&
    expected.deviceId === actual.deviceId &&
    expected.deviceKeyGeneration === actual.deviceKeyGeneration &&
    expected.deviceFingerprint === actual.deviceFingerprint &&
    expected.scope === actual.scope &&
    expected.nonce === actual.nonce &&
    expected.iat === actual.iat &&
    expected.exp === actual.exp &&
    expected.authorizationExpiresAt === actual.authorizationExpiresAt
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

function supervisorGrantMatchesAuthorization(
  payload: SupervisorGrantPayload,
  authorization: HostDeviceAuthorizationRecord,
  host: { readonly fingerprint: string },
): boolean {
  return (
    payload.authorizationId === authorization.authorizationId &&
    payload.hostId === authorization.hostId &&
    payload.hostFingerprint === host.fingerprint &&
    payload.hostIdentityGeneration === authorization.hostIdentityGeneration &&
    payload.deviceId === authorization.deviceId &&
    payload.deviceFingerprint === authorization.deviceFingerprint &&
    payload.deviceKeyGeneration === authorization.deviceKeyGeneration &&
    payload.userId === authorization.userId &&
    payload.spaceId === authorization.spaceId &&
    payload.scope === authorization.scope &&
    payload.authorizationSerial ===
      authorization.authorizationSerial.toString() &&
    payload.authorizationGeneration === authorization.authorizationGeneration &&
    sameSecond(authorization.issuedAt, payload.issuedAt) &&
    sameSecond(authorization.expiresAt, payload.expiresAt)
  )
}

function sameSignedGrant(
  left: SignedSupervisorGrant,
  right: SignedSupervisorGrant,
): boolean {
  return supervisorGrantDigest(left) === supervisorGrantDigest(right)
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

  /**
   * Account-owned Host discovery and the cloud-mediated Phase 10A request
   * workflow. This deliberately keeps the existing authorized directory
   * unchanged: an owned Host is only metadata until the Host signs the
   * request and the Control Plane creates the normal authorization record.
   */
  public async listOwnedHostAccess(
    human: AuthenticatedHumanRequestContext,
    device: AuthenticatedProductDeviceContext,
  ) {
    if (human.status !== 'active' || device.userId !== human.userId) {
      throw new HostIdentityFailure('host_access_request_owner_mismatch')
    }
    const rows = await new HostAccessRequestRepository(this.database).listOwnedHostsForDevice(
      human.userId,
      human.personalSpaceId,
      device.deviceId,
      this.now(),
    )
    return {
      hosts: rows.map((row) => ({
        hostId: row.hostId,
        spaceId: row.spaceId,
        safeLabel: row.safeLabel,
        coarsePlatform: row.coarsePlatform,
        fingerprint: row.fingerprint,
        identityGeneration: row.identityGeneration,
        access: {
          state: row.authorizationState,
          requestId: row.requestId,
          expiresAt: row.requestExpiresAt?.toISOString() ?? null,
          authorizationId: row.authorizationId,
        },
      })),
    }
  }

  public async requestHostAccess(
    human: AuthenticatedHumanRequestContext,
    device: AuthenticatedProductDeviceContext,
    untrustedHostId: string,
    untrusted: unknown,
  ) {
    const hostId = hostIdSchema.parse(untrustedHostId)
    const input = accessRequestSchema.parse(untrusted)
    if (
      human.status !== 'active' ||
      human.personalSpaceId !== input.spaceId ||
      device.userId !== human.userId
    ) {
      throw new HostIdentityFailure('host_access_request_owner_mismatch')
    }
    const now = this.now()
    return this.database.transaction(async (transaction) => {
      const hostRepository = new HostIdentityRepository(transaction)
      const requestRepository = new HostAccessRequestRepository(transaction)
      const host = await hostRepository.findHostForUpdate(hostId)
      const currentDevice = await new ProductDeviceRepository(
        transaction,
      ).findProductDeviceForUpdate(device.deviceId)
      if (
        !currentDevice ||
        currentDevice.ownerUserId !== human.userId ||
        currentDevice.keyGeneration !== device.keyGeneration ||
        currentDevice.revokedAt
      ) {
        throw new HostIdentityFailure('host_access_request_device_unavailable')
      }
      if (
        !host ||
        host.owningSpaceId !== input.spaceId ||
        host.claimState !== 'claimed' ||
        host.revokedAt ||
        host.fingerprint !== input.hostFingerprint ||
        host.claimGeneration !== input.hostIdentityGeneration
      ) {
        throw new HostIdentityFailure('host_access_request_host_mismatch')
      }
      if (!(await hostRepository.userCanOwnSpace(input.spaceId, human.userId))) {
        throw new HostIdentityFailure('host_access_request_owner_mismatch')
      }
      const existingAuthorization = await hostRepository.findEffectiveDeviceAuthorization(
        hostId,
        device.deviceId,
        human.userId,
        input.spaceId,
        now,
      )
      if (existingAuthorization) {
        return {
          status: 'authorized' as const,
          request: null,
          authorization: publicAuthorization(existingAuthorization),
        }
      }
      await requestRepository.expireEquivalent(
        device.deviceId,
        hostId,
        input.scope,
        now,
      )
      const pending = await requestRepository.findPendingEquivalent(
        device.deviceId,
        hostId,
        input.scope,
        now,
      )
      if (pending) {
        return { status: 'pending' as const, request: publicAccessRequest(pending) }
      }

      const challengeId = createEnrollmentChallengeId()
      const createdAt = now
      const expiresAt = new Date(createdAt.getTime() + ACCESS_REQUEST_LIFETIME_MS)
      const authorizationExpiresAt = new Date(
        createdAt.getTime() + AUTHORIZATION_LIFETIME_MS,
      )
      const payload = buildAuthorizationPayload({
        challengeId,
        hostId,
        hostFingerprint: host.fingerprint,
        hostIdentityGeneration: host.claimGeneration,
        spaceId: input.spaceId,
        userId: human.userId,
        deviceId: currentDevice.deviceId,
        deviceKeyGeneration: currentDevice.keyGeneration,
        deviceFingerprint: currentDevice.fingerprint,
        nonce: this.random(32).toString('base64url'),
        createdAt,
        challengeExpiresAt: expiresAt,
        authorizationExpiresAt,
      })
      await hostRepository.createDeviceAuthorizationChallenge({
        challengeId,
        userId: human.userId,
        spaceId: input.spaceId,
        deviceId: currentDevice.deviceId,
        hostId,
        nonceHash: sha256Digest(payload.nonce),
        createdAt,
        expiresAt,
      })
      const requestId = createHostAccessRequestId()
      const inserted = await requestRepository.create({
        requestId,
        requestingDeviceId: currentDevice.deviceId,
        targetHostId: hostId,
        spaceId: input.spaceId,
        requestedScope: input.scope,
        challengeId,
        authorizationPayload: payload,
        createdAt,
        expiresAt,
      })
      if (!inserted) {
        await hostRepository.deleteUnconsumedDeviceAuthorizationChallenge(
          challengeId,
        )
        const raced = await requestRepository.findPendingEquivalent(
          device.deviceId,
          hostId,
          input.scope,
          now,
        )
        if (raced) return { status: 'pending' as const, request: publicAccessRequest(raced) }
        throw new HostIdentityFailure('host_access_request_conflict')
      }
      const created = await requestRepository.findById(requestId)
      if (!created) throw new HostIdentityFailure('host_access_request_conflict')
      return { status: 'pending' as const, request: publicAccessRequest(created) }
    })
  }

  public async readHostAccessRequest(
    human: AuthenticatedHumanRequestContext,
    device: AuthenticatedProductDeviceContext,
    untrustedRequestId: string,
  ) {
    const requestId = hostAccessRequestIdSchema.parse(untrustedRequestId)
    if (human.status !== 'active' || device.userId !== human.userId) {
      throw new HostIdentityFailure('host_access_request_owner_mismatch')
    }
    const request = await new HostAccessRequestRepository(this.database).findById(requestId)
    if (!request || request.requestingDeviceId !== device.deviceId || request.spaceId !== human.personalSpaceId) {
      throw new HostIdentityFailure('host_access_request_not_found')
    }
    if (request.status === 'pending' && request.expiresAt <= this.now()) {
      await new HostAccessRequestRepository(this.database).expirePending(requestId, this.now())
      return { ...publicAccessRequest(request), status: 'expired' as const }
    }
    return publicAccessRequest(request)
  }

  public async cancelHostAccessRequest(
    human: AuthenticatedHumanRequestContext,
    device: AuthenticatedProductDeviceContext,
    untrustedRequestId: string,
  ) {
    const requestId = hostAccessRequestIdSchema.parse(untrustedRequestId)
    if (human.status !== 'active' || device.userId !== human.userId) {
      throw new HostIdentityFailure('host_access_request_owner_mismatch')
    }
    const now = this.now()
    const result = await this.database.transaction(async (transaction) => {
      const repository = new HostAccessRequestRepository(transaction)
      const request = await repository.findById(requestId, true)
      if (!request || request.requestingDeviceId !== device.deviceId || request.spaceId !== human.personalSpaceId) {
        throw new HostIdentityFailure('host_access_request_not_found')
      }
      if (request.status === 'pending' && request.expiresAt <= now) {
        await repository.expirePending(requestId, now)
        return 'expired' as const
      }
      if (request.status !== 'pending') return request.status
      if (!(await repository.transitionPending({ requestId, status: 'cancelled', updatedAt: now }))) {
        throw new HostIdentityFailure('host_access_request_conflict')
      }
      return 'cancelled' as const
    })
    return { requestId, status: result }
  }

  public async listPendingHostAccessRequests(
    human: AuthenticatedHumanRequestContext,
    device: AuthenticatedProductDeviceContext,
  ) {
    if (human.status !== 'active' || device.userId !== human.userId) {
      throw new HostIdentityFailure('host_access_request_owner_mismatch')
    }
    const requests = await new HostAccessRequestRepository(this.database).listPendingForOwnedHosts(
      human.userId,
      human.personalSpaceId,
      this.now(),
    )
    return {
      requests: requests.map((request) => ({
        ...publicAccessRequest(request),
        requestingDevice: request.requestingDevice,
      })),
    }
  }

  public async denyHostAccessRequest(
    human: AuthenticatedHumanRequestContext,
    device: AuthenticatedProductDeviceContext,
    untrustedRequestId: string,
  ) {
    const requestId = hostAccessRequestIdSchema.parse(untrustedRequestId)
    if (human.status !== 'active' || device.userId !== human.userId) {
      throw new HostIdentityFailure('host_access_request_owner_mismatch')
    }
    const now = this.now()
    const status = await this.database.transaction(async (transaction) => {
      const repository = new HostAccessRequestRepository(transaction)
      const request = await repository.findById(requestId, true)
      if (!request || request.spaceId !== human.personalSpaceId) {
        throw new HostIdentityFailure('host_access_request_not_found')
      }
      if (request.status === 'pending' && request.expiresAt <= now) {
        await repository.expirePending(requestId, now)
        return 'expired' as const
      }
      if (request.status !== 'pending') return request.status
      if (!(await repository.transitionPending({ requestId, status: 'denied', updatedAt: now }))) {
        throw new HostIdentityFailure('host_access_request_conflict')
      }
      return 'denied' as const
    })
    return { requestId, status }
  }

  public async approveHostAccessRequest(
    human: AuthenticatedHumanRequestContext,
    actorDevice: AuthenticatedProductDeviceContext,
    untrustedRequestId: string,
    untrusted: unknown,
  ) {
    const requestId = hostAccessRequestIdSchema.parse(untrustedRequestId)
    const input = accessRequestApprovalSchema.parse(untrusted)
    const payload = input.payload
    if (human.status !== 'active' || actorDevice.userId !== human.userId) {
      throw new HostIdentityFailure('host_access_request_owner_mismatch')
    }
    const requestRepository = new HostAccessRequestRepository(this.database)
    const request = await requestRepository.findById(requestId)
    if (!request || request.spaceId !== human.personalSpaceId) {
      throw new HostIdentityFailure('host_access_request_not_found')
    }
    const storedPayload = hostDeviceAuthorizationPayloadSchema.parse(request.authorizationPayload)
    if (
      !accessPayloadMatches(storedPayload, payload) ||
      payload.scope !== 'supervisor_read' ||
      payload.challengeId !== request.challengeId ||
      payload.hostId !== request.targetHostId ||
      payload.deviceId !== request.requestingDeviceId ||
      payload.spaceId !== request.spaceId
    ) {
      throw new HostIdentityFailure('host_access_request_payload_mismatch')
    }
    const hostRepository = new HostIdentityRepository(this.database)
    const host = await hostRepository.findHost(request.targetHostId)
    if (!host || host.owningSpaceId !== human.personalSpaceId) {
      throw new HostIdentityFailure('host_access_request_host_mismatch')
    }
    try {
      const admitted = await admitHostPublicJwk(JSON.parse(host.publicKey))
      if (admitted.canonicalPublicJwk !== host.publicKey || admitted.fingerprint !== host.fingerprint) throw new Error('identity mismatch')
      await verifyHostDeviceAuthorizationProof(input.proof, admitted.publicJwk, payload)
    } catch {
      throw new HostIdentityFailure('host_access_request_signature_invalid')
    }

    const now = this.now()
    return this.database.transaction(async (transaction) => {
      const txRequests = new HostAccessRequestRepository(transaction)
      const txHosts = new HostIdentityRepository(transaction)
      const currentRequest = await txRequests.findById(requestId, true)
      if (!currentRequest) throw new HostIdentityFailure('host_access_request_not_found')
      if (currentRequest.status === 'completed' && currentRequest.completedAuthorizationId) {
        const existing = await txHosts.findDeviceAuthorization(currentRequest.completedAuthorizationId)
        if (existing) return { result: 'already_authorized' as const, authorization: publicAuthorization(existing), requestId }
      }
      if (currentRequest.status !== 'pending') {
        throw new HostIdentityFailure(
          currentRequest.status === 'expired'
            ? 'host_access_request_expired'
            : 'host_access_request_not_pending',
        )
      }
      if (currentRequest.expiresAt <= now) {
        await txRequests.expirePending(requestId, now)
        throw new HostIdentityFailure('host_access_request_expired')
      }
      const currentHost = await txHosts.findHostForUpdate(request.targetHostId)
      const currentDevice = await new ProductDeviceRepository(transaction).findProductDeviceForUpdate(payload.deviceId)
      const currentChallenge = await txHosts.findDeviceAuthorizationChallenge(payload.challengeId, true)
      if (
        !currentHost ||
        currentHost.owningSpaceId !== human.personalSpaceId ||
        currentHost.claimState !== 'claimed' ||
        currentHost.revokedAt ||
        currentHost.fingerprint !== payload.hostFingerprint ||
        currentHost.claimGeneration !== payload.hostIdentityGeneration
      ) throw new HostIdentityFailure('host_access_request_host_mismatch')
      if (
        !currentDevice ||
        currentDevice.ownerUserId !== human.userId ||
        currentDevice.keyGeneration !== payload.deviceKeyGeneration ||
        currentDevice.fingerprint !== payload.deviceFingerprint ||
        currentDevice.revokedAt
      ) throw new HostIdentityFailure('host_access_request_device_unavailable')
      if (!(await txHosts.userCanOwnSpace(payload.spaceId, human.userId))) {
        throw new HostIdentityFailure('host_access_request_owner_mismatch')
      }
      if (!currentChallenge || !authorizationChallengeMatches(currentChallenge, payload)) {
        throw new HostIdentityFailure('host_access_request_challenge_invalid')
      }
      const existing = await txHosts.findEffectiveDeviceAuthorization(
        payload.hostId,
        payload.deviceId,
        payload.userId,
        payload.spaceId,
        now,
      )
      if (currentChallenge.consumedAt) {
        if (existing && authorizationMatchesPayload(existing, payload)) {
          await txRequests.transitionPending({ requestId, status: 'completed', updatedAt: now, completedAuthorizationId: existing.authorizationId })
          return { result: 'already_authorized' as const, authorization: publicAuthorization(existing), requestId }
        }
        throw new HostIdentityFailure('host_access_request_challenge_consumed')
      }
      if (!(await txHosts.consumeDeviceAuthorizationChallenge(payload.challengeId, now))) {
        throw new HostIdentityFailure('host_access_request_challenge_consumed')
      }
      if (existing) {
        await txRequests.transitionPending({ requestId, status: 'completed', updatedAt: now, completedAuthorizationId: existing.authorizationId })
        return { result: 'already_authorized' as const, authorization: publicAuthorization(existing), requestId }
      }
      const sequence = await txHosts.nextDeviceAuthorizationSequence(payload.hostId, payload.deviceId)
      const created = await new ControlPlaneRepository(transaction).createHostDeviceAuthorization({
        authorizationId: payload.authorizationId,
        hostId: payload.hostId,
        claimGeneration: payload.hostIdentityGeneration,
        deviceId: payload.deviceId,
        deviceKeyGeneration: payload.deviceKeyGeneration,
        deviceFingerprint: payload.deviceFingerprint,
        userId: payload.userId,
        spaceId: payload.spaceId,
        scope: payload.scope,
        authorizationSerial: sequence.serial,
        authorizationGeneration: sequence.generation,
        issuedAt: new Date(payload.iat * 1000),
        expiresAt: new Date(payload.authorizationExpiresAt * 1000),
      })
      if (!created) throw new HostIdentityFailure('host_access_request_conflict')
      await new ControlPlaneRepository(transaction).appendSecurityEvent(event({
        eventType: 'supervisor_authorized',
        actorKind: 'host',
        actorId: payload.hostId,
        targetKind: 'authorization',
        targetId: payload.authorizationId,
        outcome: 'success',
        reasonCode: null,
        correlationId: requestId,
        occurredAt: now,
      }))
      if (!(await txRequests.transitionPending({ requestId, status: 'completed', updatedAt: now, completedAuthorizationId: payload.authorizationId }))) {
        throw new HostIdentityFailure('host_access_request_conflict')
      }
      const authorization = await txHosts.findDeviceAuthorization(payload.authorizationId)
      if (!authorization) throw new HostIdentityFailure('host_access_request_conflict')
      return { result: 'authorized' as const, authorization: publicAuthorization(authorization), requestId }
    })
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
        spaceId: human.personalSpaceId,
        safeLabel: host.safeLabel,
        coarsePlatform: host.coarsePlatform,
        identityGeneration: host.claimGeneration,
        fingerprint: host.fingerprint,
        publicKey: JSON.parse(host.publicKey) as unknown,
        protocolVersionMin: host.protocolVersionMin,
        protocolVersionMax: host.protocolVersionMax,
        authorization: {
          state: 'authorized' as const,
          authorizationId: authorization.authorizationId,
          scope: authorization.scope,
          expiresAt: authorization.expiresAt.toISOString(),
          issuedAt: authorization.issuedAt.toISOString(),
          serial: authorization.authorizationSerial.toString(),
          generation: authorization.authorizationGeneration,
        },
        supervisor:
          authorization.supervisorGrant !== null &&
          authorization.supervisorTransport !== null &&
          authorization.supervisorTransportExpiresAt !== null &&
          authorization.supervisorTransportExpiresAt > this.now() &&
          authorization.supervisorTransport.payload.grantDigest ===
            supervisorGrantDigest(authorization.supervisorGrant)
            ? {
                grant: authorization.supervisorGrant,
                transport: authorization.supervisorTransport,
              }
            : null,
      })),
    }
  }

  /**
   * Materializes the Host signature that the accepted authorization flow
   * proved but its original schema did not retain. This does not create,
   * renew, revoke, or widen an authorization.
   */
  public async materializeSupervisorGrant(
    human: AuthenticatedHumanRequestContext,
    device: AuthenticatedProductDeviceContext,
    untrustedHostId: string,
    untrusted: unknown,
  ) {
    const hostId = hostIdSchema.parse(untrustedHostId)
    const grant = supervisorGrantMaterializationSchema.parse(untrusted)
    const authorization = await this.authorizeHostRequest(human, device, hostId)
    const repository = new HostIdentityRepository(this.database)
    const [record, host] = await Promise.all([
      repository.findDeviceAuthorization(authorization.authorizationId),
      repository.findHost(hostId),
    ])
    if (!record || !host || host.publicKey.length > 8_192) {
      throw new HostIdentityFailure('host_device_authorization_required')
    }
    if (!supervisorGrantMatchesAuthorization(grant.payload, record, host)) {
      throw new HostIdentityFailure('host_supervisor_grant_mismatch')
    }
    try {
      const admitted = await admitHostPublicJwk(JSON.parse(host.publicKey))
      if (
        admitted.fingerprint !== host.fingerprint ||
        admitted.canonicalPublicJwk !== host.publicKey
      ) {
        throw new Error('Host identity mismatch')
      }
      await verifySupervisorGrant(grant, admitted.publicJwk)
    } catch {
      throw new HostIdentityFailure('host_supervisor_grant_signature_invalid')
    }
    const result = await repository.materializeSupervisorGrant({
      authorizationId: record.authorizationId,
      grant,
      materializedAt: this.now(),
    })
    if (result === 'conflict') {
      throw new HostIdentityFailure('host_supervisor_grant_conflict')
    }
    const current = await repository.findDeviceAuthorization(
      record.authorizationId,
    )
    if (
      !current?.supervisorGrant ||
      !sameSignedGrant(current.supervisorGrant, grant)
    ) {
      throw new HostIdentityFailure('host_supervisor_grant_conflict')
    }
    return {
      result: result === 'stored' ? 'materialized' : 'already_materialized',
      grant,
    }
  }

  public async publishSupervisorTransport(
    human: AuthenticatedHumanRequestContext,
    device: AuthenticatedProductDeviceContext,
    untrustedHostId: string,
    untrusted: unknown,
  ) {
    const hostId = hostIdSchema.parse(untrustedHostId)
    const input = supervisorTransportPublicationSchema.parse(untrusted)
    const effective = await this.authorizeHostRequest(human, device, hostId)
    const repository = new HostIdentityRepository(this.database)
    const [authorization, host] = await Promise.all([
      repository.findDeviceAuthorization(effective.authorizationId),
      repository.findHost(hostId),
    ])
    if (
      !authorization?.supervisorGrant ||
      !host ||
      !sameSignedGrant(authorization.supervisorGrant, input.grant)
    ) {
      throw new HostIdentityFailure('host_supervisor_grant_required')
    }
    const payload = input.descriptor.payload
    const now = this.now()
    const expiresAt = new Date(payload.exp * 1_000)
    if (
      payload.authorizationId !== authorization.authorizationId ||
      payload.hostId !== hostId ||
      payload.hostFingerprint !== host.fingerprint ||
      payload.hostIdentityGeneration !== host.claimGeneration ||
      payload.deviceId !== device.deviceId ||
      payload.deviceKeyGeneration !== device.keyGeneration ||
      payload.grantDigest !== supervisorGrantDigest(input.grant) ||
      payload.iat > Math.floor((now.getTime() + 120_000) / 1_000) ||
      expiresAt <= now ||
      expiresAt.getTime() - now.getTime() >
        supervisorTransportLimits.descriptorLifetimeMs ||
      expiresAt > authorization.expiresAt
    ) {
      throw new HostIdentityFailure('host_supervisor_transport_mismatch')
    }
    try {
      const admitted = await admitHostPublicJwk(JSON.parse(host.publicKey))
      await verifySupervisorDescriptor(input.descriptor, admitted.publicJwk)
    } catch {
      throw new HostIdentityFailure(
        'host_supervisor_transport_signature_invalid',
      )
    }
    if (
      !(await repository.publishSupervisorTransport({
        authorizationId: authorization.authorizationId,
        descriptor: input.descriptor,
        expiresAt,
        now,
      }))
    ) {
      throw new HostIdentityFailure('host_supervisor_transport_conflict')
    }
    return { result: 'published' as const, expiresAt: expiresAt.toISOString() }
  }

  public async authorizeSupervisorAdmission(
    human: AuthenticatedHumanRequestContext,
    device: AuthenticatedProductDeviceContext,
    untrustedHostId: string,
    untrusted: unknown,
  ) {
    const hostId = hostIdSchema.parse(untrustedHostId)
    const challenge = supervisorChallengeSchema.parse(untrusted)
    const now = this.now()
    if (
      challenge.hostId !== hostId ||
      challenge.deviceId !== device.deviceId ||
      challenge.deviceKeyGeneration !== device.keyGeneration ||
      Date.parse(challenge.issuedAt) >
        now.getTime() + supervisorTransportLimits.maximumClockSkewMs ||
      Date.parse(challenge.expiresAt) <= now.getTime() ||
      Date.parse(challenge.expiresAt) - Date.parse(challenge.issuedAt) >
        supervisorTransportLimits.handshakeTimeoutMs * 2
    ) {
      throw new HostIdentityFailure('host_supervisor_admission_invalid')
    }
    const effective = await this.authorizeHostRequest(human, device, hostId)
    const repository = new HostIdentityRepository(this.database)
    const [authorization, host] = await Promise.all([
      repository.findDeviceAuthorization(effective.authorizationId),
      repository.findHost(hostId),
    ])
    if (
      !authorization?.supervisorGrant ||
      !host ||
      challenge.authorizationId !== authorization.authorizationId ||
      challenge.hostIdentityGeneration !== host.claimGeneration
    ) {
      throw new HostIdentityFailure('host_supervisor_grant_required')
    }
    return {
      admitted: true as const,
      hostId,
      hostFingerprint: host.fingerprint,
      hostIdentityGeneration: host.claimGeneration,
      userId: human.userId,
      spaceId: human.personalSpaceId,
      deviceId: device.deviceId,
      deviceKeyGeneration: device.keyGeneration,
      authorizationId: authorization.authorizationId,
      scope: authorization.scope,
      authorizationExpiresAt: authorization.expiresAt.toISOString(),
      challengeDigest: supervisorSha256Digest(
        Buffer.from(JSON.stringify(challenge), 'utf8'),
      ),
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

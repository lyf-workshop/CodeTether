import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import {
  HOST_AUDIENCE,
  HOST_KEY_ALGORITHM,
  HOST_PROOF_VERSION,
  HOST_PROTOCOL_VERSION,
  admitHostPublicJwk,
  hostClaimConfirmationPayloadSchema,
  hostRegistrationChallengePayloadSchema,
  verifyHostClaimConfirmationProof,
  verifyHostRegistrationProof,
  type HostClaimConfirmationPayload,
  type HostRegistrationChallengePayload,
} from '../auth/host-identity-protocol.js'
import { sha256Digest } from '../auth/product-device-protocol.js'
import {
  createEnrollmentChallengeId,
  createHostClaimId,
  createSecurityEventId,
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
  type HostRegistrationChallengeRecord,
} from '../persistence/host-identity-repository.js'
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
const CHALLENGE_LIFETIME_MS = 5 * 60 * 1000

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
      await this.database.transaction((transaction) =>
        new HostIdentityRepository(transaction).expireClaim(
          claim.claimId,
          claim.hostId,
          now,
        ),
      )
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

import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import {
  PRODUCT_DEVICE_AUDIENCE,
  PRODUCT_DEVICE_CLOCK_SKEW_SECONDS,
  PRODUCT_DEVICE_KEY_ALGORITHM,
  PRODUCT_DEVICE_PROOF_VERSION,
  PRODUCT_DEVICE_PROTOCOL_VERSION,
  admitProductDevicePublicJwk,
  canonicalizeDeviceRequestResource,
  deviceRegistrationChallengePayloadSchema,
  equalDigest,
  parseUnverifiedDeviceRequestProof,
  productDevicePublicJwkSchema,
  registrationCandidateSchema,
  sha256Digest,
  verifyDeviceRequestProofSignature,
  verifyRegistrationChallengeProof,
  type DeviceRegistrationChallengePayload,
  type ProductDevicePublicJwk,
} from '../auth/product-device-protocol.js'
import {
  createEnrollmentChallengeId,
  createProductDeviceId,
  createSecurityEventId,
  productDeviceIdSchema,
  type ProductDeviceId,
  type UserId,
} from '../domain/ids.js'
import { ControlPlaneRepository } from '../persistence/control-plane-repository.js'
import type { ControlPlaneDatabase } from '../persistence/database.js'
import {
  ProductDeviceRepository,
  type DeviceRegistrationChallengeRecord,
  type ProductDeviceRecord,
} from '../persistence/product-device-repository.js'
import type { AuthenticatedHumanRequestContext } from './authenticated-account-service.js'

export const productDeviceAuthFailureCodes = [
  'device_auth_required',
  'device_auth_unavailable',
  'device_not_found',
  'device_owner_mismatch',
  'device_revoked',
  'device_key_generation_stale',
  'device_algorithm_unsupported',
  'device_signature_invalid',
  'device_proof_expired',
  'device_proof_future',
  'device_proof_replayed',
  'device_proof_method_mismatch',
  'device_proof_resource_mismatch',
  'device_proof_body_mismatch',
  'device_proof_token_binding_mismatch',
  'device_proof_audience_mismatch',
  'device_proof_version_unsupported',
  'device_registration_challenge_invalid',
  'device_registration_challenge_consumed',
  'device_registration_challenge_expired',
] as const

export type ProductDeviceAuthFailureCode =
  (typeof productDeviceAuthFailureCodes)[number]

export class ProductDeviceAuthFailure extends Error {
  public constructor(public readonly code: ProductDeviceAuthFailureCode) {
    super('ProductDevice authentication failed')
    this.name = 'ProductDeviceAuthFailure'
  }
}

export interface AuthenticatedProductDeviceContext {
  readonly userId: UserId
  readonly deviceId: ProductDeviceId
  readonly deviceType: ProductDeviceRecord['deviceType']
  readonly keyGeneration: number
}

export interface ProductDeviceRegistrationChallenge {
  readonly challenge: DeviceRegistrationChallengePayload
  readonly publicKeyFingerprint: string
}

const completeRegistrationSchema = z
  .object({
    challenge: deviceRegistrationChallengePayloadSchema,
    proof: z.string().min(1).max(8_192),
  })
  .strict()

const MAX_ACTIVE_REGISTRATION_CHALLENGES_PER_USER = 5

function advisoryLockParts(scope: string, value: string): [number, number] {
  const digest = createHash('sha256')
    .update(scope)
    .update('\0')
    .update(value)
    .digest()
  return [digest.readInt32BE(0), digest.readInt32BE(4)]
}

function sameInstantSeconds(date: Date, epochSeconds: number): boolean {
  return Math.floor(date.getTime() / 1_000) === epochSeconds
}

function challengeMatchesPayload(
  record: DeviceRegistrationChallengeRecord,
  payload: DeviceRegistrationChallengePayload,
): boolean {
  return (
    record.challengeId === payload.challengeId &&
    record.targetUserId === payload.userId &&
    record.candidateDeviceId === payload.candidateDeviceId &&
    record.candidateFingerprint === payload.publicKeyFingerprint &&
    record.candidateKeyAlgorithm === payload.keyAlgorithm &&
    record.deviceType === payload.deviceType &&
    record.label === payload.label &&
    record.platform === payload.platform &&
    record.appVersion === payload.appVersion &&
    record.protocolVersion === payload.protocolVersion &&
    record.proofVersion === payload.v &&
    record.audience === payload.aud &&
    equalDigest(record.nonceHash, sha256Digest(payload.nonce)) &&
    sameInstantSeconds(record.createdAt, payload.iat) &&
    sameInstantSeconds(record.expiresAt, payload.exp)
  )
}

function toPublicDevice(device: ProductDeviceRecord) {
  return {
    deviceId: device.deviceId,
    ownerUserId: device.ownerUserId,
    deviceType: device.deviceType,
    keyAlgorithm: device.keyAlgorithm,
    fingerprint: device.fingerprint,
    keyGeneration: device.keyGeneration,
    label: device.label,
    platform: device.platform,
    appVersion: device.appVersion,
    protocolVersion: device.protocolVersion,
    createdAt: device.createdAt.toISOString(),
    lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
    revokedAt: device.revokedAt?.toISOString() ?? null,
  }
}

function proofParseFailure(error: unknown): ProductDeviceAuthFailure {
  void error
  return new ProductDeviceAuthFailure('device_signature_invalid')
}

export class ProductDeviceAuthenticationService {
  public constructor(
    private readonly database: ControlPlaneDatabase,
    private readonly now: () => Date = () => new Date(),
    private readonly random: (size: number) => Buffer = randomBytes,
  ) {}

  public async createRegistrationChallenge(
    human: AuthenticatedHumanRequestContext,
    untrustedCandidate: unknown,
  ): Promise<ProductDeviceRegistrationChallenge> {
    const candidateResult =
      registrationCandidateSchema.safeParse(untrustedCandidate)
    if (!candidateResult.success) {
      if (
        untrustedCandidate !== null &&
        typeof untrustedCandidate === 'object' &&
        'keyAlgorithm' in untrustedCandidate &&
        untrustedCandidate.keyAlgorithm !== PRODUCT_DEVICE_KEY_ALGORITHM
      ) {
        throw new ProductDeviceAuthFailure('device_algorithm_unsupported')
      }
      throw new ProductDeviceAuthFailure(
        'device_registration_challenge_invalid',
      )
    }
    const candidate = candidateResult.data
    let admittedKey: Awaited<ReturnType<typeof admitProductDevicePublicJwk>>
    try {
      admittedKey = await admitProductDevicePublicJwk(candidate.publicKey)
    } catch {
      throw new ProductDeviceAuthFailure('device_algorithm_unsupported')
    }
    const issuedAtSeconds = Math.floor(this.now().getTime() / 1_000)
    const expiresAtSeconds = issuedAtSeconds + 300
    const nonce = this.random(32).toString('base64url')
    const payload = deviceRegistrationChallengePayloadSchema.parse({
      v: PRODUCT_DEVICE_PROOF_VERSION,
      aud: PRODUCT_DEVICE_AUDIENCE,
      purpose: 'device_registration',
      challengeId: createEnrollmentChallengeId(),
      userId: human.userId,
      candidateDeviceId: createProductDeviceId(),
      publicKeyFingerprint: admittedKey.fingerprint,
      keyAlgorithm: PRODUCT_DEVICE_KEY_ALGORITHM,
      deviceType: candidate.deviceType,
      label: candidate.label,
      platform: candidate.platform,
      appVersion: candidate.appVersion,
      nonce,
      iat: issuedAtSeconds,
      exp: expiresAtSeconds,
      protocolVersion: PRODUCT_DEVICE_PROTOCOL_VERSION,
    })

    await this.database.transaction(async (transaction) => {
      const userLock = advisoryLockParts(
        'device-registration-user',
        human.userId,
      )
      const fingerprintLock = advisoryLockParts(
        'device-registration-fingerprint',
        admittedKey.fingerprint,
      )
      await transaction.query('SELECT pg_advisory_xact_lock($1, $2)', userLock)
      await transaction.query(
        'SELECT pg_advisory_xact_lock($1, $2)',
        fingerprintLock,
      )
      const repository = new ProductDeviceRepository(transaction)
      if (
        (await repository.fingerprintIsRegistered(admittedKey.fingerprint)) ||
        !(await repository.registrationChallengeCapacityAvailable(
          human.userId,
          admittedKey.fingerprint,
          new Date(issuedAtSeconds * 1_000),
          MAX_ACTIVE_REGISTRATION_CHALLENGES_PER_USER,
        ))
      ) {
        throw new ProductDeviceAuthFailure(
          'device_registration_challenge_invalid',
        )
      }
      await repository.createRegistrationChallenge({
        challengeId: payload.challengeId,
        targetUserId: human.userId,
        nonceHash: sha256Digest(nonce),
        createdAt: new Date(issuedAtSeconds * 1_000),
        expiresAt: new Date(expiresAtSeconds * 1_000),
        candidateDeviceId: payload.candidateDeviceId,
        candidatePublicJwk: admittedKey.canonicalPublicJwk,
        candidateFingerprint: admittedKey.fingerprint,
        deviceType: candidate.deviceType,
        label: candidate.label,
        platform: candidate.platform,
        appVersion: candidate.appVersion,
        protocolVersion: candidate.protocolVersion,
        proofVersion: PRODUCT_DEVICE_PROOF_VERSION,
        audience: PRODUCT_DEVICE_AUDIENCE,
      })
    })
    return { challenge: payload, publicKeyFingerprint: admittedKey.fingerprint }
  }

  public async registerProductDevice(
    human: AuthenticatedHumanRequestContext,
    untrustedCompletion: unknown,
  ): Promise<ReturnType<typeof toPublicDevice>> {
    let completion: z.infer<typeof completeRegistrationSchema>
    try {
      completion = completeRegistrationSchema.parse(untrustedCompletion)
    } catch {
      throw new ProductDeviceAuthFailure(
        'device_registration_challenge_invalid',
      )
    }

    const repository = new ProductDeviceRepository(this.database)
    const challenge = await repository.findRegistrationChallenge(
      completion.challenge.challengeId,
    )
    const now = this.now()
    if (!challenge || challenge.targetUserId !== human.userId) {
      throw new ProductDeviceAuthFailure(
        'device_registration_challenge_invalid',
      )
    }
    if (challenge.consumedAt) {
      throw new ProductDeviceAuthFailure(
        'device_registration_challenge_consumed',
      )
    }
    if (challenge.expiresAt <= now) {
      throw new ProductDeviceAuthFailure(
        'device_registration_challenge_expired',
      )
    }
    if (!challengeMatchesPayload(challenge, completion.challenge)) {
      throw new ProductDeviceAuthFailure(
        'device_registration_challenge_invalid',
      )
    }

    let admittedKey: Awaited<ReturnType<typeof admitProductDevicePublicJwk>>
    try {
      admittedKey = await admitProductDevicePublicJwk(
        JSON.parse(challenge.candidatePublicJwk),
      )
      if (
        admittedKey.canonicalPublicJwk !== challenge.candidatePublicJwk ||
        admittedKey.fingerprint !== challenge.candidateFingerprint
      ) {
        throw new Error('Stored ProductDevice key identity is inconsistent')
      }
      await verifyRegistrationChallengeProof(
        completion.proof,
        admittedKey.publicJwk,
        completion.challenge,
      )
    } catch {
      throw new ProductDeviceAuthFailure('device_signature_invalid')
    }

    const completed = await this.database.transaction(async (transaction) => {
      const transactional = new ProductDeviceRepository(transaction)
      const current = await transactional.findRegistrationChallenge(
        challenge.challengeId,
      )
      if (
        !current ||
        current.consumedAt ||
        current.expiresAt <= now ||
        !challengeMatchesPayload(current, completion.challenge)
      ) {
        return false
      }
      if (
        !(await transactional.consumeRegistrationChallenge(
          current.challengeId,
          human.userId,
          now,
        ))
      ) {
        return false
      }
      await transactional.createProductDeviceFromChallenge(current, now)
      await new ControlPlaneRepository(transaction).appendSecurityEvent({
        eventId: createSecurityEventId(),
        eventType: 'device_registered',
        actorKind: 'user',
        actorId: human.userId,
        targetKind: 'device',
        targetId: current.candidateDeviceId,
        outcome: 'success',
        reasonCode: null,
        correlationId: current.challengeId,
        occurredAt: now,
      })
      return true
    })
    if (!completed) {
      const current = await repository.findRegistrationChallenge(
        challenge.challengeId,
      )
      throw new ProductDeviceAuthFailure(
        current && current.expiresAt <= this.now()
          ? 'device_registration_challenge_expired'
          : 'device_registration_challenge_consumed',
      )
    }

    const device = await repository.findProductDevice(
      challenge.candidateDeviceId,
    )
    if (!device) {
      throw new ProductDeviceAuthFailure('device_auth_unavailable')
    }
    return toPublicDevice(device)
  }

  public async authenticateProductDeviceRequest(
    human: AuthenticatedHumanRequestContext,
    input: {
      readonly compactProof: string | undefined
      readonly method: string
      readonly rawResource: string
      readonly body: Uint8Array
    },
  ): Promise<AuthenticatedProductDeviceContext> {
    if (!input.compactProof) {
      throw new ProductDeviceAuthFailure('device_auth_required')
    }

    let proof
    try {
      proof = parseUnverifiedDeviceRequestProof(input.compactProof)
    } catch (error) {
      throw proofParseFailure(error)
    }

    try {
      const repository = new ProductDeviceRepository(this.database)
      const device = await repository.findProductDevice(proof.deviceId)
      if (!device) {
        throw new ProductDeviceAuthFailure('device_not_found')
      }
      if (device.ownerUserId !== human.userId) {
        throw new ProductDeviceAuthFailure('device_owner_mismatch')
      }
      if (device.revokedAt) {
        throw new ProductDeviceAuthFailure('device_revoked')
      }
      if (device.keyGeneration !== proof.keyGeneration) {
        throw new ProductDeviceAuthFailure('device_key_generation_stale')
      }
      if (device.keyAlgorithm !== PRODUCT_DEVICE_KEY_ALGORITHM) {
        throw new ProductDeviceAuthFailure('device_algorithm_unsupported')
      }

      let publicJwk: ProductDevicePublicJwk
      try {
        const admittedKey = await admitProductDevicePublicJwk(
          productDevicePublicJwkSchema.parse(JSON.parse(device.publicKey)),
        )
        if (
          admittedKey.canonicalPublicJwk !== device.publicKey ||
          admittedKey.fingerprint !== device.fingerprint
        ) {
          throw new Error('Stored ProductDevice key identity is inconsistent')
        }
        publicJwk = admittedKey.publicJwk
      } catch {
        throw new ProductDeviceAuthFailure('device_algorithm_unsupported')
      }

      if (proof.aud !== PRODUCT_DEVICE_AUDIENCE) {
        throw new ProductDeviceAuthFailure('device_proof_audience_mismatch')
      }
      if (
        proof.v !== PRODUCT_DEVICE_PROOF_VERSION ||
        proof.protocolVersion !== PRODUCT_DEVICE_PROTOCOL_VERSION
      ) {
        throw new ProductDeviceAuthFailure('device_proof_version_unsupported')
      }
      if (
        !/^[A-Z]{3,16}$/.test(input.method) ||
        proof.method !== input.method
      ) {
        throw new ProductDeviceAuthFailure('device_proof_method_mismatch')
      }
      let resource: string
      try {
        resource = canonicalizeDeviceRequestResource(input.rawResource)
      } catch {
        throw new ProductDeviceAuthFailure('device_proof_resource_mismatch')
      }
      if (proof.resource !== resource) {
        throw new ProductDeviceAuthFailure('device_proof_resource_mismatch')
      }
      if (!equalDigest(proof.bodySha256, sha256Digest(input.body))) {
        throw new ProductDeviceAuthFailure('device_proof_body_mismatch')
      }
      if (!equalDigest(proof.authTokenHash, human.authTokenHash)) {
        throw new ProductDeviceAuthFailure(
          'device_proof_token_binding_mismatch',
        )
      }

      const now = this.now()
      const nowSeconds = Math.floor(now.getTime() / 1_000)
      if (proof.iat < nowSeconds - PRODUCT_DEVICE_CLOCK_SKEW_SECONDS) {
        throw new ProductDeviceAuthFailure('device_proof_expired')
      }
      if (proof.iat > nowSeconds + PRODUCT_DEVICE_CLOCK_SKEW_SECONDS) {
        throw new ProductDeviceAuthFailure('device_proof_future')
      }
      try {
        await verifyDeviceRequestProofSignature(
          input.compactProof,
          publicJwk,
          proof,
        )
      } catch {
        throw new ProductDeviceAuthFailure('device_signature_invalid')
      }

      const replayed = await this.database.transaction(async (transaction) => {
        const transactional = new ProductDeviceRepository(transaction)
        const reserved = await transactional.reserveRequestNonce({
          deviceId: device.deviceId,
          keyGeneration: device.keyGeneration,
          authTokenHash: human.authTokenHash,
          nonceHash: sha256Digest(proof.nonce),
          issuedAt: new Date(proof.iat * 1_000),
          observedAt: now,
          expiresAt: new Date(
            (proof.iat + PRODUCT_DEVICE_CLOCK_SKEW_SECONDS + 1) * 1_000,
          ),
        })
        if (!reserved) {
          await new ControlPlaneRepository(transaction).appendSecurityEvent({
            eventId: createSecurityEventId(),
            eventType: 'replay_rejected',
            actorKind: 'device',
            actorId: device.deviceId,
            targetKind: 'device',
            targetId: device.deviceId,
            outcome: 'failure',
            reasonCode: 'device_proof_replayed',
            correlationId: null,
            occurredAt: now,
          })
          return true
        }
        if (
          !(await transactional.touchProductDevice(
            device.deviceId,
            device.keyGeneration,
            now,
          ))
        ) {
          throw new ProductDeviceAuthFailure('device_revoked')
        }
        return false
      })
      if (replayed) {
        throw new ProductDeviceAuthFailure('device_proof_replayed')
      }

      return {
        userId: human.userId,
        deviceId: device.deviceId,
        deviceType: device.deviceType,
        keyGeneration: device.keyGeneration,
      }
    } catch (error) {
      if (error instanceof ProductDeviceAuthFailure) throw error
      throw new ProductDeviceAuthFailure('device_auth_unavailable')
    }
  }

  public async revokeProductDevice(
    actor: AuthenticatedProductDeviceContext,
    untrustedTargetDeviceId: string,
  ): Promise<void> {
    const targetDeviceId = productDeviceIdSchema.parse(untrustedTargetDeviceId)
    const now = this.now()
    const revoked = await this.database.transaction(async (transaction) => {
      const repository = new ProductDeviceRepository(transaction)
      const target = await repository.findProductDevice(targetDeviceId)
      if (!target) {
        throw new ProductDeviceAuthFailure('device_not_found')
      }
      if (target.ownerUserId !== actor.userId) {
        throw new ProductDeviceAuthFailure('device_owner_mismatch')
      }
      if (target.revokedAt) return false
      if (
        !(await repository.revokeOwnedProductDevice(
          targetDeviceId,
          actor.userId,
          now,
        ))
      ) {
        return false
      }
      await new ControlPlaneRepository(transaction).appendSecurityEvent({
        eventId: createSecurityEventId(),
        eventType: 'device_revoked',
        actorKind: 'device',
        actorId: actor.deviceId,
        targetKind: 'device',
        targetId: targetDeviceId,
        outcome: 'success',
        reasonCode: null,
        correlationId: null,
        occurredAt: now,
      })
      return true
    })
    if (!revoked) throw new ProductDeviceAuthFailure('device_revoked')
  }

  public async cleanupExpiredReplayState(limit = 500): Promise<number> {
    const boundedLimit = z.number().int().min(1).max(1_000).parse(limit)
    return new ProductDeviceRepository(
      this.database,
    ).cleanupExpiredRequestNonces(this.now(), boundedLimit)
  }

  public async readProductDevice(
    deviceId: ProductDeviceId,
  ): Promise<ReturnType<typeof toPublicDevice> | null> {
    const device = await new ProductDeviceRepository(
      this.database,
    ).findProductDevice(deviceId)
    return device ? toPublicDevice(device) : null
  }
}

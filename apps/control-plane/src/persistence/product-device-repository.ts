import type {
  EnrollmentChallengeId,
  ProductDeviceId,
  UserId,
} from '../domain/ids.js'
import type { SqlExecutor } from './database.js'

interface DeviceRegistrationChallengeRow extends Record<string, unknown> {
  readonly challenge_id: string
  readonly target_user_id: string
  readonly nonce_hash: string
  readonly created_at: Date | string
  readonly expires_at: Date | string
  readonly consumed_at: Date | string | null
  readonly candidate_device_id: string
  readonly candidate_public_jwk: string
  readonly candidate_fingerprint: string
  readonly candidate_key_algorithm: string
  readonly device_type: ProductDeviceRecord['deviceType']
  readonly label: string
  readonly platform: string
  readonly app_version: string
  readonly protocol_version: number
  readonly proof_version: number
  readonly audience: string
}

interface ProductDeviceRow extends Record<string, unknown> {
  readonly device_id: string
  readonly owner_user_id: string
  readonly device_type: ProductDeviceRecord['deviceType']
  readonly public_key: string
  readonly key_algorithm: string
  readonly fingerprint: string
  readonly label: string
  readonly platform: string
  readonly app_version: string
  readonly protocol_version: number
  readonly key_generation: number
  readonly created_at: Date | string
  readonly last_seen_at: Date | string | null
  readonly revoked_at: Date | string | null
}

export interface DeviceRegistrationChallengeRecord {
  readonly challengeId: EnrollmentChallengeId
  readonly targetUserId: UserId
  readonly nonceHash: string
  readonly createdAt: Date
  readonly expiresAt: Date
  readonly consumedAt: Date | null
  readonly candidateDeviceId: ProductDeviceId
  readonly candidatePublicJwk: string
  readonly candidateFingerprint: string
  readonly candidateKeyAlgorithm: string
  readonly deviceType: 'desktop_host' | 'desktop_client' | 'mobile' | 'tablet'
  readonly label: string
  readonly platform: string
  readonly appVersion: string
  readonly protocolVersion: number
  readonly proofVersion: number
  readonly audience: string
}

export interface ProductDeviceRecord {
  readonly deviceId: ProductDeviceId
  readonly ownerUserId: UserId
  readonly deviceType: 'desktop_host' | 'desktop_client' | 'mobile' | 'tablet'
  readonly publicKey: string
  readonly keyAlgorithm: string
  readonly fingerprint: string
  readonly label: string
  readonly platform: string
  readonly appVersion: string
  readonly protocolVersion: number
  readonly keyGeneration: number
  readonly createdAt: Date
  readonly lastSeenAt: Date | null
  readonly revokedAt: Date | null
}

export interface CreateDeviceRegistrationChallengeRecord {
  readonly challengeId: EnrollmentChallengeId
  readonly targetUserId: UserId
  readonly nonceHash: string
  readonly createdAt: Date
  readonly expiresAt: Date
  readonly candidateDeviceId: ProductDeviceId
  readonly candidatePublicJwk: string
  readonly candidateFingerprint: string
  readonly deviceType: ProductDeviceRecord['deviceType']
  readonly label: string
  readonly platform: string
  readonly appVersion: string
  readonly protocolVersion: number
  readonly proofVersion: number
  readonly audience: string
}

interface RegistrationChallengeCapacityRow extends Record<string, unknown> {
  readonly fingerprint_available: boolean
  readonly user_capacity_available: boolean
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

function toOptionalDate(value: Date | string | null): Date | null {
  return value === null ? null : toDate(value)
}

function toChallenge(
  row: DeviceRegistrationChallengeRow,
): DeviceRegistrationChallengeRecord {
  return {
    challengeId: row.challenge_id as EnrollmentChallengeId,
    targetUserId: row.target_user_id as UserId,
    nonceHash: row.nonce_hash,
    createdAt: toDate(row.created_at),
    expiresAt: toDate(row.expires_at),
    consumedAt: toOptionalDate(row.consumed_at),
    candidateDeviceId: row.candidate_device_id as ProductDeviceId,
    candidatePublicJwk: row.candidate_public_jwk,
    candidateFingerprint: row.candidate_fingerprint,
    candidateKeyAlgorithm: row.candidate_key_algorithm,
    deviceType: row.device_type,
    label: row.label,
    platform: row.platform,
    appVersion: row.app_version,
    protocolVersion: row.protocol_version,
    proofVersion: row.proof_version,
    audience: row.audience,
  }
}

function toDevice(row: ProductDeviceRow): ProductDeviceRecord {
  return {
    deviceId: row.device_id as ProductDeviceId,
    ownerUserId: row.owner_user_id as UserId,
    deviceType: row.device_type,
    publicKey: row.public_key,
    keyAlgorithm: row.key_algorithm,
    fingerprint: row.fingerprint,
    label: row.label,
    platform: row.platform,
    appVersion: row.app_version,
    protocolVersion: row.protocol_version,
    keyGeneration: row.key_generation,
    createdAt: toDate(row.created_at),
    lastSeenAt: toOptionalDate(row.last_seen_at),
    revokedAt: toOptionalDate(row.revoked_at),
  }
}

const challengeProjection = `
  SELECT c.challenge_id, c.target_user_id, c.nonce_hash, c.created_at,
         c.expires_at, c.consumed_at, r.candidate_device_id,
         r.candidate_public_jwk, r.candidate_fingerprint,
         r.candidate_key_algorithm, r.device_type, r.label, r.platform,
         r.app_version, r.protocol_version, r.proof_version, r.audience
    FROM control_plane.enrollment_challenges c
    JOIN control_plane.device_registration_challenges r
      ON r.challenge_id = c.challenge_id
`

const deviceProjection = `
  SELECT device_id, owner_user_id, device_type, public_key, key_algorithm,
         fingerprint, label, platform, app_version, protocol_version,
         key_generation, created_at, last_seen_at, revoked_at
    FROM control_plane.product_devices
`

export class ProductDeviceRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public async createRegistrationChallenge(
    input: CreateDeviceRegistrationChallengeRecord,
  ): Promise<void> {
    await this.executor.query(
      `INSERT INTO control_plane.enrollment_challenges (
         challenge_id, purpose, target_user_id, target_space_id,
         target_device_id, target_host_id, nonce_hash, created_at, expires_at
       ) VALUES ($1, 'device_registration', $2, NULL, NULL, NULL, $3, $4, $5)`,
      [
        input.challengeId,
        input.targetUserId,
        input.nonceHash,
        input.createdAt,
        input.expiresAt,
      ],
    )
    await this.executor.query(
      `INSERT INTO control_plane.device_registration_challenges (
         challenge_id, candidate_device_id, candidate_public_jwk,
         candidate_fingerprint, candidate_key_algorithm, device_type, label,
         platform, app_version, protocol_version, proof_version, audience
       ) VALUES ($1, $2, $3, $4, 'ES256', $5, $6, $7, $8, $9, $10, $11)`,
      [
        input.challengeId,
        input.candidateDeviceId,
        input.candidatePublicJwk,
        input.candidateFingerprint,
        input.deviceType,
        input.label,
        input.platform,
        input.appVersion,
        input.protocolVersion,
        input.proofVersion,
        input.audience,
      ],
    )
  }

  public async findRegistrationChallenge(
    challengeId: EnrollmentChallengeId,
  ): Promise<DeviceRegistrationChallengeRecord | null> {
    const result = await this.executor.query<DeviceRegistrationChallengeRow>(
      `${challengeProjection}
        WHERE c.challenge_id = $1 AND c.purpose = 'device_registration'`,
      [challengeId],
    )
    const row = result.rows[0]
    return row ? toChallenge(row) : null
  }

  public async consumeRegistrationChallenge(
    challengeId: EnrollmentChallengeId,
    userId: UserId,
    consumedAt: Date,
  ): Promise<boolean> {
    const result = await this.executor.query<{ challenge_id: string }>(
      `UPDATE control_plane.enrollment_challenges
          SET consumed_at = $3
        WHERE challenge_id = $1
          AND purpose = 'device_registration'
          AND target_user_id = $2
          AND consumed_at IS NULL
          AND expires_at > $3
      RETURNING challenge_id`,
      [challengeId, userId, consumedAt],
    )
    return result.rowCount === 1
  }

  public async createProductDeviceFromChallenge(
    challenge: DeviceRegistrationChallengeRecord,
    createdAt: Date,
  ): Promise<void> {
    await this.executor.query(
      `INSERT INTO control_plane.product_devices (
         device_id, owner_user_id, device_type, public_key, key_algorithm,
         fingerprint, label, platform, app_version, protocol_version,
         key_generation, created_at
       ) VALUES ($1, $2, $3, $4, 'ES256', $5, $6, $7, $8, $9, 1, $10)`,
      [
        challenge.candidateDeviceId,
        challenge.targetUserId,
        challenge.deviceType,
        challenge.candidatePublicJwk,
        challenge.candidateFingerprint,
        challenge.label,
        challenge.platform,
        challenge.appVersion,
        challenge.protocolVersion,
        createdAt,
      ],
    )
  }

  public async findProductDevice(
    deviceId: ProductDeviceId,
  ): Promise<ProductDeviceRecord | null> {
    const result = await this.executor.query<ProductDeviceRow>(
      `${deviceProjection} WHERE device_id = $1`,
      [deviceId],
    )
    const row = result.rows[0]
    return row ? toDevice(row) : null
  }

  public async findProductDeviceForUpdate(
    deviceId: ProductDeviceId,
  ): Promise<ProductDeviceRecord | null> {
    const result = await this.executor.query<ProductDeviceRow>(
      `${deviceProjection} WHERE device_id = $1 FOR UPDATE`,
      [deviceId],
    )
    const row = result.rows[0]
    return row ? toDevice(row) : null
  }

  public async fingerprintIsRegistered(fingerprint: string): Promise<boolean> {
    const result = await this.executor.query<{ present: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM control_plane.product_devices WHERE fingerprint = $1
       ) AS present`,
      [fingerprint],
    )
    return result.rows[0]?.present === true
  }

  public async registrationChallengeCapacityAvailable(
    userId: UserId,
    fingerprint: string,
    now: Date,
    maximumActiveForUser: number,
  ): Promise<boolean> {
    const result = await this.executor.query<RegistrationChallengeCapacityRow>(
      `SELECT
           NOT EXISTS (
             SELECT 1
               FROM control_plane.enrollment_challenges c
               JOIN control_plane.device_registration_challenges r
                 ON r.challenge_id = c.challenge_id
              WHERE c.target_user_id = $1
                AND c.purpose = 'device_registration'
                AND c.consumed_at IS NULL
                AND c.expires_at > $3
                AND r.candidate_fingerprint = $2
           ) AS fingerprint_available,
           (
             SELECT count(*) < $4::integer
               FROM control_plane.enrollment_challenges c
              WHERE c.target_user_id = $1
                AND c.purpose = 'device_registration'
                AND c.consumed_at IS NULL
                AND c.expires_at > $3
           ) AS user_capacity_available`,
      [userId, fingerprint, now, maximumActiveForUser],
    )
    const row = result.rows[0]
    return (
      row?.fingerprint_available === true &&
      row.user_capacity_available === true
    )
  }

  public async reserveRequestNonce(input: {
    readonly deviceId: ProductDeviceId
    readonly keyGeneration: number
    readonly authTokenHash: string
    readonly nonceHash: string
    readonly issuedAt: Date
    readonly observedAt: Date
    readonly expiresAt: Date
  }): Promise<boolean> {
    const result = await this.executor.query<{ nonce_hash: string }>(
      `INSERT INTO control_plane.device_request_nonces (
         device_id, key_generation, auth_token_hash, nonce_hash, issued_at,
         observed_at, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (device_id, key_generation, nonce_hash) DO NOTHING
       RETURNING nonce_hash`,
      [
        input.deviceId,
        input.keyGeneration,
        input.authTokenHash,
        input.nonceHash,
        input.issuedAt,
        input.observedAt,
        input.expiresAt,
      ],
    )
    return result.rowCount === 1
  }

  public async touchProductDevice(
    deviceId: ProductDeviceId,
    keyGeneration: number,
    lastSeenAt: Date,
  ): Promise<boolean> {
    const result = await this.executor.query<{ device_id: string }>(
      `UPDATE control_plane.product_devices
          SET last_seen_at = $3
        WHERE device_id = $1
          AND key_generation = $2
          AND revoked_at IS NULL
      RETURNING device_id`,
      [deviceId, keyGeneration, lastSeenAt],
    )
    return result.rowCount === 1
  }

  public async revokeOwnedProductDevice(
    deviceId: ProductDeviceId,
    ownerUserId: UserId,
    revokedAt: Date,
  ): Promise<boolean> {
    const result = await this.executor.query<{ device_id: string }>(
      `UPDATE control_plane.product_devices
          SET revoked_at = $3
        WHERE device_id = $1
          AND owner_user_id = $2
          AND revoked_at IS NULL
      RETURNING device_id`,
      [deviceId, ownerUserId, revokedAt],
    )
    return result.rowCount === 1
  }

  public async cleanupExpiredRequestNonces(
    now: Date,
    limit: number,
  ): Promise<number> {
    const result = await this.executor.query<{ nonce_hash: string }>(
      `WITH expired AS (
         SELECT device_id, key_generation, nonce_hash
           FROM control_plane.device_request_nonces
          WHERE expires_at <= $1
          ORDER BY expires_at, device_id, key_generation, nonce_hash
          LIMIT $2
       )
       DELETE FROM control_plane.device_request_nonces n
       USING expired e
       WHERE n.device_id = e.device_id
         AND n.key_generation = e.key_generation
         AND n.nonce_hash = e.nonce_hash
       RETURNING n.nonce_hash`,
      [now, limit],
    )
    return result.rowCount
  }
}

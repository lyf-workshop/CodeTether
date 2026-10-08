import type {
  EnrollmentChallengeId,
  HostAuthorizationId,
  HostClaimId,
  HostId,
  ProductDeviceId,
  SpaceId,
  UserId,
} from '../domain/ids.js'
import type { SqlExecutor } from './database.js'
import {
  supervisorGrantDigest,
  supervisorTransportLimits,
  type SignedSupervisorGrant,
  type SignedSupervisorHostPresence,
  type SignedSupervisorTransportDescriptor,
} from '@codetether/supervisor-transport'
const asDate = (value: Date | string): Date =>
  value instanceof Date ? value : new Date(value)
const optionalDate = (value: Date | string | null): Date | null =>
  value === null ? null : asDate(value)

interface HostRow extends Record<string, unknown> {
  readonly host_id: HostId
  readonly owning_space_id: SpaceId | null
  readonly public_key: string
  readonly key_algorithm: 'ES256'
  readonly fingerprint: string
  readonly safe_label: string
  readonly coarse_platform: 'windows' | 'macos' | 'linux' | 'unknown'
  readonly protocol_version_min: number
  readonly protocol_version_max: number
  readonly claim_generation: number
  readonly claim_state:
    'unclaimed' | 'pending' | 'claimed' | 'unlinked' | 'revoked'
  readonly revoked_at: Date | string | null
  readonly created_at: Date | string
  readonly updated_at: Date | string
}

interface RegistrationRow extends Record<string, unknown> {
  readonly challenge_id: EnrollmentChallengeId
  readonly candidate_host_id: HostId
  readonly candidate_public_key: string
  readonly candidate_key_algorithm: 'ES256'
  readonly candidate_fingerprint: string
  readonly safe_label: string
  readonly coarse_platform: 'windows' | 'macos' | 'linux' | 'unknown'
  readonly protocol_version_min: number
  readonly protocol_version_max: number
  readonly nonce_hash: string
  readonly created_at: Date | string
  readonly expires_at: Date | string
  readonly consumed_at: Date | string | null
}

interface ClaimRow extends Record<string, unknown> {
  readonly claim_id: HostClaimId
  readonly host_id: HostId
  readonly space_id: SpaceId
  readonly requesting_user_id: UserId
  readonly requesting_device_id: ProductDeviceId
  readonly claim_generation: number
  readonly challenge_id: EnrollmentChallengeId
  readonly state:
    'requested' | 'confirmed' | 'completed' | 'expired' | 'rejected' | 'revoked'
  readonly requested_at: Date | string
  readonly expires_at: Date | string
  readonly confirmed_at: Date | string | null
  readonly completed_at: Date | string | null
  readonly revoked_at: Date | string | null
  readonly proof_version: number
  readonly audience: string
  readonly nonce_hash: string
  readonly challenge_expires_at: Date | string
  readonly challenge_consumed_at: Date | string | null
  readonly challenge_purpose: 'host_claim'
  readonly challenge_target_user_id: UserId
  readonly challenge_target_space_id: SpaceId
  readonly challenge_target_device_id: ProductDeviceId
  readonly challenge_target_host_id: HostId
}

interface ServerTimeRow extends Record<string, unknown> {
  readonly server_time: Date | string
}

interface AuthorizationChallengeRow extends Record<string, unknown> {
  readonly challenge_id: EnrollmentChallengeId
  readonly purpose: 'host_device_authorization'
  readonly target_user_id: UserId
  readonly target_space_id: SpaceId
  readonly target_device_id: ProductDeviceId
  readonly target_host_id: HostId
  readonly nonce_hash: string
  readonly created_at: Date | string
  readonly expires_at: Date | string
  readonly consumed_at: Date | string | null
}

interface AuthorizationRow extends Record<string, unknown> {
  readonly authorization_id: HostAuthorizationId
  readonly host_id: HostId
  readonly claim_generation: number
  readonly device_id: ProductDeviceId
  readonly device_key_generation: number
  readonly device_fingerprint: string
  readonly user_id: UserId
  readonly space_id: SpaceId
  readonly scope: 'supervisor_read'
  readonly authorization_serial: string | number | bigint
  readonly authorization_generation: number
  readonly issued_at: Date | string
  readonly expires_at: Date | string
  readonly revoked_at: Date | string | null
  readonly supervisor_grant_payload: unknown | null
  readonly supervisor_grant_proof: string | null
  readonly supervisor_grant_materialized_at: Date | string | null
  readonly supervisor_transport_payload: unknown | null
  readonly supervisor_transport_proof: string | null
  readonly supervisor_transport_expires_at: Date | string | null
}
export interface HostRecord {
  readonly hostId: HostId
  readonly owningSpaceId: SpaceId | null
  readonly publicKey: string
  readonly keyAlgorithm: 'ES256'
  readonly fingerprint: string
  readonly safeLabel: string
  readonly coarsePlatform: 'windows' | 'macos' | 'linux' | 'unknown'
  readonly protocolVersionMin: number
  readonly protocolVersionMax: number
  readonly claimGeneration: number
  readonly claimState:
    'unclaimed' | 'pending' | 'claimed' | 'unlinked' | 'revoked'
  readonly revokedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface HostRegistrationChallengeRecord {
  readonly challengeId: EnrollmentChallengeId
  readonly hostId: HostId
  readonly publicKey: string
  readonly keyAlgorithm: 'ES256'
  readonly fingerprint: string
  readonly safeLabel: string
  readonly coarsePlatform: HostRecord['coarsePlatform']
  readonly protocolVersionMin: number
  readonly protocolVersionMax: number
  readonly nonceHash: string
  readonly createdAt: Date
  readonly expiresAt: Date
  readonly consumedAt: Date | null
}

export interface HostClaimRecord {
  readonly claimId: HostClaimId
  readonly hostId: HostId
  readonly spaceId: SpaceId
  readonly requestingUserId: UserId
  readonly requestingDeviceId: ProductDeviceId
  readonly claimGeneration: number
  readonly challengeId: EnrollmentChallengeId
  readonly state:
    'requested' | 'confirmed' | 'completed' | 'expired' | 'rejected' | 'revoked'
  readonly requestedAt: Date
  readonly expiresAt: Date
  readonly confirmedAt: Date | null
  readonly completedAt: Date | null
  readonly revokedAt: Date | null
  readonly proofVersion: number
  readonly audience: string
  readonly nonceHash: string
  readonly challengeExpiresAt: Date
  readonly challengeConsumedAt: Date | null
  readonly challengePurpose: 'host_claim'
  readonly challengeTargetUserId: UserId
  readonly challengeTargetSpaceId: SpaceId
  readonly challengeTargetDeviceId: ProductDeviceId
  readonly challengeTargetHostId: HostId
}

export interface HostClaimExpirationEventRecord {
  readonly actorKind: string
  readonly actorId: string
  readonly targetKind: string | null
  readonly targetId: string | null
  readonly outcome: string
  readonly reasonCode: string | null
}

export interface HostDeviceAuthorizationChallengeRecord {
  readonly challengeId: EnrollmentChallengeId
  readonly purpose: 'host_device_authorization'
  readonly userId: UserId
  readonly spaceId: SpaceId
  readonly deviceId: ProductDeviceId
  readonly hostId: HostId
  readonly nonceHash: string
  readonly createdAt: Date
  readonly expiresAt: Date
  readonly consumedAt: Date | null
}

export interface HostDeviceAuthorizationRecord {
  readonly authorizationId: HostAuthorizationId
  readonly hostId: HostId
  readonly hostIdentityGeneration: number
  readonly deviceId: ProductDeviceId
  readonly deviceKeyGeneration: number
  readonly deviceFingerprint: string
  readonly userId: UserId
  readonly spaceId: SpaceId
  readonly scope: 'supervisor_read'
  readonly authorizationSerial: bigint
  readonly authorizationGeneration: number
  readonly issuedAt: Date
  readonly expiresAt: Date
  readonly revokedAt: Date | null
  readonly supervisorGrant: SignedSupervisorGrant | null
  readonly supervisorGrantMaterializedAt: Date | null
  readonly supervisorTransport: SignedSupervisorTransportDescriptor | null
  readonly supervisorTransportExpiresAt: Date | null
}

export interface AuthorizedHostDirectoryRecord {
  readonly host: HostRecord
  readonly authorization: HostDeviceAuthorizationRecord
  readonly hostPresence: SignedSupervisorHostPresence | null
}

interface HostPresenceColumns extends Record<string, unknown> {
  readonly supervisor_host_presence_payload:
    SignedSupervisorHostPresence['payload'] | null
  readonly supervisor_host_presence_proof: string | null
  readonly supervisor_host_presence_expires_at: Date | string | null
}

function hostFromRow(row: HostRow): HostRecord {
  return {
    hostId: row.host_id,
    owningSpaceId: row.owning_space_id,
    publicKey: row.public_key,
    keyAlgorithm: row.key_algorithm,
    fingerprint: row.fingerprint,
    safeLabel: row.safe_label,
    coarsePlatform: row.coarse_platform,
    protocolVersionMin: row.protocol_version_min,
    protocolVersionMax: row.protocol_version_max,
    claimGeneration: row.claim_generation,
    claimState: row.claim_state,
    revokedAt: optionalDate(row.revoked_at),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  }
}

function registrationFromRow(
  row: RegistrationRow,
): HostRegistrationChallengeRecord {
  return {
    challengeId: row.challenge_id,
    hostId: row.candidate_host_id,
    publicKey: row.candidate_public_key,
    keyAlgorithm: row.candidate_key_algorithm,
    fingerprint: row.candidate_fingerprint,
    safeLabel: row.safe_label,
    coarsePlatform: row.coarse_platform,
    protocolVersionMin: row.protocol_version_min,
    protocolVersionMax: row.protocol_version_max,
    nonceHash: row.nonce_hash,
    createdAt: asDate(row.created_at),
    expiresAt: asDate(row.expires_at),
    consumedAt: optionalDate(row.consumed_at),
  }
}

function claimFromRow(row: ClaimRow): HostClaimRecord {
  return {
    claimId: row.claim_id,
    hostId: row.host_id,
    spaceId: row.space_id,
    requestingUserId: row.requesting_user_id,
    requestingDeviceId: row.requesting_device_id,
    claimGeneration: row.claim_generation,
    challengeId: row.challenge_id,
    state: row.state,
    requestedAt: asDate(row.requested_at),
    expiresAt: asDate(row.expires_at),
    confirmedAt: optionalDate(row.confirmed_at),
    completedAt: optionalDate(row.completed_at),
    revokedAt: optionalDate(row.revoked_at),
    proofVersion: row.proof_version,
    audience: row.audience,
    nonceHash: row.nonce_hash,
    challengeExpiresAt: asDate(row.challenge_expires_at),
    challengeConsumedAt: optionalDate(row.challenge_consumed_at),
    challengePurpose: row.challenge_purpose,
    challengeTargetUserId: row.challenge_target_user_id,
    challengeTargetSpaceId: row.challenge_target_space_id,
    challengeTargetDeviceId: row.challenge_target_device_id,
    challengeTargetHostId: row.challenge_target_host_id,
  }
}

function authorizationChallengeFromRow(
  row: AuthorizationChallengeRow,
): HostDeviceAuthorizationChallengeRecord {
  return {
    challengeId: row.challenge_id,
    purpose: row.purpose,
    userId: row.target_user_id,
    spaceId: row.target_space_id,
    deviceId: row.target_device_id,
    hostId: row.target_host_id,
    nonceHash: row.nonce_hash,
    createdAt: asDate(row.created_at),
    expiresAt: asDate(row.expires_at),
    consumedAt: optionalDate(row.consumed_at),
  }
}

function authorizationFromRow(
  row: AuthorizationRow,
): HostDeviceAuthorizationRecord {
  return {
    authorizationId: row.authorization_id,
    hostId: row.host_id,
    hostIdentityGeneration: row.claim_generation,
    deviceId: row.device_id,
    deviceKeyGeneration: row.device_key_generation,
    deviceFingerprint: row.device_fingerprint,
    userId: row.user_id,
    spaceId: row.space_id,
    scope: row.scope,
    authorizationSerial: BigInt(row.authorization_serial),
    authorizationGeneration: row.authorization_generation,
    issuedAt: asDate(row.issued_at),
    expiresAt: asDate(row.expires_at),
    revokedAt: optionalDate(row.revoked_at),
    supervisorGrant:
      row.supervisor_grant_payload === null ||
      row.supervisor_grant_proof === null
        ? null
        : {
            payload:
              row.supervisor_grant_payload as SignedSupervisorGrant['payload'],
            proof: row.supervisor_grant_proof,
          },
    supervisorGrantMaterializedAt: optionalDate(
      row.supervisor_grant_materialized_at,
    ),
    supervisorTransport:
      row.supervisor_transport_payload === null ||
      row.supervisor_transport_proof === null
        ? null
        : {
            payload:
              row.supervisor_transport_payload as SignedSupervisorTransportDescriptor['payload'],
            proof: row.supervisor_transport_proof,
          },
    supervisorTransportExpiresAt: optionalDate(
      row.supervisor_transport_expires_at,
    ),
  }
}

export class HostIdentityRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public async createRegistrationChallenge(
    input: Omit<HostRegistrationChallengeRecord, 'consumedAt'>,
  ): Promise<void> {
    await this.executor.query(
      `INSERT INTO control_plane.host_registration_challenges (
      challenge_id, candidate_host_id, candidate_public_key, candidate_key_algorithm,
      candidate_fingerprint, safe_label, coarse_platform, protocol_version_min,
      protocol_version_max, nonce_hash, created_at, expires_at
    ) VALUES ($1,$2,$3,'ES256',$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        input.challengeId,
        input.hostId,
        input.publicKey,
        input.fingerprint,
        input.safeLabel,
        input.coarsePlatform,
        input.protocolVersionMin,
        input.protocolVersionMax,
        input.nonceHash,
        input.createdAt,
        input.expiresAt,
      ],
    )
  }

  public async findRegistrationChallenge(
    challengeId: EnrollmentChallengeId,
  ): Promise<HostRegistrationChallengeRecord | null> {
    const result = await this.executor.query<RegistrationRow>(
      'SELECT * FROM control_plane.host_registration_challenges WHERE challenge_id = $1',
      [challengeId],
    )
    return result.rows[0] ? registrationFromRow(result.rows[0]) : null
  }

  public async registerHostFromChallenge(
    challenge: HostRegistrationChallengeRecord,
    now: Date,
  ): Promise<boolean> {
    const consumed = await this.executor.query<RegistrationRow>(
      `UPDATE control_plane.host_registration_challenges SET consumed_at=$2 WHERE challenge_id=$1 AND consumed_at IS NULL AND expires_at>$2 RETURNING challenge_id`,
      [challenge.challengeId, now],
    )
    if (consumed.rowCount !== 1) return false
    const inserted = await this.executor.query<HostRow>(
      `INSERT INTO control_plane.hosts (
      host_id, owning_space_id, public_key, key_algorithm, fingerprint, safe_label,
      coarse_platform, protocol_version_min, protocol_version_max, claim_generation,
      claim_state, created_at, updated_at
    ) VALUES ($1,NULL,$2,'ES256',$3,$4,$5,$6,$7,1,'unclaimed',$8,$8)
    ON CONFLICT DO NOTHING RETURNING host_id`,
      [
        challenge.hostId,
        challenge.publicKey,
        challenge.fingerprint,
        challenge.safeLabel,
        challenge.coarsePlatform,
        challenge.protocolVersionMin,
        challenge.protocolVersionMax,
        now,
      ],
    )
    return inserted.rowCount === 1
  }

  public async findHost(hostId: HostId): Promise<HostRecord | null> {
    const result = await this.executor.query<HostRow>(
      'SELECT * FROM control_plane.hosts WHERE host_id=$1',
      [hostId],
    )
    return result.rows[0] ? hostFromRow(result.rows[0]) : null
  }

  public async findHostForUpdate(hostId: HostId): Promise<HostRecord | null> {
    const result = await this.executor.query<HostRow>(
      'SELECT * FROM control_plane.hosts WHERE host_id=$1 FOR UPDATE',
      [hostId],
    )
    return result.rows[0] ? hostFromRow(result.rows[0]) : null
  }

  public async createClaim(input: {
    claimId: HostClaimId
    hostId: HostId
    spaceId: SpaceId
    userId: UserId
    deviceId: ProductDeviceId
    claimGeneration: number
    challengeId: EnrollmentChallengeId
    nonceHash: string
    requestedAt: Date
    expiresAt: Date
    proofVersion: number
    audience: string
  }): Promise<boolean> {
    const host = await this.executor.query<HostRow>(
      `UPDATE control_plane.hosts SET claim_state='pending', updated_at=$2 WHERE host_id=$1 AND owning_space_id IS NULL AND claim_state='unclaimed' AND claim_generation=$3 AND revoked_at IS NULL RETURNING host_id`,
      [input.hostId, input.requestedAt, input.claimGeneration],
    )
    if (host.rowCount !== 1) return false
    const inserted = await this.executor.query<ClaimRow>(
      `INSERT INTO control_plane.enrollment_challenges (challenge_id,purpose,target_user_id,target_space_id,target_device_id,target_host_id,nonce_hash,created_at,expires_at) VALUES ($1,'host_claim',$2,$3,$4,$5,$6,$7,$8) RETURNING challenge_id`,
      [
        input.challengeId,
        input.userId,
        input.spaceId,
        input.deviceId,
        input.hostId,
        input.nonceHash,
        input.requestedAt,
        input.expiresAt,
      ],
    )
    if (inserted.rowCount !== 1) return false
    await this.executor.query(
      `INSERT INTO control_plane.host_claims (claim_id,host_id,space_id,requesting_user_id,requesting_device_id,claim_generation,challenge_id,state,requested_at,expires_at,proof_version,audience) VALUES ($1,$2,$3,$4,$5,$6,$7,'requested',$8,$9,$10,$11)`,
      [
        input.claimId,
        input.hostId,
        input.spaceId,
        input.userId,
        input.deviceId,
        input.claimGeneration,
        input.challengeId,
        input.requestedAt,
        input.expiresAt,
        input.proofVersion,
        input.audience,
      ],
    )
    return true
  }

  public async findClaim(
    claimId: HostClaimId,
  ): Promise<HostClaimRecord | null> {
    const result = await this.executor.query<ClaimRow>(
      `SELECT c.*, e.nonce_hash, e.expires_at AS challenge_expires_at,
              e.consumed_at AS challenge_consumed_at,
              e.purpose AS challenge_purpose,
              e.target_user_id AS challenge_target_user_id,
              e.target_space_id AS challenge_target_space_id,
              e.target_device_id AS challenge_target_device_id,
              e.target_host_id AS challenge_target_host_id
         FROM control_plane.host_claims c
         JOIN control_plane.enrollment_challenges e
           ON e.challenge_id=c.challenge_id
        WHERE c.claim_id=$1`,
      [claimId],
    )
    return result.rows[0] ? claimFromRow(result.rows[0]) : null
  }

  public async findClaimForUpdate(
    claimId: HostClaimId,
  ): Promise<HostClaimRecord | null> {
    const result = await this.executor.query<ClaimRow>(
      `SELECT c.*, e.nonce_hash, e.expires_at AS challenge_expires_at,
              e.consumed_at AS challenge_consumed_at,
              e.purpose AS challenge_purpose,
              e.target_user_id AS challenge_target_user_id,
              e.target_space_id AS challenge_target_space_id,
              e.target_device_id AS challenge_target_device_id,
              e.target_host_id AS challenge_target_host_id
         FROM control_plane.host_claims c
         JOIN control_plane.enrollment_challenges e
           ON e.challenge_id=c.challenge_id
        WHERE c.claim_id=$1
        FOR UPDATE OF c`,
      [claimId],
    )
    return result.rows[0] ? claimFromRow(result.rows[0]) : null
  }

  public async readServerTime(): Promise<Date> {
    const result = await this.executor.query<ServerTimeRow>(
      'SELECT clock_timestamp() AS server_time',
    )
    const value = result.rows[0]?.server_time
    if (!value) throw new Error('Control Plane server time unavailable')
    return asDate(value)
  }

  public async createDeviceAuthorizationChallenge(input: {
    challengeId: EnrollmentChallengeId
    userId: UserId
    spaceId: SpaceId
    deviceId: ProductDeviceId
    hostId: HostId
    nonceHash: string
    createdAt: Date
    expiresAt: Date
  }): Promise<void> {
    await this.executor.query(
      `INSERT INTO control_plane.enrollment_challenges (
         challenge_id, purpose, target_user_id, target_space_id,
         target_device_id, target_host_id, nonce_hash, created_at, expires_at
       ) VALUES ($1,'host_device_authorization',$2,$3,$4,$5,$6,$7,$8)`,
      [
        input.challengeId,
        input.userId,
        input.spaceId,
        input.deviceId,
        input.hostId,
        input.nonceHash,
        input.createdAt,
        input.expiresAt,
      ],
    )
  }

  public async findDeviceAuthorizationChallenge(
    challengeId: EnrollmentChallengeId,
    forUpdate = false,
  ): Promise<HostDeviceAuthorizationChallengeRecord | null> {
    const result = await this.executor.query<AuthorizationChallengeRow>(
      `SELECT challenge_id, purpose, target_user_id, target_space_id,
              target_device_id, target_host_id, nonce_hash, created_at,
              expires_at, consumed_at
         FROM control_plane.enrollment_challenges
        WHERE challenge_id=$1
          AND purpose='host_device_authorization'
        ${forUpdate ? 'FOR UPDATE' : ''}`,
      [challengeId],
    )
    return result.rows[0] ? authorizationChallengeFromRow(result.rows[0]) : null
  }

  public async consumeDeviceAuthorizationChallenge(
    challengeId: EnrollmentChallengeId,
    consumedAt: Date,
  ): Promise<boolean> {
    const result = await this.executor.query<{ challenge_id: string }>(
      `UPDATE control_plane.enrollment_challenges
          SET consumed_at=$2
        WHERE challenge_id=$1
          AND purpose='host_device_authorization'
          AND consumed_at IS NULL
          AND expires_at>$2
      RETURNING challenge_id`,
      [challengeId, consumedAt],
    )
    return result.rowCount === 1
  }

  public async deleteUnconsumedDeviceAuthorizationChallenge(
    challengeId: EnrollmentChallengeId,
  ): Promise<void> {
    await this.executor.query(
      `DELETE FROM control_plane.enrollment_challenges
        WHERE challenge_id=$1
          AND purpose='host_device_authorization'
          AND consumed_at IS NULL`,
      [challengeId],
    )
  }

  public async findDeviceAuthorization(
    authorizationId: HostAuthorizationId,
  ): Promise<HostDeviceAuthorizationRecord | null> {
    const result = await this.executor.query<AuthorizationRow>(
      `SELECT * FROM control_plane.host_device_authorizations
        WHERE authorization_id=$1`,
      [authorizationId],
    )
    return result.rows[0] ? authorizationFromRow(result.rows[0]) : null
  }

  public async materializeSupervisorGrant(input: {
    authorizationId: HostAuthorizationId
    grant: SignedSupervisorGrant
    materializedAt: Date
  }): Promise<'stored' | 'same' | 'conflict'> {
    const existing = await this.findDeviceAuthorization(input.authorizationId)
    if (!existing) return 'conflict'
    if (existing.supervisorGrant !== null) {
      // JSONB does not preserve key insertion order.
      return supervisorGrantDigest(existing.supervisorGrant) ===
        supervisorGrantDigest(input.grant)
        ? 'same'
        : 'conflict'
    }
    const result = await this.executor.query<{ authorization_id: string }>(
      `UPDATE control_plane.host_device_authorizations
          SET supervisor_grant_payload=$2::jsonb,
              supervisor_grant_proof=$3,
              supervisor_grant_materialized_at=$4
        WHERE authorization_id=$1
          AND supervisor_grant_payload IS NULL
          AND supervisor_grant_proof IS NULL
          AND supervisor_grant_materialized_at IS NULL
      RETURNING authorization_id`,
      [
        input.authorizationId,
        JSON.stringify(input.grant.payload),
        input.grant.proof,
        input.materializedAt,
      ],
    )
    return result.rowCount === 1 ? 'stored' : 'conflict'
  }

  public async publishSupervisorTransport(input: {
    authorizationId: HostAuthorizationId
    descriptor: SignedSupervisorTransportDescriptor
    expiresAt: Date
    now: Date
  }): Promise<boolean> {
    const result = await this.executor.query<{ authorization_id: string }>(
      `UPDATE control_plane.host_device_authorizations
          SET supervisor_transport_payload=$2::jsonb,
              supervisor_transport_proof=$3,
              supervisor_transport_expires_at=$4
        WHERE authorization_id=$1
          AND supervisor_grant_payload IS NOT NULL
          AND supervisor_grant_proof IS NOT NULL
          AND revoked_at IS NULL
          AND expires_at>$5
      RETURNING authorization_id`,
      [
        input.authorizationId,
        JSON.stringify(input.descriptor.payload),
        input.descriptor.proof,
        input.expiresAt,
        input.now,
      ],
    )
    return result.rowCount === 1
  }

  public async publishHostSupervisorPresence(input: {
    hostId: HostId
    presence: SignedSupervisorHostPresence
    expiresAt: Date
    now: Date
  }): Promise<void> {
    await this.executor.query(
      `INSERT INTO control_plane.host_supervisor_presence
         (host_id, payload, proof, expires_at, updated_at)
       VALUES ($1, $2::jsonb, $3, $4, $5)
       ON CONFLICT (host_id) DO UPDATE
         SET payload=EXCLUDED.payload,
             proof=EXCLUDED.proof,
             expires_at=EXCLUDED.expires_at,
             updated_at=EXCLUDED.updated_at
       WHERE (EXCLUDED.payload->>'hostIdentityGeneration')::bigint >
                 (host_supervisor_presence.payload->>'hostIdentityGeneration')::bigint
          OR ((EXCLUDED.payload->>'hostIdentityGeneration')::bigint =
                 (host_supervisor_presence.payload->>'hostIdentityGeneration')::bigint
              AND (EXCLUDED.payload->>'iat')::bigint >
                 (host_supervisor_presence.payload->>'iat')::bigint
              AND EXCLUDED.expires_at > host_supervisor_presence.expires_at)`,
      [
        input.hostId,
        JSON.stringify(input.presence.payload),
        input.presence.proof,
        input.expiresAt,
        input.now,
      ],
    )
  }

  public async listEffectiveHostAuthorizations(
    hostId: HostId,
    userId: UserId,
    spaceId: SpaceId,
    now: Date,
  ): Promise<readonly HostDeviceAuthorizationRecord[]> {
    const result = await this.executor.query<AuthorizationRow>(
      `SELECT a.*
         FROM control_plane.host_device_authorizations a
         JOIN control_plane.hosts h ON h.host_id=a.host_id
         JOIN control_plane.product_devices d ON d.device_id=a.device_id
        WHERE a.host_id=$1 AND a.user_id=$2 AND a.space_id=$3
          AND a.scope='supervisor_read'
          AND a.revoked_at IS NULL AND a.expires_at>$4
          AND h.owning_space_id=a.space_id
          AND h.claim_generation=a.claim_generation
          AND h.claim_state='claimed' AND h.revoked_at IS NULL
          AND d.owner_user_id=a.user_id
          AND d.key_generation=a.device_key_generation
          AND d.fingerprint=a.device_fingerprint
          AND d.revoked_at IS NULL
        ORDER BY a.authorization_id
        LIMIT $5`,
      [
        hostId,
        userId,
        spaceId,
        now,
        supervisorTransportLimits.maximumActivations + 1,
      ],
    )
    if (result.rows.length > supervisorTransportLimits.maximumActivations) {
      throw new Error('Host Supervisor authorization capacity exceeded')
    }
    return result.rows.map(authorizationFromRow)
  }

  public async findEffectiveDeviceAuthorization(
    hostId: HostId,
    deviceId: ProductDeviceId,
    userId: UserId,
    spaceId: SpaceId,
    now: Date,
  ): Promise<HostDeviceAuthorizationRecord | null> {
    const result = await this.executor.query<AuthorizationRow>(
      `SELECT a.*
         FROM control_plane.host_device_authorizations a
         JOIN control_plane.hosts h ON h.host_id=a.host_id
         JOIN control_plane.product_devices d ON d.device_id=a.device_id
         JOIN control_plane.users u ON u.user_id=a.user_id
         JOIN control_plane.space_memberships m
           ON m.space_id=a.space_id AND m.user_id=a.user_id AND m.role='owner'
        WHERE a.host_id=$1
          AND a.device_id=$2
          AND a.user_id=$3
          AND a.space_id=$4
          AND a.scope='supervisor_read'
          AND a.revoked_at IS NULL
          AND a.expires_at>$5
          AND h.owning_space_id=a.space_id
          AND h.claim_generation=a.claim_generation
          AND h.claim_state='claimed'
          AND h.revoked_at IS NULL
          AND d.owner_user_id=a.user_id
          AND d.key_generation=a.device_key_generation
          AND d.fingerprint=a.device_fingerprint
          AND d.revoked_at IS NULL
          AND u.status='active'
        ORDER BY a.authorization_generation DESC, a.authorization_id
        LIMIT 1`,
      [hostId, deviceId, userId, spaceId, now],
    )
    return result.rows[0] ? authorizationFromRow(result.rows[0]) : null
  }

  /**
   * Directory projection for one exact authenticated User/ProductDevice pair.
   * Relational joins repeat the effective-access checks so a stale grant can
   * never make an unowned, revoked, or generation-mismatched Host visible.
   */
  public async listEffectiveAuthorizedHosts(
    deviceId: ProductDeviceId,
    userId: UserId,
    spaceId: SpaceId,
    now: Date,
  ): Promise<readonly AuthorizedHostDirectoryRecord[]> {
    const result = await this.executor.query<
      HostRow & AuthorizationRow & HostPresenceColumns
    >(
      `SELECT h.*,
              a.authorization_id, a.host_id, a.claim_generation,
              a.device_id, a.device_key_generation, a.device_fingerprint,
              a.user_id, a.space_id, a.scope, a.authorization_serial,
              a.authorization_generation, a.issued_at, a.expires_at,
              a.revoked_at, a.supervisor_grant_payload,
              a.supervisor_grant_proof, a.supervisor_grant_materialized_at,
              a.supervisor_transport_payload, a.supervisor_transport_proof,
              a.supervisor_transport_expires_at,
              p.payload AS supervisor_host_presence_payload,
              p.proof AS supervisor_host_presence_proof,
              p.expires_at AS supervisor_host_presence_expires_at
         FROM control_plane.host_device_authorizations a
         JOIN control_plane.hosts h ON h.host_id=a.host_id
         LEFT JOIN control_plane.host_supervisor_presence p ON p.host_id=h.host_id
         JOIN control_plane.product_devices d ON d.device_id=a.device_id
         JOIN control_plane.users u ON u.user_id=a.user_id
         JOIN control_plane.space_memberships m
           ON m.space_id=a.space_id AND m.user_id=a.user_id AND m.role='owner'
        WHERE a.device_id=$1
          AND a.user_id=$2
          AND a.space_id=$3
          AND a.scope='supervisor_read'
          AND a.revoked_at IS NULL
          AND a.expires_at>$4
          AND h.owning_space_id=a.space_id
          AND h.claim_generation=a.claim_generation
          AND h.claim_state='claimed'
          AND h.revoked_at IS NULL
          AND d.owner_user_id=a.user_id
          AND d.key_generation=a.device_key_generation
          AND d.fingerprint=a.device_fingerprint
          AND d.revoked_at IS NULL
          AND u.status='active'
        ORDER BY h.safe_label, h.host_id,
                 a.authorization_generation DESC, a.authorization_id`,
      [deviceId, userId, spaceId, now],
    )

    const seen = new Set<HostId>()
    const directory: AuthorizedHostDirectoryRecord[] = []
    for (const row of result.rows) {
      if (seen.has(row.host_id)) continue
      seen.add(row.host_id)
      directory.push({
        host: hostFromRow(row),
        authorization: authorizationFromRow(row),
        hostPresence:
          row.supervisor_host_presence_payload !== null &&
          row.supervisor_host_presence_proof !== null &&
          row.supervisor_host_presence_expires_at !== null &&
          asDate(row.supervisor_host_presence_expires_at) > now
            ? {
                payload: row.supervisor_host_presence_payload,
                proof: row.supervisor_host_presence_proof,
              }
            : null,
      })
    }
    return directory
  }

  public async nextDeviceAuthorizationSequence(
    hostId: HostId,
    deviceId: ProductDeviceId,
  ): Promise<{ serial: bigint; generation: number }> {
    const result = await this.executor.query<{
      next_serial: string | number | bigint
      next_generation: number
    }>(
      `SELECT
         (SELECT COALESCE(MAX(authorization_serial),0)+1
            FROM control_plane.host_device_authorizations
           WHERE host_id=$1) AS next_serial,
         (SELECT COALESCE(MAX(authorization_generation),0)+1
            FROM control_plane.host_device_authorizations
           WHERE host_id=$1 AND device_id=$2) AS next_generation`,
      [hostId, deviceId],
    )
    const row = result.rows[0]
    if (!row) throw new Error('Authorization sequence unavailable')
    return {
      serial: BigInt(row.next_serial),
      generation: Number(row.next_generation),
    }
  }

  public async revokeDeviceAuthorization(input: {
    authorizationId: HostAuthorizationId
    hostId: HostId
    deviceId: ProductDeviceId
    userId: UserId
    spaceId: SpaceId
    revokedAt: Date
  }): Promise<boolean> {
    const result = await this.executor.query<{ authorization_id: string }>(
      `UPDATE control_plane.host_device_authorizations
          SET revoked_at=$6
        WHERE authorization_id=$1
          AND host_id=$2
          AND device_id=$3
          AND user_id=$4
          AND space_id=$5
          AND revoked_at IS NULL
      RETURNING authorization_id`,
      [
        input.authorizationId,
        input.hostId,
        input.deviceId,
        input.userId,
        input.spaceId,
        input.revokedAt,
      ],
    )
    return result.rowCount === 1
  }

  public async userCanOwnSpace(
    spaceId: SpaceId,
    userId: UserId,
  ): Promise<boolean> {
    const result = await this.executor.query<{ permitted: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM control_plane.spaces s
           JOIN control_plane.space_memberships m
             ON m.space_id=s.space_id
           JOIN control_plane.users u
             ON u.user_id=m.user_id
          WHERE s.space_id=$1
            AND m.user_id=$2
            AND m.role='owner'
            AND u.status='active'
       ) AS permitted`,
      [spaceId, userId],
    )
    return result.rows[0]?.permitted === true
  }

  public async findActiveReservationClaimIds(
    hostId: HostId,
    claimGeneration: number,
  ): Promise<readonly HostClaimId[]> {
    const result = await this.executor.query<{ claim_id: HostClaimId }>(
      `SELECT claim_id
         FROM control_plane.host_claims
        WHERE host_id=$1
          AND claim_generation=$2
          AND state IN ('requested','confirmed')
        ORDER BY claim_id
        FOR UPDATE`,
      [hostId, claimGeneration],
    )
    return result.rows.map((row) => row.claim_id)
  }

  public async findClaimExpirationEvents(
    claimId: HostClaimId,
  ): Promise<readonly HostClaimExpirationEventRecord[]> {
    const result = await this.executor.query<{
      actor_kind: string
      actor_id: string
      target_kind: string | null
      target_id: string | null
      outcome: string
      reason_code: string | null
    }>(
      `SELECT actor_kind, actor_id, target_kind, target_id, outcome, reason_code
         FROM control_plane.security_events
        WHERE event_type='host_claim_expired'
          AND correlation_id=$1
        ORDER BY occurred_at, event_id`,
      [claimId],
    )
    return result.rows.map((row) => ({
      actorKind: row.actor_kind,
      actorId: row.actor_id,
      targetKind: row.target_kind,
      targetId: row.target_id,
      outcome: row.outcome,
      reasonCode: row.reason_code,
    }))
  }

  public async completeClaim(
    claim: HostClaimRecord,
    confirmedAt: Date,
  ): Promise<boolean> {
    const challenge = await this.executor.query<ClaimRow>(
      `UPDATE control_plane.enrollment_challenges SET consumed_at=$2 WHERE challenge_id=$1 AND consumed_at IS NULL AND expires_at>$2 RETURNING challenge_id`,
      [claim.challengeId, confirmedAt],
    )
    if (challenge.rowCount !== 1) return false
    const host = await this.executor.query<HostRow>(
      `UPDATE control_plane.hosts SET owning_space_id=$2, claim_state='claimed', updated_at=$4 WHERE host_id=$1 AND owning_space_id IS NULL AND claim_state='pending' AND claim_generation=$3 RETURNING host_id`,
      [claim.hostId, claim.spaceId, claim.claimGeneration, confirmedAt],
    )
    if (host.rowCount !== 1) return false
    const completed = await this.executor.query<ClaimRow>(
      `UPDATE control_plane.host_claims SET state='completed', confirmed_at=$2, completed_at=$2 WHERE claim_id=$1 AND state='requested' AND expires_at>$2 RETURNING claim_id`,
      [claim.claimId, confirmedAt],
    )
    return completed.rowCount === 1
  }

  public async expireRequestedClaim(input: {
    claimId: HostClaimId
    hostId: HostId
    spaceId: SpaceId
    requestingUserId: UserId
    requestingDeviceId: ProductDeviceId
    claimGeneration: number
    serverTime: Date
  }): Promise<boolean> {
    const result = await this.executor.query<{ claim_id: HostClaimId }>(
      `UPDATE control_plane.host_claims
          SET state='expired'
        WHERE claim_id=$1
          AND host_id=$2
          AND space_id=$3
          AND requesting_user_id=$4
          AND requesting_device_id=$5
          AND claim_generation=$6
          AND state='requested'
          AND confirmed_at IS NULL
          AND completed_at IS NULL
          AND revoked_at IS NULL
          AND expires_at<$7
      RETURNING claim_id`,
      [
        input.claimId,
        input.hostId,
        input.spaceId,
        input.requestingUserId,
        input.requestingDeviceId,
        input.claimGeneration,
        input.serverTime,
      ],
    )
    return result.rowCount === 1
  }

  public async releasePendingHostReservation(input: {
    hostId: HostId
    fingerprint: string
    claimGeneration: number
    serverTime: Date
  }): Promise<boolean> {
    const result = await this.executor.query<HostRow>(
      `UPDATE control_plane.hosts
          SET claim_state='unclaimed', updated_at=$4
        WHERE host_id=$1
          AND fingerprint=$2
          AND claim_generation=$3
          AND claim_state='pending'
          AND owning_space_id IS NULL
          AND revoked_at IS NULL
      RETURNING host_id`,
      [
        input.hostId,
        input.fingerprint,
        input.claimGeneration,
        input.serverTime,
      ],
    )
    return result.rowCount === 1
  }
}

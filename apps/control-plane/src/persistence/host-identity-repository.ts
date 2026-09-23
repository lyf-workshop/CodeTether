import type {
  EnrollmentChallengeId,
  HostClaimId,
  HostId,
  ProductDeviceId,
  SpaceId,
  UserId,
} from '../domain/ids.js'
import type { SqlExecutor } from './database.js'

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

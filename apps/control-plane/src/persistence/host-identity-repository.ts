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
  readonly proof_version: number
  readonly audience: string
  readonly nonce_hash: string
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
  readonly proofVersion: number
  readonly audience: string
  readonly nonceHash: string
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
    proofVersion: row.proof_version,
    audience: row.audience,
    nonceHash: row.nonce_hash,
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
      `SELECT c.*, e.nonce_hash FROM control_plane.host_claims c JOIN control_plane.enrollment_challenges e ON e.challenge_id=c.challenge_id WHERE c.claim_id=$1`,
      [claimId],
    )
    return result.rows[0] ? claimFromRow(result.rows[0]) : null
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

  public async expireClaim(
    claimId: HostClaimId,
    hostId: HostId,
    now: Date,
  ): Promise<boolean> {
    const result = await this.executor.query<ClaimRow>(
      `UPDATE control_plane.host_claims SET state='expired' WHERE claim_id=$1 AND state='requested' AND expires_at<=$3 RETURNING claim_id`,
      [claimId, hostId, now],
    )
    if (result.rowCount === 1)
      await this.executor.query(
        `UPDATE control_plane.hosts SET claim_state='unclaimed',updated_at=$2 WHERE host_id=$1 AND claim_state='pending' AND owning_space_id IS NULL`,
        [hostId, now],
      )
    return result.rowCount === 1
  }
}

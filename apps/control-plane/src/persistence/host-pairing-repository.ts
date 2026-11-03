import { createHash } from 'node:crypto'
import type {
  EnrollmentChallengeId,
  HostAuthorizationId,
  HostId,
  ProductDeviceId,
  SpaceId,
  UserId,
} from '../domain/ids.js'
import type { HostDeviceAuthorizationPayload } from '../auth/host-identity-protocol.js'
import type { SqlExecutor } from './database.js'

export interface PairingSessionRow extends Record<string, unknown> {
  readonly session_id: EnrollmentChallengeId
  readonly user_id: UserId
  readonly space_id: SpaceId
  readonly host_id: HostId
  readonly host_identity_generation: number
  readonly managing_device_id: ProductDeviceId
  readonly managing_device_key_generation: number
  readonly code_hash: string | null
  readonly code_index: number | null
  readonly failed_attempts: number
  readonly state:
    'pending' | 'claimed' | 'paired' | 'cancelled' | 'rate_limited'
  readonly proposal: unknown | null
  readonly previous_authorization_id: HostAuthorizationId | null
  readonly completed_authorization_id: HostAuthorizationId | null
  readonly expires_at: Date | string
}

export interface PairedDeviceRow extends Record<string, unknown> {
  readonly authorization_id: HostAuthorizationId
  readonly pairing_root_authorization_id: HostAuthorizationId
  readonly device_id: ProductDeviceId
  readonly label: string
  readonly platform: string
  readonly last_used_at: Date | string | null
  readonly expires_at: Date | string
}

export class HostPairingRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public async lockAccount(userId: UserId): Promise<boolean> {
    const key = createHash('sha256')
      .update('codetether-b1-pairing\0')
      .update(userId)
      .digest()
    await this.executor.query('SELECT pg_advisory_xact_lock($1, $2)', [
      key.readInt32BE(0),
      key.readInt32BE(4),
    ])
    const result = await this.executor.query(
      `SELECT user_id FROM control_plane.users
        WHERE user_id=$1 AND status='active'`,
      [userId],
    )
    return result.rowCount === 1
  }

  public async findSession(
    id: EnrollmentChallengeId,
  ): Promise<PairingSessionRow | null> {
    const result = await this.executor.query<PairingSessionRow>(
      'SELECT * FROM control_plane.host_pairing_sessions WHERE session_id=$1',
      [id],
    )
    return result.rows[0] ?? null
  }

  public async liveCodes(
    userId: UserId,
    now: Date,
  ): Promise<readonly PairingSessionRow[]> {
    const result = await this.executor.query<PairingSessionRow>(
      `SELECT * FROM control_plane.host_pairing_sessions
        WHERE user_id=$1 AND expires_at>$2 AND code_hash IS NOT NULL
          AND state IN ('pending', 'claimed')`,
      [userId, now],
    )
    return result.rows
  }

  public async mostRecentCode(
    userId: UserId,
    digest: string,
  ): Promise<PairingSessionRow | null> {
    const result = await this.executor.query<PairingSessionRow>(
      `SELECT * FROM control_plane.host_pairing_sessions
        WHERE user_id=$1 AND code_hash=$2 ORDER BY created_at DESC, session_id LIMIT 1`,
      [userId, digest],
    )
    return result.rows[0] ?? null
  }

  public async isLockedOut(userId: UserId, now: Date): Promise<boolean> {
    const result = await this.executor.query(
      `SELECT session_id FROM control_plane.host_pairing_sessions
        WHERE user_id=$1 AND expires_at>$2 AND state='rate_limited' LIMIT 1`,
      [userId, now],
    )
    return result.rowCount === 1
  }

  public async setFailedAttempts(
    userId: UserId,
    now: Date,
    count: number,
  ): Promise<void> {
    await this.executor.query(
      `UPDATE control_plane.host_pairing_sessions
          SET failed_attempts=$3,
              state=CASE WHEN $3=5 THEN 'rate_limited' ELSE state END
        WHERE user_id=$1 AND expires_at>$2 AND state='pending'`,
      [userId, now, count],
    )
  }

  public async create(input: {
    sessionId: EnrollmentChallengeId
    userId: UserId
    spaceId: SpaceId
    hostId: HostId
    hostIdentityGeneration: number
    managingDeviceId: ProductDeviceId
    managingDeviceKeyGeneration: number
    codeHash: string | null
    codeIndex: number | null
    failedAttempts: number
    proposal: HostDeviceAuthorizationPayload | null
    previousAuthorizationId: HostAuthorizationId | null
    now: Date
    expiresAt: Date
  }): Promise<boolean> {
    const result = await this.executor.query(
      `INSERT INTO control_plane.host_pairing_sessions (
         session_id, user_id, space_id, host_id, host_identity_generation,
         managing_device_id, managing_device_key_generation, code_hash, code_index,
         failed_attempts, state, proposal, previous_authorization_id, created_at, expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15)
       ON CONFLICT (session_id) DO NOTHING`,
      [
        input.sessionId,
        input.userId,
        input.spaceId,
        input.hostId,
        input.hostIdentityGeneration,
        input.managingDeviceId,
        input.managingDeviceKeyGeneration,
        input.codeHash,
        input.codeIndex,
        input.failedAttempts,
        input.proposal === null ? 'pending' : 'claimed',
        input.proposal === null ? null : JSON.stringify(input.proposal),
        input.previousAuthorizationId,
        input.now,
        input.expiresAt,
      ],
    )
    return result.rowCount === 1
  }

  public async claim(
    id: EnrollmentChallengeId,
    payload: HostDeviceAuthorizationPayload,
  ): Promise<void> {
    await this.executor.query(
      `UPDATE control_plane.host_pairing_sessions SET state='claimed', proposal=$2::jsonb
        WHERE session_id=$1 AND state='pending'`,
      [id, JSON.stringify(payload)],
    )
  }

  public async cancel(id: EnrollmentChallengeId): Promise<void> {
    await this.executor.query(
      `UPDATE control_plane.host_pairing_sessions SET state='cancelled'
        WHERE session_id=$1 AND state IN ('pending', 'claimed')`,
      [id],
    )
  }

  public async finish(
    id: EnrollmentChallengeId,
    authorizationId: HostAuthorizationId,
    pairingRootAuthorizationId: HostAuthorizationId,
    lastUsedAt: Date | null,
  ): Promise<boolean> {
    const result = await this.executor.query(
      `UPDATE control_plane.host_pairing_sessions
          SET state='paired', completed_authorization_id=$2,
              pairing_root_authorization_id=$3, last_used_at=$4
        WHERE session_id=$1 AND state='claimed'`,
      [id, authorizationId, pairingRootAuthorizationId, lastUsedAt],
    )
    return result.rowCount === 1
  }

  public async activeRenewal(
    authorizationId: HostAuthorizationId,
    now: Date,
  ): Promise<PairingSessionRow | null> {
    const result = await this.executor.query<PairingSessionRow>(
      `SELECT * FROM control_plane.host_pairing_sessions
        WHERE previous_authorization_id=$1 AND state='claimed' AND expires_at>$2
        ORDER BY created_at DESC LIMIT 1`,
      [authorizationId, now],
    )
    return result.rows[0] ?? null
  }

  public async listDevices(
    hostId: HostId,
    userId: UserId,
    spaceId: SpaceId,
    generation: number,
  ): Promise<readonly PairedDeviceRow[]> {
    const result = await this.executor.query<PairedDeviceRow>(
      `SELECT DISTINCT ON (a.device_id) a.authorization_id, ps.pairing_root_authorization_id,
              a.device_id, d.label, d.platform, ps.last_used_at, a.expires_at
         FROM control_plane.host_device_authorizations a
         JOIN control_plane.host_pairing_sessions ps ON ps.completed_authorization_id=a.authorization_id
         JOIN control_plane.product_devices d ON d.device_id=a.device_id
        WHERE a.host_id=$1 AND a.user_id=$2 AND a.space_id=$3 AND a.claim_generation=$4
          AND a.scope='supervisor_control' AND a.revoked_at IS NULL
          AND ps.state='paired' AND ps.superseded_by_authorization_id IS NULL
          AND d.owner_user_id=a.user_id AND d.key_generation=a.device_key_generation
          AND d.fingerprint=a.device_fingerprint AND d.revoked_at IS NULL
        ORDER BY a.device_id, a.authorization_generation DESC`,
      [hostId, userId, spaceId, generation],
    )
    return result.rows
  }

  public async supersede(
    previous: HostAuthorizationId,
    replacement: HostAuthorizationId,
    now: Date,
  ): Promise<boolean> {
    const result = await this.executor.query(
      `WITH replaced AS (
         UPDATE control_plane.host_device_authorizations SET revoked_at=$3
          WHERE authorization_id=$1 AND revoked_at IS NULL
        RETURNING authorization_id
       )
       UPDATE control_plane.host_pairing_sessions SET superseded_by_authorization_id=$2
        WHERE completed_authorization_id IN (SELECT authorization_id FROM replaced)`,
      [previous, replacement, now],
    )
    return result.rowCount === 1
  }

  public async supersedeOtherDeviceAccess(
    hostId: HostId,
    deviceId: ProductDeviceId,
    generation: number,
    replacement: HostAuthorizationId,
    now: Date,
  ): Promise<void> {
    await this.executor.query(
      `WITH replaced AS (
         UPDATE control_plane.host_device_authorizations SET revoked_at=$5
          WHERE host_id=$1 AND device_id=$2 AND claim_generation=$3 AND authorization_id<>$4
            AND revoked_at IS NULL AND (scope='supervisor_control' OR expires_at>$5)
        RETURNING authorization_id
       )
       UPDATE control_plane.host_pairing_sessions SET superseded_by_authorization_id=$4
        WHERE completed_authorization_id IN (SELECT authorization_id FROM replaced)`,
      [hostId, deviceId, generation, replacement, now],
    )
  }

  public async revokeLineage(
    hostId: HostId,
    deviceId: ProductDeviceId,
    root: HostAuthorizationId,
    generation: number,
    now: Date,
  ): Promise<readonly HostAuthorizationId[]> {
    const result = await this.executor.query<{
      authorization_id: HostAuthorizationId
    }>(
      `UPDATE control_plane.host_device_authorizations a
          SET revoked_at=$5
        WHERE a.host_id=$1 AND a.device_id=$2 AND a.claim_generation=$4 AND a.revoked_at IS NULL
          AND (EXISTS (
            SELECT 1 FROM control_plane.host_pairing_sessions ps
             WHERE ps.completed_authorization_id=a.authorization_id
               AND ps.pairing_root_authorization_id=$3
          ) OR (
            a.scope='supervisor_read' AND a.expires_at>$5 AND EXISTS (
              SELECT 1 FROM control_plane.host_device_authorizations active_pairing
                JOIN control_plane.host_pairing_sessions ps
                  ON ps.completed_authorization_id=active_pairing.authorization_id
               WHERE active_pairing.host_id=$1 AND active_pairing.device_id=$2
                 AND ps.pairing_root_authorization_id=$3
                 AND active_pairing.claim_generation=$4 AND active_pairing.revoked_at IS NULL
            )
          ))
      RETURNING authorization_id`,
      [hostId, deviceId, root, generation, now],
    )
    return result.rows.map((row) => row.authorization_id)
  }

  public async cancelDeviceProposals(
    hostId: HostId,
    deviceId: ProductDeviceId,
    userId: UserId,
  ): Promise<void> {
    await this.executor.query(
      `UPDATE control_plane.host_pairing_sessions SET state='cancelled'
        WHERE host_id=$1 AND user_id=$3 AND state='claimed' AND proposal->>'deviceId'=$2`,
      [hostId, deviceId, userId],
    )
  }
}

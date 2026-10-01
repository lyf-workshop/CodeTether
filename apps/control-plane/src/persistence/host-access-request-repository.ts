import type {
  HostAccessRequestId,
  HostAuthorizationId,
  HostId,
  ProductDeviceId,
  SpaceId,
} from '../domain/ids.js'
import type { SqlExecutor } from './database.js'

export type HostAccessRequestStatus =
  'pending' | 'denied' | 'cancelled' | 'expired' | 'completed'

export interface HostAccessRequestRecord {
  readonly requestId: HostAccessRequestId
  readonly requestingDeviceId: ProductDeviceId
  readonly targetHostId: HostId
  readonly spaceId: SpaceId
  readonly requestedScope: 'supervisor_read'
  readonly status: HostAccessRequestStatus
  readonly challengeId: string
  readonly authorizationPayload: Record<string, unknown>
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly expiresAt: Date
  readonly completedAuthorizationId: HostAuthorizationId | null
}

export interface OwnedHostAccessRecord {
  readonly hostId: HostId
  readonly spaceId: SpaceId
  readonly safeLabel: string
  readonly coarsePlatform: 'windows' | 'macos' | 'linux' | 'unknown'
  readonly fingerprint: string
  readonly identityGeneration: number
  readonly authorizationState:
    'authorized' | 'pending' | 'denied' | 'cancelled' | 'expired' | 'none'
  readonly authorizationId: HostAuthorizationId | null
  readonly requestId: HostAccessRequestId | null
  readonly requestExpiresAt: Date | null
}

interface RequestRow extends Record<string, unknown> {
  readonly request_id: HostAccessRequestId
  readonly requesting_device_id: ProductDeviceId
  readonly target_host_id: HostId
  readonly space_id: SpaceId
  readonly requested_scope: 'supervisor_read'
  readonly status: HostAccessRequestStatus
  readonly challenge_id: string
  readonly authorization_payload: Record<string, unknown>
  readonly created_at: Date | string
  readonly updated_at: Date | string
  readonly expires_at: Date | string
  readonly completed_authorization_id: HostAuthorizationId | null
}

interface OwnedHostRow extends Record<string, unknown> {
  readonly host_id: HostId
  readonly space_id: SpaceId
  readonly safe_label: string
  readonly coarse_platform: OwnedHostAccessRecord['coarsePlatform']
  readonly fingerprint: string
  readonly claim_generation: number
  readonly authorization_id: HostAuthorizationId | null
  readonly request_id: HostAccessRequestId | null
  readonly request_status: HostAccessRequestStatus | null
  readonly request_expires_at: Date | string | null
}

function date(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

function requestFromRow(row: RequestRow): HostAccessRequestRecord {
  return {
    requestId: row.request_id,
    requestingDeviceId: row.requesting_device_id,
    targetHostId: row.target_host_id,
    spaceId: row.space_id,
    requestedScope: row.requested_scope,
    status: row.status,
    challengeId: row.challenge_id,
    authorizationPayload: row.authorization_payload,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
    expiresAt: date(row.expires_at),
    completedAuthorizationId: row.completed_authorization_id,
  }
}

function accessState(
  row: OwnedHostRow,
  now: Date,
): OwnedHostAccessRecord['authorizationState'] {
  if (row.authorization_id !== null) return 'authorized'
  if (
    row.request_status === 'pending' &&
    row.request_expires_at !== null &&
    date(row.request_expires_at) > now
  )
    return 'pending'
  if (row.request_status === 'pending' && row.request_expires_at !== null)
    return 'expired'
  if (row.request_status === 'denied') return 'denied'
  if (row.request_status === 'cancelled') return 'cancelled'
  if (row.request_status === 'expired') return 'expired'
  return 'none'
}

export class HostAccessRequestRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public async create(input: {
    requestId: HostAccessRequestId
    requestingDeviceId: ProductDeviceId
    targetHostId: HostId
    spaceId: SpaceId
    requestedScope: 'supervisor_read'
    challengeId: string
    authorizationPayload: Record<string, unknown>
    createdAt: Date
    expiresAt: Date
  }): Promise<boolean> {
    const result = await this.executor.query(
      `INSERT INTO control_plane.host_access_requests (
         request_id, requesting_device_id, target_host_id, space_id,
         requested_scope, status, challenge_id, authorization_payload,
         created_at, updated_at, expires_at
       ) VALUES ($1,$2,$3,$4,$5,'pending',$6,$7::jsonb,$8,$8,$9)
       ON CONFLICT (requesting_device_id, target_host_id, requested_scope)
       WHERE status='pending' DO NOTHING
       RETURNING request_id`,
      [
        input.requestId,
        input.requestingDeviceId,
        input.targetHostId,
        input.spaceId,
        input.requestedScope,
        input.challengeId,
        JSON.stringify(input.authorizationPayload),
        input.createdAt,
        input.expiresAt,
      ],
    )
    return result.rowCount === 1
  }

  public async findById(
    requestId: HostAccessRequestId,
    forUpdate = false,
  ): Promise<HostAccessRequestRecord | null> {
    const result = await this.executor.query<RequestRow>(
      `SELECT * FROM control_plane.host_access_requests
        WHERE request_id=$1 ${forUpdate ? 'FOR UPDATE' : ''}`,
      [requestId],
    )
    return result.rows[0] ? requestFromRow(result.rows[0]) : null
  }

  public async findPendingEquivalent(
    deviceId: ProductDeviceId,
    hostId: HostId,
    scope: 'supervisor_read',
    now: Date,
    forUpdate = false,
  ): Promise<HostAccessRequestRecord | null> {
    const result = await this.executor.query<RequestRow>(
      `SELECT * FROM control_plane.host_access_requests
        WHERE requesting_device_id=$1 AND target_host_id=$2
          AND requested_scope=$3 AND status='pending'
          AND expires_at>$4
        ORDER BY created_at DESC
        LIMIT 1 ${forUpdate ? 'FOR UPDATE' : ''}`,
      [deviceId, hostId, scope, now],
    )
    return result.rows[0] ? requestFromRow(result.rows[0]) : null
  }

  public async expireEquivalent(
    deviceId: ProductDeviceId,
    hostId: HostId,
    scope: 'supervisor_read',
    now: Date,
  ): Promise<void> {
    await this.executor.query(
      `UPDATE control_plane.host_access_requests
          SET status='expired', updated_at=$4
        WHERE requesting_device_id=$1 AND target_host_id=$2
          AND requested_scope=$3 AND status='pending' AND expires_at<=$4`,
      [deviceId, hostId, scope, now],
    )
  }

  public async expirePending(
    requestId: HostAccessRequestId,
    now: Date,
  ): Promise<boolean> {
    const result = await this.executor.query(
      `UPDATE control_plane.host_access_requests
          SET status='expired', updated_at=$2
        WHERE request_id=$1 AND status='pending' AND expires_at<=$2
       RETURNING request_id`,
      [requestId, now],
    )
    return result.rowCount === 1
  }

  public async transitionPending(input: {
    requestId: HostAccessRequestId
    status: 'denied' | 'cancelled' | 'completed'
    updatedAt: Date
    completedAuthorizationId?: HostAuthorizationId
  }): Promise<boolean> {
    const result = await this.executor.query(
      `UPDATE control_plane.host_access_requests
          SET status=$2, updated_at=$3, completed_authorization_id=$4
        WHERE request_id=$1 AND status='pending' AND expires_at>$3
       RETURNING request_id`,
      [
        input.requestId,
        input.status,
        input.updatedAt,
        input.completedAuthorizationId ?? null,
      ],
    )
    return result.rowCount === 1
  }

  public async listPendingForOwnedHosts(
    userId: string,
    spaceId: SpaceId,
    now: Date,
  ): Promise<readonly HostAccessRequestRecord[]> {
    const result = await this.executor.query<RequestRow>(
      `SELECT r.*
         FROM control_plane.host_access_requests r
         JOIN control_plane.hosts h ON h.host_id=r.target_host_id AND h.owning_space_id=r.space_id
         JOIN control_plane.product_devices d ON d.device_id=r.requesting_device_id
        WHERE r.space_id=$1 AND h.owning_space_id=$1 AND h.claim_state='claimed'
          AND h.revoked_at IS NULL AND d.revoked_at IS NULL
          AND r.status='pending' AND r.expires_at>$2
          AND EXISTS (SELECT 1 FROM control_plane.space_memberships m
                       WHERE m.space_id=r.space_id AND m.user_id=$3 AND m.role='owner')
        ORDER BY r.created_at, r.request_id`,
      [spaceId, now, userId],
    )
    return result.rows.map(requestFromRow)
  }

  public async listOwnedHostsForDevice(
    userId: string,
    spaceId: SpaceId,
    deviceId: ProductDeviceId,
    now: Date,
  ): Promise<readonly OwnedHostAccessRecord[]> {
    const result = await this.executor.query<OwnedHostRow>(
      `SELECT h.host_id, h.owning_space_id AS space_id, h.safe_label,
              h.coarse_platform, h.fingerprint, h.claim_generation,
              a.authorization_id,
              r.request_id, r.status AS request_status, r.expires_at AS request_expires_at
         FROM control_plane.hosts h
         LEFT JOIN LATERAL (
           SELECT a.authorization_id
             FROM control_plane.host_device_authorizations a
            WHERE a.host_id=h.host_id AND a.device_id=$3 AND a.user_id=$1
              AND a.space_id=$2 AND a.scope='supervisor_read'
              AND a.revoked_at IS NULL AND a.expires_at>$4
              AND a.claim_generation=h.claim_generation
            ORDER BY a.authorization_generation DESC, a.authorization_id
            LIMIT 1
         ) a ON true
         LEFT JOIN LATERAL (
           SELECT r.request_id, r.status, r.expires_at
             FROM control_plane.host_access_requests r
            WHERE r.target_host_id=h.host_id AND r.requesting_device_id=$3
              AND r.space_id=$2 AND r.requested_scope='supervisor_read'
            ORDER BY r.created_at DESC, r.request_id DESC
            LIMIT 1
         ) r ON true
        WHERE h.owning_space_id=$2 AND h.claim_state='claimed' AND h.revoked_at IS NULL
          AND EXISTS (SELECT 1 FROM control_plane.space_memberships m
                       WHERE m.space_id=$2 AND m.user_id=$1 AND m.role='owner')
        ORDER BY h.safe_label, h.host_id`,
      [userId, spaceId, deviceId, now],
    )
    return result.rows.map((row) => ({
      hostId: row.host_id,
      spaceId: row.space_id,
      safeLabel: row.safe_label,
      coarsePlatform: row.coarse_platform,
      fingerprint: row.fingerprint,
      identityGeneration: row.claim_generation,
      authorizationState: accessState(row, now),
      authorizationId: row.authorization_id,
      requestId: row.request_id,
      requestExpiresAt:
        row.request_expires_at === null ? null : date(row.request_expires_at),
    }))
  }
}

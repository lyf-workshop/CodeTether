import type {
  AppendSecurityEvent,
  CreateDeviceSessionBinding,
  CreateEnrollmentChallenge,
  CreateHost,
  CreateHostClaim,
  CreateHostDeviceAuthorization,
  CreateProductDevice,
  CreateRendezvousBinding,
  CreateUserWithPersonalSpace,
} from '../domain/models.js'
import type {
  EnrollmentChallengeId,
  LoginIdentityId,
  ProductDeviceId,
  SpaceId,
  UserId,
} from '../domain/ids.js'
import type { SqlExecutor } from './database.js'

interface AuthenticatedAccountRow extends Record<string, unknown> {
  readonly login_identity_id: string
  readonly user_id: string
  readonly status: string
  readonly personal_space_id: string
}

export interface AuthenticatedAccountRecord {
  readonly loginIdentityId: LoginIdentityId
  readonly userId: UserId
  readonly status: 'active' | 'suspended' | 'deletion_pending'
  readonly personalSpaceId: SpaceId
}

export class ControlPlaneRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public async createUserWithPersonalSpaceRecords(
    input: CreateUserWithPersonalSpace,
  ): Promise<void> {
    await this.executor.query(
      `INSERT INTO control_plane.users
         (user_id, status, display_name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4)`,
      [input.userId, input.status, input.displayName, input.now],
    )
    await this.executor.query(
      `INSERT INTO control_plane.spaces
         (space_id, kind, name, personal_owner_user_id, created_at, updated_at)
       VALUES ($1, 'personal', $2, $3, $4, $4)`,
      [input.spaceId, input.spaceName, input.userId, input.now],
    )
    await this.executor.query(
      `INSERT INTO control_plane.space_memberships
         (space_id, user_id, role, created_at)
       VALUES ($1, $2, 'owner', $3)`,
      [input.spaceId, input.userId, input.now],
    )
  }

  public async findAuthenticatedAccountByLoginIdentity(
    issuer: string,
    subject: string,
  ): Promise<AuthenticatedAccountRecord | null> {
    const result = await this.executor.query<AuthenticatedAccountRow>(
      `SELECT li.login_identity_id, li.user_id, u.status,
              s.space_id AS personal_space_id
         FROM control_plane.login_identities li
         JOIN control_plane.users u ON u.user_id = li.user_id
         JOIN control_plane.spaces s
           ON s.personal_owner_user_id = u.user_id AND s.kind = 'personal'
         JOIN control_plane.space_memberships m
           ON m.space_id = s.space_id
          AND m.user_id = u.user_id
          AND m.role = 'owner'
        WHERE li.issuer = $1 AND li.subject = $2`,
      [issuer, subject],
    )
    const row = result.rows[0]
    if (!row) return null
    return {
      loginIdentityId: row.login_identity_id as LoginIdentityId,
      userId: row.user_id as UserId,
      status: row.status as AuthenticatedAccountRecord['status'],
      personalSpaceId: row.personal_space_id as SpaceId,
    }
  }

  public async createLoginIdentity(input: {
    readonly loginIdentityId: LoginIdentityId
    readonly userId: UserId
    readonly issuer: string
    readonly subject: string
    readonly verifiedNormalizedEmail: string | null
    readonly now: Date
  }): Promise<void> {
    await this.executor.query(
      `INSERT INTO control_plane.login_identities (
         login_identity_id, issuer, subject, user_id,
         verified_normalized_email, created_at, last_used_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $6)`,
      [
        input.loginIdentityId,
        input.issuer,
        input.subject,
        input.userId,
        input.verifiedNormalizedEmail,
        input.now,
      ],
    )
  }

  public async touchLoginIdentity(
    loginIdentityId: LoginIdentityId,
    verifiedNormalizedEmail: string | null,
    now: Date,
  ): Promise<void> {
    await this.executor.query(
      `UPDATE control_plane.login_identities
          SET verified_normalized_email = COALESCE($2, verified_normalized_email),
              last_used_at = $3
        WHERE login_identity_id = $1`,
      [loginIdentityId, verifiedNormalizedEmail, now],
    )
  }

  public async createProductDevice(input: CreateProductDevice): Promise<void> {
    await this.executor.query(
      `INSERT INTO control_plane.product_devices (
         device_id, owner_user_id, device_type, public_key, key_algorithm,
         fingerprint, label, platform, app_version, protocol_version,
         key_generation, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        input.deviceId,
        input.ownerUserId,
        input.deviceType,
        input.publicKey,
        input.keyAlgorithm,
        input.fingerprint,
        input.label,
        input.platform,
        input.appVersion,
        input.protocolVersion,
        input.keyGeneration,
        input.createdAt,
      ],
    )
  }

  public async revokeProductDevice(
    deviceId: ProductDeviceId,
    revokedAt: Date,
  ): Promise<boolean> {
    const result = await this.executor.query(
      `UPDATE control_plane.product_devices
          SET revoked_at = $2
        WHERE device_id = $1 AND revoked_at IS NULL`,
      [deviceId, revokedAt],
    )
    return result.rowCount === 1
  }

  public async createHost(input: CreateHost): Promise<void> {
    await this.executor.query(
      `INSERT INTO control_plane.hosts (
         host_id, owning_space_id, public_key, key_algorithm, fingerprint,
         safe_label, coarse_platform, protocol_version_min, protocol_version_max,
         claim_generation, claim_state, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
      [
        input.hostId,
        input.owningSpaceId,
        input.publicKey,
        input.keyAlgorithm,
        input.fingerprint,
        input.safeLabel,
        input.coarsePlatform,
        input.protocolVersionMin,
        input.protocolVersionMax,
        input.claimGeneration,
        input.claimState,
        input.createdAt,
      ],
    )
  }

  public async createEnrollmentChallenge(
    input: CreateEnrollmentChallenge,
  ): Promise<void> {
    await this.executor.query(
      `INSERT INTO control_plane.enrollment_challenges (
         challenge_id, purpose, target_user_id, target_space_id, target_device_id,
         target_host_id, nonce_hash, created_at, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        input.challengeId,
        input.purpose,
        input.targetUserId,
        input.targetSpaceId,
        input.targetDeviceId,
        input.targetHostId,
        input.nonceHash,
        input.createdAt,
        input.expiresAt,
      ],
    )
  }

  public async consumeEnrollmentChallenge(
    challengeId: EnrollmentChallengeId,
    expectedPurpose: CreateEnrollmentChallenge['purpose'],
    consumedAt: Date,
  ): Promise<boolean> {
    const result = await this.executor.query(
      `UPDATE control_plane.enrollment_challenges
          SET consumed_at = $3
        WHERE challenge_id = $1
          AND purpose = $2
          AND consumed_at IS NULL
          AND expires_at > $3`,
      [challengeId, expectedPurpose, consumedAt],
    )
    return result.rowCount === 1
  }

  public async createHostClaim(input: CreateHostClaim): Promise<boolean> {
    const result = await this.executor.query(
      `INSERT INTO control_plane.host_claims (
         claim_id, host_id, space_id, requesting_user_id, requesting_device_id,
         claim_generation, challenge_id, state, requested_at, expires_at
       )
       SELECT $1, h.host_id, h.owning_space_id, d.owner_user_id, d.device_id,
              $6, c.challenge_id, $8, $9, $10
         FROM control_plane.hosts h
         JOIN control_plane.product_devices d
           ON d.device_id = $5 AND d.owner_user_id = $4 AND d.revoked_at IS NULL
         JOIN control_plane.enrollment_challenges c
           ON c.challenge_id = $7
          AND c.purpose = 'host_claim'
          AND c.target_host_id = h.host_id
          AND c.target_space_id = h.owning_space_id
          AND c.target_device_id = d.device_id
          AND c.target_user_id = d.owner_user_id
        WHERE h.host_id = $2
          AND h.owning_space_id = $3
          AND h.claim_generation = $6
          AND h.revoked_at IS NULL`,
      [
        input.claimId,
        input.hostId,
        input.spaceId,
        input.requestingUserId,
        input.requestingDeviceId,
        input.claimGeneration,
        input.challengeId,
        input.state,
        input.requestedAt,
        input.expiresAt,
      ],
    )
    return result.rowCount === 1
  }

  public async createHostDeviceAuthorization(
    input: CreateHostDeviceAuthorization,
  ): Promise<boolean> {
    const result = await this.executor.query(
      `INSERT INTO control_plane.host_device_authorizations (
         authorization_id, host_id, claim_generation, device_id,
         device_key_generation, device_fingerprint, user_id, space_id, scope,
         authorization_serial, authorization_generation, issued_at, expires_at
       )
       SELECT $1, h.host_id, h.claim_generation, d.device_id, d.key_generation,
              d.fingerprint, d.owner_user_id, h.owning_space_id, $9,
              $10, $11, $12, $13
         FROM control_plane.hosts h
         JOIN control_plane.product_devices d ON d.device_id = $4
        WHERE h.host_id = $2
          AND h.claim_generation = $3
          AND h.owning_space_id = $8
          AND h.claim_state = 'claimed'
          AND h.revoked_at IS NULL
          AND d.key_generation = $5
          AND d.fingerprint = $6
          AND d.owner_user_id = $7
          AND d.revoked_at IS NULL`,
      [
        input.authorizationId,
        input.hostId,
        input.claimGeneration,
        input.deviceId,
        input.deviceKeyGeneration,
        input.deviceFingerprint,
        input.userId,
        input.spaceId,
        input.scope,
        input.authorizationSerial,
        input.authorizationGeneration,
        input.issuedAt,
        input.expiresAt,
      ],
    )
    return result.rowCount === 1
  }

  public async createDeviceSessionBinding(
    input: CreateDeviceSessionBinding,
  ): Promise<boolean> {
    const result = await this.executor.query(
      `INSERT INTO control_plane.device_session_bindings (
         binding_id, external_auth_session_hash, user_id, device_id,
         device_key_generation, binding_generation, created_at, expires_at
       )
       SELECT $1, $2, d.owner_user_id, d.device_id, d.key_generation,
              $6, $7, $8
         FROM control_plane.product_devices d
        WHERE d.device_id = $4
          AND d.owner_user_id = $3
          AND d.key_generation = $5
          AND d.revoked_at IS NULL`,
      [
        input.bindingId,
        input.externalAuthSessionHash,
        input.userId,
        input.deviceId,
        input.deviceKeyGeneration,
        input.bindingGeneration,
        input.createdAt,
        input.expiresAt,
      ],
    )
    return result.rowCount === 1
  }

  public async createRendezvousBinding(
    input: CreateRendezvousBinding,
  ): Promise<void> {
    await this.executor.query(
      `INSERT INTO control_plane.relay_rendezvous_bindings (
         binding_id, host_id, device_id, opaque_relay_binding_id,
         binding_role, status, created_at, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.bindingId,
        input.hostId,
        input.deviceId,
        input.opaqueRelayBindingId,
        input.bindingRole,
        input.status,
        input.createdAt,
        input.expiresAt,
      ],
    )
  }

  public async appendSecurityEvent(input: AppendSecurityEvent): Promise<void> {
    await this.executor.query(
      `INSERT INTO control_plane.security_events (
         event_id, event_type, actor_kind, actor_id, target_kind, target_id,
         outcome, reason_code, correlation_id, occurred_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        input.eventId,
        input.eventType,
        input.actorKind,
        input.actorId,
        input.targetKind,
        input.targetId,
        input.outcome,
        input.reasonCode,
        input.correlationId,
        input.occurredAt,
      ],
    )
  }
}

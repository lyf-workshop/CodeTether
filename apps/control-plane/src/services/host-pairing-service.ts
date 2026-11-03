import { createHmac, randomBytes } from 'node:crypto'
import { supervisorTransportLimits } from '@codetether/supervisor-transport'
import { z } from 'zod'
import {
  HOST_AUDIENCE,
  admitHostPublicJwk,
  encodeHostDeviceAuthorizationPayload,
  hostDeviceAuthorizationPayloadSchema,
  hostPairingManagementPayloadSchema,
  verifyHostDeviceAuthorizationProof,
  verifyHostPairingManagementProof,
  type HostDeviceAuthorizationPayload,
  type HostPairingManagementPayload,
} from '../auth/host-identity-protocol.js'
import {
  createEnrollmentChallengeId,
  createHostAuthorizationId,
  createSecurityEventId,
  enrollmentChallengeIdSchema,
  hostAuthorizationIdSchema,
  hostIdSchema,
  productDeviceIdSchema,
  type EnrollmentChallengeId,
  type HostAuthorizationId,
  type HostId,
} from '../domain/ids.js'
import { ControlPlaneRepository } from '../persistence/control-plane-repository.js'
import type {
  ControlPlaneDatabase,
  SqlExecutor,
} from '../persistence/database.js'
import {
  HostIdentityRepository,
  type HostDeviceAuthorizationRecord,
  type HostRecord,
} from '../persistence/host-identity-repository.js'
import {
  HostPairingRepository,
  type PairingSessionRow,
} from '../persistence/host-pairing-repository.js'
import {
  ProductDeviceRepository,
  type ProductDeviceRecord,
} from '../persistence/product-device-repository.js'
import type { AuthenticatedHumanRequestContext } from './authenticated-account-service.js'
import type { AuthenticatedProductDeviceContext } from './product-device-authentication-service.js'
import {
  HostIdentityFailure,
  supervisorAuthorizationEntry,
} from './host-identity-service.js'

const sessionLifetimeMs = 5 * 60 * 1000
const authorizationLifetimeMs = 30 * 24 * 60 * 60 * 1000
const maximumFailedAttempts = 5
const maximumLiveCodes = 16
const proofSchema = z.string().min(1).max(8192)
const managementSchema = z
  .object({ payload: hostPairingManagementPayloadSchema, proof: proofSchema })
  .strict()
const completionSchema = z
  .object({ payload: hostDeviceAuthorizationPayloadSchema, proof: proofSchema })
  .strict()
const redeemSchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict()

function fail(code: string): never {
  throw new HostIdentityFailure(`host_pairing_${code}`)
}

function expiresAt(now: Date): Date {
  return new Date(Math.floor(now.getTime() / 1000) * 1000 + sessionLifetimeMs)
}

function canRenew(expires: Date, lastUsed: Date | null, now: Date): boolean {
  if (!lastUsed || lastUsed >= expires || lastUsed > now) return false
  const remaining = expires.getTime() - now.getTime()
  if (remaining >= authorizationLifetimeMs / 2) return false
  return (
    lastUsed.getTime() >=
    Math.min(expires.getTime(), now.getTime()) - authorizationLifetimeMs
  )
}

function proposal(row: PairingSessionRow): HostDeviceAuthorizationPayload {
  return hostDeviceAuthorizationPayloadSchema.parse(row.proposal)
}

function sessionView(row: PairingSessionRow, now: Date) {
  const expired =
    (row.state === 'pending' || row.state === 'claimed') &&
    new Date(row.expires_at) <= now
  return {
    status: expired ? ('expired' as const) : row.state,
    sessionId: row.session_id,
    hostId: row.host_id,
    expiresAt: new Date(row.expires_at).toISOString(),
  }
}

function sameOwnerSession(
  row: PairingSessionRow,
  human: AuthenticatedHumanRequestContext,
  device: AuthenticatedProductDeviceContext,
  host: HostRecord,
): boolean {
  return (
    row.host_id === host.hostId &&
    row.host_identity_generation === host.claimGeneration &&
    row.user_id === human.userId &&
    row.space_id === human.personalSpaceId &&
    row.managing_device_id === device.deviceId &&
    row.managing_device_key_generation === device.keyGeneration
  )
}

function isCurrentDevice(
  record: ProductDeviceRecord | null,
  human: AuthenticatedHumanRequestContext,
  device: AuthenticatedProductDeviceContext,
): record is ProductDeviceRecord {
  return (
    record !== null &&
    record.ownerUserId === human.userId &&
    record.keyGeneration === device.keyGeneration &&
    record.revokedAt === null
  )
}

export class HostPairingService {
  public constructor(
    private readonly database: ControlPlaneDatabase,
    private readonly hmacKey?: Uint8Array,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (hmacKey && hmacKey.byteLength !== 32)
      throw new Error('Invalid pairing HMAC key length')
  }

  private codeDigest(
    human: AuthenticatedHumanRequestContext,
    code: string,
  ): string {
    if (!this.hmacKey) fail('unavailable')
    return createHmac('sha256', this.hmacKey)
      .update('b1-code-lookup\0')
      .update(human.userId)
      .update('\0')
      .update(code)
      .digest('hex')
  }

  private sessionCode(
    human: AuthenticatedHumanRequestContext,
    sessionId: EnrollmentChallengeId,
    index: number,
  ): string {
    if (!this.hmacKey) fail('unavailable')
    const bytes = createHmac('sha256', this.hmacKey)
      .update('b1-code-generation\0')
      .update(human.userId)
      .update('\0')
      .update(sessionId)
      .update('\0')
      .update(String(index))
      .digest()
    return String(bytes.readUIntBE(0, 6) % 1_000_000).padStart(6, '0')
  }

  private withAccount<T>(
    human: AuthenticatedHumanRequestContext,
    device: AuthenticatedProductDeviceContext,
    operation: (
      transaction: SqlExecutor,
      sessions: HostPairingRepository,
      now: Date,
    ) => Promise<T>,
  ): Promise<T> {
    if (human.status !== 'active' || device.userId !== human.userId)
      fail('owner_mismatch')
    return this.database.transaction(async (transaction) => {
      const sessions = new HostPairingRepository(transaction)
      if (!(await sessions.lockAccount(human.userId))) fail('owner_mismatch')
      return operation(transaction, sessions, this.now())
    })
  }

  private async ownedHost(
    executor: SqlExecutor,
    human: AuthenticatedHumanRequestContext,
    hostId: HostId,
    lock: boolean,
  ): Promise<HostRecord> {
    const repository = new HostIdentityRepository(executor)
    const host = lock
      ? await repository.findHostForUpdate(hostId)
      : await repository.findHost(hostId)
    if (
      !host ||
      host.claimState !== 'claimed' ||
      host.revokedAt ||
      host.owningSpaceId !== human.personalSpaceId ||
      !(await repository.userCanOwnSpace(human.personalSpaceId, human.userId))
    )
      fail('owner_mismatch')
    return host
  }

  private async currentDevice(
    executor: SqlExecutor,
    human: AuthenticatedHumanRequestContext,
    device: AuthenticatedProductDeviceContext,
  ): Promise<ProductDeviceRecord> {
    const record = await new ProductDeviceRepository(
      executor,
    ).findProductDeviceForUpdate(device.deviceId)
    if (!isCurrentDevice(record, human, device)) fail('device_unavailable')
    return record
  }

  private async publicJwk(host: HostRecord) {
    try {
      const admitted = await admitHostPublicJwk(JSON.parse(host.publicKey))
      if (
        admitted.canonicalPublicJwk === host.publicKey &&
        admitted.fingerprint === host.fingerprint
      )
        return admitted.publicJwk
    } catch {
      // Keep key parsing and verification errors out of the API response.
    }
    return fail('signature_invalid')
  }

  private async verifyManagement(
    untrusted: unknown,
    human: AuthenticatedHumanRequestContext,
    device: AuthenticatedProductDeviceContext,
    host: HostRecord,
    purpose: HostPairingManagementPayload['purpose'],
    subjectId: string | undefined,
    now: Date,
  ) {
    const { payload, proof } = managementSchema.parse(untrusted)
    const seconds = Math.floor(now.getTime() / 1000)
    if (
      payload.purpose !== purpose ||
      (subjectId !== undefined && payload.subjectId !== subjectId) ||
      payload.hostId !== host.hostId ||
      payload.hostFingerprint !== host.fingerprint ||
      payload.hostIdentityGeneration !== host.claimGeneration ||
      payload.spaceId !== human.personalSpaceId ||
      payload.userId !== human.userId ||
      payload.deviceId !== device.deviceId ||
      payload.iat > seconds + 5 ||
      payload.exp <= seconds
    )
      fail('signature_invalid')
    try {
      await verifyHostPairingManagementProof(
        proof,
        await this.publicJwk(host),
        payload,
      )
    } catch {
      fail('signature_invalid')
    }
    return payload
  }

  private async managed<T>(
    human: AuthenticatedHumanRequestContext,
    device: AuthenticatedProductDeviceContext,
    hostId: string,
    operation: (
      transaction: SqlExecutor,
      sessions: HostPairingRepository,
      now: Date,
      host: HostRecord,
    ) => Promise<T>,
  ): Promise<T> {
    const id = hostIdSchema.parse(hostId)
    return this.withAccount(
      human,
      device,
      async (transaction, sessions, now) => {
        const host = await this.ownedHost(transaction, human, id, true)
        await this.currentDevice(transaction, human, device)
        return operation(transaction, sessions, now, host)
      },
    )
  }

  private makeProposal(
    sessionId: EnrollmentChallengeId,
    human: AuthenticatedHumanRequestContext,
    host: HostRecord,
    target: ProductDeviceRecord,
    now: Date,
    expires: Date,
  ): HostDeviceAuthorizationPayload {
    return {
      v: 1,
      aud: HOST_AUDIENCE,
      purpose: 'host_device_authorization',
      authorizationId: createHostAuthorizationId(),
      challengeId: sessionId,
      hostId: host.hostId,
      hostFingerprint: host.fingerprint,
      hostIdentityGeneration: host.claimGeneration,
      spaceId: human.personalSpaceId,
      userId: human.userId,
      deviceId: target.deviceId,
      deviceKeyGeneration: target.keyGeneration,
      deviceFingerprint: target.fingerprint,
      scope: 'supervisor_control',
      nonce: randomBytes(32).toString('base64url'),
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor(expires.getTime() / 1000),
      authorizationExpiresAt: Math.floor(
        (now.getTime() + authorizationLifetimeMs) / 1000,
      ),
    }
  }

  public async create(
    human: AuthenticatedHumanRequestContext,
    device: AuthenticatedProductDeviceContext,
    hostId: string,
    input: unknown,
  ) {
    if (!this.hmacKey) fail('unavailable')
    return this.managed(
      human,
      device,
      hostId,
      async (_tx, sessions, now, host) => {
        const management = await this.verifyManagement(
          input,
          human,
          device,
          host,
          'host_pairing_create',
          undefined,
          now,
        )
        const sessionId = enrollmentChallengeIdSchema.parse(
          management.subjectId,
        )
        const existing = await sessions.findSession(sessionId)
        if (existing) {
          if (
            !sameOwnerSession(existing, human, device, host) ||
            existing.state !== 'pending' ||
            new Date(existing.expires_at) <= now ||
            existing.code_index === null
          )
            fail('session_conflict')
          const code = this.sessionCode(human, sessionId, existing.code_index)
          if (this.codeDigest(human, code) !== existing.code_hash)
            fail('session_conflict')
          return {
            ...sessionView(existing, now),
            status: 'pending' as const,
            code,
          }
        }
        const live = await sessions.liveCodes(human.userId, now)
        if (live.length >= maximumLiveCodes) fail('capacity')
        const attempts = Math.max(
          0,
          ...live
            .filter((row) => row.state === 'pending')
            .map((row) => row.failed_attempts),
        )
        for (let index = 0; index < 32; index += 1) {
          const code = this.sessionCode(human, sessionId, index)
          const codeHash = this.codeDigest(human, code)
          const previous = await sessions.mostRecentCode(human.userId, codeHash)
          if (previous && new Date(previous.expires_at) > now) continue
          const expires = expiresAt(now)
          if (
            !(await sessions.create({
              sessionId,
              userId: human.userId,
              spaceId: human.personalSpaceId,
              hostId: host.hostId,
              hostIdentityGeneration: host.claimGeneration,
              managingDeviceId: device.deviceId,
              managingDeviceKeyGeneration: device.keyGeneration,
              codeHash,
              codeIndex: index,
              failedAttempts: attempts,
              proposal: null,
              previousAuthorizationId: null,
              now,
              expiresAt: expires,
            }))
          )
            fail('session_conflict')
          return {
            status: 'pending' as const,
            sessionId,
            hostId: host.hostId,
            code,
            expiresAt: expires.toISOString(),
          }
        }
        return fail('capacity')
      },
    )
  }

  public async redeem(
    human: AuthenticatedHumanRequestContext,
    device: AuthenticatedProductDeviceContext,
    input: unknown,
  ) {
    const digest = this.codeDigest(human, redeemSchema.parse(input).code)
    return this.withAccount(
      human,
      device,
      async (transaction, sessions, now) => {
        const live = await sessions.liveCodes(human.userId, now)
        const matched = live.find((row) => row.code_hash === digest)
        const claimedByCaller =
          matched?.state === 'claimed' &&
          proposal(matched).deviceId === device.deviceId &&
          proposal(matched).deviceKeyGeneration === device.keyGeneration
        if (matched && (matched.state === 'pending' || claimedByCaller)) {
          const host = await this.ownedHost(
            transaction,
            human,
            matched.host_id,
            true,
          )
          const target = await this.currentDevice(transaction, human, device)
          if (
            matched.host_identity_generation !== host.claimGeneration ||
            matched.space_id !== human.personalSpaceId
          )
            fail('owner_mismatch')
          if (!claimedByCaller) {
            await sessions.claim(
              matched.session_id,
              this.makeProposal(
                matched.session_id,
                human,
                host,
                target,
                now,
                new Date(matched.expires_at),
              ),
            )
          }
          return { ...sessionView(matched, now), status: 'claimed' as const }
        }
        await this.currentDevice(transaction, human, device)
        const pending = live.filter((row) => row.state === 'pending')
        const attempts =
          pending.length === 0
            ? 0
            : Math.max(...pending.map((row) => row.failed_attempts)) + 1
        if (attempts > 0)
          await sessions.setFailedAttempts(human.userId, now, attempts)
        if (
          attempts >= maximumFailedAttempts ||
          (pending.length === 0 &&
            (await sessions.isLockedOut(human.userId, now)))
        ) {
          return { status: 'rate_limited' as const, remainingAttempts: 0 }
        }
        const previous =
          matched ?? (await sessions.mostRecentCode(human.userId, digest))
        const remainingAttempts = maximumFailedAttempts - attempts
        if (!previous)
          return { status: 'invalid_code' as const, remainingAttempts }
        if (previous.state === 'cancelled')
          return { status: 'cancelled' as const, remainingAttempts }
        if (new Date(previous.expires_at) <= now)
          return { status: 'expired' as const, remainingAttempts }
        return { status: 'used' as const, remainingAttempts }
      },
    )
  }

  public async readClaim(
    human: AuthenticatedHumanRequestContext,
    device: AuthenticatedProductDeviceContext,
    untrustedSessionId: string,
  ) {
    const id = enrollmentChallengeIdSchema.parse(untrustedSessionId)
    if (human.status !== 'active' || device.userId !== human.userId)
      fail('owner_mismatch')
    const row = await new HostPairingRepository(this.database).findSession(id)
    if (
      !row ||
      row.user_id !== human.userId ||
      row.space_id !== human.personalSpaceId ||
      row.previous_authorization_id ||
      !row.proposal
    )
      fail('session_not_found')
    const payload = proposal(row)
    if (
      payload.deviceId !== device.deviceId ||
      payload.deviceKeyGeneration !== device.keyGeneration
    )
      fail('session_not_found')
    const now = this.now()
    const view = sessionView(row, now)
    if (view.status !== 'paired' || !row.completed_authorization_id) return view
    const authorization = await new HostIdentityRepository(
      this.database,
    ).findDeviceAuthorization(row.completed_authorization_id)
    if (!authorization || authorization.revokedAt)
      return { ...view, status: 'cancelled' as const }
    return authorization.expiresAt > now
      ? view
      : { ...view, status: 'expired' as const }
  }

  public async manageSession(
    human: AuthenticatedHumanRequestContext,
    device: AuthenticatedProductDeviceContext,
    hostId: string,
    untrustedSessionId: string,
    action: 'status' | 'cancel',
    input: unknown,
  ) {
    const id = enrollmentChallengeIdSchema.parse(untrustedSessionId)
    return this.managed(
      human,
      device,
      hostId,
      async (tx, sessions, now, host) => {
        await this.verifyManagement(
          input,
          human,
          device,
          host,
          action === 'status' ? 'host_pairing_status' : 'host_pairing_cancel',
          id,
          now,
        )
        const row = await sessions.findSession(id)
        if (
          !row ||
          row.previous_authorization_id ||
          !sameOwnerSession(row, human, device, host)
        )
          fail('session_not_found')
        if (
          action === 'cancel' &&
          (row.state === 'pending' || row.state === 'claimed')
        ) {
          await sessions.cancel(id)
          return sessionView({ ...row, state: 'cancelled' }, now)
        }
        return this.hostSessionView(tx, row, now)
      },
    )
  }

  private async hostSessionView(
    tx: SqlExecutor,
    row: PairingSessionRow,
    now: Date,
  ) {
    const view = sessionView(row, now)
    if (view.status !== 'paired' && view.status !== 'claimed') return view
    const payload = proposal(row)
    const target = await new ProductDeviceRepository(tx).findProductDevice(
      payload.deviceId,
    )
    const device = target
      ? {
          deviceId: target.deviceId,
          label: target.label,
          platform: target.platform,
        }
      : undefined
    if (view.status === 'claimed') return { ...view, device, payload }
    if (!row.completed_authorization_id) fail('session_conflict')
    const record = await new HostIdentityRepository(tx).findDeviceAuthorization(
      row.completed_authorization_id,
    )
    if (!record || record.revokedAt)
      return { ...view, status: 'cancelled' as const }
    if (record.expiresAt <= now) return { ...view, status: 'expired' as const }
    return {
      ...view,
      device,
      authorization: supervisorAuthorizationEntry(record),
    }
  }

  public async listDevices(
    human: AuthenticatedHumanRequestContext,
    device: AuthenticatedProductDeviceContext,
    untrustedHostId: string,
  ) {
    if (human.status !== 'active' || device.userId !== human.userId)
      fail('owner_mismatch')
    const host = await this.ownedHost(
      this.database,
      human,
      hostIdSchema.parse(untrustedHostId),
      false,
    )
    const now = this.now()
    const rows = await new HostPairingRepository(this.database).listDevices(
      host.hostId,
      human.userId,
      human.personalSpaceId,
      host.claimGeneration,
    )
    return {
      devices: rows.map((row) => {
        const expires = new Date(row.expires_at)
        const lastUsed =
          row.last_used_at === null ? null : new Date(row.last_used_at)
        return {
          deviceId: row.device_id,
          label: row.label,
          platform: row.platform,
          authorizationId: row.authorization_id,
          pairingRootAuthorizationId: row.pairing_root_authorization_id,
          scope: 'supervisor_control' as const,
          lastUsedAt: lastUsed?.toISOString() ?? null,
          expiresAt: expires.toISOString(),
          status: expires > now ? ('active' as const) : ('expired' as const),
          renewalEligible: canRenew(expires, lastUsed, now),
        }
      }),
    }
  }

  private async renewable(
    tx: SqlExecutor,
    human: AuthenticatedHumanRequestContext,
    host: HostRecord,
    id: HostAuthorizationId,
    now: Date,
  ): Promise<{
    record: HostDeviceAuthorizationRecord
    target: ProductDeviceRecord
  }> {
    const identities = new HostIdentityRepository(tx)
    const candidate = await identities.findDeviceAuthorization(id)
    if (
      !candidate ||
      candidate.hostId !== host.hostId ||
      candidate.hostIdentityGeneration !== host.claimGeneration ||
      candidate.userId !== human.userId ||
      candidate.spaceId !== human.personalSpaceId ||
      candidate.scope !== 'supervisor_control'
    )
      fail('renewal_ineligible')
    const target = await new ProductDeviceRepository(
      tx,
    ).findProductDeviceForUpdate(candidate.deviceId)
    const record = await identities.findDeviceAuthorization(id, true)
    if (
      !record ||
      !record.pairingRootAuthorizationId ||
      record.revokedAt ||
      !canRenew(record.expiresAt, record.lastUsedAt, now)
    )
      fail('renewal_ineligible')
    if (
      !target ||
      target.ownerUserId !== human.userId ||
      target.keyGeneration !== record.deviceKeyGeneration ||
      target.fingerprint !== record.deviceFingerprint ||
      target.revokedAt
    )
      fail('device_unavailable')
    return { record, target }
  }

  public async prepareRenewal(
    human: AuthenticatedHumanRequestContext,
    device: AuthenticatedProductDeviceContext,
    hostId: string,
    untrustedAuthorizationId: string,
    input: unknown,
  ) {
    const id = hostAuthorizationIdSchema.parse(untrustedAuthorizationId)
    return this.managed(
      human,
      device,
      hostId,
      async (tx, sessions, now, host) => {
        await this.verifyManagement(
          input,
          human,
          device,
          host,
          'host_pairing_renew',
          id,
          now,
        )
        const { target } = await this.renewable(tx, human, host, id, now)
        const existing = await sessions.activeRenewal(id, now)
        if (existing) {
          if (!sameOwnerSession(existing, human, device, host))
            fail('session_conflict')
          return {
            status: 'confirmation_required' as const,
            payload: proposal(existing),
          }
        }
        const sessionId = createEnrollmentChallengeId()
        const expires = expiresAt(now)
        const payload = this.makeProposal(
          sessionId,
          human,
          host,
          target,
          now,
          expires,
        )
        if (
          !(await sessions.create({
            sessionId,
            userId: human.userId,
            spaceId: human.personalSpaceId,
            hostId: host.hostId,
            hostIdentityGeneration: host.claimGeneration,
            managingDeviceId: device.deviceId,
            managingDeviceKeyGeneration: device.keyGeneration,
            codeHash: null,
            codeIndex: null,
            failedAttempts: 0,
            proposal: payload,
            previousAuthorizationId: id,
            now,
            expiresAt: expires,
          }))
        )
          fail('session_conflict')
        return { status: 'confirmation_required' as const, payload }
      },
    )
  }

  public async finish(
    human: AuthenticatedHumanRequestContext,
    device: AuthenticatedProductDeviceContext,
    hostId: string,
    subjectId: string,
    action: 'pair' | 'renew',
    input: unknown,
  ) {
    const { payload, proof } = completionSchema.parse(input)
    const sessionId =
      action === 'pair'
        ? enrollmentChallengeIdSchema.parse(subjectId)
        : payload.challengeId
    const previousId =
      action === 'renew' ? hostAuthorizationIdSchema.parse(subjectId) : null
    return this.managed(
      human,
      device,
      hostId,
      async (tx, sessions, now, host) => {
        const row = await sessions.findSession(sessionId)
        if (
          !row ||
          row.previous_authorization_id !== previousId ||
          !sameOwnerSession(row, human, device, host) ||
          !row.proposal ||
          payload.scope !== 'supervisor_control' ||
          !Buffer.from(
            encodeHostDeviceAuthorizationPayload(proposal(row)),
          ).equals(encodeHostDeviceAuthorizationPayload(payload))
        )
          fail('session_not_found')
        try {
          await verifyHostDeviceAuthorizationProof(
            proof,
            await this.publicJwk(host),
            payload,
          )
        } catch {
          fail('signature_invalid')
        }
        if (row.state === 'paired') return this.completed(tx, row, now, action)
        if (row.state !== 'claimed') fail('session_conflict')
        if (new Date(row.expires_at) <= now) fail('session_expired')
        const previous = previousId
          ? (await this.renewable(tx, human, host, previousId, now)).record
          : null
        if (!previous) {
          const target = await new ProductDeviceRepository(
            tx,
          ).findProductDeviceForUpdate(payload.deviceId)
          if (
            !target ||
            target.ownerUserId !== human.userId ||
            target.keyGeneration !== payload.deviceKeyGeneration ||
            target.fingerprint !== payload.deviceFingerprint ||
            target.revokedAt
          )
            fail('device_unavailable')
        }
        const identities = new HostIdentityRepository(tx)
        const active = await identities.listEffectiveHostAuthorizations(
          host.hostId,
          human.userId,
          human.personalSpaceId,
          now,
        )
        if (
          active.length >= supervisorTransportLimits.maximumActivations &&
          !active.some((entry) => entry.deviceId === payload.deviceId)
        )
          fail('capacity')
        const sequence = await identities.nextDeviceAuthorizationSequence(
          host.hostId,
          payload.deviceId,
        )
        const repository = new ControlPlaneRepository(tx)
        const created = await repository.createHostDeviceAuthorization({
          authorizationId: payload.authorizationId,
          hostId: host.hostId,
          claimGeneration: host.claimGeneration,
          deviceId: payload.deviceId,
          deviceKeyGeneration: payload.deviceKeyGeneration,
          deviceFingerprint: payload.deviceFingerprint,
          userId: human.userId,
          spaceId: human.personalSpaceId,
          scope: 'supervisor_control',
          authorizationSerial: sequence.serial,
          authorizationGeneration: sequence.generation,
          issuedAt: new Date(payload.iat * 1000),
          expiresAt: new Date(payload.authorizationExpiresAt * 1000),
        })
        if (!created) fail('device_unavailable')
        if (previous) {
          if (
            !(await sessions.supersede(
              previous.authorizationId,
              payload.authorizationId,
              now,
            ))
          )
            fail('renewal_ineligible')
        } else {
          await sessions.supersedeOtherDeviceAccess(
            host.hostId,
            payload.deviceId,
            host.claimGeneration,
            payload.authorizationId,
            now,
          )
        }
        if (
          !(await sessions.finish(
            sessionId,
            payload.authorizationId,
            previous?.pairingRootAuthorizationId ?? payload.authorizationId,
            previous?.lastUsedAt ?? null,
          ))
        )
          fail('session_conflict')
        await repository.appendSecurityEvent({
          eventId: createSecurityEventId(),
          eventType: 'supervisor_authorized',
          actorKind: 'host',
          actorId: host.hostId,
          targetKind: 'authorization',
          targetId: payload.authorizationId,
          outcome: 'success',
          reasonCode: null,
          correlationId: sessionId,
          occurredAt: now,
        })
        return this.completed(
          tx,
          {
            ...row,
            state: 'paired',
            completed_authorization_id: payload.authorizationId,
          },
          now,
          action,
        )
      },
    )
  }

  private async completed(
    tx: SqlExecutor,
    row: PairingSessionRow,
    now: Date,
    action: 'pair' | 'renew',
  ) {
    if (!row.completed_authorization_id) fail('session_conflict')
    const record = await new HostIdentityRepository(tx).findDeviceAuthorization(
      row.completed_authorization_id,
    )
    if (!record || record.revokedAt || record.expiresAt <= now)
      fail('session_conflict')
    if (action === 'renew')
      return {
        status: 'renewed' as const,
        authorization: supervisorAuthorizationEntry(record),
      }
    return this.hostSessionView(tx, row, now)
  }

  public async revoke(
    human: AuthenticatedHumanRequestContext,
    device: AuthenticatedProductDeviceContext,
    hostId: string,
    untrustedTarget: string,
    input: unknown,
  ) {
    const targetId = productDeviceIdSchema.parse(untrustedTarget)
    return this.managed(
      human,
      device,
      hostId,
      async (tx, sessions, now, host) => {
        const payload = await this.verifyManagement(
          input,
          human,
          device,
          host,
          'host_pairing_revoke',
          undefined,
          now,
        )
        const id = hostAuthorizationIdSchema.parse(payload.subjectId)
        const record = await new HostIdentityRepository(
          tx,
        ).findDeviceAuthorization(id)
        if (
          !record ||
          record.hostId !== host.hostId ||
          record.hostIdentityGeneration !== host.claimGeneration ||
          record.userId !== human.userId ||
          record.spaceId !== human.personalSpaceId ||
          record.deviceId !== targetId ||
          payload.targetDeviceId !== targetId ||
          !record.pairingRootAuthorizationId ||
          record.pairingRootAuthorizationId !==
            payload.pairingRootAuthorizationId
        )
          fail('session_not_found')
        const revoked = await sessions.revokeLineage(
          host.hostId,
          targetId,
          record.pairingRootAuthorizationId,
          host.claimGeneration,
          now,
        )
        if (revoked.length > 0)
          await sessions.cancelDeviceProposals(
            host.hostId,
            targetId,
            human.userId,
          )
        const repository = new ControlPlaneRepository(tx)
        for (const authorizationId of revoked) {
          await repository.appendSecurityEvent({
            eventId: createSecurityEventId(),
            eventType: 'supervisor_revoked',
            actorKind: 'host',
            actorId: host.hostId,
            targetKind: 'authorization',
            targetId: authorizationId,
            outcome: 'success',
            reasonCode: null,
            correlationId: id,
            occurredAt: now,
          })
        }
        return { status: 'revoked' as const, deviceId: targetId }
      },
    )
  }
}

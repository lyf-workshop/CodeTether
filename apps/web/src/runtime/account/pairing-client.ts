import type { Session } from '@supabase/supabase-js'

import { hostBaseUrl } from '../host/host-config.js'
import type {
  HostIdentityCapability,
  ProductDeviceIdentityCapability,
} from '../native/native-capabilities.js'
import {
  base64Url,
  ControlPlaneClientError,
  createDeviceRequestProof,
  hostProof,
  listOwnedHosts,
  parseHostSupervisorAuthorization,
  postAuthenticatedProductDeviceJson,
  resolveExistingProductDevice,
  type HostSupervisorAuthorization,
  type OwnedHostAccessEntry,
  type ResolvedProductDevice,
} from './control-plane-client.js'
import {
  enrollLocalHost,
  readLocalHostIdentity,
  type LocalHostIdentityRecord,
} from './remote-supervisor.js'

export interface PairingDeviceContext {
  readonly session: Session
  readonly controlPlaneBaseUrl: string
  readonly deviceIdentity: ProductDeviceIdentityCapability
  readonly productDevice: ResolvedProductDevice
  readonly signal?: AbortSignal
}

export interface PairingOwnerContext extends PairingDeviceContext {
  readonly host: Pick<
    OwnedHostAccessEntry,
    'hostId' | 'spaceId' | 'fingerprint' | 'identityGeneration'
  >
  readonly localIdentity: LocalHostIdentityRecord
  readonly hostIdentity: HostIdentityCapability
}

export interface PairedDevice {
  readonly deviceId: string
  readonly label: string
  readonly platform: string
  readonly authorizationId: string
  readonly pairingRootAuthorizationId: string
  readonly lastUsedAt: string | null
  readonly expiresAt: string
  readonly status: 'active' | 'expired'
  readonly renewalEligible: boolean
}

export type PairingStatus =
  'pending' | 'claimed' | 'paired' | 'cancelled' | 'expired' | 'rate_limited'

export interface PairingSession {
  readonly status: PairingStatus
  readonly sessionId: string
  readonly hostId: string
  readonly expiresAt: string
  readonly code?: string
  readonly device?: {
    readonly deviceId: string
    readonly label: string
    readonly platform: string
  }
  readonly payload?: Readonly<Record<string, unknown>>
  readonly authorization?: HostSupervisorAuthorization
}

export type RedeemPairingCode =
  | PairingSession
  | {
      readonly status:
        'invalid_code' | 'expired' | 'used' | 'cancelled' | 'rate_limited'
      readonly remainingAttempts: number
    }

type PairingPurpose =
  | 'host_pairing_create'
  | 'host_pairing_status'
  | 'host_pairing_cancel'
  | 'host_pairing_renew'
  | 'host_pairing_revoke'

export async function loadPairingOwner(
  options: Omit<
    PairingOwnerContext,
    'host' | 'localIdentity' | 'productDevice'
  > & { readonly allowFirstClaim?: boolean },
): Promise<PairingOwnerContext> {
  if (!options.hostIdentity.available)
    throw new ControlPlaneClientError('pairing_computer_unavailable', undefined)
  let localIdentity = await readLocalHostIdentity(options.signal)
  const productDevice = await resolveExistingProductDevice({
    accessToken: options.session.access_token,
    baseUrl: options.controlPlaneBaseUrl,
    identity: options.deviceIdentity,
    existingOnly: options.allowFirstClaim !== true || localIdentity !== null,
    signal: options.signal,
  })
  const device = { ...options, productDevice }
  if (localIdentity === null && options.allowFirstClaim === true) {
    const response = await fetch(
      `${options.controlPlaneBaseUrl}/v1/account/me`,
      {
        headers: { authorization: `Bearer ${options.session.access_token}` },
        signal: options.signal,
      },
    )
    const account = record(await response.json())
    if (
      !response.ok ||
      account.userId !== productDevice.device.ownerUserId ||
      !identifier(account.personalSpaceId, 'space_')
    )
      invalid()
    options.signal?.throwIfAborted()
    // The owner explicitly opened the pairing window. Only a fresh local
    // identity may enter the existing registration and claim flow here.
    localIdentity = await enrollLocalHost({
      session: options.session,
      controlPlaneBaseUrl: options.controlPlaneBaseUrl,
      productDevice,
      productDeviceIdentity: options.deviceIdentity,
      hostIdentity: options.hostIdentity,
      spaceId: account.personalSpaceId,
      signal: options.signal,
    })
  }
  const hosts = await listOwnedHosts(requestContext(device))
  const host = hosts.find(
    (candidate) =>
      candidate.hostId === localIdentity?.hostId &&
      candidate.fingerprint === localIdentity.fingerprint &&
      candidate.identityGeneration === localIdentity.identityGeneration,
  )
  if (localIdentity === null || host === undefined) {
    throw new ControlPlaneClientError('pairing_computer_unavailable', undefined)
  }
  return { ...device, host, localIdentity }
}

function requestContext(context: PairingDeviceContext) {
  return {
    accessToken: context.session.access_token,
    baseUrl: context.controlPlaneBaseUrl,
    identity: context.deviceIdentity,
    productDevice: context.productDevice,
    signal: context.signal,
  }
}

function requestSignal(context: PairingDeviceContext): AbortSignal {
  const timeout = AbortSignal.timeout(12_000)
  return context.signal === undefined
    ? timeout
    : AbortSignal.any([context.signal, timeout])
}

async function get(
  context: PairingDeviceContext,
  resource: string,
): Promise<unknown> {
  const signal = requestSignal(context)
  signal.throwIfAborted()
  const proof = await createDeviceRequestProof({
    accessToken: context.session.access_token,
    deviceId: context.productDevice.device.deviceId,
    keyGeneration: context.productDevice.device.keyGeneration,
    keyHandle: context.productDevice.key.keyHandle,
    identity: context.deviceIdentity,
    method: 'GET',
    resource,
  })
  signal.throwIfAborted()
  const response = await fetch(`${context.controlPlaneBaseUrl}${resource}`, {
    headers: {
      authorization: `Bearer ${context.session.access_token}`,
      'x-codetether-device-proof': proof,
    },
    signal,
  })
  if (!response.ok)
    throw new ControlPlaneClientError('pairing_request_failed', response.status)
  return await response.json()
}

function post(context: PairingDeviceContext, resource: string, value: unknown) {
  return postAuthenticatedProductDeviceJson({
    ...requestContext(context),
    resource,
    value,
    signal: requestSignal(context),
  })
}

async function signManagement(
  context: PairingOwnerContext,
  purpose: PairingPurpose,
  subjectId: string,
  target?: PairedDevice,
) {
  const iat = Math.floor(Date.now() / 1_000)
  const payload = {
    v: 1,
    aud: 'codetether-control-plane-host',
    purpose,
    hostId: context.host.hostId,
    hostFingerprint: context.host.fingerprint,
    hostIdentityGeneration: context.host.identityGeneration,
    spaceId: context.host.spaceId,
    userId: context.productDevice.device.ownerUserId,
    deviceId: context.productDevice.device.deviceId,
    subjectId,
    nonce: base64Url(crypto.getRandomValues(new Uint8Array(32))),
    iat,
    exp: iat + 60,
    ...(target === undefined
      ? {}
      : {
          targetDeviceId: target.deviceId,
          pairingRootAuthorizationId: target.pairingRootAuthorizationId,
        }),
  }
  context.signal?.throwIfAborted()
  const proof = await hostProof(
    'codetether-host-pairing-management+jws',
    payload,
    context.localIdentity.keyHandle,
    context.hostIdentity,
  )
  context.signal?.throwIfAborted()
  return { payload, proof }
}

function hostPath(context: PairingOwnerContext) {
  return `/v1/hosts/${encodeURIComponent(context.host.hostId)}`
}

export function newPairingSessionId() {
  return `enroll_${crypto.randomUUID().replaceAll('-', '')}`
}

export async function createPairingSession(
  context: PairingOwnerContext,
  sessionId: string,
): Promise<PairingSession> {
  const result = parseSession(
    await post(
      context,
      `${hostPath(context)}/pairing-sessions`,
      await signManagement(context, 'host_pairing_create', sessionId),
    ),
    sessionId,
    context.host.hostId,
  )
  if (result.status !== 'pending' || result.code === undefined) invalid()
  return result
}

export async function readOwnerPairingSession(
  context: PairingOwnerContext,
  sessionId: string,
): Promise<PairingSession> {
  return parseSession(
    await post(
      context,
      `${hostPath(context)}/pairing-sessions/${encodeURIComponent(sessionId)}/status`,
      await signManagement(context, 'host_pairing_status', sessionId),
    ),
    sessionId,
    context.host.hostId,
  )
}

export async function cancelPairingSession(
  context: PairingOwnerContext,
  sessionId: string,
): Promise<void> {
  parseSession(
    await post(
      context,
      `${hostPath(context)}/pairing-sessions/${encodeURIComponent(sessionId)}/cancel`,
      await signManagement(context, 'host_pairing_cancel', sessionId),
    ),
    sessionId,
    context.host.hostId,
  )
}

export async function finishPairingSession(
  context: PairingOwnerContext,
  session: PairingSession,
): Promise<PairingSession> {
  if (
    session.status !== 'claimed' ||
    session.device === undefined ||
    session.payload === undefined
  )
    invalid()
  const result = parseSession(
    await post(
      context,
      `${hostPath(context)}/pairing-sessions/${encodeURIComponent(session.sessionId)}/finish`,
      await signAuthorization(
        context,
        session.payload,
        session.device.deviceId,
        session.sessionId,
      ),
    ),
    session.sessionId,
    context.host.hostId,
  )
  if (
    result.status !== 'paired' ||
    result.authorization?.scope !== 'supervisor_control' ||
    result.authorization.deviceId !== session.device.deviceId
  )
    invalid()
  return result
}

export async function redeemPairingCode(
  context: PairingDeviceContext,
  code: string,
): Promise<RedeemPairingCode> {
  if (!/^\d{6}$/u.test(code)) invalid()
  const value = record(
    await post(context, '/v1/pairing-sessions/redeem', { code }),
  )
  if (value.status === 'claimed') return parseSession(value)
  if (
    (value.status === 'invalid_code' ||
      value.status === 'expired' ||
      value.status === 'used' ||
      value.status === 'cancelled' ||
      value.status === 'rate_limited') &&
    typeof value.remainingAttempts === 'number' &&
    Number.isInteger(value.remainingAttempts) &&
    value.remainingAttempts >= 0 &&
    value.remainingAttempts <= 5
  )
    return { status: value.status, remainingAttempts: value.remainingAttempts }
  invalid()
}

export async function readClaimedPairingSession(
  context: PairingDeviceContext,
  session: PairingSession,
): Promise<PairingSession> {
  return parseSession(
    await get(
      context,
      `/v1/pairing-sessions/${encodeURIComponent(session.sessionId)}`,
    ),
    session.sessionId,
    session.hostId,
  )
}

export async function listPairedDevices(
  context: PairingOwnerContext,
): Promise<readonly PairedDevice[]> {
  const value = record(
    await get(context, `${hostPath(context)}/paired-devices`),
  )
  if (!Array.isArray(value.devices) || value.devices.length > 256) invalid()
  return value.devices.map((entry: unknown) => {
    const device = record(entry)
    if (
      !identifier(device.deviceId, 'dev_') ||
      !identifier(device.authorizationId, 'hauth_') ||
      !identifier(device.pairingRootAuthorizationId, 'hauth_') ||
      device.scope !== 'supervisor_control' ||
      !bounded(device.label, 120) ||
      !bounded(device.platform, 64) ||
      !timestamp(device.expiresAt) ||
      !(device.lastUsedAt === null || timestamp(device.lastUsedAt)) ||
      (device.status !== 'active' && device.status !== 'expired') ||
      typeof device.renewalEligible !== 'boolean'
    )
      invalid()
    return {
      deviceId: device.deviceId,
      label: device.label,
      platform: device.platform,
      authorizationId: device.authorizationId,
      pairingRootAuthorizationId: device.pairingRootAuthorizationId,
      expiresAt: device.expiresAt,
      lastUsedAt: device.lastUsedAt,
      status: device.status,
      renewalEligible: device.renewalEligible,
    }
  })
}

export async function renewPairedDevice(
  context: PairingOwnerContext,
  device: PairedDevice,
): Promise<boolean> {
  if (!(await checkLocalRenewal(context, device))) return false
  const resource = `${hostPath(context)}/paired-authorizations/${encodeURIComponent(device.authorizationId)}/renew`
  const challenge = record(
    await post(
      context,
      resource,
      await signManagement(
        context,
        'host_pairing_renew',
        device.authorizationId,
      ),
    ),
  )
  if (challenge.status !== 'confirmation_required') invalid()
  const proposal = record(challenge.payload)
  if (!(await checkLocalRenewal(context, device, proposal))) return false
  const result = record(
    await post(
      context,
      `${resource}/finish`,
      await signAuthorization(
        context,
        proposal,
        device.deviceId,
        undefined,
        device.authorizationId,
      ),
    ),
  )
  if (result.status !== 'renewed') invalid()
  const authorization = parseHostSupervisorAuthorization(
    result.authorization,
    context.host.hostId,
  )
  if (
    authorization.deviceId !== device.deviceId ||
    authorization.scope !== 'supervisor_control'
  )
    invalid()
  return true
}

async function checkLocalRenewal(
  context: PairingOwnerContext,
  device: PairedDevice,
  proposal?: Readonly<Record<string, unknown>>,
): Promise<boolean> {
  const result = await postLocalPairing(context, 'renewal-check', {
    previousAuthorizationId: device.authorizationId,
    pairingRootAuthorizationId: device.pairingRootAuthorizationId,
    deviceId: device.deviceId,
    proposal,
  })
  if (typeof result.allowed !== 'boolean') invalid()
  return result.allowed
}

async function postLocalPairing(
  context: PairingOwnerContext,
  operation: 'renewal-check' | 'record',
  value: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `${hostBaseUrl}/api/v1/supervisor/pairing/${operation}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value),
      signal: context.signal,
    },
  )
  if (!response.ok)
    throw new ControlPlaneClientError(
      'pairing_local_check_failed',
      response.status,
    )
  return record(await response.json())
}

export async function removePairedDevice(
  context: PairingOwnerContext,
  device: PairedDevice,
): Promise<void> {
  const signed = await signManagement(
    context,
    'host_pairing_revoke',
    device.authorizationId,
    device,
  )
  const response = await fetch(
    `${hostBaseUrl}/api/v1/supervisor/devices/disable`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(signed),
      signal: context.signal,
    },
  )
  if (!response.ok || record(await response.json()).status !== 'disabled')
    throw new ControlPlaneClientError(
      'pairing_disconnect_failed',
      response.status,
    )
  try {
    const result = record(
      await post(
        context,
        `${hostPath(context)}/paired-devices/${encodeURIComponent(device.deviceId)}/revoke`,
        signed,
      ),
    )
    if (result.status !== 'revoked' || result.deviceId !== device.deviceId)
      invalid()
  } catch {
    throw new ControlPlaneClientError(
      'pairing_removal_confirmation_unavailable',
      undefined,
    )
  }
}

async function signAuthorization(
  context: PairingOwnerContext,
  payload: Readonly<Record<string, unknown>>,
  deviceId: string,
  challengeId?: string,
  previousAuthorizationId: string | null = null,
) {
  const now = Math.floor(Date.now() / 1_000)
  if (
    Object.keys(payload).length !== 18 ||
    payload.v !== 1 ||
    payload.aud !== 'codetether-control-plane-host' ||
    payload.purpose !== 'host_device_authorization' ||
    !identifier(payload.authorizationId, 'hauth_') ||
    !identifier(payload.challengeId, 'enroll_') ||
    (challengeId !== undefined && payload.challengeId !== challengeId) ||
    payload.hostId !== context.host.hostId ||
    payload.hostFingerprint !== context.host.fingerprint ||
    payload.hostIdentityGeneration !== context.host.identityGeneration ||
    payload.spaceId !== context.host.spaceId ||
    payload.userId !== context.productDevice.device.ownerUserId ||
    payload.deviceId !== deviceId ||
    payload.scope !== 'supervisor_control' ||
    !Number.isSafeInteger(payload.deviceKeyGeneration) ||
    Number(payload.deviceKeyGeneration) < 1 ||
    typeof payload.deviceFingerprint !== 'string' ||
    !/^sha256:[A-Za-z0-9_-]{43}$/u.test(payload.deviceFingerprint) ||
    typeof payload.nonce !== 'string' ||
    !/^[A-Za-z0-9_-]{22,86}$/u.test(payload.nonce) ||
    !Number.isSafeInteger(payload.iat) ||
    !Number.isSafeInteger(payload.exp) ||
    !Number.isSafeInteger(payload.authorizationExpiresAt) ||
    Number(payload.iat) > now + 60 ||
    Number(payload.exp) <= now ||
    Number(payload.exp) <= Number(payload.iat) ||
    Number(payload.exp) - Number(payload.iat) > 300 ||
    Number(payload.authorizationExpiresAt) <= Number(payload.exp) ||
    Number(payload.authorizationExpiresAt) > now + 31 * 86_400
  )
    invalid()
  context.signal?.throwIfAborted()
  const proof = await hostProof(
    'codetether-host-device-authorization+jws',
    payload,
    context.localIdentity.keyHandle,
    context.hostIdentity,
  )
  context.signal?.throwIfAborted()
  const evidence = { authorization: payload, previousAuthorizationId }
  const evidenceProof = await hostProof(
    'codetether-local-pairing-authorization+jws',
    evidence,
    context.localIdentity.keyHandle,
    context.hostIdentity,
  )
  context.signal?.throwIfAborted()
  const local = await postLocalPairing(context, 'record', {
    payload: evidence,
    proof: evidenceProof,
  })
  if (local.status !== 'recorded') invalid()
  context.signal?.throwIfAborted()
  return { payload, proof }
}

function parseSession(
  value: unknown,
  sessionId?: string,
  hostId?: string,
): PairingSession {
  const session = record(value)
  const status = session.status
  if (
    (status !== 'pending' &&
      status !== 'claimed' &&
      status !== 'paired' &&
      status !== 'cancelled' &&
      status !== 'expired' &&
      status !== 'rate_limited') ||
    !identifier(session.sessionId, 'enroll_') ||
    (sessionId !== undefined && session.sessionId !== sessionId) ||
    !identifier(session.hostId, 'host_') ||
    (hostId !== undefined && session.hostId !== hostId) ||
    !timestamp(session.expiresAt)
  )
    invalid()
  const code = session.code
  if (
    code !== undefined &&
    (typeof code !== 'string' || !/^\d{6}$/u.test(code))
  )
    invalid()
  const device =
    session.device === undefined ? undefined : record(session.device)
  if (
    device !== undefined &&
    (!identifier(device.deviceId, 'dev_') ||
      !bounded(device.label, 120) ||
      !bounded(device.platform, 64))
  )
    invalid()
  return {
    status,
    sessionId: session.sessionId,
    hostId: session.hostId,
    expiresAt: session.expiresAt,
    ...(code === undefined ? {} : { code }),
    ...(device === undefined
      ? {}
      : {
          device: {
            deviceId: device.deviceId as string,
            label: device.label as string,
            platform: device.platform as string,
          },
        }),
    ...(session.payload === undefined
      ? {}
      : { payload: record(session.payload) }),
    ...(session.authorization === undefined
      ? {}
      : {
          authorization: parseHostSupervisorAuthorization(
            session.authorization,
            session.hostId,
          ),
        }),
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    invalid()
  return value as Record<string, unknown>
}

function bounded(value: unknown, length: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= length
}

function identifier(value: unknown, prefix: string): value is string {
  return (
    bounded(value, 160) &&
    value.startsWith(prefix) &&
    /^[A-Za-z0-9_-]+$/u.test(value)
  )
}

function timestamp(value: unknown): value is string {
  return bounded(value, 64) && Number.isFinite(Date.parse(value))
}

function invalid(): never {
  throw new ControlPlaneClientError('pairing_response_invalid', undefined)
}

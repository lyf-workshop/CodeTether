import type { Session } from '@supabase/supabase-js'

import { hostBaseUrl } from '../host/host-config.js'
import type {
  HostIdentityCapability,
  ProductDeviceIdentityCapability,
} from '../native/native-capabilities.js'
import {
  base64Url,
  canonicalJsonBytes,
  createDeviceRequestProof,
  postAuthenticatedProductDeviceJson,
  sha256Digest,
  utf8,
  type AuthorizedHostDirectoryEntry,
  type ResolvedProductDevice,
  type SignedSupervisorGrant,
  type SignedSupervisorTransportDescriptor,
  type SupervisorTransportDescriptorPayload,
} from './control-plane-client.js'

const GRANT_TYPE = 'codetether-host-supervisor-grant+jws'
const DESCRIPTOR_TYPE = 'codetether-host-supervisor-transport+jws'

export interface LocalHostIdentityRecord {
  readonly hostId: string
  readonly publicJwk: string
  readonly fingerprint: string
  readonly keyHandle: string
  readonly identityGeneration: number
}

export interface RemoteSupervisorSession {
  readonly hostId: string
  readonly sessionId: string
  readonly expiresAt: string
  readonly transport: 'direct' | 'relay'
  readonly bootstrap: unknown
  readonly machines: unknown
}

export async function readLocalHostIdentity(): Promise<
  LocalHostIdentityRecord | undefined
> {
  const response = await fetch(`${hostBaseUrl}/api/v1/host/identity`, {
    headers: { accept: 'application/json' },
  })
  if (response.status === 404) return undefined
  if (!response.ok) throw new Error('local_host_identity_unavailable')
  const value = (await response.json()) as {
    readonly identity?: {
      readonly hostId?: unknown
      readonly fingerprint?: unknown
      readonly identityGeneration?: unknown
      readonly publicJwk?: unknown
      readonly keyHandle?: unknown
    }
  }
  const identity = value.identity
  if (
    typeof identity?.hostId !== 'string' ||
    typeof identity.fingerprint !== 'string' ||
    !Number.isSafeInteger(identity.identityGeneration) ||
    typeof identity.publicJwk !== 'string' ||
    typeof identity.keyHandle !== 'string'
  ) {
    throw new Error('local_host_identity_invalid')
  }
  return identity as LocalHostIdentityRecord
}

const remoteSessions = new Map<string, RemoteSupervisorSession>()

export function currentRemoteSupervisorSession(
  hostId: string,
): RemoteSupervisorSession | undefined {
  const session = remoteSessions.get(hostId)
  if (session !== undefined && Date.parse(session.expiresAt) > Date.now()) {
    return session
  }
  remoteSessions.delete(hostId)
  return undefined
}

export async function publishLocalSupervisorPresence(options: {
  readonly session: Session
  readonly controlPlaneBaseUrl: string
  readonly host: AuthorizedHostDirectoryEntry
  readonly localIdentity: LocalHostIdentityRecord
  readonly productDevice: ResolvedProductDevice
  readonly deviceIdentity: ProductDeviceIdentityCapability
  readonly hostIdentity: HostIdentityCapability
  readonly signal?: AbortSignal
}): Promise<void> {
  const hostPublicJwk = parsePublicJwk(options.localIdentity.publicJwk)
  if (
    options.host.hostId !== options.localIdentity.hostId ||
    options.host.fingerprint !== options.localIdentity.fingerprint ||
    options.host.identityGeneration !==
      options.localIdentity.identityGeneration ||
    hostPublicJwk.crv !== options.host.publicKey.crv ||
    hostPublicJwk.kty !== options.host.publicKey.kty ||
    hostPublicJwk.x !== options.host.publicKey.x ||
    hostPublicJwk.y !== options.host.publicKey.y
  ) {
    throw new Error('local_host_identity_mismatch')
  }

  let grant: SignedSupervisorGrant
  if (options.host.supervisor === null) {
    const payload = {
      v: 1 as const,
      aud: 'codetether-host-supervisor' as const,
      purpose: 'host_supervisor_grant' as const,
      authorizationId: options.host.authorization.authorizationId,
      hostId: options.host.hostId,
      hostFingerprint: options.host.fingerprint,
      hostIdentityGeneration: options.host.identityGeneration,
      deviceId: options.productDevice.device.deviceId,
      deviceFingerprint: options.productDevice.device.fingerprint,
      deviceKeyGeneration: options.productDevice.device.keyGeneration,
      userId: options.productDevice.device.ownerUserId,
      spaceId: options.host.spaceId,
      scope: 'supervisor_read' as const,
      authorizationSerial: options.host.authorization.serial,
      authorizationGeneration: options.host.authorization.generation,
      issuedAt: Math.floor(
        Date.parse(options.host.authorization.issuedAt) / 1_000,
      ),
      expiresAt: Math.floor(
        Date.parse(options.host.authorization.expiresAt) / 1_000,
      ),
    }
    grant = {
      payload,
      proof: await signHostProof(
        options.hostIdentity,
        options.localIdentity.keyHandle,
        GRANT_TYPE,
        payload,
      ),
    }
    await postAuthenticatedProductDeviceJson({
      accessToken: options.session.access_token,
      baseUrl: options.controlPlaneBaseUrl,
      identity: options.deviceIdentity,
      productDevice: options.productDevice,
      resource: `/v1/hosts/${options.host.hostId}/supervisor-grant/materialize`,
      value: grant,
      signal: options.signal,
    })
  } else {
    grant = options.host.supervisor.grant
  }

  const presence = await readJson(`${hostBaseUrl}/api/v1/supervisor/presence`, {
    signal: options.signal,
  })
  const transportTlsFingerprint = boundedString(
    presence,
    'transportTlsFingerprint',
  )
  const directEndpoints = parseDirectEndpoints(presence.directEndpoints)
  const relay = parseRelayPresence(presence.relay)
  const now = Math.floor(Date.now() / 1_000)
  const descriptorPayload: SupervisorTransportDescriptorPayload = {
    v: 1,
    aud: 'codetether-host-supervisor',
    purpose: 'host_supervisor_transport',
    authorizationId: grant.payload.authorizationId,
    grantDigest: await sha256Digest(canonicalJsonBytes(grant.payload)),
    hostId: grant.payload.hostId,
    hostFingerprint: grant.payload.hostFingerprint,
    hostIdentityGeneration: grant.payload.hostIdentityGeneration,
    deviceId: grant.payload.deviceId,
    deviceKeyGeneration: grant.payload.deviceKeyGeneration,
    transportTlsFingerprint,
    controlPlaneOrigin: new URL(options.controlPlaneBaseUrl).origin,
    directEndpoints,
    relay,
    iat: now,
    exp: Math.min(now + 600, grant.payload.expiresAt),
    protocolVersion: 1,
  }
  const descriptor: SignedSupervisorTransportDescriptor = {
    payload: descriptorPayload,
    proof: await signHostProof(
      options.hostIdentity,
      options.localIdentity.keyHandle,
      DESCRIPTOR_TYPE,
      descriptorPayload,
    ),
  }
  await postLocalJson('/api/v1/supervisor/activate', {
    hostPublicJwk,
    grant,
    descriptor,
  })
  await postAuthenticatedProductDeviceJson({
    accessToken: options.session.access_token,
    baseUrl: options.controlPlaneBaseUrl,
    identity: options.deviceIdentity,
    productDevice: options.productDevice,
    resource: `/v1/hosts/${options.host.hostId}/supervisor-presence`,
    value: { grant, descriptor },
    signal: options.signal,
  })
}

export async function connectRemoteSupervisor(options: {
  readonly session: Session
  readonly host: AuthorizedHostDirectoryEntry
  readonly productDevice: ResolvedProductDevice
  readonly deviceIdentity: ProductDeviceIdentityCapability
  readonly forceRelay?: boolean
  readonly signal?: AbortSignal
}): Promise<RemoteSupervisorSession> {
  const existing = currentRemoteSupervisorSession(options.host.hostId)
  if (
    existing !== undefined &&
    (options.forceRelay !== true || existing.transport === 'relay')
  ) {
    return existing
  }
  if (existing !== undefined) {
    await fetch(
      `${hostBaseUrl}/api/v1/remote-supervisor/sessions/${encodeURIComponent(existing.sessionId)}`,
      { method: 'DELETE' },
    ).catch(() => undefined)
    remoteSessions.delete(options.host.hostId)
  }
  if (options.host.supervisor === null) {
    throw new Error('remote_supervisor_presence_unavailable')
  }
  const pending = await postLocalJson('/api/v1/remote-supervisor/connections', {
    hostId: options.host.hostId,
    hostFingerprint: options.host.fingerprint,
    hostIdentityGeneration: options.host.identityGeneration,
    hostPublicJwk: options.host.publicKey,
    deviceId: options.productDevice.device.deviceId,
    deviceKeyGeneration: options.productDevice.device.keyGeneration,
    grant: options.host.supervisor.grant,
    descriptor: options.host.supervisor.transport,
    ...(options.forceRelay === true ? { forceRelay: true } : {}),
  })
  const connectionId = boundedString(pending, 'connectionId')
  const admissionResource = boundedString(pending, 'admissionResource')
  const challengeBody = decodeBase64Url(
    boundedString(pending, 'challengeBodyBase64Url'),
  )
  const proof = await createDeviceRequestProof({
    accessToken: options.session.access_token,
    deviceId: options.productDevice.device.deviceId,
    keyGeneration: options.productDevice.device.keyGeneration,
    keyHandle: options.productDevice.key.keyHandle,
    identity: options.deviceIdentity,
    method: 'POST',
    resource: admissionResource,
    body: challengeBody,
  })
  const authenticated = await postLocalJson(
    `/api/v1/remote-supervisor/connections/${encodeURIComponent(connectionId)}/authenticate`,
    { accessToken: options.session.access_token, deviceProof: proof },
  )
  const sessionId = boundedString(authenticated, 'sessionId')
  const expiresAt = boundedString(authenticated, 'expiresAt')
  const transport = boundedString(pending, 'transport')
  if (transport !== 'direct' && transport !== 'relay') {
    throw new Error('Supervisor response is invalid')
  }
  const [bootstrap, machines] = await Promise.all([
    readJson(
      `${hostBaseUrl}/api/v1/remote-supervisor/sessions/${encodeURIComponent(sessionId)}/bootstrap`,
    ),
    readJson(
      `${hostBaseUrl}/api/v1/remote-supervisor/sessions/${encodeURIComponent(sessionId)}/machines`,
    ),
  ])
  const connected: RemoteSupervisorSession = {
    hostId: options.host.hostId,
    sessionId,
    expiresAt,
    transport,
    bootstrap,
    machines,
  }
  remoteSessions.set(options.host.hostId, connected)
  return connected
}

export async function readRemoteMachine(
  hostId: string,
  machineId: string,
): Promise<unknown> {
  const session = currentRemoteSupervisorSession(hostId)
  if (session === undefined)
    throw new Error('remote_supervisor_session_expired')
  return await readJson(
    `${hostBaseUrl}/api/v1/remote-supervisor/sessions/${encodeURIComponent(session.sessionId)}/machines/${encodeURIComponent(machineId)}`,
  )
}

async function signHostProof(
  identity: HostIdentityCapability,
  keyHandle: string,
  type: string,
  payload: unknown,
): Promise<string> {
  const header = base64Url(utf8(JSON.stringify({ alg: 'ES256', typ: type })))
  const encodedPayload = base64Url(canonicalJsonBytes(payload))
  const signingInput = `${header}.${encodedPayload}`
  const signature = await identity.sign(
    keyHandle,
    base64Url(utf8(signingInput)),
  )
  return `${signingInput}.${signature.signatureBase64Url}`
}

async function postLocalJson(
  path: string,
  value: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${hostBaseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  })
  if (!response.ok)
    throw new Error(`remote_supervisor_${String(response.status)}`)
  return asRecord(await response.json())
}

async function readJson(
  url: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, init)
  if (!response.ok)
    throw new Error(`remote_supervisor_${String(response.status)}`)
  return asRecord(await response.json())
}

function parsePublicJwk(value: string): {
  readonly crv: 'P-256'
  readonly kty: 'EC'
  readonly x: string
  readonly y: string
} {
  const key = asRecord(JSON.parse(value))
  if (
    key.kty !== 'EC' ||
    key.crv !== 'P-256' ||
    typeof key.x !== 'string' ||
    typeof key.y !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/u.test(key.x) ||
    !/^[A-Za-z0-9_-]{43}$/u.test(key.y)
  ) {
    throw new Error('Local Host public key is invalid')
  }
  return { crv: 'P-256', kty: 'EC', x: key.x, y: key.y }
}

function parseDirectEndpoints(value: unknown): readonly {
  readonly host: string
  readonly port: number
}[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    throw new Error('Supervisor presence is invalid')
  }
  return value.map((entry) => {
    const record = asRecord(entry)
    const host = boundedString(record, 'host')
    if (!Number.isInteger(record.port) || Number(record.port) < 1) {
      throw new Error('Supervisor presence is invalid')
    }
    return { host, port: Number(record.port) }
  })
}

function parseRelayPresence(
  value: unknown,
): SupervisorTransportDescriptorPayload['relay'] {
  if (value === null) return null
  const relay = asRecord(value)
  const endpoint = boundedString(relay, 'endpoint')
  const relayId = boundedString(relay, 'relayId')
  const relayFingerprint = boundedString(relay, 'relayFingerprint')
  const rendezvousId = boundedString(relay, 'rendezvousId')
  const rendezvousCapability = boundedString(relay, 'rendezvousCapability')
  const hostTransportFingerprint = boundedString(
    relay,
    'hostTransportFingerprint',
  )
  if (
    !/^relay_[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/u.test(relayId) ||
    !/^srv_[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/u.test(rendezvousId) ||
    !/^[A-Za-z0-9_-]{43}$/u.test(relayFingerprint) ||
    !/^[A-Za-z0-9_-]{43}$/u.test(rendezvousCapability) ||
    !/^[A-Za-z0-9_-]{43}$/u.test(hostTransportFingerprint)
  ) {
    throw new Error('Supervisor presence is invalid')
  }
  return {
    endpoint,
    relayId,
    relayFingerprint,
    rendezvousId,
    rendezvousCapability,
    hostTransportFingerprint,
  }
}

function boundedString(value: Record<string, unknown>, key: string): string {
  const field = value[key]
  if (
    typeof field !== 'string' ||
    field.length === 0 ||
    field.length > 16_384
  ) {
    throw new Error('Supervisor response is invalid')
  }
  return field
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Supervisor response is invalid')
  }
  return value as Record<string, unknown>
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error('Supervisor response is invalid')
  }
  const base64 = value.replace(/-/gu, '+').replace(/_/gu, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

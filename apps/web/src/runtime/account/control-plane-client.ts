import type {
  ProductDeviceIdentityCapability,
  ProductDeviceKeyDescription,
} from '../native/native-capabilities.js'

const DEVICE_PROOF_HEADER = 'x-codetether-device-proof'
const EMPTY_BODY_DIGEST = 'sha256:47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU'

export interface AccountProductDevice {
  readonly deviceId: string
  readonly ownerUserId: string
  readonly deviceType: 'desktop_host' | 'desktop_client' | 'mobile' | 'tablet'
  readonly keyAlgorithm: 'ES256'
  readonly fingerprint: string
  readonly keyGeneration: number
  readonly label: string
  readonly platform: string
}

export interface ResolvedProductDevice {
  readonly device: AccountProductDevice
  readonly key: ProductDeviceKeyDescription
}

export interface AuthorizedHostDirectoryEntry {
  readonly hostId: string
  readonly spaceId: string
  readonly safeLabel: string
  readonly coarsePlatform: string
  readonly fingerprint: string
  readonly identityGeneration: number
  readonly publicKey: ProductDeviceKeyDescription['publicKey']
  readonly authorization: {
    readonly state: 'authorized'
    readonly authorizationId: string
    readonly scope: 'supervisor_read'
    readonly expiresAt: string
    readonly issuedAt: string
    readonly serial: string
    readonly generation: number
  }
  readonly supervisor: {
    readonly grant: SignedSupervisorGrant
    readonly transport: SignedSupervisorTransportDescriptor
  } | null
}

export interface SupervisorGrantPayload {
  readonly v: 1
  readonly aud: 'codetether-host-supervisor'
  readonly purpose: 'host_supervisor_grant'
  readonly authorizationId: string
  readonly hostId: string
  readonly hostFingerprint: string
  readonly hostIdentityGeneration: number
  readonly deviceId: string
  readonly deviceFingerprint: string
  readonly deviceKeyGeneration: number
  readonly userId: string
  readonly spaceId: string
  readonly scope: 'supervisor_read'
  readonly authorizationSerial: string
  readonly authorizationGeneration: number
  readonly issuedAt: number
  readonly expiresAt: number
}

export interface SignedSupervisorGrant {
  readonly payload: SupervisorGrantPayload
  readonly proof: string
}

export interface SupervisorTransportDescriptorPayload {
  readonly v: 1
  readonly aud: 'codetether-host-supervisor'
  readonly purpose: 'host_supervisor_transport'
  readonly authorizationId: string
  readonly grantDigest: string
  readonly hostId: string
  readonly hostFingerprint: string
  readonly hostIdentityGeneration: number
  readonly deviceId: string
  readonly deviceKeyGeneration: number
  readonly transportTlsFingerprint: string
  readonly controlPlaneOrigin: string
  readonly directEndpoints: readonly {
    readonly host: string
    readonly port: number
  }[]
  readonly relay: {
    readonly endpoint: string
    readonly relayId: string
    readonly relayFingerprint: string
    readonly rendezvousId: string
    readonly rendezvousCapability: string
    readonly hostTransportFingerprint: string
  } | null
  readonly iat: number
  readonly exp: number
  readonly protocolVersion: 1
}

export interface SignedSupervisorTransportDescriptor {
  readonly payload: SupervisorTransportDescriptorPayload
  readonly proof: string
}

export class ControlPlaneClientError extends Error {
  constructor(
    readonly code: string,
    readonly status: number | undefined,
  ) {
    super(code)
    this.name = 'ControlPlaneClientError'
  }
}

export async function resolveExistingProductDevice(options: {
  readonly accessToken: string
  readonly baseUrl: string
  readonly identity: ProductDeviceIdentityCapability
  readonly signal?: AbortSignal
}): Promise<ResolvedProductDevice> {
  if (!options.identity.available) {
    throw new ControlPlaneClientError(
      'product_device_key_unavailable',
      undefined,
    )
  }
  const response = await fetch(`${options.baseUrl}/v1/devices`, {
    headers: { authorization: `Bearer ${options.accessToken}` },
    signal: options.signal,
  })
  const body = await readJson(response)
  if (!response.ok) throw responseError(response, body)
  const devices = parseProductDevices(body)
  const keys = await options.identity.listKeys()
  const matches: ResolvedProductDevice[] = []
  for (const key of keys) {
    const fingerprint = await publicJwkFingerprint(key.publicKey)
    for (const device of devices) {
      if (
        device.fingerprint === fingerprint &&
        device.keyAlgorithm === key.keyAlgorithm &&
        device.keyGeneration === key.keyGeneration
      ) {
        matches.push({ device, key })
      }
    }
  }
  if (matches.length !== 1) {
    throw new ControlPlaneClientError(
      matches.length === 0
        ? 'product_device_not_available'
        : 'product_device_identity_ambiguous',
      undefined,
    )
  }
  return matches[0]!
}

export async function listAuthorizedHosts(options: {
  readonly accessToken: string
  readonly baseUrl: string
  readonly identity: ProductDeviceIdentityCapability
  readonly productDevice: ResolvedProductDevice
  readonly signal?: AbortSignal
}): Promise<readonly AuthorizedHostDirectoryEntry[]> {
  const resource = '/v1/hosts/directory'
  const proof = await createDeviceRequestProof({
    accessToken: options.accessToken,
    deviceId: options.productDevice.device.deviceId,
    keyGeneration: options.productDevice.device.keyGeneration,
    keyHandle: options.productDevice.key.keyHandle,
    identity: options.identity,
    method: 'GET',
    resource,
  })
  const response = await fetch(`${options.baseUrl}${resource}`, {
    headers: {
      authorization: `Bearer ${options.accessToken}`,
      [DEVICE_PROOF_HEADER]: proof,
    },
    signal: options.signal,
  })
  const body = await readJson(response)
  if (!response.ok) throw responseError(response, body)
  return parseHostDirectory(body)
}

export async function postAuthenticatedProductDeviceJson(options: {
  readonly accessToken: string
  readonly baseUrl: string
  readonly identity: ProductDeviceIdentityCapability
  readonly productDevice: ResolvedProductDevice
  readonly resource: string
  readonly value: unknown
  readonly signal?: AbortSignal
}): Promise<unknown> {
  const bodyBytes = canonicalJsonBytes(options.value)
  const proof = await createDeviceRequestProof({
    accessToken: options.accessToken,
    deviceId: options.productDevice.device.deviceId,
    keyGeneration: options.productDevice.device.keyGeneration,
    keyHandle: options.productDevice.key.keyHandle,
    identity: options.identity,
    method: 'POST',
    resource: options.resource,
    body: bodyBytes,
  })
  const response = await fetch(`${options.baseUrl}${options.resource}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${options.accessToken}`,
      'content-type': 'application/json',
      [DEVICE_PROOF_HEADER]: proof,
    },
    body: new TextDecoder().decode(bodyBytes),
    signal: options.signal,
  })
  const body = await readJson(response)
  if (!response.ok) throw responseError(response, body)
  return body
}

export async function createDeviceRequestProof(options: {
  readonly accessToken: string
  readonly deviceId: string
  readonly keyGeneration: number
  readonly keyHandle: string
  readonly identity: ProductDeviceIdentityCapability
  readonly method: string
  readonly resource: string
  readonly body?: Uint8Array
}): Promise<string> {
  const protectedHeader = base64Url(
    utf8(JSON.stringify({ alg: 'ES256', typ: 'codetether-device-proof+jws' })),
  )
  const nonce = new Uint8Array(32)
  crypto.getRandomValues(nonce)
  const payload = canonicalJsonBytes({
    v: 1,
    aud: 'codetether-control-plane',
    authTokenHash: await sha256Digest(utf8(options.accessToken)),
    deviceId: options.deviceId,
    keyGeneration: options.keyGeneration,
    method: options.method,
    resource: options.resource,
    bodySha256:
      options.body === undefined
        ? EMPTY_BODY_DIGEST
        : await sha256Digest(options.body),
    nonce: base64Url(nonce),
    iat: Math.floor(Date.now() / 1_000),
    protocolVersion: 1,
  })
  const encodedPayload = base64Url(payload)
  const signingInput = `${protectedHeader}.${encodedPayload}`
  const signed = await options.identity.sign(
    options.keyHandle,
    base64Url(utf8(signingInput)),
  )
  if (signed.keyAlgorithm !== 'ES256') {
    throw new ControlPlaneClientError(
      'product_device_algorithm_mismatch',
      undefined,
    )
  }
  return `${signingInput}.${signed.signatureBase64Url}`
}

export async function publicJwkFingerprint(
  publicKey: ProductDeviceKeyDescription['publicKey'],
): Promise<string> {
  const canonical = canonicalJsonBytes({
    crv: publicKey.crv,
    kty: publicKey.kty,
    x: publicKey.x,
    y: publicKey.y,
  })
  return await sha256Digest(canonical)
}

export function canonicalJsonBytes(value: unknown): Uint8Array {
  return utf8(canonicalJson(value))
}

export async function sha256Digest(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    Uint8Array.from(value).buffer,
  )
  return `sha256:${base64Url(new Uint8Array(digest))}`
}

export function base64Url(value: Uint8Array): string {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/gu, '')
}

export function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError('Unsafe JSON number')
    return String(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`
  }
  if (typeof value !== 'object') throw new TypeError('Unsupported JSON value')
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new ControlPlaneClientError(
      'control_plane_response_invalid',
      response.status,
    )
  }
}

function responseError(
  response: Response,
  body: unknown,
): ControlPlaneClientError {
  const code =
    isRecord(body) && typeof body.code === 'string'
      ? body.code
      : response.status === 401
        ? 'authentication_expired'
        : 'control_plane_unavailable'
  return new ControlPlaneClientError(code, response.status)
}

function parseProductDevices(value: unknown): readonly AccountProductDevice[] {
  if (!isRecord(value) || !Array.isArray(value.devices)) invalidResponse()
  return value.devices.map((candidate) => {
    if (!isRecord(candidate)) invalidResponse()
    if (
      !isId(candidate.deviceId, 'dev_') ||
      !isId(candidate.ownerUserId, 'usr_') ||
      !isPositiveInteger(candidate.keyGeneration) ||
      candidate.keyAlgorithm !== 'ES256' ||
      !isBoundedString(candidate.fingerprint, 128) ||
      !isBoundedString(candidate.label, 120) ||
      !isBoundedString(candidate.platform, 64) ||
      !['desktop_host', 'desktop_client', 'mobile', 'tablet'].includes(
        String(candidate.deviceType),
      )
    ) {
      invalidResponse()
    }
    return candidate as unknown as AccountProductDevice
  })
}

function parseHostDirectory(
  value: unknown,
): readonly AuthorizedHostDirectoryEntry[] {
  if (!isRecord(value) || !Array.isArray(value.hosts)) invalidResponse()
  return value.hosts.map((candidate) => {
    if (
      !isRecord(candidate) ||
      !isId(candidate.hostId, 'host_') ||
      !isId(candidate.spaceId, 'space_') ||
      !isBoundedString(candidate.safeLabel, 120) ||
      !isBoundedString(candidate.coarsePlatform, 64) ||
      !isBoundedString(candidate.fingerprint, 128) ||
      !isPositiveInteger(candidate.identityGeneration) ||
      !isPublicJwk(candidate.publicKey) ||
      !isRecord(candidate.authorization) ||
      candidate.authorization.state !== 'authorized' ||
      candidate.authorization.scope !== 'supervisor_read' ||
      !isId(candidate.authorization.authorizationId, 'hauth_') ||
      !isBoundedString(candidate.authorization.expiresAt, 64) ||
      !isBoundedString(candidate.authorization.issuedAt, 64) ||
      !/^(?:0|[1-9][0-9]{0,19})$/u.test(
        String(candidate.authorization.serial),
      ) ||
      !isPositiveInteger(candidate.authorization.generation) ||
      !isSupervisorDirectoryValue(candidate.supervisor)
    ) {
      invalidResponse()
    }
    return candidate as unknown as AuthorizedHostDirectoryEntry
  })
}

function isPublicJwk(
  value: unknown,
): value is ProductDeviceKeyDescription['publicKey'] {
  return (
    isRecord(value) &&
    value.kty === 'EC' &&
    value.crv === 'P-256' &&
    typeof value.x === 'string' &&
    /^[A-Za-z0-9_-]{43}$/u.test(value.x) &&
    typeof value.y === 'string' &&
    /^[A-Za-z0-9_-]{43}$/u.test(value.y)
  )
}

function isSupervisorDirectoryValue(value: unknown): boolean {
  if (value === null) return true
  if (
    !isRecord(value) ||
    !isRecord(value.grant) ||
    !isRecord(value.transport)
  ) {
    return false
  }
  return (
    isRecord(value.grant.payload) &&
    value.grant.payload.purpose === 'host_supervisor_grant' &&
    isBoundedString(value.grant.proof, 8_192) &&
    isRecord(value.transport.payload) &&
    value.transport.payload.purpose === 'host_supervisor_transport' &&
    Array.isArray(value.transport.payload.directEndpoints) &&
    isBoundedString(value.transport.proof, 8_192)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isId(value: unknown, prefix: string): value is string {
  return (
    typeof value === 'string' && value.startsWith(prefix) && value.length <= 160
  )
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= maximum
  )
}

function invalidResponse(): never {
  throw new ControlPlaneClientError('control_plane_response_invalid', undefined)
}

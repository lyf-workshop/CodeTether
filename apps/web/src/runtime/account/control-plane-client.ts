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
  readonly safeLabel: string
  readonly coarsePlatform: string
  readonly fingerprint: string
  readonly identityGeneration: number
  readonly authorization: {
    readonly state: 'authorized'
    readonly authorizationId: string
    readonly scope: 'supervisor_read'
    readonly expiresAt: string
  }
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

export async function createDeviceRequestProof(options: {
  readonly accessToken: string
  readonly deviceId: string
  readonly keyGeneration: number
  readonly keyHandle: string
  readonly identity: ProductDeviceIdentityCapability
  readonly method: string
  readonly resource: string
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
    bodySha256: EMPTY_BODY_DIGEST,
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

function canonicalJsonBytes(
  value: Readonly<Record<string, string | number>>,
): Uint8Array {
  const canonical: Record<string, string | number> = {}
  for (const key of Object.keys(value).sort()) canonical[key] = value[key]!
  return utf8(JSON.stringify(canonical))
}

async function sha256Digest(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    Uint8Array.from(value).buffer,
  )
  return `sha256:${base64Url(new Uint8Array(digest))}`
}

function base64Url(value: Uint8Array): string {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/gu, '')
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value)
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
      !isBoundedString(candidate.safeLabel, 120) ||
      !isBoundedString(candidate.coarsePlatform, 64) ||
      !isBoundedString(candidate.fingerprint, 128) ||
      !isPositiveInteger(candidate.identityGeneration) ||
      !isRecord(candidate.authorization) ||
      candidate.authorization.state !== 'authorized' ||
      candidate.authorization.scope !== 'supervisor_read' ||
      !isId(candidate.authorization.authorizationId, 'hauth_') ||
      !isBoundedString(candidate.authorization.expiresAt, 64)
    ) {
      invalidResponse()
    }
    return candidate as unknown as AuthorizedHostDirectoryEntry
  })
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

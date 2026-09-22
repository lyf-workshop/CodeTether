import { createHash, randomUUID } from 'node:crypto'

export interface DurableHostIdentity {
  readonly hostId: string
  readonly publicJwk: string
  readonly fingerprint: string
  readonly keyAlgorithm: 'ES256'
  readonly keyHandle: string
  readonly identityGeneration: number
  readonly safeLabel: string
  readonly platform: string
  readonly appVersion: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly lastRegisteredAt?: string
}

export interface HostIdentityKeyDescription {
  readonly keyHandle: string
  readonly publicKey: {
    readonly kty: 'EC'
    readonly crv: 'P-256'
    readonly x: string
    readonly y: string
  }
  readonly keyAlgorithm: 'ES256'
  readonly keyGeneration: number
  readonly privateKeyExportable: boolean
  readonly protection: string
}

const HOST_IDENTITY_PROTECTION = 'windows_cng_software_ksp_non_exportable'

/** Build the durable public Host record from the platform key description. */
export function durableHostIdentityFromKeyDescription(
  description: HostIdentityKeyDescription,
  options: {
    readonly safeLabel: string
    readonly appVersion: string
    readonly platform?: string
    readonly now?: string
  },
): DurableHostIdentity {
  if (
    description.keyAlgorithm !== 'ES256' ||
    description.keyGeneration !== 1 ||
    description.privateKeyExportable ||
    description.protection !== HOST_IDENTITY_PROTECTION
  ) {
    throw new Error('Host identity key description is not an admitted profile')
  }
  const publicJwk = JSON.stringify({
    crv: description.publicKey.crv,
    kty: description.publicKey.kty,
    x: description.publicKey.x,
    y: description.publicKey.y,
  })
  const fingerprint = `sha256:${createHash('sha256')
    .update(publicJwk, 'utf8')
    .digest('base64url')}`
  const now = options.now ?? new Date().toISOString()
  return validateDurableHostIdentity({
    hostId: `host_${randomUUID().replaceAll('-', '')}`,
    publicJwk,
    fingerprint,
    keyAlgorithm: 'ES256',
    keyHandle: description.keyHandle,
    identityGeneration: description.keyGeneration,
    safeLabel: options.safeLabel,
    platform: options.platform ?? process.platform,
    appVersion: options.appVersion,
    createdAt: now,
    updatedAt: now,
  })
}

export function hostIdentityPublicRecord(
  identity: DurableHostIdentity,
): DurableHostIdentity {
  return identity
}

export function validateDurableHostIdentity(
  value: DurableHostIdentity,
): DurableHostIdentity {
  if (!/^host_[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/.test(value.hostId))
    throw new Error('Invalid durable Host identity')
  if (!/^sha256:[A-Za-z0-9_-]{32,128}$/.test(value.fingerprint))
    throw new Error('Invalid Host fingerprint')
  if (
    value.keyAlgorithm !== 'ES256' ||
    value.publicJwk.length < 32 ||
    value.publicJwk.length > 8192
  )
    throw new Error('Invalid Host public key')
  if (
    value.keyHandle.length < 20 ||
    value.keyHandle.length > 160 ||
    value.identityGeneration < 1
  )
    throw new Error('Invalid Host key metadata')
  if (
    value.safeLabel.trim() !== value.safeLabel ||
    value.safeLabel.length < 1 ||
    value.safeLabel.length > 120
  )
    throw new Error('Invalid Host label')
  return value
}

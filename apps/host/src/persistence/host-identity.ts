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

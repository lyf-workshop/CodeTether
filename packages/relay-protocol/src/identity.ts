import {
  X509Certificate,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  timingSafeEqual,
  verify,
} from 'node:crypto'

import { z } from 'zod'

export const RelayPublicKeyFingerprintSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/u)
export type RelayPublicKeyFingerprint = z.infer<
  typeof RelayPublicKeyFingerprintSchema
>

export const RelayPublicKeySpkiSchema = z
  .string()
  .min(80)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/u)
export type RelayPublicKeySpki = z.infer<typeof RelayPublicKeySpkiSchema>

export const RelaySignatureSchema = z.string().regex(/^[A-Za-z0-9_-]{86}$/u)
export type RelaySignature = z.infer<typeof RelaySignatureSchema>

export const RelayApplicationIdentitySchema = z
  .object({
    privateKeyPem: z
      .string()
      .min(1)
      .max(8 * 1024),
    publicKeySpki: RelayPublicKeySpkiSchema,
    publicKeyFingerprint: RelayPublicKeyFingerprintSchema,
  })
  .strict()
export type RelayApplicationIdentity = z.infer<
  typeof RelayApplicationIdentitySchema
>

export function generateRelayApplicationIdentity(): RelayApplicationIdentity {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  return validateRelayApplicationIdentity({
    privateKeyPem: pair.privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }),
    publicKeySpki: pair.publicKey
      .export({ type: 'spki', format: 'der' })
      .toString('base64url'),
    publicKeyFingerprint: fingerprintRelayPublicKey(pair.publicKey),
  })
}

export function validateRelayApplicationIdentity(
  value: unknown,
): RelayApplicationIdentity {
  const parsed = RelayApplicationIdentitySchema.parse(value)
  const privateKey = createPrivateKey(parsed.privateKeyPem)
  const publicKey = importRelayPublicKey(parsed.publicKeySpki)
  assertP256Key(privateKey)
  assertP256Key(publicKey)
  const derived = createPublicKey(privateKey).export({
    type: 'spki',
    format: 'der',
  })
  const supplied = publicKey.export({ type: 'spki', format: 'der' })
  if (!safeEqual(derived, supplied)) {
    throw new Error('Relay application private and public keys do not match')
  }
  const fingerprint = fingerprintRelayPublicKey(publicKey)
  if (!safeTextEqual(fingerprint, parsed.publicKeyFingerprint)) {
    throw new Error('Relay application identity fingerprint is inconsistent')
  }
  return { ...parsed, publicKeyFingerprint: fingerprint }
}

export function relayPublicKeySpkiFromCertificate(
  certificatePem: string | Buffer,
): RelayPublicKeySpki {
  const certificate = new X509Certificate(certificatePem)
  assertP256Key(certificate.publicKey)
  return RelayPublicKeySpkiSchema.parse(
    certificate.publicKey
      .export({ type: 'spki', format: 'der' })
      .toString('base64url'),
  )
}

export function fingerprintRelayPublicKeySpki(
  spki: RelayPublicKeySpki | string,
): RelayPublicKeyFingerprint {
  return fingerprintRelayPublicKey(importRelayPublicKey(spki))
}

export function signRelayTranscript(
  privateKeyPem: string,
  transcript: Uint8Array,
): RelaySignature {
  const key = createPrivateKey(privateKeyPem)
  assertP256Key(key)
  const signature = sign('sha256', transcript, {
    key,
    dsaEncoding: 'ieee-p1363',
  })
  return RelaySignatureSchema.parse(signature.toString('base64url'))
}

export function verifyRelayTranscript(
  publicKeySpki: RelayPublicKeySpki | string,
  transcript: Uint8Array,
  signature: RelaySignature | string,
): boolean {
  try {
    const key = importRelayPublicKey(publicKeySpki)
    assertP256Key(key)
    return verify(
      'sha256',
      transcript,
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(RelaySignatureSchema.parse(signature), 'base64url'),
    )
  } catch {
    return false
  }
}

function importRelayPublicKey(spki: RelayPublicKeySpki | string) {
  return createPublicKey({
    key: Buffer.from(RelayPublicKeySpkiSchema.parse(spki), 'base64url'),
    format: 'der',
    type: 'spki',
  })
}

function fingerprintRelayPublicKey(
  key: ReturnType<typeof createPublicKey>,
): RelayPublicKeyFingerprint {
  assertP256Key(key)
  return RelayPublicKeyFingerprintSchema.parse(
    createHash('sha256')
      .update(key.export({ type: 'spki', format: 'der' }))
      .digest('base64url'),
  )
}

function assertP256Key(
  key: ReturnType<typeof createPrivateKey> | ReturnType<typeof createPublicKey>,
): void {
  if (
    key.asymmetricKeyType !== 'ec' ||
    key.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
  ) {
    throw new Error('Relay identities must use ECDSA P-256')
  }
}

function safeTextEqual(left: string, right: string): boolean {
  return safeEqual(Buffer.from(left, 'ascii'), Buffer.from(right, 'ascii'))
}

function safeEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && timingSafeEqual(left, right)
}

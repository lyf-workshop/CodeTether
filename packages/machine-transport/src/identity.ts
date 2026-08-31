import {
  X509Certificate,
  createHash,
  createPrivateKey,
  createPublicKey,
  timingSafeEqual,
} from 'node:crypto'

import { generate } from 'selfsigned'
import { z } from 'zod'

import {
  PublicKeyFingerprintSchema,
  type PublicKeyFingerprint,
} from './messages.js'

export const MachineTlsIdentitySchema = z
  .object({
    certificatePem: z.string().min(1).max(16_384),
    privateKeyPem: z.string().min(1).max(16_384),
    publicKeyFingerprint: PublicKeyFingerprintSchema,
  })
  .strict()
export type MachineTlsIdentity = z.infer<typeof MachineTlsIdentitySchema>

export async function generateMachineTlsIdentity(
  commonName: 'CodeTether Node' | 'CodeTether Controller',
  now = new Date(),
): Promise<MachineTlsIdentity> {
  const notBeforeDate = new Date(now.getTime() - 5 * 60_000)
  const notAfterDate = new Date(now)
  notAfterDate.setUTCFullYear(notAfterDate.getUTCFullYear() + 10)
  const generated = await generate(
    [{ name: 'commonName', value: commonName }],
    {
      keyType: 'ec',
      curve: 'P-256',
      algorithm: 'sha256',
      notBeforeDate,
      notAfterDate,
      extensions: [
        { name: 'basicConstraints', cA: false, critical: true },
        {
          name: 'keyUsage',
          digitalSignature: true,
          keyAgreement: true,
          critical: true,
        },
        {
          name: 'extKeyUsage',
          serverAuth: true,
          clientAuth: true,
          critical: true,
        },
      ],
    },
  )
  return validateMachineTlsIdentity({
    certificatePem: generated.cert,
    privateKeyPem: generated.private,
    publicKeyFingerprint: fingerprintCertificate(generated.cert),
  })
}

export function validateMachineTlsIdentity(value: unknown): MachineTlsIdentity {
  const parsed = MachineTlsIdentitySchema.parse(value)
  const certificate = new X509Certificate(parsed.certificatePem)
  const privateKey = createPrivateKey(parsed.privateKeyPem)
  const certificateKey = certificate.publicKey
  const derivedPublicKey = createPublicKey(privateKey)
  assertP256Key(certificateKey)
  assertP256Key(derivedPublicKey)
  const certificateSpki = certificateKey.export({ type: 'spki', format: 'der' })
  const derivedSpki = derivedPublicKey.export({ type: 'spki', format: 'der' })
  if (!safeEqual(certificateSpki, derivedSpki)) {
    throw new Error('Machine TLS certificate and private key do not match')
  }
  const fingerprint = fingerprintPublicKey(certificateKey)
  if (
    !safeEqual(
      Buffer.from(fingerprint),
      Buffer.from(parsed.publicKeyFingerprint),
    )
  ) {
    throw new Error('Machine TLS public identity fingerprint is inconsistent')
  }
  return { ...parsed, publicKeyFingerprint: fingerprint }
}

export function fingerprintCertificate(
  certificate: string | Buffer | X509Certificate,
): PublicKeyFingerprint {
  const value =
    certificate instanceof X509Certificate
      ? certificate
      : new X509Certificate(certificate)
  assertP256Key(value.publicKey)
  return fingerprintPublicKey(value.publicKey)
}

export function publicCertificateFromPeer(peer: { readonly raw?: Buffer }): {
  readonly certificate: X509Certificate
  readonly fingerprint: PublicKeyFingerprint
} {
  if (
    peer.raw === undefined ||
    peer.raw.length === 0 ||
    peer.raw.length > 16_384
  ) {
    throw new Error('Machine peer did not provide a bounded certificate')
  }
  const certificate = new X509Certificate(peer.raw)
  return { certificate, fingerprint: fingerprintCertificate(certificate) }
}

export function fingerprintsEqual(
  left: PublicKeyFingerprint,
  right: PublicKeyFingerprint,
): boolean {
  return safeEqual(Buffer.from(left, 'ascii'), Buffer.from(right, 'ascii'))
}

function fingerprintPublicKey(
  key: ReturnType<typeof createPublicKey>,
): PublicKeyFingerprint {
  const digest = createHash('sha256')
    .update(key.export({ type: 'spki', format: 'der' }))
    .digest('base64url')
  return PublicKeyFingerprintSchema.parse(digest)
}

function assertP256Key(key: ReturnType<typeof createPublicKey>): void {
  if (
    key.asymmetricKeyType !== 'ec' ||
    key.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
  ) {
    throw new Error('Machine TLS identity must use ECDSA P-256')
  }
}

function safeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right)
}

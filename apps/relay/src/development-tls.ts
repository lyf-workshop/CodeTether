import { X509Certificate, createHash, createPublicKey } from 'node:crypto'

import { generate } from 'selfsigned'

import type { RelayApplicationIdentity } from '@codetether/relay-protocol'

export interface RelayDevelopmentTlsIdentity {
  readonly certificatePem: string
  readonly privateKeyPem: string
  readonly publicKeySpkiFingerprint: string
}

export async function generateRelayPinnedTlsIdentity(
  applicationIdentity: RelayApplicationIdentity,
  now = new Date(),
): Promise<RelayDevelopmentTlsIdentity> {
  const notBeforeDate = new Date(now.getTime() - 5 * 60_000)
  const notAfterDate = new Date(now)
  notAfterDate.setUTCFullYear(notAfterDate.getUTCFullYear() + 1)
  const generated = await generate(
    [{ name: 'commonName', value: 'CodeTether Relay Development' }],
    {
      keyType: 'ec',
      curve: 'P-256',
      algorithm: 'sha256',
      keyPair: {
        privateKey: applicationIdentity.privateKeyPem,
        publicKey: createPublicKey({
          key: Buffer.from(applicationIdentity.publicKeySpki, 'base64url'),
          format: 'der',
          type: 'spki',
        })
          .export({ type: 'spki', format: 'pem' })
          .toString(),
      },
      notBeforeDate,
      notAfterDate,
      extensions: [
        { name: 'basicConstraints', cA: false, critical: true },
        { name: 'keyUsage', digitalSignature: true, critical: true },
        { name: 'extKeyUsage', serverAuth: true, critical: true },
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' },
            { type: 7, ip: '127.0.0.1' },
            { type: 7, ip: '::1' },
          ],
        },
      ],
    },
  )
  const certificate = new X509Certificate(generated.cert)
  const publicKeySpkiFingerprint = createHash('sha256')
    .update(certificate.publicKey.export({ type: 'spki', format: 'der' }))
    .digest('base64url')
  if (
    publicKeySpkiFingerprint !== applicationIdentity.publicKeyFingerprint ||
    generated.private.trim() !== applicationIdentity.privateKeyPem.trim()
  ) {
    throw new Error('Pinned TLS certificate does not match Relay identity')
  }
  return {
    certificatePem: generated.cert,
    privateKeyPem: generated.private,
    publicKeySpkiFingerprint,
  }
}

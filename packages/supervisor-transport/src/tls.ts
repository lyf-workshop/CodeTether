import {
  X509Certificate,
  constants,
  createHash,
  createPrivateKey,
  createPublicKey,
  timingSafeEqual,
} from 'node:crypto'
import { connect as connectTcp } from 'node:net'
import type { Duplex } from 'node:stream'
import {
  connect as connectTls,
  TLSSocket,
  type ConnectionOptions,
} from 'node:tls'

import { generate } from 'selfsigned'
import { z } from 'zod'

import {
  supervisorTlsExporterLabel,
  supervisorTransportAlpn,
  supervisorTransportLimits,
} from './constants.js'

const fingerprintSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u)

export const supervisorTlsIdentitySchema = z
  .object({
    certificatePem: z.string().min(1).max(16_384),
    privateKeyPem: z.string().min(1).max(16_384),
    publicKeyFingerprint: fingerprintSchema,
  })
  .strict()
export type SupervisorTlsIdentity = z.infer<typeof supervisorTlsIdentitySchema>

export interface SupervisorTlsConnection {
  readonly socket: TLSSocket
  readonly peerFingerprint: string
  readonly exporter: string
}

export async function generateSupervisorTlsIdentity(
  commonName: 'CodeTether Supervisor Host' | 'CodeTether Supervisor Device',
  now = new Date(),
): Promise<SupervisorTlsIdentity> {
  const notBeforeDate = new Date(now.getTime() - 5 * 60_000)
  const notAfterDate = new Date(now)
  notAfterDate.setUTCFullYear(notAfterDate.getUTCFullYear() + 1)
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
  return validateSupervisorTlsIdentity({
    certificatePem: generated.cert,
    privateKeyPem: generated.private,
    publicKeyFingerprint: fingerprintCertificate(generated.cert),
  })
}

export function validateSupervisorTlsIdentity(
  value: unknown,
): SupervisorTlsIdentity {
  const parsed = supervisorTlsIdentitySchema.parse(value)
  const certificate = new X509Certificate(parsed.certificatePem)
  const privateKey = createPrivateKey(parsed.privateKeyPem)
  assertP256(certificate.publicKey)
  assertP256(createPublicKey(privateKey))
  const certificateSpki = certificate.publicKey.export({
    type: 'spki',
    format: 'der',
  })
  const privateSpki = createPublicKey(privateKey).export({
    type: 'spki',
    format: 'der',
  })
  if (!safeEqual(certificateSpki, privateSpki)) {
    throw new Error('Supervisor TLS certificate and private key do not match')
  }
  const fingerprint = fingerprintCertificate(certificate)
  if (!safeTextEqual(fingerprint, parsed.publicKeyFingerprint)) {
    throw new Error('Supervisor TLS fingerprint is inconsistent')
  }
  return { ...parsed, publicKeyFingerprint: fingerprint }
}

export function supervisorTlsServerOptions(identity: SupervisorTlsIdentity) {
  const admitted = validateSupervisorTlsIdentity(identity)
  return {
    key: admitted.privateKeyPem,
    cert: admitted.certificatePem,
    requestCert: true,
    rejectUnauthorized: false,
    minVersion: 'TLSv1.3' as const,
    maxVersion: 'TLSv1.3' as const,
    ALPNProtocols: [supervisorTransportAlpn],
    secureOptions: constants.SSL_OP_NO_TICKET,
    handshakeTimeout: supervisorTransportLimits.handshakeTimeoutMs,
  }
}

export async function connectSupervisorTls(options: {
  readonly host: string
  readonly port: number
  readonly identity: SupervisorTlsIdentity
  readonly expectedPeerFingerprint: string
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}): Promise<SupervisorTlsConnection> {
  const stream = connectTcp({ host: options.host, port: options.port })
  return await connectSupervisorTlsOverStream({ ...options, stream })
}

export async function connectSupervisorTlsOverStream(options: {
  readonly stream: Duplex
  readonly identity: SupervisorTlsIdentity
  readonly expectedPeerFingerprint: string
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}): Promise<SupervisorTlsConnection> {
  const expected = fingerprintSchema.parse(options.expectedPeerFingerprint)
  const identity = validateSupervisorTlsIdentity(options.identity)
  const connectionOptions: ConnectionOptions = {
    socket: options.stream,
    key: identity.privateKeyPem,
    cert: identity.certificatePem,
    rejectUnauthorized: false,
    minVersion: 'TLSv1.3',
    maxVersion: 'TLSv1.3',
    ALPNProtocols: [supervisorTransportAlpn],
    secureOptions: constants.SSL_OP_NO_TICKET,
  }
  let socket: TLSSocket
  try {
    socket = connectTls(connectionOptions)
  } catch (error) {
    options.stream.destroy()
    throw new Error('Supervisor TLS connection failed', { cause: error })
  }
  const connection = await verifyHandshake(
    socket,
    'secureConnect',
    options.timeoutMs,
    options.signal,
  )
  if (!safeTextEqual(connection.peerFingerprint, expected)) {
    socket.destroy()
    throw new Error('Supervisor Host transport identity mismatch')
  }
  return connection
}

export async function acceptSupervisorTlsOverStream(options: {
  readonly stream: Duplex
  readonly identity: SupervisorTlsIdentity
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}): Promise<SupervisorTlsConnection> {
  let socket: TLSSocket
  try {
    socket = new TLSSocket(options.stream, {
      ...supervisorTlsServerOptions(options.identity),
      isServer: true,
    })
  } catch (error) {
    options.stream.destroy()
    throw new Error('Supervisor TLS connection failed', { cause: error })
  }
  return await verifyHandshake(
    socket,
    'secure',
    options.timeoutMs,
    options.signal,
  )
}

export function supervisorTlsExporter(socket: TLSSocket): string {
  if (
    socket.destroyed ||
    socket.encrypted !== true ||
    socket.getProtocol() !== 'TLSv1.3' ||
    socket.alpnProtocol !== supervisorTransportAlpn ||
    socket.isSessionReused()
  ) {
    throw new Error('Supervisor TLS connection is not fresh and bound')
  }
  return socket
    .exportKeyingMaterial(32, supervisorTlsExporterLabel, Buffer.alloc(0))
    .toString('base64url')
}

export function fingerprintCertificate(
  value: string | Buffer | X509Certificate,
): string {
  const certificate =
    value instanceof X509Certificate ? value : new X509Certificate(value)
  assertP256(certificate.publicKey)
  return createHash('sha256')
    .update(certificate.publicKey.export({ type: 'spki', format: 'der' }))
    .digest('base64url')
}

async function verifyHandshake(
  socket: TLSSocket,
  event: 'secure' | 'secureConnect',
  timeoutMs: number = supervisorTransportLimits.handshakeTimeoutMs,
  signal?: AbortSignal,
): Promise<SupervisorTlsConnection> {
  try {
    await waitForEvent(socket, event, timeoutMs, signal)
    if (
      socket.getProtocol() !== 'TLSv1.3' ||
      socket.alpnProtocol !== supervisorTransportAlpn ||
      socket.isSessionReused()
    ) {
      throw new Error('Supervisor TLS protocol is incompatible')
    }
    const peer = socket.getPeerCertificate(true)
    if (
      !peer.raw ||
      peer.raw.byteLength === 0 ||
      peer.raw.byteLength > 16_384
    ) {
      throw new Error('Supervisor TLS peer certificate is unavailable')
    }
    const peerFingerprint = fingerprintCertificate(peer.raw)
    return {
      socket,
      peerFingerprint,
      exporter: supervisorTlsExporter(socket),
    }
  } catch (error) {
    socket.destroy()
    throw new Error('Supervisor TLS connection failed', { cause: error })
  }
}

function waitForEvent(
  socket: TLSSocket,
  event: 'secure' | 'secureConnect',
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      socket.off(event, onSecure)
      socket.off('error', onError)
      socket.off('close', onClose)
      callback()
    }
    const onSecure = () => settle(resolve)
    const onError = (error: Error) => settle(() => reject(error))
    const onClose = () =>
      settle(() => reject(new Error('Supervisor TLS closed during handshake')))
    const onAbort = () =>
      settle(() => reject(new Error('Supervisor TLS handshake cancelled')))
    const timer = setTimeout(
      () =>
        settle(() => reject(new Error('Supervisor TLS handshake timed out'))),
      timeoutMs,
    )
    socket.once(event, onSecure)
    socket.once('error', onError)
    socket.once('close', onClose)
    if (signal?.aborted === true) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function assertP256(
  key: ReturnType<typeof createPublicKey> | X509Certificate['publicKey'],
): void {
  if (
    key.asymmetricKeyType !== 'ec' ||
    key.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
  ) {
    throw new Error('Supervisor TLS identity must use ECDSA P-256')
  }
}

function safeTextEqual(left: string, right: string): boolean {
  return safeEqual(Buffer.from(left, 'ascii'), Buffer.from(right, 'ascii'))
}

function safeEqual(left: Uint8Array, right: Uint8Array): boolean {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  )
}

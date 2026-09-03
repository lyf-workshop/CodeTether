import { X509Certificate, createHash, timingSafeEqual } from 'node:crypto'
import { connect, type TLSSocket } from 'node:tls'

import {
  RelayPublicKeyFingerprintSchema,
  relayProtocolAlpn,
  relayProtocolLimits,
} from '@codetether/relay-protocol'
import { z } from 'zod'

import { RelayClientError, relayConnectionError } from './errors.js'

const RelayEndpointHostSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .refine(
    (value) =>
      !/[\s\0/@\\]/u.test(value) &&
      !value.includes('://') &&
      value !== '.' &&
      value !== '..',
    'Relay host is invalid',
  )

const RelayTlsServerNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .refine(
    (value) => !/[\s\0/@\\:[\]]/u.test(value) && !value.includes('://'),
    'Relay TLS server name is invalid',
  )

export const RelayClientEndpointSchema = z
  .object({
    host: RelayEndpointHostSchema,
    port: z.number().int().min(1).max(65_535),
  })
  .strict()
export type RelayClientEndpoint = z.infer<typeof RelayClientEndpointSchema>

export const RelayClientTlsPolicySchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('public_ca'),
      serverName: RelayTlsServerNameSchema,
    })
    .strict(),
  z
    .object({
      mode: z.literal('pinned_certificate'),
      certificatePublicKeyFingerprint: RelayPublicKeyFingerprintSchema,
      serverName: RelayTlsServerNameSchema.optional(),
    })
    .strict(),
])
export type RelayClientTlsPolicy = z.infer<typeof RelayClientTlsPolicySchema>

export interface ConnectRelayTlsOptions {
  readonly endpoint: RelayClientEndpoint
  readonly tls: RelayClientTlsPolicy
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

export async function connectRelayTls(
  options: ConnectRelayTlsOptions,
): Promise<TLSSocket> {
  const endpoint = RelayClientEndpointSchema.parse(options.endpoint)
  const policy = RelayClientTlsPolicySchema.parse(options.tls)
  if (options.signal?.aborted === true) {
    throw relayConnectionError(new Error('Relay connection was cancelled'))
  }
  const socket = connect({
    host: endpoint.host,
    port: endpoint.port,
    ALPNProtocols: [relayProtocolAlpn],
    minVersion: 'TLSv1.3',
    maxVersion: 'TLSv1.3',
    rejectUnauthorized: policy.mode === 'public_ca',
    ...(policy.serverName === undefined
      ? {}
      : { servername: policy.serverName }),
  })
  socket.setNoDelay(true)
  socket.setKeepAlive(true, relayProtocolLimits.heartbeatIntervalMs)
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const settle = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
        socket.off('secureConnect', onSecure)
        socket.off('error', onError)
        if (error === undefined) resolve()
        else reject(error)
      }
      const onSecure = () => settle()
      const onError = (error: Error) => settle(relayConnectionError(error))
      const onAbort = () =>
        settle(relayConnectionError(new Error('Relay connection cancelled')))
      const timer = setTimeout(
        () => settle(relayConnectionError(new Error('Relay TLS timed out'))),
        options.timeoutMs ?? relayProtocolLimits.handshakeTimeoutMs,
      )
      socket.once('secureConnect', onSecure)
      socket.once('error', onError)
      options.signal?.addEventListener('abort', onAbort, { once: true })
    })
    if (socket.alpnProtocol !== relayProtocolAlpn) {
      throw new RelayClientError(
        'relay_protocol_incompatible',
        'Internet Relay protocol is incompatible',
      )
    }
    if (policy.mode === 'pinned_certificate') {
      assertPinnedCertificate(socket, policy.certificatePublicKeyFingerprint)
    }
    return socket
  } catch (error) {
    socket.destroy()
    throw error instanceof RelayClientError
      ? error
      : relayConnectionError(error)
  }
}

function assertPinnedCertificate(
  socket: TLSSocket,
  expectedFingerprint: string,
): void {
  const peer = socket.getPeerCertificate(true)
  if (
    peer.raw === undefined ||
    peer.raw.length === 0 ||
    peer.raw.length > 64_000
  ) {
    throw new RelayClientError(
      'relay_tls_identity_mismatch',
      'Internet Relay TLS identity did not match its pin',
    )
  }
  const certificate = new X509Certificate(peer.raw)
  const fingerprint = createHash('sha256')
    .update(
      certificate.publicKey.export({
        type: 'spki',
        format: 'der',
      }),
    )
    .digest('base64url')
  const expected = RelayPublicKeyFingerprintSchema.parse(expectedFingerprint)
  const left = Buffer.from(fingerprint, 'ascii')
  const right = Buffer.from(expected, 'ascii')
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new RelayClientError(
      'relay_tls_identity_mismatch',
      'Internet Relay TLS identity did not match its pin',
    )
  }
}

import { constants, randomBytes } from 'node:crypto'
import { connect as connectTcp } from 'node:net'
import type { Duplex } from 'node:stream'
import {
  connect as connectTls,
  TLSSocket,
  type ConnectionOptions,
} from 'node:tls'

import {
  machineTransportAlpn,
  machineTransportExporterLabel,
  machineTransportLimits,
} from './constants.js'
import { MachineTransportError } from './errors.js'
import {
  fingerprintsEqual,
  publicCertificateFromPeer,
  type MachineTlsIdentity,
} from './identity.js'
import type { PublicKeyFingerprint } from './messages.js'

export function newMachineNonce(): string {
  return randomBytes(32).toString('base64url')
}

export function machineTlsServerOptions(identity: MachineTlsIdentity) {
  return {
    key: identity.privateKeyPem,
    cert: identity.certificatePem,
    requestCert: true,
    rejectUnauthorized: false,
    minVersion: 'TLSv1.3' as const,
    maxVersion: 'TLSv1.3' as const,
    ALPNProtocols: [machineTransportAlpn],
    secureOptions: constants.SSL_OP_NO_TICKET,
  }
}

export interface MachineTlsConnection {
  readonly socket: TLSSocket
  readonly peerFingerprint: PublicKeyFingerprint
}

export interface MachineTlsStreamOptions {
  /** An already-established byte stream owned by the caller. */
  readonly stream: Duplex
  readonly identity: MachineTlsIdentity
  readonly expectedPeerFingerprint?: PublicKeyFingerprint
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

export async function connectMachineTls(options: {
  readonly host: string
  readonly port: number
  readonly identity: MachineTlsIdentity
  readonly expectedPeerFingerprint?: PublicKeyFingerprint
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}): Promise<MachineTlsConnection> {
  const stream = connectTcp({ host: options.host, port: options.port })
  return await connectMachineTlsOverStream({
    stream,
    identity: options.identity,
    expectedPeerFingerprint: options.expectedPeerFingerprint,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  })
}

/**
 * Establishes the client side of the Machine TLS channel over an existing
 * bounded byte stream. The stream does not become usable by Machine framing
 * until the remote identity, TLS version, and ALPN have all been verified.
 */
export async function connectMachineTlsOverStream(
  options: MachineTlsStreamOptions,
): Promise<MachineTlsConnection> {
  const connectionOptions: ConnectionOptions = {
    socket: options.stream,
    key: options.identity.privateKeyPem,
    cert: options.identity.certificatePem,
    rejectUnauthorized: false,
    minVersion: 'TLSv1.3',
    maxVersion: 'TLSv1.3',
    ALPNProtocols: [machineTransportAlpn],
    secureOptions: constants.SSL_OP_NO_TICKET,
  }
  let socket: TLSSocket
  try {
    socket = connectTls(connectionOptions)
  } catch (error) {
    options.stream.destroy()
    throw connectionFailure(error)
  }
  return await verifyMachineTlsConnection(socket, 'secureConnect', options)
}

/**
 * Establishes the Node/server side of the Machine TLS channel over an
 * existing bounded byte stream. Client certificates remain application-
 * authenticated by their pinned SPKI fingerprint rather than by a public CA.
 */
export async function acceptMachineTlsOverStream(
  options: MachineTlsStreamOptions,
): Promise<MachineTlsConnection> {
  let socket: TLSSocket
  try {
    socket = new TLSSocket(options.stream, {
      ...machineTlsServerOptions(options.identity),
      isServer: true,
    })
  } catch (error) {
    options.stream.destroy()
    throw connectionFailure(error)
  }
  return await verifyMachineTlsConnection(socket, 'secure', options)
}

async function verifyMachineTlsConnection(
  socket: TLSSocket,
  secureEvent: 'secure' | 'secureConnect',
  options: Omit<MachineTlsStreamOptions, 'stream'>,
): Promise<MachineTlsConnection> {
  const timeoutMs =
    options.timeoutMs ?? machineTransportLimits.handshakeTimeoutMs
  try {
    await waitForSecureHandshake(socket, secureEvent, timeoutMs, options.signal)
    if (socket.getProtocol() !== 'TLSv1.3') {
      throw new MachineTransportError(
        'protocol_incompatible',
        'Machine TLS version is incompatible',
      )
    }
    if (socket.alpnProtocol !== machineTransportAlpn) {
      throw new MachineTransportError(
        'protocol_incompatible',
        'Machine TLS protocol is incompatible',
      )
    }
    const peer = publicCertificateFromPeer(socket.getPeerCertificate(true))
    if (
      options.expectedPeerFingerprint !== undefined &&
      !fingerprintsEqual(peer.fingerprint, options.expectedPeerFingerprint)
    ) {
      throw new MachineTransportError(
        'identity_mismatch',
        'Machine cryptographic identity changed',
      )
    }
    return { socket, peerFingerprint: peer.fingerprint }
  } catch (error) {
    socket.destroy()
    throw connectionFailure(error)
  }
}

function connectionFailure(error: unknown): MachineTransportError {
  if (error instanceof MachineTransportError) return error
  return new MachineTransportError(
    'connection_failed',
    'Machine TLS connection failed',
    {
      cause: error,
    },
  )
}

export function peerFingerprint(socket: TLSSocket): PublicKeyFingerprint {
  return publicCertificateFromPeer(socket.getPeerCertificate(true)).fingerprint
}

export function exportMachineTlsBinding(socket: TLSSocket): string {
  if (!socket.authorized && socket.getCipher().standardName === undefined) {
    throw new MachineTransportError(
      'authentication_failed',
      'Machine TLS channel is invalid',
    )
  }
  return socket
    .exportKeyingMaterial(32, machineTransportExporterLabel, Buffer.alloc(0))
    .toString('base64url')
}

function waitForSecureHandshake(
  socket: TLSSocket,
  secureEvent: 'secure' | 'secureConnect',
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
      socket.off(secureEvent, onSecure)
      socket.off('error', onError)
      socket.off('close', onClose)
      callback()
    }
    const onSecure = () => settle(resolve)
    const onError = (error: Error) => settle(() => reject(error))
    const onClose = () =>
      settle(() =>
        reject(
          new MachineTransportError(
            'connection_failed',
            'Machine TLS connection closed during handshake',
          ),
        ),
      )
    const onAbort = () =>
      settle(() =>
        reject(
          new MachineTransportError(
            'connection_failed',
            'Machine TLS connection cancelled',
          ),
        ),
      )
    const timer = setTimeout(
      () =>
        settle(() =>
          reject(
            new MachineTransportError(
              'timeout',
              'Machine TLS handshake timed out',
            ),
          ),
        ),
      timeoutMs,
    )
    socket.once(secureEvent, onSecure)
    socket.once('error', onError)
    socket.once('close', onClose)
    if (signal?.aborted === true) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
  })
}

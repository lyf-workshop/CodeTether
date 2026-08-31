import { constants, randomBytes } from 'node:crypto'
import { connect, type ConnectionOptions, type TLSSocket } from 'node:tls'

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

export async function connectMachineTls(options: {
  readonly host: string
  readonly port: number
  readonly identity: MachineTlsIdentity
  readonly expectedPeerFingerprint?: PublicKeyFingerprint
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}): Promise<{
  readonly socket: TLSSocket
  readonly peerFingerprint: PublicKeyFingerprint
}> {
  const connectionOptions: ConnectionOptions = {
    host: options.host,
    port: options.port,
    key: options.identity.privateKeyPem,
    cert: options.identity.certificatePem,
    rejectUnauthorized: false,
    minVersion: 'TLSv1.3',
    maxVersion: 'TLSv1.3',
    ALPNProtocols: [machineTransportAlpn],
    secureOptions: constants.SSL_OP_NO_TICKET,
  }
  const socket = connect(connectionOptions)
  const timeoutMs =
    options.timeoutMs ?? machineTransportLimits.handshakeTimeoutMs
  try {
    await waitForSecureConnect(socket, timeoutMs, options.signal)
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
    if (error instanceof MachineTransportError) throw error
    throw new MachineTransportError(
      'connection_failed',
      'Machine TLS connection failed',
      {
        cause: error,
      },
    )
  }
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

function waitForSecureConnect(
  socket: TLSSocket,
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
      socket.off('secureConnect', onSecure)
      socket.off('error', onError)
      callback()
    }
    const onSecure = () => settle(resolve)
    const onError = (error: Error) => settle(() => reject(error))
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
    socket.once('secureConnect', onSecure)
    socket.once('error', onError)
    if (signal?.aborted === true) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
  })
}

import { EventEmitter } from 'node:events'
import { createServer, type Server, type TLSSocket } from 'node:tls'

import {
  FramedMachineConnection,
  MachineErrorMessageSchema,
  MachineHelloMessageSchema,
  MachinePingMessageSchema,
  MachineTransportError,
  PairingCancelMessageSchema,
  PairingConfirmMessageSchema,
  PairingOpenMessageSchema,
  PairingLoginFinishMessageSchema,
  PairingLoginStartMessageSchema,
  TrustRevokeMessageSchema,
  exportMachineTlsBinding,
  machineProtocolVersion,
  machineTlsServerOptions,
  machineTransportAlpn,
  machineTransportLimits,
  newMachineNonce,
  pairingConfirmationTag,
  pairingVerificationCode,
  peerFingerprint,
  verifyPairingConfirmationTag,
  type MachineWireErrorCode,
  type PairingTranscript,
  type PublicKeyFingerprint,
} from '@codetether/machine-transport'
import { z } from 'zod'

import { PairingMode, type PairingModeView } from './pairing-mode.js'
import { NodeStateStore, type TrustedController } from './state-store.js'

const AuthenticatedRequestSchema = z.discriminatedUnion('type', [
  MachinePingMessageSchema,
  TrustRevokeMessageSchema,
])
const PairingDecisionSchema = z.discriminatedUnion('type', [
  PairingConfirmMessageSchema,
  PairingCancelMessageSchema,
])

export interface CodeTetherNodeOptions {
  readonly state: NodeStateStore
  readonly bindAddress: string
  readonly port: number
  readonly authenticatedIdleTimeoutMs?: number
}

export interface ListeningNodeAddress {
  readonly address: string
  readonly port: number
}

export class CodeTetherNodeService extends EventEmitter {
  readonly state: NodeStateStore
  readonly pairing: PairingMode
  readonly #bindAddress: string
  readonly #requestedPort: number
  readonly #authenticatedIdleTimeoutMs: number
  readonly #connections = new Set<TLSSocket>()
  readonly #connectionsByAddress = new Map<string, number>()
  readonly #authenticatedConnections = new Map<string, Set<TLSSocket>>()
  #server: Server | undefined
  #closing = false

  constructor(options: CodeTetherNodeOptions) {
    super()
    this.state = options.state
    this.#bindAddress = options.bindAddress
    this.#requestedPort = options.port
    this.#authenticatedIdleTimeoutMs =
      options.authenticatedIdleTimeoutMs ??
      machineTransportLimits.heartbeatIntervalMs +
        2 * machineTransportLimits.heartbeatTimeoutMs
    if (
      !Number.isSafeInteger(this.#authenticatedIdleTimeoutMs) ||
      this.#authenticatedIdleTimeoutMs <= 0
    ) {
      throw new TypeError(
        'Authenticated idle timeout must be a positive integer',
      )
    }
    this.pairing = new PairingMode(
      options.state.machine,
      options.state.identity.publicKeyFingerprint,
    )
  }

  async listen(): Promise<ListeningNodeAddress> {
    if (this.#server !== undefined)
      throw new Error('CodeTether Node is already listening')
    const server = createServer(
      machineTlsServerOptions(this.state.identity),
      (socket) => this.#accept(socket),
    )
    this.#server = server
    server.maxConnections = machineTransportLimits.maximumConnections
    server.on('tlsClientError', () => undefined)
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        server.off('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen({
        host: this.#bindAddress,
        port: this.#requestedPort,
        backlog: machineTransportLimits.maximumConnections,
      })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('CodeTether Node did not receive a network address')
    }
    return { address: address.address, port: address.port }
  }

  async enablePairing(): Promise<PairingModeView> {
    if (this.state.trustedControllerCount !== 0) {
      throw new MachineTransportError(
        'pairing_disabled',
        'CodeTether Node is already paired; revoke trust before pairing again',
      )
    }
    return await this.pairing.enable()
  }

  cancelPairing(): void {
    this.pairing.cancel()
  }

  async close(): Promise<void> {
    if (this.#closing) return
    this.#closing = true
    this.pairing.cancel()
    for (const socket of this.#connections) socket.destroy()
    const server = this.#server
    this.#server = undefined
    if (server !== undefined) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        )
      }).catch((error: unknown) => {
        if (!(
          error instanceof Error &&
          'code' in error &&
          error.code === 'ERR_SERVER_NOT_RUNNING'
        )) {
          throw error
        }
      })
    }
    await this.state.close()
  }

  #accept(socket: TLSSocket): void {
    if (this.#closing || socket.alpnProtocol !== machineTransportAlpn) {
      socket.destroy()
      return
    }
    const remoteAddress = normalizedRemoteAddress(socket.remoteAddress)
    const addressCount = this.#connectionsByAddress.get(remoteAddress) ?? 0
    if (
      this.#connections.size >= machineTransportLimits.maximumConnections ||
      addressCount >= machineTransportLimits.maximumConnectionsPerAddress
    ) {
      const connection = new FramedMachineConnection(socket)
      void connection
        .send(machineError('busy'))
        .then(() => connection.end())
        .catch(() => connection.destroy())
      return
    }
    this.#connections.add(socket)
    this.#connectionsByAddress.set(remoteAddress, addressCount + 1)
    socket.once('close', () => {
      this.#connections.delete(socket)
      const remaining = (this.#connectionsByAddress.get(remoteAddress) ?? 1) - 1
      if (remaining <= 0) this.#connectionsByAddress.delete(remoteAddress)
      else this.#connectionsByAddress.set(remoteAddress, remaining)
    })
    void this.#route(socket).catch(() => socket.destroy())
  }

  async #route(socket: TLSSocket): Promise<void> {
    const connection = new FramedMachineConnection(socket)
    let fingerprint: PublicKeyFingerprint
    try {
      fingerprint = peerFingerprint(socket)
    } catch {
      socket.destroy()
      return
    }
    const trusted = this.state.controllerByFingerprint(fingerprint)
    if (trusted !== undefined) {
      await this.#serveTrusted(connection, socket, trusted)
      return
    }
    const opening = await receiveStrict(
      connection,
      z.union([PairingOpenMessageSchema, MachineHelloMessageSchema]),
    )
    if (opening.type === 'machine.hello') {
      await connection.send(machineError('authentication_failed'))
      connection.end()
      return
    }
    if (opening.controllerFingerprint !== fingerprint) {
      await connection.send(machineError('identity_mismatch'))
      connection.end()
      return
    }
    const pairing = this.pairing.claim()
    if (pairing === undefined) {
      await connection.send(machineError(this.pairing.rejectionCode))
      connection.end()
      return
    }
    try {
      await this.#servePairing(connection, socket, fingerprint, pairing)
    } finally {
      this.pairing.release()
    }
  }

  async #servePairing(
    connection: FramedMachineConnection,
    socket: TLSSocket,
    controllerFingerprint: PublicKeyFingerprint,
    pairing: PairingModeView,
  ): Promise<void> {
    let sessionKey: Buffer | undefined
    try {
      const nodeNonce = newMachineNonce()
      await connection.send({
        type: 'pair.offer',
        protocolVersion: machineProtocolVersion,
        attemptId: pairing.authority.attemptId,
        expiresAt: pairing.authority.expiresAt.toISOString(),
        machine: this.state.machine,
        nodeFingerprint: this.state.identity.publicKeyFingerprint,
        nodeNonce,
      })
      const start = await receiveStrict(
        connection,
        PairingLoginStartMessageSchema,
      )
      if (
        start.attemptId !== pairing.authority.attemptId ||
        start.controllerFingerprint !== controllerFingerprint
      ) {
        throw new MachineTransportError(
          'identity_mismatch',
          'Pairing controller identity did not match its TLS identity',
        )
      }
      const login = pairing.authority.startLogin(start.request)
      await connection.send({
        type: 'pair.login.response',
        protocolVersion: machineProtocolVersion,
        attemptId: pairing.authority.attemptId,
        response: login.response,
      })
      const finish = await receiveStrict(
        connection,
        PairingLoginFinishMessageSchema,
      )
      if (finish.attemptId !== pairing.authority.attemptId) {
        throw new MachineTransportError(
          'identity_mismatch',
          'Pairing attempt identity changed',
        )
      }
      sessionKey = login.finish(finish.request)
      const transcript: PairingTranscript = {
        protocolVersion: machineProtocolVersion,
        attemptId: pairing.authority.attemptId,
        machine: this.state.machine,
        controllerId: start.controllerId,
        nodeFingerprint: this.state.identity.publicKeyFingerprint,
        controllerFingerprint,
        nodeNonce,
        controllerNonce: start.controllerNonce,
        tlsExporter: exportMachineTlsBinding(socket),
      }
      this.emit('pairingVerification', {
        machineId: this.state.machine.machineId,
        verificationCode: pairingVerificationCode(sessionKey, transcript),
      })
      const decision = await receiveStrict(connection, PairingDecisionSchema, {
        timeoutMs: machineTransportLimits.pairingConfirmationTimeoutMs,
      })
      if (decision.attemptId !== pairing.authority.attemptId) {
        throw new MachineTransportError(
          'identity_mismatch',
          'Pairing attempt identity changed',
        )
      }
      if (decision.type === 'pair.cancel') {
        verifyPairingConfirmationTag(
          sessionKey,
          'controller-cancel',
          transcript,
          decision.tag,
        )
        this.pairing.cancel()
        await connection.send({
          type: 'pair.cancelled',
          protocolVersion: machineProtocolVersion,
          attemptId: pairing.authority.attemptId,
          tag: pairingConfirmationTag(sessionKey, 'node-cancelled', transcript),
        })
        connection.end()
        return
      }
      verifyPairingConfirmationTag(
        sessionKey,
        'controller-confirm',
        transcript,
        decision.tag,
      )
      // Distributed commit ordering: durable Node trust precedes the signed ack.
      await this.state.trustController({
        controllerId: start.controllerId,
        publicKeyFingerprint: controllerFingerprint,
        pairedAt: new Date().toISOString(),
      })
      this.pairing.consume()
      await connection.send({
        type: 'pair.ack',
        protocolVersion: machineProtocolVersion,
        attemptId: pairing.authority.attemptId,
        tag: pairingConfirmationTag(sessionKey, 'node-ack', transcript),
      })
      this.emit('paired', { machineId: this.state.machine.machineId })
      connection.end()
    } catch (error) {
      await sendSafeError(connection, error)
      connection.destroy()
    } finally {
      sessionKey?.fill(0)
    }
  }

  async #serveTrusted(
    connection: FramedMachineConnection,
    socket: TLSSocket,
    trusted: TrustedController,
  ): Promise<void> {
    let tracked = false
    try {
      const hello = await receiveStrict(connection, MachineHelloMessageSchema)
      if (
        hello.controllerId !== trusted.controllerId ||
        hello.expectedMachineId !== this.state.machine.machineId
      ) {
        throw new MachineTransportError(
          'identity_mismatch',
          'Authenticated Machine identity did not match durable trust',
        )
      }
      await connection.send({
        type: 'machine.status',
        protocolVersion: machineProtocolVersion,
        machine: this.state.machine,
        nonce: hello.nonce,
        observedAt: new Date().toISOString(),
      })
      this.#trackAuthenticatedConnection(trusted.controllerId, socket)
      tracked = true
      while (!connection.closed && !this.#closing) {
        const request = await receiveStrict(
          connection,
          AuthenticatedRequestSchema,
          {
            timeoutMs: this.#authenticatedIdleTimeoutMs,
          },
        )
        if (request.type === 'machine.ping') {
          await connection.send({
            type: 'machine.pong',
            protocolVersion: machineProtocolVersion,
            nonce: request.nonce,
          })
          continue
        }
        if (request.controllerId !== trusted.controllerId) {
          throw new MachineTransportError(
            'identity_mismatch',
            'Trust identity changed',
          )
        }
        await this.state.revokeController(trusted.controllerId)
        this.#closeAuthenticatedConnections(trusted.controllerId, socket)
        await connection.send({
          type: 'trust.revoked',
          protocolVersion: machineProtocolVersion,
          controllerId: trusted.controllerId,
          nonce: request.nonce,
        })
        connection.end()
        this.emit('unpaired', { machineId: this.state.machine.machineId })
        return
      }
    } catch (error) {
      if (!connection.closed) await sendSafeError(connection, error)
      connection.destroy()
    } finally {
      if (tracked) {
        this.#untrackAuthenticatedConnection(trusted.controllerId, socket)
      }
    }
  }

  #trackAuthenticatedConnection(controllerId: string, socket: TLSSocket) {
    const current = this.#authenticatedConnections.get(controllerId)
    if (current === undefined) {
      this.#authenticatedConnections.set(controllerId, new Set([socket]))
    } else {
      current.add(socket)
    }
  }

  #untrackAuthenticatedConnection(controllerId: string, socket: TLSSocket) {
    const current = this.#authenticatedConnections.get(controllerId)
    if (current === undefined) return
    current.delete(socket)
    if (current.size === 0) this.#authenticatedConnections.delete(controllerId)
  }

  #closeAuthenticatedConnections(
    controllerId: string,
    except: TLSSocket,
  ): void {
    const current = this.#authenticatedConnections.get(controllerId)
    if (current === undefined) return
    for (const socket of current) {
      if (socket !== except) socket.destroy()
    }
  }
}

async function receiveStrict<T>(
  connection: FramedMachineConnection,
  schema: z.ZodType<T>,
  options?: { readonly timeoutMs?: number },
): Promise<T> {
  const raw = await connection.receive(z.unknown(), options)
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'protocolVersion' in raw &&
    raw.protocolVersion !== machineProtocolVersion
  ) {
    throw new MachineTransportError(
      'protocol_incompatible',
      'CodeTether Machine protocol is incompatible',
    )
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new MachineTransportError(
      'malformed_message',
      'Machine message is invalid',
    )
  }
  return parsed.data
}

async function sendSafeError(
  connection: FramedMachineConnection,
  error: unknown,
): Promise<void> {
  const code = wireErrorCode(error)
  await connection.send(machineError(code)).catch(() => undefined)
}

function wireErrorCode(error: unknown): MachineWireErrorCode {
  if (!(error instanceof MachineTransportError)) return 'authentication_failed'
  if (error.code === 'connection_failed' || error.code === 'timeout') {
    return 'authentication_failed'
  }
  return error.code
}

function machineError(code: MachineWireErrorCode) {
  const message =
    code === 'pairing_disabled'
      ? 'Pairing mode is disabled'
      : code === 'pairing_expired'
        ? 'Pairing code expired'
        : code === 'pairing_rate_limited'
          ? 'Pairing attempt limit was reached'
          : code === 'protocol_incompatible'
            ? 'Machine protocol is incompatible'
            : code === 'busy'
              ? 'Machine connection limit was reached'
              : code === 'malformed_message'
                ? 'Machine message is invalid'
                : code === 'identity_mismatch'
                  ? 'Machine identity did not match'
                  : code === 'pairing_failed'
                    ? 'Pairing authentication failed'
                    : 'Machine authentication failed'
  return MachineErrorMessageSchema.parse({
    type: 'machine.error',
    protocolVersion: machineProtocolVersion,
    code,
    message,
  })
}

function normalizedRemoteAddress(value: string | undefined): string {
  if (value === undefined) return 'unknown'
  return value.startsWith('::ffff:') ? value.slice(7) : value
}

import { z } from 'zod'

import { machineProtocolVersion, machineTransportLimits } from './constants.js'
import { MachineTransportError } from './errors.js'
import { FramedMachineConnection } from './framing.js'
import { fingerprintsEqual, type MachineTlsIdentity } from './identity.js'
import type { ControllerId } from './ids.js'
import {
  MachineErrorMessageSchema,
  MachinePongMessageSchema,
  MachineStatusMessageSchema,
  PairingAckMessageSchema,
  PairingCancelledMessageSchema,
  PairingLoginResponseMessageSchema,
  PairingOfferMessageSchema,
  ProjectLocationValidatedMessageSchema,
  RemoteProjectLocationPathSchema,
  TrustRevokedMessageSchema,
  type PublicKeyFingerprint,
  type ProjectLocationValidatedMessage,
  type RemoteMachineMetadata,
} from './messages.js'
import {
  OpaquePairingInitiator,
  pairingServerIdentifier,
} from './opaque-pairing.js'
import {
  pairingConfirmationTag,
  pairingVerificationCode,
  verifyPairingConfirmationTag,
  type PairingTranscript,
} from './pairing-binding.js'
import type { PairingCode } from './pairing-code.js'
import {
  connectMachineTls,
  exportMachineTlsBinding,
  newMachineNonce,
} from './tls.js'

export const MachineEndpointSchema = z
  .object({
    host: z.string().trim().min(1).max(253),
    port: z.number().int().min(1).max(65_535),
  })
  .strict()
export type MachineEndpoint = z.infer<typeof MachineEndpointSchema>

export interface MachineControllerIdentity {
  readonly controllerId: ControllerId
  readonly tls: MachineTlsIdentity
}

export interface TrustedRemotePeer {
  readonly machine: RemoteMachineMetadata
  readonly endpoint: MachineEndpoint
  readonly nodeFingerprint: PublicKeyFingerprint
  /** Present while pairing; reconnect needs only the pinned SPKI fingerprint. */
  readonly nodeCertificatePem?: string
  readonly protocolVersion: typeof machineProtocolVersion
  readonly controllerId: ControllerId
}

export async function beginRemoteMachinePairing(options: {
  readonly endpoint: MachineEndpoint
  readonly pairingCode: PairingCode
  readonly controller: MachineControllerIdentity
  readonly signal?: AbortSignal
}): Promise<PendingRemoteMachinePairing> {
  const endpoint = MachineEndpointSchema.parse(options.endpoint)
  const tls = await connectMachineTls({
    ...endpoint,
    identity: options.controller.tls,
    signal: options.signal,
  })
  const connection = new FramedMachineConnection(tls.socket)
  try {
    await connection.send({
      type: 'pair.open',
      protocolVersion: machineProtocolVersion,
      controllerFingerprint: options.controller.tls.publicKeyFingerprint,
    })
    const first = await receiveCompatibleMachineMessage(
      connection,
      z.union([PairingOfferMessageSchema, MachineErrorMessageSchema]),
      { signal: options.signal },
    )
    if (first.type === 'machine.error')
      throw remoteError(first.code, first.message)
    if (!fingerprintsEqual(first.nodeFingerprint, tls.peerFingerprint)) {
      throw new MachineTransportError(
        'identity_mismatch',
        'Pairing offer did not match the connected Node identity',
      )
    }
    const serverIdentifier = pairingServerIdentifier(
      first.machine.machineId,
      first.nodeFingerprint,
    )
    const initiator = await OpaquePairingInitiator.start(
      options.pairingCode,
      serverIdentifier,
    )
    const controllerNonce = newMachineNonce()
    await connection.send({
      type: 'pair.login.start',
      protocolVersion: machineProtocolVersion,
      attemptId: first.attemptId,
      controllerId: options.controller.controllerId,
      controllerFingerprint: options.controller.tls.publicKeyFingerprint,
      controllerNonce,
      request: initiator.request,
    })
    const response = await receiveCompatibleMachineMessage(
      connection,
      z.union([PairingLoginResponseMessageSchema, MachineErrorMessageSchema]),
      { signal: options.signal },
    )
    if (response.type === 'machine.error') {
      throw remoteError(response.code, response.message)
    }
    const login = initiator.finish(response.response)
    await connection.send({
      type: 'pair.login.finish',
      protocolVersion: machineProtocolVersion,
      attemptId: first.attemptId,
      request: login.request,
    })
    const transcript: PairingTranscript = {
      protocolVersion: machineProtocolVersion,
      attemptId: first.attemptId,
      machine: first.machine,
      controllerId: options.controller.controllerId,
      nodeFingerprint: first.nodeFingerprint,
      controllerFingerprint: options.controller.tls.publicKeyFingerprint,
      nodeNonce: first.nodeNonce,
      controllerNonce,
      tlsExporter: exportMachineTlsBinding(tls.socket),
    }
    const peerCertificate = tls.socket.getPeerX509Certificate()
    if (peerCertificate === undefined) {
      throw new MachineTransportError(
        'authentication_failed',
        'Remote Node certificate was unavailable',
      )
    }
    return new PendingRemoteMachinePairing({
      connection,
      sessionKey: login.sessionKey,
      transcript,
      endpoint,
      expiresAt: new Date(first.expiresAt),
      nodeCertificatePem: peerCertificate.toString(),
    })
  } catch (error) {
    connection.destroy()
    throw error
  }
}

export class PendingRemoteMachinePairing {
  readonly pairingAttemptId: string
  readonly machine: RemoteMachineMetadata
  readonly endpoint: MachineEndpoint
  readonly expiresAt: Date
  readonly verificationCode: string
  readonly #connection: FramedMachineConnection
  readonly #sessionKey: Buffer
  readonly #transcript: PairingTranscript
  readonly #nodeCertificatePem: string
  #settled = false

  constructor(options: {
    connection: FramedMachineConnection
    sessionKey: Buffer
    transcript: PairingTranscript
    endpoint: MachineEndpoint
    expiresAt: Date
    nodeCertificatePem: string
  }) {
    this.#connection = options.connection
    this.#sessionKey = options.sessionKey
    this.#transcript = options.transcript
    this.pairingAttemptId = options.transcript.attemptId
    this.machine = options.transcript.machine
    this.endpoint = options.endpoint
    this.expiresAt = new Date(options.expiresAt)
    this.verificationCode = pairingVerificationCode(
      options.sessionKey,
      options.transcript,
    )
    this.#nodeCertificatePem = options.nodeCertificatePem
  }

  /**
   * The complete public trust candidate. Callers must durably stage this
   * value before confirm() so an acknowledgement lost to a crash can be
   * reconciled by an authenticated reconnect. It contains no private key or
   * reusable pairing secret.
   */
  get trustCandidate(): TrustedRemotePeer {
    return {
      machine: this.machine,
      endpoint: this.endpoint,
      nodeFingerprint: this.#transcript.nodeFingerprint,
      nodeCertificatePem: this.#nodeCertificatePem,
      protocolVersion: machineProtocolVersion,
      controllerId: this.#transcript.controllerId,
    }
  }

  async confirm(signal?: AbortSignal): Promise<TrustedRemotePeer> {
    this.#assertPending()
    this.#settled = true
    try {
      await this.#connection.send({
        type: 'pair.confirm',
        protocolVersion: machineProtocolVersion,
        attemptId: this.#transcript.attemptId,
        tag: pairingConfirmationTag(
          this.#sessionKey,
          'controller-confirm',
          this.#transcript,
        ),
      })
      const response = await receiveCompatibleMachineMessage(
        this.#connection,
        z.union([PairingAckMessageSchema, MachineErrorMessageSchema]),
        {
          signal,
          timeoutMs: machineTransportLimits.pairingConfirmationTimeoutMs,
        },
      )
      if (response.type === 'machine.error') {
        throw remoteError(response.code, response.message)
      }
      verifyPairingConfirmationTag(
        this.#sessionKey,
        'node-ack',
        this.#transcript,
        response.tag,
      )
      this.#connection.end()
      return this.trustCandidate
    } finally {
      this.#sessionKey.fill(0)
      this.#connection.destroy()
    }
  }

  async cancel(signal?: AbortSignal): Promise<void> {
    if (this.#settled) return
    this.#settled = true
    try {
      await this.#connection.send({
        type: 'pair.cancel',
        protocolVersion: machineProtocolVersion,
        attemptId: this.#transcript.attemptId,
        tag: pairingConfirmationTag(
          this.#sessionKey,
          'controller-cancel',
          this.#transcript,
        ),
      })
      const response = await receiveCompatibleMachineMessage(
        this.#connection,
        z.union([PairingCancelledMessageSchema, MachineErrorMessageSchema]),
        { signal },
      )
      if (response.type === 'machine.error') {
        throw remoteError(response.code, response.message)
      }
      verifyPairingConfirmationTag(
        this.#sessionKey,
        'node-cancelled',
        this.#transcript,
        response.tag,
      )
    } finally {
      this.#sessionKey.fill(0)
      this.#connection.end()
      this.#connection.destroy()
    }
  }

  #assertPending(): void {
    if (this.#settled) {
      throw new MachineTransportError(
        'pairing_failed',
        'Pairing session is no longer pending',
      )
    }
  }
}

export async function connectTrustedRemoteMachine(options: {
  readonly peer: TrustedRemotePeer
  readonly controller: MachineControllerIdentity
  readonly signal?: AbortSignal
}): Promise<AuthenticatedRemoteMachineConnection> {
  if (options.peer.controllerId !== options.controller.controllerId) {
    throw new MachineTransportError(
      'identity_mismatch',
      'Trusted Machine is bound to another controller identity',
    )
  }
  const tls = await connectMachineTls({
    ...MachineEndpointSchema.parse(options.peer.endpoint),
    identity: options.controller.tls,
    expectedPeerFingerprint: options.peer.nodeFingerprint,
    signal: options.signal,
  })
  const connection = new FramedMachineConnection(tls.socket)
  try {
    const nonce = newMachineNonce()
    await connection.send({
      type: 'machine.hello',
      protocolVersion: machineProtocolVersion,
      controllerId: options.controller.controllerId,
      expectedMachineId: options.peer.machine.machineId,
      nonce,
    })
    const response = await receiveCompatibleMachineMessage(
      connection,
      z.union([MachineStatusMessageSchema, MachineErrorMessageSchema]),
      { signal: options.signal },
    )
    if (response.type === 'machine.error') {
      throw remoteError(response.code, response.message, true)
    }
    if (
      response.nonce !== nonce ||
      response.machine.machineId !== options.peer.machine.machineId ||
      response.machine.nodeId !== options.peer.machine.nodeId
    ) {
      throw new MachineTransportError(
        'identity_mismatch',
        'Authenticated Machine identity did not match durable trust',
      )
    }
    return new AuthenticatedRemoteMachineConnection(
      connection,
      options.controller.controllerId,
      response.machine,
    )
  } catch (error) {
    connection.destroy()
    throw error
  }
}

export class AuthenticatedRemoteMachineConnection {
  readonly machine: RemoteMachineMetadata
  readonly #connection: FramedMachineConnection
  readonly #controllerId: ControllerId

  constructor(
    connection: FramedMachineConnection,
    controllerId: ControllerId,
    machine: RemoteMachineMetadata,
  ) {
    this.#connection = connection
    this.#controllerId = controllerId
    this.machine = machine
  }

  async ping(signal?: AbortSignal): Promise<void> {
    const nonce = newMachineNonce()
    await this.#connection.send({
      type: 'machine.ping',
      protocolVersion: machineProtocolVersion,
      nonce,
    })
    const response = await receiveCompatibleMachineMessage(
      this.#connection,
      z.union([MachinePongMessageSchema, MachineErrorMessageSchema]),
      { signal, timeoutMs: machineTransportLimits.heartbeatTimeoutMs },
    )
    if (response.type === 'machine.error') {
      throw remoteError(response.code, response.message, true)
    }
    if (response.nonce !== nonce) {
      throw new MachineTransportError(
        'authentication_failed',
        'Machine heartbeat was invalid',
      )
    }
  }

  async validateProjectLocation(
    rootPath: string,
    signal?: AbortSignal,
  ): Promise<ValidatedRemoteProjectLocation> {
    const parsedRootPath = RemoteProjectLocationPathSchema.safeParse(rootPath)
    if (!parsedRootPath.success) {
      throw new MachineTransportError(
        'project_location_path_invalid',
        'Project Location path is invalid',
      )
    }
    const boundedRootPath = parsedRootPath.data
    const requestId = newMachineNonce()
    await this.#connection.send({
      type: 'project_location.validate',
      protocolVersion: machineProtocolVersion,
      requestId,
      expectedMachineId: this.machine.machineId,
      expectedNodeId: this.machine.nodeId,
      rootPath: boundedRootPath,
    })
    const response = await receiveCompatibleMachineMessage(
      this.#connection,
      z.union([
        ProjectLocationValidatedMessageSchema,
        MachineErrorMessageSchema,
      ]),
      { signal },
    )
    if (response.type === 'machine.error') {
      throw remoteError(response.code, response.message, true)
    }
    this.#assertProjectLocationResponse(response, requestId)
    return {
      canonicalPath: response.canonicalPath,
      basename: response.basename,
      exists: response.exists,
      directory: response.directory,
    }
  }

  async revoke(signal?: AbortSignal): Promise<void> {
    const nonce = newMachineNonce()
    await this.#connection.send({
      type: 'trust.revoke',
      protocolVersion: machineProtocolVersion,
      controllerId: this.#controllerId,
      nonce,
    })
    const response = await receiveCompatibleMachineMessage(
      this.#connection,
      z.union([TrustRevokedMessageSchema, MachineErrorMessageSchema]),
      { signal },
    )
    if (response.type === 'machine.error') {
      throw remoteError(response.code, response.message, true)
    }
    if (
      response.controllerId !== this.#controllerId ||
      response.nonce !== nonce
    ) {
      throw new MachineTransportError(
        'authentication_failed',
        'Machine revocation receipt was invalid',
      )
    }
    this.#connection.end()
  }

  close(): void {
    this.#connection.end()
  }

  #assertProjectLocationResponse(
    response: ProjectLocationValidatedMessage,
    requestId: string,
  ): void {
    if (
      response.requestId !== requestId ||
      response.machineId !== this.machine.machineId ||
      response.nodeId !== this.machine.nodeId
    ) {
      this.#connection.destroy()
      throw new MachineTransportError(
        'identity_mismatch',
        'Project Location validation did not match the trusted Machine',
        { peerAuthenticated: true },
      )
    }
  }
}

export interface ValidatedRemoteProjectLocation {
  readonly canonicalPath: string
  readonly basename: string
  readonly exists: true
  readonly directory: true
}

export async function receiveCompatibleMachineMessage<T>(
  connection: FramedMachineConnection,
  schema: z.ZodType<T>,
  options: { readonly timeoutMs?: number; readonly signal?: AbortSignal } = {},
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
    connection.destroy()
    throw new MachineTransportError(
      'malformed_message',
      'Machine message is invalid',
    )
  }
  return parsed.data
}

function remoteError(
  code: z.infer<typeof MachineErrorMessageSchema>['code'],
  message: string,
  peerAuthenticated = false,
) {
  const mapped =
    code === 'protocol_incompatible'
      ? 'protocol_incompatible'
      : code === 'identity_mismatch'
        ? 'identity_mismatch'
        : code === 'authentication_failed'
          ? 'authentication_failed'
          : code === 'pairing_expired'
            ? 'pairing_expired'
            : code === 'pairing_rate_limited'
              ? 'pairing_rate_limited'
              : code === 'pairing_disabled'
                ? 'pairing_disabled'
                : code === 'busy'
                  ? 'busy'
                  : code === 'malformed_message'
                    ? 'malformed_message'
                    : code === 'project_location_path_invalid'
                      ? 'project_location_path_invalid'
                      : code === 'project_location_missing'
                        ? 'project_location_missing'
                        : code === 'project_location_not_directory'
                          ? 'project_location_not_directory'
                          : code === 'project_location_inaccessible'
                            ? 'project_location_inaccessible'
                            : 'pairing_failed'
  return new MachineTransportError(mapped, message, { peerAuthenticated })
}

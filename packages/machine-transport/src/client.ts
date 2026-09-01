import { z } from 'zod'

import { machineProtocolVersion, machineTransportLimits } from './constants.js'
import { MachineTransportError } from './errors.js'
import { FramedMachineConnection } from './framing.js'
import { fingerprintsEqual, type MachineTlsIdentity } from './identity.js'
import type {
  ControllerId,
  MachineTransportActionId,
  MachineTransportConversationId,
  MachineTransportProjectId,
  MachineTransportTurnId,
} from './ids.js'
import {
  CodexSessionDisposedMessageSchema,
  CodexSessionReadyMessageSchema,
  CodexTurnEventMessageSchema,
  CodexTurnStartedMessageSchema,
  MachineErrorMessageSchema,
  MachinePongMessageSchema,
  MachineStatusMessageSchema,
  PairingAckMessageSchema,
  PairingCancelledMessageSchema,
  PairingLoginResponseMessageSchema,
  PairingOfferMessageSchema,
  ProjectLocationValidatedMessageSchema,
  ProvidersDescribedMessageSchema,
  RemoteProjectLocationPathSchema,
  TrustRevokedMessageSchema,
  type PublicKeyFingerprint,
  type CodexTurnEventMessage,
  type ProjectLocationValidatedMessage,
  type ProvidersDescribedMessage,
  type RemoteCodexProviderIdentity,
  type RemoteCodexPrompt,
  type RemoteProviderDescriptor,
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

export interface OpenRemoteCodexSessionOptions {
  readonly peer: TrustedRemotePeer
  readonly controller: MachineControllerIdentity
  readonly conversationId: MachineTransportConversationId
  readonly projectId: MachineTransportProjectId
  /** Durable ProjectLocation root; never accept a transient UI path here. */
  readonly rootPath: string
  readonly providerThreadId?: RemoteCodexProviderIdentity
  readonly signal?: AbortSignal
}

/**
 * Opens one dedicated authenticated execution connection for one remote
 * Conversation. The connection cannot be used as a generic Machine channel.
 */
export async function openRemoteCodexSession(
  options: OpenRemoteCodexSessionOptions,
): Promise<RemoteCodexSession> {
  const connection = await connectTrustedRemoteMachine({
    peer: options.peer,
    controller: options.controller,
    signal: options.signal,
  })
  try {
    return await connection.openCodexSession({
      conversationId: options.conversationId,
      projectId: options.projectId,
      rootPath: options.rootPath,
      ...(options.providerThreadId === undefined
        ? {}
        : { providerThreadId: options.providerThreadId }),
      signal: options.signal,
    })
  } catch (error) {
    connection.close()
    throw error
  }
}

export class AuthenticatedRemoteMachineConnection {
  readonly machine: RemoteMachineMetadata
  readonly #connection: FramedMachineConnection
  readonly #controllerId: ControllerId
  #providerDiscoveryInFlight?: Promise<RemoteProviderDiscovery>
  #dedicated = false

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
    this.#assertGeneralPurpose()
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
    this.#assertGeneralPurpose()
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

  discoverProviders(signal?: AbortSignal): Promise<RemoteProviderDiscovery> {
    this.#assertGeneralPurpose()
    this.#providerDiscoveryInFlight ??= this.#discoverProviders(signal).finally(
      () => {
        this.#providerDiscoveryInFlight = undefined
      },
    )
    return this.#providerDiscoveryInFlight
  }

  async #discoverProviders(
    signal?: AbortSignal,
  ): Promise<RemoteProviderDiscovery> {
    const requestId = newMachineNonce()
    await this.#connection.send({
      type: 'providers.describe',
      protocolVersion: machineProtocolVersion,
      requestId,
      expectedMachineId: this.machine.machineId,
      expectedNodeId: this.machine.nodeId,
    })
    const response = await receiveCompatibleMachineMessage(
      this.#connection,
      z.union([ProvidersDescribedMessageSchema, MachineErrorMessageSchema]),
      {
        signal,
        timeoutMs: machineTransportLimits.providerDiscoveryTimeoutMs,
      },
    )
    if (response.type === 'machine.error') {
      throw remoteError(response.code, response.message, true)
    }
    this.#assertProviderDiscoveryResponse(response, requestId)
    return {
      providers: response.providers,
      observedAt: response.observedAt,
    }
  }

  async revoke(signal?: AbortSignal): Promise<void> {
    this.#assertGeneralPurpose()
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

  async openCodexSession(options: {
    readonly conversationId: MachineTransportConversationId
    readonly projectId: MachineTransportProjectId
    readonly rootPath: string
    readonly providerThreadId?: RemoteCodexProviderIdentity
    readonly signal?: AbortSignal
  }): Promise<RemoteCodexSession> {
    this.#assertGeneralPurpose()
    const rootPath = RemoteProjectLocationPathSchema.safeParse(options.rootPath)
    if (!rootPath.success) {
      throw new MachineTransportError(
        'project_location_path_invalid',
        'Project Location path is invalid',
      )
    }
    const requestId = newMachineNonce()
    await this.#connection.send({
      type: 'codex.session.open',
      protocolVersion: machineProtocolVersion,
      requestId,
      expectedMachineId: this.machine.machineId,
      expectedNodeId: this.machine.nodeId,
      conversationId: options.conversationId,
      projectId: options.projectId,
      rootPath: rootPath.data,
      ...(options.providerThreadId === undefined
        ? {}
        : { providerThreadId: options.providerThreadId }),
    })
    const response = await receiveCompatibleMachineMessage(
      this.#connection,
      z.union([CodexSessionReadyMessageSchema, MachineErrorMessageSchema]),
      {
        signal: options.signal,
        timeoutMs: machineTransportLimits.providerDiscoveryTimeoutMs,
      },
    )
    if (response.type === 'machine.error') {
      throw remoteError(response.code, response.message, true)
    }
    if (
      response.requestId !== requestId ||
      response.machineId !== this.machine.machineId ||
      response.nodeId !== this.machine.nodeId ||
      response.conversationId !== options.conversationId ||
      (options.providerThreadId !== undefined &&
        response.providerThreadId !== options.providerThreadId) ||
      response.resumed !== (options.providerThreadId !== undefined)
    ) {
      this.#connection.destroy()
      throw new MachineTransportError(
        'identity_mismatch',
        'Remote Codex session did not match the trusted Conversation',
        { peerAuthenticated: true },
      )
    }
    this.#dedicated = true
    return new RemoteCodexSession(this.#connection, this.machine, response)
  }

  #assertGeneralPurpose(): void {
    if (this.#dedicated) {
      throw new MachineTransportError(
        'conversation_busy',
        'Machine connection is dedicated to a remote Codex session',
        { peerAuthenticated: true },
      )
    }
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

  #assertProviderDiscoveryResponse(
    response: ProvidersDescribedMessage,
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
        'Provider discovery did not match the trusted Machine',
        { peerAuthenticated: true },
      )
    }
  }
}

export interface StartRemoteCodexTurnOptions {
  readonly actionId: MachineTransportActionId
  readonly turnId: MachineTransportTurnId
  readonly prompt: RemoteCodexPrompt
  readonly signal?: AbortSignal
}

export class RemoteCodexSession {
  readonly machine: RemoteMachineMetadata
  readonly conversationId: MachineTransportConversationId
  readonly providerThreadId: RemoteCodexProviderIdentity
  readonly resumed: boolean
  readonly executionProfile = 'codex-text-v1' as const
  readonly #connection: FramedMachineConnection
  #activeTurn: RemoteCodexTurn | undefined
  #closed = false

  constructor(
    connection: FramedMachineConnection,
    machine: RemoteMachineMetadata,
    ready: z.infer<typeof CodexSessionReadyMessageSchema>,
  ) {
    this.#connection = connection
    this.machine = machine
    this.conversationId = ready.conversationId
    this.providerThreadId = ready.providerThreadId
    this.resumed = ready.resumed
  }

  /** Host-private liveness for the dedicated authenticated connection. */
  get closed(): boolean {
    return this.#closed || this.#connection.closed
  }

  async startTurn(
    options: StartRemoteCodexTurnOptions,
  ): Promise<RemoteCodexTurn> {
    if (this.closed) {
      this.#closed = true
      throw new MachineTransportError(
        'provider_session_lost',
        'Remote Codex session is closed',
        { peerAuthenticated: true },
      )
    }
    if (this.#activeTurn !== undefined) {
      throw new MachineTransportError(
        'conversation_busy',
        'Remote Codex Conversation already has an active Turn',
        { peerAuthenticated: true },
      )
    }
    options.signal?.throwIfAborted()
    try {
      await this.#connection.send({
        type: 'codex.turn.start',
        protocolVersion: machineProtocolVersion,
        actionId: options.actionId,
        conversationId: this.conversationId,
        turnId: options.turnId,
        providerThreadId: this.providerThreadId,
        prompt: options.prompt,
      })
      const response = await receiveCompatibleMachineMessage(
        this.#connection,
        z.union([CodexTurnStartedMessageSchema, MachineErrorMessageSchema]),
        {
          signal: options.signal,
          timeoutMs: machineTransportLimits.messageTimeoutMs,
        },
      )
      if (response.type === 'machine.error') {
        throw remoteError(response.code, response.message, true)
      }
      if (
        response.machineId !== this.machine.machineId ||
        response.nodeId !== this.machine.nodeId ||
        response.actionId !== options.actionId ||
        response.conversationId !== this.conversationId ||
        response.turnId !== options.turnId ||
        response.providerThreadId !== this.providerThreadId
      ) {
        throw new MachineTransportError(
          'identity_mismatch',
          'Remote Codex Turn did not match the bound Conversation',
          { peerAuthenticated: true },
        )
      }
      const turn = new RemoteCodexTurn(
        this.#connection,
        response,
        () => {
          if (this.#activeTurn === turn) this.#activeTurn = undefined
        },
        () => this.#failClosed(),
      )
      this.#activeTurn = turn
      return turn
    } catch (error) {
      // Once the start frame is sent, a timeout/abort leaves Prompt ownership
      // ambiguous. Fail the dedicated connection closed; callers may reconcile
      // the durable Turn but must never blindly send the Prompt again.
      this.#failClosed()
      throw error
    }
  }

  async close(signal?: AbortSignal): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    if (this.#connection.closed) return
    if (this.#activeTurn !== undefined) {
      this.#connection.destroy()
      return
    }
    const requestId = newMachineNonce()
    try {
      await this.#connection.send({
        type: 'codex.session.dispose',
        protocolVersion: machineProtocolVersion,
        requestId,
        conversationId: this.conversationId,
        providerThreadId: this.providerThreadId,
      })
      const response = await receiveCompatibleMachineMessage(
        this.#connection,
        z.union([CodexSessionDisposedMessageSchema, MachineErrorMessageSchema]),
        { signal },
      )
      if (response.type === 'machine.error') {
        throw remoteError(response.code, response.message, true)
      }
      if (
        response.requestId !== requestId ||
        response.machineId !== this.machine.machineId ||
        response.nodeId !== this.machine.nodeId ||
        response.conversationId !== this.conversationId
      ) {
        throw new MachineTransportError(
          'identity_mismatch',
          'Remote Codex disposal receipt did not match the session',
          { peerAuthenticated: true },
        )
      }
      this.#connection.end()
    } catch (error) {
      this.#connection.destroy()
      throw error
    }
  }

  #failClosed(): void {
    this.#closed = true
    this.#connection.destroy()
  }
}

export class RemoteCodexTurn {
  readonly actionId: MachineTransportActionId
  readonly conversationId: MachineTransportConversationId
  readonly turnId: MachineTransportTurnId
  readonly providerThreadId: RemoteCodexProviderIdentity
  readonly providerTurnId: RemoteCodexProviderIdentity
  readonly #connection: FramedMachineConnection
  readonly #release: () => void
  readonly #failClosed: () => void
  readonly #started: z.infer<typeof CodexTurnStartedMessageSchema>
  #nextSequence = 1
  #terminal = false

  constructor(
    connection: FramedMachineConnection,
    started: z.infer<typeof CodexTurnStartedMessageSchema>,
    release: () => void,
    failClosed: () => void,
  ) {
    this.#connection = connection
    this.#started = started
    this.actionId = started.actionId
    this.conversationId = started.conversationId
    this.turnId = started.turnId
    this.providerThreadId = started.providerThreadId
    this.providerTurnId = started.providerTurnId
    this.#release = release
    this.#failClosed = failClosed
  }

  async nextEvent(signal?: AbortSignal): Promise<CodexTurnEventMessage> {
    if (this.#terminal) {
      throw new MachineTransportError(
        'provider_session_lost',
        'Remote Codex Turn is already terminal',
        { peerAuthenticated: true },
      )
    }
    const response = await receiveCompatibleMachineMessage(
      this.#connection,
      z.union([CodexTurnEventMessageSchema, MachineErrorMessageSchema]),
      {
        signal,
        timeoutMs: machineTransportLimits.remoteCodexTurnTimeoutMs,
      },
    )
    if (response.type === 'machine.error') {
      this.#failClosed()
      throw remoteError(response.code, response.message, true)
    }
    if (
      response.machineId !== this.#startedMachineId ||
      response.nodeId !== this.#startedNodeId ||
      response.actionId !== this.actionId ||
      response.conversationId !== this.conversationId ||
      response.turnId !== this.turnId ||
      response.providerThreadId !== this.providerThreadId ||
      response.providerTurnId !== this.providerTurnId ||
      response.sequence !== this.#nextSequence
    ) {
      this.#failClosed()
      throw new MachineTransportError(
        'identity_mismatch',
        'Remote Codex event correlation or sequence was invalid',
        { peerAuthenticated: true },
      )
    }
    this.#nextSequence += 1
    if (
      response.event.type === 'turn.completed' ||
      response.event.type === 'turn.failed'
    ) {
      this.#terminal = true
      this.#release()
    }
    return response
  }

  async *events(signal?: AbortSignal): AsyncGenerator<CodexTurnEventMessage> {
    try {
      while (!this.#terminal) yield await this.nextEvent(signal)
    } finally {
      if (!this.#terminal) this.#failClosed()
    }
  }

  get #startedMachineId(): string {
    return this.#started.machineId
  }

  get #startedNodeId(): string {
    return this.#started.nodeId
  }
}

export type RemoteCodexTurnEvent = CodexTurnEventMessage

export interface ValidatedRemoteProjectLocation {
  readonly canonicalPath: string
  readonly basename: string
  readonly exists: true
  readonly directory: true
}

export interface RemoteProviderDiscovery {
  readonly providers: readonly RemoteProviderDescriptor[]
  readonly observedAt: string
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
                            : code === 'remote_execution_unavailable'
                              ? 'remote_execution_unavailable'
                              : code === 'provider_unavailable'
                                ? 'provider_unavailable'
                                : code === 'provider_start_failed'
                                  ? 'provider_start_failed'
                                  : code === 'provider_session_lost'
                                    ? 'provider_session_lost'
                                    : code === 'remote_execution_lost'
                                      ? 'remote_execution_lost'
                                      : code === 'remote_policy_violation'
                                        ? 'remote_policy_violation'
                                        : code === 'conversation_busy'
                                          ? 'conversation_busy'
                                          : code === 'duplicate_action_conflict'
                                            ? 'duplicate_action_conflict'
                                            : 'pairing_failed'
  return new MachineTransportError(mapped, message, { peerAuthenticated })
}

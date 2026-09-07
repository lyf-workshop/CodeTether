import type { Duplex } from 'node:stream'

import { z } from 'zod'

import type { AgentProvider, CanonicalFailure } from '@codetether/agent-core'

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
  ProviderInstallationId,
  ProviderInstallationRevision,
} from './ids.js'
import {
  ClaudeSessionHeartbeatAckMessageSchema,
  ClaudeSessionDisposedMessageSchema,
  ClaudeSessionReadyMessageSchema,
  ClaudeTurnEventMessageSchema,
  ClaudeTurnStartedMessageSchema,
  CodexSessionHeartbeatAckMessageSchema,
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
  ProviderSessionsDiscoveredMessageSchema,
  ProviderSessionValidatedMessageSchema,
  ProvidersDescribedMessageSchema,
  RemoteProjectLocationPathSchema,
  TrustRevokedMessageSchema,
  type PublicKeyFingerprint,
  type ClaudeTurnEventMessage,
  type CodexTurnEventMessage,
  type ProjectLocationValidatedMessage,
  type PrivateProviderSessionCandidate,
  type ProviderSessionsDiscoveredMessage,
  type ProviderSessionValidatedMessage,
  type ProvidersDescribedMessage,
  type RemoteCodexProviderIdentity,
  type RemoteCodexPrompt,
  type RemoteClaudeEffort,
  type RemoteClaudePrompt,
  type RemoteClaudeProviderIdentity,
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
  connectMachineTlsOverStream,
  exportMachineTlsBinding,
  newMachineNonce,
  type MachineTlsConnection,
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
      throw remoteError(first.code, first.message, false, first.failure)
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
      throw remoteError(
        response.code,
        response.message,
        false,
        response.failure,
      )
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
        throw remoteError(
          response.code,
          response.message,
          false,
          response.failure,
        )
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
        throw remoteError(
          response.code,
          response.message,
          false,
          response.failure,
        )
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
  return await connectTrustedRemoteMachineWithTls(options, async () => {
    return await connectMachineTls({
      ...MachineEndpointSchema.parse(options.peer.endpoint),
      identity: options.controller.tls,
      expectedPeerFingerprint: options.peer.nodeFingerprint,
      signal: options.signal,
    })
  })
}

export interface ConnectTrustedRemoteMachineOverStreamOptions {
  readonly peer: TrustedRemotePeer
  readonly controller: MachineControllerIdentity
  /** Existing Relay-owned byte stream; no endpoint override is accepted. */
  readonly stream: Duplex
  readonly signal?: AbortSignal
}

/**
 * Authenticates a trusted Machine over a caller-established byte stream. Only
 * dialing is replaced: TLS pinning and the exact Machine hello remain shared
 * with the direct transport path.
 */
export async function connectTrustedRemoteMachineOverStream(
  options: ConnectTrustedRemoteMachineOverStreamOptions,
): Promise<AuthenticatedRemoteMachineConnection> {
  try {
    return await connectTrustedRemoteMachineWithTls(options, async () => {
      return await connectMachineTlsOverStream({
        stream: options.stream,
        identity: options.controller.tls,
        expectedPeerFingerprint: options.peer.nodeFingerprint,
        signal: options.signal,
      })
    })
  } catch (error) {
    if (!options.stream.destroyed) options.stream.destroy()
    throw error
  }
}

async function connectTrustedRemoteMachineWithTls(
  options: {
    readonly peer: TrustedRemotePeer
    readonly controller: MachineControllerIdentity
    readonly signal?: AbortSignal
  },
  establishTls: () => Promise<MachineTlsConnection>,
): Promise<AuthenticatedRemoteMachineConnection> {
  if (options.peer.controllerId !== options.controller.controllerId) {
    throw new MachineTransportError(
      'identity_mismatch',
      'Trusted Machine is bound to another controller identity',
    )
  }
  const tls = await establishTls()
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
      throw remoteError(response.code, response.message, true, response.failure)
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
  readonly providerInstallationId: ProviderInstallationId
  readonly expectedInstallationRevision: ProviderInstallationRevision
  /** Durable ProjectLocation root; never accept a transient UI path here. */
  readonly rootPath: string
  readonly providerThreadId?: RemoteCodexProviderIdentity
  readonly signal?: AbortSignal
  /** Test-only tightening; production callers cannot extend either bound. */
  readonly heartbeatIntervalMs?: number
  readonly heartbeatTimeoutMs?: number
}

/**
 * Opens one dedicated authenticated execution connection for one remote
 * Conversation. The connection cannot be used as a generic Machine channel.
 */
export async function openRemoteCodexSession(
  options: OpenRemoteCodexSessionOptions,
): Promise<RemoteCodexSession> {
  return await openRemoteCodexSessionWithConnection(options, async () => {
    return await connectTrustedRemoteMachine({
      peer: options.peer,
      controller: options.controller,
      signal: options.signal,
    })
  })
}

export type OpenRemoteCodexSessionOverStreamOptions =
  OpenRemoteCodexSessionOptions & {
    /** Existing Relay-owned byte stream; no endpoint override is accepted. */
    readonly stream: Duplex
  }

export async function openRemoteCodexSessionOverStream(
  options: OpenRemoteCodexSessionOverStreamOptions,
): Promise<RemoteCodexSession> {
  return await openRemoteCodexSessionWithConnection(options, async () => {
    return await connectTrustedRemoteMachineOverStream({
      peer: options.peer,
      controller: options.controller,
      stream: options.stream,
      signal: options.signal,
    })
  })
}

async function openRemoteCodexSessionWithConnection(
  options: OpenRemoteCodexSessionOptions,
  connectTrusted: () => Promise<AuthenticatedRemoteMachineConnection>,
): Promise<RemoteCodexSession> {
  const connection = await connectTrusted()
  try {
    return await connection.openCodexSession({
      conversationId: options.conversationId,
      projectId: options.projectId,
      providerInstallationId: options.providerInstallationId,
      expectedInstallationRevision: options.expectedInstallationRevision,
      rootPath: options.rootPath,
      ...(options.providerThreadId === undefined
        ? {}
        : { providerThreadId: options.providerThreadId }),
      signal: options.signal,
      ...(options.heartbeatIntervalMs === undefined
        ? {}
        : { heartbeatIntervalMs: options.heartbeatIntervalMs }),
      ...(options.heartbeatTimeoutMs === undefined
        ? {}
        : { heartbeatTimeoutMs: options.heartbeatTimeoutMs }),
    })
  } catch (error) {
    connection.close()
    // The pinned TLS/Machine handshake completed before the semantic session
    // open began. A dropped ready response is therefore an uncertain accepted
    // operation, not evidence that another endpoint is safe to retry.
    throw authenticatedOperationError(error)
  }
}

interface OpenRemoteClaudeSessionBaseOptions {
  readonly peer: TrustedRemotePeer
  readonly controller: MachineControllerIdentity
  readonly conversationId: MachineTransportConversationId
  readonly projectId: MachineTransportProjectId
  readonly providerInstallationId: ProviderInstallationId
  readonly expectedInstallationRevision: ProviderInstallationRevision
  /** Durable ProjectLocation root; never accept a transient UI path here. */
  readonly rootPath: string
  readonly effort?: RemoteClaudeEffort
  readonly signal?: AbortSignal
  /** Test-only tightening; production callers cannot extend either bound. */
  readonly heartbeatIntervalMs?: number
  readonly heartbeatTimeoutMs?: number
}

type RemoteClaudeSessionIdentityOptions =
  | {
      readonly providerSessionId?: never
      readonly providerSessionMaterialized?: never
    }
  | {
      readonly providerSessionId: RemoteClaudeProviderIdentity
      readonly providerSessionMaterialized: boolean
    }

export type OpenRemoteClaudeSessionOptions =
  OpenRemoteClaudeSessionBaseOptions & RemoteClaudeSessionIdentityOptions

/** Opens one dedicated authenticated restricted Claude Code session. */
export async function openRemoteClaudeSession(
  options: OpenRemoteClaudeSessionOptions,
): Promise<RemoteClaudeSession> {
  return await openRemoteClaudeSessionWithConnection(options, async () => {
    return await connectTrustedRemoteMachine({
      peer: options.peer,
      controller: options.controller,
      signal: options.signal,
    })
  })
}

export type OpenRemoteClaudeSessionOverStreamOptions =
  OpenRemoteClaudeSessionOptions & {
    /** Existing Relay-owned byte stream; no endpoint override is accepted. */
    readonly stream: Duplex
  }

export async function openRemoteClaudeSessionOverStream(
  options: OpenRemoteClaudeSessionOverStreamOptions,
): Promise<RemoteClaudeSession> {
  return await openRemoteClaudeSessionWithConnection(options, async () => {
    return await connectTrustedRemoteMachineOverStream({
      peer: options.peer,
      controller: options.controller,
      stream: options.stream,
      signal: options.signal,
    })
  })
}

async function openRemoteClaudeSessionWithConnection(
  options: OpenRemoteClaudeSessionOptions,
  connectTrusted: () => Promise<AuthenticatedRemoteMachineConnection>,
): Promise<RemoteClaudeSession> {
  const connection = await connectTrusted()
  try {
    const sessionOptions = {
      conversationId: options.conversationId,
      projectId: options.projectId,
      providerInstallationId: options.providerInstallationId,
      expectedInstallationRevision: options.expectedInstallationRevision,
      rootPath: options.rootPath,
      ...(options.effort === undefined ? {} : { effort: options.effort }),
      signal: options.signal,
      ...(options.heartbeatIntervalMs === undefined
        ? {}
        : { heartbeatIntervalMs: options.heartbeatIntervalMs }),
      ...(options.heartbeatTimeoutMs === undefined
        ? {}
        : { heartbeatTimeoutMs: options.heartbeatTimeoutMs }),
    }
    return await (options.providerSessionId === undefined
      ? connection.openClaudeSession(sessionOptions)
      : connection.openClaudeSession({
          ...sessionOptions,
          providerSessionId: options.providerSessionId,
          providerSessionMaterialized: options.providerSessionMaterialized,
        }))
  } catch (error) {
    connection.close()
    throw authenticatedOperationError(error)
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
      throw remoteError(response.code, response.message, true, response.failure)
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
      throw remoteError(response.code, response.message, true, response.failure)
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
      throw remoteError(response.code, response.message, true, response.failure)
    }
    this.#assertProviderDiscoveryResponse(response, requestId)
    return {
      providers: response.providers,
      observedAt: response.observedAt,
    }
  }

  async discoverProviderSessions(options: {
    readonly provider: AgentProvider
    readonly providerInstallationId: ProviderInstallationId
    readonly expectedInstallationRevision: ProviderInstallationRevision
    readonly projectId: MachineTransportProjectId
    /** Durable Host-owned ProjectLocation root, never a Web-selected scan path. */
    readonly rootPath: string
    readonly cursor?: string
    readonly limit: number
    readonly signal?: AbortSignal
  }): Promise<RemoteProviderSessionDiscoveryPage> {
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
      type: 'provider_sessions.discover',
      protocolVersion: machineProtocolVersion,
      requestId,
      expectedMachineId: this.machine.machineId,
      expectedNodeId: this.machine.nodeId,
      provider: options.provider,
      providerInstallationId: options.providerInstallationId,
      expectedInstallationRevision: options.expectedInstallationRevision,
      projectId: options.projectId,
      rootPath: rootPath.data,
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      limit: options.limit,
    })
    const response = await receiveCompatibleMachineMessage(
      this.#connection,
      z.union([
        ProviderSessionsDiscoveredMessageSchema,
        MachineErrorMessageSchema,
      ]),
      {
        signal: options.signal,
        timeoutMs: machineTransportLimits.providerSessionDiscoveryTimeoutMs,
      },
    )
    if (response.type === 'machine.error') {
      throw remoteError(response.code, response.message, true, response.failure)
    }
    this.#assertProviderSessionResponse(
      response,
      requestId,
      options.provider,
      options.providerInstallationId,
      options.expectedInstallationRevision,
    )
    return {
      provider: response.provider,
      providerInstallationId: response.providerInstallationId,
      installationRevision: response.installationRevision,
      status: response.status,
      resumeStatus: response.resumeStatus,
      ...(response.providerVersion === undefined
        ? {}
        : { providerVersion: response.providerVersion }),
      candidates: response.candidates,
      ...(response.nextCursor === undefined
        ? {}
        : { nextCursor: response.nextCursor }),
      ...(response.failureReason === undefined
        ? {}
        : { failureReason: response.failureReason }),
      metrics: response.metrics,
    }
  }

  async validateProviderSession(options: {
    readonly provider: AgentProvider
    readonly providerInstallationId: ProviderInstallationId
    readonly expectedInstallationRevision: ProviderInstallationRevision
    readonly projectId: MachineTransportProjectId
    readonly rootPath: string
    readonly nativeSessionId: string
    readonly revision: string
    readonly signal?: AbortSignal
  }): Promise<PrivateProviderSessionCandidate | undefined> {
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
      type: 'provider_session.validate',
      protocolVersion: machineProtocolVersion,
      requestId,
      expectedMachineId: this.machine.machineId,
      expectedNodeId: this.machine.nodeId,
      provider: options.provider,
      providerInstallationId: options.providerInstallationId,
      expectedInstallationRevision: options.expectedInstallationRevision,
      projectId: options.projectId,
      rootPath: rootPath.data,
      nativeSessionId: options.nativeSessionId,
      revision: options.revision,
    })
    const response = await receiveCompatibleMachineMessage(
      this.#connection,
      z.union([
        ProviderSessionValidatedMessageSchema,
        MachineErrorMessageSchema,
      ]),
      {
        signal: options.signal,
        timeoutMs: machineTransportLimits.providerSessionDiscoveryTimeoutMs,
      },
    )
    if (response.type === 'machine.error') {
      throw remoteError(response.code, response.message, true, response.failure)
    }
    this.#assertProviderSessionResponse(
      response,
      requestId,
      options.provider,
      options.providerInstallationId,
      options.expectedInstallationRevision,
    )
    return response.candidate
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
      throw remoteError(response.code, response.message, true, response.failure)
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
    readonly providerInstallationId: ProviderInstallationId
    readonly expectedInstallationRevision: ProviderInstallationRevision
    readonly rootPath: string
    readonly providerThreadId?: RemoteCodexProviderIdentity
    readonly signal?: AbortSignal
    readonly heartbeatIntervalMs?: number
    readonly heartbeatTimeoutMs?: number
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
      providerInstallationId: options.providerInstallationId,
      expectedInstallationRevision: options.expectedInstallationRevision,
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
        timeoutMs: machineTransportLimits.providerSessionOpenTimeoutMs,
      },
    )
    if (response.type === 'machine.error') {
      throw remoteError(response.code, response.message, true, response.failure)
    }
    if (
      response.requestId !== requestId ||
      response.machineId !== this.machine.machineId ||
      response.nodeId !== this.machine.nodeId ||
      response.conversationId !== options.conversationId ||
      response.providerInstallationId !== options.providerInstallationId ||
      response.installationRevision !== options.expectedInstallationRevision ||
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
    return new RemoteCodexSession(this.#connection, this.machine, response, {
      ...(options.heartbeatIntervalMs === undefined
        ? {}
        : { intervalMs: options.heartbeatIntervalMs }),
      ...(options.heartbeatTimeoutMs === undefined
        ? {}
        : { timeoutMs: options.heartbeatTimeoutMs }),
    })
  }

  async openClaudeSession(
    options: {
      readonly conversationId: MachineTransportConversationId
      readonly projectId: MachineTransportProjectId
      readonly providerInstallationId: ProviderInstallationId
      readonly expectedInstallationRevision: ProviderInstallationRevision
      readonly rootPath: string
      readonly effort?: RemoteClaudeEffort
      readonly signal?: AbortSignal
      readonly heartbeatIntervalMs?: number
      readonly heartbeatTimeoutMs?: number
    } & RemoteClaudeSessionIdentityOptions,
  ): Promise<RemoteClaudeSession> {
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
      type: 'claude.session.open',
      protocolVersion: machineProtocolVersion,
      requestId,
      expectedMachineId: this.machine.machineId,
      expectedNodeId: this.machine.nodeId,
      conversationId: options.conversationId,
      projectId: options.projectId,
      providerInstallationId: options.providerInstallationId,
      expectedInstallationRevision: options.expectedInstallationRevision,
      rootPath: rootPath.data,
      ...(options.providerSessionId === undefined
        ? {}
        : {
            providerSessionId: options.providerSessionId,
            providerSessionMaterialized: options.providerSessionMaterialized,
          }),
      ...(options.effort === undefined ? {} : { effort: options.effort }),
    })
    const response = await receiveCompatibleMachineMessage(
      this.#connection,
      z.union([ClaudeSessionReadyMessageSchema, MachineErrorMessageSchema]),
      {
        signal: options.signal,
        timeoutMs: machineTransportLimits.providerSessionOpenTimeoutMs,
      },
    )
    if (response.type === 'machine.error') {
      throw remoteError(response.code, response.message, true, response.failure)
    }
    if (
      response.requestId !== requestId ||
      response.machineId !== this.machine.machineId ||
      response.nodeId !== this.machine.nodeId ||
      response.conversationId !== options.conversationId ||
      response.providerInstallationId !== options.providerInstallationId ||
      response.installationRevision !== options.expectedInstallationRevision ||
      (options.providerSessionId !== undefined &&
        response.providerSessionId !== options.providerSessionId) ||
      response.resumed !==
        (options.providerSessionId !== undefined &&
          options.providerSessionMaterialized) ||
      response.effort !== options.effort
    ) {
      this.#connection.destroy()
      throw new MachineTransportError(
        'identity_mismatch',
        'Remote Claude session did not match the trusted Conversation',
        { peerAuthenticated: true },
      )
    }
    this.#dedicated = true
    return new RemoteClaudeSession(this.#connection, this.machine, response, {
      ...(options.heartbeatIntervalMs === undefined
        ? {}
        : { intervalMs: options.heartbeatIntervalMs }),
      ...(options.heartbeatTimeoutMs === undefined
        ? {}
        : { timeoutMs: options.heartbeatTimeoutMs }),
    })
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

  #assertProviderSessionResponse(
    response:
      ProviderSessionsDiscoveredMessage | ProviderSessionValidatedMessage,
    requestId: string,
    provider: AgentProvider,
    installationId: ProviderInstallationId,
    revision: ProviderInstallationRevision,
  ): void {
    if (
      response.requestId !== requestId ||
      response.machineId !== this.machine.machineId ||
      response.nodeId !== this.machine.nodeId ||
      response.provider !== provider ||
      response.providerInstallationId !== installationId ||
      response.installationRevision !== revision
    ) {
      this.#connection.destroy()
      throw new MachineTransportError(
        'identity_mismatch',
        'Provider session discovery did not match the trusted Machine',
        { peerAuthenticated: true },
      )
    }
  }
}

export interface RemoteProviderSessionDiscoveryPage {
  readonly provider: AgentProvider
  readonly providerInstallationId: ProviderInstallationId
  readonly installationRevision: ProviderInstallationRevision
  readonly status: 'supported' | 'unsupported' | 'unavailable'
  readonly resumeStatus: 'supported' | 'unsupported' | 'unavailable'
  readonly providerVersion?: string
  readonly candidates: readonly PrivateProviderSessionCandidate[]
  readonly nextCursor?: string
  readonly failureReason?:
    | 'provider_session_discovery_unavailable'
    | 'provider_session_format_unsupported'
    | 'provider_session_store_unreadable'
    | 'machine_offline'
  readonly metrics: ProviderSessionsDiscoveredMessage['metrics']
}

export interface StartRemoteCodexTurnOptions {
  readonly actionId: MachineTransportActionId
  readonly turnId: MachineTransportTurnId
  readonly prompt: RemoteCodexPrompt
  readonly signal?: AbortSignal
}

interface ExecutionHeartbeatBounds {
  readonly intervalMs?: number
  readonly timeoutMs?: number
}

export class RemoteCodexSession {
  readonly machine: RemoteMachineMetadata
  readonly conversationId: MachineTransportConversationId
  readonly providerThreadId: RemoteCodexProviderIdentity
  readonly providerInstallationId: ProviderInstallationId
  readonly installationRevision: ProviderInstallationRevision
  readonly resumed: boolean
  readonly executionProfile = 'codex-text-v1' as const
  readonly #connection: FramedMachineConnection
  readonly #heartbeat: Required<ExecutionHeartbeatBounds>
  #activeTurn: RemoteCodexTurn | undefined
  #closed = false

  constructor(
    connection: FramedMachineConnection,
    machine: RemoteMachineMetadata,
    ready: z.infer<typeof CodexSessionReadyMessageSchema>,
    heartbeat: ExecutionHeartbeatBounds = {},
  ) {
    this.#connection = connection
    this.machine = machine
    this.conversationId = ready.conversationId
    this.providerThreadId = ready.providerThreadId
    this.providerInstallationId = ready.providerInstallationId
    this.installationRevision = ready.installationRevision
    this.resumed = ready.resumed
    this.#heartbeat = executionHeartbeatBounds(heartbeat)
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
    let definitiveMachineError = false
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
        definitiveMachineError = true
        throw remoteError(
          response.code,
          response.message,
          true,
          response.failure,
        )
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
        this.#heartbeat,
      )
      this.#activeTurn = turn
      return turn
    } catch (error) {
      // Once this dedicated connection attempts the start write, only a
      // structured authenticated machine.error can prove a terminal rejection.
      // A dropped/malformed acknowledgement (or a write whose delivery cannot
      // be proven) leaves Prompt ownership ambiguous even if the Machine's
      // separate coordinator connection remains online.
      this.#failClosed()
      if (definitiveMachineError) throw error
      throw uncertainTurnStart('Codex', error)
    }
  }

  async close(signal?: AbortSignal): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    if (this.#connection.closed) return
    if (this.#activeTurn !== undefined) {
      this.#failClosed()
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
        throw remoteError(
          response.code,
          response.message,
          true,
          response.failure,
        )
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
    this.#activeTurn?.transportClosed()
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
  readonly #heartbeat: ExecutionHeartbeat
  #nextSequence = 1
  #terminal = false

  constructor(
    connection: FramedMachineConnection,
    started: z.infer<typeof CodexTurnStartedMessageSchema>,
    release: () => void,
    failClosed: () => void,
    heartbeat: Required<ExecutionHeartbeatBounds>,
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
    this.#heartbeat = new ExecutionHeartbeat({
      ...heartbeat,
      send: async (requestId) =>
        await this.#connection.send(
          {
            type: 'codex.session.heartbeat',
            protocolVersion: machineProtocolVersion,
            requestId,
            conversationId: this.conversationId,
            providerThreadId: this.providerThreadId,
          },
          { timeoutMs: heartbeat.timeoutMs },
        ),
      onLost: this.#failClosed,
    })
    this.#heartbeat.start()
  }

  async nextEvent(signal?: AbortSignal): Promise<CodexTurnEventMessage> {
    if (this.#terminal) {
      throw new MachineTransportError(
        'provider_session_lost',
        'Remote Codex Turn is already terminal',
        { peerAuthenticated: true },
      )
    }
    try {
      while (true) {
        const response = await receiveCompatibleMachineMessage(
          this.#connection,
          z.union([
            CodexTurnEventMessageSchema,
            CodexSessionHeartbeatAckMessageSchema,
            MachineErrorMessageSchema,
          ]),
          {
            signal,
            timeoutMs: null,
          },
        )
        if (response.type === 'machine.error') {
          throw remoteError(
            response.code,
            response.message,
            true,
            response.failure,
          )
        }
        if (response.type === 'codex.session.heartbeat.ack') {
          if (
            response.machineId !== this.#startedMachineId ||
            response.nodeId !== this.#startedNodeId ||
            response.conversationId !== this.conversationId ||
            response.providerThreadId !== this.providerThreadId ||
            !this.#heartbeat.acknowledge(response.requestId)
          ) {
            throw identityMismatch(
              'Remote Codex heartbeat identity was invalid',
            )
          }
          continue
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
          throw identityMismatch(
            'Remote Codex event correlation or sequence was invalid',
          )
        }
        this.#nextSequence += 1
        if (
          response.event.type === 'turn.completed' ||
          response.event.type === 'turn.failed'
        ) {
          this.#terminal = true
          this.#heartbeat.close()
          this.#release()
        }
        return response
      }
    } catch (error) {
      this.#heartbeat.close()
      this.#failClosed()
      throw error
    }
  }

  async *events(signal?: AbortSignal): AsyncGenerator<CodexTurnEventMessage> {
    try {
      while (!this.#terminal) yield await this.nextEvent(signal)
    } finally {
      if (!this.#terminal) this.#failClosed()
    }
  }

  transportClosed(): void {
    this.#heartbeat.close()
    this.#release()
  }

  get #startedMachineId(): string {
    return this.#started.machineId
  }

  get #startedNodeId(): string {
    return this.#started.nodeId
  }
}

export type RemoteCodexTurnEvent = CodexTurnEventMessage

export interface StartRemoteClaudeTurnOptions {
  readonly actionId: MachineTransportActionId
  readonly turnId: MachineTransportTurnId
  readonly prompt: RemoteClaudePrompt
  readonly signal?: AbortSignal
}

export class RemoteClaudeSession {
  readonly machine: RemoteMachineMetadata
  readonly conversationId: MachineTransportConversationId
  readonly providerSessionId: RemoteClaudeProviderIdentity
  readonly providerInstallationId: ProviderInstallationId
  readonly installationRevision: ProviderInstallationRevision
  readonly resumed: boolean
  readonly effort?: RemoteClaudeEffort
  readonly executionProfile = 'claude-restricted-read-search-v1' as const
  readonly #connection: FramedMachineConnection
  readonly #heartbeat: Required<ExecutionHeartbeatBounds>
  #activeTurn: RemoteClaudeTurn | undefined
  #closed = false

  constructor(
    connection: FramedMachineConnection,
    machine: RemoteMachineMetadata,
    ready: z.infer<typeof ClaudeSessionReadyMessageSchema>,
    heartbeat: ExecutionHeartbeatBounds = {},
  ) {
    this.#connection = connection
    this.machine = machine
    this.conversationId = ready.conversationId
    this.providerSessionId = ready.providerSessionId
    this.providerInstallationId = ready.providerInstallationId
    this.installationRevision = ready.installationRevision
    this.resumed = ready.resumed
    this.effort = ready.effort
    this.#heartbeat = executionHeartbeatBounds(heartbeat)
  }

  get closed(): boolean {
    return this.#closed || this.#connection.closed
  }

  async startTurn(
    options: StartRemoteClaudeTurnOptions,
  ): Promise<RemoteClaudeTurn> {
    if (this.closed) {
      this.#closed = true
      throw new MachineTransportError(
        'provider_session_lost',
        'Remote Claude session is closed',
        { peerAuthenticated: true },
      )
    }
    if (this.#activeTurn !== undefined) {
      throw new MachineTransportError(
        'conversation_busy',
        'Remote Claude Conversation already has an active Turn',
        { peerAuthenticated: true },
      )
    }
    options.signal?.throwIfAborted()
    let definitiveMachineError = false
    try {
      await this.#connection.send({
        type: 'claude.turn.start',
        protocolVersion: machineProtocolVersion,
        actionId: options.actionId,
        conversationId: this.conversationId,
        turnId: options.turnId,
        providerSessionId: this.providerSessionId,
        prompt: options.prompt,
      })
      const response = await receiveCompatibleMachineMessage(
        this.#connection,
        z.union([ClaudeTurnStartedMessageSchema, MachineErrorMessageSchema]),
        {
          signal: options.signal,
          timeoutMs: machineTransportLimits.messageTimeoutMs,
        },
      )
      if (response.type === 'machine.error') {
        definitiveMachineError = true
        throw remoteError(
          response.code,
          response.message,
          true,
          response.failure,
        )
      }
      if (
        response.machineId !== this.machine.machineId ||
        response.nodeId !== this.machine.nodeId ||
        response.actionId !== options.actionId ||
        response.conversationId !== this.conversationId ||
        response.turnId !== options.turnId ||
        response.providerSessionId !== this.providerSessionId
      ) {
        throw new MachineTransportError(
          'identity_mismatch',
          'Remote Claude Turn did not match the bound Conversation',
          { peerAuthenticated: true },
        )
      }
      const turn = new RemoteClaudeTurn(
        this.#connection,
        response,
        () => {
          if (this.#activeTurn === turn) this.#activeTurn = undefined
        },
        () => this.#failClosed(),
        this.#heartbeat,
      )
      this.#activeTurn = turn
      return turn
    } catch (error) {
      // The dedicated execution acknowledgement is independent of the Machine
      // coordinator connection. Without an authenticated machine.error, any
      // post-write failure is ownership-uncertain and never replay-safe.
      this.#failClosed()
      if (definitiveMachineError) throw error
      throw uncertainTurnStart('Claude Code', error)
    }
  }

  async close(signal?: AbortSignal): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    if (this.#connection.closed) return
    if (this.#activeTurn !== undefined) {
      this.#failClosed()
      return
    }
    const requestId = newMachineNonce()
    try {
      await this.#connection.send({
        type: 'claude.session.dispose',
        protocolVersion: machineProtocolVersion,
        requestId,
        conversationId: this.conversationId,
        providerSessionId: this.providerSessionId,
      })
      const response = await receiveCompatibleMachineMessage(
        this.#connection,
        z.union([
          ClaudeSessionDisposedMessageSchema,
          MachineErrorMessageSchema,
        ]),
        { signal },
      )
      if (response.type === 'machine.error') {
        throw remoteError(
          response.code,
          response.message,
          true,
          response.failure,
        )
      }
      if (
        response.requestId !== requestId ||
        response.machineId !== this.machine.machineId ||
        response.nodeId !== this.machine.nodeId ||
        response.conversationId !== this.conversationId
      ) {
        throw new MachineTransportError(
          'identity_mismatch',
          'Remote Claude disposal receipt did not match the session',
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
    this.#activeTurn?.transportClosed()
    this.#connection.destroy()
  }
}

function uncertainTurnStart(
  provider: 'Codex' | 'Claude Code',
  cause: unknown,
): MachineTransportError {
  return new MachineTransportError(
    'remote_execution_lost',
    `Remote ${provider} Turn ownership could not be confirmed`,
    {
      cause,
      peerAuthenticated: true,
      failureReason: 'execution_ownership_uncertain',
    },
  )
}

export class RemoteClaudeTurn {
  readonly actionId: MachineTransportActionId
  readonly conversationId: MachineTransportConversationId
  readonly turnId: MachineTransportTurnId
  readonly providerSessionId: RemoteClaudeProviderIdentity
  readonly providerTurnId: RemoteClaudeProviderIdentity
  readonly #connection: FramedMachineConnection
  readonly #release: () => void
  readonly #failClosed: () => void
  readonly #started: z.infer<typeof ClaudeTurnStartedMessageSchema>
  readonly #heartbeat: ExecutionHeartbeat
  #nextSequence = 1
  #terminal = false

  constructor(
    connection: FramedMachineConnection,
    started: z.infer<typeof ClaudeTurnStartedMessageSchema>,
    release: () => void,
    failClosed: () => void,
    heartbeat: Required<ExecutionHeartbeatBounds>,
  ) {
    this.#connection = connection
    this.#started = started
    this.actionId = started.actionId
    this.conversationId = started.conversationId
    this.turnId = started.turnId
    this.providerSessionId = started.providerSessionId
    this.providerTurnId = started.providerTurnId
    this.#release = release
    this.#failClosed = failClosed
    this.#heartbeat = new ExecutionHeartbeat({
      ...heartbeat,
      send: async (requestId) =>
        await this.#connection.send(
          {
            type: 'claude.session.heartbeat',
            protocolVersion: machineProtocolVersion,
            requestId,
            conversationId: this.conversationId,
            providerSessionId: this.providerSessionId,
          },
          { timeoutMs: heartbeat.timeoutMs },
        ),
      onLost: this.#failClosed,
    })
    this.#heartbeat.start()
  }

  async nextEvent(signal?: AbortSignal): Promise<ClaudeTurnEventMessage> {
    if (this.#terminal) {
      throw new MachineTransportError(
        'provider_session_lost',
        'Remote Claude Turn is already terminal',
        { peerAuthenticated: true },
      )
    }
    try {
      while (true) {
        const response = await receiveCompatibleMachineMessage(
          this.#connection,
          z.union([
            ClaudeTurnEventMessageSchema,
            ClaudeSessionHeartbeatAckMessageSchema,
            MachineErrorMessageSchema,
          ]),
          {
            signal,
            timeoutMs: null,
          },
        )
        if (response.type === 'machine.error') {
          throw remoteError(
            response.code,
            response.message,
            true,
            response.failure,
          )
        }
        if (response.type === 'claude.session.heartbeat.ack') {
          if (
            response.machineId !== this.#started.machineId ||
            response.nodeId !== this.#started.nodeId ||
            response.conversationId !== this.conversationId ||
            response.providerSessionId !== this.providerSessionId ||
            !this.#heartbeat.acknowledge(response.requestId)
          ) {
            throw identityMismatch(
              'Remote Claude heartbeat identity was invalid',
            )
          }
          continue
        }
        if (
          response.machineId !== this.#started.machineId ||
          response.nodeId !== this.#started.nodeId ||
          response.actionId !== this.actionId ||
          response.conversationId !== this.conversationId ||
          response.turnId !== this.turnId ||
          response.providerSessionId !== this.providerSessionId ||
          response.providerTurnId !== this.providerTurnId ||
          response.sequence !== this.#nextSequence
        ) {
          throw identityMismatch(
            'Remote Claude event correlation or sequence was invalid',
          )
        }
        this.#nextSequence += 1
        if (
          response.event.type === 'turn.completed' ||
          response.event.type === 'turn.failed'
        ) {
          this.#terminal = true
          this.#heartbeat.close()
          this.#release()
        }
        return response
      }
    } catch (error) {
      this.#heartbeat.close()
      this.#failClosed()
      throw error
    }
  }

  async *events(signal?: AbortSignal): AsyncGenerator<ClaudeTurnEventMessage> {
    try {
      while (!this.#terminal) yield await this.nextEvent(signal)
    } finally {
      if (!this.#terminal) this.#failClosed()
    }
  }

  transportClosed(): void {
    this.#heartbeat.close()
    this.#release()
  }
}

export type RemoteClaudeTurnEvent = ClaudeTurnEventMessage

class ExecutionHeartbeat {
  readonly #intervalMs: number
  readonly #timeoutMs: number
  readonly #send: (requestId: string) => Promise<void>
  readonly #onLost: () => void
  #scheduleTimer: ReturnType<typeof setTimeout> | undefined
  #acknowledgementTimer: ReturnType<typeof setTimeout> | undefined
  #requestId: string | undefined
  #closed = false

  constructor(options: {
    readonly intervalMs: number
    readonly timeoutMs: number
    readonly send: (requestId: string) => Promise<void>
    readonly onLost: () => void
  }) {
    this.#intervalMs = options.intervalMs
    this.#timeoutMs = options.timeoutMs
    this.#send = options.send
    this.#onLost = options.onLost
  }

  start(): void {
    if (this.#closed || this.#scheduleTimer !== undefined) return
    this.#scheduleTimer = setTimeout(() => {
      this.#scheduleTimer = undefined
      void this.#sendHeartbeat()
    }, this.#intervalMs)
    this.#scheduleTimer.unref?.()
  }

  acknowledge(requestId: string): boolean {
    if (this.#closed || this.#requestId !== requestId) return false
    this.#requestId = undefined
    if (this.#acknowledgementTimer !== undefined) {
      clearTimeout(this.#acknowledgementTimer)
      this.#acknowledgementTimer = undefined
    }
    this.start()
    return true
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    if (this.#scheduleTimer !== undefined) clearTimeout(this.#scheduleTimer)
    if (this.#acknowledgementTimer !== undefined) {
      clearTimeout(this.#acknowledgementTimer)
    }
    this.#scheduleTimer = undefined
    this.#acknowledgementTimer = undefined
    this.#requestId = undefined
  }

  async #sendHeartbeat(): Promise<void> {
    if (this.#closed) return
    const requestId = newMachineNonce()
    this.#requestId = requestId
    this.#acknowledgementTimer = setTimeout(() => this.#lose(), this.#timeoutMs)
    this.#acknowledgementTimer.unref?.()
    try {
      await this.#send(requestId)
    } catch {
      this.#lose()
    }
  }

  #lose(): void {
    if (this.#closed) return
    this.close()
    this.#onLost()
  }
}

function executionHeartbeatBounds(
  options: ExecutionHeartbeatBounds,
): Required<ExecutionHeartbeatBounds> {
  const intervalMs =
    options.intervalMs ??
    machineTransportLimits.remoteExecutionHeartbeatIntervalMs
  const timeoutMs =
    options.timeoutMs ??
    machineTransportLimits.remoteExecutionHeartbeatTimeoutMs
  if (
    !Number.isSafeInteger(intervalMs) ||
    intervalMs <= 0 ||
    intervalMs > machineTransportLimits.remoteExecutionHeartbeatIntervalMs ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > machineTransportLimits.remoteExecutionHeartbeatTimeoutMs
  ) {
    throw new TypeError('Remote execution heartbeat bounds are invalid')
  }
  return { intervalMs, timeoutMs }
}

function identityMismatch(message: string): MachineTransportError {
  return new MachineTransportError('identity_mismatch', message, {
    peerAuthenticated: true,
  })
}

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
  options: {
    readonly timeoutMs?: number | null
    readonly signal?: AbortSignal
  } = {},
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
  failure?: CanonicalFailure,
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
  return new MachineTransportError(mapped, message, {
    peerAuthenticated,
    failure,
  })
}

function authenticatedOperationError(error: unknown): MachineTransportError {
  if (error instanceof MachineTransportError) {
    if (error.peerAuthenticated) return error
    return new MachineTransportError(error.code, error.message, {
      cause: error,
      peerAuthenticated: true,
      failureReason: error.failureReason,
      failure: error.failure,
    })
  }
  return new MachineTransportError(
    'connection_failed',
    'Authenticated Machine operation failed',
    { cause: error, peerAuthenticated: true },
  )
}

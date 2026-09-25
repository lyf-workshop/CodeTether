import { randomBytes, randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { createServer, type Server, type TLSSocket } from 'node:tls'

import { FramedMachineConnection } from '@codetether/machine-transport'

import {
  supervisorProtocolVersion,
  supervisorTransportLimits,
} from './constants.js'
import {
  canonicalJsonBytes,
  supervisorGrantDigest,
  verifySupervisorDescriptor,
  verifySupervisorGrant,
} from './crypto.js'
import {
  signedSupervisorGrantSchema,
  signedSupervisorTransportDescriptorSchema,
  supervisorAuthenticatedSchema,
  supervisorClientAuthenticateSchema,
  supervisorRequestSchema,
  supervisorTransportDescriptorPayloadSchema,
  type SignedSupervisorGrant,
  type SignedSupervisorTransportDescriptor,
  type SupervisorChallenge,
  type SupervisorPublicJwk,
  type SupervisorRequest,
} from './protocol.js'
import {
  generateSupervisorTlsIdentity,
  acceptSupervisorTlsOverStream,
  supervisorTlsExporter,
  supervisorTlsServerOptions,
  type SupervisorTlsIdentity,
} from './tls.js'

export interface SupervisorAdmissionResult {
  readonly hostId: string
  readonly hostIdentityGeneration: number
  readonly deviceId: string
  readonly deviceKeyGeneration: number
  readonly authorizationId: string
  readonly authorizationExpiresAt: string
}

export interface SupervisorHostReadSurface {
  readHostBootstrap(): unknown | Promise<unknown>
  listMachines(): unknown | Promise<unknown>
  getMachine(machineId: string): unknown | Promise<unknown>
  listProjects(
    machineId: string,
    page: { readonly limit: number; readonly cursor?: string },
  ): unknown | Promise<unknown>
  getProject(machineId: string, projectId: string): unknown | Promise<unknown>
  listConversations(
    machineId: string,
    projectId: string,
    page: { readonly limit: number; readonly cursor?: string },
  ): unknown | Promise<unknown>
  getConversation(
    machineId: string,
    projectId: string,
    conversationId: string,
  ): unknown | Promise<unknown>
  readConversationHistory(
    machineId: string,
    projectId: string,
    conversationId: string,
    page: { readonly limit: number; readonly cursor?: string },
  ): unknown | Promise<unknown>
  readConversationLive(
    machineId: string,
    projectId: string,
    conversationId: string,
    query: {
      readonly cursor: string
      readonly limit: number
      readonly waitMs: number
    },
  ): unknown | Promise<unknown>
  getAction(actionId: string): unknown | Promise<unknown>
}

export interface SupervisorHostControlSurface {
  startConversationTurn(input: {
    readonly actionId: string
    readonly machineId: string
    readonly projectId: string
    readonly conversationId: string
    readonly input: { readonly type: 'text'; readonly text: string }
  }): unknown | Promise<unknown>
  createConversation(input: {
    readonly actionId: string
    readonly machineId: string
    readonly projectId: string
    readonly provider: 'codex' | 'claude-code'
    readonly input: { readonly type: 'text'; readonly text: string }
    readonly model?: string
    readonly reasoning?: string
  }): unknown | Promise<unknown>
}

export interface SupervisorServerActivation {
  readonly hostPublicJwk: SupervisorPublicJwk
  readonly grant: SignedSupervisorGrant
  readonly descriptor: SignedSupervisorTransportDescriptor
}

export interface SupervisorServerOptions {
  readonly host?: string
  readonly port?: number
  readonly tlsIdentity?: SupervisorTlsIdentity
  readonly now?: () => Date
  readonly authorize: (input: {
    readonly accessToken: string
    readonly deviceProof: string
    readonly challenge: SupervisorChallenge
    readonly challengeBody: Uint8Array
    readonly controlPlaneOrigin: string
  }) => Promise<SupervisorAdmissionResult>
  readonly reads: SupervisorHostReadSurface
  readonly control?: SupervisorHostControlSurface
  readonly authorizeControl?: (
    authorizationId: string,
  ) => boolean | Promise<boolean>
  readonly onDiagnostic?: (
    event: string,
    fields: Readonly<Record<string, string | number | boolean>>,
  ) => void
}

export class SupervisorServer {
  readonly tlsIdentity: SupervisorTlsIdentity
  readonly #server: Server
  readonly #options: SupervisorServerOptions
  readonly #now: () => Date
  readonly #sockets = new Set<TLSSocket>()
  #activation: SupervisorServerActivation | undefined
  #address: AddressInfo | undefined
  #closing = false

  private constructor(
    options: SupervisorServerOptions,
    tlsIdentity: SupervisorTlsIdentity,
  ) {
    this.#options = options
    this.#now = options.now ?? (() => new Date())
    this.tlsIdentity = tlsIdentity
    this.#server = createServer(
      supervisorTlsServerOptions(tlsIdentity),
      (socket) => void this.#handle(socket, 'direct'),
    )
    this.#server.on('connection', (socket) => {
      const tls = socket as TLSSocket
      this.#sockets.add(tls)
      tls.once('close', () => this.#sockets.delete(tls))
    })
  }

  static async create(
    options: SupervisorServerOptions,
  ): Promise<SupervisorServer> {
    const tlsIdentity =
      options.tlsIdentity ??
      (await generateSupervisorTlsIdentity('CodeTether Supervisor Host'))
    return new SupervisorServer(options, tlsIdentity)
  }

  get address(): AddressInfo | undefined {
    return this.#address
  }

  get activation(): SupervisorServerActivation | undefined {
    return this.#activation
  }

  async start(): Promise<AddressInfo> {
    if (this.#address !== undefined) return this.#address
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.#server.off('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        this.#server.off('error', onError)
        resolve()
      }
      this.#server.once('error', onError)
      this.#server.once('listening', onListening)
      this.#server.listen(
        this.#options.port ?? 0,
        this.#options.host ?? '0.0.0.0',
      )
    })
    const address = this.#server.address()
    if (typeof address !== 'object' || address === null) {
      throw new Error('Supervisor server did not expose a TCP address')
    }
    this.#address = address
    return address
  }

  async activate(untrusted: SupervisorServerActivation): Promise<void> {
    const grant = signedSupervisorGrantSchema.parse(untrusted.grant)
    const descriptor = signedSupervisorTransportDescriptorSchema.parse(
      untrusted.descriptor,
    )
    const publicJwk = untrusted.hostPublicJwk
    await Promise.all([
      verifySupervisorGrant(grant, publicJwk),
      verifySupervisorDescriptor(descriptor, publicJwk),
    ])
    const payload = descriptor.payload
    if (
      payload.authorizationId !== grant.payload.authorizationId ||
      payload.hostId !== grant.payload.hostId ||
      payload.hostFingerprint !== grant.payload.hostFingerprint ||
      payload.hostIdentityGeneration !== grant.payload.hostIdentityGeneration ||
      payload.deviceId !== grant.payload.deviceId ||
      payload.deviceKeyGeneration !== grant.payload.deviceKeyGeneration ||
      payload.grantDigest !== supervisorGrantDigest(grant) ||
      payload.transportTlsFingerprint !==
        this.tlsIdentity.publicKeyFingerprint ||
      payload.exp * 1_000 <= this.#now().getTime()
    ) {
      throw new Error('Supervisor activation binding is inconsistent')
    }
    this.#activation = { hostPublicJwk: publicJwk, grant, descriptor }
    this.#options.onDiagnostic?.('supervisor.transport.activated', {
      hostId: payload.hostId,
      deviceId: payload.deviceId,
      authorizationId: payload.authorizationId,
    })
  }

  async acceptRelayStream(stream: Duplex, signal?: AbortSignal): Promise<void> {
    if (this.#closing || this.#activation === undefined) {
      stream.destroy()
      return
    }
    const tls = await acceptSupervisorTlsOverStream({
      stream,
      identity: this.tlsIdentity,
      signal,
      timeoutMs: supervisorTransportLimits.handshakeTimeoutMs,
    })
    this.#sockets.add(tls.socket)
    tls.socket.once('close', () => this.#sockets.delete(tls.socket))
    await this.#handle(tls.socket, 'relay')
  }

  async close(): Promise<void> {
    if (this.#closing) return
    this.#closing = true
    for (const socket of this.#sockets) socket.destroy()
    await new Promise<void>((resolve, reject) => {
      this.#server.close((error) => (error ? reject(error) : resolve()))
    }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
        throw error
      }
    })
  }

  async #handle(
    socket: TLSSocket,
    transport: 'direct' | 'relay',
  ): Promise<void> {
    const activation = this.#activation
    if (this.#closing || activation === undefined) {
      socket.destroy()
      return
    }
    const connection = new FramedMachineConnection(socket)
    let established = false
    try {
      const now = this.#now()
      const descriptor = supervisorTransportDescriptorPayloadSchema.parse(
        activation.descriptor.payload,
      )
      if (descriptor.exp * 1_000 <= now.getTime()) {
        throw new SupervisorRejection('authorization_revoked')
      }
      const challenge: SupervisorChallenge = {
        type: 'supervisor.challenge',
        protocolVersion: supervisorProtocolVersion,
        audience: 'codetether-host-supervisor',
        sessionId: `ssn_${randomUUID().replaceAll('-', '')}`,
        authorizationId: descriptor.authorizationId,
        hostId: descriptor.hostId,
        hostIdentityGeneration: descriptor.hostIdentityGeneration,
        deviceId: descriptor.deviceId,
        deviceKeyGeneration: descriptor.deviceKeyGeneration,
        tlsExporter: supervisorTlsExporter(socket),
        nonce: randomBytes(32).toString('base64url'),
        issuedAt: now.toISOString(),
        expiresAt: new Date(
          now.getTime() + supervisorTransportLimits.handshakeTimeoutMs,
        ).toISOString(),
      }
      await connection.send(challenge)
      const authenticate = await connection.receive(
        supervisorClientAuthenticateSchema,
        { timeoutMs: supervisorTransportLimits.handshakeTimeoutMs },
      )
      if (this.#now().getTime() >= Date.parse(challenge.expiresAt)) {
        throw new SupervisorRejection('proof_expired')
      }
      const challengeBody = canonicalJsonBytes(challenge)
      const admission = await this.#options.authorize({
        accessToken: authenticate.accessToken,
        deviceProof: authenticate.deviceProof,
        challenge,
        challengeBody,
        controlPlaneOrigin: descriptor.controlPlaneOrigin,
      })
      if (
        admission.hostId !== challenge.hostId ||
        admission.hostIdentityGeneration !== challenge.hostIdentityGeneration ||
        admission.deviceId !== challenge.deviceId ||
        admission.deviceKeyGeneration !== challenge.deviceKeyGeneration ||
        admission.authorizationId !== challenge.authorizationId
      ) {
        throw new SupervisorRejection('authentication_failed')
      }
      const sessionExpiresAt = new Date(
        Math.min(
          this.#now().getTime() + supervisorTransportLimits.sessionLifetimeMs,
          Date.parse(admission.authorizationExpiresAt),
          descriptor.exp * 1_000,
        ),
      )
      const controlAuthorized =
        this.#options.control !== undefined &&
        (await this.#options.authorizeControl?.(challenge.authorizationId))
      const authenticated = supervisorAuthenticatedSchema.parse({
        type: 'supervisor.authenticated',
        protocolVersion: supervisorProtocolVersion,
        sessionId: challenge.sessionId,
        hostId: challenge.hostId,
        deviceId: challenge.deviceId,
        authorizationId: challenge.authorizationId,
        control: controlAuthorized ? 'control' : 'read',
        expiresAt: sessionExpiresAt.toISOString(),
      })
      await connection.send(authenticated)
      established = true
      this.#options.onDiagnostic?.('supervisor.session.established', {
        hostId: challenge.hostId,
        deviceId: challenge.deviceId,
        authorizationId: challenge.authorizationId,
        transport,
      })
      while (!connection.closed) {
        const request = await connection.receive(supervisorRequestSchema, {
          timeoutMs: null,
        })
        if (this.#now() >= sessionExpiresAt) {
          await connection.send({
            type: 'supervisor.response',
            protocolVersion: supervisorProtocolVersion,
            requestId: request.requestId,
            ok: false,
            code: 'session_expired',
          })
          break
        }
        await this.#respond(connection, request, transport)
      }
    } catch (error) {
      const rejectionCode =
        error instanceof SupervisorRejection
          ? error.code
          : supervisorRejectionCode(error)
      if (!established && !connection.closed) {
        await connection
          .send({
            type: 'supervisor.rejected',
            protocolVersion: supervisorProtocolVersion,
            code: rejectionCode,
          })
          .catch(() => undefined)
      }
      this.#options.onDiagnostic?.(
        established
          ? 'supervisor.session.disconnected'
          : 'supervisor.session.rejected',
        { reason: established ? 'peer_disconnected' : rejectionCode },
      )
    } finally {
      connection.destroy()
    }
  }

  async #respond(
    connection: FramedMachineConnection,
    request: SupervisorRequest,
    transport: 'direct' | 'relay',
  ): Promise<void> {
    const startedAt = Date.now()
    try {
      if (
        isSupervisorControlOperation(request) &&
        (this.#options.control === undefined ||
          !(await this.#options.authorizeControl?.(
            this.#activation?.grant.payload.authorizationId ?? '',
          )))
      ) {
        throw new Error('operation_not_allowed')
      }
      let data: unknown
      switch (request.operation) {
        case 'host.bootstrap':
          data = await this.#options.reads.readHostBootstrap()
          break
        case 'machine.list':
          data = await this.#options.reads.listMachines()
          break
        case 'machine.get':
          data = await this.#options.reads.getMachine(request.machineId)
          break
        case 'project.list':
          data = await this.#options.reads.listProjects(request.machineId, {
            limit: request.limit,
            ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
          })
          break
        case 'project.get':
          data = await this.#options.reads.getProject(
            request.machineId,
            request.projectId,
          )
          break
        case 'conversation.list':
          data = await this.#options.reads.listConversations(
            request.machineId,
            request.projectId,
            {
              limit: request.limit,
              ...(request.cursor === undefined
                ? {}
                : { cursor: request.cursor }),
            },
          )
          break
        case 'conversation.get':
          data = await this.#options.reads.getConversation(
            request.machineId,
            request.projectId,
            request.conversationId,
          )
          break
        case 'conversation.history':
          data = await this.#options.reads.readConversationHistory(
            request.machineId,
            request.projectId,
            request.conversationId,
            {
              limit: request.limit,
              ...(request.cursor === undefined
                ? {}
                : { cursor: request.cursor }),
            },
          )
          break
        case 'conversation.live.read':
          data = await this.#options.reads.readConversationLive(
            request.machineId,
            request.projectId,
            request.conversationId,
            {
              cursor: request.cursor,
              limit: request.limit,
              waitMs: request.waitMs,
            },
          )
          break
        case 'action.get':
          data = await this.#options.reads.getAction(request.actionId)
          break
        case 'conversation.turn.start':
          if (this.#options.control === undefined) {
            throw new Error('operation_not_allowed')
          }
          data = await this.#options.control.startConversationTurn(request)
          break
        case 'conversation.create':
          if (this.#options.control === undefined) {
            throw new Error('operation_not_allowed')
          }
          data = await this.#options.control.createConversation(request)
          break
      }
      await connection.send({
        type: 'supervisor.response',
        protocolVersion: supervisorProtocolVersion,
        requestId: request.requestId,
        ok: true,
        data,
      })
      this.#options.onDiagnostic?.('supervisor.read', {
        operation: request.operation,
        transport,
        latencyMs: Date.now() - startedAt,
        ...supervisorReadRequestFields(request),
        ...supervisorReadResultFields(data),
      })
    } catch (error) {
      await connection.send({
        type: 'supervisor.response',
        protocolVersion: supervisorProtocolVersion,
        requestId: request.requestId,
        ok: false,
        code: supervisorReadErrorCode(error),
      })
    }
  }
}

function supervisorReadRequestFields(
  request: SupervisorRequest,
): Readonly<Record<string, string>> {
  switch (request.operation) {
    case 'host.bootstrap':
    case 'machine.list':
      return {}
    case 'machine.get':
    case 'project.list':
      return { machineId: request.machineId }
    case 'project.get':
    case 'conversation.list':
      return {
        machineId: request.machineId,
        projectId: request.projectId,
      }
    case 'conversation.get':
    case 'conversation.history':
    case 'conversation.live.read':
      return {
        machineId: request.machineId,
        projectId: request.projectId,
        conversationId: request.conversationId,
      }
    case 'action.get':
      return { actionId: request.actionId }
    case 'conversation.turn.start':
      return {
        machineId: request.machineId,
        projectId: request.projectId,
        conversationId: request.conversationId,
      }
    case 'conversation.create':
      return {
        machineId: request.machineId,
        projectId: request.projectId,
      }
  }
}

function isSupervisorControlOperation(
  request: SupervisorRequest,
): request is Extract<
  SupervisorRequest,
  { operation: 'conversation.turn.start' | 'conversation.create' }
> {
  return (
    request.operation === 'conversation.turn.start' ||
    request.operation === 'conversation.create'
  )
}

function supervisorReadResultFields(
  data: unknown,
): Readonly<Record<string, number | boolean>> {
  if (typeof data !== 'object' || data === null || Array.isArray(data))
    return {}
  const value = data as Record<string, unknown>
  const collection =
    Array.isArray(value.projects) || Array.isArray(value.conversations)
      ? (value.projects ?? value.conversations)
      : Array.isArray(value.machines)
        ? value.machines
        : undefined
  const transcriptEntries = remoteTranscriptEntryCount(value)
  return {
    ...(Array.isArray(collection) ? { resultCount: collection.length } : {}),
    ...(transcriptEntries === undefined
      ? {}
      : { resultCount: transcriptEntries }),
    ...(typeof value.hasMore === 'boolean' ? { hasMore: value.hasMore } : {}),
    ...(typeof value.hasMoreBefore === 'boolean'
      ? { hasMoreBefore: value.hasMoreBefore }
      : {}),
    ...(typeof value.historyComplete === 'boolean'
      ? { historyComplete: value.historyComplete }
      : {}),
    ...(Array.isArray(value.events)
      ? { resultCount: value.events.length }
      : {}),
    ...(typeof value.resetRequired === 'boolean'
      ? { resetRequired: value.resetRequired }
      : {}),
    ...(typeof value.active === 'boolean' ? { active: value.active } : {}),
    ...(typeof value.timedOut === 'boolean'
      ? { timedOut: value.timedOut }
      : {}),
  }
}

function remoteTranscriptEntryCount(
  value: Record<string, unknown>,
): number | undefined {
  if (value.source === 'native_provider') {
    const native = record(value.native)
    return native === undefined || !Array.isArray(native.entries)
      ? undefined
      : native.entries.length
  }
  if (value.source !== 'durable') return undefined
  const runtime = record(value.runtime)
  if (runtime === undefined || !Array.isArray(runtime.turns)) return undefined
  const messages = Array.isArray(runtime.messages) ? runtime.messages : []
  const tools = Array.isArray(runtime.tools) ? runtime.tools : []
  const changes = Array.isArray(runtime.changes) ? runtime.changes : []
  let count = 0
  for (const candidate of runtime.turns) {
    const turn = record(candidate)
    if (turn === undefined || typeof turn.turnId !== 'string') continue
    if (record(turn.input) !== undefined) count += 1
    const activities = [messages, tools, changes].reduce(
      (total, values) =>
        total +
        values.filter((entry) => record(entry)?.turnId === turn.turnId).length,
      0,
    )
    count += activities
    if (
      activities === 0 &&
      typeof turn.finalMessage === 'string' &&
      turn.finalMessage.length > 0
    ) {
      count += 1
    }
  }
  return count
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function supervisorReadErrorCode(
  error: unknown,
):
  | 'invalid_request'
  | 'operation_not_allowed'
  | 'not_found'
  | 'conflict'
  | 'unavailable'
  | 'internal' {
  if (!(error instanceof Error)) return 'internal'
  const publicCode = (error as Error & { readonly code?: unknown }).code
  const code = typeof publicCode === 'string' ? publicCode : error.message
  if (
    code === 'invalid_request' ||
    code === 'operation_not_allowed' ||
    code === 'not_found' ||
    code === 'conflict' ||
    code === 'unavailable'
  ) {
    return code
  }
  return 'internal'
}

class SupervisorRejection extends Error {
  constructor(
    readonly code:
      | 'authentication_failed'
      | 'authorization_revoked'
      | 'host_identity_mismatch'
      | 'proof_replayed'
      | 'proof_expired'
      | 'control_plane_unavailable',
  ) {
    super(code)
  }
}

function supervisorRejectionCode(error: unknown): SupervisorRejection['code'] {
  if (!(error instanceof Error)) return 'authentication_failed'
  if (
    error.message === 'authentication_failed' ||
    error.message === 'authorization_revoked' ||
    error.message === 'host_identity_mismatch' ||
    error.message === 'proof_replayed' ||
    error.message === 'proof_expired' ||
    error.message === 'control_plane_unavailable'
  ) {
    return error.message
  }
  return 'authentication_failed'
}

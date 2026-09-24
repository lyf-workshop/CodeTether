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
      const authenticated = supervisorAuthenticatedSchema.parse({
        type: 'supervisor.authenticated',
        protocolVersion: supervisorProtocolVersion,
        sessionId: challenge.sessionId,
        hostId: challenge.hostId,
        deviceId: challenge.deviceId,
        authorizationId: challenge.authorizationId,
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
        await this.#respond(connection, request)
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
  ): Promise<void> {
    try {
      const data =
        request.operation === 'host.bootstrap'
          ? await this.#options.reads.readHostBootstrap()
          : request.operation === 'machine.list'
            ? await this.#options.reads.listMachines()
            : await this.#options.reads.getMachine(request.machineId!)
      await connection.send({
        type: 'supervisor.response',
        protocolVersion: supervisorProtocolVersion,
        requestId: request.requestId,
        ok: true,
        data,
      })
      this.#options.onDiagnostic?.('supervisor.machine.read', {
        operation: request.operation,
      })
    } catch (error) {
      await connection.send({
        type: 'supervisor.response',
        protocolVersion: supervisorProtocolVersion,
        requestId: request.requestId,
        ok: false,
        code:
          error instanceof Error && error.message === 'not_found'
            ? 'not_found'
            : 'internal',
      })
    }
  }
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

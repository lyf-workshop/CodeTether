import { randomUUID } from 'node:crypto'
import type { Duplex } from 'node:stream'

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
  supervisorChallengeSchema,
  supervisorResponseSchema,
  supervisorServerHandshakeSchema,
  type SignedSupervisorGrant,
  type SignedSupervisorTransportDescriptor,
  type SupervisorChallenge,
  type SupervisorPublicJwk,
  type SupervisorResponse,
} from './protocol.js'
import {
  connectSupervisorTls,
  connectSupervisorTlsOverStream,
  generateSupervisorTlsIdentity,
  type SupervisorTlsIdentity,
} from './tls.js'

export interface ConnectSupervisorDirectOptions {
  readonly endpoint: { readonly host: string; readonly port: number }
  readonly expectedHost: {
    readonly hostId: string
    readonly fingerprint: string
    readonly identityGeneration: number
    readonly publicJwk: SupervisorPublicJwk
  }
  readonly expectedDevice: {
    readonly deviceId: string
    readonly keyGeneration: number
  }
  readonly grant: SignedSupervisorGrant
  readonly descriptor: SignedSupervisorTransportDescriptor
  readonly tlsIdentity?: SupervisorTlsIdentity
  readonly signal?: AbortSignal
  readonly now?: () => Date
}

export class PendingSupervisorConnection {
  readonly challenge: SupervisorChallenge
  readonly challengeBody: Uint8Array
  readonly admissionResource: string
  readonly transport: 'direct' | 'relay'
  readonly #connection: FramedMachineConnection
  readonly #onClose: (() => void) | undefined
  #transferred = false
  #closed = false

  constructor(
    connection: FramedMachineConnection,
    challenge: SupervisorChallenge,
    transport: 'direct' | 'relay' = 'direct',
    onClose?: () => void,
  ) {
    this.#connection = connection
    this.challenge = challenge
    this.challengeBody = canonicalJsonBytes(challenge)
    this.admissionResource = `/v1/hosts/${challenge.hostId}/supervisor-admission`
    this.transport = transport
    this.#onClose = onClose
  }

  async authenticate(input: {
    readonly accessToken: string
    readonly deviceProof: string
    readonly signal?: AbortSignal
  }): Promise<ConnectedSupervisorSession> {
    try {
      await this.#connection.send(
        {
          type: 'supervisor.authenticate',
          protocolVersion: supervisorProtocolVersion,
          accessToken: input.accessToken,
          deviceProof: input.deviceProof,
        },
        { signal: input.signal },
      )
      const response = await this.#connection.receive(
        supervisorServerHandshakeSchema,
        { signal: input.signal },
      )
      if (response.type !== 'supervisor.authenticated') {
        throw new SupervisorClientError(
          response.type === 'supervisor.rejected'
            ? response.code
            : 'protocol_error',
        )
      }
      if (
        response.sessionId !== this.challenge.sessionId ||
        response.hostId !== this.challenge.hostId ||
        response.deviceId !== this.challenge.deviceId ||
        response.authorizationId !== this.challenge.authorizationId
      ) {
        throw new SupervisorClientError('host_identity_mismatch')
      }
      this.#transferred = true
      return new ConnectedSupervisorSession(
        this.#connection,
        response.expiresAt,
        this.transport,
        this.#onClose,
      )
    } catch (error) {
      this.close()
      throw error
    }
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#connection.destroy()
    if (!this.#transferred) this.#onClose?.()
  }
}

export class ConnectedSupervisorSession {
  readonly transport: 'direct' | 'relay'
  readonly #connection: FramedMachineConnection
  readonly #onClose: (() => void) | undefined
  #closed = false

  constructor(
    connection: FramedMachineConnection,
    readonly expiresAt: string,
    transport: 'direct' | 'relay' = 'direct',
    onClose?: () => void,
  ) {
    this.#connection = connection
    this.transport = transport
    this.#onClose = onClose
  }

  async readHostBootstrap(signal?: AbortSignal): Promise<unknown> {
    return await this.#request('host.bootstrap', undefined, signal)
  }

  async listMachines(signal?: AbortSignal): Promise<unknown> {
    return await this.#request('machine.list', undefined, signal)
  }

  async getMachine(machineId: string, signal?: AbortSignal): Promise<unknown> {
    return await this.#request('machine.get', machineId, signal)
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#connection.end()
    this.#onClose?.()
  }

  async #request(
    operation: 'host.bootstrap' | 'machine.list' | 'machine.get',
    machineId: string | undefined,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const requestId = `sreq_${randomUUID().replaceAll('-', '')}`
    let response: SupervisorResponse
    try {
      await this.#connection.send(
        {
          type: 'supervisor.request',
          protocolVersion: supervisorProtocolVersion,
          requestId,
          operation,
          ...(machineId === undefined ? {} : { machineId }),
        },
        { signal },
      )
      response = await this.#connection.receive(supervisorResponseSchema, {
        signal,
      })
    } catch (error) {
      this.close()
      throw error
    }
    if (response.requestId !== requestId) {
      this.close()
      throw new SupervisorClientError('protocol_error')
    }
    if (!response.ok) throw new SupervisorClientError(response.code!)
    return response.data
  }
}

export class SupervisorClientError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'SupervisorClientError'
  }
}

export async function connectSupervisorDirect(
  options: ConnectSupervisorDirectOptions,
): Promise<PendingSupervisorConnection> {
  const { now, payload } = await validateSupervisorConnection(options)
  if (
    !payload.directEndpoints.some(
      (endpoint) =>
        endpoint.host === options.endpoint.host &&
        endpoint.port === options.endpoint.port,
    )
  )
    throw new SupervisorClientError('host_identity_mismatch')
  const identity =
    options.tlsIdentity ??
    (await generateSupervisorTlsIdentity('CodeTether Supervisor Device'))
  const tls = await connectSupervisorTls({
    host: options.endpoint.host,
    port: options.endpoint.port,
    identity,
    expectedPeerFingerprint: payload.transportTlsFingerprint,
    signal: options.signal,
    timeoutMs: supervisorTransportLimits.handshakeTimeoutMs,
  })
  return await completeSupervisorHandshake(
    options,
    tls.socket,
    tls.exporter,
    now,
    payload,
    'direct',
  )
}

export async function connectSupervisorRelayOverStream(
  options: Omit<ConnectSupervisorDirectOptions, 'endpoint'> & {
    readonly stream: Duplex
    readonly onClose?: () => void
  },
): Promise<PendingSupervisorConnection> {
  let validated: Awaited<ReturnType<typeof validateSupervisorConnection>>
  try {
    validated = await validateSupervisorConnection(options)
  } catch (error) {
    options.stream.destroy()
    options.onClose?.()
    throw error
  }
  const { now, payload } = validated
  if (
    payload.relay === null ||
    payload.relay.hostTransportFingerprint !== payload.transportTlsFingerprint
  ) {
    options.stream.destroy()
    throw new SupervisorClientError('host_identity_mismatch')
  }
  const identity =
    options.tlsIdentity ??
    (await generateSupervisorTlsIdentity('CodeTether Supervisor Device'))
  const tls = await connectSupervisorTlsOverStream({
    stream: options.stream,
    identity,
    expectedPeerFingerprint: payload.transportTlsFingerprint,
    signal: options.signal,
    timeoutMs: supervisorTransportLimits.handshakeTimeoutMs,
  })
  return await completeSupervisorHandshake(
    options,
    tls.socket,
    tls.exporter,
    now,
    payload,
    'relay',
    options.onClose,
  )
}

async function validateSupervisorConnection(
  options: Omit<ConnectSupervisorDirectOptions, 'endpoint'>,
): Promise<{
  readonly now: Date
  readonly payload: SignedSupervisorTransportDescriptor['payload']
}> {
  const now = options.now?.() ?? new Date()
  const grant = signedSupervisorGrantSchema.parse(options.grant)
  const descriptor = signedSupervisorTransportDescriptorSchema.parse(
    options.descriptor,
  )
  await Promise.all([
    verifySupervisorGrant(grant, options.expectedHost.publicJwk),
    verifySupervisorDescriptor(descriptor, options.expectedHost.publicJwk),
  ])
  const payload = descriptor.payload
  if (
    grant.payload.hostId !== options.expectedHost.hostId ||
    grant.payload.hostFingerprint !== options.expectedHost.fingerprint ||
    grant.payload.hostIdentityGeneration !==
      options.expectedHost.identityGeneration ||
    grant.payload.deviceId !== options.expectedDevice.deviceId ||
    grant.payload.deviceKeyGeneration !==
      options.expectedDevice.keyGeneration ||
    payload.hostId !== options.expectedHost.hostId ||
    payload.hostFingerprint !== options.expectedHost.fingerprint ||
    payload.hostIdentityGeneration !==
      options.expectedHost.identityGeneration ||
    payload.deviceId !== options.expectedDevice.deviceId ||
    payload.deviceKeyGeneration !== options.expectedDevice.keyGeneration ||
    payload.authorizationId !== grant.payload.authorizationId ||
    payload.grantDigest !== supervisorGrantDigest(grant) ||
    payload.exp * 1_000 <= now.getTime()
  ) {
    throw new SupervisorClientError('host_identity_mismatch')
  }
  return { now, payload }
}

async function completeSupervisorHandshake(
  options: Omit<ConnectSupervisorDirectOptions, 'endpoint'>,
  socket: import('node:tls').TLSSocket,
  exporter: string,
  now: Date,
  payload: SignedSupervisorTransportDescriptor['payload'],
  transport: 'direct' | 'relay',
  onClose?: () => void,
): Promise<PendingSupervisorConnection> {
  const connection = new FramedMachineConnection(socket)
  try {
    const first = await connection.receive(supervisorServerHandshakeSchema, {
      signal: options.signal,
      timeoutMs: supervisorTransportLimits.handshakeTimeoutMs,
    })
    if (first.type !== 'supervisor.challenge') {
      throw new SupervisorClientError(
        first.type === 'supervisor.rejected' ? first.code : 'protocol_error',
      )
    }
    const challenge = supervisorChallengeSchema.parse(first)
    if (
      challenge.hostId !== payload.hostId ||
      challenge.hostIdentityGeneration !== payload.hostIdentityGeneration ||
      challenge.deviceId !== payload.deviceId ||
      challenge.deviceKeyGeneration !== payload.deviceKeyGeneration ||
      challenge.authorizationId !== payload.authorizationId ||
      challenge.tlsExporter !== exporter ||
      Date.parse(challenge.issuedAt) >
        now.getTime() + supervisorTransportLimits.maximumClockSkewMs ||
      Date.parse(challenge.expiresAt) <= now.getTime()
    ) {
      throw new SupervisorClientError('host_identity_mismatch')
    }
    return new PendingSupervisorConnection(
      connection,
      challenge,
      transport,
      onClose,
    )
  } catch (error) {
    connection.destroy()
    throw error
  }
}

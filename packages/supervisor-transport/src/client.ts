import { randomUUID } from 'node:crypto'

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
} from './protocol.js'
import {
  connectSupervisorTls,
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
  readonly transport = 'direct' as const
  readonly #connection: FramedMachineConnection

  constructor(
    connection: FramedMachineConnection,
    challenge: SupervisorChallenge,
  ) {
    this.#connection = connection
    this.challenge = challenge
    this.challengeBody = canonicalJsonBytes(challenge)
    this.admissionResource = `/v1/hosts/${challenge.hostId}/supervisor-admission`
  }

  async authenticate(input: {
    readonly accessToken: string
    readonly deviceProof: string
    readonly signal?: AbortSignal
  }): Promise<ConnectedSupervisorSession> {
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
      this.#connection.destroy()
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
      this.#connection.destroy()
      throw new SupervisorClientError('host_identity_mismatch')
    }
    return new ConnectedSupervisorSession(this.#connection, response.expiresAt)
  }

  close(): void {
    this.#connection.destroy()
  }
}

export class ConnectedSupervisorSession {
  readonly transport = 'direct' as const
  readonly #connection: FramedMachineConnection

  constructor(
    connection: FramedMachineConnection,
    readonly expiresAt: string,
  ) {
    this.#connection = connection
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
    this.#connection.end()
  }

  async #request(
    operation: 'host.bootstrap' | 'machine.list' | 'machine.get',
    machineId: string | undefined,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (Date.parse(this.expiresAt) <= Date.now()) {
      throw new SupervisorClientError('session_expired')
    }
    const requestId = `sreq_${randomUUID().replaceAll('-', '')}`
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
    const response = await this.#connection.receive(supervisorResponseSchema, {
      signal,
    })
    if (response.requestId !== requestId) {
      this.#connection.destroy()
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
    payload.exp * 1_000 <= now.getTime() ||
    !payload.directEndpoints.some(
      (endpoint) =>
        endpoint.host === options.endpoint.host &&
        endpoint.port === options.endpoint.port,
    )
  ) {
    throw new SupervisorClientError('host_identity_mismatch')
  }
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
  const connection = new FramedMachineConnection(tls.socket)
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
      challenge.tlsExporter !== tls.exporter ||
      Date.parse(challenge.issuedAt) >
        now.getTime() + supervisorTransportLimits.maximumClockSkewMs ||
      Date.parse(challenge.expiresAt) <= now.getTime()
    ) {
      throw new SupervisorClientError('host_identity_mismatch')
    }
    return new PendingSupervisorConnection(connection, challenge)
  } catch (error) {
    connection.destroy()
    throw error
  }
}

import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'

import {
  connectSupervisorDirect,
  signedSupervisorGrantSchema,
  signedSupervisorTransportDescriptorSchema,
  supervisorPublicJwkSchema,
  SupervisorClientError,
  SupervisorServer,
  type ConnectedSupervisorSession,
  type PendingSupervisorConnection,
  type SignedSupervisorGrant,
  type SignedSupervisorTransportDescriptor,
  type SupervisorPublicJwk,
} from '@codetether/supervisor-transport'
import { TimestampSchema } from '@codetether/protocol'

import type { HostService } from './host-service.js'
import type { ConversationStore } from '../persistence/index.js'

const MAX_OUTBOUND_CONNECTIONS = 8

export interface SupervisorTransportManagerOptions {
  readonly service: HostService
  readonly persistence: ConversationStore
  readonly bindHost?: string
  readonly port?: number
  readonly advertiseHost?: string
}

export interface SupervisorTransportPresence {
  readonly transportTlsFingerprint: string
  readonly directEndpoints: readonly {
    readonly host: string
    readonly port: number
  }[]
}

/**
 * Owns the narrow ProductDevice/Host Supervisor transport. It deliberately
 * does not expose the local HTTP API or any Controller/Node credentials.
 */
export class SupervisorTransportManager {
  readonly #service: HostService
  readonly #persistence: ConversationStore
  readonly #server: SupervisorServer
  readonly #advertiseHost: string
  readonly #pending = new Map<string, PendingSupervisorConnection>()
  readonly #sessions = new Map<string, ConnectedSupervisorSession>()

  private constructor(
    options: SupervisorTransportManagerOptions,
    server: SupervisorServer,
  ) {
    this.#service = options.service
    this.#persistence = options.persistence
    this.#server = server
    this.#advertiseHost = options.advertiseHost ?? hostname()
  }

  static async create(
    options: SupervisorTransportManagerOptions,
  ): Promise<SupervisorTransportManager> {
    const server = await SupervisorServer.create({
      host: options.bindHost ?? '0.0.0.0',
      port: options.port ?? 4318,
      authorize: async (input) => {
        const resource = `/v1/hosts/${input.challenge.hostId}/supervisor-admission`
        let response: Response
        try {
          response = await fetch(`${input.controlPlaneOrigin}${resource}`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${input.accessToken}`,
              'content-type': 'application/json',
              'x-codetether-device-proof': input.deviceProof,
            },
            body: input.challengeBody,
            signal: AbortSignal.timeout(10_000),
          })
        } catch {
          throw new Error('control_plane_unavailable')
        }
        const body = (await response.json().catch(() => undefined)) as
          Record<string, unknown> | undefined
        if (!response.ok || body?.admitted !== true) {
          const safeCode = typeof body?.code === 'string' ? body.code : ''
          if (safeCode === 'device_proof_replayed') {
            throw new Error('proof_replayed')
          }
          if (safeCode.includes('expired')) throw new Error('proof_expired')
          if (
            safeCode.includes('revoked') ||
            safeCode.includes('authorization') ||
            response.status === 403
          ) {
            throw new Error('authorization_revoked')
          }
          throw new Error('authentication_failed')
        }
        return {
          hostId: stringField(body, 'hostId'),
          hostIdentityGeneration: positiveIntegerField(
            body,
            'hostIdentityGeneration',
          ),
          deviceId: stringField(body, 'deviceId'),
          deviceKeyGeneration: positiveIntegerField(
            body,
            'deviceKeyGeneration',
          ),
          authorizationId: stringField(body, 'authorizationId'),
          authorizationExpiresAt: stringField(body, 'authorizationExpiresAt'),
        }
      },
      reads: {
        readHostBootstrap: () => {
          const identity = options.service.getHostIdentity()
          if (identity === undefined) {
            throw new Error('Host identity is not initialized')
          }
          return { protocolVersion: 1, identity }
        },
        listMachines: () => options.service.listMachines(),
        getMachine: async (machineId) => {
          const detail = await options.service.getMachine(machineId as never)
          return {
            protocolVersion: detail.protocolVersion,
            machine: detail.machine,
            providers: detail.providers,
            providerLifecycles: detail.providerLifecycles,
            ...('connection' in detail
              ? { connection: detail.connection }
              : {}),
            ...('providerDiscovery' in detail
              ? { providerDiscovery: detail.providerDiscovery }
              : {}),
            ...('relay' in detail ? { relay: detail.relay } : {}),
          }
        },
      },
      onDiagnostic(event, fields) {
        process.stderr.write(
          `${JSON.stringify({ component: 'host', event, ...fields })}\n`,
        )
      },
    })
    const manager = new SupervisorTransportManager(options, server)
    await server.start()
    return manager
  }

  presence(): SupervisorTransportPresence {
    const address = this.#server.address
    if (address === undefined)
      throw new Error('Supervisor transport is not listening')
    return {
      transportTlsFingerprint: this.#server.tlsIdentity.publicKeyFingerprint,
      directEndpoints: [{ host: this.#advertiseHost, port: address.port }],
    }
  }

  async activate(input: {
    readonly hostPublicJwk: SupervisorPublicJwk
    readonly grant: SignedSupervisorGrant
    readonly descriptor: SignedSupervisorTransportDescriptor
  }): Promise<void> {
    const identity = this.#service.getHostIdentity()
    if (identity === undefined)
      throw new Error('Host identity is not initialized')
    const publicJwk = supervisorPublicJwkSchema.parse(input.hostPublicJwk)
    const durablePublicJwk = supervisorPublicJwkSchema.parse(
      JSON.parse(identity.publicJwk),
    )
    if (
      publicJwk.crv !== durablePublicJwk.crv ||
      publicJwk.kty !== durablePublicJwk.kty ||
      publicJwk.x !== durablePublicJwk.x ||
      publicJwk.y !== durablePublicJwk.y
    ) {
      throw new Error('Host identity mismatch')
    }
    const grant = signedSupervisorGrantSchema.parse(input.grant)
    const descriptor = signedSupervisorTransportDescriptorSchema.parse(
      input.descriptor,
    )
    this.#persistence.storeHostSupervisorGrant(
      grant,
      TimestampSchema.parse(new Date().toISOString()),
    )
    await this.#server.activate({ hostPublicJwk: publicJwk, grant, descriptor })
  }

  async beginRemote(input: {
    readonly hostId: string
    readonly hostFingerprint: string
    readonly hostIdentityGeneration: number
    readonly hostPublicJwk: SupervisorPublicJwk
    readonly deviceId: string
    readonly deviceKeyGeneration: number
    readonly grant: SignedSupervisorGrant
    readonly descriptor: SignedSupervisorTransportDescriptor
  }): Promise<{
    readonly connectionId: string
    readonly challenge: unknown
    readonly challengeBodyBase64Url: string
    readonly admissionResource: string
    readonly transport: 'direct'
  }> {
    this.#assertCapacity()
    const descriptor = signedSupervisorTransportDescriptorSchema.parse(
      input.descriptor,
    )
    let lastError: unknown
    for (const endpoint of descriptor.payload.directEndpoints) {
      try {
        const pending = await connectSupervisorDirect({
          endpoint,
          expectedHost: {
            hostId: input.hostId,
            fingerprint: input.hostFingerprint,
            identityGeneration: input.hostIdentityGeneration,
            publicJwk: supervisorPublicJwkSchema.parse(input.hostPublicJwk),
          },
          expectedDevice: {
            deviceId: input.deviceId,
            keyGeneration: input.deviceKeyGeneration,
          },
          grant: input.grant,
          descriptor,
          signal: AbortSignal.timeout(10_000),
        })
        const connectionId = `sconn_${randomUUID().replaceAll('-', '')}`
        this.#pending.set(connectionId, pending)
        return {
          connectionId,
          challenge: pending.challenge,
          challengeBodyBase64Url: Buffer.from(pending.challengeBody).toString(
            'base64url',
          ),
          admissionResource: pending.admissionResource,
          transport: 'direct',
        }
      } catch (error) {
        lastError = error
      }
    }
    if (descriptor.payload.relay !== null) {
      throw new SupervisorClientError('relay_unavailable')
    }
    throw lastError ?? new SupervisorClientError('remote_host_unreachable')
  }

  async authenticateRemote(
    connectionId: string,
    input: { readonly accessToken: string; readonly deviceProof: string },
  ): Promise<{ readonly sessionId: string; readonly expiresAt: string }> {
    const pending = this.#pending.get(connectionId)
    if (pending === undefined)
      throw new Error('Supervisor connection not found')
    this.#pending.delete(connectionId)
    try {
      const session = await pending.authenticate({
        accessToken: input.accessToken,
        deviceProof: input.deviceProof,
        signal: AbortSignal.timeout(10_000),
      })
      const sessionId = `sclient_${randomUUID().replaceAll('-', '')}`
      this.#sessions.set(sessionId, session)
      return { sessionId, expiresAt: session.expiresAt }
    } catch (error) {
      pending.close()
      throw error
    }
  }

  async readRemote(
    sessionId: string,
    operation: 'host.bootstrap' | 'machine.list' | 'machine.get',
    machineId?: string,
  ): Promise<unknown> {
    const session = this.#sessions.get(sessionId)
    if (session === undefined) throw new Error('Supervisor session not found')
    try {
      if (operation === 'host.bootstrap')
        return await session.readHostBootstrap()
      if (operation === 'machine.list') return await session.listMachines()
      if (machineId === undefined)
        throw new Error('Machine identity is required')
      return await session.getMachine(machineId)
    } catch (error) {
      if (
        error instanceof SupervisorClientError &&
        error.code === 'session_expired'
      ) {
        this.closeRemote(sessionId)
      }
      throw error
    }
  }

  closeRemote(id: string): void {
    const pending = this.#pending.get(id)
    pending?.close()
    this.#pending.delete(id)
    const session = this.#sessions.get(id)
    session?.close()
    this.#sessions.delete(id)
  }

  async close(): Promise<void> {
    for (const id of [...this.#pending.keys(), ...this.#sessions.keys()]) {
      this.closeRemote(id)
    }
    await this.#server.close()
  }

  #assertCapacity(): void {
    if (this.#pending.size + this.#sessions.size >= MAX_OUTBOUND_CONNECTIONS) {
      throw new Error('Supervisor connection capacity reached')
    }
  }
}

function stringField(value: Record<string, unknown>, name: string): string {
  const field = value[name]
  if (typeof field !== 'string' || field.length === 0 || field.length > 256) {
    throw new Error('Control Plane Supervisor response is invalid')
  }
  return field
}

function positiveIntegerField(
  value: Record<string, unknown>,
  name: string,
): number {
  const field = value[name]
  if (!Number.isSafeInteger(field) || Number(field) < 1) {
    throw new Error('Control Plane Supervisor response is invalid')
  }
  return Number(field)
}

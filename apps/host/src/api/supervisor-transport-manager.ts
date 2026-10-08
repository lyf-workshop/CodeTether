import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { networkInterfaces } from 'node:os'

import {
  connectSupervisorDirect,
  connectSupervisorRelayDevice,
  connectSupervisorRelayHost,
  connectSupervisorRelayOverStream,
  generateSupervisorTlsIdentity,
  isLoopbackSupervisorHost,
  signedSupervisorGrantSchema,
  signedSupervisorHostPresenceSchema,
  signedSupervisorTransportSchema,
  supervisorPublicJwkSchema,
  supervisorTransportLimits,
  SupervisorClientError,
  SupervisorServer,
  validateSupervisorConnection,
  verifySupervisorGrant,
  verifySupervisorHostPresence,
  type SignedSupervisorHostPresence,
  type SupervisorHostPresencePayload,
  type ConnectedSupervisorSession,
  type PendingSupervisorConnection,
  type SignedSupervisorGrant,
  type SignedSupervisorTransport,
  type SupervisorPublicJwk,
  type SupervisorRelayControlConnection,
} from '@codetether/supervisor-transport'
import {
  ActionIdSchema,
  TimestampSchema,
  type CreateConversationRequest,
  type StartTurnRequest,
} from '@codetether/protocol'

import type { HostService } from './host-service.js'
import type { ConversationStore } from '../persistence/index.js'
import { HostPresencePublisher } from './host-presence-publisher.js'
import type { HostStartupTimeline } from './startup-timeline.js'

const MAX_OUTBOUND_CONNECTIONS = 8
const RELAY_RECONNECT_MINIMUM_MS = 1_000
const RELAY_RECONNECT_MAXIMUM_MS = 60_000

export interface SupervisorRelayConfiguration {
  readonly endpoint: string
  readonly relayId: string
  readonly relayFingerprint: string
}

export interface SupervisorTransportManagerOptions {
  readonly startupTimeline?: HostStartupTimeline
  readonly service: HostService
  readonly persistence: ConversationStore
  readonly bindHost?: string
  readonly port?: number
  readonly advertiseHost?: string
  /** Test-only opt-in for in-process loopback Supervisor fixtures. */
  readonly allowLoopbackForTests?: boolean
  readonly clientBuildIdentity: string
  readonly relay?: SupervisorRelayConfiguration
  readonly controlPlaneOrigin?: string
  readonly signHostPresence?: (
    keyHandle: string,
    payload: SupervisorHostPresencePayload,
    signal: AbortSignal,
  ) => Promise<string>
}

export interface SupervisorTransportPresence {
  readonly transportTlsFingerprint: string
  readonly directEndpoints: readonly {
    readonly host: string
    readonly port: number
  }[]
  readonly relay: {
    readonly endpoint: string
    readonly relayId: string
    readonly relayFingerprint: string
    readonly rendezvousId: string
    readonly rendezvousCapability: string
    readonly hostTransportFingerprint: string
  } | null
}

/**
 * Owns the narrow ProductDevice/Host Supervisor transport. It deliberately
 * does not expose the local HTTP API or any Controller/Node credentials.
 */
export class SupervisorTransportManager {
  readonly #service: HostService
  readonly #persistence: ConversationStore
  readonly #server: SupervisorServer
  readonly #advertiseHosts: readonly string[]
  readonly #allowLoopbackForTests: boolean
  readonly #clientBuildIdentity: string
  readonly #relay: SupervisorRelayConfiguration | undefined
  readonly #relayRendezvousId: string
  readonly #relayRendezvousCapability: string
  readonly #pending = new Map<string, PendingSupervisorConnection>()
  readonly #sessions = new Map<string, ConnectedSupervisorSession>()
  readonly #sessionExpiryTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >()
  #relayAbort: AbortController | undefined
  #relayConnection: SupervisorRelayControlConnection | undefined
  #relayTask: Promise<void> | undefined
  #presencePublisher: HostPresencePublisher | undefined
  #presenceConstruction:
    Promise<SignedSupervisorHostPresence | undefined> | undefined
  readonly #signHostPresence: SupervisorTransportManagerOptions['signHostPresence']
  readonly #startupTimeline: HostStartupTimeline | undefined

  private constructor(
    options: SupervisorTransportManagerOptions,
    server: SupervisorServer,
  ) {
    this.#service = options.service
    this.#persistence = options.persistence
    this.#server = server
    this.#clientBuildIdentity = options.clientBuildIdentity
    this.#relay = options.relay
    this.#signHostPresence = options.signHostPresence
    this.#startupTimeline = options.startupTimeline
    this.#allowLoopbackForTests = options.allowLoopbackForTests === true
    this.#relayRendezvousId = `srv_${randomBytes(16).toString('hex')}`
    this.#relayRendezvousCapability = randomBytes(32).toString('base64url')
    const advertisedHosts =
      options.advertiseHost === undefined
        ? discoverSupervisorDirectHosts()
        : [options.advertiseHost]
    this.#advertiseHosts = this.#allowLoopbackForTests
      ? advertisedHosts
      : advertisedHosts.filter((host) => !isLoopbackSupervisorHost(host))
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
        listProjects: (machineId, page) =>
          options.service.listSupervisorProjects(machineId as never, page),
        getProject: (machineId, projectId) =>
          options.service.getSupervisorProject(
            machineId as never,
            projectId as never,
          ),
        listConversations: (machineId, projectId, page) =>
          options.service.listSupervisorConversations(
            machineId as never,
            projectId as never,
            page,
          ),
        getConversation: (machineId, projectId, conversationId) =>
          options.service.getSupervisorConversation(
            machineId as never,
            projectId as never,
            conversationId as never,
          ),
        readConversationHistory: (machineId, projectId, conversationId, page) =>
          options.service.readSupervisorConversationHistory(
            machineId as never,
            projectId as never,
            conversationId as never,
            page as never,
          ),
        readConversationLive: (machineId, projectId, conversationId, query) =>
          options.service.readSupervisorConversationLive(
            machineId as never,
            projectId as never,
            conversationId as never,
            query as never,
          ),
        getAction: (actionId) => {
          const turn = options.persistence.getTurnForStartAction(
            ActionIdSchema.parse(actionId),
          )
          if (turn === undefined) {
            return {
              protocolVersion: 1,
              actionId,
              status: 'not_found',
            }
          }
          const terminal =
            turn.status === 'completed' ||
            turn.status === 'failed' ||
            turn.status === 'interrupted'
          return {
            protocolVersion: 1,
            actionId,
            status: terminal
              ? turn.status === 'completed'
                ? 'completed'
                : 'failed'
              : turn.status === 'starting'
                ? 'accepted'
                : 'running',
            conversationId: turn.conversationId,
            turnId: turn.turnId,
          }
        },
      },
      authorizeControl: (authorizationId) =>
        typeof options.persistence.hasHostSupervisorControl === 'function' &&
        options.persistence.hasHostSupervisorControl(authorizationId),
      control: {
        startConversationTurn: async (request) => {
          await options.service.getSupervisorConversation(
            request.machineId as never,
            request.projectId as never,
            request.conversationId as never,
          )
          const input: StartTurnRequest = {
            actionId: ActionIdSchema.parse(request.actionId),
            input: request.input,
          }
          return await options.service.startTurn(
            request.conversationId as never,
            input,
          )
        },
        createConversation: async (request) => {
          const createRequest: CreateConversationRequest = {
            actionId: ActionIdSchema.parse(request.actionId),
            machineId: request.machineId as never,
            projectId: request.projectId as never,
            provider: request.provider,
            ...(request.model === undefined ? {} : { model: request.model }),
            ...(request.reasoning === undefined
              ? {}
              : { reasoning: request.reasoning }),
          }
          const created =
            await options.service.createConversation(createRequest)
          const conversationId = created.data.conversation.conversationId
          const firstTurnActionId = ActionIdSchema.parse(
            `act_${createHash('sha256')
              .update(`${request.actionId}:first-turn`, 'utf8')
              .digest('hex')}`,
          )
          const started = await options.service.startTurn(conversationId, {
            actionId: firstTurnActionId,
            input: request.input,
          })
          return {
            protocolVersion: 1,
            actionId: request.actionId,
            status: started.status,
            data: {
              conversation: created.data.conversation,
              turn: started.data.turn,
            },
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
    options.startupTimeline?.mark('SUPERVISOR_4318_LISTENING')
    manager.#startRelayPresence()
    await manager.#restorePresenceConfiguration(options.controlPlaneOrigin)
    manager.#ensurePresencePublisher()
    return manager
  }

  requestPresenceRenewal(): void {
    this.#presencePublisher?.requestRenewal()
  }

  #ensurePresencePublisher(): void {
    if (
      this.#presencePublisher !== undefined ||
      this.#signHostPresence === undefined ||
      !this.#service.getHostIdentity()?.lastRegisteredAt ||
      !this.#persistence.getHostPresenceConfiguration()?.enabled
    )
      return
    this.#presencePublisher = new HostPresencePublisher({
      createPresence: (signal) => this.#createHostPresence(signal),
      onState: (state) =>
        process.stderr.write(
          `${JSON.stringify({ component: 'host', event: 'supervisor.host_presence', state })}\n`,
        ),
    })
    this.#startupTimeline?.mark('PRESENCE_PUBLISHER_START')
  }

  async configureHostPresence(input: {
    spaceId: string
    controlPlaneOrigin: string
    enabled?: boolean
  }): Promise<SignedSupervisorHostPresence | null> {
    const identity = this.#service.getHostIdentity()
    if (
      identity?.lastRegisteredAt === undefined ||
      this.#signHostPresence === undefined
    )
      throw new Error('Registered Host signer is unavailable')
    const origin = new URL(input.controlPlaneOrigin)
    if (
      !/^space_[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/u.test(input.spaceId) ||
      origin.origin !== input.controlPlaneOrigin ||
      origin.username ||
      origin.password ||
      (origin.protocol !== 'https:' &&
        !(
          origin.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
        ))
    ) {
      throw new Error('Invalid Host presence configuration')
    }
    const current = this.#persistence.getHostPresenceConfiguration()
    // Periodic metadata reconciliation must not undo an explicit Host disable.
    // Only an explicit enabled:true action may re-enable an existing disabled Host.
    const enabled = input.enabled ?? current?.enabled ?? true
    if (
      current?.spaceId === input.spaceId &&
      current.controlPlaneOrigin === input.controlPlaneOrigin &&
      current.enabled === enabled
    ) {
      const last = this.#presencePublisher?.lastPresence
      if (last !== undefined && last.payload.exp * 1_000 > Date.now())
        return last
    }
    this.#persistence.configureHostPresence({ ...input, enabled })
    if (!enabled) {
      await this.#presencePublisher?.close()
      this.#presencePublisher = undefined
      return null
    }
    // Local signing/configuration is not an HTTP publication or a renewal owner.
    const result =
      (await this.#createHostPresence(AbortSignal.timeout(10_000))) ?? null
    this.#ensurePresencePublisher()
    this.requestPresenceRenewal()
    return result
  }

  async #restorePresenceConfiguration(origin?: string): Promise<void> {
    if (
      origin === undefined ||
      this.#persistence.getHostPresenceConfiguration() !== undefined
    )
      return
    const identity = this.#service.getHostIdentity()
    if (identity?.lastRegisteredAt === undefined) return
    const jwk = supervisorPublicJwkSchema.parse(JSON.parse(identity.publicJwk))
    for (const grant of this.#persistence.listEnabledHostSupervisorGrants()) {
      if (
        grant.payload.hostId !== identity.hostId ||
        grant.payload.hostFingerprint !== identity.fingerprint ||
        grant.payload.hostIdentityGeneration !== identity.identityGeneration
      )
        continue
      try {
        await verifySupervisorGrant(grant, jwk)
      } catch {
        continue
      }
      this.#persistence.configureHostPresence({
        spaceId: grant.payload.spaceId,
        controlPlaneOrigin: new URL(origin).origin,
        enabled: true,
      })
      return
    }
  }

  async #createHostPresence(
    signal: AbortSignal,
  ): Promise<SignedSupervisorHostPresence | undefined> {
    this.#presenceConstruction ??= this.#buildHostPresence(signal).finally(
      () => {
        this.#presenceConstruction = undefined
      },
    )
    return await this.#presenceConstruction
  }

  async #buildHostPresence(
    signal: AbortSignal,
  ): Promise<SignedSupervisorHostPresence | undefined> {
    const identity = this.#service.getHostIdentity()
    const config = this.#persistence.getHostPresenceConfiguration()
    if (
      !identity?.lastRegisteredAt ||
      !config?.enabled ||
      this.#signHostPresence === undefined
    )
      return undefined
    const now = Math.floor(Date.now() / 1_000)
    const payload = signedSupervisorHostPresenceSchema.shape.payload.parse({
      v: 1,
      aud: 'codetether-host-supervisor',
      purpose: 'host_supervisor_presence',
      hostId: identity.hostId,
      hostFingerprint: identity.fingerprint,
      hostIdentityGeneration: identity.identityGeneration,
      spaceId: config.spaceId,
      controlPlaneOrigin: config.controlPlaneOrigin,
      ...this.presence(),
      iat: now,
      exp: now + supervisorTransportLimits.descriptorLifetimeMs / 1_000,
      protocolVersion: 2,
    })
    const descriptor = {
      payload,
      proof: await this.#signHostPresence(identity.keyHandle, payload, signal),
    }
    const hostPublicJwk = supervisorPublicJwkSchema.parse(
      JSON.parse(identity.publicJwk),
    )
    await verifySupervisorHostPresence(descriptor, hostPublicJwk)
    for (const grant of this.#persistence.listEnabledHostSupervisorGrants()) {
      if (grant.payload.expiresAt * 1_000 <= Date.now()) continue
      // Server activation verifies all Host/grant/scope bindings. Cloud admission
      // still checks revocation on EVERY incoming session; no cloud row is made.
      try {
        await this.#server.activate({ hostPublicJwk, grant, descriptor })
      } catch {
        process.stderr.write(
          `${JSON.stringify({ component: 'host', event: 'supervisor.grant.restore_rejected', authorizationId: grant.payload.authorizationId })}\n`,
        )
      }
    }
    return descriptor
  }

  presence(): SupervisorTransportPresence {
    const address = this.#server.address
    if (address === undefined)
      throw new Error('Supervisor transport is not listening')
    return {
      transportTlsFingerprint: this.#server.tlsIdentity.publicKeyFingerprint,
      directEndpoints: this.#advertiseHosts.map((host) => ({
        host,
        port: address.port,
      })),
      relay:
        this.#relay === undefined
          ? null
          : {
              ...this.#relay,
              rendezvousId: this.#relayRendezvousId,
              rendezvousCapability: this.#relayRendezvousCapability,
              hostTransportFingerprint:
                this.#server.tlsIdentity.publicKeyFingerprint,
            },
    }
  }

  async activate(input: {
    readonly hostPublicJwk: SupervisorPublicJwk
    readonly grant: SignedSupervisorGrant
    readonly descriptor: SignedSupervisorTransport
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
    const descriptor = signedSupervisorTransportSchema.parse(input.descriptor)
    this.#assertRelayDescriptor(descriptor)
    this.#persistence.storeHostSupervisorGrant(
      grant,
      TimestampSchema.parse(new Date().toISOString()),
    )
    await this.#server.activate({ hostPublicJwk: publicJwk, grant, descriptor })
    this.#persistence.enableHostSupervisorGrant(grant.payload.authorizationId)
    this.#startRelayPresence()
  }

  pruneActivations(authorizationIds: readonly string[]): void {
    this.#persistence.pruneHostSupervisorGrants(authorizationIds)
    this.#server.pruneActivations(new Set(authorizationIds))
  }

  async beginRemote(input: {
    readonly hostId: string
    readonly hostFingerprint: string
    readonly hostIdentityGeneration: number
    readonly hostPublicJwk: SupervisorPublicJwk
    readonly deviceId: string
    readonly deviceKeyGeneration: number
    readonly grant: SignedSupervisorGrant
    readonly descriptor: SignedSupervisorTransport
    readonly forceRelay?: boolean
  }): Promise<{
    readonly connectionId: string
    readonly challenge: unknown
    readonly challengeBodyBase64Url: string
    readonly admissionResource: string
    readonly transport: 'direct' | 'relay'
  }> {
    this.#assertCapacity()
    const descriptor = signedSupervisorTransportSchema.parse(input.descriptor)
    const localHostIdentity = this.#service.getHostIdentity()
    const targetsLocalHost =
      localHostIdentity !== undefined &&
      localHostIdentity.hostId === input.hostId &&
      localHostIdentity.fingerprint === input.hostFingerprint &&
      localHostIdentity.identityGeneration === input.hostIdentityGeneration
    let remoteDescriptorValidated = false
    let lastError: unknown
    for (const endpoint of input.forceRelay === true
      ? []
      : descriptor.payload.directEndpoints) {
      // A loopback address belongs to the Host that published the descriptor,
      // not to a different Controller process. When Relay is available, skip
      // it so a remote Controller cannot self-connect and turn the resulting
      // host identity mismatch into a terminal failure before Relay fallback.
      if (
        descriptor.payload.relay !== null &&
        isLoopbackSupervisorHost(endpoint.host) &&
        !targetsLocalHost
      ) {
        if (!remoteDescriptorValidated) {
          await validateSupervisorConnection({
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
          remoteDescriptorValidated = true
        }
        continue
      }
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
        if (!isRelayFallbackEligible(error)) throw error
        lastError = error
      }
    }
    const relay = descriptor.payload.relay
    if (relay !== null) {
      const route = parseSupervisorRelayEndpoint(
        relay.endpoint,
        relay.relayFingerprint,
      )
      const identity = await generateSupervisorTlsIdentity(
        'CodeTether Supervisor Device',
      )
      let control: SupervisorRelayControlConnection | undefined
      try {
        control = await connectSupervisorRelayDevice({
          ...route,
          expectedRelayId: relay.relayId,
          expectedRelayFingerprint: relay.relayFingerprint,
          rendezvousId: relay.rendezvousId,
          rendezvousCapability: relay.rendezvousCapability,
          hostTransportFingerprint: relay.hostTransportFingerprint,
          identity,
          clientBuildIdentity: this.#clientBuildIdentity,
          signal: AbortSignal.timeout(10_000),
        })
        const stream = await control.openDeviceChannel(
          AbortSignal.timeout(10_000),
        )
        const relayControl = control
        const pending = await connectSupervisorRelayOverStream({
          stream,
          tlsIdentity: identity,
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
          onClose: () => relayControl.close(),
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
          transport: 'relay',
        }
      } catch (error) {
        control?.close()
        throw error
      }
    }
    throw lastError ?? new SupervisorClientError('remote_host_unreachable')
  }

  async authenticateRemote(
    connectionId: string,
    input: { readonly accessToken: string; readonly deviceProof: string },
  ): Promise<{
    readonly sessionId: string
    readonly expiresAt: string
    readonly control: 'read' | 'control'
  }> {
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
      const timer = setTimeout(
        () => this.closeRemote(sessionId),
        Math.max(0, Date.parse(session.expiresAt) - Date.now()),
      )
      timer.unref()
      this.#sessionExpiryTimers.set(sessionId, timer)
      return {
        sessionId,
        expiresAt: session.expiresAt,
        control: session.control,
      }
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

  async listRemoteProjects(
    sessionId: string,
    machineId: string,
    page: { readonly limit: number; readonly cursor?: string },
  ): Promise<unknown> {
    return await this.#withRemoteSession(sessionId, (session) =>
      session.listProjects(machineId, page),
    )
  }

  async getRemoteProject(
    sessionId: string,
    machineId: string,
    projectId: string,
  ): Promise<unknown> {
    return await this.#withRemoteSession(sessionId, (session) =>
      session.getProject(machineId, projectId),
    )
  }

  async listRemoteConversations(
    sessionId: string,
    machineId: string,
    projectId: string,
    page: { readonly limit: number; readonly cursor?: string },
  ): Promise<unknown> {
    return await this.#withRemoteSession(sessionId, (session) =>
      session.listConversations(machineId, projectId, page),
    )
  }

  async getRemoteConversation(
    sessionId: string,
    machineId: string,
    projectId: string,
    conversationId: string,
  ): Promise<unknown> {
    return await this.#withRemoteSession(sessionId, (session) =>
      session.getConversation(machineId, projectId, conversationId),
    )
  }

  async readRemoteConversationHistory(
    sessionId: string,
    machineId: string,
    projectId: string,
    conversationId: string,
    page: { readonly limit: number; readonly cursor?: string },
  ): Promise<unknown> {
    return await this.#withRemoteSession(sessionId, (session) =>
      session.readConversationHistory(
        machineId,
        projectId,
        conversationId,
        page,
      ),
    )
  }

  async readRemoteConversationLive(
    sessionId: string,
    machineId: string,
    projectId: string,
    conversationId: string,
    query: {
      readonly cursor: string
      readonly limit: number
      readonly waitMs: number
    },
  ): Promise<unknown> {
    return await this.#withRemoteSession(sessionId, (session) =>
      session.readConversationLive(machineId, projectId, conversationId, query),
    )
  }

  async getRemoteAction(sessionId: string, actionId: string): Promise<unknown> {
    return await this.#withRemoteSession(sessionId, (session) =>
      session.getAction(actionId),
    )
  }

  async startRemoteConversationTurn(
    sessionId: string,
    input: {
      readonly actionId: string
      readonly machineId: string
      readonly projectId: string
      readonly conversationId: string
      readonly input: { readonly type: 'text'; readonly text: string }
    },
  ): Promise<unknown> {
    return await this.#withRemoteSession(sessionId, (session) =>
      session.startConversationTurn(input),
    )
  }

  async createRemoteConversation(
    sessionId: string,
    input: {
      readonly actionId: string
      readonly machineId: string
      readonly projectId: string
      readonly provider: 'codex' | 'claude-code'
      readonly input: { readonly type: 'text'; readonly text: string }
      readonly model?: string
      readonly reasoning?: string
    },
  ): Promise<unknown> {
    return await this.#withRemoteSession(sessionId, (session) =>
      session.createConversation(input),
    )
  }

  approveControl(authorizationId: string): void {
    this.#persistence.approveHostSupervisorControl(
      authorizationId,
      TimestampSchema.parse(new Date().toISOString()),
    )
  }

  async #withRemoteSession(
    sessionId: string,
    read: (session: ConnectedSupervisorSession) => Promise<unknown>,
  ): Promise<unknown> {
    const session = this.#sessions.get(sessionId)
    if (session === undefined) throw new Error('Supervisor session not found')
    try {
      return await read(session)
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
    const expiryTimer = this.#sessionExpiryTimers.get(id)
    if (expiryTimer !== undefined) clearTimeout(expiryTimer)
    this.#sessionExpiryTimers.delete(id)
    const pending = this.#pending.get(id)
    pending?.close()
    this.#pending.delete(id)
    const session = this.#sessions.get(id)
    session?.close()
    this.#sessions.delete(id)
  }

  async close(): Promise<void> {
    await this.#presencePublisher?.close()
    this.#relayAbort?.abort()
    this.#relayConnection?.close()
    await this.#relayTask?.catch(() => undefined)
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

  #assertRelayDescriptor(descriptor: SignedSupervisorTransport): void {
    const relay = descriptor.payload.relay
    const presence = this.presence().relay
    if (relay === null && presence === null) return
    if (
      relay === null ||
      presence === null ||
      relay.endpoint !== presence.endpoint ||
      relay.relayId !== presence.relayId ||
      relay.relayFingerprint !== presence.relayFingerprint ||
      relay.rendezvousId !== presence.rendezvousId ||
      relay.rendezvousCapability !== presence.rendezvousCapability ||
      relay.hostTransportFingerprint !== presence.hostTransportFingerprint
    ) {
      throw new Error('Supervisor Relay descriptor mismatch')
    }
  }

  #startRelayPresence(): void {
    const relay = this.presence().relay
    if (relay === null) return
    if (this.#relayTask !== undefined) return
    const abort = new AbortController()
    this.#relayAbort = abort
    this.#relayTask = this.#maintainRelayPresence(relay, abort)
    this.#startupTimeline?.mark('RELAY_START')
    void this.#relayTask.catch(() => undefined)
  }

  async #connectRelayHost(
    relay: NonNullable<SignedSupervisorTransport['payload']['relay']>,
    signal: AbortSignal,
  ): Promise<SupervisorRelayControlConnection> {
    const connection = await connectSupervisorRelayHost({
      ...parseSupervisorRelayEndpoint(relay.endpoint, relay.relayFingerprint),
      expectedRelayId: relay.relayId,
      expectedRelayFingerprint: relay.relayFingerprint,
      rendezvousId: relay.rendezvousId,
      rendezvousCapability: relay.rendezvousCapability,
      hostTransportFingerprint: relay.hostTransportFingerprint,
      identity: this.#server.tlsIdentity,
      clientBuildIdentity: this.#clientBuildIdentity,
      signal,
    })
    connection.setChannelHandler(async (offer) => {
      const stream = await offer.accept()
      void this.#server.acceptRelayStream(stream, signal).catch(() => {
        stream.destroy()
      })
    })
    process.stderr.write(
      `${JSON.stringify({ component: 'host', event: 'supervisor.relay.presence', state: 'online' })}\n`,
    )
    return connection
  }

  async #maintainRelayPresence(
    relay: NonNullable<SignedSupervisorTransport['payload']['relay']>,
    abort: AbortController,
  ): Promise<void> {
    let delayMs = RELAY_RECONNECT_MINIMUM_MS
    while (!abort.signal.aborted) {
      try {
        const connection = await this.#connectRelayHost(relay, abort.signal)
        this.#relayConnection = connection
        delayMs = RELAY_RECONNECT_MINIMUM_MS
        await connection.completion.catch(() => undefined)
        if (this.#relayConnection === connection) {
          this.#relayConnection = undefined
        }
      } catch {
        delayMs = Math.min(delayMs * 2, RELAY_RECONNECT_MAXIMUM_MS)
      }
      if (abort.signal.aborted) return
      process.stderr.write(
        `${JSON.stringify({ component: 'host', event: 'supervisor.relay.presence', state: 'reconnecting' })}\n`,
      )
      await waitForReconnect(delayMs, abort.signal)
    }
  }
}

export function parseSupervisorRelayConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): SupervisorRelayConfiguration | undefined {
  const endpoint = environment.CODETETHER_SUPERVISOR_RELAY_ENDPOINT?.trim()
  const relayId = environment.CODETETHER_SUPERVISOR_RELAY_ID?.trim()
  const relayFingerprint =
    environment.CODETETHER_SUPERVISOR_RELAY_FINGERPRINT?.trim()
  if (
    endpoint === undefined &&
    relayId === undefined &&
    relayFingerprint === undefined
  ) {
    return undefined
  }
  if (
    endpoint === undefined ||
    relayId === undefined ||
    relayFingerprint === undefined ||
    !/^relay_[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/u.test(relayId) ||
    !/^[A-Za-z0-9_-]{43}$/u.test(relayFingerprint)
  ) {
    throw new Error('Supervisor Relay environment is incomplete or invalid')
  }
  const parsed = new URL(endpoint)
  parseSupervisorRelayEndpoint(parsed.toString(), relayFingerprint)
  return { endpoint: parsed.toString(), relayId, relayFingerprint }
}

function parseSupervisorRelayEndpoint(
  value: string,
  relayFingerprint: string,
): {
  readonly endpoint: { readonly host: string; readonly port: number }
  readonly tls:
    | { readonly mode: 'public_ca'; readonly serverName: string }
    | {
        readonly mode: 'pinned_certificate'
        readonly certificatePublicKeyFingerprint: string
        readonly serverName?: string
      }
} {
  const url = new URL(value)
  if (
    (url.protocol !== 'tls:' && url.protocol !== 'tls+pinned:') ||
    url.username !== '' ||
    url.password !== '' ||
    (url.pathname !== '' && url.pathname !== '/') ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error('Supervisor Relay endpoint is invalid')
  }
  const port = url.port === '' ? 443 : Number(url.port)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Supervisor Relay endpoint is invalid')
  }
  const endpoint = { host: url.hostname, port }
  return url.protocol === 'tls:'
    ? { endpoint, tls: { mode: 'public_ca', serverName: url.hostname } }
    : {
        endpoint,
        tls: {
          mode: 'pinned_certificate',
          certificatePublicKeyFingerprint: relayFingerprint,
        },
      }
}

function isRelayFallbackEligible(error: unknown): boolean {
  if (error instanceof SupervisorClientError) {
    return error.code === 'remote_host_unreachable'
  }
  let current: unknown = error
  for (let depth = 0; depth < 5; depth += 1) {
    if (!(current instanceof Error)) break
    const code = (current as Error & { readonly code?: unknown }).code
    if (
      typeof code === 'string' &&
      [
        'ABORT_ERR',
        'EADDRNOTAVAIL',
        'EAFNOSUPPORT',
        'EAI_AGAIN',
        'ECONNREFUSED',
        'ECONNRESET',
        'EHOSTUNREACH',
        'ENETDOWN',
        'ENETUNREACH',
        'ENOTFOUND',
        'ETIMEDOUT',
      ].includes(code)
    ) {
      return true
    }
    if (
      current.name === 'AbortError' ||
      current.name === 'TimeoutError' ||
      /timed out|timeout/iu.test(current.message)
    ) {
      return true
    }
    current = current.cause
  }
  return false
}

async function waitForReconnect(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return
  await new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, delayMs)
    signal.addEventListener('abort', finish, { once: true })
  })
}

export function discoverSupervisorDirectHosts(
  interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces(),
): readonly string[] {
  const externalIpv4 = Object.values(interfaces)
    .flatMap((entries) => entries ?? [])
    .filter(
      (entry) =>
        entry.family === 'IPv4' &&
        entry.internal === false &&
        entry.address !== '0.0.0.0' &&
        !isLoopbackSupervisorHost(entry.address),
    )
    .map((entry) => entry.address)
    .sort()
  return [...new Set(externalIpv4)].slice(
    0,
    supervisorTransportLimits.maximumEndpoints,
  )
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

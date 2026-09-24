import { createHash } from 'node:crypto'

import {
  FramedRelayConnection,
  RelayProtocolError,
  RelaySupervisorClientMessageSchema,
  fingerprintRelayPublicKeySpki,
  newRelayChannelGeneration,
  newRelayChannelId,
  newRelayConnectionEpoch,
  newRelayPingId,
  relayProtocolLimits,
  relayProtocolVersion,
  relaySupervisorAuthenticationTranscript,
  verifyRelayTranscript,
  type RelayChallengeMessage,
  type RelayChannelId,
  type RelayConnectionEpoch,
  type RelaySupervisorAuthenticateMessage,
  type RelaySupervisorChannelBinding,
  type RelaySupervisorClientMessage,
} from '@codetether/relay-protocol'

interface SupervisorEndpoint {
  readonly role: 'host' | 'device'
  readonly rendezvousId: string
  readonly capabilityDigest: string
  readonly hostTransportFingerprint: string
  readonly transportFingerprint: string
  readonly epoch: RelayConnectionEpoch
  readonly framed: FramedRelayConnection
  readonly pendingPings: Map<string, number>
  lastHeartbeatAcknowledgedAt: number
  invalidated: boolean
}

interface SupervisorChannel {
  readonly channelId: ReturnType<typeof newRelayChannelId>
  readonly channelGeneration: ReturnType<typeof newRelayChannelGeneration>
  readonly requestId: string
  readonly device: SupervisorEndpoint
  readonly host: SupervisorEndpoint
  readonly deviceConnectionEpoch: RelayConnectionEpoch
  readonly hostConnectionEpoch: RelayConnectionEpoch
  state: 'opening' | 'open'
  nextDeviceSequence: number
  nextHostSequence: number
  deviceOutstandingSequence: number | undefined
  hostOutstandingSequence: number | undefined
  openTimer: ReturnType<typeof setTimeout> | undefined
  deviceAcknowledgementTimer: ReturnType<typeof setTimeout> | undefined
  hostAcknowledgementTimer: ReturnType<typeof setTimeout> | undefined
}

export interface RelaySupervisorHubOptions {
  readonly heartbeatIntervalMs: number
  readonly heartbeatTimeoutMs: number
  readonly channelOpenTimeoutMs: number
  readonly channelAcknowledgementTimeoutMs: number
  readonly maximumChannels: number
  readonly maximumChannelsPerPeer: number
  readonly monotonicNow: () => number
  readonly log?: (
    event: string,
    fields: Readonly<Record<string, string | number | boolean>>,
  ) => void
}

/**
 * Ephemeral ProductDevice/Host rendezvous. It owns routing and bounded opaque
 * frames only; Supervisor TLS and product authorization remain end-to-end.
 */
export class RelaySupervisorHub {
  readonly #options: RelaySupervisorHubOptions
  readonly #hosts = new Map<string, SupervisorEndpoint>()
  readonly #connections = new Set<SupervisorEndpoint>()
  readonly #channels = new Map<RelayChannelId, SupervisorChannel>()
  readonly #closedChannelTombstones = new Map<
    RelayChannelId,
    {
      readonly channel: SupervisorChannel
      readonly timer: ReturnType<typeof setTimeout>
      exactLateFrames: number
    }
  >()
  #closing = false

  constructor(options: RelaySupervisorHubOptions) {
    this.#options = options
  }

  get activeConnections(): number {
    return this.#connections.size
  }

  get activeChannels(): number {
    return this.#channels.size
  }

  async handle(
    challenge: RelayChallengeMessage,
    message: RelaySupervisorAuthenticateMessage,
    framed: FramedRelayConnection,
  ): Promise<void> {
    if (this.#closing) throw authenticationFailed()
    this.#authenticate(challenge, message)
    const capabilityDigest = digestCapability(message.rendezvousCapability)
    const endpoint: SupervisorEndpoint = {
      role: message.role,
      rendezvousId: message.rendezvousId,
      capabilityDigest,
      hostTransportFingerprint: message.hostTransportFingerprint,
      transportFingerprint: message.transportFingerprint,
      epoch: newRelayConnectionEpoch(),
      framed,
      pendingPings: new Map(),
      lastHeartbeatAcknowledgedAt: this.#options.monotonicNow(),
      invalidated: false,
    }
    if (message.role === 'host') this.#registerHost(endpoint)
    else this.#assertHostAvailable(endpoint)
    this.#connections.add(endpoint)
    await framed.send({
      type: 'supervisor.ready',
      protocolVersion: relayProtocolVersion,
      role: endpoint.role,
      connectionEpoch: endpoint.epoch,
      heartbeatIntervalMs: this.#options.heartbeatIntervalMs,
      heartbeatTimeoutMs: this.#options.heartbeatTimeoutMs,
      authenticatedAt: new Date().toISOString(),
    })
    this.#options.log?.('supervisor.connection.authenticated', {
      role: endpoint.role,
      rendezvousId: endpoint.rendezvousId,
    })
    if (message.role === 'device') {
      await this.#openChannel(endpoint, message.requestId)
    }
    const heartbeat = setInterval(
      () => void this.#heartbeat(endpoint),
      this.#options.heartbeatIntervalMs,
    )
    heartbeat.unref()
    try {
      while (!this.#closing && !endpoint.invalidated && !framed.closed) {
        const next = await framed.receive(RelaySupervisorClientMessageSchema, {
          timeoutMs: null,
        })
        await this.#handleMessage(endpoint, next)
      }
    } finally {
      clearInterval(heartbeat)
      this.#removeEndpoint(endpoint, 'peer_disconnected')
    }
  }

  close(): void {
    if (this.#closing) return
    this.#closing = true
    for (const endpoint of [...this.#connections]) {
      this.#removeEndpoint(endpoint, 'relay_shutdown')
    }
    for (const tombstone of this.#closedChannelTombstones.values()) {
      clearTimeout(tombstone.timer)
    }
    this.#closedChannelTombstones.clear()
  }

  #authenticate(
    challenge: RelayChallengeMessage,
    message: RelaySupervisorAuthenticateMessage,
  ): void {
    if (
      fingerprintRelayPublicKeySpki(message.transportPublicKeySpki) !==
        message.transportFingerprint ||
      (message.role === 'host' &&
        message.transportFingerprint !== message.hostTransportFingerprint) ||
      !verifyRelayTranscript(
        message.transportPublicKeySpki,
        relaySupervisorAuthenticationTranscript({
          challenge,
          role: message.role,
          rendezvousId: message.rendezvousId,
          rendezvousCapability: message.rendezvousCapability,
          hostTransportFingerprint: message.hostTransportFingerprint,
          transportPublicKeySpki: message.transportPublicKeySpki,
          transportFingerprint: message.transportFingerprint,
          clientBuildIdentity: message.clientBuildIdentity,
          ...(message.type === 'supervisor.device.connect'
            ? { requestId: message.requestId }
            : {}),
        }),
        message.signature,
      )
    ) {
      throw authenticationFailed()
    }
  }

  #registerHost(endpoint: SupervisorEndpoint): void {
    const current = this.#hosts.get(endpoint.rendezvousId)
    if (
      current !== undefined &&
      (current.capabilityDigest !== endpoint.capabilityDigest ||
        current.hostTransportFingerprint !== endpoint.hostTransportFingerprint)
    ) {
      throw authenticationFailed()
    }
    if (current !== undefined) {
      this.#removeEndpoint(current, 'connection_replaced')
    }
    this.#hosts.set(endpoint.rendezvousId, endpoint)
  }

  #assertHostAvailable(endpoint: SupervisorEndpoint): void {
    const host = this.#hosts.get(endpoint.rendezvousId)
    if (
      host === undefined ||
      host.invalidated ||
      host.capabilityDigest !== endpoint.capabilityDigest ||
      host.hostTransportFingerprint !== endpoint.hostTransportFingerprint
    ) {
      throw authenticationFailed()
    }
  }

  async #openChannel(
    device: SupervisorEndpoint,
    requestId: string,
  ): Promise<void> {
    const host = this.#hosts.get(device.rendezvousId)
    if (host === undefined || host.invalidated) throw authenticationFailed()
    if (
      this.#channels.size >= this.#options.maximumChannels ||
      this.#countChannels(device) >= this.#options.maximumChannelsPerPeer ||
      this.#countChannels(host) >= this.#options.maximumChannelsPerPeer
    ) {
      throw new RelayProtocolError(
        'capacity_reached',
        'Relay Supervisor channel capacity reached',
      )
    }
    const channel: SupervisorChannel = {
      channelId: newRelayChannelId(),
      channelGeneration: newRelayChannelGeneration(),
      requestId,
      device,
      host,
      deviceConnectionEpoch: device.epoch,
      hostConnectionEpoch: host.epoch,
      state: 'opening',
      nextDeviceSequence: 1,
      nextHostSequence: 1,
      deviceOutstandingSequence: undefined,
      hostOutstandingSequence: undefined,
      openTimer: undefined,
      deviceAcknowledgementTimer: undefined,
      hostAcknowledgementTimer: undefined,
    }
    this.#channels.set(channel.channelId, channel)
    channel.openTimer = setTimeout(() => {
      void this.#closeChannel(channel, 'timeout')
    }, this.#options.channelOpenTimeoutMs)
    channel.openTimer.unref()
    try {
      await host.framed.send({
        type: 'supervisor.channel.offer',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: host.epoch,
        ...this.#binding(channel),
        requestId,
        deviceTransportFingerprint: device.transportFingerprint,
      })
    } catch {
      await this.#closeChannel(channel, 'peer_disconnected')
      throw authenticationFailed()
    }
  }

  async #handleMessage(
    endpoint: SupervisorEndpoint,
    message: RelaySupervisorClientMessage,
  ): Promise<void> {
    if (message.connectionEpoch !== endpoint.epoch) {
      throw new RelayProtocolError(
        'stale_connection',
        'Relay Supervisor connection epoch is stale',
      )
    }
    if (message.type === 'heartbeat.pong') {
      if (!endpoint.pendingPings.delete(message.pingId)) {
        throw new RelayProtocolError(
          'malformed_message',
          'Relay Supervisor heartbeat is invalid',
        )
      }
      endpoint.lastHeartbeatAcknowledgedAt = this.#options.monotonicNow()
      return
    }
    const channel = this.#resolveChannel(endpoint, message)
    if (channel === undefined) return
    if (message.type === 'supervisor.channel.accept') {
      if (
        endpoint !== channel.host ||
        channel.state !== 'opening' ||
        message.requestId !== channel.requestId
      ) {
        await this.#failChannel(channel, 'invalid_state')
        return
      }
      if (channel.openTimer !== undefined) clearTimeout(channel.openTimer)
      channel.openTimer = undefined
      channel.state = 'open'
      await Promise.all([
        this.#sendOpened(channel, channel.device),
        this.#sendOpened(channel, channel.host),
      ]).catch(() => this.#closeChannel(channel, 'peer_disconnected'))
      this.#options.log?.('supervisor.channel.opened', {
        rendezvousId: endpoint.rendezvousId,
      })
      return
    }
    if (message.type === 'supervisor.channel.reject') {
      if (endpoint !== channel.host || channel.state !== 'opening') {
        await this.#failChannel(channel, 'invalid_state')
        return
      }
      await this.#closeChannel(channel, 'peer_closed')
      return
    }
    if (message.type === 'supervisor.channel.data') {
      await this.#forwardData(endpoint, channel, message)
      return
    }
    if (message.type === 'supervisor.channel.data.ack') {
      await this.#forwardAcknowledgement(endpoint, channel, message)
      return
    }
    await this.#closeChannel(channel, 'peer_closed')
  }

  #resolveChannel(
    endpoint: SupervisorEndpoint,
    message: Exclude<
      RelaySupervisorClientMessage,
      { readonly type: 'heartbeat.pong' }
    >,
  ): SupervisorChannel | undefined {
    const channel = this.#channels.get(message.channelId)
    if (channel === undefined) {
      const tombstone = this.#closedChannelTombstones.get(message.channelId)
      if (
        tombstone !== undefined &&
        this.#matchesClosedChannel(tombstone, endpoint, message)
      ) {
        return undefined
      }
      throw new RelayProtocolError(
        'stale_connection',
        'Relay Supervisor channel binding is stale',
      )
    }
    if (
      (endpoint !== channel.device && endpoint !== channel.host) ||
      !sameBinding(this.#binding(channel), message)
    ) {
      throw new RelayProtocolError(
        'stale_connection',
        'Relay Supervisor channel binding is stale',
      )
    }
    return channel
  }

  async #forwardData(
    sender: SupervisorEndpoint,
    channel: SupervisorChannel,
    message: Extract<
      RelaySupervisorClientMessage,
      { readonly type: 'supervisor.channel.data' }
    >,
  ): Promise<void> {
    if (channel.state !== 'open')
      return await this.#failChannel(channel, 'invalid_state')
    const fromDevice = sender === channel.device
    const outstanding = fromDevice
      ? channel.deviceOutstandingSequence
      : channel.hostOutstandingSequence
    const expected = fromDevice
      ? channel.nextDeviceSequence
      : channel.nextHostSequence
    if (outstanding !== undefined || message.sequence !== expected) {
      return await this.#failChannel(channel, 'flow_control_violation')
    }
    if (fromDevice) {
      channel.deviceOutstandingSequence = message.sequence
      channel.nextDeviceSequence += 1
    } else {
      channel.hostOutstandingSequence = message.sequence
      channel.nextHostSequence += 1
    }
    const recipient = fromDevice ? channel.host : channel.device
    try {
      await recipient.framed.send({
        type: 'supervisor.channel.data',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: recipient.epoch,
        ...this.#binding(channel),
        sequence: message.sequence,
        data: message.data,
      })
      const timer = setTimeout(() => {
        void this.#failChannel(channel, 'flow_control_violation')
      }, this.#options.channelAcknowledgementTimeoutMs)
      timer.unref()
      if (fromDevice) channel.deviceAcknowledgementTimer = timer
      else channel.hostAcknowledgementTimer = timer
    } catch {
      await this.#closeChannel(channel, 'peer_disconnected')
    }
  }

  async #forwardAcknowledgement(
    acknowledger: SupervisorEndpoint,
    channel: SupervisorChannel,
    message: Extract<
      RelaySupervisorClientMessage,
      { readonly type: 'supervisor.channel.data.ack' }
    >,
  ): Promise<void> {
    if (channel.state !== 'open')
      return await this.#failChannel(channel, 'invalid_state')
    const acknowledgesDevice = acknowledger === channel.host
    const outstanding = acknowledgesDevice
      ? channel.deviceOutstandingSequence
      : channel.hostOutstandingSequence
    if (outstanding !== message.acknowledgedSequence) {
      return await this.#failChannel(channel, 'flow_control_violation')
    }
    const recipient = acknowledgesDevice ? channel.device : channel.host
    try {
      await recipient.framed.send({
        type: 'supervisor.channel.data.ack',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: recipient.epoch,
        ...this.#binding(channel),
        acknowledgedSequence: message.acknowledgedSequence,
      })
      if (acknowledgesDevice) {
        channel.deviceOutstandingSequence = undefined
        if (channel.deviceAcknowledgementTimer !== undefined)
          clearTimeout(channel.deviceAcknowledgementTimer)
        channel.deviceAcknowledgementTimer = undefined
      } else {
        channel.hostOutstandingSequence = undefined
        if (channel.hostAcknowledgementTimer !== undefined)
          clearTimeout(channel.hostAcknowledgementTimer)
        channel.hostAcknowledgementTimer = undefined
      }
    } catch {
      await this.#closeChannel(channel, 'peer_disconnected')
    }
  }

  async #sendOpened(
    channel: SupervisorChannel,
    endpoint: SupervisorEndpoint,
  ): Promise<void> {
    await endpoint.framed.send({
      type: 'supervisor.channel.opened',
      protocolVersion: relayProtocolVersion,
      connectionEpoch: endpoint.epoch,
      ...this.#binding(channel),
      requestId: channel.requestId,
    })
  }

  async #failChannel(
    channel: SupervisorChannel,
    code: 'stale_channel' | 'invalid_state' | 'flow_control_violation',
  ): Promise<void> {
    if (!this.#channels.has(channel.channelId)) return
    this.#removeChannel(channel)
    await Promise.allSettled(
      [channel.device, channel.host].map((endpoint) =>
        endpoint.framed.send({
          type: 'supervisor.channel.error',
          protocolVersion: relayProtocolVersion,
          connectionEpoch: endpoint.epoch,
          ...this.#binding(channel),
          requestId: channel.requestId,
          code,
        }),
      ),
    )
  }

  async #closeChannel(
    channel: SupervisorChannel,
    reason:
      | 'peer_closed'
      | 'peer_disconnected'
      | 'connection_replaced'
      | 'timeout'
      | 'relay_shutdown',
  ): Promise<void> {
    if (!this.#channels.has(channel.channelId)) return
    this.#removeChannel(channel)
    await Promise.allSettled(
      [channel.device, channel.host].map((endpoint) =>
        endpoint.framed.send({
          type: 'supervisor.channel.closed',
          protocolVersion: relayProtocolVersion,
          connectionEpoch: endpoint.epoch,
          ...this.#binding(channel),
          requestId: channel.requestId,
          reason,
        }),
      ),
    )
  }

  #removeChannel(channel: SupervisorChannel): void {
    if (!this.#channels.delete(channel.channelId)) return
    if (channel.openTimer !== undefined) clearTimeout(channel.openTimer)
    if (channel.deviceAcknowledgementTimer !== undefined)
      clearTimeout(channel.deviceAcknowledgementTimer)
    if (channel.hostAcknowledgementTimer !== undefined)
      clearTimeout(channel.hostAcknowledgementTimer)
    this.#rememberClosedChannel(channel)
  }

  #matchesClosedChannel(
    tombstone: {
      readonly channel: SupervisorChannel
      exactLateFrames: number
    },
    endpoint: SupervisorEndpoint,
    message: RelaySupervisorChannelBinding,
  ): boolean {
    const channel = tombstone.channel
    if (
      (endpoint !== channel.device && endpoint !== channel.host) ||
      !sameBinding(this.#binding(channel), message)
    ) {
      return false
    }
    tombstone.exactLateFrames += 1
    return (
      tombstone.exactLateFrames <=
      relayProtocolLimits.maximumTerminalChannelFrames
    )
  }

  #rememberClosedChannel(channel: SupervisorChannel): void {
    while (
      this.#closedChannelTombstones.size >= this.#options.maximumChannels
    ) {
      const oldestId = this.#closedChannelTombstones.keys().next().value as
        RelayChannelId | undefined
      if (oldestId === undefined) break
      const oldest = this.#closedChannelTombstones.get(oldestId)
      if (oldest !== undefined) clearTimeout(oldest.timer)
      this.#closedChannelTombstones.delete(oldestId)
    }
    const timer = setTimeout(() => {
      if (
        this.#closedChannelTombstones.get(channel.channelId)?.timer === timer
      ) {
        this.#closedChannelTombstones.delete(channel.channelId)
      }
    }, this.#options.channelAcknowledgementTimeoutMs)
    timer.unref()
    this.#closedChannelTombstones.set(channel.channelId, {
      channel,
      timer,
      exactLateFrames: 0,
    })
  }

  #removeEndpoint(
    endpoint: SupervisorEndpoint,
    reason: 'peer_disconnected' | 'connection_replaced' | 'relay_shutdown',
  ): void {
    if (endpoint.invalidated) return
    endpoint.invalidated = true
    this.#connections.delete(endpoint)
    if (this.#hosts.get(endpoint.rendezvousId) === endpoint) {
      this.#hosts.delete(endpoint.rendezvousId)
    }
    for (const channel of [...this.#channels.values()]) {
      if (channel.device === endpoint || channel.host === endpoint) {
        void this.#closeChannel(channel, reason)
      }
    }
    endpoint.framed.destroy()
    this.#options.log?.('supervisor.connection.closed', {
      role: endpoint.role,
      rendezvousId: endpoint.rendezvousId,
      reason,
    })
  }

  async #heartbeat(endpoint: SupervisorEndpoint): Promise<void> {
    if (endpoint.invalidated || endpoint.framed.closed) return
    const now = this.#options.monotonicNow()
    if (
      now - endpoint.lastHeartbeatAcknowledgedAt >=
      this.#options.heartbeatTimeoutMs
    ) {
      this.#removeEndpoint(endpoint, 'peer_disconnected')
      return
    }
    if (endpoint.pendingPings.size >= 8) {
      this.#removeEndpoint(endpoint, 'peer_disconnected')
      return
    }
    const pingId = newRelayPingId()
    endpoint.pendingPings.set(pingId, now)
    try {
      await endpoint.framed.send({
        type: 'heartbeat.ping',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: endpoint.epoch,
        pingId,
        sentAt: new Date().toISOString(),
      })
    } catch {
      this.#removeEndpoint(endpoint, 'peer_disconnected')
    }
  }

  #binding(channel: SupervisorChannel): RelaySupervisorChannelBinding {
    return {
      channelId: channel.channelId,
      channelGeneration: channel.channelGeneration,
      deviceConnectionEpoch: channel.deviceConnectionEpoch,
      hostConnectionEpoch: channel.hostConnectionEpoch,
    }
  }

  #countChannels(endpoint: SupervisorEndpoint): number {
    let count = 0
    for (const channel of this.#channels.values()) {
      if (channel.device === endpoint || channel.host === endpoint) count += 1
    }
    return count
  }
}

function digestCapability(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url')
}

function sameBinding(
  left: RelaySupervisorChannelBinding,
  right: RelaySupervisorChannelBinding,
): boolean {
  return (
    left.channelId === right.channelId &&
    left.channelGeneration === right.channelGeneration &&
    left.deviceConnectionEpoch === right.deviceConnectionEpoch &&
    left.hostConnectionEpoch === right.hostConnectionEpoch
  )
}

function authenticationFailed(): RelayProtocolError {
  return new RelayProtocolError(
    'authentication_failed',
    'Relay Supervisor authentication failed',
  )
}

import {
  type RelayChannelGeneration,
  type RelayChannelId,
  type RelayChannelPurpose,
  type RelayConnectionEpoch,
  type RelayPublicKeyFingerprint,
  type RelayRequestId,
  newRelayChannelGeneration,
  newRelayChannelId,
} from '@codetether/relay-protocol'

export interface RelayChannelEndpoint {
  readonly peer: {
    readonly fingerprint: RelayPublicKeyFingerprint
    readonly role: 'controller' | 'node'
  }
  readonly epoch: RelayConnectionEpoch
}

export interface RelayEphemeralChannel<
  TConnection extends RelayChannelEndpoint = RelayChannelEndpoint,
> {
  readonly channelId: RelayChannelId
  readonly channelGeneration: RelayChannelGeneration
  readonly requestId: RelayRequestId
  readonly purpose: RelayChannelPurpose
  readonly controller: TConnection
  readonly node: TConnection
  readonly controllerConnectionEpoch: RelayConnectionEpoch
  readonly nodeConnectionEpoch: RelayConnectionEpoch
  readonly createdAt: number
  state: 'opening' | 'open'
  nextControllerSequence: number
  nextNodeSequence: number
  controllerOutstandingSequence: number | undefined
  controllerOutstandingBytes: number | undefined
  nodeOutstandingSequence: number | undefined
  nodeOutstandingBytes: number | undefined
}

export type RelayChannelCreateResult<TConnection extends RelayChannelEndpoint> =
  | { readonly ok: true; readonly channel: RelayEphemeralChannel<TConnection> }
  | { readonly ok: false; readonly reason: 'global' | 'peer' | 'duplicate' }

/**
 * Owns only live, in-memory channel routing. Channel identity, ciphertext and
 * connection epochs deliberately never enter Relay persistence.
 */
export class RelayChannelRegistry<TConnection extends RelayChannelEndpoint> {
  readonly #channels = new Map<
    RelayChannelId,
    RelayEphemeralChannel<TConnection>
  >()
  readonly #connectionChannels = new Map<TConnection, Set<RelayChannelId>>()
  readonly #controllerRequests = new Map<
    string,
    RelayEphemeralChannel<TConnection>
  >()

  constructor(
    readonly maximumChannels: number,
    readonly maximumChannelsPerPeer: number,
  ) {}

  create(input: {
    readonly requestId: RelayRequestId
    readonly purpose: RelayChannelPurpose
    readonly controller: TConnection
    readonly node: TConnection
    readonly now?: number
  }): RelayChannelCreateResult<TConnection> {
    if (this.#channels.size >= this.maximumChannels) {
      return { ok: false, reason: 'global' }
    }
    if (
      this.countForConnection(input.controller) >=
        this.maximumChannelsPerPeer ||
      this.countForConnection(input.node) >= this.maximumChannelsPerPeer
    ) {
      return { ok: false, reason: 'peer' }
    }
    const requestKey = controllerRequestKey(input.controller, input.requestId)
    if (this.#controllerRequests.has(requestKey)) {
      return { ok: false, reason: 'duplicate' }
    }
    const channel: RelayEphemeralChannel<TConnection> = {
      channelId: newRelayChannelId(),
      channelGeneration: newRelayChannelGeneration(),
      requestId: input.requestId,
      purpose: input.purpose,
      controller: input.controller,
      node: input.node,
      controllerConnectionEpoch: input.controller.epoch,
      nodeConnectionEpoch: input.node.epoch,
      createdAt: input.now ?? Date.now(),
      state: 'opening',
      nextControllerSequence: 1,
      nextNodeSequence: 1,
      controllerOutstandingSequence: undefined,
      controllerOutstandingBytes: undefined,
      nodeOutstandingSequence: undefined,
      nodeOutstandingBytes: undefined,
    }
    this.#channels.set(channel.channelId, channel)
    this.#controllerRequests.set(requestKey, channel)
    this.#addConnectionChannel(input.controller, channel.channelId)
    this.#addConnectionChannel(input.node, channel.channelId)
    return { ok: true, channel }
  }

  get(
    channelId: RelayChannelId,
  ): RelayEphemeralChannel<TConnection> | undefined {
    return this.#channels.get(channelId)
  }

  owns(channel: RelayEphemeralChannel<TConnection>): boolean {
    return this.#channels.get(channel.channelId) === channel
  }

  remove(channel: RelayEphemeralChannel<TConnection>): boolean {
    if (!this.owns(channel)) return false
    this.#channels.delete(channel.channelId)
    this.#controllerRequests.delete(
      controllerRequestKey(channel.controller, channel.requestId),
    )
    this.#removeConnectionChannel(channel.controller, channel.channelId)
    this.#removeConnectionChannel(channel.node, channel.channelId)
    return true
  }

  channelsForConnection(
    connection: TConnection,
  ): readonly RelayEphemeralChannel<TConnection>[] {
    const ids = this.#connectionChannels.get(connection)
    if (ids === undefined) return []
    const channels: RelayEphemeralChannel<TConnection>[] = []
    for (const id of ids) {
      const channel = this.#channels.get(id)
      if (channel !== undefined) channels.push(channel)
    }
    return channels
  }

  values(): readonly RelayEphemeralChannel<TConnection>[] {
    return [...this.#channels.values()]
  }

  countForConnection(connection: TConnection): number {
    return this.#connectionChannels.get(connection)?.size ?? 0
  }

  get count(): number {
    return this.#channels.size
  }

  get openingCount(): number {
    let count = 0
    for (const channel of this.#channels.values()) {
      if (channel.state === 'opening') count += 1
    }
    return count
  }

  get outstandingDataFrames(): number {
    let count = 0
    for (const channel of this.#channels.values()) {
      if (channel.controllerOutstandingSequence !== undefined) count += 1
      if (channel.nodeOutstandingSequence !== undefined) count += 1
    }
    return count
  }

  get outstandingDataBytes(): number {
    let bytes = 0
    for (const channel of this.#channels.values()) {
      bytes += channel.controllerOutstandingBytes ?? 0
      bytes += channel.nodeOutstandingBytes ?? 0
    }
    return bytes
  }

  #addConnectionChannel(
    connection: TConnection,
    channelId: RelayChannelId,
  ): void {
    const ids = this.#connectionChannels.get(connection) ?? new Set()
    ids.add(channelId)
    this.#connectionChannels.set(connection, ids)
  }

  #removeConnectionChannel(
    connection: TConnection,
    channelId: RelayChannelId,
  ): void {
    const ids = this.#connectionChannels.get(connection)
    if (ids === undefined) return
    ids.delete(channelId)
    if (ids.size === 0) this.#connectionChannels.delete(connection)
  }
}

function controllerRequestKey(
  controller: RelayChannelEndpoint,
  requestId: RelayRequestId,
): string {
  return `${controller.peer.fingerprint}:${controller.epoch}:${requestId}`
}

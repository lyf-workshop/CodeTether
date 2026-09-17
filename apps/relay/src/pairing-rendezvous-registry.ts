import { createHash, timingSafeEqual } from 'node:crypto'

import {
  relayProtocolLimits,
  type RelayPairingCapabilityDigest,
  type RelayPairingRendezvousId,
  type RelayPublicKeyFingerprint,
} from '@codetether/relay-protocol'

export interface RelayPairingRendezvous<TNode> {
  readonly rendezvousId: RelayPairingRendezvousId
  readonly capabilityDigest: RelayPairingCapabilityDigest
  readonly nodeFingerprint: RelayPublicKeyFingerprint
  readonly node: TNode
  readonly expiresAt: string
  openAttempts: number
}

export type RelayPairingRegistrationResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly reason: 'capacity' | 'node_capacity' | 'invalid_expiry'
    }

/** Owns only short-lived, in-memory first-pairing capabilities. */
export class RelayPairingRendezvousRegistry<TNode> {
  readonly #entries = new Map<
    RelayPairingRendezvousId,
    RelayPairingRendezvous<TNode>
  >()
  readonly #nodeEntries = new Map<TNode, RelayPairingRendezvousId>()
  readonly #timers = new Map<RelayPairingRendezvousId, NodeJS.Timeout>()

  constructor(
    readonly maximumEntries = relayProtocolLimits.maximumPairingRendezvous,
    readonly maximumPerNode = relayProtocolLimits.maximumPairingRendezvousPerNode,
    readonly maximumOpenAttempts = relayProtocolLimits.maximumPairingOpenAttempts,
    readonly maximumLifetimeMs = relayProtocolLimits.maximumPairingLifetimeMs,
    readonly onExpired?: (rendezvous: RelayPairingRendezvous<TNode>) => void,
  ) {}

  register(input: {
    readonly rendezvousId: RelayPairingRendezvousId
    readonly capabilityDigest: RelayPairingCapabilityDigest
    readonly nodeFingerprint: RelayPublicKeyFingerprint
    readonly node: TNode
    readonly expiresAt: string
    readonly now?: number
  }): RelayPairingRegistrationResult {
    const now = input.now ?? Date.now()
    const expiry = Date.parse(input.expiresAt)
    if (
      !Number.isFinite(expiry) ||
      expiry <= now ||
      expiry - now > this.maximumLifetimeMs
    ) {
      return { ok: false, reason: 'invalid_expiry' }
    }
    if (this.#entries.has(input.rendezvousId)) {
      return { ok: false, reason: 'capacity' }
    }
    if (this.#entries.size >= this.maximumEntries) {
      return { ok: false, reason: 'capacity' }
    }
    if (this.maximumPerNode <= 0 || this.#nodeEntries.has(input.node)) {
      return { ok: false, reason: 'node_capacity' }
    }
    const rendezvous: RelayPairingRendezvous<TNode> = {
      rendezvousId: input.rendezvousId,
      capabilityDigest: input.capabilityDigest,
      nodeFingerprint: input.nodeFingerprint,
      node: input.node,
      expiresAt: new Date(expiry).toISOString(),
      openAttempts: 0,
    }
    this.#entries.set(rendezvous.rendezvousId, rendezvous)
    this.#nodeEntries.set(input.node, rendezvous.rendezvousId)
    const timer = setTimeout(
      () => {
        if (!this.remove(rendezvous.rendezvousId, input.node)) return
        this.onExpired?.(rendezvous)
      },
      Math.max(1, expiry - now),
    )
    timer.unref()
    this.#timers.set(rendezvous.rendezvousId, timer)
    return { ok: true }
  }

  authorize(input: {
    readonly rendezvousId: RelayPairingRendezvousId
    readonly capability: string
    readonly targetNodeFingerprint: RelayPublicKeyFingerprint
    readonly now?: number
  }): RelayPairingRendezvous<TNode> | undefined {
    const rendezvous = this.#entries.get(input.rendezvousId)
    if (rendezvous === undefined) return undefined
    if (Date.parse(rendezvous.expiresAt) <= (input.now ?? Date.now())) {
      this.remove(rendezvous.rendezvousId, rendezvous.node)
      this.onExpired?.(rendezvous)
      return undefined
    }
    rendezvous.openAttempts += 1
    if (rendezvous.openAttempts > this.maximumOpenAttempts) {
      this.remove(rendezvous.rendezvousId, rendezvous.node)
      return undefined
    }
    if (
      rendezvous.nodeFingerprint !== input.targetNodeFingerprint ||
      !safeDigestEqual(
        rendezvous.capabilityDigest,
        createHash('sha256')
          .update(input.capability, 'utf8')
          .digest('base64url'),
      )
    ) {
      return undefined
    }
    return rendezvous
  }

  consume(
    rendezvousId: RelayPairingRendezvousId,
    node: TNode,
  ): RelayPairingRendezvous<TNode> | undefined {
    const rendezvous = this.#entries.get(rendezvousId)
    if (rendezvous?.node !== node) return undefined
    this.remove(rendezvousId, node)
    return rendezvous
  }

  remove(rendezvousId: RelayPairingRendezvousId, node: TNode): boolean {
    const rendezvous = this.#entries.get(rendezvousId)
    if (rendezvous?.node !== node) return false
    this.#entries.delete(rendezvousId)
    if (this.#nodeEntries.get(node) === rendezvousId) {
      this.#nodeEntries.delete(node)
    }
    const timer = this.#timers.get(rendezvousId)
    if (timer !== undefined) clearTimeout(timer)
    this.#timers.delete(rendezvousId)
    return true
  }

  removeForNode(node: TNode): RelayPairingRendezvous<TNode> | undefined {
    const rendezvousId = this.#nodeEntries.get(node)
    if (rendezvousId === undefined) return undefined
    const rendezvous = this.#entries.get(rendezvousId)
    this.remove(rendezvousId, node)
    return rendezvous
  }

  clear(): void {
    for (const timer of this.#timers.values()) clearTimeout(timer)
    this.#timers.clear()
    this.#entries.clear()
    this.#nodeEntries.clear()
  }

  get count(): number {
    return this.#entries.size
  }
}

function safeDigestEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8')
  const rightBytes = Buffer.from(right, 'utf8')
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  )
}

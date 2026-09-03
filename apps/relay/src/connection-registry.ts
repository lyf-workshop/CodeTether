import type {
  RelayConnectionEpoch,
  RelayPeerRecord as ProtocolPeerRecord,
} from './internal-types.js'

export interface RelayOwnedConnection {
  readonly peer: ProtocolPeerRecord
  readonly epoch: RelayConnectionEpoch
  invalidate(reason: 'replaced' | 'revoked' | 'shutdown'): void
}

export class RelayConnectionRegistry<T extends RelayOwnedConnection> {
  readonly #connections = new Map<string, T>()

  replace(connection: T): T | undefined {
    const previous = this.#connections.get(connection.peer.fingerprint)
    this.#connections.set(connection.peer.fingerprint, connection)
    if (previous !== undefined && previous !== connection) {
      previous.invalidate('replaced')
    }
    return previous
  }

  current(peerFingerprint: string): T | undefined {
    return this.#connections.get(peerFingerprint)
  }

  owns(connection: T): boolean {
    return this.#connections.get(connection.peer.fingerprint) === connection
  }

  remove(connection: T): boolean {
    if (!this.owns(connection)) return false
    return this.#connections.delete(connection.peer.fingerprint)
  }

  values(): readonly T[] {
    return [...this.#connections.values()]
  }

  count(role?: 'controller' | 'node'): number {
    if (role === undefined) return this.#connections.size
    let count = 0
    for (const connection of this.#connections.values()) {
      if (connection.peer.role === role) count += 1
    }
    return count
  }

  clear(reason: 'shutdown'): void {
    const connections = [...this.#connections.values()]
    this.#connections.clear()
    for (const connection of connections) connection.invalidate(reason)
  }
}

import type { ControllerId } from '@codetether/machine-transport'

/**
 * Process-local ownership for one authenticated Machine connection.
 *
 * This is deliberately not part of the Machine wire protocol or durable Node
 * state. It lets a newer connection from the same paired Controller retire an
 * exact idle Provider session that is still held by a stale socket.
 */
export interface RemoteProviderSessionConnectionOwner {
  readonly controllerId: ControllerId
  readonly generation: bigint
  readonly retire: () => void
}

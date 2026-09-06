import { randomUUID } from 'node:crypto'

import {
  ItemIdSchema,
  type ConversationRecord,
  type TurnId,
  type TurnRecord,
} from '@codetether/protocol'

import type { DurableConversationOrigin } from '../persistence/conversation-store.js'

export const MAX_PROVIDER_ITEMS_PER_TURN = 1024

export class ProviderItemCapacityError extends Error {
  constructor(readonly maxItems: number) {
    super(`Provider Item identity limit of ${String(maxItems)} was reached`)
    this.name = 'ProviderItemCapacityError'
  }
}

export interface ConversationState {
  record: ConversationRecord
  readonly origin: DurableConversationOrigin
  /** Absent only for a newly created lazy remote Conversation. */
  providerThreadId?: string
  readonly turns: Map<TurnId, TurnState>
  readonly providerTurnIds: Map<string, TurnId>
  providerSessionMaterialized: boolean
  providerSession: 'uninitialized' | 'ready' | 'needs-resume' | 'unavailable'
  startingTurn: boolean
}

export interface TurnState {
  record: TurnRecord
  providerTurnId?: string
  readonly providerItems: Map<string, ReturnType<typeof ItemIdSchema.parse>>
  interrupting: boolean
}

export function publicItemId(
  turn: TurnState,
  providerItemId: string,
): ReturnType<typeof ItemIdSchema.parse> {
  const existing = turn.providerItems.get(providerItemId)
  if (existing !== undefined) return existing
  if (turn.providerItems.size >= MAX_PROVIDER_ITEMS_PER_TURN) {
    throw new ProviderItemCapacityError(MAX_PROVIDER_ITEMS_PER_TURN)
  }
  const itemId = ItemIdSchema.parse(`item_${randomUUID().replaceAll('-', '')}`)
  turn.providerItems.set(providerItemId, itemId)
  return itemId
}

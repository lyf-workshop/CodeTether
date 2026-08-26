import { randomUUID } from 'node:crypto'

import {
  ItemIdSchema,
  type ConversationRecord,
  type TurnId,
  type TurnRecord,
} from '@codetether/protocol'

export interface ConversationState {
  record: ConversationRecord
  readonly providerThreadId: string
  readonly turns: Map<TurnId, TurnState>
  readonly providerTurnIds: Map<string, TurnId>
  startingTurn: boolean
}

export interface TurnState {
  record: TurnRecord
  readonly providerTurnId: string
  readonly providerItems: Map<string, ReturnType<typeof ItemIdSchema.parse>>
  interrupting: boolean
}

export function publicItemId(
  turn: TurnState,
  providerItemId: string,
): ReturnType<typeof ItemIdSchema.parse> {
  const existing = turn.providerItems.get(providerItemId)
  if (existing !== undefined) return existing
  const itemId = ItemIdSchema.parse(`item_${randomUUID().replaceAll('-', '')}`)
  turn.providerItems.set(providerItemId, itemId)
  return itemId
}

import type {
  ConversationSearchResult,
  ConversationStatus,
  TurnId,
} from '@codetether/protocol'

import { formatConversationActivity } from '../conversations/conversation-list-model.js'
import type {
  ConversationRailFilter,
  ConversationRailItemViewModel,
} from './conversation-view-model.js'

export interface ConversationRailSearchItem {
  readonly conversation: ConversationRailItemViewModel
  readonly matchDescription: string
  readonly targetTurnId?: TurnId
}

/** Maps the existing Rail execution filter to the Host Search contract. */
export function conversationRailSearchStatus(
  filter: ConversationRailFilter,
): ConversationStatus | undefined {
  return filter === 'all' ? undefined : filter
}

/** Preserves the Host result order while adapting only bounded presentation. */
export function presentConversationRailSearchResult(
  result: ConversationSearchResult,
): ConversationRailSearchItem {
  const { conversation } = result
  return {
    conversation: {
      id: conversation.conversationId,
      title: conversation.title,
      titleSource: conversation.titleSource,
      ...(conversation.pinnedAt === undefined
        ? {}
        : { pinnedAt: conversation.pinnedAt }),
      ...(conversation.archivedAt === undefined
        ? {}
        : { archivedAt: conversation.archivedAt }),
      status: conversation.status,
      lastActivity: formatConversationActivity(conversation.lastActivityAt),
    },
    matchDescription:
      result.matchedField === 'title'
        ? '匹配标题'
        : `你曾问过：${result.matchPreview}`,
    ...(result.matchedField === 'user_input'
      ? { targetTurnId: result.matchedTurnId }
      : {}),
  }
}

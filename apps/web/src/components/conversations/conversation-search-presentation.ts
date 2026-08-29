import type { ConversationSearchResult, TurnId } from '@codetether/protocol'

export function isConversationSearchMode(query: string): boolean {
  return query.trim().length > 0
}

export function conversationSearchMatchDescription(
  result: ConversationSearchResult,
): string {
  return result.matchedField === 'title'
    ? '匹配标题'
    : `你曾问过：${result.matchPreview}`
}

export function conversationSearchTurnIntent(
  result: ConversationSearchResult,
): { readonly turn?: TurnId } {
  return result.matchedField === 'user_input'
    ? { turn: result.matchedTurnId }
    : {}
}

/**
 * Preserves the pre-mutation result order so focus can be restored only after
 * the durable Search query has refreshed and final membership is known.
 */
export function conversationSearchFocusCandidates(
  conversationIds: readonly string[],
  changedConversationId: string,
): readonly string[] {
  const changedIndex = conversationIds.indexOf(changedConversationId)
  if (changedIndex < 0) return [changedConversationId]

  return [
    changedConversationId,
    conversationIds[changedIndex + 1],
    conversationIds[changedIndex - 1],
  ].filter((conversationId): conversationId is string =>
    Boolean(conversationId),
  )
}

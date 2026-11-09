import type { ConversationTimelineViewModel } from './conversation-view-model.js'

/** Only exact user messages may be copied back into the Composer. */
export function previousUserInput(
  timeline: ConversationTimelineViewModel,
): string | undefined {
  for (let index = timeline.blocks.length - 1; index >= 0; index -= 1) {
    const block = timeline.blocks[index]
    if (block?.kind === 'message' && block.message.author === 'user') {
      return block.message.body
    }
  }
  const entries = timeline.nativeHistory?.entries ?? []
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry?.role === 'user' && entry.kind === 'message') {
      return entry.content
    }
  }
  return undefined
}

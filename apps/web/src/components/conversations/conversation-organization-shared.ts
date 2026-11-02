import type { ConversationSummary } from '@codetether/protocol'

export type OrganizationConversation = Pick<
  ConversationSummary,
  | 'conversationId'
  | 'projectId'
  | 'title'
  | 'titleSource'
  | 'pinnedAt'
  | 'archivedAt'
  | 'status'
>

export function conversationArchiveBlockedReason(
  conversation: Pick<ConversationSummary, 'status'>,
): string | undefined {
  if (conversation.status === 'running') {
    return '运行中的会话暂时不能归档。'
  }
  if (conversation.status === 'waiting') {
    return '当前会话仍在等待你的确认。'
  }
  return undefined
}

export function restoreTriggerFocus(target: HTMLButtonElement | null) {
  requestAnimationFrame(() => {
    if (target?.isConnected) target.focus()
  })
}

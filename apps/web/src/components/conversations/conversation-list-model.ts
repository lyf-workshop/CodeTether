import type { ConversationSummary } from '@codetether/protocol'

const providerLabels = {
  codex: 'Codex',
  'claude-code': 'Claude Code',
} satisfies Record<ConversationSummary['provider'], string>

const activityFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

export function providerDisplayName(
  provider: ConversationSummary['provider'],
): string {
  return providerLabels[provider]
}

export function formatConversationActivity(timestamp: string): string {
  return activityFormatter.format(new Date(timestamp))
}

export function formatConversationArchivedAt(timestamp: string): string {
  return activityFormatter.format(new Date(timestamp))
}

import type { ConversationSummary } from '@codetether/protocol'
import { formatLocalDateTime } from '../../presentation/date-time.js'

const providerLabels = {
  codex: 'Codex',
  'claude-code': 'Claude Code',
} satisfies Record<ConversationSummary['provider'], string>

export function providerDisplayName(
  provider: ConversationSummary['provider'],
): string {
  return providerLabels[provider]
}

export function formatConversationActivity(timestamp: string): string {
  return formatLocalDateTime(timestamp) ?? '时间未知'
}

export function formatConversationArchivedAt(timestamp: string): string {
  return formatLocalDateTime(timestamp) ?? '时间未知'
}

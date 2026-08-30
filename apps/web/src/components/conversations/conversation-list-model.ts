import type {
  ConversationStatus,
  ConversationSummary,
} from '@codetether/protocol'

export type ConversationStatusFilter =
  'all' | 'running' | 'waiting' | 'completed'
export type ConversationProviderFilter = 'all' | ConversationSummary['provider']

export interface ConversationStatusCounts {
  readonly total: number
  readonly running: number
  readonly waiting: number
  readonly completed: number
  readonly failed: number
  readonly idle: number
}

export interface ConversationProviderGroup {
  readonly provider: ConversationSummary['provider']
  readonly conversations: readonly ConversationSummary[]
}

export interface ConversationListControls {
  readonly provider: ConversationProviderFilter
  readonly query: string
  readonly status: ConversationStatusFilter
}

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

/** Filters the bounded index without changing the Host-owned organization order. */
export function visibleProjectConversations(
  conversations: readonly ConversationSummary[],
  controls: ConversationListControls,
): readonly ConversationSummary[] {
  const normalizedQuery = controls.query.trim().toLocaleLowerCase('zh-CN')
  return conversations.filter((conversation) => {
    if (controls.status !== 'all' && conversation.status !== controls.status) {
      return false
    }
    if (
      controls.provider !== 'all' &&
      conversation.provider !== controls.provider
    ) {
      return false
    }
    const searchable =
      `${conversation.title} ${conversation.provider} ${providerLabels[conversation.provider]}`.toLocaleLowerCase(
        'zh-CN',
      )
    return searchable.includes(normalizedQuery)
  })
}

export function groupProjectConversations(
  conversations: readonly ConversationSummary[],
): readonly ConversationProviderGroup[] {
  const providers = uniqueProviders(conversations)
  return providers.map((provider) => ({
    provider,
    conversations: conversations.filter(
      (conversation) => conversation.provider === provider,
    ),
  }))
}

export function conversationStatusCounts(
  conversations: readonly ConversationSummary[],
): ConversationStatusCounts {
  const counts: Record<ConversationStatus, number> = {
    idle: 0,
    running: 0,
    waiting: 0,
    completed: 0,
    failed: 0,
  }
  for (const conversation of conversations) counts[conversation.status] += 1
  return { total: conversations.length, ...counts }
}

export function uniqueProviders(
  conversations: readonly ConversationSummary[],
): readonly ConversationSummary['provider'][] {
  return [
    ...new Set(conversations.map((conversation) => conversation.provider)),
  ]
}

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

import type {
  ConversationStatus,
  ConversationSummary,
  ProviderId,
} from '@codetether/protocol'

export const workspaceSidebarRecentConversationLimit = 4

export interface WorkspaceProviderPresentation {
  readonly icon: 'bot' | 'sparkles'
  readonly label: 'Codex' | 'Claude Code'
  readonly tone: 'codex' | 'claude'
}

export function workspaceProviderPresentation(
  provider: ProviderId,
): WorkspaceProviderPresentation {
  return provider === 'codex'
    ? { icon: 'bot', label: 'Codex', tone: 'codex' }
    : { icon: 'sparkles', label: 'Claude Code', tone: 'claude' }
}

export function activeWorkspaceConversations(
  conversations: readonly ConversationSummary[],
): readonly ConversationSummary[] {
  return conversations.filter(
    (conversation) => conversation.archivedAt === undefined,
  )
}

export function visibleWorkspaceConversations(
  conversations: readonly ConversationSummary[],
  showAll: boolean,
): readonly ConversationSummary[] {
  const active = activeWorkspaceConversations(conversations)
  return showAll
    ? active
    : active.slice(0, workspaceSidebarRecentConversationLimit)
}

export function hasMoreWorkspaceConversations(
  conversations: readonly ConversationSummary[],
): boolean {
  return (
    activeWorkspaceConversations(conversations).length >
    workspaceSidebarRecentConversationLimit
  )
}

export function workspaceConversationStatusLabel(
  status: ConversationStatus,
): string | undefined {
  switch (status) {
    case 'running':
      return '运行中'
    case 'waiting':
      return '需要处理'
    case 'failed':
      return '运行失败'
    case 'idle':
    case 'completed':
      return undefined
  }
}

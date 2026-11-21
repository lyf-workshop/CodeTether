import type { AttentionItem, AttentionListResponse } from '@codetether/protocol'

import { executionFailurePresentation } from '../../failures/failure-presentation.js'
import {
  createToolCommandSubtitle,
  createToolPresentation,
} from '../conversation/tool-presentation.js'
import { displayConversationTitle } from '../conversations/conversation-title.js'

export type InboxFilter = 'all' | AttentionItem['type']

export function bulkAcknowledgementCount(
  summary: AttentionListResponse['summary'],
  filter: InboxFilter,
): number {
  switch (filter) {
    case 'all':
      return summary.failedOpen + summary.completedReviewOpen
    case 'failed':
      return summary.failedOpen
    case 'completed_review':
      return summary.completedReviewOpen
    case 'approval':
      return 0
  }
}

export interface InboxModel {
  readonly items: readonly AttentionItem[]
  readonly summary: AttentionListResponse['summary']
  readonly showsLimitNotice: boolean
}

export interface InboxFocusAnchor {
  readonly attentionId: string
  readonly index: number
}

export interface InboxItemPresentation {
  readonly conversation: string
  readonly description: string
  readonly title: string
}

/**
 * Adapts one validated Host response without recalculating durable summary
 * counts or replacing the Host's priority order.
 */
export function createInboxModel(
  response: AttentionListResponse,
  filter: InboxFilter,
): InboxModel {
  return {
    items: filterAttentionItems(response.items, filter),
    summary: response.summary,
    showsLimitNotice: response.summary.totalOpen > response.items.length,
  }
}

/** Local filtering is stable: the Host remains the sole ordering authority. */
export function filterAttentionItems(
  items: readonly AttentionItem[],
  filter: InboxFilter,
): readonly AttentionItem[] {
  return filter === 'all'
    ? items
    : items.filter((attention) => attention.type === filter)
}

/**
 * Keeps raw provider command wrappers out of the compact Inbox card while
 * reusing the same stable command labels as Conversation Detail.
 */
export function createInboxItemPresentation(
  item: AttentionItem,
  conversationTitle?: string,
): InboxItemPresentation {
  const title =
    conversationTitle === undefined
      ? undefined
      : displayConversationTitle(conversationTitle, item.createdAt)
  if (item.type === 'approval') {
    if (item.payload.kind === 'command' && item.payload.actionSubtitle) {
      const command = item.payload.actionSubtitle
      const tool = createToolPresentation({ command, status: 'running' })
      return {
        conversation: title ?? 'AI 工具会话',
        description: createToolCommandSubtitle(command),
        title: tool.title,
      }
    }

    return {
      conversation: title ?? 'AI 工具会话',
      description:
        item.payload.actionSubtitle ?? 'AI 工具请求执行一项需要你确认的操作。',
      title: item.payload.actionTitle,
    }
  }

  if (item.type === 'completed_review') {
    const completedTitle = displayConversationTitle(
      item.payload.conversationTitle,
      item.createdAt,
    )
    return {
      conversation: completedTitle,
      description: 'AI 工具已完成本轮工作，等待你查看结果。',
      title: completedTitle,
    }
  }

  const failure = executionFailurePresentation(item.payload.error)
  return {
    conversation: displayConversationTitle(
      item.payload.conversationTitle,
      item.createdAt,
    ),
    description: `${failure.cause}${failure.historyNote}`,
    title: failure.title,
  }
}

/** Hides zero and keeps the compact Sidebar badge bounded at 99+. */
export function formatInboxAttentionBadge(
  totalOpen: number,
): string | undefined {
  if (!Number.isSafeInteger(totalOpen) || totalOpen < 0) {
    throw new RangeError('Inbox Attention count must be a non-negative integer')
  }
  if (totalOpen === 0) return undefined
  return totalOpen > 99 ? '99+' : String(totalOpen)
}

/**
 * Returns undefined while the focused item still exists, null when focus must
 * return to the active filter, or the next visible Attention identity.
 */
export function getInboxFocusRecoveryTarget(
  anchor: InboxFocusAnchor,
  allItems: readonly AttentionItem[],
  visibleItems: readonly AttentionItem[],
): string | null | undefined {
  if (
    allItems.some((item) => String(item.attentionId) === anchor.attentionId)
  ) {
    return undefined
  }

  if (visibleItems.length === 0) return null
  const index = Math.min(Math.max(0, anchor.index), visibleItems.length - 1)
  return String(visibleItems[index]?.attentionId)
}

import type { AttentionItem, AttentionListResponse } from '@codetether/protocol'

import {
  createToolCommandSubtitle,
  createToolPresentation,
} from '../conversation/tool-presentation.js'

export type InboxFilter = 'all' | AttentionItem['type']

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
  if (item.type === 'approval') {
    if (item.payload.kind === 'command' && item.payload.actionSubtitle) {
      const command = item.payload.actionSubtitle
      const tool = createToolPresentation({ command, status: 'running' })
      return {
        conversation: conversationTitle ?? '智能体会话',
        description: createToolCommandSubtitle(command),
        title: tool.title,
      }
    }

    return {
      conversation: conversationTitle ?? '智能体会话',
      description:
        item.payload.actionSubtitle ?? '智能体请求执行一项需要你确认的操作。',
      title: item.payload.actionTitle,
    }
  }

  if (item.type === 'completed_review') {
    return {
      conversation: item.payload.conversationTitle,
      description: '智能体已完成本轮工作，等待你查看结果。',
      title: item.payload.conversationTitle,
    }
  }

  return {
    conversation: item.payload.conversationTitle,
    description: item.payload.error.message,
    title: item.payload.conversationTitle,
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

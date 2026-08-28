import type {
  AttentionId,
  AttentionItem,
  AttentionType,
  ConversationId,
  ProjectId,
} from '@codetether/protocol'

const PROJECT_NAME_GRAPHEME_LIMIT = 24
const CONVERSATION_TITLE_GRAPHEME_LIMIT = 36
const PROJECT_NAME_CODE_POINT_LIMIT = 64
const CONVERSATION_TITLE_CODE_POINT_LIMIT = 128

export interface DesktopNotificationPreferences {
  readonly approval: boolean
  readonly completed_review: boolean
  readonly failed: boolean
}

export const defaultDesktopNotificationPreferences: DesktopNotificationPreferences =
  {
    approval: true,
    completed_review: true,
    failed: true,
  }

export interface NotificationIntent {
  readonly attentionId: AttentionId
  readonly type: AttentionType
  readonly projectId: ProjectId
  readonly conversationId: ConversationId
  readonly title: string
  readonly body: string
}

export interface AttentionNotificationMetadata {
  readonly projectName: string
  readonly conversationTitle: string
}

export interface DesktopWindowState {
  readonly focused: boolean
  readonly minimized: boolean
  readonly visible: boolean
}

export type AttentionPresentationSurface =
  | { readonly kind: 'inbox' }
  | {
      readonly kind: 'conversation'
      readonly conversationId: ConversationId | string
    }
  | { readonly kind: 'other' }

export interface AttentionPresentationContext {
  readonly surface: AttentionPresentationSurface
  readonly window: DesktopWindowState
}

/** Notification copy is intentionally derived only from durable Attention. */
export function createNotificationIntent(
  attention: AttentionItem,
  metadata: AttentionNotificationMetadata,
): NotificationIntent {
  const copy = notificationCopy(attention.type)
  const projectName = truncateNotificationLabel(
    metadata.projectName,
    PROJECT_NAME_GRAPHEME_LIMIT,
    PROJECT_NAME_CODE_POINT_LIMIT,
  )
  const conversationTitle = truncateNotificationLabel(
    metadata.conversationTitle,
    CONVERSATION_TITLE_GRAPHEME_LIMIT,
    CONVERSATION_TITLE_CODE_POINT_LIMIT,
  )

  return {
    attentionId: attention.attentionId,
    type: attention.type,
    projectId: attention.projectId,
    conversationId: attention.conversationId,
    title: copy.title,
    body: `${projectName} · ${conversationTitle}\n${copy.detail}`,
  }
}

export function isAttentionNotificationEnabled(
  type: AttentionType,
  preferences: DesktopNotificationPreferences,
): boolean {
  return preferences[type]
}

/**
 * V1 suppresses a native toast only while the focused, visible main window is
 * already showing the global Inbox or this exact Conversation.
 */
export function shouldSuppressAttentionNotification(
  attention: Pick<AttentionItem, 'conversationId'>,
  context: AttentionPresentationContext,
): boolean {
  const foreground =
    context.window.focused &&
    context.window.visible &&
    !context.window.minimized
  if (!foreground) return false
  if (context.surface.kind === 'inbox') return true
  return (
    context.surface.kind === 'conversation' &&
    context.surface.conversationId === attention.conversationId
  )
}

/** Keeps routing knowledge on the Web side of the native boundary. */
export function notificationSurfaceFromPathname(
  pathname: string,
): AttentionPresentationSurface {
  if (/^\/inbox\/?$/u.test(pathname)) return { kind: 'inbox' }

  const match = /^\/conversations\/([^/]+)\/?$/u.exec(pathname)
  if (match === null) return { kind: 'other' }
  return {
    kind: 'conversation',
    conversationId: safeDecode(match[1] ?? ''),
  }
}

export function truncateNotificationLabel(
  value: string,
  graphemeLimit: number,
  codePointLimit = Number.POSITIVE_INFINITY,
): string {
  const normalized = value.trim()
  if (!Number.isSafeInteger(graphemeLimit) || graphemeLimit < 2) {
    throw new Error('graphemeLimit must be an integer of at least 2')
  }
  if (
    codePointLimit !== Number.POSITIVE_INFINITY &&
    (!Number.isSafeInteger(codePointLimit) || codePointLimit < 2)
  ) {
    throw new Error('codePointLimit must be an integer of at least 2')
  }

  const graphemes = segmentGraphemes(normalized)
  if (
    graphemes.length <= graphemeLimit &&
    Array.from(normalized).length <= codePointLimit
  ) {
    return normalized
  }

  const kept: string[] = []
  let keptCodePoints = 0
  for (const grapheme of graphemes) {
    const codePoints = Array.from(grapheme).length
    if (
      kept.length >= graphemeLimit - 1 ||
      keptCodePoints + codePoints > codePointLimit - 1
    ) {
      break
    }
    kept.push(grapheme)
    keptCodePoints += codePoints
  }
  return `${kept.join('')}…`
}

function notificationCopy(type: AttentionType): {
  readonly detail: string
  readonly title: string
} {
  switch (type) {
    case 'approval':
      return {
        title: 'CodeTether · 需要批准',
        detail: 'Codex 正在等待你的确认',
      }
    case 'completed_review':
      return {
        title: 'CodeTether · 工作已完成',
        detail: 'Codex 已完成本轮工作',
      }
    case 'failed':
      return {
        title: 'CodeTether · 执行失败',
        detail: '需要你查看执行结果',
      }
  }
}

function segmentGraphemes(value: string): string[] {
  if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, {
      granularity: 'grapheme',
    })
    return [...segmenter.segment(value)].map(({ segment }) => segment)
  }
  return Array.from(value)
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

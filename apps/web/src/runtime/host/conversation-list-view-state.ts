import { CodeTetherResponseError } from '@codetether/client'
import type { ConversationSummary, ProjectRecord } from '@codetether/protocol'

export interface ConversationListQueryState<TData> {
  readonly status: 'pending' | 'error' | 'success'
  readonly data?: TData
  readonly error?: unknown
}

export type ConversationListPageViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'empty'; readonly project: ProjectRecord }
  | {
      readonly kind: 'ready'
      readonly project: ProjectRecord
      readonly conversations: readonly ConversationSummary[]
    }

export function conversationListPageViewState(
  projectQuery: ConversationListQueryState<ProjectRecord>,
  conversationsQuery: ConversationListQueryState<
    readonly ConversationSummary[]
  >,
): ConversationListPageViewState {
  if (projectQuery.status === 'error') {
    return isNotFound(projectQuery.error)
      ? { kind: 'not-found' }
      : { kind: 'error', message: conversationListErrorMessage() }
  }
  if (conversationsQuery.status === 'error') {
    return isNotFound(conversationsQuery.error)
      ? { kind: 'not-found' }
      : { kind: 'error', message: conversationListErrorMessage() }
  }
  if (
    projectQuery.status === 'pending' ||
    conversationsQuery.status === 'pending' ||
    projectQuery.data === undefined ||
    conversationsQuery.data === undefined
  ) {
    return { kind: 'loading' }
  }
  if (conversationsQuery.data.length === 0) {
    return { kind: 'empty', project: projectQuery.data }
  }
  return {
    kind: 'ready',
    project: projectQuery.data,
    conversations: conversationsQuery.data,
  }
}

export function conversationListErrorMessage(): string {
  return '无法读取会话。请确认 CodeTether Host 正在运行，然后重试。'
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof CodeTetherResponseError &&
    error.envelope.code === 'not_found'
  )
}

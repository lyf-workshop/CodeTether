import { Link } from '@tanstack/react-router'

import {
  AgentIdentityMark,
  Badge,
  Button,
  agentDefinitions,
  cn,
} from '@codetether/ui'
import type { ApprovalDecision, AttentionItem } from '@codetether/protocol'

import type { InboxItemMetadata } from './use-inbox-metadata'
import { createInboxItemPresentation } from './inbox-model'

export type InboxMutationAction = ApprovalDecision | 'acknowledge' | 'review'

export interface InboxItemMutationState {
  readonly action?: InboxMutationAction
  readonly error?: string
  readonly pending: boolean
}

interface InboxItemProps {
  approvalEnabled: boolean
  controlsEnabled: boolean
  item: AttentionItem
  metadata?: InboxItemMetadata
  mutation?: InboxItemMutationState
  onApproval: (
    item: Extract<AttentionItem, { type: 'approval' }>,
    decision: ApprovalDecision,
  ) => void
  onAcknowledge: (item: Extract<AttentionItem, { type: 'failed' }>) => void
  onReview: (item: Extract<AttentionItem, { type: 'completed_review' }>) => void
}

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export function InboxItem({
  approvalEnabled,
  controlsEnabled,
  item,
  metadata,
  mutation = { pending: false },
  onApproval,
  onAcknowledge,
  onReview,
}: InboxItemProps) {
  const presentation = createInboxItemPresentation(
    item,
    metadata?.conversationTitle,
  )
  const unavailable = metadata?.projectAvailability === 'unavailable'

  return (
    <article
      aria-busy={mutation.pending || undefined}
      className={cn(
        'relative grid min-h-[var(--layout-inbox-item-height)] min-w-0 grid-cols-[var(--avatar-size-md)_minmax(0,1fr)_var(--layout-inbox-state-width)_var(--layout-inbox-actions-width)] items-center gap-4 overflow-hidden rounded-md border border-border bg-surface/55 px-4 py-3',
        'transition-colors duration-150 motion-reduce:transition-none hover:border-border-strong hover:bg-surface/75',
      )}
    >
      <AgentIdentityMark
        agent="codex"
        className={cn(
          'self-start mt-2',
          item.type === 'failed' &&
            'border-danger/60 bg-danger-muted text-danger',
        )}
      />

      <div className="min-w-0 self-center">
        <div className="flex min-w-0 items-center gap-2 text-xs font-regular text-text-muted">
          <span className="truncate font-medium text-text-secondary">
            {agentDefinitions.codex.name}
          </span>
          <span aria-hidden="true">·</span>
          <time dateTime={item.createdAt} className="shrink-0 tabular-nums">
            {formatAttentionTime(item.createdAt)}
          </time>
        </div>

        <h2 className="mt-1 truncate text-base font-semibold text-text-primary">
          {presentation.title}
        </h2>
        <p
          className={cn(
            'mt-0.5 truncate text-sm font-regular',
            mutation.error === undefined
              ? 'text-text-secondary'
              : 'text-danger',
          )}
          title={mutation.error ?? presentation.description}
          role={mutation.error === undefined ? undefined : 'alert'}
        >
          {mutation.error ?? presentation.description}
        </p>
        <div className="mt-1.5 flex min-w-0 items-center gap-2 text-xs font-regular text-text-muted">
          <Badge
            variant="outline"
            className={cn(
              'h-5 max-w-32 rounded-xs bg-surface-elevated px-2 text-xs font-regular text-text-muted',
              unavailable && 'border-warning/35 text-warning',
            )}
          >
            <span className="truncate">
              {metadata?.projectName ?? String(item.projectId)}
            </span>
          </Badge>
          <span className="max-w-44 truncate" title={presentation.conversation}>
            {presentation.conversation}
          </span>
          {unavailable ? (
            <span className="shrink-0 text-warning">目录不可用</span>
          ) : null}
        </div>
      </div>

      <div className="flex min-w-0 justify-start self-center">
        <AttentionState item={item} />
      </div>

      <div className="flex min-w-0 items-center justify-end gap-2">
        <AttentionActions
          approvalEnabled={approvalEnabled}
          controlsEnabled={controlsEnabled}
          item={item}
          mutation={mutation}
          onAcknowledge={onAcknowledge}
          onApproval={onApproval}
          onReview={onReview}
        />
      </div>
    </article>
  )
}

function AttentionState({ item }: { item: AttentionItem }) {
  const state =
    item.type === 'approval'
      ? {
          className: 'border-warning/30 bg-warning-muted text-warning',
          label:
            item.payload.kind === 'command'
              ? '命令审批'
              : item.payload.kind === 'file-change'
                ? '文件审批'
                : '需要审批',
        }
      : item.type === 'completed_review'
        ? {
            className: 'border-success/30 bg-success-muted text-success',
            label: '待查看',
          }
        : {
            className: 'border-danger/30 bg-danger-muted text-danger',
            label: '失败',
          }

  return (
    <Badge
      variant="outline"
      className={cn('h-6 rounded-sm px-2 text-xs', state.className)}
    >
      {state.label}
    </Badge>
  )
}

function AttentionActions({
  approvalEnabled,
  controlsEnabled,
  item,
  mutation,
  onAcknowledge,
  onApproval,
  onReview,
}: InboxItemProps) {
  const disabled = !controlsEnabled || mutation?.pending === true

  if (item.type === 'approval') {
    const approvalDisabled = !approvalEnabled || mutation?.pending === true
    return (
      <>
        <Button
          size="sm"
          variant="outline"
          disabled={approvalDisabled}
          onClick={() => onApproval(item, 'decline')}
          className="h-9 px-3 text-sm"
        >
          {mutation?.pending && mutation.action === 'decline'
            ? '正在拒绝…'
            : '拒绝'}
        </Button>
        <Button
          size="sm"
          disabled={approvalDisabled}
          onClick={() => onApproval(item, 'accept')}
          className="h-9 px-3 text-sm"
        >
          {mutation?.pending && mutation.action === 'accept'
            ? '正在允许…'
            : '允许一次'}
        </Button>
      </>
    )
  }

  if (item.type === 'completed_review') {
    return (
      <Button
        size="sm"
        disabled={disabled}
        onClick={() => onReview(item)}
        className="h-9 min-w-28 px-3 text-sm"
      >
        {mutation?.pending ? '正在打开…' : '查看结果'}
      </Button>
    )
  }

  return (
    <>
      <Button asChild size="sm" variant="outline" className="h-9 px-3 text-sm">
        <Link
          to="/conversations/$conversationId"
          params={{ conversationId: item.conversationId }}
          search={{}}
        >
          打开会话
        </Link>
      </Button>
      <Button
        size="sm"
        disabled={disabled}
        onClick={() => onAcknowledge(item)}
        className="h-9 px-3 text-sm"
      >
        {mutation?.pending ? '正在确认…' : '知道了'}
      </Button>
    </>
  )
}

function formatAttentionTime(timestamp: string): string {
  const value = new Date(timestamp)
  return Number.isNaN(value.getTime()) ? timestamp : timeFormatter.format(value)
}

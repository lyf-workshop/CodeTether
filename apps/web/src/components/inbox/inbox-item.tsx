import { Link } from '@tanstack/react-router'
import {
  Check,
  Folder,
  Monitor,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'
import { AttentionRow, Button, cn } from '@codetether/ui'
import type { ApprovalDecision, AttentionItem } from '@codetether/protocol'
import type { InboxItemMetadata } from './use-inbox-metadata'
import { createInboxItemPresentation } from './inbox-model'
import { providerDisplayName } from '../../provider/provider-presentation'

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
  const provider =
    metadata?.provider === undefined
      ? 'AI 工具'
      : providerDisplayName(metadata.provider)
  const conversationTitle =
    metadata?.conversationTitle ??
    (item.type === 'approval'
      ? presentation.conversation
      : item.payload.conversationTitle)
  const Icon =
    item.type === 'approval'
      ? ShieldCheck
      : item.type === 'completed_review'
        ? Check
        : TriangleAlert
  const stateLabel =
    item.type === 'approval'
      ? '等待批准'
      : item.type === 'completed_review'
        ? '待查看'
        : '失败'
  const tone =
    item.type === 'approval'
      ? 'bg-warning-muted text-warning'
      : item.type === 'completed_review'
        ? 'bg-primary-muted text-primary'
        : 'bg-danger-muted text-danger'
  return (
    <AttentionRow
      aria-busy={mutation.pending || undefined}
      mark={
        <span
          role="img"
          aria-label={stateLabel}
          className={cn(
            'grid size-[var(--avatar-size-md)] place-items-center rounded-md',
            tone,
          )}
        >
          <Icon aria-hidden="true" className="size-4" />
        </span>
      }
      title={
        <Link
          to="/c/$conversationId"
          params={{ conversationId: item.conversationId }}
          search={item.turnId === undefined ? {} : { turn: item.turnId }}
          title={conversationTitle}
          className="rounded-xs outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
        >
          {conversationTitle}
        </Link>
      }
      description={
        <span
          title={mutation.error ?? presentation.description}
          role={mutation.error === undefined ? undefined : 'alert'}
          className={mutation.error === undefined ? undefined : 'text-danger'}
        >
          {mutation.error ??
            (item.type === 'approval'
              ? provider + ' 请求执行：' + presentation.description
              : item.type === 'completed_review'
                ? provider + ' 已完成，等你查看'
                : presentation.description)}
        </span>
      }
      context={
        <>
          <Monitor aria-hidden="true" className="size-3.5 shrink-0" />
          {metadata?.machineId === undefined ? (
            <span className="truncate">设备未知</span>
          ) : (
            <Link
              to="/devices/$machineId"
              params={{ machineId: metadata.machineId }}
              className="max-w-40 truncate rounded-xs outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
            >
              {metadata.machineName ?? '设备未知'}
            </Link>
          )}
          <span aria-hidden="true">·</span>
          <Folder aria-hidden="true" className="size-3.5 shrink-0" />
          {metadata?.machineId === undefined ? (
            <span className="truncate">
              {metadata?.projectName ?? '项目未知'}
            </span>
          ) : (
            <Link
              to="/projects/$projectId"
              params={{ projectId: item.projectId }}
              search={{ machineId: metadata.machineId }}
              className="max-w-40 truncate rounded-xs outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
            >
              {metadata.projectName ?? '项目未知'}
            </Link>
          )}
          {metadata?.projectAvailability === 'unavailable' ? (
            <span className="shrink-0 text-warning">无法访问</span>
          ) : null}
        </>
      }
      time={
        <time
          dateTime={item.createdAt}
          className="whitespace-nowrap tabular-nums"
        >
          {formatAttentionTime(item.createdAt)}
        </time>
      }
      actions={
        <AttentionActions
          approvalEnabled={approvalEnabled}
          controlsEnabled={controlsEnabled}
          item={item}
          metadata={metadata}
          mutation={mutation}
          onApproval={onApproval}
          onAcknowledge={onAcknowledge}
          onReview={onReview}
        />
      }
    />
  )
}

function AttentionActions({
  approvalEnabled,
  controlsEnabled,
  item,
  mutation,
  onApproval,
  onAcknowledge,
  onReview,
}: InboxItemProps) {
  const disabled = !controlsEnabled || mutation?.pending === true
  if (item.type === 'approval' && approvalEnabled)
    return (
      <>
        <Button
          size="sm"
          variant="outline"
          disabled={mutation?.pending === true}
          onClick={() => onApproval(item, 'decline')}
        >
          {mutation?.pending && mutation.action === 'decline'
            ? '正在拒绝…'
            : '拒绝'}
        </Button>
        <Button
          size="sm"
          disabled={mutation?.pending === true}
          onClick={() => onApproval(item, 'accept')}
        >
          {mutation?.pending && mutation.action === 'accept'
            ? '正在允许…'
            : '允许一次'}
        </Button>
      </>
    )
  if (item.type === 'completed_review')
    return (
      <Button size="sm" disabled={disabled} onClick={() => onReview(item)}>
        {mutation?.pending ? '正在打开…' : '查看结果'}
      </Button>
    )
  return (
    <>
      <Button asChild size="sm" variant="outline">
        <Link
          to="/c/$conversationId"
          params={{ conversationId: item.conversationId }}
          search={item.turnId === undefined ? {} : { turn: item.turnId }}
        >
          打开会话
        </Link>
      </Button>
      {item.type !== 'failed' ? null : (
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => onAcknowledge(item)}
        >
          {mutation?.pending ? '正在确认…' : '知道了'}
        </Button>
      )}
    </>
  )
}

function formatAttentionTime(timestamp: string): string {
  const value = new Date(timestamp)
  return Number.isNaN(value.getTime()) ? timestamp : timeFormatter.format(value)
}

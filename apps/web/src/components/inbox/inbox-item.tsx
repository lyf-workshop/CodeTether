import { Link } from '@tanstack/react-router'

import {
  AgentIdentityMark,
  Badge,
  Button,
  MachineBadge,
  StatusBadge,
  agentDefinitions,
  cn,
  riskDefinitions,
} from '@codetether/ui'

import type {
  InboxApprovalItemMock,
  InboxFailedItemMock,
  InboxItemMock,
  InboxQuestionItemMock,
} from '../../mocks/inbox'

interface InboxItemProps {
  item: InboxItemMock
  onApprove: (item: InboxApprovalItemMock) => void
  onContext: (item: InboxQuestionItemMock) => void
  onReject: (item: InboxApprovalItemMock) => void
  onReply: (item: InboxQuestionItemMock) => void
  onRetry: (item: InboxFailedItemMock) => void
  onVisit: (item: InboxItemMock, destination: string) => void
}

const riskLabels = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
} as const

export function InboxItem({
  item,
  onApprove,
  onContext,
  onReject,
  onReply,
  onRetry,
  onVisit,
}: InboxItemProps) {
  const agent = agentDefinitions[item.agent]

  return (
    <article
      className={cn(
        'relative grid h-[var(--layout-inbox-item-height)] min-w-0 grid-cols-[var(--avatar-size-md)_minmax(0,1fr)_var(--layout-inbox-state-width)_var(--layout-inbox-actions-width)] items-center gap-4 overflow-hidden rounded-md border border-border bg-surface/55 px-4',
        'transition-colors duration-150 motion-reduce:transition-none hover:border-border-strong hover:bg-surface/75',
      )}
    >
      <AgentIdentityMark
        agent={item.agent}
        className={cn(
          'self-start mt-5',
          item.type === 'failed' &&
            'border-danger/60 bg-danger-muted text-danger',
        )}
      />

      <div className="min-w-0 self-center">
        <div className="flex min-w-0 items-center gap-2 text-xs font-regular text-text-muted">
          <span className="truncate font-medium text-text-secondary">
            {agent.name}
          </span>
          {item.unread ? <span className="sr-only">未读</span> : null}
        </div>

        <h2
          className={cn(
            'mt-1 truncate text-base text-text-primary',
            item.unread ? 'font-semibold' : 'font-medium',
          )}
        >
          {item.title}
        </h2>
        <p className="mt-0.5 truncate text-sm font-regular text-text-secondary">
          {item.description}
        </p>
        <div className="mt-1.5 flex min-w-0 items-center gap-2 text-xs font-regular text-text-muted">
          <Badge
            variant="outline"
            className="h-5 max-w-28 rounded-xs bg-surface-elevated px-2 text-xs font-regular text-text-muted"
          >
            <span className="truncate">{item.project}</span>
          </Badge>
          <MachineBadge
            name={item.machine}
            className="h-5 max-w-28 bg-surface-elevated px-2 font-regular text-text-muted"
          />
          <span className="shrink-0 tabular-nums">{item.timeLabel}</span>
        </div>
      </div>

      <div className="mt-4 flex min-w-0 self-start justify-start">
        {renderState(item)}
      </div>

      <div className="grid grid-cols-[var(--layout-inbox-action-secondary-width)_var(--layout-inbox-action-primary-width)] justify-end gap-2">
        {renderActions({
          item,
          onApprove,
          onContext,
          onReject,
          onReply,
          onRetry,
          onVisit,
        })}
      </div>
    </article>
  )
}

function renderState(item: InboxItemMock) {
  if (item.type === 'approval') {
    const risk = riskDefinitions[item.risk]

    return (
      <Badge
        variant="outline"
        className={cn('h-6 rounded-sm px-2 text-xs', risk.badgeClassName)}
      >
        {riskLabels[item.risk]}
      </Badge>
    )
  }

  if (item.type === 'question') {
    return (
      <Badge
        variant="outline"
        className="h-6 rounded-sm border-info/30 bg-info-muted px-2 text-xs text-info"
      >
        等待回复
      </Badge>
    )
  }

  return (
    <StatusBadge
      status={item.status}
      showIcon={false}
      className="h-6 px-2 text-xs"
    />
  )
}

function renderActions(props: InboxItemProps) {
  const { item, onApprove, onContext, onReject, onReply, onRetry, onVisit } =
    props

  if (item.type === 'approval') {
    return (
      <>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onReject(item)}
          className="h-9 px-3 text-sm"
        >
          拒绝
        </Button>
        <Button
          size="sm"
          onClick={() => onApprove(item)}
          className="h-9 px-3 text-sm"
        >
          允许一次
        </Button>
      </>
    )
  }

  if (item.type === 'question') {
    return (
      <>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onContext(item)}
          className="h-9 px-3 text-sm"
        >
          查看上下文
        </Button>
        <Button
          size="sm"
          onClick={() => onReply(item)}
          className="h-9 px-3 text-sm"
        >
          回复
        </Button>
      </>
    )
  }

  if (item.type === 'completed') {
    const conversationId = item.conversationId

    return (
      <>
        <Button
          asChild
          size="sm"
          variant="outline"
          className="h-9 px-3 text-sm"
        >
          <Link
            to="/conversations/$conversationId"
            params={{ conversationId }}
            search={{}}
            onClick={() => onVisit(item, '会话')}
          >
            打开会话
          </Link>
        </Button>
        <Button asChild size="sm" className="h-9 px-3 text-sm">
          <Link
            to="/conversations/$conversationId"
            params={{ conversationId }}
            search={{ panel: 'changes' }}
            onClick={() => onVisit(item, '变更')}
          >
            查看变更
          </Link>
        </Button>
      </>
    )
  }

  return (
    <>
      <Button asChild size="sm" variant="outline" className="h-9 px-3 text-sm">
        <Link to="/machines" onClick={() => onVisit(item, '机器')}>
          查看机器
        </Link>
      </Button>
      <Button
        size="sm"
        disabled={!item.failureHeartbeat.canRetry}
        onClick={() => onRetry(item)}
        className="h-9 px-3 text-sm"
      >
        重试
      </Button>
    </>
  )
}

import { useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Send } from 'lucide-react'

import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
  agentDefinitions,
} from '@codetether/ui'

import {
  inboxMock,
  type InboxItemMock,
  type InboxItemType,
  type InboxQuestionItemMock,
} from '../../mocks/inbox'
import { useDemoState } from '../../state/demo-state-context'
import { InboxEmptyState } from './inbox-empty-state'
import { InboxFilters, type InboxFilter } from './inbox-filters'
import { InboxItem } from './inbox-item'
import { InboxSummary } from './inbox-summary'

const itemPriority = {
  approval: 0,
  question: 0,
  failed: 1,
  completed: 2,
} satisfies Record<InboxItemType, number>

export function InboxPage() {
  const [activeFilter, setActiveFilter] = useState<InboxFilter>('all')
  const [contextTargetId, setContextTargetId] = useState<string | null>(null)
  const [liveMessage, setLiveMessage] = useState('')
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const filtersRef = useRef<HTMLDivElement>(null)
  const {
    inboxItems: items,
    markAllInboxItemsRead,
    markInboxItemRead,
    resolveInboxItem,
  } = useDemoState()

  const contextTarget = items.find(
    (item): item is InboxQuestionItemMock =>
      item.id === contextTargetId && item.type === 'question',
  )
  const replyTarget = items.find(
    (item): item is InboxQuestionItemMock =>
      item.id === replyTargetId && item.type === 'question',
  )
  const summary = useMemo(
    () => ({
      approvals: items.filter((item) => item.type === 'approval').length,
      replies: items.filter((item) => item.type === 'question').length,
      completed: items.filter((item) => item.type === 'completed').length,
      failed: items.filter((item) => item.type === 'failed').length,
    }),
    [items],
  )
  const unreadCount = items.filter((item) => item.unread).length
  const todayOverview = {
    ...inboxMock.todayOverview,
    highRisk: items.filter((item) => item.risk === 'high').length,
    pending: items.length,
  }

  const visibleItems = useMemo(
    () =>
      items
        .filter((item) => {
          if (activeFilter === 'all') return true
          if (activeFilter === 'unread') return item.unread
          return item.type === activeFilter
        })
        .toSorted((left, right) => {
          const priority = itemPriority[left.type] - itemPriority[right.type]

          if (priority !== 0) return priority
          return right.createdAt.localeCompare(left.createdAt)
        }),
    [activeFilter, items],
  )

  function focusActiveFilter() {
    filtersRef.current
      ?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
      ?.focus()
  }

  function resolveItem(item: InboxItemMock, message: string) {
    resolveInboxItem(item.id)
    setLiveMessage(message)
    requestAnimationFrame(focusActiveFilter)
  }

  function handleMarkAllRead() {
    markAllInboxItemsRead()
    setLiveMessage('所有收件箱事项已标为已读。')
  }

  function handleReplySubmit() {
    if (!replyTarget || replyText.trim().length === 0) return

    resolveItem(
      replyTarget,
      `已回复 ${agentDefinitions[replyTarget.agent].name}。`,
    )
    setReplyTargetId(null)
    setReplyText('')
  }

  return (
    <div className="flex min-h-full min-w-0 flex-col px-[var(--layout-content-inline-padding)] py-[var(--layout-inbox-page-block-padding)]">
      <header className="flex min-h-[var(--layout-inbox-header-height)] min-w-0 items-start justify-between gap-6">
        <div className="min-w-0">
          <h1 className="text-page font-semibold text-text-primary">收件箱</h1>
          <p className="mt-0.5 truncate text-sm font-regular text-text-secondary">
            所有需要你决策、回复或检查的智能体事项。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            aria-controls="inbox-filter-controls"
            onClick={focusActiveFilter}
            className="h-9 min-w-22 px-3 text-sm"
          >
            筛选
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={unreadCount === 0}
            onClick={handleMarkAllRead}
            className="h-9 px-3 text-sm"
          >
            全部标为已读
          </Button>
        </div>
      </header>

      <div className="mt-[var(--layout-inbox-header-summary-gap)]">
        <InboxSummary
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
          summary={summary}
          todayOverview={todayOverview}
        />
      </div>

      <div
        ref={filtersRef}
        id="inbox-filter-controls"
        className="mt-[var(--layout-inbox-summary-filter-gap)] flex h-7 min-w-0 items-center justify-between gap-4"
      >
        <InboxFilters
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
          summary={summary}
          unreadCount={unreadCount}
        />
        <p className="shrink-0 text-xs font-regular text-text-muted">
          按处理优先级排序
        </p>
      </div>

      <section
        aria-label="需要你处理的事项"
        className="mt-[var(--layout-inbox-filter-list-gap)]"
      >
        {visibleItems.length > 0 ? (
          <ol className="space-y-[var(--layout-inbox-item-gap)]">
            {visibleItems.map((item) => (
              <li key={item.id}>
                <InboxItem
                  item={item}
                  onApprove={(currentItem) =>
                    resolveItem(
                      currentItem,
                      `已允许 ${currentItem.command} 执行一次。`,
                    )
                  }
                  onContext={(currentItem) => {
                    markInboxItemRead(currentItem.id)
                    setContextTargetId(currentItem.id)
                    setLiveMessage(`已打开“${currentItem.title}”的上下文。`)
                  }}
                  onReject={(currentItem) =>
                    resolveItem(currentItem, `已拒绝“${currentItem.title}”。`)
                  }
                  onReply={(currentItem) => {
                    markInboxItemRead(currentItem.id)
                    setReplyTargetId(currentItem.id)
                  }}
                  onRetry={(currentItem) =>
                    resolveItem(
                      currentItem,
                      `已在本地标记重试“${currentItem.title}”。`,
                    )
                  }
                  onVisit={(currentItem, destination) => {
                    if (currentItem.type === 'completed') {
                      resolveInboxItem(currentItem.id)
                    } else {
                      markInboxItemRead(currentItem.id)
                    }
                    setLiveMessage(`正在打开${destination}。`)
                  }}
                />
              </li>
            ))}
          </ol>
        ) : (
          <InboxEmptyState
            activeFilter={activeFilter}
            onReset={() => setActiveFilter('all')}
          />
        )}
      </section>

      <aside className="mt-[var(--layout-inbox-list-guidance-gap)] flex min-h-[var(--layout-inbox-guidance-height)] min-w-0 items-center gap-3 rounded-md border border-border bg-surface/35 px-4">
        <div className="min-w-0">
          <h2 className="text-md font-semibold text-text-primary">审批建议</h2>
          <p className="mt-0.5 truncate text-xs font-regular text-text-muted">
            可在设置中为可信项目配置低风险操作的默认权限，减少重复审批。
          </p>
        </div>
        <Button
          asChild
          size="sm"
          variant="outline"
          className="ml-auto h-9 shrink-0 px-4 text-sm"
        >
          <Link to="/settings">打开权限设置</Link>
        </Button>
      </aside>

      <Dialog
        open={Boolean(contextTarget)}
        onOpenChange={(open) => {
          if (!open) setContextTargetId(null)
        }}
      >
        <DialogContent
          closeLabel="关闭问题上下文"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            focusActiveFilter()
          }}
          className="max-w-md"
        >
          <DialogHeader>
            <DialogTitle>问题上下文</DialogTitle>
            <DialogDescription>
              此处仅展示智能体提问所关联的本地演示信息。
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-border bg-surface/70 px-3.5 py-3">
            <p className="text-sm font-medium text-text-primary">
              {contextTarget?.title}
            </p>
            <p className="mt-1 text-sm font-regular text-text-secondary">
              {contextTarget?.questionPrompt}
            </p>
          </div>
          <dl className="grid grid-cols-[4rem_minmax(0,1fr)] gap-x-4 gap-y-2 border-y border-border py-3 text-sm">
            <dt className="text-text-muted">智能体</dt>
            <dd className="text-text-secondary">
              {contextTarget
                ? agentDefinitions[contextTarget.agent].name
                : null}
            </dd>
            <dt className="text-text-muted">项目</dt>
            <dd className="text-text-secondary">{contextTarget?.project}</dd>
            <dt className="text-text-muted">机器</dt>
            <dd className="text-text-secondary">{contextTarget?.machine}</dd>
          </dl>
          <DialogFooter>
            <DialogClose asChild>
              <Button size="sm">知道了</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(replyTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setReplyTargetId(null)
            setReplyText('')
          }
        }}
      >
        <DialogContent
          closeLabel="关闭回复窗口"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            focusActiveFilter()
          }}
          className="max-w-lg"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault()
              handleReplySubmit()
            }}
            className="grid gap-4"
          >
            <DialogHeader>
              <DialogTitle>回复智能体</DialogTitle>
              <DialogDescription>
                {replyTarget
                  ? `${agentDefinitions[replyTarget.agent].name} 正在等待你的决定。`
                  : '智能体正在等待你的决定。'}
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-md border border-border bg-surface/70 px-3.5 py-3">
              <p className="text-sm font-medium text-text-primary">
                {replyTarget?.title}
              </p>
              <p className="mt-1 text-sm font-regular text-text-secondary">
                {replyTarget?.questionPrompt ?? replyTarget?.description}
              </p>
            </div>
            <label className="grid gap-2 text-sm font-medium text-text-secondary">
              回复内容
              <Textarea
                autoFocus
                value={replyText}
                onChange={(event) => setReplyText(event.target.value)}
                placeholder="输入你的决定或补充信息…"
                aria-describedby="reply-help"
              />
            </label>
            <p id="reply-help" className="text-xs font-regular text-text-muted">
              此操作仅更新本地演示状态，不会发送给真实智能体。
            </p>
            <DialogFooter>
              <DialogClose asChild>
                <Button size="sm" variant="outline">
                  取消
                </Button>
              </DialogClose>
              <Button
                type="submit"
                size="sm"
                disabled={replyText.trim().length === 0}
              >
                <Send aria-hidden="true" />
                回复
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage || `当前显示 ${visibleItems.length} 个待处理事项`}
      </p>
    </div>
  )
}

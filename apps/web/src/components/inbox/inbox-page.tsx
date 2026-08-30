import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import type { ApprovalDecision, AttentionItem } from '@codetether/protocol'

import { attentionListQueryOptions } from '../../runtime/host/attention-query'
import {
  useHostConnectionState,
  useHostRuntime,
} from '../../runtime/host/host-runtime-hooks'
import { attentionErrorMessage } from '../../runtime/host/attention-actions'
import { mutationErrorMessage } from '../../runtime/host/live-conversation-actions'
import {
  acknowledgeFailedAttention,
  resolveInboxApproval,
  reviewCompletedAttention,
} from './inbox-actions'
import { InboxEmptyState } from './inbox-empty-state'
import { InboxFilters } from './inbox-filters'
import {
  InboxItem,
  type InboxItemMutationState,
  type InboxMutationAction,
} from './inbox-item'
import {
  createInboxModel,
  getInboxFocusRecoveryTarget,
  type InboxFilter,
  type InboxFocusAnchor,
} from './inbox-model'
import { InboxErrorState, InboxLoadingState } from './inbox-page-states'
import { InboxSummary } from './inbox-summary'
import { useInboxMetadata } from './use-inbox-metadata'
import { providerPresentation } from '../../provider/provider-presentation'

const emptyMutationStates: Readonly<Record<string, InboxItemMutationState>> = {}
const emptyAttentionItems: readonly AttentionItem[] = []

export function InboxPage() {
  const runtime = useHostRuntime()
  const connectionState = useHostConnectionState()
  const navigate = useNavigate()
  const [activeFilter, setActiveFilter] = useState<InboxFilter>('all')
  const [mutationStates, setMutationStates] =
    useState<Readonly<Record<string, InboxItemMutationState>>>(
      emptyMutationStates,
    )
  const mutationGuards = useRef(new Set<string>())
  const rowRefs = useRef(new Map<string, HTMLLIElement>())
  const focusedItem = useRef<InboxFocusAnchor | undefined>(undefined)
  const filtersRef = useRef<HTMLDivElement>(null)

  const attentionQuery = useQuery({
    ...attentionListQueryOptions(runtime),
    enabled: connectionState === 'connected',
  })
  const response = attentionQuery.data
  const model = useMemo(
    () =>
      response === undefined
        ? undefined
        : createInboxModel(response, activeFilter),
    [activeFilter, response],
  )
  const allItems = response?.items ?? emptyAttentionItems
  const metadata = useInboxMetadata(
    runtime,
    allItems,
    connectionState === 'connected',
  )
  const controlsEnabled = connectionState === 'connected'

  function approvalEnabled(item: AttentionItem): boolean {
    const provider = metadata.get(String(item.attentionId))?.provider ?? 'codex'
    const presentation = providerPresentation(runtime.bootstrap, provider)
    return (
      controlsEnabled &&
      presentation.available &&
      presentation.capabilities.approvals
    )
  }

  useEffect(() => {
    const openIds = new Set(allItems.map((item) => String(item.attentionId)))
    for (const attentionId of mutationGuards.current) {
      if (!openIds.has(attentionId)) mutationGuards.current.delete(attentionId)
    }
  }, [allItems])

  useEffect(() => {
    function trackFocusedAttention(event: FocusEvent) {
      const target = event.target
      if (!(target instanceof Element)) return
      const row = target.closest<HTMLElement>('[data-inbox-attention-id]')
      if (row !== null) {
        const attentionId = row.dataset.inboxAttentionId
        const index = Number(row.dataset.inboxIndex)
        if (attentionId !== undefined && Number.isSafeInteger(index)) {
          focusedItem.current = { attentionId, index }
        }
        return
      }

      // Removing a focused row may return focus to body without a useful
      // target. Preserve that anchor so the next render can restore focus.
      if (target !== document.body) focusedItem.current = undefined
    }

    document.addEventListener('focusin', trackFocusedAttention)
    return () => document.removeEventListener('focusin', trackFocusedAttention)
  }, [])

  useEffect(() => {
    const anchor = focusedItem.current
    if (anchor === undefined || model === undefined) return
    const target = getInboxFocusRecoveryTarget(anchor, allItems, model.items)
    if (target === undefined) return

    focusedItem.current = undefined
    const frame = requestAnimationFrame(() => {
      mutationGuards.current.delete(anchor.attentionId)
      setMutationStates((current) => {
        if (current[anchor.attentionId] === undefined) return current
        return Object.fromEntries(
          Object.entries(current).filter(
            ([attentionId]) => attentionId !== anchor.attentionId,
          ),
        )
      })
      if (target !== null) {
        rowRefs.current.get(target)?.focus()
      } else {
        filtersRef.current
          ?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
          ?.focus()
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [allItems, model])

  function setMutation(attentionId: string, state: InboxItemMutationState) {
    setMutationStates((current) => ({ ...current, [attentionId]: state }))
  }

  async function resolveApproval(
    item: Extract<AttentionItem, { type: 'approval' }>,
    decision: ApprovalDecision,
  ) {
    const attentionId = String(item.attentionId)
    if (!approvalEnabled(item) || mutationGuards.current.has(attentionId)) {
      return
    }

    mutationGuards.current.add(attentionId)
    setMutation(attentionId, { pending: true, action: decision })
    try {
      await resolveInboxApproval(runtime, item, decision)
      // The bound approval.resolved/attention.resolved events own removal.
    } catch (error) {
      mutationGuards.current.delete(attentionId)
      setMutation(attentionId, {
        pending: false,
        action: decision,
        error: mutationErrorMessage(error, '处理审批'),
      })
    }
  }

  async function resolveGenericAttention(
    item: Extract<AttentionItem, { type: 'completed_review' | 'failed' }>,
    action: Extract<InboxMutationAction, 'acknowledge' | 'review'>,
  ) {
    const attentionId = String(item.attentionId)
    if (!controlsEnabled || mutationGuards.current.has(attentionId)) {
      return
    }

    mutationGuards.current.add(attentionId)
    setMutation(attentionId, { pending: true, action })
    try {
      if (item.type === 'completed_review') {
        await reviewCompletedAttention(
          runtime,
          item,
          async (conversationId, turnId) =>
            await navigate({
              to: '/conversations/$conversationId',
              params: { conversationId },
              search: turnId === undefined ? {} : { turn: turnId },
            }),
        )
      } else {
        await acknowledgeFailedAttention(runtime, item)
      }
      // Failed Attention remains visible until attention.resolved is observed.
    } catch (error) {
      mutationGuards.current.delete(attentionId)
      setMutation(attentionId, {
        pending: false,
        action,
        error: attentionErrorMessage(error),
      })
    }
  }

  function handleRetry() {
    runtime.retry()
    if (connectionState === 'connected') void attentionQuery.refetch()
  }

  const connectionUnavailable =
    connectionState === 'unavailable' || connectionState === 'incompatible'
  const loading =
    response === undefined &&
    !connectionUnavailable &&
    (attentionQuery.isPending ||
      connectionState === 'connecting' ||
      connectionState === 'reconnecting')

  return (
    <div className="flex min-h-full min-w-0 flex-col px-[var(--layout-content-inline-padding)] py-[var(--layout-inbox-page-block-padding)]">
      <header className="flex min-h-[var(--layout-inbox-header-height)] min-w-0 items-start justify-between gap-6">
        <div className="min-w-0">
          <h1 className="text-page font-semibold text-text-primary">收件箱</h1>
          <p className="mt-0.5 text-sm font-regular text-text-secondary">
            所有需要你处理或查看的智能体事项。
          </p>
        </div>
        {connectionState === 'reconnecting' && response !== undefined ? (
          <p
            role="status"
            className="shrink-0 rounded-full border border-warning/30 bg-warning-muted px-3 py-1 text-xs text-warning"
          >
            正在重新连接
          </p>
        ) : null}
      </header>

      <div className="mt-[var(--layout-inbox-header-summary-gap)]">
        {connectionUnavailable ? (
          <InboxErrorState
            incompatible={connectionState === 'incompatible'}
            onRetry={handleRetry}
          />
        ) : loading ? (
          <InboxLoadingState />
        ) : response === undefined ? (
          <InboxErrorState title="无法读取收件箱" onRetry={handleRetry} />
        ) : model === undefined ? null : (
          <>
            <InboxSummary
              activeFilter={activeFilter}
              onFilterChange={setActiveFilter}
              summary={model.summary}
            />

            <div
              ref={filtersRef}
              id="inbox-filter-controls"
              className="mt-[var(--layout-inbox-summary-filter-gap)] flex min-h-7 min-w-0 items-center justify-between gap-4"
            >
              <InboxFilters
                activeFilter={activeFilter}
                onFilterChange={setActiveFilter}
                summary={model.summary}
              />
              <p className="shrink-0 text-xs font-regular text-text-muted">
                按处理优先级排序
              </p>
            </div>

            {model.showsLimitNotice ? (
              <p
                className="mt-3 text-xs font-regular text-text-muted"
                role="note"
              >
                当前显示最近 {response.items.length} 个待处理事项，共{' '}
                {model.summary.totalOpen} 个。
              </p>
            ) : null}

            <section
              aria-label="需要你处理的事项"
              className="mt-[var(--layout-inbox-filter-list-gap)]"
            >
              {model.items.length > 0 ? (
                <ol className="space-y-[var(--layout-inbox-item-gap)]">
                  {model.items.map((item, index) => {
                    const attentionId = String(item.attentionId)
                    return (
                      <li
                        key={attentionId}
                        data-inbox-attention-id={attentionId}
                        data-inbox-index={index}
                        ref={(node) => {
                          if (node === null) rowRefs.current.delete(attentionId)
                          else rowRefs.current.set(attentionId, node)
                        }}
                        tabIndex={-1}
                        className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      >
                        <InboxItem
                          approvalEnabled={approvalEnabled(item)}
                          controlsEnabled={controlsEnabled}
                          item={item}
                          metadata={metadata.get(attentionId)}
                          mutation={mutationStates[attentionId]}
                          onApproval={(current, decision) => {
                            void resolveApproval(current, decision)
                          }}
                          onAcknowledge={(current) => {
                            void resolveGenericAttention(current, 'acknowledge')
                          }}
                          onReview={(current) => {
                            void resolveGenericAttention(current, 'review')
                          }}
                        />
                      </li>
                    )
                  })}
                </ol>
              ) : (
                <InboxEmptyState
                  activeFilter={activeFilter}
                  onReset={() => setActiveFilter('all')}
                />
              )}
            </section>
          </>
        )}
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {model === undefined
          ? '正在读取收件箱'
          : `当前显示 ${model.items.length} 个待处理事项`}
      </p>
    </div>
  )
}

import { useLayoutEffect, useRef } from 'react'

import { Badge, Button, cn } from '@codetether/ui'

import type { ApprovalController } from './conversation-controls'
import type { ConversationApprovalViewModel } from './conversation-view-model'
import { createPendingActionDockModel } from './pending-action-dock-model'
import {
  getApprovalFocusTarget,
  type ApprovalFocusLocation,
} from './conversation-timeline-behavior'

interface PendingActionDockProps {
  readonly approvals: readonly ConversationApprovalViewModel[]
  readonly className?: string
  readonly controller?: ApprovalController
}

/**
 * Presentational pending-action surface. Runtime ownership and Approval
 * resolution remain with the injected controller.
 */
export function PendingActionDock({
  approvals,
  className,
  controller,
}: PendingActionDockProps) {
  const items = createPendingActionDockModel(approvals, controller)
  const approvalIds = items.map((item) => item.id)
  const approvalIdentity = approvalIds.join('\u0000')
  const dockRef = useRef<HTMLElement>(null)
  const itemRefs = useRef(new Map<string, HTMLElement>())
  const previousApprovalIds = useRef<readonly string[]>([])
  const resolutionOrigin = useRef<
    | {
        readonly approvalId: string
        readonly ownedFocus: boolean
      }
    | undefined
  >(undefined)
  const restoreComposerWhenEditable = useRef(false)

  useLayoutEffect(() => {
    const previous = previousApprovalIds.current
    const nextApprovalIds =
      approvalIdentity.length === 0 ? [] : approvalIdentity.split('\u0000')
    const origin = resolutionOrigin.current
    let active = activeFocusLocation(dockRef.current)
    if (
      active.kind === 'other' &&
      document.activeElement === document.body &&
      origin?.ownedFocus === true
    ) {
      active = { kind: 'approval', approvalId: origin.approvalId }
    }

    const composer = conversationComposer()
    const target = getApprovalFocusTarget({
      previousApprovalIds: previous,
      nextApprovalIds,
      active,
      ...(origin === undefined
        ? {}
        : { resolutionOriginApprovalId: origin.approvalId }),
      composerEditable:
        composer !== null && !composer.disabled && !composer.readOnly,
    })

    if (target?.kind === 'approval') {
      restoreComposerWhenEditable.current = false
      itemRefs.current.get(target.approvalId)?.focus()
    } else if (target?.kind === 'composer') {
      restoreComposerWhenEditable.current = false
      composer?.focus()
    } else if (target?.kind === 'timeline') {
      restoreComposerWhenEditable.current = true
      timelineViewport()?.focus()
    }

    if (origin !== undefined && !nextApprovalIds.includes(origin.approvalId)) {
      resolutionOrigin.current = undefined
    }
    previousApprovalIds.current = nextApprovalIds
  }, [approvalIdentity])

  useLayoutEffect(() => {
    if (!restoreComposerWhenEditable.current || items.length > 0) return
    const composer = conversationComposer()
    const timeline = timelineViewport()
    const active = document.activeElement

    if (active !== timeline && active !== document.body) {
      restoreComposerWhenEditable.current = false
      return
    }
    if (composer === null || composer.disabled || composer.readOnly) return

    restoreComposerWhenEditable.current = false
    composer.focus()
  })

  if (items.length === 0) return null

  return (
    <section
      ref={dockRef}
      aria-labelledby="pending-action-dock-title"
      className={cn(
        'min-w-0 rounded-md border border-status-waiting/30 bg-surface-elevated shadow-sm',
        className,
      )}
    >
      <header className="flex min-w-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <h2
            id="pending-action-dock-title"
            className="truncate text-sm font-semibold text-text-primary"
          >
            等待你的审批
          </h2>
          <p className="truncate text-xs text-text-muted">
            请确认每项操作后，智能体才会继续。
          </p>
        </div>
        <Badge
          variant="outline"
          className="shrink-0 border-status-waiting/30 bg-status-waiting-muted text-status-waiting"
        >
          {items.length} 项
        </Badge>
      </header>

      <div className="max-h-40 min-w-0 divide-y divide-border overflow-y-auto">
        {items.map((item) => (
          <article
            key={item.id}
            ref={(node) => {
              if (node === null) itemRefs.current.delete(item.id)
              else itemRefs.current.set(item.id, node)
            }}
            tabIndex={-1}
            data-approval-id={item.id}
            aria-busy={item.controls.pending || undefined}
            aria-labelledby={`pending-action-${item.id}`}
            className="min-w-0 px-4 py-3"
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <h3
                    id={`pending-action-${item.id}`}
                    className="truncate text-sm font-semibold text-text-primary"
                  >
                    {item.title}
                  </h3>
                  <Badge
                    variant="outline"
                    className="h-5 shrink-0 rounded-xs px-1.5 text-[0.6875rem] text-text-muted"
                  >
                    {item.kindLabel}
                  </Badge>
                </div>
                <code
                  className="mt-1 block min-w-0 truncate font-mono text-xs text-text-secondary"
                  title={item.subtitle}
                >
                  {item.subtitle}
                </code>
              </div>
              <span className="flex max-w-32 shrink-0 flex-col items-end text-xs text-text-muted">
                {item.contextLabel ? (
                  <span className="max-w-full truncate" title={item.context}>
                    {item.contextLabel}
                  </span>
                ) : null}
                <span className="tabular-nums">{item.requestedAt}</span>
              </span>
            </div>

            <details className="group mt-2 min-w-0 text-xs text-text-secondary">
              <summary className="w-fit cursor-pointer rounded-xs outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring/50">
                查看详情
              </summary>
              <dl className="mt-2 grid min-w-0 gap-2 rounded-sm bg-surface-muted/45 p-3">
                <div className="grid min-w-0 gap-1">
                  <dt className="text-text-muted">
                    {item.kind === 'command' ? '完整命令' : '操作内容'}
                  </dt>
                  <dd className="min-w-0">
                    <code className="block max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-text-secondary">
                      {item.detail}
                    </code>
                  </dd>
                </div>
                {item.context ? (
                  <div className="grid min-w-0 gap-1">
                    <dt className="text-text-muted">工作上下文</dt>
                    <dd className="min-w-0 break-all">{item.context}</dd>
                  </div>
                ) : null}
              </dl>
            </details>

            {item.controls.error ? (
              <p role="alert" className="mt-2 text-xs text-danger">
                {item.controls.error}
              </p>
            ) : null}

            <div className="mt-3 flex shrink-0 items-center justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={item.controls.disabled}
                onClick={(event) => {
                  resolutionOrigin.current = {
                    approvalId: item.id,
                    ownedFocus: event.currentTarget.contains(
                      document.activeElement,
                    ),
                  }
                  void controller?.resolve(item.id, 'decline')
                }}
              >
                {item.controls.pending && item.controls.decision === 'decline'
                  ? '正在拒绝…'
                  : '拒绝'}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={item.controls.disabled}
                onClick={(event) => {
                  resolutionOrigin.current = {
                    approvalId: item.id,
                    ownedFocus: event.currentTarget.contains(
                      document.activeElement,
                    ),
                  }
                  void controller?.resolve(item.id, 'accept')
                }}
              >
                {item.controls.pending && item.controls.decision === 'accept'
                  ? '正在允许…'
                  : '允许一次'}
              </Button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function activeFocusLocation(root: HTMLElement | null): ApprovalFocusLocation {
  const active = document.activeElement
  if (!(active instanceof HTMLElement)) return { kind: 'other' }
  if (active.id === 'conversation-composer') return { kind: 'composer' }

  const approval = active.closest<HTMLElement>('[data-approval-id]')
  if (approval !== null && root?.contains(approval)) {
    const approvalId = approval.dataset.approvalId
    if (approvalId) return { kind: 'approval', approvalId }
  }
  return { kind: 'other' }
}

function conversationComposer(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>('#conversation-composer')
}

function timelineViewport(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[aria-label="会话执行时间线"] [data-slot="scroll-area-viewport"]',
  )
}

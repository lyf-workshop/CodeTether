import { useId } from 'react'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, LoaderCircle, RotateCcw } from 'lucide-react'

import type { MachineId, ProjectId } from '@codetether/protocol'
import { Button } from '@codetether/ui'

import type { FailedTurnRetryController } from './conversation-controls.js'
import type { ConversationFailureViewModel } from './conversation-view-model.js'

interface ConversationFailureCardProps {
  readonly failure: ConversationFailureViewModel
  readonly machineId?: MachineId
  readonly projectId?: ProjectId
  readonly retryController?: FailedTurnRetryController
  readonly turnId: string
}

export function ConversationFailureCard({
  failure,
  machineId,
  projectId,
  retryController,
  turnId,
}: ConversationFailureCardProps) {
  const titleId = useId()
  const descriptionId = useId()
  const retryReasonId = useId()
  const retryPending = retryController?.pendingTurnId === turnId
  const retryError =
    retryController?.errorTurnId === turnId ? retryController.error : undefined
  const retryAvailable =
    failure.canStartNewTurn &&
    failure.retryInput !== undefined &&
    retryController !== undefined
  const retryDisabled = retryPending || retryController?.enabled !== true

  return (
    <article
      role="status"
      aria-live="polite"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      data-execution-failure="true"
      className="mt-3 min-w-0 rounded-md border border-danger/35 bg-danger-muted/45 p-4"
    >
      <div className="flex min-w-0 items-start gap-3">
        <AlertTriangle
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-danger"
        />
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="text-sm font-semibold text-text-primary">
            {failure.title}
          </h3>
          <div
            id={descriptionId}
            className="mt-1 space-y-1 text-sm leading-relaxed text-text-secondary"
          >
            <p>{failure.cause}</p>
            <p>{failure.historyNote}</p>
            <p>{failure.guidance}</p>
          </div>

          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
            {retryAvailable ? (
              <Button
                type="button"
                size="sm"
                disabled={retryDisabled}
                aria-describedby={
                  retryPending || retryController.enabled
                    ? undefined
                    : retryReasonId
                }
                onClick={() => void retryController.execute(turnId)}
              >
                {retryPending ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="animate-spin motion-reduce:animate-none"
                  />
                ) : (
                  <RotateCcw aria-hidden="true" />
                )}
                {retryPending ? '正在开始新轮次…' : '明确重试为新轮次'}
              </Button>
            ) : null}
            {failure.navigation === 'machine' && machineId !== undefined ? (
              <Button asChild type="button" size="sm" variant="secondary">
                <Link
                  to="/machines/$machineId"
                  params={{ machineId }}
                  aria-label="打开执行机器详情"
                >
                  查看机器
                </Link>
              </Button>
            ) : null}
            {failure.navigation === 'project' && projectId !== undefined ? (
              <Button asChild type="button" size="sm" variant="secondary">
                <Link
                  to="/projects/$projectId"
                  params={{ projectId }}
                  aria-label="打开项目详情"
                >
                  查看项目
                </Link>
              </Button>
            ) : null}
          </div>

          {retryAvailable && !retryPending && !retryController.enabled ? (
            <p id={retryReasonId} className="mt-2 text-xs text-text-muted">
              {retryController.disabledReason ?? '当前无法开始新轮次。'}
            </p>
          ) : null}
          {retryError === undefined ? null : (
            <p role="alert" className="mt-2 text-xs text-danger">
              {retryError}
            </p>
          )}

          <details className="group mt-3 min-w-0 text-xs text-text-secondary">
            <summary className="w-fit cursor-pointer rounded-xs outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring/50">
              技术详情
            </summary>
            <dl className="mt-2 grid min-w-0 gap-2 rounded-sm bg-surface-muted/55 p-3">
              {failure.technicalDetails.map((detail) => (
                <div key={detail.label} className="grid min-w-0 gap-1">
                  <dt className="text-text-muted">{detail.label}</dt>
                  <dd className="min-w-0 overflow-auto break-all font-mono text-text-secondary">
                    {detail.value}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        </div>
      </div>
    </article>
  )
}

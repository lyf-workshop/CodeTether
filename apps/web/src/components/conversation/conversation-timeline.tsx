import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type UIEvent,
} from 'react'

import {
  DiffCard,
  Button,
  ScrollArea,
  ShellRunCard,
  ToolCallCard,
  type AgentId,
} from '@codetether/ui'

import type {
  ConversationApprovalViewModel,
  ConversationChangesViewModel,
  ConversationMessageViewModel,
  ConversationRunExecutionViewModel,
  ConversationTimelineViewModel,
} from './conversation-view-model'
import type { ApprovalController } from './conversation-controls'
import { isNearTimelineBottom } from './conversation-controls'
import {
  createToolCommandSubtitle,
  createToolPresentation,
} from './tool-presentation'
import { AgentMessage, UserMessage } from './message'

interface ConversationTimelineProps {
  agent: AgentId
  timeline: ConversationTimelineViewModel
  changes: ConversationChangesViewModel
  pendingApprovals: readonly ConversationApprovalViewModel[]
  approvalController?: ApprovalController
}

type ToolExecution = Extract<
  ConversationRunExecutionViewModel,
  { readonly kind: 'tool' }
>

type ExecutionGroup =
  | {
      readonly kind: 'tools'
      readonly id: string
      readonly executions: readonly ToolExecution[]
    }
  | {
      readonly kind: 'single'
      readonly execution: Exclude<
        ConversationRunExecutionViewModel,
        ToolExecution
      >
    }

function groupExecutions(
  executions: readonly ConversationRunExecutionViewModel[],
): readonly ExecutionGroup[] {
  const groups: ExecutionGroup[] = []

  for (const execution of executions) {
    if (execution.kind !== 'tool') {
      groups.push({ kind: 'single', execution })
      continue
    }

    const lastGroup = groups.at(-1)
    if (lastGroup?.kind === 'tools') {
      groups[groups.length - 1] = {
        ...lastGroup,
        executions: [...lastGroup.executions, execution],
      }
      continue
    }

    groups.push({
      kind: 'tools',
      id: `tools-${execution.id}`,
      executions: [execution],
    })
  }

  return groups
}

interface AgentRunExecutionsProps {
  executions: readonly ConversationRunExecutionViewModel[]
  changesById: ReadonlyMap<
    string,
    ConversationChangesViewModel['files'][number]
  >
  approvalsById: ReadonlyMap<string, ConversationApprovalViewModel>
  approvalController?: ApprovalController
}

function AgentRunExecutions({
  executions,
  changesById,
  approvalsById,
  approvalController,
}: AgentRunExecutionsProps) {
  return groupExecutions(executions).map((group) => {
    if (group.kind === 'tools') {
      return (
        <div key={group.id} className="border-t border-border/50">
          {group.executions.map(({ id, tool }) => (
            <ToolCallCard
              key={id}
              title={tool.title}
              status={tool.status}
              description={tool.description}
              metadata={tool.outputSummary}
              delta={tool.delta}
              action={
                tool.actionLabel ? (
                  <button
                    type="button"
                    className="rounded-xs text-sm font-medium text-primary outline-none hover:text-primary-hover hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    {tool.actionLabel}
                  </button>
                ) : undefined
              }
            />
          ))}
        </div>
      )
    }

    const { execution } = group
    if (execution.kind === 'diff') {
      const change = changesById.get(execution.changeId)
      if (!change) return null
      return change.lines.length > 0 ? (
        <DiffCard
          key={execution.id}
          className="mt-3"
          fileName={change.path}
          lines={change.lines}
        />
      ) : (
        <div key={execution.id} className="mt-3 border-t border-border/50">
          <ToolCallCard
            title={change.path}
            description="文件已变更，Host 未提供可展示的 Diff"
            status="completed"
            delta={{
              additions: change.additions,
              deletions: change.deletions,
            }}
          />
        </div>
      )
    }

    if (execution.kind === 'shell') {
      return (
        <div key={execution.id} className="mt-3 border-t border-border/50">
          <ShellRunCard
            command={execution.shell.command}
            status={execution.shell.status}
            summary={execution.shell.summary}
          />
        </div>
      )
    }

    const pendingApproval = approvalsById.get(execution.approvalId)
    if (pendingApproval === undefined) return null

    const controlState = approvalController?.states[pendingApproval.id]
    const submitting = controlState?.state === 'submitting'
    const presentation =
      pendingApproval.kind === 'command'
        ? createToolPresentation({
            command: pendingApproval.summary,
            status: 'running',
          })
        : undefined
    const title = presentation?.title ?? pendingApproval.title
    const subtitle =
      presentation === undefined
        ? pendingApproval.summary
        : createToolCommandSubtitle(pendingApproval.summary)

    return (
      <div
        key={execution.id}
        className="mt-3 border-t border-status-waiting/25 bg-status-waiting-muted/10"
      >
        <ToolCallCard
          title={subtitle}
          description={title}
          status="waiting"
          metadata={
            <span className="inline-flex max-w-48 items-center gap-2">
              <span className="truncate">
                {compactContext(pendingApproval.context)}
              </span>
              <span className="shrink-0">{pendingApproval.requestedAt}</span>
            </span>
          }
          action={
            approvalController ? (
              <span className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-text-secondary"
                  disabled={submitting || !approvalController.enabled}
                  onClick={() => {
                    void approvalController.resolve(
                      pendingApproval.id,
                      'decline',
                    )
                  }}
                >
                  {submitting && controlState?.decision === 'decline'
                    ? '正在拒绝…'
                    : '拒绝'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={submitting || !approvalController.enabled}
                  onClick={() => {
                    void approvalController.resolve(
                      pendingApproval.id,
                      'accept',
                    )
                  }}
                >
                  {submitting && controlState?.decision === 'accept'
                    ? '正在允许…'
                    : '允许一次'}
                </Button>
              </span>
            ) : undefined
          }
          aria-label={`${pendingApproval.title}，等待审批`}
        />
        {controlState?.error ? (
          <p role="alert" className="px-8 pb-2 text-xs text-danger">
            {controlState.error}
          </p>
        ) : null}
      </div>
    )
  })
}

function emptyRunMessage(
  id: string,
  time: string,
  status: ConversationMessageViewModel['status'],
): ConversationMessageViewModel {
  return { id: `${id}-message`, author: 'agent', body: '', time, status }
}

export function ConversationTimeline({
  agent,
  timeline,
  changes,
  pendingApprovals,
  approvalController,
}: ConversationTimelineProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const followsLatest = useRef(true)
  const frame = useRef<number | undefined>(undefined)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const changesById = useMemo(
    () => new Map(changes.files.map((change) => [change.id, change])),
    [changes.files],
  )
  const approvalsById = useMemo(
    () => new Map(pendingApprovals.map((approval) => [approval.id, approval])),
    [pendingApprovals],
  )
  const activityVersion = useMemo(
    () =>
      timeline.blocks
        .map((block) =>
          block.kind === 'message'
            ? `${block.id}:${block.message.body.length}:${block.message.status ?? ''}`
            : `${block.id}:${block.status}:${block.executions
                .map((execution) =>
                  execution.kind === 'tool'
                    ? `${execution.id}:${execution.tool.status}:${execution.tool.outputSummary?.length ?? 0}`
                    : execution.id,
                )
                .join(',')}:${block.outcome ?? ''}`,
        )
        .join('|'),
    [timeline.blocks],
  )

  const scrollToLatest = useCallback(() => {
    const viewport = viewportRef.current
    if (viewport === null) return
    followsLatest.current = true
    viewport.scrollTop = viewport.scrollHeight
    setShowJumpToLatest(false)
  }, [])

  useLayoutEffect(() => {
    if (!followsLatest.current) {
      setShowJumpToLatest(true)
      return
    }
    if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined
      scrollToLatest()
    })
    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    }
  }, [activityVersion, pendingApprovals.length, scrollToLatest])

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const viewport = event.currentTarget
    const nearBottom = isNearTimelineBottom(
      viewport.scrollTop,
      viewport.clientHeight,
      viewport.scrollHeight,
    )
    followsLatest.current = nearBottom
    if (nearBottom) setShowJumpToLatest(false)
  }, [])

  return (
    <div className="relative min-h-0 bg-background">
      <ScrollArea
        aria-label="会话执行时间线"
        className="h-full"
        viewportRef={viewportRef}
        onViewportScroll={handleScroll}
      >
        <div className="mx-auto w-full max-w-3xl px-5 pb-5">
          <p className="flex h-[var(--layout-conversation-day-marker-height)] items-center justify-center text-center text-xs text-text-muted">
            {timeline.dayLabel}
          </p>

          {timeline.blocks.length > 0 ? (
            <div className="space-y-3">
              {timeline.blocks.map((block) => {
                if (block.kind === 'message') {
                  return block.message.author === 'user' ? (
                    <UserMessage
                      key={block.id}
                      message={block.message}
                      className="min-h-19"
                    />
                  ) : (
                    <AgentMessage
                      key={block.id}
                      agent={agent}
                      message={block.message}
                      className="py-2"
                    />
                  )
                }

                const message =
                  block.message ??
                  emptyRunMessage(block.id, block.time, block.status)
                const runContent =
                  block.executions.length > 0 || block.outcomeText ? (
                    <>
                      {block.executions.length > 0 ? (
                        <AgentRunExecutions
                          executions={block.executions}
                          changesById={changesById}
                          approvalsById={approvalsById}
                          approvalController={approvalController}
                        />
                      ) : null}
                      {block.outcomeText ? (
                        <p
                          role="status"
                          data-outcome={block.outcome}
                          className="mt-3 text-sm font-regular text-text-secondary"
                        >
                          {block.outcomeText}
                        </p>
                      ) : null}
                    </>
                  ) : undefined

                return (
                  <AgentMessage key={block.id} agent={agent} message={message}>
                    {runContent}
                  </AgentMessage>
                )
              })}
            </div>
          ) : (
            <p
              role="status"
              className="rounded-sm bg-surface-muted/25 px-4 py-8 text-center text-sm text-text-muted"
            >
              开始新会话
            </p>
          )}
        </div>
      </ScrollArea>
      {showJumpToLatest ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="absolute right-5 bottom-3 h-8 shadow-sm"
          onClick={scrollToLatest}
        >
          跳到最新
        </Button>
      ) : null}
    </div>
  )
}

function compactContext(value: string | undefined): string {
  if (value === undefined) return 'Host 管理'
  const segments = value.replace(/\\/gu, '/').split('/').filter(Boolean)
  return segments.slice(-2).join('/') || value
}

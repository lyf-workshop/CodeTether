import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type UIEvent,
} from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  LoaderCircle,
} from 'lucide-react'

import type { MachineId, ProjectId } from '@codetether/protocol'
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
  ConversationNativeHistoryViewModel,
  ConversationRunExecutionViewModel,
  ConversationTimelineViewModel,
} from './conversation-view-model'
import {
  isNearTimelineBottom,
  type FailedTurnRetryController,
} from './conversation-controls'
import { ConversationFailureCard } from './conversation-failure-card'
import {
  createTimelineAnchorRequestKey,
  decideTimelineScroll,
  timelineContainsTurn,
  type TimelineUpdateKind,
} from './conversation-timeline-behavior'
import { createToolPresentation } from './tool-presentation'
import { groupRunExecutions } from './tool-grouping'
import { presentProjectPaths } from './message-presentation'
import { AgentMessage, UserMessage } from './message'

interface ConversationTimelineProps {
  anchorRequestKey?: string
  agent: AgentId
  timeline: ConversationTimelineViewModel
  changes: ConversationChangesViewModel
  pendingApprovals: readonly ConversationApprovalViewModel[]
  machineId?: MachineId
  projectId?: ProjectId
  projectRootPath?: string
  retryController?: FailedTurnRetryController
  targetChangeId?: string
  targetChangeRequestKey?: number
  targetTurnId?: string
}

type ToolExecution = Extract<
  ConversationRunExecutionViewModel,
  { readonly kind: 'tool' }
>

function ToolExecutionRow({
  execution,
  projectRootPath,
}: {
  readonly execution: ToolExecution
  readonly projectRootPath?: string
}) {
  const { tool } = execution
  return (
    <ToolCallCard
      title={presentProjectPaths(tool.title, projectRootPath)}
      status={tool.status}
      description={
        tool.description === undefined
          ? undefined
          : presentProjectPaths(tool.description, projectRootPath)
      }
      metadata={
        tool.outputSummary === undefined
          ? undefined
          : presentProjectPaths(tool.outputSummary, projectRootPath)
      }
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
  )
}

function RoutineToolGroup({
  executions,
  projectRootPath,
}: {
  readonly executions: readonly ToolExecution[]
  readonly projectRootPath?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const label = `已完成 ${executions.length} 个操作`

  return (
    <section
      aria-label={label}
      data-tool-group="routine"
      data-tool-group-count={executions.length}
      className="min-w-0 border-t border-border/50"
    >
      <button
        type="button"
        aria-expanded={expanded}
        className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-xs px-1 text-left text-sm text-text-secondary outline-none transition-colors hover:bg-surface-muted/35 hover:text-text-primary focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60 motion-reduce:transition-none"
        onClick={() => setExpanded((current) => !current)}
      >
        <CheckCircle2
          aria-hidden="true"
          className="size-4 shrink-0 text-success"
        />
        <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
        <span className="shrink-0 text-xs text-text-muted">
          {expanded ? '收起' : '展开'}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`size-4 shrink-0 transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded ? (
        <div
          data-tool-group-items="mounted"
          className="border-t border-border/40"
        >
          {executions.map((execution) => (
            <ToolExecutionRow
              key={execution.id}
              execution={execution}
              projectRootPath={projectRootPath}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}

interface AgentRunExecutionsProps {
  executions: readonly ConversationRunExecutionViewModel[]
  changesById: ReadonlyMap<
    string,
    ConversationChangesViewModel['files'][number]
  >
  approvalsById: ReadonlyMap<string, ConversationApprovalViewModel>
  projectRootPath?: string
  selectedChangeId?: string
}

function AgentRunExecutions({
  executions,
  changesById,
  approvalsById,
  projectRootPath,
  selectedChangeId,
}: AgentRunExecutionsProps) {
  return groupRunExecutions(executions).map((group) => {
    if (group.kind === 'routine-tools') {
      return (
        <RoutineToolGroup
          key={group.id}
          executions={group.executions}
          projectRootPath={projectRootPath}
        />
      )
    }

    const { execution } = group
    if (execution.kind === 'tool') {
      return (
        <div key={execution.id} className="border-t border-border/50">
          <ToolExecutionRow
            execution={execution}
            projectRootPath={projectRootPath}
          />
        </div>
      )
    }
    if (execution.kind === 'diff') {
      const change = changesById.get(execution.changeId)
      if (!change) return null
      return (
        <div
          key={execution.id}
          data-change-anchor={change.id}
          data-selected={selectedChangeId === change.id || undefined}
          role="group"
          tabIndex={-1}
          aria-label={`变更详情：${change.path}`}
          className="min-w-0 rounded-sm outline-none data-[selected=true]:ring-1 data-[selected=true]:ring-primary/45 focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          {change.lines.length > 0 ? (
            <DiffCard
              className="mt-3"
              fileName={change.path}
              lines={change.lines}
            />
          ) : (
            <div className="mt-3 border-t border-border/50">
              <ToolCallCard
                title={change.path}
                description="文件已变更，CodeTether 未提供可展示的 Diff"
                status="completed"
                delta={{
                  additions: change.additions,
                  deletions: change.deletions,
                }}
              />
            </div>
          )}
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

    const presentation =
      pendingApproval.kind === 'command'
        ? createToolPresentation({
            command: pendingApproval.summary,
            status: 'running',
          })
        : undefined
    const title = presentation?.title ?? pendingApproval.title

    return (
      <div
        key={execution.id}
        data-approval-history="requested"
        className="mt-3 min-w-0 border-t border-status-waiting/20 bg-status-waiting-muted/5"
      >
        <ToolCallCard
          title={title}
          description="已请求批准 · 请在下方待处理操作中确认"
          status="waiting"
          metadata={
            <span className="inline-flex max-w-48 items-center gap-2">
              <span className="truncate">
                {compactContext(pendingApproval.context)}
              </span>
              <span className="shrink-0">{pendingApproval.requestedAt}</span>
            </span>
          }
          aria-label={`${pendingApproval.title}，等待审批`}
        />
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

function NativeConversationHistory({
  agent,
  history,
  projectRootPath,
}: {
  readonly agent: AgentId
  readonly history: ConversationNativeHistoryViewModel
  readonly projectRootPath?: string
}) {
  const stateCopy = {
    loading: '正在读取更早的消息…',
    empty: '没有更早的消息。',
    unsupported: `已找到原生会话，但当前 ${history.providerName} 版本的更早消息暂时无法显示。原生继续仍可正常使用。`,
    unavailable: '暂时无法读取更早的消息。',
    machine_offline: '更早的消息存储在所属电脑上。电脑重新连接后即可加载。',
    malformed: '更早的消息格式无法安全读取。当前会话仍可继续使用。',
    partial: '仅显示了能够安全读取的部分更早消息。',
    available: undefined,
  } as const
  const copy = stateCopy[history.status]

  return (
    <section
      aria-label={`来自 ${history.providerName} 的只读历史消息`}
      data-native-history="true"
      className="space-y-3"
    >
      <div className="flex min-h-8 items-center gap-3 text-xs text-text-muted">
        <span className="h-px min-w-4 flex-1 bg-border/70" />
        <span className="shrink-0">更早记录 · 来自 {history.providerName}</span>
        <span className="h-px min-w-4 flex-1 bg-border/70" />
      </div>
      {history.hasOlder ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={history.loadingOlder}
            onClick={history.loadOlder}
          >
            {history.loadingOlder ? (
              <LoaderCircle
                aria-hidden="true"
                className="size-4 animate-spin motion-reduce:animate-none"
              />
            ) : (
              <ChevronUp aria-hidden="true" className="size-4" />
            )}
            {history.loadingOlder ? '正在加载' : '加载更早记录'}
          </Button>
        </div>
      ) : null}
      {copy === undefined ? null : (
        <p
          role="status"
          className="rounded-sm border border-border/60 bg-surface-muted/25 px-3 py-2 text-center text-xs leading-normal text-text-secondary"
        >
          {copy}
        </p>
      )}
      {history.entries.map((entry) => {
        const message: ConversationMessageViewModel = {
          id: entry.id,
          author: entry.role === 'user' ? 'user' : 'agent',
          body: entry.content,
          time: historicalTime(entry.occurredAt),
        }
        return message.author === 'user' ? (
          <UserMessage key={entry.id} message={message} className="min-h-19" />
        ) : (
          <AgentMessage
            key={entry.id}
            agent={agent}
            message={message}
            className="py-2"
            projectRootPath={projectRootPath}
          />
        )
      })}
    </section>
  )
}

export function ConversationTimeline({
  anchorRequestKey,
  agent,
  timeline,
  changes,
  pendingApprovals,
  machineId,
  projectId,
  projectRootPath,
  retryController,
  targetChangeId,
  targetChangeRequestKey,
  targetTurnId,
}: ConversationTimelineProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const followsLatest = useRef(true)
  const previousTimelineState = useRef<
    | {
        readonly activityVersion: string
        readonly approvalVersion: string
      }
    | undefined
  >(undefined)
  const lastFocusedChangeRequest = useRef<string | undefined>(undefined)
  const lastFocusedTurnRequest = useRef<string | undefined>(undefined)
  const waiting = pendingApprovals.length > 0
  const waitingRef = useRef(waiting)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const missingTurnTarget =
    targetTurnId !== undefined &&
    !timelineContainsTurn(timeline.blocks, targetTurnId)
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
      [
        timeline.nativeHistory === undefined
          ? ''
          : `${timeline.nativeHistory.status}:${timeline.nativeHistory.entries
              .map((entry) => entry.id)
              .join(',')}:${timeline.nativeHistory.loadingOlder}`,
        ...timeline.blocks.map((block) =>
          block.kind === 'message'
            ? `${block.id}:${block.message.body.length}:${block.message.status ?? ''}`
            : `${block.id}:${block.status}:${block.executions
                .map((execution) =>
                  execution.kind === 'tool'
                    ? `${execution.id}:${execution.tool.status}:${execution.tool.outputSummary?.length ?? 0}`
                    : execution.id,
                )
                .join(',')}:${block.outcome ?? ''}`,
        ),
      ].join('|'),
    [timeline.blocks, timeline.nativeHistory],
  )
  const approvalVersion = useMemo(
    () => pendingApprovals.map((approval) => approval.id).join('|'),
    [pendingApprovals],
  )

  const scrollToLatest = useCallback(() => {
    const viewport = viewportRef.current
    if (viewport === null) return
    followsLatest.current = true
    viewport.scrollTop = viewport.scrollHeight
    setShowJumpToLatest(false)
  }, [])

  const applyTimelineUpdate = useCallback(
    (update: TimelineUpdateKind, updateWaiting: boolean) => {
      const viewport = viewportRef.current
      if (viewport === null) return
      const decision = decideTimelineScroll({
        followsLatest: followsLatest.current,
        update,
        waiting: updateWaiting,
        viewport: {
          scrollTop: viewport.scrollTop,
          clientHeight: viewport.clientHeight,
          scrollHeight: viewport.scrollHeight,
        },
      })

      followsLatest.current = decision.followsLatest
      if (decision.scrollTop !== undefined) {
        viewport.scrollTop = decision.scrollTop
      }
      setShowJumpToLatest(decision.showJumpToLatest)
    },
    [],
  )

  useLayoutEffect(() => {
    waitingRef.current = waiting
  }, [waiting])

  useLayoutEffect(() => {
    const previous = previousTimelineState.current
    const update: TimelineUpdateKind =
      previous === undefined
        ? 'initial'
        : previous.approvalVersion !== approvalVersion
          ? 'approval'
          : 'content'

    previousTimelineState.current = { activityVersion, approvalVersion }
    if (update === 'content' && previous?.activityVersion === activityVersion) {
      return
    }
    applyTimelineUpdate(update, waiting)
  }, [activityVersion, approvalVersion, applyTimelineUpdate, waiting])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (viewport === null || typeof ResizeObserver === 'undefined') return
    let width = viewport.clientWidth
    let height = viewport.clientHeight
    const observer = new ResizeObserver(() => {
      const nextWidth = viewport.clientWidth
      const nextHeight = viewport.clientHeight
      if (nextWidth === width && nextHeight === height) return
      width = nextWidth
      height = nextHeight
      applyTimelineUpdate('viewport-resize', waitingRef.current)
    })
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [applyTimelineUpdate])

  useLayoutEffect(() => {
    if (targetTurnId === undefined) {
      lastFocusedTurnRequest.current = undefined
      return
    }
    const requestKey = createTimelineAnchorRequestKey(
      targetTurnId,
      anchorRequestKey,
    )
    if (requestKey === undefined) return
    if (lastFocusedTurnRequest.current === requestKey) return
    const viewport = viewportRef.current
    if (viewport === null) return
    const target = findTimelineAnchor(viewport, 'turnAnchor', targetTurnId)
    if (target === undefined) return
    lastFocusedTurnRequest.current = requestKey
    focusTimelineAnchor(viewport, target, followsLatest, setShowJumpToLatest)
  }, [activityVersion, anchorRequestKey, targetTurnId])

  useLayoutEffect(() => {
    if (targetChangeId === undefined) {
      lastFocusedChangeRequest.current = undefined
      return
    }
    const requestKey = createTimelineAnchorRequestKey(
      targetChangeId,
      targetChangeRequestKey,
    )
    if (requestKey === undefined) return
    if (lastFocusedChangeRequest.current === requestKey) return
    const viewport = viewportRef.current
    if (viewport === null) return
    const target = findTimelineAnchor(viewport, 'changeAnchor', targetChangeId)
    if (target === undefined) return
    lastFocusedChangeRequest.current = requestKey
    focusTimelineAnchor(viewport, target, followsLatest, setShowJumpToLatest)
  }, [activityVersion, targetChangeId, targetChangeRequestKey])

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const viewport = event.currentTarget
    const nearBottom = isNearTimelineBottom(
      viewport.scrollTop,
      viewport.clientHeight,
      viewport.scrollHeight,
    )
    followsLatest.current = nearBottom
    setShowJumpToLatest(!nearBottom)
  }, [])

  return (
    <div className="relative min-h-0 min-w-0 overflow-hidden bg-background">
      {missingTurnTarget ? (
        <p
          role="status"
          className="absolute top-3 right-5 z-10 max-w-sm rounded-sm border border-border-strong bg-surface-elevated/95 px-3 py-2 text-xs text-text-secondary shadow-sm"
        >
          该轮次不在当前保留的历史中，已显示最近记录。
        </p>
      ) : null}
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

          {timeline.nativeHistory === undefined ? null : (
            <NativeConversationHistory
              agent={agent}
              history={timeline.nativeHistory}
              projectRootPath={projectRootPath}
            />
          )}

          {timeline.nativeHistory !== undefined &&
          timeline.nativeHistory.entries.length > 0 &&
          timeline.blocks.length > 0 ? (
            <div className="my-3 flex min-h-8 items-center gap-3 text-xs text-text-muted">
              <span className="h-px min-w-4 flex-1 bg-border/70" />
              <span className="shrink-0">在 CodeTether 中继续</span>
              <span className="h-px min-w-4 flex-1 bg-border/70" />
            </div>
          ) : null}

          {timeline.blocks.length > 0 ? (
            <div
              className={
                timeline.nativeHistory === undefined
                  ? 'space-y-3'
                  : 'mt-3 space-y-3'
              }
            >
              {timeline.blocks.map((block, index) => {
                const firstBlockForTurn =
                  index === 0 ||
                  timeline.blocks[index - 1]?.turnId !== block.turnId
                let content
                if (block.kind === 'message') {
                  content =
                    block.message.author === 'user' ? (
                      <UserMessage
                        message={block.message}
                        className="min-h-19"
                      />
                    ) : (
                      <AgentMessage
                        agent={agent}
                        message={block.message}
                        className="py-2"
                        projectRootPath={projectRootPath}
                      />
                    )
                } else {
                  const message =
                    block.message ??
                    emptyRunMessage(block.id, block.time, block.status)
                  const runContent =
                    block.executions.length > 0 ||
                    block.outcomeText ||
                    block.failure ? (
                      <>
                        {block.executions.length > 0 ? (
                          <AgentRunExecutions
                            executions={block.executions}
                            changesById={changesById}
                            approvalsById={approvalsById}
                            projectRootPath={projectRootPath}
                            selectedChangeId={targetChangeId}
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
                        {block.failure === undefined ? null : (
                          <ConversationFailureCard
                            failure={block.failure}
                            machineId={machineId}
                            projectId={projectId}
                            retryController={retryController}
                            turnId={block.turnId}
                          />
                        )}
                      </>
                    ) : undefined

                  content = (
                    <AgentMessage
                      agent={agent}
                      message={message}
                      projectRootPath={projectRootPath}
                    >
                      {runContent}
                    </AgentMessage>
                  )
                }

                return (
                  <div
                    key={block.id}
                    {...(firstBlockForTurn
                      ? {
                          'data-turn-anchor': block.turnId,
                          role: 'group',
                          tabIndex: -1,
                          'aria-label': `会话轮次：${
                            block.kind === 'message'
                              ? block.message.time
                              : block.time
                          }`,
                        }
                      : {})}
                    className="min-w-0 scroll-mt-4 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    {content}
                  </div>
                )
              })}
            </div>
          ) : timeline.nativeHistory === undefined ? (
            <p
              role="status"
              className="rounded-sm bg-surface-muted/25 px-4 py-8 text-center text-sm text-text-muted"
            >
              开始新会话
            </p>
          ) : null}
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

function historicalTime(value: string | undefined): string {
  if (value === undefined) return '更早'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '更早'
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function findTimelineAnchor(
  viewport: HTMLElement,
  datasetKey: 'changeAnchor' | 'turnAnchor',
  identity: string,
): HTMLElement | undefined {
  return [
    ...viewport.querySelectorAll<HTMLElement>(
      '[data-turn-anchor], [data-change-anchor]',
    ),
  ].find((candidate) => candidate.dataset[datasetKey] === identity)
}

function focusTimelineAnchor(
  viewport: HTMLElement,
  target: HTMLElement,
  followsLatest: { current: boolean },
  setShowJumpToLatest: (show: boolean) => void,
): void {
  target.scrollIntoView({ behavior: 'instant', block: 'center' })
  target.focus({ preventScroll: true })
  const nearBottom = isNearTimelineBottom(
    viewport.scrollTop,
    viewport.clientHeight,
    viewport.scrollHeight,
  )
  followsLatest.current = nearBottom
  setShowJumpToLatest(!nearBottom)
}

function compactContext(value: string | undefined): string {
  if (value === undefined) return '由 CodeTether 管理'
  const segments = value.replace(/\\/gu, '/').split('/').filter(Boolean)
  return segments.slice(-2).join('/') || value
}

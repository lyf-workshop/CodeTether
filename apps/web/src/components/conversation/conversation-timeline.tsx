import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type UIEvent,
  type ReactNode,
} from 'react'
import { ChevronUp, FilePenLine, LoaderCircle } from 'lucide-react'

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
  groupTimelineTurns,
  timelineContainsTurn,
  type TimelineUpdateKind,
} from './conversation-timeline-behavior'
import { createToolPresentation } from './tool-presentation'
import { groupRunExecutions } from './tool-grouping'
import {
  AgentMessage,
  AgentMessageBody,
  AgentTurnHeader,
  UserMessage,
} from './message'
import { RoutineToolGroup, ToolExecutionRow } from './conversation-tool-rows'
import type { OptimisticMessage } from './optimistic-send'

interface ConversationTimelineProps {
  readonly header?: ReactNode
  anchorRequestKey?: string
  agent: AgentId
  timeline: ConversationTimelineViewModel
  changes: ConversationChangesViewModel
  pendingApprovals: readonly ConversationApprovalViewModel[]
  machineId?: MachineId
  projectId?: ProjectId
  projectRootPath?: string
  onOpenModelControl?: () => void
  retryController?: FailedTurnRetryController
  optimisticSend?: OptimisticMessage
  composerFormId?: string
  canRetrySend?: boolean
  targetChangeId?: string
  targetChangeRequestKey?: number
  targetTurnId?: string
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
          <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-success-text">
            <FilePenLine aria-hidden="true" className="size-3.5" />
            编辑
            <span className="ml-auto tabular-nums text-text-secondary">
              {`改动 ${change.additions + change.deletions} 行`}
            </span>
          </p>
          {change.lines.length > 0 ? (
            <DiffCard fileName={change.path} lines={change.lines} />
          ) : (
            <div className="mt-3 border-t border-border/50">
              <ToolCallCard
                title={change.path}
                description="文件已变更，CodeTether 未提供可展示的差异内容"
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
      data-history-complete={history.historyComplete || undefined}
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
            projectRootPath={projectRootPath}
          />
        )
      })}
    </section>
  )
}

export function ConversationTimeline({
  header,
  anchorRequestKey,
  agent,
  timeline,
  changes,
  pendingApprovals,
  machineId,
  projectId,
  projectRootPath,
  retryController,
  optimisticSend,
  composerFormId,
  canRetrySend,
  onOpenModelControl,
  targetChangeId,
  targetChangeRequestKey,
  targetTurnId,
}: ConversationTimelineProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const followsLatest = useRef(true)
  const lastSendAction = useRef<string | undefined>(undefined)
  const previousTimelineState = useRef<
    | {
        readonly activityVersion: string
        readonly approvalVersion: string
      }
    | undefined
  >(undefined)
  const lastFocusedChangeRequest = useRef<string | undefined>(undefined)
  const lastFocusedTurnRequest = useRef<string | undefined>(undefined)
  const clearTurnHighlight = useRef<(() => void) | undefined>(undefined)
  useLayoutEffect(() => () => clearTurnHighlight.current?.(), [])
  const turnGroups = useMemo(
    () => groupTimelineTurns(timeline.blocks, timeline.turnHeaders),
    [timeline.blocks, timeline.turnHeaders],
  )
  const waiting = pendingApprovals.length > 0
  const waitingRef = useRef(waiting)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const showOptimisticRow =
    optimisticSend !== undefined && optimisticSend.projectedTurnId === undefined
  const hasMessages = timeline.blocks.length > 0 || showOptimisticRow
  const sendStatus =
    optimisticSend === undefined ||
    optimisticSend.state === 'accepted' ||
    (optimisticSend.state === 'sending' && !showOptimisticRow) ? null : (
      <div
        data-send-state={optimisticSend.state}
        className="mt-2 flex flex-wrap items-center gap-1 text-xs text-text-secondary"
      >
        {optimisticSend.state === 'failed' ||
        optimisticSend.state === 'uncertain' ? (
          <span role="status" className="text-danger-text">
            {optimisticSend.state === 'uncertain' ? '发送结果未确认' : '未发送'}
            {optimisticSend.canRetry && composerFormId !== undefined
              ? ' ·'
              : ''}
          </span>
        ) : (
          <span role="status">正在发送</span>
        )}
        {optimisticSend.state === 'failed' &&
        optimisticSend.canRetry &&
        composerFormId !== undefined ? (
          <Button
            type="submit"
            form={composerFormId}
            data-retry-action={optimisticSend.actionId}
            variant="ghost"
            size="sm"
            disabled={canRetrySend !== true}
            className="h-auto px-1 py-0 text-xs"
          >
            重试
          </Button>
        ) : null}
      </div>
    )
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
  const canonicalActivityVersion = useMemo(
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
                    ? `${execution.id}:${execution.tool.status}:${execution.tool.output?.length ?? execution.tool.outputSummary?.length ?? 0}`
                    : execution.id,
                )
                .join(',')}:${block.outcome ?? ''}`,
        ),
      ].join('|'),
    [timeline.blocks, timeline.nativeHistory],
  )
  const activityVersion =
    optimisticSend === undefined
      ? canonicalActivityVersion
      : `${canonicalActivityVersion}|${optimisticSend.actionId}:${optimisticSend.state}:${optimisticSend.projectedTurnId ?? ''}`
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

  const sendActionId = optimisticSend?.actionId
  useLayoutEffect(() => {
    if (
      optimisticSend?.state === 'sending' &&
      lastSendAction.current !== sendActionId
    )
      scrollToLatest()
    lastSendAction.current = sendActionId
  }, [optimisticSend?.state, scrollToLatest, sendActionId])

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
      clearTurnHighlight.current?.()
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
    clearTurnHighlight.current?.()
    clearTurnHighlight.current = highlightTimelineTurn(target)
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
    <div className="relative min-h-0 min-w-0 overflow-hidden bg-timeline-background">
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
        <div className="mx-auto w-full min-w-0 max-w-(--read-w) px-8 pb-8 [contain:inline-size] max-sm:px-4">
          {header === undefined ? null : (
            <div className="sticky top-0 z-10 -mx-8 bg-timeline-background/95 px-8 backdrop-blur-sm max-sm:-mx-4 max-sm:px-4">
              {header}
            </div>
          )}
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
          hasMessages ? (
            <div className="my-3 flex min-h-8 items-center gap-3 text-xs text-text-muted">
              <span className="h-px min-w-4 flex-1 bg-border/70" />
              <span className="shrink-0">在 CodeTether 中继续</span>
              <span className="h-px min-w-4 flex-1 bg-border/70" />
            </div>
          ) : null}

          {hasMessages ? (
            <div
              className={
                timeline.nativeHistory === undefined
                  ? 'space-y-(--timeline-message-spacing)'
                  : 'mt-3 space-y-(--timeline-message-spacing)'
              }
            >
              {turnGroups.map(({ id, header: turnHeader, blocks }) => (
                <section
                  key={id}
                  data-turn-anchor={id}
                  role="group"
                  tabIndex={-1}
                  aria-label={`会话轮次：${turnHeader.time}`}
                  className="relative min-w-0 space-y-(--timeline-message-spacing) rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  {blocks.map((block) =>
                    block.kind === 'message' &&
                    block.message.author === 'user' ? (
                      <UserMessage key={block.id} message={block.message}>
                        {optimisticSend?.projectedTurnId === id
                          ? sendStatus
                          : null}
                      </UserMessage>
                    ) : null,
                  )}
                  <article className="min-w-0 rounded-lg bg-timeline-message px-5 py-4">
                    <AgentTurnHeader agent={agent} header={turnHeader} turn />
                    <div className="min-w-0 space-y-(--timeline-message-spacing) mt-2 pl-11 empty:hidden max-sm:pl-0">
                      {blocks.map((block) =>
                        block.kind === 'message' ? (
                          block.message.author === 'agent' &&
                          block.message.body ? (
                            <AgentMessageBody
                              key={block.id}
                              message={block.message}
                              projectRootPath={projectRootPath}
                            />
                          ) : null
                        ) : (
                          <div
                            key={block.id}
                            className="min-w-0 space-y-3 empty:hidden"
                          >
                            {block.message?.body ? (
                              <AgentMessageBody
                                message={block.message}
                                projectRootPath={projectRootPath}
                              />
                            ) : null}
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
                                data-turn-running={
                                  block.status === 'running' ||
                                  block.status === 'waiting'
                                    ? block.status
                                    : undefined
                                }
                                className="rounded-md border-2 border-status-idle bg-timeline-system px-4 py-3 text-sm text-text-secondary data-[turn-running=running]:border-status-running data-[turn-running=waiting]:border-status-waiting"
                              >
                                {block.outcomeText}
                              </p>
                            ) : null}
                            {block.failure === undefined ? null : (
                              <ConversationFailureCard
                                failure={block.failure}
                                machineId={machineId}
                                projectId={projectId}
                                retryController={
                                  optimisticSend?.projectedTurnId === id
                                    ? undefined
                                    : retryController
                                }
                                onOpenModelControl={onOpenModelControl}
                                turnId={id}
                              />
                            )}
                          </div>
                        ),
                      )}
                    </div>
                  </article>
                </section>
              ))}
              {showOptimisticRow ? (
                <UserMessage
                  key={optimisticSend.actionId}
                  message={{
                    id: optimisticSend.actionId,
                    author: 'user',
                    body: optimisticSend.text,
                    time: historicalTime(optimisticSend.timestamp),
                  }}
                >
                  {sendStatus}
                </UserMessage>
              ) : null}
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

function highlightTimelineTurn(target: HTMLElement): () => void {
  target.dataset.turnHighlight = 'true'
  const timer = window.setTimeout(clear, 2000)
  return clear

  function clear() {
    window.clearTimeout(timer)
    delete target.dataset.turnHighlight
  }
}

function compactContext(value: string | undefined): string {
  if (value === undefined) return '由 CodeTether 管理'
  const segments = value.replace(/\\/gu, '/').split('/').filter(Boolean)
  return segments.slice(-2).join('/') || value
}

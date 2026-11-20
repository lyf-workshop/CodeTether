import { useEffect, useState, type ComponentPropsWithoutRef } from 'react'
import { FileCode2, Files, PanelRightClose, SquareTerminal } from 'lucide-react'

import {
  Badge,
  IconButton,
  ScrollArea,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  agentDefinitions,
  cn,
} from '@codetether/ui'

import { formatConversationDuration } from './conversation-duration'
import type { ConversationDisplayContext } from './conversation-gate-presentation'
import { ConversationFilesSurface } from './conversation-files-surface'
import type {
  ConversationChangesViewModel,
  ConversationTerminalViewModel,
  ConversationViewModel,
} from './conversation-view-model'
import {
  resolveConversationInspectorTab,
  type InspectorTab,
} from './conversation-inspector-state'

function LiveDuration({
  conversation,
}: {
  conversation: ConversationViewModel
}) {
  const running = conversation.durationRunning === true
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!running || conversation.durationStartedAt === undefined) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [conversation.durationStartedAt, running])

  if (
    conversation.durationStartedAt === undefined ||
    (!running && conversation.durationCompletedAt === undefined)
  ) {
    return <>{conversation.duration}</>
  }

  return (
    <>
      {formatConversationDuration({
        startedAt: conversation.durationStartedAt,
        completedAt: conversation.durationCompletedAt,
        running,
        now,
      })}
    </>
  )
}

function ConversationMetadata({
  conversation,
}: {
  conversation: ConversationViewModel
}) {
  const agent = agentDefinitions[conversation.agent]
  const branch =
    conversation.branch === '未提供' ? undefined : conversation.branch

  return (
    <div className="border-b border-border/55 px-4 py-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge
            variant="secondary"
            className="max-w-[9rem] truncate rounded-sm"
          >
            {agent.name}
          </Badge>
          <span className="truncate text-sm text-text-secondary">
            {conversation.machine}
          </span>
        </div>
        <StatusBadge
          status={conversation.status}
          showIcon={false}
          className="h-auto shrink-0 border-0 bg-transparent p-0 text-xs font-regular"
        />
      </div>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <dt className="text-text-muted">模型</dt>
        <dd className="min-w-0 truncate text-text-secondary">
          {conversation.model}
          {conversation.capabilities.supportsReasoningControl
            ? ` · ${conversation.reasoning}`
            : ''}
        </dd>
        <dt className="text-text-muted">时长</dt>
        <dd className="tabular-nums text-text-secondary">
          <LiveDuration conversation={conversation} />
        </dd>
        <dt className="text-text-muted">权限</dt>
        <dd className="min-w-0 truncate text-text-secondary">
          {conversation.permission}
        </dd>
        {branch === undefined ? null : (
          <>
            <dt className="text-text-muted">分支</dt>
            <dd className="min-w-0 truncate text-text-secondary">{branch}</dd>
          </>
        )}
      </dl>
    </div>
  )
}

interface ChangesSummaryProps {
  changes: ConversationChangesViewModel
  onChangeSelect?: (changeId: string) => void
  selectedChangeId?: string
}

function ChangesSummary({
  changes,
  onChangeSelect,
  selectedChangeId,
}: ChangesSummaryProps) {
  const { files, totals } = changes

  return (
    <section aria-label="变更文件列表" className="space-y-3 py-2">
      {files.length > 0 ? (
        <>
          <div
            className="mb-2 flex justify-end gap-1"
            aria-label={`新增 ${totals.additions} 行，删除 ${totals.deletions} 行`}
          >
            {totals.additions > 0 ? (
              <Badge
                variant="success"
                className="h-5 border-transparent px-2 text-xs tabular-nums"
              >
                +{totals.additions}
              </Badge>
            ) : null}
            {totals.deletions > 0 ? (
              <Badge
                variant="danger"
                className="h-5 border-transparent px-2 text-xs tabular-nums"
              >
                -{totals.deletions}
              </Badge>
            ) : null}
          </div>
          <ul aria-label={`${files.length} 个变更文件`} className="space-y-0.5">
            {files.map((change) => (
              <li key={change.id} className="min-w-0">
                <button
                  type="button"
                  aria-current={
                    selectedChangeId === change.id ? 'location' : undefined
                  }
                  disabled={onChangeSelect === undefined}
                  onClick={() => onChangeSelect?.(change.id)}
                  className={cn(
                    'flex min-h-8 w-full min-w-0 items-center gap-2 rounded-sm px-1.5 text-left text-sm outline-none transition-colors motion-reduce:transition-none',
                    onChangeSelect === undefined
                      ? 'cursor-default'
                      : 'hover:bg-surface-muted/55 focus-visible:ring-2 focus-visible:ring-ring/60',
                    selectedChangeId === change.id &&
                      'bg-primary-muted/45 text-text-primary',
                  )}
                >
                  <FileCode2
                    aria-hidden="true"
                    className="size-3.5 shrink-0 text-text-muted"
                  />
                  <span
                    className="min-w-0 flex-1 truncate text-text-primary"
                    title={change.path}
                  >
                    {change.path}
                  </span>
                  {change.additions > 0 ? (
                    <span className="shrink-0 font-medium tabular-nums text-success-text">
                      +{change.additions}
                    </span>
                  ) : null}
                  {change.deletions > 0 ? (
                    <span className="shrink-0 font-medium tabular-nums text-danger-text">
                      -{change.deletions}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p role="status" className="text-sm text-text-muted">
          暂无文件变更。
        </p>
      )}
    </section>
  )
}

function ToolOutputSummary({
  conversation,
  terminal,
}: {
  conversation: ConversationViewModel
  terminal: ConversationTerminalViewModel
}) {
  const toolEntries = conversation.timeline.blocks.flatMap((block) =>
    block.kind === 'agent-run'
      ? block.executions.flatMap((execution) => {
          if (execution.kind === 'tool') {
            return [
              {
                id: execution.id,
                title:
                  execution.tool.displayCommand ??
                  execution.tool.subject ??
                  execution.tool.title,
                summary:
                  execution.tool.outputSummary ?? execution.tool.description,
                status: execution.tool.status,
              },
            ]
          }
          if (execution.kind === 'shell') {
            return [
              {
                id: execution.id,
                title: execution.shell.command,
                summary: execution.shell.summary,
                status: execution.shell.status,
              },
            ]
          }
          return []
        })
      : [],
  )
  const output = [
    ...(terminal.command ? [terminal.command] : []),
    ...terminal.lines,
  ].join('\n')

  return (
    <section aria-label="工具执行结果" className="py-2">
      {toolEntries.length > 0 ? (
        <ul aria-label="工具执行记录" className="mb-4 space-y-2">
          {toolEntries.map((entry) => (
            <li
              key={entry.id}
              className="min-w-0 border-b border-border/45 pb-2 last:border-b-0"
            >
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm text-text-primary">
                  {entry.title}
                </span>
                <StatusBadge
                  status={entry.status}
                  showIcon={false}
                  className="h-auto shrink-0 border-0 bg-transparent p-0 text-xs"
                />
              </div>
              {entry.summary === undefined ? null : (
                <p className="mt-1 break-words text-xs leading-normal text-text-secondary">
                  {entry.summary}
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {output.length > 0 ? (
        <>
          <pre
            tabIndex={0}
            aria-label="最近工具输出"
            className="max-h-[min(32rem,55vh)] overflow-auto whitespace-pre-wrap break-words font-mono text-sm leading-normal text-text-secondary outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <code>{output}</code>
          </pre>
          {terminal.truncated ? (
            <p className="mt-2 text-xs text-text-muted">
              较早的工具输出已截断。
            </p>
          ) : null}
        </>
      ) : toolEntries.length === 0 ? (
        <p role="status" className="text-sm text-text-muted">
          暂无工具输出。
        </p>
      ) : null}
    </section>
  )
}

export interface InspectorPanelProps extends Omit<
  ComponentPropsWithoutRef<'aside'>,
  'children'
> {
  conversation: ConversationViewModel
  displayContext?: ConversationDisplayContext
  changes: ConversationChangesViewModel
  terminal: ConversationTerminalViewModel
  /** Retained for API compatibility; Context is no longer rendered. */
  context?: readonly unknown[]
  initialTab?: InspectorTab
  tab?: InspectorTab
  onTabChange?: (tab: InspectorTab) => void
  onChangeSelect?: (changeId: string) => void
  onClose?: () => void
  selectedChangeId?: string
}

export type { InspectorTab } from './conversation-inspector-state'

export function InspectorPanel({
  conversation,
  displayContext,
  changes,
  terminal,
  initialTab,
  tab,
  onTabChange,
  onChangeSelect,
  onClose,
  selectedChangeId,
  className,
  ...props
}: InspectorPanelProps) {
  const supportsDiff =
    conversation.capabilities.supportsDiff &&
    displayContext?.machineKind === 'local'
  const supportsToolOutput =
    conversation.capabilities.supportsToolOutput ||
    conversation.capabilities.supportsShell
  const viewedFiles = conversation.viewedFiles ?? []
  const showViewedFiles = !supportsDiff && viewedFiles.length > 0
  const effectiveTab = resolveConversationInspectorTab(tab ?? initialTab, {
    supportsDiff,
    hasChanges: changes.files.length > 0,
    hasViewedFiles: showViewedFiles,
    supportsToolOutput,
    hasToolOutput:
      terminal.lines.length > 0 ||
      conversation.timeline.blocks.some(
        (block) =>
          block.kind === 'agent-run' &&
          block.executions.some(
            (execution) =>
              execution.kind === 'tool' || execution.kind === 'shell',
          ),
      ),
  })

  return (
    <aside
      aria-label="文件与工具输出"
      className={cn(
        'flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-l border-border bg-surface',
        className,
      )}
      {...props}
    >
      <Tabs
        value={effectiveTab ?? ''}
        onValueChange={(value) => onTabChange?.(value as InspectorTab)}
        className="min-h-0 flex-1 gap-0"
      >
        {effectiveTab === undefined && onClose === undefined ? null : (
          <div className="flex shrink-0 items-center gap-2 px-4 pt-2 pb-2">
            {effectiveTab === undefined ? null : (
              <TabsList
                variant="line"
                aria-label="文件面板视图"
                className="h-9 w-full gap-1 bg-transparent"
              >
                {supportsDiff ? (
                  <TabsTrigger
                    value="changes"
                    className="h-9 flex-1 px-1 text-sm"
                  >
                    变更
                  </TabsTrigger>
                ) : null}
                {showViewedFiles ? (
                  <TabsTrigger
                    value="files"
                    className="h-9 flex-1 px-1 text-sm"
                  >
                    <Files aria-hidden="true" />
                    已查看文件
                  </TabsTrigger>
                ) : null}
                {supportsToolOutput ? (
                  <TabsTrigger
                    value="tools"
                    className="h-9 flex-1 px-1 text-sm"
                  >
                    <SquareTerminal aria-hidden="true" />
                    工具输出
                  </TabsTrigger>
                ) : null}
              </TabsList>
            )}
            {onClose ? (
              <IconButton
                label="关闭文件与工具输出"
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={onClose}
              >
                <PanelRightClose aria-hidden="true" />
              </IconButton>
            ) : null}
          </div>
        )}

        {showViewedFiles ? (
          <TabsContent value="files" className="min-h-0 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="w-full min-w-0 px-4 pb-4 [contain:inline-size]">
                <ConversationFilesSurface files={viewedFiles} />
              </div>
            </ScrollArea>
          </TabsContent>
        ) : null}

        {supportsDiff ? (
          <TabsContent value="changes" className="min-h-0 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="w-full min-w-0 px-4 pb-4 [contain:inline-size]">
                <ChangesSummary
                  changes={changes}
                  onChangeSelect={onChangeSelect}
                  selectedChangeId={selectedChangeId}
                />
              </div>
            </ScrollArea>
          </TabsContent>
        ) : null}

        {supportsToolOutput ? (
          <TabsContent value="tools" className="min-h-0 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="w-full min-w-0 px-4 pb-4 [contain:inline-size]">
                <ToolOutputSummary
                  conversation={conversation}
                  terminal={terminal}
                />
              </div>
            </ScrollArea>
          </TabsContent>
        ) : null}
      </Tabs>
      <details className="shrink-0 border-t border-border px-4 py-2 text-sm text-text-secondary">
        <summary className="cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
          会话信息
        </summary>
        <ConversationMetadata conversation={conversation} />
      </details>
    </aside>
  )
}

import { useId, useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  FilePenLine,
  FileText,
  Search,
  Terminal,
  Wrench,
} from 'lucide-react'

import { statusDefinitions } from '@codetether/ui'

import type { ConversationRunExecutionViewModel } from './conversation-view-model'
import { presentProjectPaths } from './message-presentation'
import { routineToolGroupLabel } from './tool-grouping'
import type { ToolPresentationKind } from './tool-presentation'

type ToolExecution = Extract<
  ConversationRunExecutionViewModel,
  { readonly kind: 'tool' }
>

const toolKinds = {
  'read-file': { icon: FileText, label: '读取', color: 'text-info-text' },
  'edit-file': { icon: FilePenLine, label: '编辑', color: 'text-success-text' },
  search: { icon: Search, label: '搜索', color: 'text-tool-search' },
  command: { icon: Terminal, label: '执行命令', color: 'text-warning-text' },
  'git-status': {
    icon: Terminal,
    label: '执行命令',
    color: 'text-warning-text',
  },
  test: { icon: Terminal, label: '执行命令', color: 'text-warning-text' },
  generic: { icon: Wrench, label: '使用工具', color: 'text-text-muted' },
} satisfies Record<
  ToolPresentationKind,
  { icon: typeof Terminal; label: string; color: string }
>

const disclosureClass =
  'flex min-h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition-colors hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none'

const durationFormat = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 1,
})

function formatDuration(durationMs: number): string {
  return durationMs < 1000
    ? `${durationFormat.format(durationMs)} 毫秒`
    : `${durationFormat.format(durationMs / 1000)} 秒`
}

export function ToolExecutionRow({
  execution,
  projectRootPath,
}: {
  readonly execution: ToolExecution
  readonly projectRootPath?: string
}) {
  const { tool } = execution
  const contentId = useId()
  const [disclosure, setDisclosure] = useState<{
    readonly failed: boolean
    readonly expanded: boolean
  }>()
  const failed = tool.status === 'failed'
  const expanded = disclosure?.failed === failed ? disclosure.expanded : failed
  const presentation = toolKinds[tool.presentationKind ?? 'generic']
  const Icon = presentation.icon
  const status = statusDefinitions[tool.status]
  const StatusIcon = status.icon
  const subject = presentProjectPaths(
    tool.subject ?? tool.title,
    projectRootPath,
  )
  const command =
    !expanded || tool.displayCommand === undefined
      ? undefined
      : presentProjectPaths(tool.displayCommand, projectRootPath)
  const output = tool.output ?? (failed ? undefined : tool.outputSummary)

  return (
    <div
      data-tool-row={tool.presentationKind ?? 'generic'}
      data-tool-status={tool.status}
      className={`min-w-0 overflow-hidden rounded-md border bg-surface ${failed ? 'border-danger' : 'border-border'}`}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        className={disclosureClass}
        onClick={() => setDisclosure({ failed, expanded: !expanded })}
      >
        <Icon
          aria-hidden="true"
          className={`size-4 shrink-0 ${presentation.color}`}
        />
        <span className="shrink-0 font-medium text-text-primary">
          {presentation.label}
        </span>
        {subject !== presentation.label ? (
          <span
            title={subject}
            className="min-w-0 flex-1 truncate text-text-secondary"
          >
            {subject}
          </span>
        ) : null}
        {tool.delta === undefined ? null : (
          <span className="shrink-0 text-xs tabular-nums text-text-secondary">
            改动 {tool.delta.additions + tool.delta.deletions} 行
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-text-muted">
          <StatusIcon
            aria-hidden="true"
            className={`size-3.5 ${status.iconClassName}`}
          />
          {status.label}
          {tool.durationMs === undefined ? null : (
            <span className="tabular-nums">
              {formatDuration(tool.durationMs)}
            </span>
          )}
        </span>
        <span className="sr-only">{expanded ? '收起详情' : '展开详情'}</span>
        <ChevronDown
          aria-hidden="true"
          className={`size-4 shrink-0 text-text-muted transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      <div id={contentId} hidden={!expanded}>
        {expanded ? (
          <div className="space-y-2 border-t border-border bg-surface-inset p-3">
            {failed ? (
              <p className="text-sm font-medium text-danger-text">
                {tool.failureSummary ?? '工具执行失败'}
              </p>
            ) : null}
            {command === undefined ? null : (
              <pre
                aria-label="执行内容"
                tabIndex={0}
                className="overflow-x-auto whitespace-pre font-mono text-xs text-text-primary focus-visible:outline-ring"
              >
                {command}
              </pre>
            )}
            {output === undefined ? (
              <p className="text-xs text-text-muted">暂无工具输出。</p>
            ) : (
              <pre
                aria-label="工具输出"
                tabIndex={0}
                className="max-h-72 overflow-auto whitespace-pre font-mono text-xs text-text-secondary focus-visible:outline-ring"
              >
                {presentProjectPaths(output, projectRootPath)}
              </pre>
            )}
            {tool.outputTruncated ? (
              <p className="text-xs text-text-muted">仅显示保留的输出末尾。</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function RoutineToolGroup({
  executions,
  projectRootPath,
}: {
  readonly executions: readonly ToolExecution[]
  readonly projectRootPath?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const contentId = useId()
  const label = routineToolGroupLabel(executions)

  return (
    <section
      aria-label={label}
      data-tool-group="routine"
      data-tool-group-count={executions.length}
      className="min-w-0 rounded-md border border-border"
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        className={disclosureClass}
        onClick={() => setExpanded((current) => !current)}
      >
        <CheckCircle2
          aria-hidden="true"
          className="size-4 shrink-0 text-success-text"
        />
        <span className="min-w-0 flex-1 truncate font-medium text-text-primary">
          {label}
        </span>
        <span className="shrink-0 text-xs text-text-muted">
          {expanded ? '收起' : '展开'}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`size-4 shrink-0 text-text-muted transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      <div id={contentId} hidden={!expanded}>
        {expanded ? (
          <div
            data-tool-group-items="mounted"
            className="space-y-1 border-t border-border px-2 py-1.5"
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
      </div>
    </section>
  )
}

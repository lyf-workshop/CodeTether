import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import {
  AtSign,
  FileCode2,
  GitCompareArrows,
  MoreHorizontal,
  SquareTerminal,
  X,
  type LucideIcon,
} from 'lucide-react'

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

import type {
  ConversationChangesViewModel,
  ConversationContextReferenceViewModel,
  ConversationTerminalViewModel,
  ConversationViewModel,
} from './conversation-view-model'
import type { InspectorTab } from './conversation-inspector-state'

const contextIcons = {
  file: AtSign,
  git: GitCompareArrows,
  shell: SquareTerminal,
} satisfies Record<ConversationContextReferenceViewModel['kind'], LucideIcon>

interface InspectorSectionProps extends Omit<
  ComponentPropsWithoutRef<'section'>,
  'title'
> {
  title: string
  action?: ReactNode
}

function InspectorSection({
  title,
  action,
  className,
  children,
  ...props
}: InspectorSectionProps) {
  return (
    <section
      className={cn(
        'border-b border-border/55 py-3 last:border-b-0',
        className,
      )}
      {...props}
    >
      <header className="flex min-w-0 items-center justify-between gap-3">
        <h3 className="truncate text-md font-semibold text-text-primary">
          {title}
        </h3>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      <div className="mt-3 min-w-0">{children}</div>
    </section>
  )
}

interface ConversationInfoProps {
  conversation: ConversationViewModel
}

function ConversationInfo({ conversation }: ConversationInfoProps) {
  const agent = agentDefinitions[conversation.agent]

  return (
    <InspectorSection title="会话信息">
      <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm leading-normal">
        <dt className="font-regular text-text-secondary">智能体</dt>
        <dd className="min-w-0 truncate font-regular text-text-primary">
          {agent.name}
        </dd>

        <dt className="font-regular text-text-secondary">模型</dt>
        <dd className="min-w-0 truncate font-regular text-text-primary">
          {conversation.model}
          {conversation.capabilities.supportsReasoningControl
            ? ` · ${conversation.reasoning}`
            : ''}
        </dd>

        <dt className="font-regular text-text-secondary">状态</dt>
        <dd className="min-w-0">
          <StatusBadge
            status={conversation.status}
            showIcon={false}
            className="h-auto rounded-none border-0 bg-transparent p-0 text-sm font-regular"
          />
        </dd>

        <dt className="font-regular text-text-secondary">机器</dt>
        <dd className="min-w-0 truncate font-regular text-text-primary">
          {conversation.machine}
        </dd>

        <dt className="font-regular text-text-secondary">分支</dt>
        <dd className="min-w-0 break-words font-regular text-text-primary">
          {conversation.branch}
        </dd>

        <dt className="font-regular text-text-secondary">时长</dt>
        <dd className="min-w-0 font-regular tabular-nums text-text-primary">
          {conversation.duration}
        </dd>
      </dl>
    </InspectorSection>
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
  const totalsSummary = (
    <div
      className="flex items-center gap-1"
      aria-label={`新增 ${totals.additions} 行，删除 ${totals.deletions} 行`}
    >
      <Badge
        variant="success"
        className="h-5 border-transparent bg-success-muted/45 px-2 text-xs tabular-nums"
      >
        +{totals.additions}
      </Badge>
      <Badge
        variant="danger"
        className="h-5 border-transparent bg-danger-muted/45 px-2 text-xs tabular-nums"
      >
        -{totals.deletions}
      </Badge>
    </div>
  )

  return (
    <InspectorSection title="变更文件" action={totalsSummary}>
      {files.length > 0 ? (
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
                  className="min-w-0 flex-1 truncate font-regular text-text-primary"
                  title={change.path}
                >
                  {change.name}
                </span>
                <span
                  aria-label={`新增 ${change.additions} 行`}
                  className="shrink-0 font-medium tabular-nums text-success/90"
                >
                  +{change.additions}
                </span>
                {change.deletions > 0 ? (
                  <span
                    aria-label={`删除 ${change.deletions} 行`}
                    className="w-5 shrink-0 font-medium tabular-nums text-danger/90"
                  >
                    -{change.deletions}
                  </span>
                ) : (
                  <span aria-hidden="true" className="w-5 shrink-0" />
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p role="status" className="text-sm font-regular text-text-muted">
          暂无变更。
        </p>
      )}
    </InspectorSection>
  )
}

interface TerminalSummaryProps {
  terminal: ConversationTerminalViewModel
}

function TerminalSummary({ terminal }: TerminalSummaryProps) {
  const output = [
    ...(terminal.command ? [`$ ${terminal.command}`] : []),
    ...terminal.lines,
  ].join('\n')

  return (
    <InspectorSection title="终端">
      {output.length > 0 ? (
        <>
          <pre
            tabIndex={0}
            aria-label="最近终端输出"
            className="max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-sm font-regular leading-normal text-text-secondary outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <code>{output}</code>
          </pre>
          {terminal.truncated ? (
            <p className="mt-2 text-xs font-regular text-text-muted">
              较早的终端输出已截断。
            </p>
          ) : null}
        </>
      ) : (
        <p role="status" className="text-sm font-regular text-text-muted">
          暂无终端输出。
        </p>
      )}
    </InspectorSection>
  )
}

interface ContextSummaryProps {
  context: readonly ConversationContextReferenceViewModel[]
  visibleCount?: number
}

function ContextSummary({ context, visibleCount }: ContextSummaryProps) {
  const visibleContext =
    visibleCount === undefined ? context : context.slice(0, visibleCount)
  const remainingCount = context.length - visibleContext.length

  return (
    <InspectorSection title="上下文">
      {visibleContext.length > 0 ? (
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {visibleContext.map((reference) => {
            const Icon = contextIcons[reference.kind]

            return (
              <Badge
                key={reference.id}
                variant="secondary"
                className="h-6 max-w-full rounded-sm border-transparent bg-surface-muted/60 px-2 text-sm font-regular"
              >
                <Icon aria-hidden="true" />
                <span className="truncate">{reference.label}</span>
              </Badge>
            )
          })}
        </div>
      ) : (
        <p role="status" className="text-sm font-regular text-text-muted">
          暂无上下文。
        </p>
      )}
      {remainingCount > 0 ? (
        <p className="mt-2 text-sm font-regular text-text-muted">
          还有 {remainingCount} 项
        </p>
      ) : null}
    </InspectorSection>
  )
}

type OverviewPaneProps = Pick<
  InspectorPanelProps,
  | 'conversation'
  | 'changes'
  | 'terminal'
  | 'context'
  | 'onChangeSelect'
  | 'selectedChangeId'
>

function OverviewPane({
  conversation,
  changes,
  terminal,
  context,
  onChangeSelect,
  selectedChangeId,
}: OverviewPaneProps) {
  return (
    <div className="px-4 pb-4">
      <ConversationInfo conversation={conversation} />
      {conversation.capabilities.supportsDiff ? (
        <ChangesSummary
          changes={changes}
          onChangeSelect={onChangeSelect}
          selectedChangeId={selectedChangeId}
        />
      ) : null}
      {conversation.capabilities.supportsShell ? (
        <TerminalSummary terminal={terminal} />
      ) : null}
      <ContextSummary context={context} visibleCount={3} />
    </div>
  )
}

export interface InspectorPanelProps extends Omit<
  ComponentPropsWithoutRef<'aside'>,
  'children'
> {
  conversation: ConversationViewModel
  changes: ConversationChangesViewModel
  terminal: ConversationTerminalViewModel
  context: readonly ConversationContextReferenceViewModel[]
  initialTab?: InspectorTab
  tab?: InspectorTab
  onTabChange?: (tab: InspectorTab) => void
  onChangeSelect?: (changeId: string) => void
  onClose?: () => void
  selectedChangeId?: string
}

export type { InspectorTab } from './conversation-inspector-state'

/** Conversation Detail inspector based on the frozen Figma node 14:218. */
export function InspectorPanel({
  conversation,
  changes,
  terminal,
  context,
  initialTab = 'overview',
  tab,
  onTabChange,
  onChangeSelect,
  onClose,
  selectedChangeId,
  className,
  ...props
}: InspectorPanelProps) {
  const requestedTab = tab ?? initialTab
  const effectiveTab =
    (requestedTab === 'changes' && !conversation.capabilities.supportsDiff) ||
    (requestedTab === 'terminal' && !conversation.capabilities.supportsShell)
      ? 'overview'
      : requestedTab

  return (
    <aside
      aria-label="会话检查器"
      className={cn(
        'flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-l border-border bg-surface-inset',
        className,
      )}
      {...props}
    >
      <header className="flex h-13 shrink-0 items-center justify-between gap-3 px-4">
        <h2 className="truncate text-lg font-semibold text-text-primary">
          当前会话
        </h2>
        {onClose ? (
          <IconButton
            label="关闭会话检查器"
            variant="ghost"
            size="sm"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </IconButton>
        ) : (
          <MoreHorizontal
            aria-hidden="true"
            className="size-5 shrink-0 text-text-secondary"
          />
        )}
      </header>

      <Tabs
        value={effectiveTab}
        onValueChange={(value) => onTabChange?.(value as InspectorTab)}
        className="min-h-0 flex-1 gap-0"
      >
        <div className="shrink-0 px-4 pb-2">
          <TabsList
            variant="line"
            aria-label="检查器视图"
            className="h-9 w-full gap-2 bg-transparent"
          >
            <TabsTrigger
              value="overview"
              className="h-9 flex-1 px-1 text-sm font-medium data-[state=active]:text-text-primary"
            >
              概览
            </TabsTrigger>
            {conversation.capabilities.supportsDiff ? (
              <TabsTrigger
                value="changes"
                className="h-9 flex-1 px-1 text-sm font-medium data-[state=active]:text-text-primary"
              >
                变更
              </TabsTrigger>
            ) : null}
            {conversation.capabilities.supportsShell ? (
              <TabsTrigger
                value="terminal"
                className="h-9 flex-1 px-1 text-sm font-medium data-[state=active]:text-text-primary"
              >
                终端
              </TabsTrigger>
            ) : null}
            <TabsTrigger
              value="context"
              className="h-9 flex-1 px-1 text-sm font-medium data-[state=active]:text-text-primary"
            >
              上下文
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="min-h-0 overflow-hidden">
          <ScrollArea className="h-full">
            <OverviewPane
              conversation={conversation}
              changes={changes}
              terminal={terminal}
              context={context}
              onChangeSelect={onChangeSelect}
              selectedChangeId={selectedChangeId}
            />
          </ScrollArea>
        </TabsContent>

        {conversation.capabilities.supportsDiff ? (
          <TabsContent value="changes" className="min-h-0 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="px-4 pb-4">
                <ChangesSummary
                  changes={changes}
                  onChangeSelect={onChangeSelect}
                  selectedChangeId={selectedChangeId}
                />
              </div>
            </ScrollArea>
          </TabsContent>
        ) : null}

        {conversation.capabilities.supportsShell ? (
          <TabsContent value="terminal" className="min-h-0 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="px-4 pb-4">
                <TerminalSummary terminal={terminal} />
              </div>
            </ScrollArea>
          </TabsContent>
        ) : null}

        <TabsContent value="context" className="min-h-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="px-4 pb-4">
              <ContextSummary context={context} />
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </aside>
  )
}

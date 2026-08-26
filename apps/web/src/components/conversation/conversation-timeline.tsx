import { useMemo } from 'react'

import {
  DiffCard,
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
import { AgentMessage, UserMessage } from './message'

interface ConversationTimelineProps {
  agent: AgentId
  timeline: ConversationTimelineViewModel
  changes: ConversationChangesViewModel
  pendingApproval?: ConversationApprovalViewModel
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
  pendingApproval?: ConversationApprovalViewModel
}

function AgentRunExecutions({
  executions,
  changesById,
  pendingApproval,
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

    if (
      pendingApproval === undefined ||
      pendingApproval.id !== execution.approvalId
    ) {
      return null
    }

    return (
      <div key={execution.id} className="mt-3 border-t border-border/50">
        <ToolCallCard
          title={pendingApproval.summary}
          description={pendingApproval.title}
          status="waiting"
          metadata={pendingApproval.requestedAt}
          aria-label={`${pendingApproval.title}，等待审批，只读`}
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

export function ConversationTimeline({
  agent,
  timeline,
  changes,
  pendingApproval,
}: ConversationTimelineProps) {
  const changesById = useMemo(
    () => new Map(changes.files.map((change) => [change.id, change])),
    [changes.files],
  )

  return (
    <ScrollArea aria-label="会话执行时间线" className="min-h-0 bg-background">
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
                        pendingApproval={pendingApproval}
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
            暂无会话活动。
          </p>
        )}
      </div>
    </ScrollArea>
  )
}

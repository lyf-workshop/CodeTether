import type { ExecutionStatus } from '@codetether/ui'
import type { ConversationTimelineViewModel } from './conversation-view-model.js'
import { createToolCommandSubtitle } from './tool-presentation.js'

export interface InspectorToolEntry {
  readonly id: string
  readonly title: string
  readonly summary?: string
  readonly status: ExecutionStatus
}

/** The list identifies commands; output and metadata stay in the detail pane. */
export function inspectorToolEntries(
  timeline: ConversationTimelineViewModel,
): readonly InspectorToolEntry[] {
  return timeline.blocks.flatMap((block) =>
    block.kind === 'agent-run'
      ? block.executions.flatMap((execution): InspectorToolEntry[] => {
          if (execution.kind === 'tool') {
            return [
              {
                id: execution.id,
                title:
                  execution.tool.subject ??
                  createToolCommandSubtitle(
                    execution.tool.displayCommand ?? execution.tool.title,
                  ),
                ...(execution.tool.status === 'failed' &&
                execution.tool.failureSummary !== undefined
                  ? { summary: execution.tool.failureSummary }
                  : {}),
                status: execution.tool.status,
              },
            ]
          }
          if (execution.kind === 'shell') {
            return [
              {
                id: execution.id,
                title: createToolCommandSubtitle(execution.shell.command),
                ...(execution.shell.status === 'failed'
                  ? { summary: execution.shell.summary }
                  : {}),
                status: execution.shell.status,
              },
            ]
          }
          return []
        })
      : [],
  )
}

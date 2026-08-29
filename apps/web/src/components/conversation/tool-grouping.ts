import type {
  ConversationRunExecutionViewModel,
  ConversationToolViewModel,
} from './conversation-view-model.js'

type ToolExecution = Extract<
  ConversationRunExecutionViewModel,
  { readonly kind: 'tool' }
>

export type ExecutionPresentationGroup =
  | {
      readonly kind: 'routine-tools'
      readonly id: string
      readonly executions: readonly ToolExecution[]
    }
  | {
      readonly kind: 'single'
      readonly execution: ConversationRunExecutionViewModel
    }

const MINIMUM_GROUP_SIZE = 3

/**
 * Groups only adjacent, terminal, low-value Tool rows. This is a deterministic
 * presentation projection: each original execution remains available verbatim.
 */
export function groupRunExecutions(
  executions: readonly ConversationRunExecutionViewModel[],
): readonly ExecutionPresentationGroup[] {
  const groups: ExecutionPresentationGroup[] = []
  let routineTools: ToolExecution[] = []

  const flushRoutineTools = (): void => {
    if (routineTools.length >= MINIMUM_GROUP_SIZE) {
      groups.push({
        kind: 'routine-tools',
        id: `routine-tools:${routineTools[0]?.id ?? 'empty'}`,
        executions: routineTools,
      })
    } else {
      for (const execution of routineTools) {
        groups.push({ kind: 'single', execution })
      }
    }
    routineTools = []
  }

  for (const execution of executions) {
    if (execution.kind === 'tool' && isRoutineCompletedTool(execution.tool)) {
      routineTools.push(execution)
      continue
    }
    flushRoutineTools()
    groups.push({ kind: 'single', execution })
  }
  flushRoutineTools()
  return groups
}

export function isRoutineCompletedTool(
  tool: ConversationToolViewModel,
): boolean {
  const reliablyLowValue =
    tool.presentationKind === 'read-file' ||
    tool.presentationKind === 'git-status'

  return (
    tool.status === 'completed' &&
    reliablyLowValue &&
    tool.actionLabel === undefined &&
    tool.delta === undefined
  )
}

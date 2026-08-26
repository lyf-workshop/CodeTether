import type { ExecutionStatus } from '@codetether/ui'

import type {
  ConversationProjection,
  ConversationReadModel,
  FileChangeReadModel,
  MessageReadModel,
  PendingApprovalReadModel,
  ToolReadModel,
} from '../../runtime/host/conversation-projection.js'
import type { HostConnectionState } from '../../runtime/host/host-runtime.js'
import type {
  ConversationConnectionIndicatorViewModel,
  ConversationDetailSourceViewModel,
  ConversationFileChangeViewModel,
  ConversationRunExecutionViewModel,
  ConversationTimelineBlockViewModel,
  ConversationViewModel,
} from './conversation-view-model.js'

type OrderedActivity =
  | {
      readonly kind: 'message'
      readonly order: number
      readonly message: MessageReadModel
    }
  | {
      readonly kind: 'tool'
      readonly order: number
      readonly tool: ToolReadModel
    }
  | {
      readonly kind: 'change'
      readonly order: number
      readonly change: FileChangeReadModel
    }
  | {
      readonly kind: 'approval'
      readonly order: number
      readonly approval: PendingApprovalReadModel
    }

const readOnlyCapabilities = {
  canCompose: false,
  canInterrupt: false,
  canStop: false,
  canResolveApproval: false,
} as const

export function createLiveConversationDetailSource(
  model: ConversationReadModel,
  projection: ConversationProjection,
  connectionState: HostConnectionState,
): ConversationDetailSourceViewModel {
  return {
    conversation: createLiveConversationViewModel(model),
    rail: {
      groups: [
        {
          agent: 'codex',
          conversations: Object.values(projection.conversations)
            .sort((left, right) =>
              right.updatedAt.localeCompare(left.updatedAt),
            )
            .map((conversation) => ({
              id: conversation.id,
              title: 'Codex 实时会话',
              status: conversation.status,
              lastActivity: formatActivityTime(conversation.updatedAt),
              machine: '本地电脑',
            })),
        },
      ],
      archivedCount: 0,
    },
    connectionIndicator: connectionIndicator(connectionState),
  }
}

export function createLiveConversationViewModel(
  model: ConversationReadModel,
): ConversationViewModel {
  const files = model.changes.map(projectFileChange)
  const totals = files.reduce(
    (summary, file) => ({
      additions: summary.additions + file.additions,
      deletions: summary.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  )
  const pendingApproval = model.pendingApprovals[0]

  return {
    id: model.id,
    title: 'Codex 实时会话',
    status: model.status,
    agent: model.agent,
    model: model.model ?? '默认模型',
    reasoning: model.reasoning ?? '默认',
    permission: pendingApproval === undefined ? '由 Host 管理' : '等待审批',
    machine: '本地电脑',
    branch: '未提供',
    duration: formatDuration(
      model.currentTurn?.startedAt,
      model.currentTurn?.completedAt ?? model.updatedAt,
    ),
    timeline: {
      dayLabel: formatDayLabel(model.currentTurn?.startedAt ?? model.updatedAt),
      blocks: projectTimeline(model),
    },
    changes: { files, totals },
    terminal: {
      ...(model.terminal.command === undefined
        ? {}
        : { command: model.terminal.command }),
      lines:
        model.terminal.text.length === 0
          ? []
          : model.terminal.text.split(/\r?\n/u),
      truncated: model.terminal.truncated,
    },
    context: files.map((file) => ({
      id: `context:${file.id}`,
      label: file.path,
      kind: 'file' as const,
    })),
    ...(pendingApproval === undefined
      ? {}
      : {
          pendingApproval: {
            id: pendingApproval.id,
            kind: pendingApproval.kind,
            title: approvalTitle(pendingApproval.kind),
            summary: pendingApproval.summary,
            requestedAt: formatActivityTime(pendingApproval.requestedAt),
          },
        }),
    capabilities: readOnlyCapabilities,
  }
}

function projectTimeline(
  model: ConversationReadModel,
): readonly ConversationTimelineBlockViewModel[] {
  const activities: OrderedActivity[] = [
    ...model.messages.map((message) => ({
      kind: 'message' as const,
      order: message.order,
      message,
    })),
    ...model.tools.map((tool) => ({
      kind: 'tool' as const,
      order: tool.order,
      tool,
    })),
    ...model.changes.map((change) => ({
      kind: 'change' as const,
      order: change.order,
      change,
    })),
    ...model.pendingApprovals.map((approval, index) => ({
      kind: 'approval' as const,
      order: Number.MAX_SAFE_INTEGER - model.pendingApprovals.length + index,
      approval,
    })),
  ].sort((left, right) => left.order - right.order)

  const blocks: ConversationTimelineBlockViewModel[] = []
  let executions: ConversationRunExecutionViewModel[] = []
  let executionBlockOrder = 0

  const flushExecutions = (): void => {
    if (executions.length === 0) return
    blocks.push({
      kind: 'agent-run',
      id: `agent-run:${model.currentTurn?.id ?? model.id}:${executionBlockOrder}`,
      time: formatActivityTime(model.updatedAt),
      status: runStatus(model),
      executions,
    })
    executionBlockOrder += 1
    executions = []
  }

  for (const activity of activities) {
    if (activity.kind === 'message') {
      flushExecutions()
      blocks.push({
        kind: 'message',
        id: activity.message.id,
        message: {
          id: activity.message.id,
          author: 'agent',
          body: activity.message.body,
          time: formatActivityTime(activity.message.timestamp),
          status: activity.message.status,
        },
      })
      continue
    }
    if (activity.kind === 'tool') {
      executions.push({
        kind: 'tool',
        id: `execution:${activity.tool.id}`,
        tool: {
          id: activity.tool.id,
          title: activity.tool.name,
          status: activity.tool.status,
          ...(activity.tool.outputSummary === undefined
            ? {}
            : { outputSummary: compactSummary(activity.tool.outputSummary) }),
        },
      })
      continue
    }
    if (activity.kind === 'change') {
      executions.push({
        kind: 'diff',
        id: `execution:${activity.change.id}`,
        changeId: activity.change.id,
      })
      continue
    }
    executions.push({
      kind: 'approval',
      id: `execution:${activity.approval.id}`,
      approvalId: activity.approval.id,
    })
  }
  flushExecutions()

  if (blocks.length === 0 && model.currentTurn?.status === 'running') {
    blocks.push({
      kind: 'agent-run',
      id: `agent-run:${model.currentTurn.id}:waiting-for-events`,
      time: formatActivityTime(model.currentTurn.startedAt),
      status: model.status === 'waiting' ? 'waiting' : 'running',
      executions: [],
      outcomeText:
        model.status === 'waiting'
          ? 'Codex 正在等待审批。'
          : 'Codex 正在运行，实时活动将在这里显示。',
    })
  }

  const terminalOutcome = turnOutcome(model)
  if (terminalOutcome !== undefined) {
    const last = blocks.at(-1)
    if (last?.kind === 'agent-run') {
      blocks[blocks.length - 1] = { ...last, ...terminalOutcome }
    } else {
      blocks.push({
        kind: 'agent-run',
        id: `agent-run:${model.currentTurn?.id ?? model.id}:outcome`,
        time: formatActivityTime(model.updatedAt),
        status: runStatus(model),
        executions: [],
        ...terminalOutcome,
      })
    }
  }

  return blocks
}

function projectFileChange(
  change: FileChangeReadModel,
): ConversationFileChangeViewModel {
  return {
    id: change.id,
    path: change.path,
    name: fileName(change.path),
    kind: change.kind,
    additions: change.additions,
    deletions: change.deletions,
    lines: change.diffLines,
  }
}

function runStatus(model: ConversationReadModel): ExecutionStatus {
  if (model.status === 'waiting') return 'waiting'
  if (model.currentTurn?.status === 'interrupted') return 'idle'
  return model.status
}

function turnOutcome(model: ConversationReadModel):
  | {
      readonly outcome: 'failed' | 'interrupted'
      readonly outcomeText: string
    }
  | undefined {
  if (model.currentTurn?.status === 'failed') {
    return {
      outcome: 'failed',
      outcomeText: model.currentTurn.errorMessage
        ? `本轮失败：${model.currentTurn.errorMessage}`
        : '本轮执行失败。',
    }
  }
  if (model.currentTurn?.status === 'interrupted') {
    return {
      outcome: 'interrupted',
      outcomeText: model.currentTurn.interruptionReason
        ? `本轮已中断：${model.currentTurn.interruptionReason}`
        : '本轮已中断。',
    }
  }
  return undefined
}

function connectionIndicator(
  state: HostConnectionState,
): ConversationConnectionIndicatorViewModel | undefined {
  const labels = {
    connecting: '正在连接 Host',
    connected: 'Host 已连接',
    reconnecting: '正在重新连接',
    unavailable: 'Host 不可用',
    incompatible: 'Host 版本不兼容',
  } as const
  return { state, label: labels[state] }
}

function approvalTitle(kind: PendingApprovalReadModel['kind']): string {
  if (kind === 'command') return '命令等待审批'
  if (kind === 'file-change') return '文件变更等待审批'
  return '操作等待审批'
}

function fileName(path: string): string {
  return path.split(/[\\/]/u).at(-1) || path
}

function compactSummary(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  return normalized.length <= 40 ? normalized : `${normalized.slice(0, 39)}…`
}

function formatActivityTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function formatDayLabel(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return '实时会话'
  const today = new Date()
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  const day = sameDay
    ? '今天'
    : new Intl.DateTimeFormat('zh-CN', {
        month: 'short',
        day: 'numeric',
      }).format(date)
  return `${day} ${formatActivityTime(value)}`
}

function formatDuration(
  startedAt: string | undefined,
  completedAt: string,
): string {
  if (startedAt === undefined) return '—'
  const start = Date.parse(startedAt)
  const end = Date.parse(completedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '—'
  const seconds = Math.max(0, Math.floor((end - start) / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return [hours, minutes, remainder]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
}

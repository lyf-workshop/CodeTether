import type { ExecutionStatus } from '@codetether/ui'
import type {
  ConversationSummary,
  HostCapabilities,
  ProjectAvailability,
} from '@codetether/protocol'

import type {
  ConversationReadModel,
  ConversationTurnReadModel,
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
import { presentProjectPaths } from './message-presentation.js'
import { createToolPresentation } from './tool-presentation.js'
import { deriveLiveControlAvailability } from './conversation-controls.js'

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

export function createLiveConversationDetailSource(
  model: ConversationReadModel,
  summaries: readonly ConversationSummary[],
  connectionState: HostConnectionState,
  hostCapabilities?: HostCapabilities,
  projectAvailability: ProjectAvailability = 'available',
  projectRootPath?: string,
): ConversationDetailSourceViewModel {
  const controlConnectionState =
    projectAvailability === 'available' ? connectionState : 'unavailable'
  return {
    conversation: createLiveConversationViewModel(
      model,
      hostCapabilities,
      controlConnectionState,
      projectRootPath,
    ),
    rail: createLiveConversationRailViewModel(summaries, model),
    connectionIndicator:
      projectAvailability === 'available'
        ? connectionIndicator(connectionState)
        : { state: 'unavailable', label: '项目不可用' },
  }
}

export function createLiveConversationRailViewModel(
  summaries: readonly ConversationSummary[],
  current: ConversationReadModel,
): ConversationDetailSourceViewModel['rail'] {
  return {
    groups:
      summaries.length === 0
        ? []
        : [
            {
              agent: 'codex',
              conversations: summaries.map((summary) => {
                const selected = summary.conversationId === current.id
                return {
                  id: summary.conversationId,
                  title: selected ? current.title : summary.title,
                  status: selected ? current.status : summary.status,
                  lastActivity: formatActivityTime(summary.lastActivityAt),
                }
              }),
            },
          ],
  }
}

export function createLiveConversationViewModel(
  model: ConversationReadModel,
  hostCapabilities?: HostCapabilities,
  connectionState: HostConnectionState = 'unavailable',
  projectRootPath?: string,
): ConversationViewModel {
  const presentationRoot = model.cwd ?? projectRootPath
  const files = model.changes.map((change) =>
    projectFileChange(change, presentationRoot),
  )
  const totals = files.reduce(
    (summary, file) => ({
      additions: summary.additions + file.additions,
      deletions: summary.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  )
  const pendingApprovals = model.pendingApprovals.map((approval) => ({
    id: approval.id,
    kind: approval.kind,
    title: approvalTitle(approval.kind),
    summary: approval.summary,
    requestedAt: formatActivityTime(approval.requestedAt),
    ...(presentationRoot === undefined ? {} : { context: presentationRoot }),
  }))

  return {
    id: model.id,
    title: model.title,
    status: model.status,
    agent: model.agent,
    model: model.model ?? '默认模型',
    reasoning: model.reasoning ?? '默认',
    permission:
      pendingApprovals.length === 0 ? '由 CodeTether 管理' : '等待审批',
    machine: '本地电脑',
    branch: '未提供',
    duration: formatDuration(
      model.currentTurn?.startedAt,
      model.currentTurn?.completedAt ?? model.updatedAt,
    ),
    ...(projectRootPath === undefined ? {} : { projectRootPath }),
    timeline: {
      dayLabel: formatDayLabel(
        model.turns[0]?.startedAt ??
          model.currentTurn?.startedAt ??
          model.updatedAt,
      ),
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
    pendingApprovals,
    capabilities: deriveLiveControlAvailability(
      connectionState,
      hostCapabilities,
      model.currentTurn?.status,
    ),
  }
}

function projectTimeline(
  model: ConversationReadModel,
): readonly ConversationTimelineBlockViewModel[] {
  return [...model.turns]
    .sort((left, right) => left.order - right.order)
    .flatMap((turn) => projectTurnTimeline(model, turn))
}

function projectTurnTimeline(
  model: ConversationReadModel,
  turn: ConversationTurnReadModel,
): readonly ConversationTimelineBlockViewModel[] {
  const activities: OrderedActivity[] = [
    ...model.messages
      .filter((message) => message.turnId === turn.id)
      .map((message) => ({
        kind: 'message' as const,
        order: message.order,
        message,
      })),
    ...model.tools
      .filter((tool) => tool.turnId === turn.id)
      .map((tool) => ({
        kind: 'tool' as const,
        order: tool.order,
        tool,
      })),
    ...model.changes
      .filter((change) => change.turnId === turn.id)
      .map((change) => ({
        kind: 'change' as const,
        order: change.order,
        change,
      })),
    ...model.pendingApprovals
      .filter((approval) => approval.turnId === turn.id)
      .map((approval, index, approvals) => ({
        kind: 'approval' as const,
        order: Number.MAX_SAFE_INTEGER - approvals.length + index,
        approval,
      })),
  ].sort((left, right) => left.order - right.order)

  const blocks: ConversationTimelineBlockViewModel[] = []
  let executions: ConversationRunExecutionViewModel[] = []
  let executionTime: string | undefined
  let executionBlockOrder = 0
  const pendingApprovals = model.pendingApprovals.filter(
    (approval) => approval.turnId === turn.id,
  )

  const flushExecutions = (): void => {
    if (executions.length === 0) return
    blocks.push({
      kind: 'agent-run',
      id: `agent-run:${turn.id}:${executionBlockOrder}`,
      turnId: turn.id,
      time: formatActivityTime(executionTime ?? turn.startedAt),
      status: runStatus(turn, pendingApprovals.length > 0),
      executions,
    })
    executionBlockOrder += 1
    executions = []
    executionTime = undefined
  }

  for (const activity of activities) {
    if (activity.kind === 'message') {
      flushExecutions()
      blocks.push({
        kind: 'message',
        id: activity.message.id,
        turnId: turn.id,
        message: {
          id: activity.message.id,
          author: activity.message.author,
          body: activity.message.body,
          time: formatActivityTime(activity.message.timestamp),
          status: activity.message.status,
        },
      })
      continue
    }
    if (activity.kind === 'tool') {
      const displayCommand = presentProjectPaths(
        activity.tool.command ?? activity.tool.name,
        model.cwd,
      )
      const presentation = createToolPresentation({
        command: displayCommand,
        status: activity.tool.status,
        ...(activity.tool.outputSummary === undefined
          ? {}
          : { outputSummary: activity.tool.outputSummary }),
      })
      const failureSummary =
        activity.tool.status === 'failed' ? presentation.subtitle : undefined
      executionTime ??= activity.tool.timestamp
      executions.push({
        kind: 'tool',
        id: `execution:${activity.tool.id}`,
        tool: {
          id: activity.tool.id,
          presentationKind: presentation.kind,
          title:
            activity.tool.status === 'failed'
              ? presentation.title
              : (presentation.subtitle ?? presentation.title),
          ...(activity.tool.status === 'failed' ||
          presentation.subtitle === undefined
            ? {}
            : { description: presentation.title }),
          status: activity.tool.status,
          ...(failureSummary !== undefined
            ? { outputSummary: failureSummary }
            : activity.tool.outputSummary === undefined
              ? {}
              : { outputSummary: compactSummary(activity.tool.outputSummary) }),
        },
      })
      continue
    }
    if (activity.kind === 'change') {
      executionTime ??= activity.change.timestamp
      executions.push({
        kind: 'diff',
        id: `execution:${activity.change.id}`,
        changeId: activity.change.id,
      })
      continue
    }
    executionTime ??= activity.approval.requestedAt
    executions.push({
      kind: 'approval',
      id: `execution:${activity.approval.id}`,
      approvalId: activity.approval.id,
    })
  }
  flushExecutions()

  const hasAgentActivity = activities.some(
    (activity) =>
      activity.kind !== 'message' || activity.message.author === 'agent',
  )
  if (!hasAgentActivity && turn.status === 'running') {
    blocks.push({
      kind: 'agent-run',
      id: `agent-run:${turn.id}:waiting-for-events`,
      turnId: turn.id,
      time: formatActivityTime(turn.startedAt),
      status: pendingApprovals.length > 0 ? 'waiting' : 'running',
      executions: [],
      outcomeText:
        pendingApprovals.length > 0
          ? 'Codex 正在等待审批。'
          : 'Codex 正在运行，实时活动将在这里显示。',
    })
  }

  const terminalOutcome = turnOutcome(turn)
  if (terminalOutcome !== undefined) {
    const last = blocks.at(-1)
    if (last?.kind === 'agent-run') {
      blocks[blocks.length - 1] = { ...last, ...terminalOutcome }
    } else {
      blocks.push({
        kind: 'agent-run',
        id: `agent-run:${turn.id}:outcome`,
        turnId: turn.id,
        time: formatActivityTime(turn.completedAt ?? turn.startedAt),
        status: runStatus(turn, pendingApprovals.length > 0),
        executions: [],
        ...terminalOutcome,
      })
    }
  }

  return blocks
}

function projectFileChange(
  change: FileChangeReadModel,
  cwd: string | undefined,
): ConversationFileChangeViewModel {
  const path = workspaceRelativePath(change.path, cwd)
  return {
    id: change.id,
    path,
    name: fileName(path),
    kind: change.kind,
    additions: change.additions,
    deletions: change.deletions,
    lines: change.diffLines,
  }
}

function workspaceRelativePath(path: string, cwd: string | undefined): string {
  const normalizedPath = path.replace(/\\/gu, '/').replace(/^\.\//u, '')
  if (cwd === undefined) return normalizedPath
  const normalizedCwd = cwd.replace(/\\/gu, '/').replace(/\/+$/u, '')
  const caseInsensitive = /^[A-Za-z]:\//u.test(normalizedPath)
  const comparablePath = caseInsensitive
    ? normalizedPath.toLowerCase()
    : normalizedPath
  const comparableCwd = caseInsensitive
    ? normalizedCwd.toLowerCase()
    : normalizedCwd
  const prefix = `${comparableCwd}/`

  return comparablePath.startsWith(prefix)
    ? normalizedPath.slice(normalizedCwd.length + 1)
    : normalizedPath
}

function runStatus(
  turn: ConversationTurnReadModel,
  hasPendingApproval: boolean,
): ExecutionStatus {
  if (hasPendingApproval) return 'waiting'
  if (turn.status === 'interrupted') return 'idle'
  return turn.status
}

function turnOutcome(turn: ConversationTurnReadModel):
  | {
      readonly outcome: 'failed' | 'interrupted'
      readonly outcomeText: string
    }
  | undefined {
  if (turn.status === 'failed') {
    return {
      outcome: 'failed',
      outcomeText: turn.errorMessage
        ? `本轮失败：${turn.errorMessage}`
        : '本轮执行失败。',
    }
  }
  if (turn.status === 'interrupted') {
    return {
      outcome: 'interrupted',
      outcomeText: '本轮已中断。',
    }
  }
  return undefined
}

function connectionIndicator(
  state: HostConnectionState,
): ConversationConnectionIndicatorViewModel | undefined {
  const labels = {
    connecting: '正在连接',
    connected: '已连接',
    reconnecting: '正在重新连接',
    unavailable: '暂时无法连接',
    incompatible: '版本不兼容',
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

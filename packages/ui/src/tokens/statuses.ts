import {
  BrainCircuit,
  Circle,
  CircleCheck,
  CirclePause,
  CircleX,
  LoaderCircle,
  WifiOff,
  type LucideIcon,
} from 'lucide-react'

export const executionStatuses = [
  'idle',
  'thinking',
  'running',
  'waiting',
  'completed',
  'failed',
  'offline',
] as const

export type ExecutionStatus = (typeof executionStatuses)[number]

export interface StatusDefinition {
  label: string
  icon: LucideIcon
  badgeClassName: string
  iconClassName: string
  dotClassName: string
}

export const statusDefinitions = {
  idle: {
    label: '空闲',
    icon: Circle,
    badgeClassName:
      'border-status-idle/30 bg-status-idle-muted text-status-idle-text',
    iconClassName: 'text-status-idle-text',
    dotClassName: 'text-status-idle',
  },
  thinking: {
    label: '思考中',
    icon: BrainCircuit,
    badgeClassName:
      'border-status-thinking/30 bg-status-thinking-muted text-status-thinking-text',
    iconClassName: 'text-status-thinking-text',
    dotClassName: 'text-status-thinking',
  },
  running: {
    label: '运行中',
    icon: LoaderCircle,
    badgeClassName:
      'border-status-running/30 bg-status-running-muted text-status-running-text',
    iconClassName:
      'text-status-running-text motion-safe:animate-spin motion-reduce:animate-none',
    dotClassName: 'text-status-running',
  },
  waiting: {
    label: '等待批准',
    icon: CirclePause,
    badgeClassName:
      'border-status-waiting/30 bg-status-waiting-muted text-status-waiting-text',
    iconClassName: 'text-status-waiting-text',
    dotClassName: 'text-status-waiting',
  },
  completed: {
    label: '已完成',
    icon: CircleCheck,
    badgeClassName:
      'border-status-completed/30 bg-status-completed-muted text-status-completed-text',
    iconClassName: 'text-status-completed-text',
    dotClassName: 'text-status-completed',
  },
  failed: {
    label: '失败',
    icon: CircleX,
    badgeClassName:
      'border-status-failed/30 bg-status-failed-muted text-status-failed-text',
    iconClassName: 'text-status-failed-text',
    dotClassName: 'text-status-failed',
  },
  offline: {
    label: '离线',
    icon: WifiOff,
    badgeClassName:
      'border-status-offline/30 bg-status-offline-muted text-status-offline-text',
    iconClassName: 'text-status-offline-text',
    dotClassName: 'text-status-offline',
  },
} satisfies Record<ExecutionStatus, StatusDefinition>

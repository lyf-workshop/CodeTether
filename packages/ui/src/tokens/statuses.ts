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
}

export const statusDefinitions = {
  idle: {
    label: 'Idle',
    icon: Circle,
    badgeClassName:
      'border-status-idle/30 bg-status-idle-muted text-status-idle',
    iconClassName: 'text-status-idle',
  },
  thinking: {
    label: 'Thinking',
    icon: BrainCircuit,
    badgeClassName:
      'border-status-thinking/30 bg-status-thinking-muted text-status-thinking',
    iconClassName: 'text-status-thinking',
  },
  running: {
    label: 'Running',
    icon: LoaderCircle,
    badgeClassName:
      'border-status-running/30 bg-status-running-muted text-status-running',
    iconClassName:
      'text-status-running motion-safe:animate-spin motion-reduce:animate-none',
  },
  waiting: {
    label: 'Waiting',
    icon: CirclePause,
    badgeClassName:
      'border-status-waiting/30 bg-status-waiting-muted text-status-waiting',
    iconClassName: 'text-status-waiting',
  },
  completed: {
    label: 'Completed',
    icon: CircleCheck,
    badgeClassName:
      'border-status-completed/30 bg-status-completed-muted text-status-completed',
    iconClassName: 'text-status-completed',
  },
  failed: {
    label: 'Failed',
    icon: CircleX,
    badgeClassName:
      'border-status-failed/30 bg-status-failed-muted text-status-failed',
    iconClassName: 'text-status-failed',
  },
  offline: {
    label: 'Offline',
    icon: WifiOff,
    badgeClassName:
      'border-status-offline/30 bg-status-offline-muted text-status-offline',
    iconClassName: 'text-status-offline',
  },
} satisfies Record<ExecutionStatus, StatusDefinition>

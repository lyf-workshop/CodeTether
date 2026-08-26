import type { AgentId, PermissionRisk } from '@codetether/ui'

export type InboxItemType = 'approval' | 'question' | 'completed' | 'failed'

export interface InboxCompletedMetricsMock {
  changedFiles: number
  testsPassed: number
  testsFailed: number
}

export interface InboxFailureHeartbeatMock {
  lastHeartbeat: string
  canRetry: boolean
}

interface InboxItemBaseMock {
  id: string
  agent: AgentId
  project: string
  machine: string
  title: string
  description: string
  createdAt: string
  timeLabel: string
  unread: boolean
  risk?: PermissionRisk
  conversationId?: string
}

export interface InboxApprovalItemMock extends InboxItemBaseMock {
  type: 'approval'
  status: 'waiting'
  risk: PermissionRisk
  command: string
}

export interface InboxQuestionItemMock extends InboxItemBaseMock {
  type: 'question'
  status: 'waiting'
  questionPrompt: string
}

export interface InboxCompletedItemMock extends InboxItemBaseMock {
  type: 'completed'
  status: 'completed'
  conversationId: string
  completedMetrics: InboxCompletedMetricsMock
}

export interface InboxFailedItemMock extends InboxItemBaseMock {
  type: 'failed'
  status: 'failed'
  risk: 'high'
  failureHeartbeat: InboxFailureHeartbeatMock
}

export type InboxItemMock =
  | InboxApprovalItemMock
  | InboxQuestionItemMock
  | InboxCompletedItemMock
  | InboxFailedItemMock

export interface InboxSummaryMock {
  approvals: number
  replies: number
  completed: number
  failed: number
}

export interface InboxTodayOverviewMock {
  pending: number
  averageResponseTime: string
  highRisk: number
}

export interface InboxMockData {
  items: readonly InboxItemMock[]
  todayOverview: InboxTodayOverviewMock
}

export const inboxMock = {
  items: [
    {
      id: 'approval-install-socket-io',
      type: 'approval',
      agent: 'claude',
      project: 'MyProject',
      machine: '开发服务器',
      title: '请求执行 npm install socket.io',
      description: '需要在开发服务器上安装依赖。命令会修改 package-lock.json。',
      status: 'waiting',
      risk: 'medium',
      createdAt: '2026-08-25T10:31:00-07:00',
      timeLabel: '刚刚',
      unread: true,
      conversationId: 'permissions-design',
      command: 'npm install socket.io',
    },
    {
      id: 'completed-websocket-reconnect',
      type: 'completed',
      agent: 'codex',
      project: 'MyProject',
      machine: '本地电脑',
      title: '任务完成：WebSocket 自动重连',
      description: '6 个文件发生变更，156 个测试通过，0 个失败。',
      status: 'completed',
      createdAt: '2026-08-25T10:29:00-07:00',
      timeLabel: '2 分钟前',
      unread: false,
      conversationId: 'demo',
      completedMetrics: {
        changedFiles: 6,
        testsPassed: 156,
        testsFailed: 0,
      },
    },
    {
      id: 'question-retry-boundary',
      type: 'question',
      agent: 'opencode',
      project: 'MyProject',
      machine: 'MacBook Pro',
      title: '需要你的回复：重试策略边界',
      description: '最大重试次数使用 5 次、10 次还是无限重试？',
      status: 'waiting',
      createdAt: '2026-08-25T10:16:00-07:00',
      timeLabel: '15 分钟前',
      unread: true,
      conversationId: 'websocket-refactor',
      questionPrompt: '最大重试次数使用 5 次、10 次还是无限重试？',
    },
    {
      id: 'failed-raspberry-pi-offline',
      type: 'failed',
      agent: 'codex',
      project: 'MyProject',
      machine: '树莓派设备',
      title: '树莓派设备离线，任务执行失败',
      description: '最后心跳时间 23:14。任务将在设备重新上线后才能继续。',
      status: 'failed',
      risk: 'high',
      createdAt: '2026-08-24T23:14:00-07:00',
      timeLabel: '昨天 23:14',
      unread: true,
      conversationId: 'raspberry-pi-task',
      failureHeartbeat: {
        lastHeartbeat: '23:14',
        canRetry: true,
      },
    },
  ],
  todayOverview: {
    pending: 4,
    averageResponseTime: '3m 24s',
    highRisk: 1,
  },
} satisfies InboxMockData

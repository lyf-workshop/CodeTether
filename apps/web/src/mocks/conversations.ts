import type { AgentId, ExecutionStatus } from '@codetether/ui'

export interface ConversationsProjectMock {
  id: string
  name: string
  path: string
  branch: string
  gitStatus: string
  recentActivity: string
}

export interface ConversationsAgentMock {
  id: AgentId
  name: string
  defaultModel: string
  available: boolean
}

export interface ConversationsMachineMock {
  id: string
  name: string
  status: ExecutionStatus
}

export interface ConversationListItemMock {
  id: string
  title: string
  description: string
  project: string
  agent: AgentId
  model: string
  machine: string
  status: ExecutionStatus
  lastActivity: string
  activityDetail: string
  updatedAt: string
  archived: boolean
}

export interface ConversationListSummaryMock {
  total: number
  running: number
  waiting: number
  completed: number
  completedThisWeek: number
  archived: number
}

export interface ConversationsMockData {
  project: ConversationsProjectMock
  agents: readonly ConversationsAgentMock[]
  machines: readonly ConversationsMachineMock[]
  conversations: readonly ConversationListItemMock[]
  summary: ConversationListSummaryMock
}

export const conversationDefaultModels = {
  codex: 'GPT-5.x',
  claude: 'Claude Sonnet',
  opencode: 'DeepSeek V3',
} satisfies Record<AgentId, string>

export const conversationsMock = {
  project: {
    id: 'project-my-project',
    name: 'MyProject',
    path: 'D:\\Projects\\MyProject',
    branch: 'main',
    gitStatus: 'Git clean',
    recentActivity: '2 分钟前 · Codex',
  },
  agents: [
    {
      id: 'codex',
      name: 'Codex',
      defaultModel: conversationDefaultModels.codex,
      available: true,
    },
    {
      id: 'claude',
      name: 'Claude Code',
      defaultModel: conversationDefaultModels.claude,
      available: true,
    },
    {
      id: 'opencode',
      name: 'OpenCode',
      defaultModel: conversationDefaultModels.opencode,
      available: true,
    },
  ],
  machines: [
    { id: 'local', name: '本地电脑', status: 'running' },
    { id: 'dev-server', name: '开发服务器', status: 'idle' },
    { id: 'macbook-pro', name: 'MacBook Pro', status: 'idle' },
    { id: 'raspberry-pi', name: '树莓派设备', status: 'offline' },
  ],
  conversations: [
    {
      id: 'demo',
      title: '远程连接功能实现',
      description: 'WebSocket 连接、自动重连和网络切换恢复',
      project: 'project-my-project',
      agent: 'codex',
      model: conversationDefaultModels.codex,
      machine: 'local',
      status: 'running',
      lastActivity: '10:30',
      activityDetail: '刚刚更新',
      updatedAt: '2026-08-25T10:30:00-07:00',
      archived: false,
    },
    {
      id: 'server-connection',
      title: '服务端连接优化',
      description: '优化服务端连接状态与错误恢复',
      project: 'project-my-project',
      agent: 'codex',
      model: conversationDefaultModels.codex,
      machine: 'dev-server',
      status: 'completed',
      lastActivity: '昨天',
      activityDetail: '18:42',
      updatedAt: '2026-08-24T18:42:00-07:00',
      archived: false,
    },
    {
      id: 'login-flow',
      title: '登录功能实现',
      description: '会话鉴权与 Token 刷新',
      project: 'project-my-project',
      agent: 'codex',
      model: conversationDefaultModels.codex,
      machine: 'local',
      status: 'completed',
      lastActivity: '8/22',
      activityDetail: '20:14',
      updatedAt: '2026-08-22T20:14:00-07:00',
      archived: false,
    },
    {
      id: 'permissions-design',
      title: '权限系统设计',
      description: 'Shell、文件编辑和外部目录访问策略',
      project: 'project-my-project',
      agent: 'claude',
      model: 'Sonnet',
      machine: 'local',
      status: 'waiting',
      lastActivity: '15 分钟前',
      activityDetail: '等待你处理',
      updatedAt: '2026-08-25T10:15:00-07:00',
      archived: false,
    },
    {
      id: 'mobile-polish',
      title: '移动端界面优化',
      description: '精简手机端会话与收件箱',
      project: 'project-my-project',
      agent: 'claude',
      model: 'Sonnet',
      machine: 'macbook-pro',
      status: 'completed',
      lastActivity: '昨天',
      activityDetail: '16:20',
      updatedAt: '2026-08-24T16:20:00-07:00',
      archived: false,
    },
    {
      id: 'websocket-refactor',
      title: 'WebSocket 重构',
      description: '拆分重连策略并补充测试',
      project: 'project-my-project',
      agent: 'opencode',
      model: 'DeepSeek',
      machine: 'dev-server',
      status: 'completed',
      lastActivity: '8/21',
      activityDetail: '22:06',
      updatedAt: '2026-08-21T22:06:00-07:00',
      archived: false,
    },
    {
      id: 'legacy-session-audit',
      title: '旧会话数据审计',
      description: '检查早期本地会话的可迁移字段',
      project: 'project-my-project',
      agent: 'codex',
      model: conversationDefaultModels.codex,
      machine: 'local',
      status: 'completed',
      lastActivity: '8/18',
      activityDetail: '14:08',
      updatedAt: '2026-08-18T14:08:00-07:00',
      archived: true,
    },
  ],
  summary: {
    total: 6,
    running: 1,
    waiting: 1,
    completed: 4,
    completedThisWeek: 12,
    archived: 12,
  },
} satisfies ConversationsMockData

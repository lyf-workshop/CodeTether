import type { AgentId, DiffLine, ExecutionStatus } from '@codetether/ui'

export type ConversationRailFilter = 'all' | 'running' | 'waiting' | 'completed'

export interface ProjectMock {
  id: string
  name: string
  path: string
}

export interface AgentMock {
  id: AgentId
  available: boolean
  model: string
}

export interface MachineMock {
  id: string
  name: string
  status: ExecutionStatus
}

export interface ConversationSummaryMock {
  id: string
  title: string
  status: ExecutionStatus
  lastActivity: string
  machine?: string
}

export interface ConversationGroupMock {
  agent: AgentId
  conversations: readonly ConversationSummaryMock[]
}

export interface ConversationMessageMock {
  id: string
  author: 'user' | 'agent'
  body: string
  time: string
  status?: ExecutionStatus
}

export interface ToolCallMock {
  id: string
  title: string
  status: ExecutionStatus
  description?: string
  metadata?: string
  actionLabel?: string
  delta?: {
    additions: number
    deletions: number
  }
}

export interface DiffChangeMock {
  fileName: string
  additions: number
  deletions: number
  lines: readonly DiffLine[]
}

export interface ShellRunMock {
  command: string
  status: ExecutionStatus
  summary: string
}

export interface ChangedFileMock {
  name: string
  additions: number
  deletions: number
}

export interface TerminalSummaryMock {
  command: string
  lines: readonly string[]
}

export interface ContextReferenceMock {
  id: string
  label: string
  kind: 'file' | 'git' | 'shell'
}

export interface ConversationDetailMock {
  project: ProjectMock
  agents: readonly AgentMock[]
  machines: readonly MachineMock[]
  conversation: {
    id: string
    title: string
    status: ExecutionStatus
    agent: AgentId
    agentLocked: true
    model: string
    reasoning: string
    permission: string
    machine: string
    branch: string
    duration: string
  }
  rail: {
    groups: readonly ConversationGroupMock[]
    archivedCount: number
  }
  timeline: {
    dayLabel: string
    userMessage: ConversationMessageMock
    agentRun: {
      message: ConversationMessageMock
      tools: readonly ToolCallMock[]
      diff: DiffChangeMock
      shell: ShellRunMock
    }
    followUp: ConversationMessageMock
  }
  inspector: {
    changes: readonly ChangedFileMock[]
    totals: { additions: number; deletions: number }
    terminal: TerminalSummaryMock
    context: readonly ContextReferenceMock[]
  }
}

export const conversationDetailMock = {
  project: {
    id: 'project-my-project',
    name: 'MyProject',
    path: '~/Projects/MyProject',
  },
  agents: [
    { id: 'codex', available: true, model: 'GPT-5.x' },
    { id: 'claude', available: true, model: 'Claude Sonnet' },
    { id: 'opencode', available: true, model: 'Provider default' },
  ],
  machines: [
    { id: 'local', name: '本地电脑', status: 'running' },
    { id: 'dev-server', name: '开发服务器', status: 'idle' },
    { id: 'macbook-pro', name: 'MacBook Pro', status: 'idle' },
    { id: 'raspberry-pi', name: '树莓派设备', status: 'offline' },
  ],
  conversation: {
    id: 'demo',
    title: '远程连接功能实现',
    status: 'running',
    agent: 'codex',
    agentLocked: true,
    model: 'GPT-5.x',
    reasoning: 'Deep',
    permission: '询问我',
    machine: '本地电脑',
    branch: 'feature/remote-connection',
    duration: '00:24:15',
  },
  rail: {
    groups: [
      {
        agent: 'codex',
        conversations: [
          {
            id: 'demo',
            title: '远程连接功能实现',
            status: 'running',
            lastActivity: '10:30',
            machine: '本地电脑',
          },
          {
            id: 'server-connection',
            title: '服务端连接优化',
            status: 'completed',
            lastActivity: '昨天',
          },
          {
            id: 'login-flow',
            title: '登录功能实现',
            status: 'completed',
            lastActivity: '8/22',
          },
        ],
      },
      {
        agent: 'claude',
        conversations: [
          {
            id: 'permissions-design',
            title: '权限系统设计',
            status: 'waiting',
            lastActivity: '15 分钟前',
          },
          {
            id: 'mobile-polish',
            title: '移动端界面优化',
            status: 'completed',
            lastActivity: '昨天',
          },
        ],
      },
      {
        agent: 'opencode',
        conversations: [
          {
            id: 'websocket-refactor',
            title: 'WebSocket 重构',
            status: 'completed',
            lastActivity: '昨天',
          },
        ],
      },
    ],
    archivedCount: 12,
  },
  timeline: {
    dayLabel: '今天 10:30',
    userMessage: {
      id: 'message-user-1',
      author: 'user',
      body: '实现一个远程连接功能，支持 WebSocket 连接和自动重连机制。',
      time: '10:30',
    },
    agentRun: {
      message: {
        id: 'message-agent-1',
        author: 'agent',
        body: '我会先检查项目结构，再创建 WebSocket 服务并补充自动重连。',
        time: '10:30',
        status: 'running',
      },
      tools: [
        {
          id: 'tool-read-structure',
          title: '读取项目结构',
          status: 'completed',
          metadata: '8 个文件',
          actionLabel: '查看',
        },
        {
          id: 'tool-create-websocket',
          title: 'src/services/websocket.ts',
          description: '创建文件',
          status: 'completed',
          delta: { additions: 128, deletions: 4 },
        },
      ],
      diff: {
        fileName: 'src/services/websocket.ts',
        additions: 128,
        deletions: 4,
        lines: [
          {
            kind: 'context',
            content: "import { io, type Socket } from 'socket.io-client'",
            oldLineNumber: 1,
            newLineNumber: 1,
          },
          {
            kind: 'addition',
            content: "import { EventEmitter } from 'events'",
            newLineNumber: 2,
          },
          {
            kind: 'context',
            content: '',
            oldLineNumber: 2,
            newLineNumber: 3,
          },
          {
            kind: 'addition',
            content: 'export class WebSocketService extends EventEmitter {',
            newLineNumber: 4,
          },
          {
            kind: 'deletion',
            content: '  private reconnectAttempts = 1',
            oldLineNumber: 3,
          },
          {
            kind: 'addition',
            content: '  private reconnectAttempts = 0',
            newLineNumber: 5,
          },
          {
            kind: 'addition',
            content: '  private maxReconnectAttempts = 5',
            newLineNumber: 6,
          },
        ],
      },
      shell: {
        command: 'pnpm test',
        status: 'completed',
        summary: '156 项通过 · 0 项失败',
      },
    },
    followUp: {
      id: 'message-agent-2',
      author: 'agent',
      body: '核心逻辑已完成。是否继续补充断线后的指数退避和网络切换恢复？',
      time: '10:31',
    },
  },
  inspector: {
    changes: [
      { name: 'websocket.ts', additions: 128, deletions: 4 },
      { name: 'connection.ts', additions: 45, deletions: 0 },
      { name: 'ConnectionStatus.tsx', additions: 67, deletions: 0 },
      { name: 'useWebSocket.ts', additions: 89, deletions: 0 },
      { name: 'reconnect.ts', additions: 23, deletions: 0 },
      { name: 'websocket.test.ts', additions: 156, deletions: 8 },
    ],
    totals: { additions: 345, deletions: 12 },
    terminal: {
      command: 'pnpm run dev',
      lines: [
        '> vite',
        '✓ Server running at localhost:3000',
        '✓ WebSocket connected',
        '✓ Ready in 1.2s',
      ],
    },
    context: [
      { id: 'context-websocket', label: 'websocket.ts', kind: 'file' },
      { id: 'context-readme', label: 'README.md', kind: 'file' },
      { id: 'context-git', label: 'Git diff', kind: 'git' },
      { id: 'context-agents', label: 'AGENTS.md', kind: 'file' },
      { id: 'context-shell', label: '终端输出', kind: 'shell' },
      { id: 'context-package', label: 'package.json', kind: 'file' },
    ],
  },
} satisfies ConversationDetailMock

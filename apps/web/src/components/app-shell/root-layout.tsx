import { useQuery } from '@tanstack/react-query'
import { Outlet, useRouterState } from '@tanstack/react-router'

import {
  ConversationIdSchema,
  ProjectIdSchema,
  type ConversationId,
  type ProjectId,
} from '@codetether/protocol'

import { conversationDetailMock } from '../../mocks/conversation-detail'
import { conversationsMock } from '../../mocks/conversations'
import { attentionListQueryOptions } from '../../runtime/host/attention-query'
import { conversationDetailQueryOptions } from '../../runtime/host/conversation-detail-query'
import {
  useHostConnectionState,
  useHostRuntime,
} from '../../runtime/host/host-runtime-hooks'
import { projectDetailQueryOptions } from '../../runtime/host/project-query'
import { AppShell } from './app-shell'

const pageTitles = {
  '/': '首页',
  '/activity': '活动',
  '/agents': '智能体',
  '/inbox': '收件箱',
  '/machines': '机器',
  '/projects': '项目',
  '/settings': '设置',
} as const

export function RootLayout() {
  const runtime = useHostRuntime()
  const connectionState = useHostConnectionState()
  const attentionQuery = useQuery({
    ...attentionListQueryOptions(runtime),
    enabled: connectionState === 'connected',
  })
  const inboxAttentionCount =
    connectionState === 'unavailable' || connectionState === 'incompatible'
      ? 0
      : (attentionQuery.data?.summary.totalOpen ?? 0)
  const currentPath = useRouterState({
    select: (state) => state.location.pathname,
  })
  const codexAvailable =
    connectionState === 'connected' &&
    runtime.bootstrap?.capabilities.codex === true
  const projectRoute = parseProjectRoute(currentPath)
  const conversationRoute = parseConversationRoute(currentPath)

  if (currentPath === '/projects') {
    return (
      <AppShell
        breadcrumbs={[{ label: '项目' }]}
        codexAvailable={codexAvailable}
        currentPage="项目"
        currentPath={currentPath}
        inboxAttentionCount={inboxAttentionCount}
      >
        <Outlet />
      </AppShell>
    )
  }

  if (projectRoute?.projectId !== undefined) {
    return (
      <ProjectShellLayout
        codexAvailable={codexAvailable}
        currentPath={currentPath}
        inboxAttentionCount={inboxAttentionCount}
        projectId={projectRoute.projectId}
        view={projectRoute.view}
      />
    )
  }

  if (projectRoute !== null) {
    return (
      <AppShell
        breadcrumbs={[
          { label: '项目', to: '/projects' },
          {
            label: projectRoute.view === 'conversations' ? '会话' : '项目详情',
          },
        ]}
        codexAvailable={codexAvailable}
        currentPage={
          projectRoute.view === 'conversations' ? '会话' : '项目详情'
        }
        currentPath={currentPath}
        inboxAttentionCount={inboxAttentionCount}
      >
        <Outlet />
      </AppShell>
    )
  }

  if (conversationRoute?.conversationId !== undefined) {
    return (
      <LiveConversationShellLayout
        codexAvailable={codexAvailable}
        connectionState={connectionState}
        conversationId={conversationRoute.conversationId}
        currentPath={currentPath}
        inboxAttentionCount={inboxAttentionCount}
      />
    )
  }

  if (conversationRoute !== null) {
    const fixtureTitle =
      conversationsMock.conversations.find(
        (conversation) => conversation.id === conversationRoute.rawId,
      )?.title ?? conversationDetailMock.conversation.title
    return (
      <AppShell
        breadcrumbs={[{ label: '演示数据' }, { label: fixtureTitle }]}
        codexAvailable={codexAvailable}
        currentPage={fixtureTitle}
        currentPath={currentPath}
        inboxAttentionCount={inboxAttentionCount}
      >
        <Outlet />
      </AppShell>
    )
  }

  const currentPage =
    pageTitles[currentPath as keyof typeof pageTitles] ?? 'CodeTether'
  return (
    <AppShell
      breadcrumbs={[{ label: currentPage }]}
      codexAvailable={codexAvailable}
      currentPage={currentPage}
      currentPath={currentPath}
      inboxAttentionCount={inboxAttentionCount}
    >
      <Outlet />
    </AppShell>
  )
}

interface ProjectShellLayoutProps {
  codexAvailable: boolean
  currentPath: string
  inboxAttentionCount: number
  projectId: ProjectId
  view: 'detail' | 'conversations'
}

function ProjectShellLayout({
  codexAvailable,
  currentPath,
  inboxAttentionCount,
  projectId,
  view,
}: ProjectShellLayoutProps) {
  const runtime = useHostRuntime()
  const connectionState = useHostConnectionState()
  const projectQuery = useQuery({
    ...projectDetailQueryOptions(runtime, projectId),
    enabled: connectionState === 'connected',
  })
  const project = projectQuery.data
  const projectName = project?.name ?? '项目'
  const breadcrumbs =
    view === 'conversations'
      ? ([
          {
            label: projectName,
            params: { projectId },
            to: '/projects/$projectId' as const,
          },
          { label: '会话' },
        ] as const)
      : ([
          { label: '项目', to: '/projects' as const },
          { label: projectName },
        ] as const)

  return (
    <AppShell
      breadcrumbs={breadcrumbs}
      codexAvailable={codexAvailable}
      currentPage={view === 'conversations' ? '会话' : projectName}
      currentPath={currentPath}
      currentProject={project}
      inboxAttentionCount={inboxAttentionCount}
    >
      <Outlet />
    </AppShell>
  )
}

interface LiveConversationShellLayoutProps {
  codexAvailable: boolean
  connectionState: ReturnType<typeof useHostConnectionState>
  conversationId: ConversationId
  currentPath: string
  inboxAttentionCount: number
}

function LiveConversationShellLayout({
  codexAvailable,
  connectionState,
  conversationId,
  currentPath,
  inboxAttentionCount,
}: LiveConversationShellLayoutProps) {
  const runtime = useHostRuntime()
  const conversationQuery = useQuery({
    ...conversationDetailQueryOptions(runtime, conversationId),
    enabled: connectionState === 'connected',
  })
  const conversation = conversationQuery.data?.conversation

  if (conversation !== undefined) {
    return (
      <ResolvedConversationShellLayout
        codexAvailable={codexAvailable}
        conversationTitle={conversation.title}
        currentPath={currentPath}
        inboxAttentionCount={inboxAttentionCount}
        projectId={conversation.projectId}
      />
    )
  }

  return (
    <AppShell
      breadcrumbs={[{ label: '会话' }]}
      codexAvailable={codexAvailable}
      currentPage="会话"
      currentPath={currentPath}
      inboxAttentionCount={inboxAttentionCount}
    >
      <Outlet />
    </AppShell>
  )
}

interface ResolvedConversationShellLayoutProps {
  codexAvailable: boolean
  conversationTitle: string
  currentPath: string
  inboxAttentionCount: number
  projectId: ProjectId
}

function ResolvedConversationShellLayout({
  codexAvailable,
  conversationTitle,
  currentPath,
  inboxAttentionCount,
  projectId,
}: ResolvedConversationShellLayoutProps) {
  const runtime = useHostRuntime()
  const connectionState = useHostConnectionState()
  const projectQuery = useQuery({
    ...projectDetailQueryOptions(runtime, projectId),
    enabled: connectionState === 'connected',
  })
  const project = projectQuery.data

  return (
    <AppShell
      breadcrumbs={[
        {
          label: project?.name ?? '项目',
          params: { projectId },
          to: '/projects/$projectId',
        },
        { label: conversationTitle },
      ]}
      codexAvailable={codexAvailable}
      currentPage={conversationTitle}
      currentPath={currentPath}
      currentProject={project}
      inboxAttentionCount={inboxAttentionCount}
    >
      <Outlet />
    </AppShell>
  )
}

interface ParsedProjectRoute {
  projectId?: ProjectId
  view: 'detail' | 'conversations'
}

function parseProjectRoute(pathname: string): ParsedProjectRoute | null {
  const match = /^\/projects\/([^/]+)(?:\/(conversations))?\/?$/u.exec(pathname)
  if (match === null) return null
  const rawProjectId = safeDecode(match[1] ?? '')
  const parsedProjectId = ProjectIdSchema.safeParse(rawProjectId)
  return {
    ...(parsedProjectId.success ? { projectId: parsedProjectId.data } : {}),
    view: match[2] === 'conversations' ? 'conversations' : 'detail',
  }
}

interface ParsedConversationRoute {
  conversationId?: ConversationId
  rawId: string
}

function parseConversationRoute(
  pathname: string,
): ParsedConversationRoute | null {
  const match = /^\/conversations\/([^/]+)\/?$/u.exec(pathname)
  if (match === null) return null
  const rawId = safeDecode(match[1] ?? '')
  const parsedConversationId = ConversationIdSchema.safeParse(rawId)
  return {
    ...(parsedConversationId.success
      ? { conversationId: parsedConversationId.data }
      : {}),
    rawId,
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

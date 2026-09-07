import { useQuery } from '@tanstack/react-query'
import { Outlet, useRouterState } from '@tanstack/react-router'
import { TooltipProvider } from '@codetether/ui'

import {
  ConversationIdSchema,
  MachineIdSchema,
  ProjectIdSchema,
  type ConversationId,
  type MachineId,
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
import { machineDetailQueryOptions } from '../../runtime/host/machine-query'
import {
  providerPresentations,
  type ProviderPresentation,
} from '../../provider/provider-presentation'
import { AppShell } from './app-shell'

const pageTitles = {
  '/': '首页',
  '/activity': '活动',
  '/agents': '智能体',
  '/doctor': 'CodeTether 检查',
  '/inbox': '收件箱',
  '/machines': '机器',
  '/projects': '项目',
  '/settings': '设置',
} as const

export function RootLayout() {
  const currentPath = useRouterState({
    select: (state) => state.location.pathname,
  })

  if (currentPath === '/') {
    return (
      <TooltipProvider>
        <div className="min-h-dvh overflow-y-auto bg-background text-text-primary">
          <Outlet />
        </div>
      </TooltipProvider>
    )
  }

  if (currentPath === '/setup') {
    return (
      <TooltipProvider>
        <div className="min-h-dvh overflow-y-auto bg-background text-text-primary">
          <a
            href="#setup-main"
            className="fixed top-2 left-2 z-50 -translate-y-20 rounded-sm bg-primary-action px-3 py-2 text-sm font-medium text-primary-foreground transition-transform focus-visible:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            跳到设置内容
          </a>
          <Outlet />
        </div>
      </TooltipProvider>
    )
  }

  return <StandardRootLayout currentPath={currentPath} />
}

function StandardRootLayout({ currentPath }: { readonly currentPath: string }) {
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
  const agentProviders = providerPresentations(
    connectionState === 'connected' ? runtime.bootstrap : undefined,
  )
  const projectRoute = parseProjectRoute(currentPath)
  const machineRoute = parseMachineRoute(currentPath)
  const conversationRoute = parseConversationRoute(currentPath)

  if (currentPath === '/projects') {
    return (
      <AppShell
        breadcrumbs={[{ label: '项目' }]}
        agentProviders={agentProviders}
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
        agentProviders={agentProviders}
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
        agentProviders={agentProviders}
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

  if (machineRoute?.machineId !== undefined) {
    return (
      <MachineShellLayout
        agentProviders={agentProviders}
        currentPath={currentPath}
        inboxAttentionCount={inboxAttentionCount}
        machineId={machineRoute.machineId}
      />
    )
  }

  if (machineRoute !== null) {
    return (
      <AppShell
        breadcrumbs={[
          { label: '机器', to: '/machines' },
          { label: '机器详情' },
        ]}
        agentProviders={agentProviders}
        currentPage="机器详情"
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
        agentProviders={agentProviders}
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
        agentProviders={agentProviders}
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
      agentProviders={agentProviders}
      currentPage={currentPage}
      currentPath={currentPath}
      inboxAttentionCount={inboxAttentionCount}
    >
      <Outlet />
    </AppShell>
  )
}

interface MachineShellLayoutProps {
  agentProviders: readonly ProviderPresentation[]
  currentPath: string
  inboxAttentionCount: number
  machineId: MachineId
}

function MachineShellLayout({
  agentProviders,
  currentPath,
  inboxAttentionCount,
  machineId,
}: MachineShellLayoutProps) {
  const runtime = useHostRuntime()
  const connectionState = useHostConnectionState()
  const machineQuery = useQuery({
    ...machineDetailQueryOptions(runtime, machineId),
    enabled: connectionState === 'connected',
  })
  const machineName = machineQuery.data?.machine.displayName ?? '机器'

  return (
    <AppShell
      breadcrumbs={[{ label: '机器', to: '/machines' }, { label: machineName }]}
      agentProviders={agentProviders}
      currentPage={machineName}
      currentPath={currentPath}
      inboxAttentionCount={inboxAttentionCount}
    >
      <Outlet />
    </AppShell>
  )
}

interface ProjectShellLayoutProps {
  agentProviders: readonly ProviderPresentation[]
  currentPath: string
  inboxAttentionCount: number
  projectId: ProjectId
  view: 'detail' | 'conversations'
}

function ProjectShellLayout({
  agentProviders,
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
      agentProviders={agentProviders}
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
  agentProviders: readonly ProviderPresentation[]
  connectionState: ReturnType<typeof useHostConnectionState>
  conversationId: ConversationId
  currentPath: string
  inboxAttentionCount: number
}

function LiveConversationShellLayout({
  agentProviders,
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
        agentProviders={agentProviders}
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
      agentProviders={agentProviders}
      currentPage="会话"
      currentPath={currentPath}
      inboxAttentionCount={inboxAttentionCount}
    >
      <Outlet />
    </AppShell>
  )
}

interface ResolvedConversationShellLayoutProps {
  agentProviders: readonly ProviderPresentation[]
  conversationTitle: string
  currentPath: string
  inboxAttentionCount: number
  projectId: ProjectId
}

function ResolvedConversationShellLayout({
  agentProviders,
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
      agentProviders={agentProviders}
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

interface ParsedMachineRoute {
  machineId?: MachineId
}

function parseMachineRoute(pathname: string): ParsedMachineRoute | null {
  const match = /^\/machines\/([^/]+)\/?$/u.exec(pathname)
  if (match === null) return null
  const rawMachineId = safeDecode(match[1] ?? '')
  const machineId = MachineIdSchema.safeParse(rawMachineId)
  return machineId.success ? { machineId: machineId.data } : {}
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

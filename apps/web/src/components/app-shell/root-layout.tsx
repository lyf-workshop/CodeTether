import { useQuery } from '@tanstack/react-query'
import { Outlet, useRouterState } from '@tanstack/react-router'
import { TooltipProvider } from '@codetether/ui'
import {
  ConversationIdSchema,
  MachineIdSchema,
  ProjectIdSchema,
} from '@codetether/protocol'

import { attentionListQueryOptions } from '../../runtime/host/attention-query'
import { conversationDetailQueryOptions } from '../../runtime/host/conversation-detail-query'
import {
  useHostConnectionState,
  useHostRuntime,
} from '../../runtime/host/host-runtime-hooks'
import { projectDetailQueryOptions } from '../../runtime/host/project-query'
import { resolveProjectWorkspaceContext } from '../projects/project-workspace-model.js'
import { machineDetailQueryOptions } from '../../runtime/host/machine-query'
import { AppShell } from './app-shell'
import type { TopBarBreadcrumb } from './top-bar'
import { parseSettingsSearch } from '../settings/settings-model'

const unavailableProjectId = ProjectIdSchema.parse('proj_unavailable')
const unavailableMachineId = MachineIdSchema.parse('machine_unavailable')
const unavailableConversationId = ConversationIdSchema.parse('conv_unavailable')
const pageTitles: Readonly<Record<string, string>> = {
  '/devices': '设备',
  '/inbox': '待处理',
  '/settings': '设置',
  '/doctor': '关于与检查',
  '/add': '添加设备',
  '/add/node': '配对设备',
  '/signin': '登录',
  '/roadmap': '后续规划',
  '/settings/appearance': '外观',
  '/settings/account': '账号',
  '/settings/notify': '通知',
  '/settings/background': '后台运行',
  '/settings/about': '关于与检查',
}

export function RootLayout() {
  const currentPath = useRouterState({
    select: (state) => state.location.pathname,
  })
  if (
    currentPath === '/' ||
    currentPath === '/setup' ||
    currentPath === '/onboarding'
  ) {
    return (
      <TooltipProvider>
        <div className="h-dvh overflow-y-auto bg-background text-text-primary">
          {currentPath === '/setup' || currentPath === '/onboarding' ? (
            <a
              href="#setup-main"
              className="fixed top-2 left-2 z-50 -translate-y-20 rounded-sm bg-primary-action px-3 py-2 text-sm font-medium text-primary-foreground focus-visible:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              跳到设置内容
            </a>
          ) : null}
          <Outlet />
        </div>
      </TooltipProvider>
    )
  }
  return <StandardRootLayout currentPath={currentPath} />
}

function StandardRootLayout({ currentPath }: { currentPath: string }) {
  const runtime = useHostRuntime()
  const connectionState = useHostConnectionState()
  const search = useRouterState({ select: (state) => state.location.search })
  const conversationMatch = /^\/(?:conversations|c)\/([^/]+)\/?$/u.exec(
    currentPath,
  )
  const projectMatch =
    /^\/projects\/([^/]+)(?:\/(?:conversations|search))?\/?$/u.exec(currentPath)
  const machineMatch = /^\/(?:devices|machines)\/([^/]+)\/?$/u.exec(currentPath)
  const parsedConversation = ConversationIdSchema.safeParse(
    safeDecode(conversationMatch?.[1]),
  )
  const parsedProject = ProjectIdSchema.safeParse(safeDecode(projectMatch?.[1]))
  const parsedMachine = MachineIdSchema.safeParse(safeDecode(machineMatch?.[1]))
  const selectedMachine = MachineIdSchema.safeParse(search.machineId)
  const conversationId = parsedConversation.success
    ? parsedConversation.data
    : undefined
  const attentionQuery = useQuery({
    ...attentionListQueryOptions(runtime),
    enabled: connectionState === 'connected',
  })
  const conversationQuery = useQuery({
    ...conversationDetailQueryOptions(
      runtime,
      conversationId ?? unavailableConversationId,
    ),
    enabled: connectionState === 'connected' && conversationId !== undefined,
  })
  const currentConversation = conversationQuery.data?.conversation
  const projectId =
    currentConversation?.projectId ??
    (parsedProject.success ? parsedProject.data : undefined)
  const projectQuery = useQuery({
    ...projectDetailQueryOptions(runtime, projectId ?? unavailableProjectId),
    enabled: connectionState === 'connected' && projectId !== undefined,
  })
  const currentProject = projectQuery.data
  const projectContext =
    currentProject === undefined
      ? undefined
      : resolveProjectWorkspaceContext(
          currentProject,
          selectedMachine.success ? selectedMachine.data : undefined,
          search.invalidMachineId === true ||
            (search.machineId !== undefined && !selectedMachine.success),
        )
  const currentMachineId =
    currentConversation?.machineId ??
    (parsedMachine.success ? parsedMachine.data : undefined) ??
    (projectMatch !== null && selectedMachine.success
      ? selectedMachine.data
      : undefined) ??
    (projectMatch !== null && projectContext?.kind === 'selected'
      ? projectContext.location.machineId
      : undefined)

  const machineQuery = useQuery({
    ...machineDetailQueryOptions(
      runtime,
      currentMachineId ?? unavailableMachineId,
    ),
    enabled: connectionState === 'connected' && currentMachineId !== undefined,
  })
  const machineName = machineQuery.data?.machine.displayName ?? '设备'
  const projectName = currentProject?.name ?? '项目'
  const currentPage =
    conversationMatch !== null
      ? (currentConversation?.title ?? '会话')
      : projectMatch !== null
        ? currentPath.endsWith('/search')
          ? '搜索'
          : projectName
        : machineMatch !== null
          ? machineName
          : (pageTitles[currentPath] ?? 'CodeTether')
  const breadcrumbs: TopBarBreadcrumb[] = []
  if (projectMatch !== null || conversationMatch !== null) {
    if (currentMachineId !== undefined)
      breadcrumbs.push({
        label: machineName,
        to: '/devices/$machineId',
        params: { machineId: currentMachineId },
      })
    if (
      projectId !== undefined &&
      (conversationMatch !== null ||
        currentPath.endsWith('/conversations') ||
        currentPath.endsWith('/search'))
    ) {
      breadcrumbs.push({
        label: projectName,
        to: '/projects/$projectId',
        params: { projectId },
        search:
          currentMachineId === undefined ? {} : { machineId: currentMachineId },
      })
    }
    breadcrumbs.push({
      label:
        conversationMatch !== null
          ? currentPage
          : currentPath.endsWith('/search')
            ? '搜索'
            : projectName,
    })
  } else if (machineMatch !== null) {
    breadcrumbs.push({ label: '设备', to: '/devices' }, { label: machineName })
  } else if (currentPath === '/add/node') {
    breadcrumbs.push({ label: '添加设备', to: '/add' }, { label: currentPage })
  } else if (currentPath === '/add' || currentPath === '/roadmap') {
    breadcrumbs.push({ label: '设备', to: '/devices' }, { label: currentPage })
  } else if (currentPath === '/signin') {
    breadcrumbs.push(
      {
        label: '账号',
        to: '/settings/$section',
        params: { section: 'account' },
      },
      { label: currentPage },
    )
  } else if (currentPath.startsWith('/settings/')) {
    breadcrumbs.push(
      { label: '设置', to: '/settings', search: parseSettingsSearch(search) },
      { label: currentPage },
    )
  } else breadcrumbs.push({ label: currentPage })

  return (
    <AppShell
      breadcrumbs={breadcrumbs}
      currentPage={currentPage}
      currentPath={currentPath}
      currentProject={currentProject}
      currentProjectId={projectId}
      currentConversation={currentConversation}
      currentMachineId={currentMachineId}
      inboxAttentionCount={attentionQuery.data?.summary.totalOpen}
    >
      <Outlet />
    </AppShell>
  )
}

function safeDecode(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

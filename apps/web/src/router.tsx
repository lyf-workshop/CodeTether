import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router'
import {
  ProjectIdSchema,
  TurnIdSchema,
  type TurnId,
} from '@codetether/protocol'
import { RootLayout } from './components/app-shell/root-layout'
import { ProjectSearchRoute } from './components/projects/project-detail-page'
import {
  parseProjectWorkspaceSearch,
  type ProjectWorkspaceSearch,
} from './components/projects/project-workspace-model.js'
import { ConversationDetailRoute } from './components/conversation/conversation-detail-route'
import { InboxPage } from './components/inbox'
import { MachineDetailRoute, MachinesPage } from './components/machines'
import { ProjectDetailRoute } from './components/projects'
import { DesktopNotificationSettings } from './components/settings'
import { DoctorPage } from './components/doctor'
import { OnboardingPage, StartupGate } from './components/onboarding'

const rootRoute = createRootRoute({ component: RootLayout })

interface ConversationSearch {
  focus?: 'composer'
  panel?: 'changes'
  turn?: TurnId
}
type ProjectSearch = ProjectWorkspaceSearch

function conversationSearch(
  search: Record<string, unknown>,
): ConversationSearch {
  const turn = TurnIdSchema.safeParse(search.turn)
  return {
    focus: search.focus === 'composer' ? 'composer' : undefined,
    panel: search.panel === 'changes' ? 'changes' : undefined,
    ...(turn.success ? { turn: turn.data } : {}),
  }
}
function projectSearch(search: Record<string, unknown>): ProjectSearch {
  return parseProjectWorkspaceSearch(search)
}

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: StartupGate,
})
const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/setup',
  component: OnboardingPage,
})
const doctorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/doctor',
  validateSearch: (search: Record<string, unknown>) => {
    const projectId = ProjectIdSchema.safeParse(search.projectId)
    return projectId.success ? { projectId: projectId.data } : {}
  },
  component: DoctorPage,
})
const conversationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/conversations/$conversationId',
  remountDeps: ({ params }) => params.conversationId,
  validateSearch: conversationSearch,
  component: ConversationDetailRoute,
})
const shortConversationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/c/$conversationId',
  remountDeps: ({ params }) => params.conversationId,
  validateSearch: conversationSearch,
  component: ConversationDetailRoute,
})
const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/inbox',
  component: InboxPage,
})
const devicesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/devices',
  component: MachinesPage,
})
const deviceDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/devices/$machineId',
  component: MachineDetailRoute,
})
const projectDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$projectId',
  validateSearch: projectSearch,
  component: ProjectDetailRoute,
})
const projectConversationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$projectId/conversations',
  validateSearch: projectSearch,
  component: ProjectDetailRoute,
})
const projectSearchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$projectId/search',
  validateSearch: projectSearch,
  component: ProjectSearchRoute,
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: DesktopNotificationSettings,
})

// Legacy URLs remain accepted without exposing account Host read surfaces.
const machinesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/machines',
  beforeLoad: () => {
    throw redirect({ to: '/devices', replace: true })
  },
})
const machineDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/machines/$machineId',
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/devices/$machineId',
      params: { machineId: params.machineId },
      replace: true,
    })
  },
})
const hostsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/hosts',
  beforeLoad: () => {
    throw redirect({ to: '/devices', replace: true })
  },
})
const remoteHostRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/hosts/$hostId',
  beforeLoad: () => {
    throw redirect({ to: '/devices', replace: true })
  },
})
const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects',
  beforeLoad: () => {
    throw redirect({ to: '/devices', replace: true })
  },
})
const conversationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/conversations',
  beforeLoad: () => {
    throw redirect({ to: '/devices', replace: true })
  },
})
const activityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/activity',
  beforeLoad: () => {
    throw redirect({ to: '/devices', replace: true })
  },
})
const agentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agents',
  beforeLoad: () => {
    throw redirect({ to: '/devices', replace: true })
  },
})

const routeTree = rootRoute.addChildren([
  homeRoute,
  setupRoute,
  doctorRoute,
  conversationRoute,
  shortConversationRoute,
  inboxRoute,
  devicesRoute,
  deviceDetailRoute,
  projectDetailRoute,
  projectConversationsRoute,
  projectSearchRoute,
  settingsRoute,
  machinesRoute,
  machineDetailRoute,
  hostsRoute,
  remoteHostRoute,
  projectsRoute,
  conversationsRoute,
  activityRoute,
  agentsRoute,
])
export const router = createRouter({
  defaultPreload: 'intent',
  routeTree,
  scrollRestoration: true,
})
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

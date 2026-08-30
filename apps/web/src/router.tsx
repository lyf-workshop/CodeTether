import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router'
import {
  ConversationSearchQueryTextSchema,
  TurnIdSchema,
  type TurnId,
} from '@codetether/protocol'

import { RootLayout } from './components/app-shell/root-layout'
import { RoutePlaceholder } from './components/app-shell/route-placeholder'
import { ConversationDetailRoute } from './components/conversation/conversation-detail-route'
import { ProjectConversationsRoute } from './components/conversations'
import { InboxPage } from './components/inbox'
import { MachineDetailRoute, MachinesPage } from './components/machines'
import { ProjectDetailRoute, ProjectsPage } from './components/projects'
import { DesktopNotificationSettings } from './components/settings'

const rootRoute = createRootRoute({ component: RootLayout })

interface ConversationSearch {
  focus?: 'composer'
  panel?: 'changes'
  turn?: TurnId
}

interface ProjectConversationsSearch {
  q?: string
  view?: 'archived'
}

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({
      to: '/inbox',
      replace: true,
    })
  },
})

const conversationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/conversations',
  beforeLoad: () => {
    throw redirect({
      to: '/projects',
      replace: true,
    })
  },
})

const conversationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/conversations/$conversationId',
  remountDeps: ({ params }) => params.conversationId,
  validateSearch: (search: Record<string, unknown>): ConversationSearch => {
    const turn = TurnIdSchema.safeParse(search.turn)
    return {
      focus: search.focus === 'composer' ? 'composer' : undefined,
      panel: search.panel === 'changes' ? 'changes' : undefined,
      ...(turn.success ? { turn: turn.data } : {}),
    }
  },
  component: ConversationDetailRoute,
})

const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/inbox',
  component: InboxPage,
})

const activityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/activity',
  component: () => <RoutePlaceholder title="活动" />,
})

const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects',
  component: ProjectsPage,
})

const projectDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$projectId',
  component: ProjectDetailRoute,
})

const projectConversationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$projectId/conversations',
  validateSearch: (
    search: Record<string, unknown>,
  ): ProjectConversationsSearch => {
    const query = ConversationSearchQueryTextSchema.safeParse(search.q)
    return {
      ...(query.success ? { q: query.data } : {}),
      ...(search.view === 'archived' ? { view: 'archived' as const } : {}),
    }
  },
  component: ProjectConversationsRoute,
})

const agentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agents',
  component: () => <RoutePlaceholder title="智能体" />,
})

const machinesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/machines',
  component: MachinesPage,
})

const machineDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/machines/$machineId',
  component: MachineDetailRoute,
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: DesktopNotificationSettings,
})

const routeTree = rootRoute.addChildren([
  homeRoute,
  conversationsRoute,
  conversationRoute,
  inboxRoute,
  activityRoute,
  projectsRoute,
  projectDetailRoute,
  projectConversationsRoute,
  agentsRoute,
  machinesRoute,
  machineDetailRoute,
  settingsRoute,
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

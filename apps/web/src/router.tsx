import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router'

import { RootLayout } from './components/app-shell/root-layout'
import { RoutePlaceholder } from './components/app-shell/route-placeholder'
import { ConversationDetailRoute } from './components/conversation/conversation-detail-route'
import { ConversationsPage } from './components/conversations'
import { InboxPage } from './components/inbox'

const rootRoute = createRootRoute({ component: RootLayout })

interface ConversationSearch {
  panel?: 'changes'
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
  component: ConversationsPage,
})

const conversationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/conversations/$conversationId',
  validateSearch: (search: Record<string, unknown>): ConversationSearch => ({
    panel: search.panel === 'changes' ? 'changes' : undefined,
  }),
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
  component: () => <RoutePlaceholder title="项目" />,
})

const agentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agents',
  component: () => <RoutePlaceholder title="智能体" />,
})

const machinesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/machines',
  component: () => <RoutePlaceholder title="机器" />,
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: () => <RoutePlaceholder title="设置" />,
})

const routeTree = rootRoute.addChildren([
  homeRoute,
  conversationsRoute,
  conversationRoute,
  inboxRoute,
  activityRoute,
  projectsRoute,
  agentsRoute,
  machinesRoute,
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

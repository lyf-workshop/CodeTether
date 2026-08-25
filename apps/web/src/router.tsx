import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router'

import { RootLayout } from './components/app-shell/root-layout'
import { RoutePlaceholder } from './components/app-shell/route-placeholder'
import { ConversationDetailPage } from './components/conversation'

const rootRoute = createRootRoute({ component: RootLayout })

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({
      to: '/conversations/$conversationId',
      params: { conversationId: 'demo' },
      replace: true,
    })
  },
})

const conversationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/conversations/$conversationId',
  component: ConversationDetailPage,
})

const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/inbox',
  component: () => <RoutePlaceholder title="Inbox" />,
})

const activityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/activity',
  component: () => <RoutePlaceholder title="Activity" />,
})

const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects',
  component: () => <RoutePlaceholder title="Projects" />,
})

const agentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agents',
  component: () => <RoutePlaceholder title="Agents" />,
})

const machinesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/machines',
  component: () => <RoutePlaceholder title="Machines" />,
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: () => <RoutePlaceholder title="Settings" />,
})

const routeTree = rootRoute.addChildren([
  homeRoute,
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

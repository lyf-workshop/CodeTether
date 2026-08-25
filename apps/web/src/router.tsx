import {
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'

import { RootLayout } from './components/app-shell/root-layout'
import { RoutePlaceholder } from './components/app-shell/route-placeholder'

const rootRoute = createRootRoute({ component: RootLayout })

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => <RoutePlaceholder title="Home" />,
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

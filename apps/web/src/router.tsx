import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router'
import { TurnIdSchema, type TurnId } from '@codetether/protocol'
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
import { SettingsRoute, SignInPage } from './components/settings'
import { parseSettingsSearch } from './components/settings/settings-model'
import { OnboardingPage, StartupGate } from './components/onboarding'

import { AddDevicePage } from './components/machines/add-device-page'
import { NodePairingPage } from './components/machines/node-pairing-page'
import { nodePairingSearch } from './components/machines/node-pairing-model'
import { RoadmapPage } from './components/roadmap/roadmap-page'

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
  beforeLoad: () => {
    throw redirect({ to: '/onboarding', replace: true })
  },
})
const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/onboarding',
  component: OnboardingPage,
})
const doctorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/doctor',
  validateSearch: parseSettingsSearch,
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/settings/$section',
      params: { section: 'about' },
      search: parseSettingsSearch(search),
      replace: true,
    })
  },
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

const addDeviceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/add',
  component: AddDevicePage,
})
const nodePairingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/add/node',
  validateSearch: nodePairingSearch,
  component: NodePairingPage,
})
const roadmapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/roadmap',
  component: RoadmapPage,
})
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  validateSearch: parseSettingsSearch,
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/settings/$section',
      params: { section: 'appearance' },
      search: parseSettingsSearch(search),
      replace: true,
    })
  },
})
const settingsSectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/$section',
  validateSearch: parseSettingsSearch,
  component: SettingsRoute,
})
const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/signin',
  component: SignInPage,
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

// Compatibility destinations do not recreate removed account/Host access pages.
const legacyDeviceRoutes = (
  [
    '/home',
    '/sessions',
    '/search',
    '/computers',
    '/connect',
    '/add/desktop',
  ] as const
).map((pathname) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: pathname,
    beforeLoad: () => {
      throw redirect({
        to:
          pathname === '/connect' || pathname === '/add/desktop'
            ? '/add'
            : '/devices',
        replace: true,
      })
    },
  }),
)
const legacyComputerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/computers/$machineId',
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/devices/$machineId',
      params: { machineId: params.machineId },
      replace: true,
    })
  },
})
const legacyPairRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pair',
  beforeLoad: () => {
    throw redirect({ to: '/add/node', search: { step: 1 }, replace: true })
  },
})
const legacyAccountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/account',
  validateSearch: parseSettingsSearch,
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/settings/$section',
      params: { section: 'account' },
      search: parseSettingsSearch(search),
      replace: true,
    })
  },
})

const routeTree = rootRoute.addChildren([
  ...legacyDeviceRoutes,
  legacyComputerRoute,
  legacyPairRoute,
  legacyAccountRoute,
  homeRoute,
  setupRoute,
  onboardingRoute,
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
  settingsSectionRoute,
  signInRoute,
  addDeviceRoute,
  nodePairingRoute,
  roadmapRoute,
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

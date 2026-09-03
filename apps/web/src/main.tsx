import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './styles.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('CodeTether root element was not found')
}

const appRoot = rootElement

document.documentElement.dataset.theme = 'dark'

async function renderApp() {
  if (import.meta.env.DEV && window.location.pathname === '/__phase6d') {
    const { FailureDiagnosticsShowcaseApp } =
      await import('./showcase/failure-diagnostics-showcase')

    createRoot(appRoot).render(
      <StrictMode>
        <FailureDiagnosticsShowcaseApp />
      </StrictMode>,
    )
    return
  }

  if (import.meta.env.DEV && window.location.pathname === '/__ui') {
    const { ComponentShowcase } = await import('./showcase/component-showcase')

    createRoot(appRoot).render(
      <StrictMode>
        <ComponentShowcase />
      </StrictMode>,
    )
    return
  }

  const [
    { QueryClientProvider },
    { RouterProvider },
    { router },
    { HostRuntimeProvider },
    { getHostRuntime },
    { subscribeRuntimeToDesktopResume },
    { AttentionNotificationCoordinator },
    { notificationSurfaceFromPathname },
    { nativeCapabilities },
    {
      readDesktopNotificationPreferences,
      resolveNotificationPreferenceStorage,
    },
    { projectDetailQueryOptions },
    { conversationListQueryOptions },
    { createHostQueryClient },
  ] = await Promise.all([
    import('@tanstack/react-query'),
    import('@tanstack/react-router'),
    import('./router'),
    import('./runtime/host/host-runtime-provider'),
    import('./runtime/host/host-runtime'),
    import('./runtime/host/desktop-resume-subscription'),
    import('./runtime/notifications/attention-notification-coordinator'),
    import('./runtime/notifications/desktop-notification-model'),
    import('./runtime/native/native-capabilities'),
    import('./runtime/native/notification-preferences'),
    import('./runtime/host/project-query'),
    import('./runtime/host/conversation-list-query'),
    import('./runtime/host/host-query-client'),
  ])
  const queryClient = createHostQueryClient()
  const runtime = getHostRuntime(queryClient)
  const releaseDesktopResumeSubscription = subscribeRuntimeToDesktopResume(
    runtime,
    nativeCapabilities.backgroundRuntime,
  )
  let notificationNavigationSequence = 0
  const notificationStorage = resolveNotificationPreferenceStorage()
  const notificationCoordinator = new AttentionNotificationCoordinator({
    adapter: nativeCapabilities.notifications,
    eventSource: runtime,
    readPreferences: () =>
      readDesktopNotificationPreferences(notificationStorage),
    readSurface: () =>
      notificationSurfaceFromPathname(router.state.location.pathname),
    resolveMetadata: async (attention) => {
      const projectPromise = queryClient.fetchQuery(
        projectDetailQueryOptions(runtime, attention.projectId),
      )
      const conversationTitlePromise =
        attention.type === 'approval'
          ? queryClient
              .fetchQuery(
                conversationListQueryOptions(runtime, attention.projectId),
              )
              .then((conversations) => {
                const conversation = conversations.find(
                  (candidate) =>
                    candidate.conversationId === attention.conversationId,
                )
                if (conversation === undefined) {
                  throw new Error(
                    'Attention Conversation is missing from its Project index.',
                  )
                }
                return conversation.title
              })
          : Promise.resolve(attention.payload.conversationTitle)
      const [project, conversationTitle] = await Promise.all([
        projectPromise,
        conversationTitlePromise,
      ])
      return { projectName: project.name, conversationTitle }
    },
    navigate: async (intent) => {
      notificationNavigationSequence += 1
      await router.navigate({
        to: '/conversations/$conversationId',
        params: { conversationId: intent.conversationId },
        search: intent.turnId === undefined ? {} : { turn: intent.turnId },
        hash: `notification-${notificationNavigationSequence}`,
      })
    },
  })
  notificationCoordinator.start()
  window.addEventListener(
    'pagehide',
    () => {
      releaseDesktopResumeSubscription()
      void notificationCoordinator.stop()
    },
    { once: true },
  )

  createRoot(appRoot).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <HostRuntimeProvider runtime={runtime}>
          <RouterProvider router={router} />
        </HostRuntimeProvider>
      </QueryClientProvider>
    </StrictMode>,
  )
}

void renderApp()

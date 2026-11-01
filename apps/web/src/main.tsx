import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './styles.css'
import { LocalSupervisorPresenceCoordinator } from './runtime/account/local-supervisor-presence'
import { getThemeController } from './runtime/theme/theme-preference'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('CodeTether root element was not found')
}

const appRoot = rootElement

getThemeController()

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
    { resolveAttentionNotificationMetadata, resolveNotificationClickTarget },
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
    import('./runtime/notifications/attention-notification-metadata'),
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
    resolveMetadata: (attention) =>
      resolveAttentionNotificationMetadata(queryClient, runtime, attention),
    resolveClickTarget: (attentionId, signal) =>
      resolveNotificationClickTarget(queryClient, runtime, attentionId, signal),
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
  let lastConnectionState = runtime.getConnectionState()
  const logConnectionState = () => {
    const state = runtime.getConnectionState()
    if (state === lastConnectionState) return
    lastConnectionState = state
    if (state === 'connected') {
      void nativeCapabilities.notifications.logStage?.('sse-connected')
    } else if (state === 'reconnecting') {
      void nativeCapabilities.notifications.logStage?.('sse-reconnecting')
    } else if (state === 'unavailable') {
      void nativeCapabilities.notifications.logStage?.('sse-unavailable')
    }
  }
  const unsubscribeRuntime = runtime.subscribe(logConnectionState)
  const unsubscribeStreamResets = runtime.subscribeStreamResets(() => {
    void nativeCapabilities.notifications.logStage?.('sse-reset')
  })
  logConnectionState()
  window.addEventListener(
    'pagehide',
    () => {
      releaseDesktopResumeSubscription()
      unsubscribeRuntime()
      unsubscribeStreamResets()
      void notificationCoordinator.stop()
    },
    { once: true },
  )

  createRoot(appRoot).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <HostRuntimeProvider runtime={runtime}>
          <LocalSupervisorPresenceCoordinator />
          <RouterProvider router={router} />
        </HostRuntimeProvider>
      </QueryClientProvider>
    </StrictMode>,
  )
}

void renderApp()

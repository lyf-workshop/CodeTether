import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './styles.css'
import { hostBaseUrl } from './runtime/host/host-config'
import { LocalSupervisorPresenceCoordinator } from './runtime/account/local-supervisor-presence'

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
  await ensureDesktopHostIdentity(nativeCapabilities.hostIdentity)
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
          <LocalSupervisorPresenceCoordinator />
          <RouterProvider router={router} />
        </HostRuntimeProvider>
      </QueryClientProvider>
    </StrictMode>,
  )
}

async function ensureDesktopHostIdentity(
  capability: import('./runtime/native/native-capabilities').HostIdentityCapability,
): Promise<void> {
  if (!capability.available) return
  try {
    const existingResponse = await fetchDesktopHostIdentity()
    if (existingResponse.status === 200) {
      const existing = (await existingResponse.json()) as {
        readonly identity?: {
          readonly keyHandle?: unknown
          readonly publicJwk?: unknown
        }
      }
      const keyHandle = existing.identity?.keyHandle
      const persistedJwk = existing.identity?.publicJwk
      if (typeof keyHandle !== 'string' || typeof persistedJwk !== 'string') {
        throw new Error('host_identity_metadata_invalid')
      }
      const loaded = await capability.readPublic(keyHandle)
      const publicJwk = JSON.stringify({
        crv: loaded.publicKey.crv,
        kty: loaded.publicKey.kty,
        x: loaded.publicKey.x,
        y: loaded.publicKey.y,
      })
      if (publicJwk !== persistedJwk) {
        throw new Error('host_identity_public_key_mismatch')
      }
      return
    }
    if (existingResponse.status !== 404) {
      throw new Error('host_identity_read_failed')
    }
    const created = await capability.createKey()
    const response = await fetch(`${hostBaseUrl}/api/v1/host/identity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(created),
    })
    if (!response.ok) throw new Error('host_identity_persist_failed')
  } catch (error) {
    const code =
      error instanceof Error ? error.message : 'host_identity_unavailable'
    console.error(`[codetether] ${code}`)
  }
}

const HOST_IDENTITY_BOOTSTRAP_ATTEMPTS = 20
const HOST_IDENTITY_BOOTSTRAP_RETRY_DELAY_MS = 250

async function fetchDesktopHostIdentity(): Promise<Response> {
  let lastError: unknown
  for (
    let attempt = 0;
    attempt < HOST_IDENTITY_BOOTSTRAP_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await fetch(`${hostBaseUrl}/api/v1/host/identity`, {
        headers: { Accept: 'application/json' },
      })
    } catch (error) {
      lastError = error
      if (attempt + 1 < HOST_IDENTITY_BOOTSTRAP_ATTEMPTS) {
        await new Promise((resolve) =>
          setTimeout(resolve, HOST_IDENTITY_BOOTSTRAP_RETRY_DELAY_MS),
        )
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('host_identity_unavailable')
}

void renderApp()

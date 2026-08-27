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
    { QueryClient, QueryClientProvider },
    { RouterProvider },
    { router },
    { HostRuntimeProvider },
  ] = await Promise.all([
    import('@tanstack/react-query'),
    import('@tanstack/react-router'),
    import('./router'),
    import('./runtime/host/host-runtime-provider'),
  ])
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  createRoot(appRoot).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <HostRuntimeProvider>
          <RouterProvider router={router} />
        </HostRuntimeProvider>
      </QueryClientProvider>
    </StrictMode>,
  )
}

void renderApp()

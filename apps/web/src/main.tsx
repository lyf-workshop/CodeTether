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

  const [{ RouterProvider }, { router }] = await Promise.all([
    import('@tanstack/react-router'),
    import('./router'),
  ])
  const { DemoStateProvider } = await import('./state/demo-state-provider')

  createRoot(appRoot).render(
    <StrictMode>
      <DemoStateProvider>
        <RouterProvider router={router} />
      </DemoStateProvider>
    </StrictMode>,
  )
}

void renderApp()

import { Outlet, useRouterState } from '@tanstack/react-router'

import { AppShell } from './app-shell'

const pageTitles = {
  '/': 'Home',
  '/activity': 'Activity',
  '/agents': 'Agents',
  '/inbox': 'Inbox',
  '/machines': 'Machines',
  '/projects': 'Projects',
  '/settings': 'Settings',
} as const

export function RootLayout() {
  const currentPath = useRouterState({
    select: (state) => state.location.pathname,
  })
  const currentPage =
    pageTitles[currentPath as keyof typeof pageTitles] ?? 'CodeTether'

  return (
    <AppShell currentPage={currentPage} currentPath={currentPath}>
      <Outlet />
    </AppShell>
  )
}

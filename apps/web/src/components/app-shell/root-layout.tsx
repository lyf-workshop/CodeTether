import { Outlet, useRouterState } from '@tanstack/react-router'

import { conversationDetailMock } from '../../mocks/conversation-detail'
import { AppShell } from './app-shell'

const pageTitles = {
  '/': '首页',
  '/activity': '活动',
  '/agents': '智能体',
  '/inbox': '收件箱',
  '/machines': '机器',
  '/projects': '项目',
  '/settings': '设置',
} as const

export function RootLayout() {
  const currentPath = useRouterState({
    select: (state) => state.location.pathname,
  })
  const currentPage = currentPath.startsWith('/conversations/')
    ? conversationDetailMock.conversation.title
    : (pageTitles[currentPath as keyof typeof pageTitles] ?? 'CodeTether')

  return (
    <AppShell
      currentPage={currentPage}
      currentPath={currentPath}
      currentProject={conversationDetailMock.project.name}
    >
      <Outlet />
    </AppShell>
  )
}

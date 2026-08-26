import { Outlet, useRouterState } from '@tanstack/react-router'

import { ConversationIdSchema } from '@codetether/protocol'

import { conversationDetailMock } from '../../mocks/conversation-detail'
import { conversationsMock } from '../../mocks/conversations'
import { useDemoState } from '../../state/demo-state-context'
import { AppShell } from './app-shell'

const pageTitles = {
  '/': '首页',
  '/activity': '活动',
  '/agents': '智能体',
  '/conversations': '会话',
  '/inbox': '收件箱',
  '/machines': '机器',
  '/projects': '项目',
  '/settings': '设置',
} as const

export function RootLayout() {
  const { inboxAttentionCount } = useDemoState()
  const currentPath = useRouterState({
    select: (state) => state.location.pathname,
  })
  const conversationId = currentPath.startsWith('/conversations/')
    ? decodeURIComponent(currentPath.slice('/conversations/'.length))
    : null
  const conversationTitle = conversationId
    ? conversationsMock.conversations.find(
        (conversation) => conversation.id === conversationId,
      )?.title
    : undefined
  const isLiveConversationRoute =
    conversationId !== null &&
    ConversationIdSchema.safeParse(conversationId).success
  const currentPage = currentPath.startsWith('/conversations/')
    ? (conversationTitle ??
      (isLiveConversationRoute
        ? 'Codex 实时会话'
        : conversationDetailMock.conversation.title))
    : (pageTitles[currentPath as keyof typeof pageTitles] ?? 'CodeTether')

  return (
    <AppShell
      currentPage={currentPage}
      currentPath={currentPath}
      currentProject={
        isLiveConversationRoute
          ? '本地工作区'
          : conversationDetailMock.project.name
      }
      inboxAttentionCount={inboxAttentionCount}
    >
      <Outlet />
    </AppShell>
  )
}

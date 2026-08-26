import { useParams, useSearch } from '@tanstack/react-router'

import { ConversationDetailPage } from './conversation-detail-page'

export function ConversationDetailRoute() {
  const { conversationId } = useParams({
    from: '/conversations/$conversationId',
  })
  const { panel } = useSearch({ from: '/conversations/$conversationId' })

  return (
    <ConversationDetailPage
      conversationId={conversationId}
      initialInspectorTab={panel}
    />
  )
}

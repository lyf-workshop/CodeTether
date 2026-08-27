import { useParams } from '@tanstack/react-router'

import { ProjectIdSchema } from '@codetether/protocol'

import { ConversationsNotFoundState } from './conversation-page-states'
import { ConversationsPage } from './conversations-page'

/** Typed route boundary; the page itself receives only a validated Project ID. */
export function ProjectConversationsRoute() {
  const { projectId: rawProjectId } = useParams({
    from: '/projects/$projectId/conversations',
  })
  const projectId = ProjectIdSchema.safeParse(rawProjectId)

  if (!projectId.success) {
    return (
      <div className="min-h-full min-w-0 px-[var(--layout-content-inline-padding)] py-[var(--layout-content-block-padding)]">
        <ConversationsNotFoundState />
      </div>
    )
  }
  return <ConversationsPage projectId={projectId.data} />
}

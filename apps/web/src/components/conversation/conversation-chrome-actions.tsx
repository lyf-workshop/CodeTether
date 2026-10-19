import type { Ref } from 'react'
import { MoreHorizontal, PanelRightClose, PanelRightOpen } from 'lucide-react'
import {
  ConversationIdSchema,
  type ConversationSummary,
  type ProjectId,
} from '@codetether/protocol'
import {
  IconButton,
  StatusBadge,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@codetether/ui'

import type { ConversationViewModel } from './conversation-view-model'
import { organizationConversationStatus } from './conversation-view-model'
import { ConversationOrganizationMenu } from '../conversations/conversation-organization-controls'

interface ConversationChromeActionsProps {
  conversation: ConversationViewModel
  inspectorOpen: boolean
  inspectorTriggerRef?: Ref<HTMLButtonElement>
  projectId?: ProjectId
  onArchived?: (conversation: ConversationSummary) => void
  onToggleInspector: () => void
}

export function ConversationChromeActions({
  conversation,
  inspectorOpen,
  inspectorTriggerRef,
  projectId,
  onArchived,
  onToggleInspector,
}: ConversationChromeActionsProps) {
  const conversationId = ConversationIdSchema.safeParse(conversation.id)
  const inspectorLabel = inspectorOpen ? '隐藏文件面板' : '显示文件面板'

  return (
    <>
      <StatusBadge status={conversation.status} className="shrink-0" />
      <Tooltip>
        <TooltipTrigger asChild>
          <IconButton
            ref={inspectorTriggerRef}
            label={inspectorLabel}
            aria-pressed={inspectorOpen}
            data-slot="conversation-inspector-toggle"
            variant="ghost"
            size="sm"
            className="size-8 text-text-secondary"
            onClick={onToggleInspector}
          >
            {inspectorOpen ? (
              <PanelRightClose aria-hidden="true" />
            ) : (
              <PanelRightOpen aria-hidden="true" />
            )}
          </IconButton>
        </TooltipTrigger>
        <TooltipContent side="bottom">{inspectorLabel}</TooltipContent>
      </Tooltip>

      {projectId === undefined || !conversationId.success ? null : (
        <ConversationOrganizationMenu
          conversation={{
            conversationId: conversationId.data,
            projectId,
            title: conversation.title,
            titleSource: conversation.titleSource,
            status: organizationConversationStatus(conversation.status),
            ...(conversation.pinnedAt === undefined
              ? {}
              : { pinnedAt: conversation.pinnedAt }),
            ...(conversation.archivedAt === undefined
              ? {}
              : { archivedAt: conversation.archivedAt }),
          }}
          align="end"
          onArchived={onArchived}
          trigger={
            <IconButton
              label="管理会话"
              variant="ghost"
              size="sm"
              className="size-8 text-text-secondary"
            >
              <MoreHorizontal aria-hidden="true" />
            </IconButton>
          }
        />
      )}
    </>
  )
}

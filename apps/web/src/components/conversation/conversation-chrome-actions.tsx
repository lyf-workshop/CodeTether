import type { Ref } from 'react'
import {
  LoaderCircle,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  Pause,
} from 'lucide-react'
import {
  ConversationIdSchema,
  type ConversationSummary,
  type ProjectId,
} from '@codetether/protocol'
import {
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@codetether/ui'

import type { InterruptController } from './conversation-controls'
import type {
  ConversationCapabilitiesViewModel,
  ConversationViewModel,
} from './conversation-view-model'
import { organizationConversationStatus } from './conversation-view-model'
import { ConversationOrganizationMenu } from '../conversations/conversation-organization-controls'

interface ConversationChromeActionsProps {
  conversation: ConversationViewModel
  capabilities: ConversationCapabilitiesViewModel
  inspectorOpen: boolean
  inspectorTriggerRef?: Ref<HTMLButtonElement>
  interruptController?: InterruptController
  projectId?: ProjectId
  onArchived?: (conversation: ConversationSummary) => void
  onToggleInspector: () => void
}

export function ConversationChromeActions({
  conversation,
  capabilities,
  inspectorOpen,
  inspectorTriggerRef,
  interruptController,
  projectId,
  onArchived,
  onToggleInspector,
}: ConversationChromeActionsProps) {
  const conversationId = ConversationIdSchema.safeParse(conversation.id)
  const inspectorLabel = inspectorOpen ? '隐藏检查器' : '显示检查器'
  const interruptLabel = interruptController?.pending
    ? '正在中断当前运行'
    : '中断当前运行'

  return (
    <>
      {capabilities.supportsInterrupt ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton
              label={interruptLabel}
              variant="ghost"
              size="sm"
              className="size-8 text-text-secondary"
              disabled={
                !capabilities.canInterrupt ||
                interruptController?.pending === true
              }
              onClick={() => {
                void interruptController?.execute()
              }}
            >
              {interruptController?.pending ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="animate-spin motion-reduce:animate-none"
                />
              ) : (
                <Pause aria-hidden="true" />
              )}
            </IconButton>
          </TooltipTrigger>
          <TooltipContent side="bottom">{interruptLabel}</TooltipContent>
        </Tooltip>
      ) : null}

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

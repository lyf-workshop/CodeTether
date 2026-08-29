import type { Ref } from 'react'
import { FileDiff, LoaderCircle, PanelRightOpen, Pause } from 'lucide-react'

import {
  AgentBadge,
  Badge,
  Button,
  IconButton,
  MachineBadge,
  StatusBadge,
} from '@codetether/ui'

import type {
  ConversationCapabilitiesViewModel,
  ConversationConnectionIndicatorViewModel,
  ConversationConnectionState,
  ConversationViewModel,
} from './conversation-view-model'
import type { InterruptController } from './conversation-controls'

const connectionBadgeVariants = {
  connecting: 'info',
  connected: 'secondary',
  reconnecting: 'warning',
  unavailable: 'danger',
  incompatible: 'danger',
} as const satisfies Record<
  ConversationConnectionState,
  'secondary' | 'info' | 'warning' | 'danger'
>

interface ConversationHeaderProps {
  conversation: ConversationViewModel
  capabilities: ConversationCapabilitiesViewModel
  connectionIndicator?: ConversationConnectionIndicatorViewModel
  inspectorTriggerRef?: Ref<HTMLButtonElement>
  onOpenInspector?: () => void
  onOpenChanges?: () => void
  interruptController?: InterruptController
}

export function ConversationHeader({
  conversation,
  capabilities,
  connectionIndicator,
  inspectorTriggerRef,
  onOpenInspector,
  onOpenChanges,
  interruptController,
}: ConversationHeaderProps) {
  return (
    <header className="flex h-[var(--layout-conversation-header-height)] min-w-0 items-start justify-between gap-4 border-b border-border px-5 py-4">
      <div className="min-w-0">
        <h1
          title={conversation.title}
          className="truncate text-lg font-semibold text-text-primary"
        >
          {conversation.title}
        </h1>
        <div className="mt-2 flex min-w-0 items-center gap-2 overflow-hidden">
          <StatusBadge
            status={conversation.status}
            className="h-6 px-2 text-xs font-regular"
          />
          <AgentBadge
            agent={conversation.agent}
            variant="compact"
            className="h-6"
          />
          {conversation.model === '默认模型' ? null : (
            <Badge
              variant="outline"
              className="h-6 max-w-44 truncate rounded-sm px-2 font-regular"
              title={conversation.model}
            >
              {conversation.model}
            </Badge>
          )}
          <MachineBadge
            name={conversation.machine}
            className="h-6 font-regular"
          />
          {connectionIndicator && connectionIndicator.state !== 'connected' ? (
            <Badge
              variant={connectionBadgeVariants[connectionIndicator.state]}
              className="h-6 rounded-sm px-2 font-regular"
              role="status"
            >
              {connectionIndicator.label}
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="mr-2 flex shrink-0 items-center gap-1.5 pt-1">
        <IconButton
          ref={inspectorTriggerRef}
          label="打开会话检查器"
          variant="ghost"
          size="sm"
          className="size-8 text-text-secondary min-[1440px]:hidden"
          onClick={onOpenInspector}
        >
          <PanelRightOpen aria-hidden="true" />
        </IconButton>
        <Button
          variant="secondary"
          size="sm"
          className="h-8 border-border bg-surface-muted/65 px-3 text-sm"
          aria-label="查看当前会话的变更"
          onClick={onOpenChanges}
        >
          <FileDiff aria-hidden="true" />
          <span className="max-[1180px]:sr-only">查看变更</span>
        </Button>
        <IconButton
          label={
            interruptController?.pending ? '正在中断当前运行' : '中断当前运行'
          }
          variant="ghost"
          size="sm"
          className="size-8 text-text-secondary"
          disabled={
            !capabilities.canInterrupt || interruptController?.pending === true
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
      </div>
    </header>
  )
}

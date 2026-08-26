import type { Ref } from 'react'
import { PanelRightOpen, Pause, Square } from 'lucide-react'

import {
  AgentBadge,
  Badge,
  Button,
  IconButton,
  MachineBadge,
  StatusBadge,
} from '@codetether/ui'

import type { ConversationDetailMock } from '../../mocks/conversation-detail'

interface ConversationHeaderProps {
  conversation: ConversationDetailMock['conversation']
  inspectorTriggerRef?: Ref<HTMLButtonElement>
  onOpenInspector?: () => void
}

export function ConversationHeader({
  conversation,
  inspectorTriggerRef,
  onOpenInspector,
}: ConversationHeaderProps) {
  return (
    <header className="flex h-[var(--layout-conversation-header-height)] min-w-0 items-start justify-between gap-4 border-b border-border px-5 py-4">
      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold text-text-primary">
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
          <Badge variant="outline" className="h-6 rounded-sm px-2 font-regular">
            {conversation.model}
          </Badge>
          <Badge variant="outline" className="h-6 rounded-sm px-2 font-regular">
            {conversation.reasoning}
          </Badge>
          <MachineBadge
            name={conversation.machine}
            className="h-6 font-regular"
          />
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
        >
          <span className="max-[1180px]:sr-only">查看变更</span>
        </Button>
        <IconButton
          label="暂停或中断当前运行"
          variant="ghost"
          size="sm"
          className="size-8 text-text-secondary"
        >
          <Pause aria-hidden="true" />
        </IconButton>
        <IconButton
          label="停止当前会话"
          variant="ghost"
          size="sm"
          className="size-8 text-danger hover:bg-danger-muted/60 hover:text-danger active:bg-danger-muted"
        >
          <Square aria-hidden="true" className="size-3.5 fill-current" />
        </IconButton>
      </div>
    </header>
  )
}

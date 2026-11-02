import { Link } from '@tanstack/react-router'
import { ChevronRight, FolderOpen, Monitor } from 'lucide-react'
import { AgentBadge, Badge } from '@codetether/ui'

import type {
  ConversationConnectionIndicatorViewModel,
  ConversationConnectionState,
  ConversationViewModel,
} from './conversation-view-model'
import type { ConversationDisplayContext } from './conversation-gate-presentation'

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
  connectionIndicator?: ConversationConnectionIndicatorViewModel
  context?: ConversationDisplayContext
}

export function ConversationHeader({
  conversation,
  connectionIndicator,
  context,
}: ConversationHeaderProps) {
  const contextClassName =
    'inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-sm bg-surface-inset px-2 py-1 text-sm text-text-secondary outline-none hover:bg-surface-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring'
  return (
    <header className="mb-6 w-full min-w-0 border-b border-border pt-3 pb-5">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <h1
          title={conversation.title}
          className="min-w-0 flex-1 break-words text-2xl leading-snug font-semibold text-text-primary"
        >
          {conversation.title}
        </h1>
      </div>
      <div
        aria-label="会话所属设备和项目"
        className="mt-3 flex min-w-0 flex-wrap items-center gap-1.5"
      >
        {context === undefined ? (
          <span className="text-sm text-text-secondary">
            {conversation.machine}
          </span>
        ) : (
          <>
            <Link
              to="/devices/$machineId"
              params={{ machineId: context.machineId }}
              className={contextClassName}
              title={context.machineName}
            >
              <Monitor aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">{context.machineName}</span>
            </Link>
            <ChevronRight
              aria-hidden="true"
              className="size-3 text-text-muted"
            />
            <Link
              to="/projects/$projectId"
              params={{ projectId: context.projectId }}
              search={{ machineId: context.machineId }}
              className={contextClassName}
              title={context.projectPath}
            >
              <FolderOpen aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">{context.projectName}</span>
            </Link>
          </>
        )}
        <span className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-sm bg-surface-inset px-2 py-1 text-sm text-text-secondary">
          <AgentBadge agent={conversation.agent} size="sm" />
          {context?.reasoning === undefined ? null : (
            <span className="truncate">· 推理强度：{context.reasoning}</span>
          )}
        </span>
        {context?.importedFrom === undefined ? null : (
          <Badge variant="outline">从 {context.importedFrom} 导入</Badge>
        )}
        {connectionIndicator && connectionIndicator.state !== 'connected' ? (
          <Badge
            variant={connectionBadgeVariants[connectionIndicator.state]}
            role="status"
          >
            {connectionIndicator.label}
          </Badge>
        ) : null}
      </div>
    </header>
  )
}

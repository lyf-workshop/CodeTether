import type { ReactNode } from 'react'
import { UserRound } from 'lucide-react'

import { AgentIdentityMark, StatusBadge, cn } from '@codetether/ui'

import type { ConversationMessageMock } from '../../mocks/conversation-detail'

interface MessageProps {
  message: ConversationMessageMock
  children?: ReactNode
  className?: string
}

export function UserMessage({ message, className }: MessageProps) {
  return (
    <article
      aria-label={`你在 ${message.time} 发送的消息`}
      className={cn(
        'flex min-w-0 gap-3 rounded-md border border-border/60 bg-surface-muted/35 px-3 py-3',
        className,
      )}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-text-primary text-background">
        <UserRound aria-hidden="true" className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-between gap-3">
          <span className="text-md font-semibold text-text-primary">你</span>
          <time className="text-xs text-text-muted">{message.time}</time>
        </header>
        <p className="mt-2 text-base font-regular leading-normal text-text-primary">
          {message.body}
        </p>
      </div>
    </article>
  )
}

export function AgentMessage({ message, children, className }: MessageProps) {
  const hasExecution = Boolean(children)

  return (
    <article
      aria-label={`Codex 在 ${message.time} 的工作记录`}
      data-status={message.status}
      className={cn(
        'relative flex min-w-0 gap-3 px-1 py-3',
        hasExecution
          ? 'border-y border-border/50'
          : 'rounded-sm bg-surface-muted/25 px-3',
        className,
      )}
    >
      <AgentIdentityMark agent="codex" className="size-8 rounded-sm text-sm" />
      <div className="min-w-0 flex-1">
        <header className="flex min-w-0 items-center gap-2">
          <span className="text-md font-semibold text-text-primary">Codex</span>
          {message.status ? (
            <StatusBadge
              status={message.status}
              showIcon={false}
              className="h-5 border-transparent bg-transparent px-1 text-xs"
            />
          ) : null}
          <time className="ml-auto shrink-0 text-xs text-text-muted">
            {message.time}
          </time>
        </header>
        <p className="mt-2 text-base font-regular leading-normal text-text-primary">
          {message.body}
        </p>
        {children ? <div className="mt-3">{children}</div> : null}
      </div>
    </article>
  )
}

import {
  DiffCard,
  ScrollArea,
  ShellRunCard,
  ToolCallCard,
} from '@codetether/ui'

import type { ConversationDetailMock } from '../../mocks/conversation-detail'
import { AgentMessage, UserMessage } from './message'

interface ConversationTimelineProps {
  timeline: ConversationDetailMock['timeline']
}

export function ConversationTimeline({ timeline }: ConversationTimelineProps) {
  return (
    <ScrollArea aria-label="会话执行时间线" className="min-h-0 bg-background">
      <div className="mx-auto w-full max-w-3xl px-5 pb-5">
        <p className="flex h-[var(--layout-conversation-day-marker-height)] items-center justify-center text-center text-xs text-text-muted">
          {timeline.dayLabel}
        </p>

        <div className="space-y-3">
          <UserMessage message={timeline.userMessage} className="min-h-19" />

          <AgentMessage message={timeline.agentRun.message}>
            <div className="border-t border-border/50">
              {timeline.agentRun.tools.map((tool) => (
                <ToolCallCard
                  key={tool.id}
                  title={tool.title}
                  status={tool.status}
                  description={tool.description}
                  metadata={tool.metadata}
                  delta={tool.delta}
                  action={
                    tool.actionLabel ? (
                      <button
                        type="button"
                        className="rounded-xs text-sm font-medium text-primary outline-none hover:text-primary-hover hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        {tool.actionLabel}
                      </button>
                    ) : undefined
                  }
                />
              ))}
            </div>

            <DiffCard
              className="mt-3"
              fileName={timeline.agentRun.diff.fileName}
              lines={timeline.agentRun.diff.lines}
            />

            <div className="mt-3 border-t border-border/50">
              <ShellRunCard
                command={timeline.agentRun.shell.command}
                status={timeline.agentRun.shell.status}
                summary={timeline.agentRun.shell.summary}
              />
            </div>
          </AgentMessage>

          <AgentMessage message={timeline.followUp} className="py-2" />
        </div>
      </div>
    </ScrollArea>
  )
}

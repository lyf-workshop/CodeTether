import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { AgentBadge, Button, SectionState, StatusBadge } from '@codetether/ui'
import type { GetMachineResponse } from '@codetether/protocol'

import { formatConversationActivity } from '../conversations/conversation-list-model'

const conversationPageSize = 10

export function MachineConversationsSection({
  conversations,
  projects,
  machine,
}: Pick<GetMachineResponse, 'conversations' | 'projects' | 'machine'>) {
  const [visibleCount, setVisibleCount] = useState(conversationPageSize)
  const own = conversations
    .filter((conversation) => conversation.machineId === machine.machineId)
    .sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt))
  const recent = own.slice(0, visibleCount)
  const projectNames = new Map(
    projects.map((project) => [project.projectId, project.name]),
  )
  return (
    <section
      className="min-w-0"
      aria-labelledby="machine-conversations-heading"
    >
      <h2
        id="machine-conversations-heading"
        className="mb-3 text-lg font-semibold"
      >
        最近的会话{' '}
        <span className="ml-2 text-md font-normal text-text-muted">
          {recent.length}
        </span>
      </h2>
      {own.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <SectionState
            state="empty"
            title="还没有会话"
            description="打开一个项目，在里面新建会话。"
          />
        </div>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-border bg-surface">
          {recent.map((conversation) => (
            <li
              key={conversation.conversationId}
              className="border-t border-border first:border-t-0"
            >
              <Link
                to="/c/$conversationId"
                params={{ conversationId: conversation.conversationId }}
                className="flex min-w-0 flex-wrap items-center gap-3 px-4 py-3 outline-none hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <div className="min-w-0 flex-1 basis-40">
                  <h3
                    title={conversation.title}
                    className="truncate text-base font-medium"
                  >
                    {conversation.title}
                  </h3>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-sm text-text-muted">
                    <span className="truncate">
                      {projectNames.get(conversation.projectId) ?? '项目'}
                    </span>
                    <AgentBadge
                      agent={
                        conversation.provider === 'codex' ? 'codex' : 'claude'
                      }
                    />
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <StatusBadge status={conversation.status} />
                  <time
                    dateTime={conversation.lastActivityAt}
                    className="text-sm text-text-muted"
                  >
                    {formatConversationActivity(conversation.lastActivityAt)}
                  </time>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {recent.length < own.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() =>
              setVisibleCount((count) => count + conversationPageSize)
            }
          >
            加载更多会话
          </Button>
          <span className="text-sm text-text-muted">
            已显示 {recent.length} 个，已读取 {own.length} 个
          </span>
        </div>
      ) : own.length >= 100 ? (
        <p className="mt-3 text-sm text-text-muted">
          设备页最多显示最近 100 个会话；如有更早记录，可在所属项目中查找。
        </p>
      ) : null}
    </section>
  )
}

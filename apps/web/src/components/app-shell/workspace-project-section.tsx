import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Archive, ChevronDown, ChevronRight, Pin, Plus } from 'lucide-react'
import { IconButton, cn } from '@codetether/ui'
import type { ConversationSummary, MachineSummary } from '@codetether/protocol'
import {
  useHostConnectionState,
  useHostRuntime,
} from '../../runtime/host/host-runtime-hooks'
import { conversationListQueryOptions } from '../../runtime/host/conversation-list-query'
import { machineConnectionStateLabel } from '../machines/machine-presentation'
import { machineCanAddProject } from '../machines/device-project-model'
import type { WorkspaceSidebarProps } from './workspace-sidebar'
import {
  workspaceConversationStatusLabel,
  workspaceLocationConversations,
  workspaceProviderPresentation,
  type WorkspaceProjectEntry,
} from './workspace-sidebar-model'

export function WorkspaceProjectSection({
  entry,
  machine,
  active,
  currentConversationId,
  currentConversation,
  expanded,
  onExpandedChange,
  onNewConversation,
}: {
  entry: WorkspaceProjectEntry
  machine: MachineSummary
  active: boolean
  currentConversationId?: string
  currentConversation?: ConversationSummary
  expanded: boolean
  onExpandedChange: () => void
  onNewConversation: WorkspaceSidebarProps['onNewConversation']
}) {
  const runtime = useHostRuntime()
  const connectionState = useHostConnectionState()
  const contentId = useId()
  const [showAll, setShowAll] = useState(false)
  const { project, location } = entry
  const conversationsQuery = useQuery({
    ...conversationListQueryOptions(runtime, project.projectId),
    enabled: expanded && connectionState === 'connected',
  })
  const conversations = workspaceLocationConversations(
    conversationsQuery.data ?? [],
    project.projectId,
    machine.machineId,
    showAll,
    currentConversation,
  )
  const bounded = (conversationsQuery.data?.length ?? 0) >= 100
  const machineReady =
    machine.availability === 'available' &&
    (machine.connectionState === 'local' ||
      machine.connectionState === 'online')
  const unavailableReason = !machineReady
    ? machineConnectionStateLabel(machine.connectionState)
    : !machine.capabilities.providerExecution
      ? '不能运行'
      : location.availability !== 'available'
        ? '无法访问'
        : undefined
  const canCreate =
    connectionState === 'connected' &&
    machineCanAddProject(machine) &&
    location.availability === 'available'
  return (
    <div
      data-workspace-project={project.projectId}
      data-workspace-location={entry.key}
      data-active={active || undefined}
    >
      <div
        className={cn(
          'group/project flex h-[var(--tree-project-h)] min-w-0 items-center rounded-sm px-1',
          active ? 'bg-surface-muted' : 'hover:bg-surface-muted/55',
        )}
      >
        <IconButton
          type="button"
          size="sm"
          variant="ghost"
          aria-controls={contentId}
          aria-expanded={expanded}
          label={`${expanded ? '折叠' : '展开'}项目：${project.name}`}
          className="size-5 shrink-0 text-text-muted"
          onClick={() => {
            if (expanded) setShowAll(false)
            onExpandedChange()
          }}
        >
          {expanded ? (
            <ChevronDown aria-hidden="true" />
          ) : (
            <ChevronRight aria-hidden="true" />
          )}
        </IconButton>
        <Link
          to="/projects/$projectId"
          params={{ projectId: project.projectId }}
          search={{ machineId: machine.machineId }}
          aria-current={active ? 'location' : undefined}
          title={location.rootPath}
          className={cn(
            'min-w-0 flex-1 truncate rounded-xs px-0.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
            unavailableReason === undefined
              ? 'text-text-primary'
              : 'text-text-muted',
          )}
        >
          {project.name}
        </Link>
        {canCreate ? (
          <IconButton
            type="button"
            size="sm"
            variant="ghost"
            label={`在 ${project.name} 中新建会话`}
            className="size-6 shrink-0 text-text-muted opacity-0 group-hover/project:opacity-100 group-focus-within/project:opacity-100 focus-visible:opacity-100"
            onClick={(event) =>
              onNewConversation(
                project,
                event.currentTarget,
                machine.machineId,
                'fixed',
              )
            }
          >
            <Plus aria-hidden="true" />
          </IconButton>
        ) : machineReady && unavailableReason !== undefined ? (
          <span className="shrink-0 text-2xs text-text-muted">
            {unavailableReason}
          </span>
        ) : null}
      </div>
      {expanded ? (
        <div id={contentId}>
          {conversationsQuery.data === undefined &&
          conversations.visible.length === 0 ? (
            <p role="status" className="px-2 py-2 text-xs text-text-muted">
              {connectionState === 'connected' && !conversationsQuery.isError
                ? '正在加载会话…'
                : '暂时无法读取会话'}
            </p>
          ) : conversations.visible.length === 0 ? (
            <p className="flex h-[var(--tree-secondary-h)] items-center px-2 text-xs text-text-muted">
              还没有会话
            </p>
          ) : (
            <ul aria-label={`${machine.displayName} · ${project.name} 会话`}>
              {conversations.visible.map((conversation) => (
                <WorkspaceConversationRow
                  key={conversation.conversationId}
                  conversation={conversation}
                  selected={
                    conversation.conversationId === currentConversationId
                  }
                />
              ))}
            </ul>
          )}
          {conversations.hasMore ? (
            <button
              type="button"
              className="flex h-[var(--tree-secondary-h)] w-full items-center rounded-sm px-2 text-left text-xs text-text-muted outline-none hover:bg-surface-muted/55 focus-visible:ring-2 focus-visible:ring-ring/60"
              onClick={() => setShowAll((current) => !current)}
            >
              {showAll
                ? '收起'
                : bounded
                  ? `显示已读取的 ${conversations.activeCount} 个`
                  : `显示全部 ${conversations.activeCount} 个`}
            </button>
          ) : null}
          {bounded && showAll ? (
            <p className="px-2 py-1 text-2xs text-text-muted">
              只读取项目最近 100 个会话；更早的会话请使用项目内搜索。
            </p>
          ) : null}
          <Link
            to="/projects/$projectId/conversations"
            params={{ projectId: project.projectId }}
            search={{ view: 'archived', machineId: machine.machineId }}
            className="flex h-[var(--tree-secondary-h)] items-center gap-2 rounded-sm px-2 text-xs text-text-muted outline-none hover:bg-surface-muted/55 focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <Archive aria-hidden="true" className="size-3.5" />
            <span className="truncate">查看已归档会话</span>
          </Link>
        </div>
      ) : null}
    </div>
  )
}

function WorkspaceConversationRow({
  conversation,
  selected,
}: {
  conversation: ConversationSummary
  selected: boolean
}) {
  const provider = workspaceProviderPresentation(conversation.provider)
  const status = workspaceConversationStatusLabel(conversation.status)
  const archived = conversation.archivedAt !== undefined
  return (
    <li className="min-w-0">
      <Link
        to="/conversations/$conversationId"
        params={{ conversationId: conversation.conversationId }}
        aria-current={selected ? 'page' : undefined}
        data-selected={selected || undefined}
        data-provider={conversation.provider}
        title={`${conversation.title} · ${provider.label}${status === undefined ? '' : ` · ${status}`}${archived ? ' · 已归档' : ''}`}
        className={cn(
          'flex h-[var(--tree-conversation-h)] min-w-0 items-center gap-3 rounded-sm px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
          selected
            ? 'bg-surface-muted font-medium text-text-primary'
            : 'text-text-secondary hover:bg-surface-muted/55 hover:text-text-primary',
        )}
      >
        <span
          role={status === undefined ? undefined : 'img'}
          aria-label={status}
          aria-hidden={status === undefined ? true : undefined}
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            conversation.status === 'running'
              ? 'bg-primary motion-safe:animate-pulse'
              : conversation.status === 'waiting'
                ? 'bg-warning'
                : conversation.status === 'failed'
                  ? 'bg-danger'
                  : 'bg-transparent',
          )}
        />
        <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
        {archived ? (
          <Archive
            aria-label="当前已归档"
            className="size-3 shrink-0 text-text-muted"
          />
        ) : null}
        {conversation.pinnedAt !== undefined ? (
          <Pin
            aria-label="已置顶"
            className="size-3 shrink-0 text-text-muted"
          />
        ) : null}
      </Link>
    </li>
  )
}

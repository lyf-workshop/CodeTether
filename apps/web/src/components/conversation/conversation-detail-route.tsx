import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useSearch } from '@tanstack/react-router'

import {
  ConversationIdSchema,
  type ConversationId,
  type ConversationSummary,
  type GetConversationResponse,
  type HostCapabilities,
  type ProjectRecord,
} from '@codetether/protocol'
import { Button } from '@codetether/ui'

import {
  useHostConnectionState,
  useHostProjection,
  useHostRuntime,
} from '../../runtime/host/host-runtime-hooks'
import { conversationDetailQueryOptions } from '../../runtime/host/conversation-detail-query'
import { conversationListQueryOptions } from '../../runtime/host/conversation-list-query'
import {
  includeConversationDetail,
  type ConversationReadModel,
} from '../../runtime/host/conversation-projection'
import {
  readHostProjection,
  replaceHostProjection,
} from '../../runtime/host/host-query'
import { projectDetailQueryOptions } from '../../runtime/host/project-query'
import { ConversationDetailPage } from './conversation-detail-page'
import { NewConversationDialog } from '../conversations/new-conversation-dialog'
import { createDemoConversationDetailSource } from './demo-conversation-adapter'
import { createLiveConversationDetailSource } from './live-conversation-adapter'
import { useLiveConversationControls } from './use-live-conversation-controls'

export function ConversationDetailRoute() {
  const { conversationId } = useParams({
    from: '/conversations/$conversationId',
  })
  const { panel } = useSearch({ from: '/conversations/$conversationId' })
  const liveConversationId = ConversationIdSchema.safeParse(conversationId)

  if (liveConversationId.success) {
    return (
      <LiveConversationDetailRoute
        conversationId={liveConversationId.data}
        initialInspectorTab={panel}
      />
    )
  }

  const source = createDemoConversationDetailSource(conversationId)

  return (
    <ConversationDetailPage
      viewModel={source.conversation}
      rail={source.rail}
      connectionIndicator={source.connectionIndicator}
      initialInspectorTab={panel}
    />
  )
}

interface LiveConversationDetailRouteProps {
  readonly conversationId: ConversationId
  readonly initialInspectorTab?: 'changes'
}

function LiveConversationDetailRoute({
  conversationId,
  initialInspectorTab,
}: LiveConversationDetailRouteProps) {
  const runtime = useHostRuntime()
  const connectionState = useHostConnectionState()
  const detailQuery = useQuery({
    ...conversationDetailQueryOptions(runtime, conversationId),
    enabled: connectionState === 'connected',
  })

  if (detailQuery.data === undefined) {
    return (
      <LiveConversationBoundary
        state={connectionState}
        conversationId={conversationId}
        readFailed={detailQuery.isError}
        onRetry={() => {
          runtime.retry()
          if (connectionState === 'connected') void detailQuery.refetch()
        }}
      />
    )
  }

  return (
    <LoadedLiveConversationDetail
      detail={detailQuery.data}
      connectionState={connectionState}
      initialInspectorTab={initialInspectorTab}
    />
  )
}

interface LoadedLiveConversationDetailProps {
  readonly detail: GetConversationResponse
  readonly connectionState: ReturnType<typeof useHostConnectionState>
  readonly initialInspectorTab?: 'changes'
}

function LoadedLiveConversationDetail({
  detail,
  connectionState,
  initialInspectorTab,
}: LoadedLiveConversationDetailProps) {
  const runtime = useHostRuntime()
  const queryClient = useQueryClient()
  const projection = useHostProjection()
  const conversationId = detail.conversation.conversationId
  const projectId = detail.conversation.projectId
  const hasProjectedConversation =
    projection?.conversations[conversationId] !== undefined
  const projectQuery = useQuery({
    ...projectDetailQueryOptions(runtime, projectId),
    enabled: connectionState === 'connected',
  })
  const railQuery = useQuery({
    ...conversationListQueryOptions(runtime, projectId),
    enabled: connectionState === 'connected',
  })

  useEffect(() => {
    const current = readHostProjection(queryClient)
    if (current === undefined) return
    const next = includeConversationDetail(current, detail)
    if (next !== current) replaceHostProjection(queryClient, next)
  }, [detail, hasProjectedConversation, projection?.cursor.epoch, queryClient])

  const conversation = projection?.conversations[conversationId]
  if (conversation === undefined) {
    return (
      <LiveConversationBoundary
        state={connectionState}
        conversationId={conversationId}
        onRetry={() => runtime.retry()}
      />
    )
  }

  if (projectQuery.data === undefined && !projectQuery.isError) {
    return (
      <LiveConversationBoundary
        state={connectionState}
        conversationId={conversationId}
        onRetry={() => runtime.retry()}
      />
    )
  }

  const summaries = includeCurrentSummary(
    railQuery.data ?? [],
    detail.conversation,
  )

  return (
    <ConnectedLiveConversationDetail
      conversation={conversation}
      summaries={summaries}
      connectionState={connectionState}
      capabilities={runtime.bootstrap?.capabilities}
      project={projectQuery.data}
      projectAvailability={projectQuery.data?.availability ?? 'unavailable'}
      initialInspectorTab={initialInspectorTab}
    />
  )
}

interface ConnectedLiveConversationDetailProps {
  readonly conversation: ConversationReadModel
  readonly summaries: readonly ConversationSummary[]
  readonly connectionState: ReturnType<typeof useHostConnectionState>
  readonly capabilities: HostCapabilities | undefined
  readonly project: ProjectRecord | undefined
  readonly projectAvailability: 'available' | 'unavailable'
  readonly initialInspectorTab?: 'changes'
}

function ConnectedLiveConversationDetail({
  conversation,
  summaries,
  connectionState,
  capabilities,
  project,
  projectAvailability,
  initialInspectorTab,
}: ConnectedLiveConversationDetailProps) {
  const newConversationButtonRef = useRef<HTMLButtonElement>(null)
  const [newConversationOpen, setNewConversationOpen] = useState(false)
  const source = createLiveConversationDetailSource(
    conversation,
    summaries,
    connectionState,
    capabilities,
    projectAvailability,
    project?.rootPath,
  )
  const controls = useLiveConversationControls(
    conversation,
    source.conversation.capabilities,
  )

  return (
    <>
      <ConversationDetailPage
        viewModel={source.conversation}
        rail={source.rail}
        connectionIndicator={source.connectionIndicator}
        controls={controls}
        initialInspectorTab={initialInspectorTab}
        newConversationButtonRef={newConversationButtonRef}
        newConversationDisabled={projectAvailability === 'unavailable'}
        {...(project === undefined
          ? {}
          : {
              projectId: project.projectId,
              onNewConversation: () => setNewConversationOpen(true),
            })}
      />
      {project === undefined ? null : (
        <NewConversationDialog
          currentProject={project}
          open={newConversationOpen}
          onOpenChange={setNewConversationOpen}
          returnFocusRef={newConversationButtonRef}
        />
      )}
    </>
  )
}

interface LiveConversationBoundaryProps {
  readonly state:
    'connecting' | 'connected' | 'reconnecting' | 'unavailable' | 'incompatible'
  readonly conversationId: string
  readonly readFailed?: boolean
  readonly onRetry: () => void
}

function LiveConversationBoundary({
  state,
  conversationId,
  readFailed = false,
  onRetry,
}: LiveConversationBoundaryProps) {
  const content = {
    connecting: {
      title: '正在连接 CodeTether Host',
      description: '正在读取 Bootstrap 和会话快照。',
    },
    reconnecting: {
      title: '正在重新连接 CodeTether Host',
      description: '连接恢复后会继续显示实时会话。',
    },
    unavailable: {
      title: '无法连接到 CodeTether Host',
      description: '请确认本地 Host 已启动，然后重试。',
    },
    incompatible: {
      title: 'Host 版本不兼容',
      description: 'Web Client 需要 CodeTether Protocol v1。',
    },
    connected: {
      title: readFailed ? '无法读取会话' : '正在读取会话历史',
      description: readFailed
        ? 'CodeTether Host 无法返回这个会话，请重试。'
        : `正在从 Host 读取会话 ${conversationId}。`,
    },
  } as const
  const current = content[state]
  const canRetry =
    state === 'unavailable' || state === 'incompatible' || readFailed

  return (
    <section
      aria-live="polite"
      className="grid h-full min-h-0 place-items-center bg-background px-6"
    >
      <div className="max-w-md text-center">
        <h1 className="text-lg font-semibold text-text-primary">
          {current.title}
        </h1>
        <p className="mt-2 text-sm font-regular leading-normal text-text-secondary">
          {current.description}
        </p>
        {canRetry ? (
          <Button
            type="button"
            variant="secondary"
            className="mt-4"
            onClick={onRetry}
          >
            重试
          </Button>
        ) : null}
      </div>
    </section>
  )
}

function includeCurrentSummary(
  summaries: readonly ConversationSummary[],
  current: ConversationSummary,
): readonly ConversationSummary[] {
  return summaries.some(
    (summary) => summary.conversationId === current.conversationId,
  )
    ? summaries
    : [current, ...summaries]
}

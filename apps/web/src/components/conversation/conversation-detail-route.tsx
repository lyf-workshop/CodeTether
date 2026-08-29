import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  useNavigate,
  useParams,
  useRouterState,
  useSearch,
} from '@tanstack/react-router'

import {
  ConversationIdSchema,
  type ConversationId,
  type ConversationSummary,
  type GetConversationResponse,
  type HostCapabilities,
  type ProjectRecord,
  type TurnId,
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
import { startComposerFocusHandoff } from './composer-focus-handoff'
import { useLiveConversationControls } from './use-live-conversation-controls'

export function ConversationDetailRoute() {
  const { conversationId } = useParams({
    from: '/conversations/$conversationId',
  })
  const { focus, panel, turn } = useSearch({
    from: '/conversations/$conversationId',
  })
  const navigate = useNavigate({ from: '/conversations/$conversationId' })
  const anchorRequestKey = useRouterState({
    select: (state) => state.location.state.__TSR_key ?? state.location.href,
  })
  const liveConversationId = ConversationIdSchema.safeParse(conversationId)
  const handledFocusRequestRef = useRef<string | null>(null)

  useEffect(() => {
    if (focus !== 'composer') return

    const focusRequestKey = `${conversationId}:${anchorRequestKey}`
    const clearIntent = () => {
      void navigate({
        replace: true,
        to: '/conversations/$conversationId',
        params: { conversationId },
        search: {
          ...(panel === undefined ? {} : { panel }),
          ...(turn === undefined ? {} : { turn }),
        },
      })
    }

    const handoff = startComposerFocusHandoff({
      isBlocked: () => document.querySelector('[role="dialog"]') !== null,
      getTarget: () => {
        const composer = document.getElementById('conversation-composer')
        return composer instanceof HTMLTextAreaElement ? composer : null
      },
      claim: () => {
        if (handledFocusRequestRef.current === focusRequestKey) return false
        handledFocusRequestRef.current = focusRequestKey
        return true
      },
      clearIntent,
      observe: (onChange) => {
        const observer = new MutationObserver(onChange)
        observer.observe(document.body, {
          attributeFilter: ['data-state'],
          attributes: true,
          childList: true,
          subtree: true,
        })
        return () => observer.disconnect()
      },
      scheduleTimeout: (onTimeout, timeoutMs) => {
        const timeoutId = window.setTimeout(onTimeout, timeoutMs)
        return () => window.clearTimeout(timeoutId)
      },
    })
    return () => handoff.dispose()
  }, [anchorRequestKey, conversationId, focus, navigate, panel, turn])

  if (liveConversationId.success) {
    return (
      <LiveConversationDetailRoute
        anchorRequestKey={anchorRequestKey}
        conversationId={liveConversationId.data}
        initialInspectorTab={panel}
        targetTurnId={turn}
      />
    )
  }

  const source = createDemoConversationDetailSource(conversationId)

  return (
    <ConversationDetailPage
      anchorRequestKey={anchorRequestKey}
      viewModel={source.conversation}
      rail={source.rail}
      connectionIndicator={source.connectionIndicator}
      initialInspectorTab={panel}
      targetTurnId={turn}
    />
  )
}

interface LiveConversationDetailRouteProps {
  readonly anchorRequestKey: string
  readonly conversationId: ConversationId
  readonly initialInspectorTab?: 'changes'
  readonly targetTurnId?: TurnId
}

function LiveConversationDetailRoute({
  anchorRequestKey,
  conversationId,
  initialInspectorTab,
  targetTurnId,
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
      anchorRequestKey={anchorRequestKey}
      detail={detailQuery.data}
      connectionState={connectionState}
      initialInspectorTab={initialInspectorTab}
      targetTurnId={targetTurnId}
    />
  )
}

interface LoadedLiveConversationDetailProps {
  readonly anchorRequestKey: string
  readonly detail: GetConversationResponse
  readonly connectionState: ReturnType<typeof useHostConnectionState>
  readonly initialInspectorTab?: 'changes'
  readonly targetTurnId?: TurnId
}

function LoadedLiveConversationDetail({
  anchorRequestKey,
  detail,
  connectionState,
  initialInspectorTab,
  targetTurnId,
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
      anchorRequestKey={anchorRequestKey}
      conversation={conversation}
      summaries={summaries}
      connectionState={connectionState}
      capabilities={runtime.bootstrap?.capabilities}
      project={projectQuery.data}
      projectAvailability={projectQuery.data?.availability ?? 'unavailable'}
      initialInspectorTab={initialInspectorTab}
      targetTurnId={targetTurnId}
    />
  )
}

interface ConnectedLiveConversationDetailProps {
  readonly anchorRequestKey: string
  readonly conversation: ConversationReadModel
  readonly summaries: readonly ConversationSummary[]
  readonly connectionState: ReturnType<typeof useHostConnectionState>
  readonly capabilities: HostCapabilities | undefined
  readonly project: ProjectRecord | undefined
  readonly projectAvailability: 'available' | 'unavailable'
  readonly initialInspectorTab?: 'changes'
  readonly targetTurnId?: TurnId
}

function ConnectedLiveConversationDetail({
  anchorRequestKey,
  conversation,
  summaries,
  connectionState,
  capabilities,
  project,
  projectAvailability,
  initialInspectorTab,
  targetTurnId,
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
        anchorRequestKey={anchorRequestKey}
        viewModel={source.conversation}
        rail={source.rail}
        connectionIndicator={source.connectionIndicator}
        controls={controls}
        initialInspectorTab={initialInspectorTab}
        targetTurnId={targetTurnId}
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
  readFailed = false,
  onRetry,
}: LiveConversationBoundaryProps) {
  const content = {
    connecting: {
      title: '正在连接 CodeTether',
      description: '正在读取会话。',
    },
    reconnecting: {
      title: '正在重新连接 CodeTether',
      description: '连接恢复后会继续显示实时会话。',
    },
    unavailable: {
      title: 'CodeTether 暂时无法连接',
      description: '本地服务暂时不可用，请稍后重试。',
    },
    incompatible: {
      title: 'CodeTether 版本不兼容',
      description: '当前应用与本地服务版本不匹配。',
    },
    connected: {
      title: readFailed ? '无法读取会话' : '正在读取会话历史',
      description: readFailed
        ? 'CodeTether 暂时无法读取这个会话，请重试。'
        : '正在读取会话…',
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

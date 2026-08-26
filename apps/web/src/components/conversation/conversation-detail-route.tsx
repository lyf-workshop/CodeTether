import { useParams, useSearch } from '@tanstack/react-router'

import {
  ConversationIdSchema,
  type HostCapabilities,
} from '@codetether/protocol'
import { Button } from '@codetether/ui'

import {
  useHostConnectionState,
  useHostProjection,
  useHostRuntime,
} from '../../runtime/host/host-runtime-hooks'
import { ConversationDetailPage } from './conversation-detail-page'
import { createDemoConversationDetailSource } from './demo-conversation-adapter'
import { createLiveConversationDetailSource } from './live-conversation-adapter'
import { useLiveConversationControls } from './use-live-conversation-controls'
import type {
  ConversationProjection,
  ConversationReadModel,
} from '../../runtime/host/conversation-projection'

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
  readonly conversationId: string
  readonly initialInspectorTab?: 'changes'
}

function LiveConversationDetailRoute({
  conversationId,
  initialInspectorTab,
}: LiveConversationDetailRouteProps) {
  const runtime = useHostRuntime()
  const connectionState = useHostConnectionState()
  const bootstrap = runtime.bootstrap
  const projection = useHostProjection()
  const conversation = projection?.conversations[conversationId]

  if (conversation === undefined || projection === undefined) {
    return (
      <LiveConversationBoundary
        state={connectionState}
        conversationId={conversationId}
        onRetry={() => runtime.retry()}
      />
    )
  }

  return (
    <ConnectedLiveConversationDetail
      conversation={conversation}
      projection={projection}
      connectionState={connectionState}
      capabilities={bootstrap?.capabilities}
      initialInspectorTab={initialInspectorTab}
    />
  )
}

interface ConnectedLiveConversationDetailProps {
  readonly conversation: ConversationReadModel
  readonly projection: ConversationProjection
  readonly connectionState: ReturnType<typeof useHostConnectionState>
  readonly capabilities: HostCapabilities | undefined
  readonly initialInspectorTab?: 'changes'
}

function ConnectedLiveConversationDetail({
  conversation,
  projection,
  connectionState,
  capabilities,
  initialInspectorTab,
}: ConnectedLiveConversationDetailProps) {
  const source = createLiveConversationDetailSource(
    conversation,
    projection,
    connectionState,
    capabilities,
  )
  const controls = useLiveConversationControls(
    conversation,
    source.conversation.capabilities,
  )

  return (
    <ConversationDetailPage
      viewModel={source.conversation}
      rail={source.rail}
      connectionIndicator={source.connectionIndicator}
      controls={controls}
      initialInspectorTab={initialInspectorTab}
    />
  )
}

interface LiveConversationBoundaryProps {
  readonly state:
    'connecting' | 'connected' | 'reconnecting' | 'unavailable' | 'incompatible'
  readonly conversationId: string
  readonly onRetry: () => void
}

function LiveConversationBoundary({
  state,
  conversationId,
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
      title: 'Host 中暂时没有这个会话',
      description: `正在等待会话 ${conversationId} 出现在实时事件中。`,
    },
  } as const
  const current = content[state]
  const canRetry = state === 'unavailable' || state === 'incompatible'

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

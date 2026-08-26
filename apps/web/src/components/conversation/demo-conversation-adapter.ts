import { conversationDetailMock } from '../../mocks/conversation-detail'
import { conversationsMock } from '../../mocks/conversations'
import type {
  ConversationDetailSourceViewModel,
  ConversationFileChangeViewModel,
  ConversationRunExecutionViewModel,
  ConversationViewModel,
} from './conversation-view-model'

const demoTimelineChangeId = 'change-src-services-websocket-ts'

function createDemoChanges(): readonly ConversationFileChangeViewModel[] {
  return conversationDetailMock.inspector.changes.map((change, index) => {
    const timelineChange =
      index === 0 ? conversationDetailMock.timeline.agentRun.diff : undefined

    return {
      id: timelineChange
        ? demoTimelineChangeId
        : `change-${index}-${change.name}`,
      path: timelineChange?.fileName ?? change.name,
      name: change.name,
      kind: 'modified',
      additions: change.additions,
      deletions: change.deletions,
      lines: timelineChange?.lines ?? [],
    }
  })
}

function createDemoConversation(conversationId: string): ConversationViewModel {
  const data = conversationDetailMock
  const catalogConversation = conversationsMock.conversations.find(
    (conversation) => conversation.id === conversationId,
  )
  const conversationMachine = catalogConversation
    ? conversationsMock.machines.find(
        (machine) => machine.id === catalogConversation.machine,
      )?.name
    : undefined
  const conversation = catalogConversation
    ? {
        ...data.conversation,
        id: catalogConversation.id,
        title: catalogConversation.title,
        status: catalogConversation.status,
        agent: catalogConversation.agent,
        model: catalogConversation.model,
        machine: conversationMachine ?? data.conversation.machine,
      }
    : data.conversation

  const executions: ConversationRunExecutionViewModel[] = [
    ...data.timeline.agentRun.tools.map((tool) => ({
      kind: 'tool' as const,
      id: `execution-${tool.id}`,
      tool: {
        id: tool.id,
        title: tool.title,
        status: tool.status,
        ...(tool.description === undefined
          ? {}
          : { description: tool.description }),
        ...(tool.metadata === undefined
          ? {}
          : { outputSummary: tool.metadata }),
        ...(tool.actionLabel === undefined
          ? {}
          : { actionLabel: tool.actionLabel }),
        ...(tool.delta === undefined ? {} : { delta: tool.delta }),
      },
    })),
    {
      kind: 'diff',
      id: `execution-${demoTimelineChangeId}`,
      changeId: demoTimelineChangeId,
    },
    {
      kind: 'shell',
      id: 'execution-shell-pnpm-test',
      shell: {
        id: 'shell-pnpm-test',
        ...data.timeline.agentRun.shell,
      },
    },
  ]

  return {
    ...conversation,
    timeline: {
      dayLabel: data.timeline.dayLabel,
      blocks: [
        {
          kind: 'message',
          id: data.timeline.userMessage.id,
          message: data.timeline.userMessage,
        },
        {
          kind: 'agent-run',
          id: 'agent-run-demo',
          time: data.timeline.agentRun.message.time,
          status: data.timeline.agentRun.message.status ?? conversation.status,
          message: data.timeline.agentRun.message,
          executions,
        },
        {
          kind: 'message',
          id: data.timeline.followUp.id,
          message: data.timeline.followUp,
        },
      ],
    },
    changes: {
      files: createDemoChanges(),
      totals: data.inspector.totals,
    },
    terminal: {
      ...data.inspector.terminal,
      truncated: false,
    },
    context: data.inspector.context,
    pendingApprovals: [],
    capabilities: {
      canCompose: true,
      canInterrupt: true,
      canStop: true,
      canResolveApproval: false,
    },
  }
}

/**
 * Current route source adapter. Phase 2C.1 can replace this at the route boundary
 * for Host-owned IDs without changing the frozen component tree below it.
 */
export function createDemoConversationDetailSource(
  conversationId: string,
): ConversationDetailSourceViewModel {
  return {
    conversation: createDemoConversation(conversationId),
    rail: conversationDetailMock.rail,
  }
}

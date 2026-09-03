import type {
  ApprovalKind,
  ConversationSummary,
  ConversationTitleSource,
  EventCursor,
  FileChangeKind,
  GetConversationResponse,
  HostEventEnvelope,
  HostError,
  HostSnapshot,
  ProviderId,
  StreamResetReason,
  ToolKind,
  ToolOutputStream,
} from '@codetether/protocol'

export const TERMINAL_OUTPUT_MAX_BYTES = 128 * 1024
export const MESSAGE_OUTPUT_MAX_BYTES = 512 * 1024

const TOOL_OUTPUT_SUMMARY_MAX_CHARACTERS = 512
const USER_INPUT_ORDER = -1
const FINAL_MESSAGE_ORDER = Number.MAX_SAFE_INTEGER
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export type CanonicalConversationStatus =
  | 'idle'
  | 'thinking'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'offline'

export type ProjectedItemStatus = 'idle' | 'running' | 'completed' | 'failed'

export interface ConversationTurnReadModel {
  readonly id: string
  readonly status: 'running' | 'completed' | 'failed' | 'interrupted'
  readonly startedAt: string
  readonly completedAt?: string
  readonly finalMessage?: string
  readonly error?: HostError
  /** Stable retained-Turn order, independent of wall-clock formatting. */
  readonly order: number
}

export type CurrentTurnReadModel = ConversationTurnReadModel

export interface MessageReadModel {
  /** Opaque presentation identity derived from the Turn and Item identities. */
  readonly id: string
  readonly turnId: string
  readonly itemId?: string
  readonly author: 'user' | 'agent'
  readonly body: string
  readonly status: ProjectedItemStatus
  readonly timestamp: string
  /** Host sequence for Agent Items; user input is always first within its Turn. */
  readonly order: number
}

export interface ToolReadModel {
  /** Opaque presentation identity derived from the Turn and Item identities. */
  readonly id: string
  readonly turnId: string
  readonly itemId: string
  readonly name: string
  readonly kind?: ToolKind
  readonly command?: string
  readonly description?: string
  readonly status: ProjectedItemStatus
  readonly outputSummary?: string
  readonly timestamp: string
  readonly completedAt?: string
  readonly order: number
}

export interface ProjectedDiffLine {
  readonly kind: 'context' | 'addition' | 'deletion'
  readonly content: string
  readonly oldLineNumber?: number
  readonly newLineNumber?: number
}

export interface FileChangeReadModel {
  readonly id: string
  readonly turnId: string
  readonly itemId?: string
  readonly path: string
  readonly kind: FileChangeKind
  readonly additions: number
  readonly deletions: number
  readonly diffLines: readonly ProjectedDiffLine[]
  readonly timestamp: string
  readonly order: number
}

export interface PendingApprovalReadModel {
  readonly id: string
  readonly turnId: string
  readonly itemId?: string
  readonly kind: ApprovalKind
  readonly summary: string
  readonly requestedAt: string
}

export interface TerminalReadModel {
  readonly turnId?: string
  readonly itemId?: string
  readonly toolId?: string
  readonly command?: string
  readonly stream?: ToolOutputStream
  readonly text: string
  readonly truncated: boolean
  readonly updatedAt?: string
}

export interface ConversationHistoryReadModel {
  readonly evictedTurns: number
  readonly evictedMessages: number
  readonly evictedTools: number
  readonly evictedChanges: number
  readonly truncated: boolean
}

export interface ConversationReadModel {
  readonly id: string
  /** Available for hot runtime snapshots only; durable product reads keep paths private. */
  readonly cwd?: string
  readonly title: string
  readonly titleSource: ConversationTitleSource
  readonly pinnedAt?: string
  readonly archivedAt?: string
  readonly status: CanonicalConversationStatus
  readonly provider: ProviderId
  readonly model?: string
  readonly reasoning?: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly lastActivityAt: string
  readonly turns: readonly ConversationTurnReadModel[]
  /** Latest retained Turn. It remains available after terminal completion. */
  readonly currentTurn?: CurrentTurnReadModel
  readonly messages: readonly MessageReadModel[]
  readonly tools: readonly ToolReadModel[]
  readonly changes: readonly FileChangeReadModel[]
  readonly terminal: TerminalReadModel
  /** Host-owned retention boundary; presentation remains intentionally frozen. */
  readonly history: ConversationHistoryReadModel
  readonly pendingApprovals: readonly PendingApprovalReadModel[]
}

export interface ConversationProjection {
  readonly cursor: EventCursor
  readonly conversations: Readonly<Record<string, ConversationReadModel>>
}

export type ProjectionResetReason =
  | 'stream-reset'
  | 'epoch-mismatch'
  | 'sequence-gap'
  | 'out-of-order'
  | 'invalid-lifecycle'

export type ApplyHostEventResult =
  | {
      readonly kind: 'applied'
      readonly projection: ConversationProjection
    }
  | {
      readonly kind: 'duplicate'
      readonly projection: ConversationProjection
    }
  | {
      readonly kind: 'reset-required'
      readonly projection: ConversationProjection
      readonly reason: ProjectionResetReason
      readonly streamReason?: StreamResetReason
    }

/** Builds the replace boundary from all runtime history retained by the Host. */
export function projectSnapshot(
  snapshot: HostSnapshot,
): ConversationProjection {
  const activeTurns = new Map(
    snapshot.activeTurns.map((turn) => [String(turn.turnId), turn]),
  )
  const runtimes = new Map(
    (snapshot.conversationRuntimes ?? []).map((runtime) => [
      String(runtime.conversationId),
      runtime,
    ]),
  )
  const approvalsByConversation = new Map<string, PendingApprovalReadModel[]>()

  for (const approval of snapshot.pendingApprovals) {
    const conversationId = String(approval.conversationId)
    const approvals = approvalsByConversation.get(conversationId) ?? []
    approvals.push(projectPendingApproval(approval))
    approvalsByConversation.set(conversationId, approvals)
  }

  const conversations: Record<string, ConversationReadModel> = {}
  for (const record of snapshot.conversations) {
    const conversationId = String(record.conversationId)
    const runtime = runtimes.get(conversationId)
    const activeTurn =
      record.activeTurnId === undefined
        ? undefined
        : activeTurns.get(String(record.activeTurnId))
    conversations[conversationId] = projectConversationRecord(
      record,
      runtime,
      activeTurn,
      approvalsByConversation.get(conversationId) ?? [],
    )
  }

  return {
    cursor: { epoch: snapshot.epoch, seq: snapshot.currentSeq },
    conversations,
  }
}

/** Projects one provider-independent durable detail without hydrating Host runtime state. */
export function projectConversationDetail(
  detail: GetConversationResponse,
): ConversationReadModel {
  const activeTurn = detail.runtime.turns.find(
    (turn) => turn.status === 'running',
  )
  return projectConversationRecord(
    {
      ...detail.conversation,
      ...(activeTurn === undefined ? {} : { activeTurnId: activeTurn.turnId }),
    },
    detail.runtime,
    activeTurn,
    detail.pendingApprovals.map(projectPendingApproval),
  )
}

/** Adds a cold durable detail only when live runtime state does not already own it. */
export function includeConversationDetail(
  projection: ConversationProjection,
  detail: GetConversationResponse,
): ConversationProjection {
  const conversationId = String(detail.conversation.conversationId)
  const existing = projection.conversations[conversationId]
  if (existing !== undefined) {
    const next = mergeConversationSummary(existing, detail.conversation)
    if (sameConversationMetadata(existing, next)) return projection
    return {
      ...projection,
      conversations: {
        ...projection.conversations,
        [conversationId]: next,
      },
    }
  }
  return {
    ...projection,
    conversations: {
      ...projection.conversations,
      [conversationId]: projectConversationDetail(detail),
    },
  }
}

/**
 * Applies one validated Host envelope. Ordering failures never mutate or advance
 * the projection; the HostRuntime must reconnect or replace from a snapshot.
 */
export function applyHostEvent(
  projection: ConversationProjection,
  event: HostEventEnvelope,
): ApplyHostEventResult {
  if (event.type === 'stream.reset') {
    return resetRequired(projection, 'stream-reset', event.payload.reason)
  }

  if (event.epoch !== projection.cursor.epoch) {
    return resetRequired(projection, 'epoch-mismatch')
  }
  if (event.seq === projection.cursor.seq) {
    return { kind: 'duplicate', projection }
  }
  if (event.seq < projection.cursor.seq) {
    return resetRequired(projection, 'out-of-order')
  }
  if (event.seq !== projection.cursor.seq + 1) {
    return resetRequired(projection, 'sequence-gap')
  }

  if (
    event.type === 'attention.created' ||
    event.type === 'attention.resolved' ||
    event.type === 'machine.updated' ||
    event.type === 'machine.removed'
  ) {
    return appliedCursorOnly(projection, event)
  }

  if (event.type === 'conversation.updated') {
    const existing =
      projection.conversations[
        String(event.payload.conversation.conversationId)
      ]
    if (existing === undefined) return appliedCursorOnly(projection, event)
    return applied(
      projection,
      event,
      mergeConversationSummary(existing, event.payload.conversation),
    )
  }

  if (event.type === 'conversation.started') {
    const conversation = projectConversationRecord(
      event.payload.conversation,
      undefined,
      undefined,
      [],
    )
    return applied(projection, event, conversation)
  }

  const conversation = projection.conversations[String(event.conversationId)]
  if (conversation === undefined) {
    return resetRequired(projection, 'invalid-lifecycle')
  }

  switch (event.type) {
    case 'turn.started': {
      const turnId = String(event.payload.turn.turnId)
      if (conversation.turns.some((turn) => turn.id === turnId)) {
        return resetRequired(projection, 'invalid-lifecycle')
      }
      const turn = projectTurn(event.payload.turn, conversation.turns.length)
      const input = projectTurnInput(event.payload.turn)
      const next: ConversationReadModel = {
        ...conversation,
        status: 'running',
        updatedAt: event.timestamp,
        turns: [...conversation.turns, turn],
        currentTurn: turn,
        messages:
          input === undefined
            ? conversation.messages
            : [...conversation.messages, input],
      }
      return applied(projection, event, next)
    }

    case 'message.delta': {
      if (!belongsToRunningTurn(conversation, event.turnId)) {
        return resetRequired(projection, 'invalid-lifecycle')
      }
      const turnId = String(event.turnId)
      const itemId = String(event.itemId)
      const id = itemKey(turnId, itemId)
      const index = conversation.messages.findIndex(
        (message) => message.id === id,
      )
      let messages: readonly MessageReadModel[]
      if (index < 0) {
        messages = [
          ...conversation.messages,
          {
            id,
            turnId,
            itemId,
            author: 'agent',
            body: retainUtf8Head(event.payload.delta, MESSAGE_OUTPUT_MAX_BYTES)
              .text,
            status: 'running',
            timestamp: event.timestamp,
            order: event.seq,
          },
        ]
      } else {
        const current = conversation.messages[index]
        if (
          current === undefined ||
          current.author !== 'agent' ||
          current.status !== 'running'
        ) {
          return resetRequired(projection, 'invalid-lifecycle')
        }
        messages = replaceAt(conversation.messages, index, {
          ...current,
          body: retainUtf8Head(
            `${current.body}${event.payload.delta}`,
            MESSAGE_OUTPUT_MAX_BYTES,
          ).text,
          timestamp: event.timestamp,
        })
      }
      return applied(projection, event, {
        ...conversation,
        updatedAt: event.timestamp,
        messages,
      })
    }

    case 'message.completed': {
      if (!belongsToRunningTurn(conversation, event.turnId)) {
        return resetRequired(projection, 'invalid-lifecycle')
      }
      const turnId = String(event.turnId)
      const itemId = String(event.itemId)
      const id = itemKey(turnId, itemId)
      const index = conversation.messages.findIndex(
        (message) => message.id === id,
      )
      const completed: MessageReadModel = {
        id,
        turnId,
        itemId,
        author: 'agent',
        body: retainUtf8Head(event.payload.message, MESSAGE_OUTPUT_MAX_BYTES)
          .text,
        status: 'completed',
        timestamp: event.timestamp,
        order:
          index < 0
            ? event.seq
            : (conversation.messages[index]?.order ?? event.seq),
      }
      const messages =
        index < 0
          ? [...conversation.messages, completed]
          : replaceAt(conversation.messages, index, completed)
      return applied(projection, event, {
        ...conversation,
        updatedAt: event.timestamp,
        messages,
      })
    }

    case 'tool.started': {
      if (!belongsToRunningTurn(conversation, event.turnId)) {
        return resetRequired(projection, 'invalid-lifecycle')
      }
      const turnId = String(event.turnId)
      const itemId = String(event.itemId)
      const id = itemKey(turnId, itemId)
      const index = conversation.tools.findIndex((tool) => tool.id === id)
      const tool: ToolReadModel = {
        id,
        turnId,
        itemId,
        name: event.payload.name,
        ...(event.payload.kind === undefined
          ? {}
          : { kind: event.payload.kind }),
        ...(event.payload.command === undefined
          ? {}
          : { command: event.payload.command }),
        ...(event.payload.summary === undefined
          ? {}
          : { description: event.payload.summary }),
        status: 'running',
        timestamp: event.timestamp,
        order:
          index < 0
            ? event.seq
            : (conversation.tools[index]?.order ?? event.seq),
      }
      const tools =
        index < 0
          ? [...conversation.tools, tool]
          : replaceAt(conversation.tools, index, tool)
      return applied(projection, event, {
        ...conversation,
        updatedAt: event.timestamp,
        tools,
        terminal: {
          turnId,
          itemId,
          toolId: id,
          command: event.payload.command ?? event.payload.name,
          text: '',
          truncated: false,
          updatedAt: event.timestamp,
        },
      })
    }

    case 'tool.output': {
      if (!belongsToRunningTurn(conversation, event.turnId)) {
        return resetRequired(projection, 'invalid-lifecycle')
      }
      const turnId = String(event.turnId)
      const itemId = String(event.itemId)
      const id = itemKey(turnId, itemId)
      const index = conversation.tools.findIndex((tool) => tool.id === id)
      const currentTool = index < 0 ? undefined : conversation.tools[index]
      if (currentTool !== undefined && currentTool.status !== 'running') {
        return resetRequired(projection, 'invalid-lifecycle')
      }

      const baseTerminal =
        conversation.terminal.toolId === id
          ? conversation.terminal
          : {
              turnId,
              itemId,
              toolId: id,
              command:
                currentTool?.command ??
                currentTool?.name ??
                'Command execution',
              text: '',
              truncated: false,
            }
      const terminal = appendTerminalOutput(
        baseTerminal,
        event.payload.output,
        event.payload.stream,
        event.timestamp,
      )
      const outputSummary = summarizeOutput(terminal.text)
      const tool: ToolReadModel = {
        id,
        turnId,
        itemId,
        name: currentTool?.name ?? 'Command execution',
        ...(currentTool?.kind === undefined ? {} : { kind: currentTool.kind }),
        ...(currentTool?.command === undefined
          ? {}
          : { command: currentTool.command }),
        ...(currentTool?.description === undefined
          ? {}
          : { description: currentTool.description }),
        status: 'running',
        ...(outputSummary === undefined ? {} : { outputSummary }),
        timestamp: currentTool?.timestamp ?? event.timestamp,
        order: currentTool?.order ?? event.seq,
      }
      const tools =
        index < 0
          ? [...conversation.tools, tool]
          : replaceAt(conversation.tools, index, tool)
      return applied(projection, event, {
        ...conversation,
        updatedAt: event.timestamp,
        tools,
        terminal,
      })
    }

    case 'tool.completed': {
      if (!belongsToRunningTurn(conversation, event.turnId)) {
        return resetRequired(projection, 'invalid-lifecycle')
      }
      const turnId = String(event.turnId)
      const itemId = String(event.itemId)
      const id = itemKey(turnId, itemId)
      const index = conversation.tools.findIndex((tool) => tool.id === id)
      const current = index < 0 ? undefined : conversation.tools[index]
      const outputSummary =
        event.payload.summary === undefined
          ? current?.outputSummary
          : summarizeOutput(event.payload.summary)
      const tool: ToolReadModel = {
        id,
        turnId,
        itemId,
        name: event.payload.name,
        ...(event.payload.kind === undefined && current?.kind === undefined
          ? {}
          : { kind: event.payload.kind ?? current?.kind }),
        ...(event.payload.command === undefined &&
        current?.command === undefined
          ? {}
          : { command: event.payload.command ?? current?.command }),
        ...(current?.description === undefined
          ? {}
          : { description: current.description }),
        status: event.payload.success === false ? 'failed' : 'completed',
        ...(outputSummary === undefined ? {} : { outputSummary }),
        timestamp: current?.timestamp ?? event.timestamp,
        completedAt: event.timestamp,
        order: current?.order ?? event.seq,
      }
      const tools =
        index < 0
          ? [...conversation.tools, tool]
          : replaceAt(conversation.tools, index, tool)
      const terminal = completeTerminal(
        conversation.terminal,
        id,
        event.payload.command ?? current?.command ?? event.payload.name,
        event.timestamp,
      )
      return applied(projection, event, {
        ...conversation,
        updatedAt: event.timestamp,
        tools,
        terminal,
      })
    }

    case 'file.changed': {
      if (!belongsToRunningTurn(conversation, event.turnId)) {
        return resetRequired(projection, 'invalid-lifecycle')
      }
      const turnId = String(event.turnId)
      const itemId =
        event.itemId === undefined ? undefined : String(event.itemId)
      const boundedDiff =
        event.payload.diff === undefined
          ? undefined
          : retainUtf8Head(event.payload.diff, MESSAGE_OUTPUT_MAX_BYTES).text
      const parsed = parseUnifiedDiff(boundedDiff)
      const id = changeKey(turnId, itemId, event.payload.path)
      const index = conversation.changes.findIndex((change) => change.id === id)
      const change: FileChangeReadModel = {
        id,
        turnId,
        ...(itemId === undefined ? {} : { itemId }),
        path: event.payload.path,
        kind: event.payload.kind,
        additions: event.payload.additions ?? parsed.additions,
        deletions: event.payload.deletions ?? parsed.deletions,
        diffLines: parsed.lines,
        timestamp: event.timestamp,
        order:
          index < 0
            ? event.seq
            : (conversation.changes[index]?.order ?? event.seq),
      }
      const changes =
        index < 0
          ? [...conversation.changes, change]
          : replaceAt(conversation.changes, index, change)
      return applied(projection, event, {
        ...conversation,
        updatedAt: event.timestamp,
        changes,
      })
    }

    case 'approval.requested': {
      if (!belongsToRunningTurn(conversation, event.turnId)) {
        return resetRequired(projection, 'invalid-lifecycle')
      }
      const approval = projectPendingApproval(event.payload.approval)
      const index = conversation.pendingApprovals.findIndex(
        (candidate) => candidate.id === approval.id,
      )
      const pendingApprovals =
        index < 0
          ? [...conversation.pendingApprovals, approval]
          : replaceAt(conversation.pendingApprovals, index, approval)
      return applied(projection, event, {
        ...conversation,
        status: 'waiting',
        updatedAt: event.timestamp,
        pendingApprovals,
      })
    }

    case 'approval.resolved': {
      if (!belongsToRunningTurn(conversation, event.turnId)) {
        return resetRequired(projection, 'invalid-lifecycle')
      }
      const id = String(event.payload.approval.approvalId)
      if (
        !conversation.pendingApprovals.some((approval) => approval.id === id)
      ) {
        return resetRequired(projection, 'invalid-lifecycle')
      }
      const pendingApprovals = conversation.pendingApprovals.filter(
        (approval) => approval.id !== id,
      )
      return applied(projection, event, {
        ...conversation,
        status: pendingApprovals.length > 0 ? 'waiting' : 'running',
        updatedAt: event.timestamp,
        pendingApprovals,
      })
    }

    case 'turn.completed': {
      const turnIndex = runningTurnIndex(conversation, event.turnId)
      if (turnIndex < 0) {
        return resetRequired(projection, 'invalid-lifecycle')
      }
      const current = conversation.turns[turnIndex]
      if (current === undefined) {
        return resetRequired(projection, 'invalid-lifecycle')
      }
      const turn: ConversationTurnReadModel = {
        ...current,
        status: 'completed',
        completedAt: event.timestamp,
        ...(event.payload.finalMessage === undefined
          ? {}
          : { finalMessage: event.payload.finalMessage }),
      }
      const turnId = String(event.turnId)
      return applied(projection, event, {
        ...conversation,
        status: 'completed',
        updatedAt: event.timestamp,
        turns: replaceAt(conversation.turns, turnIndex, turn),
        currentTurn: turn,
        messages: completeMessages(
          conversation.messages,
          turnId,
          event.payload.finalMessage,
          event.timestamp,
        ),
        tools: settleRunningToolsForTurn(
          conversation.tools,
          turnId,
          'completed',
          event.timestamp,
        ),
        pendingApprovals: conversation.pendingApprovals.filter(
          (approval) => approval.turnId !== turnId,
        ),
      })
    }

    case 'turn.failed': {
      const turnIndex = runningTurnIndex(conversation, event.turnId)
      if (turnIndex < 0) {
        return resetRequired(projection, 'invalid-lifecycle')
      }
      const current = conversation.turns[turnIndex]
      if (current === undefined) {
        return resetRequired(projection, 'invalid-lifecycle')
      }
      const turnId = String(event.turnId)
      const turn: ConversationTurnReadModel = {
        ...current,
        status: 'failed',
        completedAt: event.timestamp,
        error: event.payload.error,
      }
      return applied(projection, event, {
        ...conversation,
        status: 'failed',
        updatedAt: event.timestamp,
        turns: replaceAt(conversation.turns, turnIndex, turn),
        currentTurn: turn,
        messages: settleRunningMessagesForTurn(
          conversation.messages,
          turnId,
          'failed',
          event.timestamp,
        ),
        tools: settleRunningToolsForTurn(
          conversation.tools,
          turnId,
          'failed',
          event.timestamp,
        ),
        pendingApprovals: conversation.pendingApprovals.filter(
          (approval) => approval.turnId !== turnId,
        ),
      })
    }

    case 'turn.interrupted': {
      const turnIndex = runningTurnIndex(conversation, event.turnId)
      if (turnIndex < 0) {
        return resetRequired(projection, 'invalid-lifecycle')
      }
      const current = conversation.turns[turnIndex]
      if (current === undefined) {
        return resetRequired(projection, 'invalid-lifecycle')
      }
      const turnId = String(event.turnId)
      const turn: ConversationTurnReadModel = {
        ...current,
        status: 'interrupted',
        completedAt: event.timestamp,
      }
      return applied(projection, event, {
        ...conversation,
        status: 'idle',
        updatedAt: event.timestamp,
        turns: replaceAt(conversation.turns, turnIndex, turn),
        currentTurn: turn,
        messages: settleRunningMessagesForTurn(
          conversation.messages,
          turnId,
          'idle',
          event.timestamp,
        ),
        tools: settleRunningToolsForTurn(
          conversation.tools,
          turnId,
          'idle',
          event.timestamp,
        ),
        pendingApprovals: conversation.pendingApprovals.filter(
          (approval) => approval.turnId !== turnId,
        ),
      })
    }
  }
}

type SnapshotRuntime = NonNullable<HostSnapshot['conversationRuntimes']>[number]
type SnapshotTurn = HostSnapshot['activeTurns'][number]
type ProjectionConversationRecord = Omit<
  HostSnapshot['conversations'][number],
  'cwd'
> & { readonly cwd?: string }

function projectConversationRecord(
  record: ProjectionConversationRecord,
  runtime: SnapshotRuntime | undefined,
  activeTurn: SnapshotTurn | undefined,
  pendingApprovals: readonly PendingApprovalReadModel[],
): ConversationReadModel {
  const retainedTurns = runtime?.turns ?? (activeTurn ? [activeTurn] : [])
  const turns = retainedTurns.map(projectTurn)
  const messages = projectSnapshotMessages(runtime, retainedTurns)
  const tools = (runtime?.tools ?? []).map(projectSnapshotTool).sort(byOrder)
  const changes = (runtime?.changes ?? [])
    .map(projectSnapshotChange)
    .sort(byOrder)
  const terminal = projectSnapshotTerminal(runtime?.terminal)
  const activeTurnId =
    record.activeTurnId === undefined ? undefined : String(record.activeTurnId)
  const currentTurn =
    turns.find((turn) => turn.id === activeTurnId) ?? turns.at(-1)

  return {
    id: String(record.conversationId),
    ...(record.cwd === undefined ? {} : { cwd: record.cwd }),
    title: record.title ?? titleFromCwd(record.cwd ?? ''),
    titleSource: record.titleSource ?? 'generated',
    ...(record.pinnedAt === undefined ? {} : { pinnedAt: record.pinnedAt }),
    ...(record.archivedAt === undefined
      ? {}
      : { archivedAt: record.archivedAt }),
    status: record.status,
    provider: record.provider,
    ...(record.model === undefined ? {} : { model: record.model }),
    ...(record.reasoning === undefined ? {} : { reasoning: record.reasoning }),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastActivityAt: record.lastActivityAt ?? record.updatedAt,
    turns,
    ...(currentTurn === undefined ? {} : { currentTurn }),
    messages,
    tools,
    changes,
    terminal,
    history: runtime?.history ?? emptyHistory(),
    pendingApprovals,
  }
}

function mergeConversationSummary(
  conversation: ConversationReadModel,
  summary: ConversationSummary,
): ConversationReadModel {
  const next: ConversationReadModel = {
    ...conversation,
    title: summary.title,
    titleSource: summary.titleSource,
    ...(summary.pinnedAt === undefined ? {} : { pinnedAt: summary.pinnedAt }),
    ...(summary.archivedAt === undefined
      ? {}
      : { archivedAt: summary.archivedAt }),
    status: summary.status,
    provider: summary.provider,
    ...(summary.model === undefined ? {} : { model: summary.model }),
    ...(summary.reasoning === undefined
      ? {}
      : { reasoning: summary.reasoning }),
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    lastActivityAt: summary.lastActivityAt,
  }

  const mutableOrganization = next as {
    pinnedAt?: string
    archivedAt?: string
  }
  if (summary.pinnedAt === undefined) delete mutableOrganization.pinnedAt
  if (summary.archivedAt === undefined) delete mutableOrganization.archivedAt
  return next
}

function sameConversationMetadata(
  left: ConversationReadModel,
  right: ConversationReadModel,
): boolean {
  return (
    left.title === right.title &&
    left.titleSource === right.titleSource &&
    left.pinnedAt === right.pinnedAt &&
    left.archivedAt === right.archivedAt &&
    left.status === right.status &&
    left.provider === right.provider &&
    left.model === right.model &&
    left.reasoning === right.reasoning &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt &&
    left.lastActivityAt === right.lastActivityAt
  )
}

function emptyHistory(): ConversationHistoryReadModel {
  return {
    evictedTurns: 0,
    evictedMessages: 0,
    evictedTools: 0,
    evictedChanges: 0,
    truncated: false,
  }
}

function projectTurn(
  turn: SnapshotTurn,
  order: number,
): ConversationTurnReadModel {
  return {
    id: String(turn.turnId),
    status: turn.status,
    startedAt: turn.startedAt,
    ...(turn.completedAt === undefined
      ? {}
      : { completedAt: turn.completedAt }),
    ...(turn.finalMessage === undefined
      ? {}
      : { finalMessage: turn.finalMessage }),
    ...(turn.error === undefined ? {} : { error: turn.error }),
    order,
  }
}

function projectTurnInput(turn: SnapshotTurn): MessageReadModel | undefined {
  if (turn.input === undefined) return undefined
  return {
    id: `${String(turn.turnId)}:input`,
    turnId: String(turn.turnId),
    author: 'user',
    body: turn.input.text,
    status: 'completed',
    timestamp: turn.input.timestamp,
    order: USER_INPUT_ORDER,
  }
}

function projectSnapshotMessages(
  runtime: SnapshotRuntime | undefined,
  turns: readonly SnapshotTurn[],
): readonly MessageReadModel[] {
  const agentMessages = (runtime?.messages ?? []).map((message) => ({
    id: itemKey(String(message.turnId), String(message.itemId)),
    turnId: String(message.turnId),
    itemId: String(message.itemId),
    author: 'agent' as const,
    body: message.text,
    status: projectRuntimeItemStatus(message.status),
    timestamp: message.timestamp,
    order: message.order,
  }))

  let messages: readonly MessageReadModel[] = turns.flatMap((turn) => {
    const turnId = String(turn.turnId)
    const input = projectTurnInput(turn)
    const retained = agentMessages
      .filter((message) => message.turnId === turnId)
      .sort(byOrder)
    return input === undefined ? retained : [input, ...retained]
  })

  for (const turn of turns) {
    if (turn.status !== 'completed') continue
    messages = completeMessages(
      messages,
      String(turn.turnId),
      turn.finalMessage,
      turn.completedAt ?? turn.startedAt,
    )
  }
  return messages
}

function projectSnapshotTool(
  tool: SnapshotRuntime['tools'][number],
): ToolReadModel {
  const turnId = String(tool.turnId)
  const itemId = String(tool.itemId)
  return {
    id: itemKey(turnId, itemId),
    turnId,
    itemId,
    name: tool.name,
    ...(tool.kind === undefined ? {} : { kind: tool.kind }),
    ...(tool.command === undefined ? {} : { command: tool.command }),
    ...(tool.summary === undefined ? {} : { description: tool.summary }),
    status: projectRuntimeItemStatus(tool.status),
    ...(tool.outputSummary === undefined
      ? {}
      : { outputSummary: summarizeOutput(tool.outputSummary) }),
    timestamp: tool.startedAt,
    ...(tool.completedAt === undefined
      ? {}
      : { completedAt: tool.completedAt }),
    order: tool.order,
  }
}

function projectSnapshotChange(
  change: SnapshotRuntime['changes'][number],
): FileChangeReadModel {
  const turnId = String(change.turnId)
  const itemId = change.itemId === undefined ? undefined : String(change.itemId)
  const parsed = parseUnifiedDiff(change.diff)
  return {
    id: changeKey(turnId, itemId, change.path),
    turnId,
    ...(itemId === undefined ? {} : { itemId }),
    path: change.path,
    kind: change.kind,
    additions: change.additions ?? parsed.additions,
    deletions: change.deletions ?? parsed.deletions,
    diffLines: parsed.lines,
    timestamp: change.timestamp,
    order: change.order,
  }
}

function projectSnapshotTerminal(
  terminal: SnapshotRuntime['terminal'] | undefined,
): TerminalReadModel {
  if (terminal === undefined) return emptyTerminal()
  const turnId =
    terminal.turnId === undefined ? undefined : String(terminal.turnId)
  const itemId =
    terminal.itemId === undefined ? undefined : String(terminal.itemId)
  const bounded = retainUtf8Tail(terminal.text, TERMINAL_OUTPUT_MAX_BYTES)
  return {
    ...(turnId === undefined ? {} : { turnId }),
    ...(itemId === undefined ? {} : { itemId }),
    ...(turnId === undefined || itemId === undefined
      ? {}
      : { toolId: itemKey(turnId, itemId) }),
    ...(terminal.command === undefined ? {} : { command: terminal.command }),
    ...(terminal.stream === undefined ? {} : { stream: terminal.stream }),
    text: bounded.text,
    truncated: terminal.truncated || bounded.truncated,
    ...(terminal.updatedAt === undefined
      ? {}
      : { updatedAt: terminal.updatedAt }),
  }
}

function projectRuntimeItemStatus(
  status: 'running' | 'completed' | 'failed' | 'interrupted',
): ProjectedItemStatus {
  return status === 'interrupted' ? 'idle' : status
}

function projectPendingApproval(
  approval: HostSnapshot['pendingApprovals'][number],
): PendingApprovalReadModel {
  return {
    id: String(approval.approvalId),
    turnId: String(approval.turnId),
    ...(approval.itemId === undefined
      ? {}
      : { itemId: String(approval.itemId) }),
    kind: approval.kind,
    summary: approval.summary,
    requestedAt: approval.requestedAt,
  }
}

function titleFromCwd(cwd: string): string {
  const withoutTrailingSeparators = cwd.replace(/[\\/]+$/u, '')
  return withoutTrailingSeparators.split(/[\\/]/u).at(-1) || cwd
}

function itemKey(turnId: string, itemId: string): string {
  return `${turnId}:${itemId}`
}

function changeKey(
  turnId: string,
  itemId: string | undefined,
  path: string,
): string {
  return `${turnId}:${itemId ?? 'no-item'}:${path}`
}

function belongsToRunningTurn(
  conversation: ConversationReadModel,
  turnId: string,
): boolean {
  return runningTurnIndex(conversation, turnId) >= 0
}

function runningTurnIndex(
  conversation: ConversationReadModel,
  turnId: string,
): number {
  const id = String(turnId)
  return conversation.turns.findIndex(
    (turn) => turn.id === id && turn.status === 'running',
  )
}

function applied(
  projection: ConversationProjection,
  event: Exclude<HostEventEnvelope, { readonly type: 'stream.reset' }>,
  conversation: ConversationReadModel,
): ApplyHostEventResult {
  return {
    kind: 'applied',
    projection: {
      cursor: { epoch: event.epoch, seq: event.seq },
      conversations: {
        ...projection.conversations,
        [String(event.conversationId)]: conversation,
      },
    },
  }
}

function appliedCursorOnly(
  projection: ConversationProjection,
  event: Exclude<HostEventEnvelope, { readonly type: 'stream.reset' }>,
): ApplyHostEventResult {
  return {
    kind: 'applied',
    projection: {
      cursor: { epoch: event.epoch, seq: event.seq },
      conversations: projection.conversations,
    },
  }
}

function resetRequired(
  projection: ConversationProjection,
  reason: ProjectionResetReason,
  streamReason?: StreamResetReason,
): ApplyHostEventResult {
  return {
    kind: 'reset-required',
    projection,
    reason,
    ...(streamReason === undefined ? {} : { streamReason }),
  }
}

function replaceAt<T>(
  values: readonly T[],
  index: number,
  replacement: T,
): readonly T[] {
  return values.map((value, candidateIndex) =>
    candidateIndex === index ? replacement : value,
  )
}

function settleRunningMessagesForTurn(
  items: readonly MessageReadModel[],
  turnId: string,
  status: Exclude<ProjectedItemStatus, 'running'>,
  timestamp: string,
): readonly MessageReadModel[] {
  let changed = false
  const settled = items.map((item) => {
    if (item.turnId !== turnId || item.status !== 'running') return item
    changed = true
    return { ...item, status, timestamp }
  })
  return changed ? settled : items
}

function settleRunningToolsForTurn(
  items: readonly ToolReadModel[],
  turnId: string,
  status: Exclude<ProjectedItemStatus, 'running'>,
  completedAt: string,
): readonly ToolReadModel[] {
  let changed = false
  const settled = items.map((item) => {
    if (item.turnId !== turnId || item.status !== 'running') return item
    changed = true
    return { ...item, status, completedAt }
  })
  return changed ? settled : items
}

function completeMessages(
  messages: readonly MessageReadModel[],
  turnId: string,
  finalMessage: string | undefined,
  timestamp: string,
): readonly MessageReadModel[] {
  let completed = settleRunningMessagesForTurn(
    messages,
    turnId,
    'completed',
    timestamp,
  )
  if (finalMessage === undefined || finalMessage.length === 0) return completed
  if (
    completed.some(
      (message) =>
        message.turnId === turnId &&
        message.author === 'agent' &&
        message.body === finalMessage,
    )
  ) {
    return completed
  }

  const lastRunningIndex = messages.findLastIndex(
    (message) =>
      message.turnId === turnId &&
      message.author === 'agent' &&
      message.status === 'running',
  )
  if (lastRunningIndex >= 0) {
    const current = completed[lastRunningIndex]
    if (current !== undefined) {
      completed = replaceAt(completed, lastRunningIndex, {
        ...current,
        body: finalMessage,
        status: 'completed',
        timestamp,
      })
      return completed
    }
  }

  return [
    ...completed,
    {
      id: `${turnId}:final`,
      turnId,
      author: 'agent',
      body: finalMessage,
      status: 'completed',
      timestamp,
      order: FINAL_MESSAGE_ORDER,
    },
  ]
}

function emptyTerminal(): TerminalReadModel {
  return { text: '', truncated: false }
}

function appendTerminalOutput(
  terminal: TerminalReadModel,
  output: string,
  stream: ToolOutputStream | undefined,
  updatedAt: string,
): TerminalReadModel {
  const bounded = retainUtf8Tail(
    `${terminal.text}${output}`,
    TERMINAL_OUTPUT_MAX_BYTES,
  )
  return {
    ...terminal,
    ...(stream === undefined ? {} : { stream }),
    text: bounded.text,
    truncated: terminal.truncated || bounded.truncated,
    updatedAt,
  }
}

function completeTerminal(
  terminal: TerminalReadModel,
  toolId: string,
  command: string,
  updatedAt: string,
): TerminalReadModel {
  if (terminal.toolId !== toolId) return terminal
  return {
    ...terminal,
    command,
    updatedAt,
  }
}

function retainUtf8Tail(
  text: string,
  maxBytes: number,
): { readonly text: string; readonly truncated: boolean } {
  const bytes = encoder.encode(text)
  if (bytes.byteLength <= maxBytes) return { text, truncated: false }

  let start = bytes.byteLength - maxBytes
  while (start < bytes.byteLength && isUtf8ContinuationByte(bytes[start])) {
    start += 1
  }
  return {
    text: decoder.decode(bytes.subarray(start)),
    truncated: true,
  }
}

function retainUtf8Head(
  text: string,
  maxBytes: number,
): { readonly text: string; readonly truncated: boolean } {
  const bytes = encoder.encode(text)
  if (bytes.byteLength <= maxBytes) return { text, truncated: false }

  let end = maxBytes
  while (end > 0 && isUtf8ContinuationByte(bytes[end])) end -= 1
  return {
    text: decoder.decode(bytes.subarray(0, end)),
    truncated: true,
  }
}

function isUtf8ContinuationByte(value: number | undefined): boolean {
  return value !== undefined && (value & 0xc0) === 0x80
}

function summarizeOutput(output: string): string | undefined {
  const normalized = output.trimEnd()
  if (normalized.length === 0) return undefined
  const lastLine = normalized.split(/\r?\n/u).at(-1)?.trim()
  if (lastLine === undefined || lastLine.length === 0) return undefined
  return lastLine.slice(0, TOOL_OUTPUT_SUMMARY_MAX_CHARACTERS)
}

function byOrder<T extends { readonly order: number }>(
  left: T,
  right: T,
): number {
  return left.order - right.order
}

function parseUnifiedDiff(diff: string | undefined): {
  readonly lines: readonly ProjectedDiffLine[]
  readonly additions: number
  readonly deletions: number
} {
  if (diff === undefined || diff.length === 0) {
    return { lines: [], additions: 0, deletions: 0 }
  }

  const lines: ProjectedDiffLine[] = []
  let additions = 0
  let deletions = 0
  let oldLineNumber: number | undefined
  let newLineNumber: number | undefined

  for (const line of diff.split(/\r?\n/u)) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(line)
    if (hunk !== null) {
      oldLineNumber = Number(hunk[1])
      newLineNumber = Number(hunk[2])
      continue
    }
    if (
      line.startsWith('diff --git ') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line === '\\ No newline at end of file'
    ) {
      continue
    }
    if (line.startsWith('+')) {
      additions += 1
      lines.push({
        kind: 'addition',
        content: line.slice(1),
        ...(newLineNumber === undefined ? {} : { newLineNumber }),
      })
      if (newLineNumber !== undefined) newLineNumber += 1
      continue
    }
    if (line.startsWith('-')) {
      deletions += 1
      lines.push({
        kind: 'deletion',
        content: line.slice(1),
        ...(oldLineNumber === undefined ? {} : { oldLineNumber }),
      })
      if (oldLineNumber !== undefined) oldLineNumber += 1
      continue
    }
    if (line.startsWith(' ')) {
      lines.push({
        kind: 'context',
        content: line.slice(1),
        ...(oldLineNumber === undefined ? {} : { oldLineNumber }),
        ...(newLineNumber === undefined ? {} : { newLineNumber }),
      })
      if (oldLineNumber !== undefined) oldLineNumber += 1
      if (newLineNumber !== undefined) newLineNumber += 1
    }
  }

  return { lines, additions, deletions }
}

import {
  ApprovalRecordSchema,
  ConversationFileChangeRecordSchema,
  conversationRuntimeWireLimits,
  ConversationMessageRecordSchema,
  ConversationRecordSchema,
  ConversationRuntimeSnapshotSchema,
  ConversationTerminalRecordSchema,
  ConversationToolRecordSchema,
  TimestampSchema,
  TurnRecordSchema,
  type ApprovalRecord,
  type ConversationId,
  type ConversationRecord,
  type ConversationRuntimeSnapshot,
  type Timestamp,
  type TurnId,
  type TurnRecord,
} from '@codetether/protocol'

import {
  type ConversationStore,
  type DurableConversation,
  type DurableTurnSnapshot,
} from './conversation-store.js'

export const DURABLE_TURN_SNAPSHOT_VERSION = 1

export interface DurableApprovalHistoryRecord {
  readonly record: ApprovalRecord
  readonly lifecycle: 'pending' | 'resolved' | 'expired'
  readonly expiredAt?: Timestamp
  readonly reason?: 'host_restart'
}

export interface DurableTurnPresentationV1 {
  readonly turn: TurnRecord
  readonly messages: ConversationRuntimeSnapshot['messages']
  readonly tools: ConversationRuntimeSnapshot['tools']
  readonly changes: ConversationRuntimeSnapshot['changes']
  readonly terminal?: ConversationRuntimeSnapshot['terminal']
  readonly approvals: readonly DurableApprovalHistoryRecord[]
  readonly presentationTruncated: boolean
  readonly interruptionReason?: 'host_restart'
}

export interface RestoredDurableConversation {
  readonly record: ConversationRecord
  readonly providerThreadId: string
  readonly runtime: ConversationRuntimeSnapshot
  readonly providerTurns: ReadonlyArray<{
    readonly turnId: TurnId
    readonly providerTurnId: string
  }>
  readonly expiredApprovals: number
}

export const DURABLE_CONVERSATION_DETAIL_DEFAULT_TURNS = 20
export const DURABLE_CONVERSATION_DETAIL_DEFAULT_ENTRIES = 512

export interface DurableConversationDetailOptions {
  readonly maxTurns?: number
  readonly maxEntries?: number
}

export interface DurableConversationDetail {
  readonly record: ConversationRecord
  readonly runtime: ConversationRuntimeSnapshot
  readonly approvals: readonly DurableApprovalHistoryRecord[]
  readonly history: {
    readonly totalTurns: number
    readonly retainedTurns: number
    readonly hasOlder: boolean
  }
}

export interface RestoreDurableOptions {
  readonly maxConversations: number
  readonly maxTurns: number
  readonly maxEntries: number
  readonly now: Timestamp
}

export function initialTurnPresentation(
  turn: TurnRecord,
): DurableTurnPresentationV1 {
  return {
    turn: TurnRecordSchema.parse(turn),
    messages: [],
    tools: [],
    changes: [],
    approvals: [],
    presentationTruncated: false,
  }
}

export function captureTurnPresentation(
  runtime: ConversationRuntimeSnapshot,
  turnId: TurnId,
  approvalRecords: readonly ApprovalRecord[],
): DurableTurnPresentationV1 {
  const turn = runtime.turns.find((candidate) => candidate.turnId === turnId)
  if (turn === undefined) {
    throw new Error(`Runtime does not retain Turn ${String(turnId)}`)
  }
  const approvals = approvalRecords
    .filter((approval) => approval.turnId === turnId)
    .map((record) => ({
      record: ApprovalRecordSchema.parse(record),
      lifecycle: record.status,
    })) satisfies DurableApprovalHistoryRecord[]
  return parseDurableTurnPresentation({
    turn,
    messages: runtime.messages.filter((message) => message.turnId === turnId),
    tools: runtime.tools.filter((tool) => tool.turnId === turnId),
    changes: runtime.changes.filter((change) => change.turnId === turnId),
    ...(runtime.terminal.turnId === turnId
      ? { terminal: runtime.terminal }
      : {}),
    approvals,
    presentationTruncated: runtime.history.truncated,
  })
}

export function parseDurableTurnPresentation(
  value: unknown,
): DurableTurnPresentationV1 {
  const record = requireRecord(value, 'Turn snapshot')
  assertKnownKeys(record, [
    'turn',
    'messages',
    'tools',
    'changes',
    'terminal',
    'approvals',
    'presentationTruncated',
    'interruptionReason',
  ])
  if (!Array.isArray(record.messages)) {
    throw new Error('Turn snapshot messages must be an array')
  }
  if (!Array.isArray(record.tools)) {
    throw new Error('Turn snapshot tools must be an array')
  }
  if (!Array.isArray(record.changes)) {
    throw new Error('Turn snapshot changes must be an array')
  }
  if (!Array.isArray(record.approvals)) {
    throw new Error('Turn snapshot approvals must be an array')
  }
  if (typeof record.presentationTruncated !== 'boolean') {
    throw new Error('Turn snapshot presentationTruncated must be boolean')
  }
  if (
    record.interruptionReason !== undefined &&
    record.interruptionReason !== 'host_restart'
  ) {
    throw new Error('Turn snapshot interruption reason is unsupported')
  }
  return {
    turn: TurnRecordSchema.parse(record.turn),
    messages: record.messages.map((message) =>
      ConversationMessageRecordSchema.parse(message),
    ),
    tools: record.tools.map((tool) => ConversationToolRecordSchema.parse(tool)),
    changes: record.changes.map((change) =>
      ConversationFileChangeRecordSchema.parse(change),
    ),
    ...(record.terminal === undefined
      ? {}
      : { terminal: ConversationTerminalRecordSchema.parse(record.terminal) }),
    approvals: record.approvals.map(parseDurableApproval),
    presentationTruncated: record.presentationTruncated,
    ...(record.interruptionReason === undefined
      ? {}
      : { interruptionReason: record.interruptionReason }),
  }
}

/**
 * Reconciles state that cannot still be live after a Host process restart.
 * Provider approval request handles are intentionally never reconstructed.
 */
export function reconcileHostRestart(
  store: ConversationStore,
  nowValue: Timestamp,
): void {
  const now = TimestampSchema.parse(nowValue)
  store.runInTransaction(() => {
    store.expireOpenApprovalAttentionItems(now)
    const affectedConversations = new Set<string>()
    for (const durable of store.listIncompleteTurns()) {
      const presentation = parseSnapshot(durable)
      const turn: TurnRecord = {
        turnId: presentation.turn.turnId,
        conversationId: presentation.turn.conversationId,
        status: 'interrupted',
        ...(presentation.turn.input === undefined
          ? {}
          : { input: presentation.turn.input }),
        startedAt: presentation.turn.startedAt,
        completedAt: now,
      }
      const interrupted = parseDurableTurnPresentation({
        ...presentation,
        turn,
        messages: presentation.messages.map((message) =>
          message.status === 'running'
            ? { ...message, status: 'interrupted' }
            : message,
        ),
        tools: presentation.tools.map((tool) =>
          tool.status === 'running'
            ? {
                ...tool,
                status: 'interrupted',
                completedAt: now,
              }
            : tool,
        ),
        approvals: presentation.approvals.map((approval) =>
          approval.lifecycle === 'pending'
            ? {
                ...approval,
                lifecycle: 'expired',
                expiredAt: now,
                reason: 'host_restart',
              }
            : approval,
        ),
        interruptionReason: 'host_restart',
      })
      store.updateTurn({
        ...durable,
        status: 'interrupted',
        completedAt: now,
        snapshot: interrupted,
      })
      affectedConversations.add(String(durable.conversationId))
    }

    for (const conversation of store.listConversations()) {
      if (
        conversation.status === 'creating' &&
        conversation.providerThreadId === undefined
      ) {
        store.updateConversation({
          ...conversation,
          status: 'failed',
          updatedAt: now,
          lastActivityAt: now,
        })
        continue
      }
      if (
        affectedConversations.has(String(conversation.conversationId)) ||
        conversation.status === 'running' ||
        conversation.status === 'waiting'
      ) {
        store.updateConversation({
          ...conversation,
          status: 'idle',
          updatedAt: now,
          lastActivityAt: now,
        })
      }
    }
  })
}

export function restoreDurableConversations(
  store: ConversationStore,
  options: RestoreDurableOptions,
): RestoredDurableConversation[] {
  assertPositiveInteger(options.maxConversations, 'maxConversations')
  assertPositiveInteger(options.maxTurns, 'maxTurns')
  assertPositiveInteger(options.maxEntries, 'maxEntries')
  reconcileHostRestart(store, options.now)

  return store
    .listConversations()
    .filter(
      (
        conversation,
      ): conversation is DurableConversation & {
        readonly providerThreadId: string
      } =>
        conversation.providerThreadId !== undefined &&
        conversation.status !== 'creating',
    )
    .slice(0, options.maxConversations)
    .map((conversation) => restoreConversation(store, conversation, options))
}

/**
 * Rebuilds one bounded normalized Conversation view directly from durable
 * state. This is a read-only history boundary and never resumes a Provider.
 */
export function readDurableConversationDetail(
  store: ConversationStore,
  conversationId: ConversationId,
  options: DurableConversationDetailOptions = {},
): DurableConversationDetail | undefined {
  const maxTurns = options.maxTurns ?? DURABLE_CONVERSATION_DETAIL_DEFAULT_TURNS
  const maxEntries =
    options.maxEntries ?? DURABLE_CONVERSATION_DETAIL_DEFAULT_ENTRIES
  assertBoundedPositiveInteger(
    maxTurns,
    conversationRuntimeWireLimits.turns,
    'maxTurns',
  )
  assertBoundedPositiveInteger(
    maxEntries,
    Math.min(
      conversationRuntimeWireLimits.messages,
      conversationRuntimeWireLimits.tools,
      conversationRuntimeWireLimits.changes,
    ),
    'maxEntries',
  )

  const conversation = store.getConversation(conversationId)
  if (conversation === undefined) return undefined
  if (conversation.status === 'creating') {
    throw new Error(
      `Durable Conversation ${String(conversationId)} is not ready`,
    )
  }

  const reconstructed = reconstructDurableConversation(store, conversation, {
    maxTurns,
    maxEntries,
    compactOrders: true,
  })
  return {
    record: reconstructed.record,
    runtime: reconstructed.runtime,
    approvals: reconstructed.approvals,
    history: {
      totalTurns: reconstructed.totalTurns,
      retainedTurns: reconstructed.runtime.turns.length,
      hasOlder: reconstructed.totalTurns > reconstructed.runtime.turns.length,
    },
  }
}

function restoreConversation(
  store: ConversationStore,
  conversation: DurableConversation & { readonly providerThreadId: string },
  options: RestoreDurableOptions,
): RestoredDurableConversation {
  const reconstructed = reconstructDurableConversation(
    store,
    conversation,
    options,
  )
  return {
    record: reconstructed.record,
    providerThreadId: conversation.providerThreadId,
    runtime: reconstructed.runtime,
    providerTurns: reconstructed.providerTurns,
    expiredApprovals: reconstructed.approvals.filter(
      (approval) => approval.lifecycle === 'expired',
    ).length,
  }
}

interface ReconstructedDurableConversation {
  readonly record: ConversationRecord
  readonly runtime: ConversationRuntimeSnapshot
  readonly providerTurns: RestoredDurableConversation['providerTurns']
  readonly approvals: readonly DurableApprovalHistoryRecord[]
  readonly totalTurns: number
}

function reconstructDurableConversation(
  store: ConversationStore,
  conversation: DurableConversation,
  options: Pick<RestoreDurableOptions, 'maxTurns' | 'maxEntries'> & {
    readonly compactOrders?: boolean
  },
): ReconstructedDurableConversation {
  const durableTurns = store.listRecentTurns(
    conversation.conversationId,
    options.maxTurns,
  )
  const presentations = durableTurns.map((turn) => ({
    durable: turn,
    presentation: parseSnapshot(turn),
  }))
  const turns = presentations.map(({ durable, presentation }) => {
    if (
      presentation.turn.turnId !== durable.turnId ||
      presentation.turn.conversationId !== conversation.conversationId ||
      !durableTurnStatusMatchesPresentation(durable, presentation.turn)
    ) {
      throw new Error(`Durable Turn ${String(durable.turnId)} is inconsistent`)
    }
    return presentation.turn
  })

  const entries = presentations
    .flatMap(({ presentation }, turnOrder) => [
      ...presentation.messages.map((value) => ({
        kind: 'message' as const,
        turnOrder,
        value,
      })),
      ...presentation.tools.map((value) => ({
        kind: 'tool' as const,
        turnOrder,
        value,
      })),
      ...presentation.changes.map((value) => ({
        kind: 'change' as const,
        turnOrder,
        value,
      })),
    ])
    .sort(
      (left, right) =>
        left.turnOrder - right.turnOrder ||
        left.value.order - right.value.order,
    )
  const retainedEntries = entries.slice(-options.maxEntries)
  const hasDuplicateOrder =
    new Set(retainedEntries.map((entry) => entry.value.order)).size !==
    retainedEntries.length
  const retainedEntryOrders = new Map(
    retainedEntries.map((entry, index) => [
      runtimeEntryKey(entry.kind, entry.value),
      options.compactOrders === true || hasDuplicateOrder
        ? index + 1
        : entry.value.order,
    ]),
  )
  const messages = presentations.flatMap(({ presentation }) =>
    presentation.messages.flatMap((value) => {
      const order = retainedEntryOrders.get(runtimeEntryKey('message', value))
      return order === undefined ? [] : [{ ...value, order }]
    }),
  )
  const tools = presentations.flatMap(({ presentation }) =>
    presentation.tools.flatMap((value) => {
      const order = retainedEntryOrders.get(runtimeEntryKey('tool', value))
      return order === undefined ? [] : [{ ...value, order }]
    }),
  )
  const changes = presentations.flatMap(({ presentation }) =>
    presentation.changes.flatMap((value) => {
      const order = retainedEntryOrders.get(runtimeEntryKey('change', value))
      return order === undefined ? [] : [{ ...value, order }]
    }),
  )

  let terminal = [...presentations]
    .reverse()
    .find(({ presentation }) => presentation.terminal !== undefined)
    ?.presentation.terminal
  if (
    terminal?.itemId !== undefined &&
    !tools.some(
      (tool) =>
        tool.turnId === terminal?.turnId && tool.itemId === terminal.itemId,
    )
  ) {
    terminal = {
      ...(terminal.turnId === undefined ? {} : { turnId: terminal.turnId }),
      ...(terminal.command === undefined ? {} : { command: terminal.command }),
      text: terminal.text,
      ...(terminal.stream === undefined ? {} : { stream: terminal.stream }),
      truncated: true,
      ...(terminal.updatedAt === undefined
        ? {}
        : { updatedAt: terminal.updatedAt }),
    }
  }

  const totalTurns = store.countTurns(conversation.conversationId)
  const droppedEntries = entries.length - retainedEntries.length
  const truncated =
    totalTurns > turns.length ||
    droppedEntries > 0 ||
    presentations.some(
      ({ presentation }) => presentation.presentationTruncated,
    ) ||
    terminal?.truncated === true
  const runtime = ConversationRuntimeSnapshotSchema.parse({
    conversationId: conversation.conversationId,
    turns,
    messages,
    tools,
    changes,
    terminal: terminal ?? { text: '', truncated: false },
    history: {
      evictedTurns: Math.max(0, totalTurns - turns.length),
      evictedMessages: Math.max(
        0,
        entries.filter((entry) => entry.kind === 'message').length -
          messages.length,
      ),
      evictedTools: Math.max(
        0,
        entries.filter((entry) => entry.kind === 'tool').length - tools.length,
      ),
      evictedChanges: Math.max(
        0,
        entries.filter((entry) => entry.kind === 'change').length -
          changes.length,
      ),
      truncated,
    },
  })

  const record = ConversationRecordSchema.parse({
    conversationId: conversation.conversationId,
    projectId: conversation.projectId,
    title: conversation.title,
    provider: conversation.provider,
    cwd: conversation.cwd,
    ...(conversation.model === undefined ? {} : { model: conversation.model }),
    ...(conversation.reasoning === undefined
      ? {}
      : { reasoning: conversation.reasoning }),
    status: conversation.status,
    ...(conversation.status === 'running' || conversation.status === 'waiting'
      ? {
          activeTurnId: [...turns]
            .reverse()
            .find((turn) => turn.status === 'running')?.turnId,
        }
      : {}),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    lastActivityAt: conversation.lastActivityAt,
  })
  return {
    record,
    runtime,
    providerTurns: durableTurns.flatMap((turn) =>
      turn.providerTurnId === undefined
        ? []
        : [{ turnId: turn.turnId, providerTurnId: turn.providerTurnId }],
    ),
    approvals: presentations.flatMap(
      ({ presentation }) => presentation.approvals,
    ),
    totalTurns,
  }
}

function durableTurnStatusMatchesPresentation(
  durable: DurableTurnSnapshot,
  presentation: TurnRecord,
): boolean {
  if (
    durable.status === 'starting' ||
    durable.status === 'running' ||
    durable.status === 'waiting'
  ) {
    return presentation.status === 'running'
  }
  return durable.status === presentation.status
}

function parseSnapshot(turn: DurableTurnSnapshot): DurableTurnPresentationV1 {
  if (turn.snapshotVersion !== DURABLE_TURN_SNAPSHOT_VERSION) {
    throw new Error(
      `Unsupported Turn snapshot version ${String(turn.snapshotVersion)}`,
    )
  }
  return parseDurableTurnPresentation(turn.snapshot)
}

function parseDurableApproval(value: unknown): DurableApprovalHistoryRecord {
  const approval = requireRecord(value, 'Durable Approval')
  assertKnownKeys(approval, ['record', 'lifecycle', 'expiredAt', 'reason'])
  if (
    approval.lifecycle !== 'pending' &&
    approval.lifecycle !== 'resolved' &&
    approval.lifecycle !== 'expired'
  ) {
    throw new Error('Durable Approval lifecycle is unsupported')
  }
  const record = ApprovalRecordSchema.parse(approval.record)
  if (approval.lifecycle === 'pending' && record.status !== 'pending') {
    throw new Error('Pending durable Approval must contain a pending record')
  }
  if (approval.lifecycle === 'resolved' && record.status !== 'resolved') {
    throw new Error('Resolved durable Approval must contain a resolved record')
  }
  if (approval.lifecycle === 'expired') {
    if (
      record.status !== 'pending' ||
      approval.reason !== 'host_restart' ||
      approval.expiredAt === undefined
    ) {
      throw new Error('Expired durable Approval requires restart metadata')
    }
  } else if (
    approval.expiredAt !== undefined ||
    approval.reason !== undefined
  ) {
    throw new Error('Only expired durable Approvals may have restart metadata')
  }
  return {
    record,
    lifecycle: approval.lifecycle,
    ...(approval.expiredAt === undefined
      ? {}
      : { expiredAt: TimestampSchema.parse(approval.expiredAt) }),
    ...(approval.reason === undefined ? {} : { reason: approval.reason }),
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function assertKnownKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): void {
  const known = new Set(keys)
  const unexpected = Object.keys(value).find((key) => !known.has(key))
  if (unexpected !== undefined) {
    throw new Error(`Turn snapshot contains unknown field ${unexpected}`)
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`)
  }
}

function assertBoundedPositiveInteger(
  value: number,
  maximum: number,
  name: string,
): void {
  assertPositiveInteger(value, name)
  if (value > maximum) {
    throw new Error(`${name} must not exceed ${String(maximum)}`)
  }
}

function runtimeEntryKey(
  kind: 'message' | 'tool' | 'change',
  value: { readonly turnId: TurnId; readonly order: number },
): string {
  return `${kind}:${String(value.turnId)}:${String(value.order)}`
}

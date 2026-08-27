import {
  conversationRuntimeWireLimits,
  type ConversationId,
  type HostEventEnvelope,
  type HostSnapshot,
  type ItemId,
  type TurnId,
} from '@codetether/protocol'

export const DEFAULT_CONVERSATION_HISTORY_LIMITS = {
  maxTurns: 20,
  maxEntries: 512,
  maxTerminalBytes: 128 * 1024,
  maxConversationBytes: 4 * 1024 * 1024,
  maxPresentationTextBytes: 512 * 1024,
} as const

export const MAX_CANONICAL_TURN_INPUT_BYTES = 512 * 1024
const MIN_CONVERSATION_RUNTIME_BYTES = 1024

export interface ConversationRuntimeHistoryLimits {
  readonly maxTurns?: number
  readonly maxEntries?: number
  readonly maxTerminalBytes?: number
  readonly maxConversationBytes?: number
  readonly maxPresentationTextBytes?: number
}

export interface RuntimeHistoryEviction {
  readonly conversationId: ConversationId
  readonly turnIds: readonly TurnId[]
  /** Item identities no longer represented by retained presentation state. */
  readonly itemIds: readonly ItemId[]
  /** Connected consumers must replace from Snapshot after compaction. */
  readonly snapshotRequired: boolean
}

type ConversationRuntimeSnapshot = NonNullable<
  HostSnapshot['conversationRuntimes']
>[number]
type RuntimeMessage = ConversationRuntimeSnapshot['messages'][number]
type RuntimeTool = ConversationRuntimeSnapshot['tools'][number]
type RuntimeChange = ConversationRuntimeSnapshot['changes'][number]
type RuntimeTerminal = ConversationRuntimeSnapshot['terminal']
type RuntimeHistoryMetadata = ConversationRuntimeSnapshot['history']

interface ResolvedHistoryLimits {
  readonly maxTurns: number
  readonly maxEntries: number
  readonly maxTerminalBytes: number
  readonly maxConversationBytes: number
  readonly maxPresentationTextBytes: number
}

interface ConversationHistoryState {
  readonly conversationId: ConversationId
  readonly turns: Map<TurnId, ConversationRuntimeSnapshot['turns'][number]>
  readonly messages: Map<string, RuntimeMessage>
  readonly tools: Map<string, RuntimeTool>
  readonly changes: Map<string, RuntimeChange>
  terminal: RuntimeTerminal
  history: RuntimeHistoryMetadata
  snapshotRevision: number
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const TOOL_OUTPUT_SUMMARY_MAX_BYTES = 4 * 1024

/**
 * Bounded, process-local presentation history. It stores only public
 * CodeTether events; raw provider payloads never enter this state.
 */
export class ConversationRuntimeHistory {
  readonly #limits: ResolvedHistoryLimits
  readonly #conversations = new Map<ConversationId, ConversationHistoryState>()

  constructor(limits: ConversationRuntimeHistoryLimits = {}) {
    this.#limits = resolveLimits(limits)
  }

  get inputByteLimit(): number {
    return Math.min(
      MAX_CANONICAL_TURN_INPUT_BYTES,
      Math.max(1, Math.floor(this.#limits.maxConversationBytes / 4)),
    )
  }

  canRetainInput(text: string): boolean {
    return (
      encoder.encode(JSON.stringify(text)).byteLength <= this.inputByteLimit
    )
  }

  apply(
    event: Exclude<HostEventEnvelope, { readonly type: 'stream.reset' }>,
  ): RuntimeHistoryEviction {
    const state = this.#stateFor(event)
    const snapshotRevision = state.snapshotRevision
    const evictedTurnIds: TurnId[] = []
    const potentiallyEvictedItemIds = new Set<ItemId>()

    switch (event.type) {
      case 'conversation.started':
        break
      case 'turn.started':
        state.turns.set(event.turnId, event.payload.turn)
        break
      case 'message.delta':
        this.#applyMessageDelta(state, event)
        break
      case 'message.completed':
        this.#applyMessageCompleted(state, event)
        break
      case 'tool.started':
        this.#applyToolStarted(state, event)
        break
      case 'tool.output':
        this.#applyToolOutput(state, event)
        break
      case 'tool.completed':
        this.#applyToolCompleted(state, event)
        break
      case 'file.changed':
        this.#applyFileChange(state, event)
        break
      case 'approval.requested':
        // Pending approvals remain authoritative in the top-level Snapshot.
        break
      case 'approval.resolved':
        // If presentation history already evicted this Item, its provider
        // binding can now be released after the pending Approval is gone.
        if (event.itemId !== undefined) {
          potentiallyEvictedItemIds.add(event.itemId)
        }
        break
      case 'turn.completed':
        this.#mergeFinalMessage(
          state,
          event.turnId,
          event.payload.finalMessage,
          event.timestamp,
        )
        this.#completeTurn(state, event.turnId, 'completed', event.timestamp, {
          ...(event.payload.finalMessage === undefined
            ? {}
            : { finalMessage: event.payload.finalMessage }),
        })
        this.#settleItems(state, event.turnId, 'completed', event.timestamp)
        break
      case 'turn.failed':
        this.#completeTurn(state, event.turnId, 'failed', event.timestamp, {
          error: event.payload.error,
        })
        this.#settleItems(state, event.turnId, 'failed', event.timestamp)
        break
      case 'turn.interrupted':
        this.#completeTurn(
          state,
          event.turnId,
          'interrupted',
          event.timestamp,
          {},
        )
        this.#settleItems(state, event.turnId, 'interrupted', event.timestamp)
        break
    }

    this.#enforceBounds(state, evictedTurnIds, potentiallyEvictedItemIds)
    return {
      conversationId: event.conversationId,
      turnIds: evictedTurnIds,
      itemIds: [...potentiallyEvictedItemIds].filter(
        (itemId) => !this.#retainsItem(state, itemId),
      ),
      snapshotRequired: state.snapshotRevision !== snapshotRevision,
    }
  }

  snapshots(): readonly ConversationRuntimeSnapshot[] {
    return [...this.#conversations.values()].map((state) =>
      this.#snapshot(state),
    )
  }

  retainedItemIds(
    conversationId: ConversationId,
    turnId: TurnId,
  ): ReadonlySet<ItemId> {
    const retained = new Set<ItemId>()
    const state = this.#conversations.get(conversationId)
    if (state === undefined) return retained
    for (const message of state.messages.values()) {
      if (message.turnId === turnId) retained.add(message.itemId)
    }
    for (const tool of state.tools.values()) {
      if (tool.turnId === turnId) retained.add(tool.itemId)
    }
    for (const change of state.changes.values()) {
      if (change.turnId === turnId && change.itemId !== undefined) {
        retained.add(change.itemId)
      }
    }
    if (
      state.terminal.turnId === turnId &&
      state.terminal.itemId !== undefined
    ) {
      retained.add(state.terminal.itemId)
    }
    return retained
  }

  retainedTurnRecord(
    conversationId: ConversationId,
    turnId: TurnId,
  ): ConversationRuntimeSnapshot['turns'][number] | undefined {
    return this.#conversations.get(conversationId)?.turns.get(turnId)
  }

  #stateFor(
    event: Exclude<HostEventEnvelope, { readonly type: 'stream.reset' }>,
  ): ConversationHistoryState {
    const existing = this.#conversations.get(event.conversationId)
    if (existing !== undefined) return existing
    const state: ConversationHistoryState = {
      conversationId: event.conversationId,
      turns: new Map(),
      messages: new Map(),
      tools: new Map(),
      changes: new Map(),
      terminal: emptyTerminal(),
      history: {
        evictedTurns: 0,
        evictedMessages: 0,
        evictedTools: 0,
        evictedChanges: 0,
        truncated: false,
      },
      snapshotRevision: 0,
    }
    this.#conversations.set(event.conversationId, state)
    return state
  }

  #applyMessageDelta(
    state: ConversationHistoryState,
    event: Extract<HostEventEnvelope, { readonly type: 'message.delta' }>,
  ): void {
    const key = itemKey(event.turnId, event.itemId)
    const current = state.messages.get(key)
    const bounded = boundText(
      `${current?.text ?? ''}${event.payload.delta}`,
      this.#limits.maxPresentationTextBytes,
    )
    if (bounded.truncated) this.#markTruncated(state)
    state.messages.set(key, {
      turnId: event.turnId,
      itemId: event.itemId,
      text: bounded.text,
      status: 'running',
      timestamp: event.timestamp,
      order: current?.order ?? event.seq,
    })
  }

  #applyMessageCompleted(
    state: ConversationHistoryState,
    event: Extract<HostEventEnvelope, { readonly type: 'message.completed' }>,
  ): void {
    const key = itemKey(event.turnId, event.itemId)
    const current = state.messages.get(key)
    const bounded = boundText(
      event.payload.message,
      this.#limits.maxPresentationTextBytes,
    )
    if (bounded.truncated) this.#markTruncated(state)
    state.messages.set(key, {
      turnId: event.turnId,
      itemId: event.itemId,
      text: bounded.text,
      status: 'completed',
      timestamp: event.timestamp,
      order: current?.order ?? event.seq,
    })
  }

  #applyToolStarted(
    state: ConversationHistoryState,
    event: Extract<HostEventEnvelope, { readonly type: 'tool.started' }>,
  ): void {
    const key = itemKey(event.turnId, event.itemId)
    const current = state.tools.get(key)
    state.tools.set(key, {
      turnId: event.turnId,
      itemId: event.itemId,
      name: event.payload.name,
      ...(event.payload.command === undefined
        ? {}
        : { command: event.payload.command }),
      ...(event.payload.summary === undefined
        ? {}
        : { summary: event.payload.summary }),
      status: 'running',
      startedAt: current?.startedAt ?? event.timestamp,
      order: current?.order ?? event.seq,
    })
    state.terminal = {
      turnId: event.turnId,
      itemId: event.itemId,
      command: event.payload.command ?? event.payload.name,
      text: '',
      truncated: false,
      updatedAt: event.timestamp,
    }
  }

  #applyToolOutput(
    state: ConversationHistoryState,
    event: Extract<HostEventEnvelope, { readonly type: 'tool.output' }>,
  ): void {
    const key = itemKey(event.turnId, event.itemId)
    const current = state.tools.get(key)
    const baseTerminal =
      state.terminal.turnId === event.turnId &&
      state.terminal.itemId === event.itemId
        ? state.terminal
        : {
            turnId: event.turnId,
            itemId: event.itemId,
            command: current?.command ?? current?.name ?? 'Command execution',
            text: '',
            truncated: false,
          }
    const terminal = appendTail(
      baseTerminal.text,
      event.payload.output,
      this.#limits.maxTerminalBytes,
    )
    if (terminal.truncated || baseTerminal.truncated) {
      this.#markTruncated(state)
    }
    state.terminal = {
      ...baseTerminal,
      text: terminal.text,
      ...(event.payload.stream === undefined
        ? {}
        : { stream: event.payload.stream }),
      truncated: baseTerminal.truncated || terminal.truncated,
      updatedAt: event.timestamp,
    }
    const summary = tailText(state.terminal.text, TOOL_OUTPUT_SUMMARY_MAX_BYTES)
    state.tools.set(key, {
      turnId: event.turnId,
      itemId: event.itemId,
      name: current?.name ?? 'Command execution',
      ...(current?.command === undefined ? {} : { command: current.command }),
      ...(current?.summary === undefined ? {} : { summary: current.summary }),
      status: 'running',
      ...(summary.length === 0 ? {} : { outputSummary: summary }),
      startedAt: current?.startedAt ?? event.timestamp,
      order: current?.order ?? event.seq,
    })
  }

  #applyToolCompleted(
    state: ConversationHistoryState,
    event: Extract<HostEventEnvelope, { readonly type: 'tool.completed' }>,
  ): void {
    const key = itemKey(event.turnId, event.itemId)
    const current = state.tools.get(key)
    const outputSummary =
      event.payload.summary === undefined
        ? current?.outputSummary
        : tailText(event.payload.summary, TOOL_OUTPUT_SUMMARY_MAX_BYTES)
    state.tools.set(key, {
      turnId: event.turnId,
      itemId: event.itemId,
      name: event.payload.name,
      ...(event.payload.command === undefined && current?.command === undefined
        ? {}
        : { command: event.payload.command ?? current?.command }),
      ...(current?.summary === undefined ? {} : { summary: current.summary }),
      status: event.payload.success === false ? 'failed' : 'completed',
      ...(event.payload.success === undefined
        ? {}
        : { success: event.payload.success }),
      ...(outputSummary === undefined || outputSummary.length === 0
        ? {}
        : { outputSummary }),
      startedAt: current?.startedAt ?? event.timestamp,
      completedAt: event.timestamp,
      order: current?.order ?? event.seq,
    })
    if (
      state.terminal.turnId === event.turnId &&
      state.terminal.itemId === event.itemId
    ) {
      state.terminal = {
        ...state.terminal,
        command:
          event.payload.command ?? current?.command ?? event.payload.name,
        updatedAt: event.timestamp,
      }
    }
  }

  #applyFileChange(
    state: ConversationHistoryState,
    event: Extract<HostEventEnvelope, { readonly type: 'file.changed' }>,
  ): void {
    const key = changeKey(event.turnId, event.itemId, event.payload.path)
    const current = state.changes.get(key)
    const boundedDiff =
      event.payload.diff === undefined
        ? undefined
        : boundText(event.payload.diff, this.#limits.maxPresentationTextBytes)
    if (boundedDiff?.truncated === true) this.#markTruncated(state)
    state.changes.set(key, {
      turnId: event.turnId,
      ...(event.itemId === undefined ? {} : { itemId: event.itemId }),
      path: event.payload.path,
      kind: event.payload.kind,
      ...(boundedDiff === undefined ? {} : { diff: boundedDiff.text }),
      ...(event.payload.additions === undefined
        ? {}
        : { additions: event.payload.additions }),
      ...(event.payload.deletions === undefined
        ? {}
        : { deletions: event.payload.deletions }),
      timestamp: event.timestamp,
      order: current?.order ?? event.seq,
    })
  }

  #completeTurn(
    state: ConversationHistoryState,
    turnId: TurnId,
    status: 'completed' | 'failed' | 'interrupted',
    completedAt: string,
    fields: Pick<
      ConversationRuntimeSnapshot['turns'][number],
      'finalMessage' | 'error'
    >,
  ): void {
    const current = state.turns.get(turnId)
    if (current === undefined) return
    const finalMessage =
      fields.finalMessage === undefined
        ? undefined
        : boundText(fields.finalMessage, this.#limits.maxPresentationTextBytes)
    if (finalMessage?.truncated === true) this.#markTruncated(state)
    state.turns.set(turnId, {
      turnId: current.turnId,
      conversationId: current.conversationId,
      status,
      ...(current.input === undefined ? {} : { input: current.input }),
      startedAt: current.startedAt,
      completedAt,
      ...(finalMessage === undefined
        ? {}
        : { finalMessage: finalMessage.text }),
      ...(fields.error === undefined ? {} : { error: fields.error }),
    })
  }

  #mergeFinalMessage(
    state: ConversationHistoryState,
    turnId: TurnId,
    finalMessage: string | undefined,
    timestamp: string,
  ): void {
    if (finalMessage === undefined || finalMessage.length === 0) return
    if (
      [...state.messages.values()].some(
        (message) => message.turnId === turnId && message.text === finalMessage,
      )
    ) {
      return
    }
    const candidate = [...state.messages.entries()]
      .filter(
        ([, message]) =>
          message.turnId === turnId && message.status === 'running',
      )
      .sort((left, right) => right[1].order - left[1].order)[0]
    if (candidate === undefined) return
    const [key, message] = candidate
    const bounded = boundText(
      finalMessage,
      this.#limits.maxPresentationTextBytes,
    )
    if (bounded.truncated) this.#markTruncated(state)
    state.messages.set(key, {
      ...message,
      text: bounded.text,
      status: 'completed',
      timestamp,
    })
  }

  #settleItems(
    state: ConversationHistoryState,
    turnId: TurnId,
    outcome: 'completed' | 'failed' | 'interrupted',
    timestamp: string,
  ): void {
    for (const [key, message] of state.messages) {
      if (message.turnId !== turnId || message.status !== 'running') continue
      state.messages.set(key, {
        ...message,
        status: outcome === 'completed' ? 'completed' : outcome,
        timestamp,
      })
    }
    for (const [key, tool] of state.tools) {
      if (tool.turnId !== turnId || tool.status !== 'running') continue
      state.tools.set(key, {
        ...tool,
        status: outcome === 'completed' ? 'completed' : outcome,
        ...(outcome === 'interrupted'
          ? {}
          : { success: outcome === 'completed' }),
        completedAt: timestamp,
      })
    }
  }

  #enforceBounds(
    state: ConversationHistoryState,
    evictedTurnIds: TurnId[],
    potentiallyEvictedItemIds: Set<ItemId>,
  ): void {
    while (state.turns.size > this.#limits.maxTurns) {
      if (
        !this.#evictOldestCompletedTurn(
          state,
          evictedTurnIds,
          potentiallyEvictedItemIds,
        )
      ) {
        break
      }
    }

    while (entryCount(state) > this.#limits.maxEntries) {
      if (
        this.#canEvictCompletedTurn(state) &&
        this.#evictOldestCompletedTurn(
          state,
          evictedTurnIds,
          potentiallyEvictedItemIds,
        )
      ) {
        continue
      }
      if (!this.#evictOldestEntry(state, potentiallyEvictedItemIds)) break
    }

    while (
      encodedRuntimeBytes(this.#snapshot(state)) >
      this.#limits.maxConversationBytes
    ) {
      if (
        this.#canEvictCompletedTurn(state) &&
        this.#evictOldestCompletedTurn(
          state,
          evictedTurnIds,
          potentiallyEvictedItemIds,
        )
      ) {
        continue
      }
      if (!this.#evictOldestEntry(state, potentiallyEvictedItemIds)) break
    }

    while (
      encodedRuntimeBytes(this.#snapshot(state)) >
      this.#limits.maxConversationBytes
    ) {
      if (!this.#truncateLargestFinalMessage(state)) break
    }

    const retainedBytes = encodedRuntimeBytes(this.#snapshot(state))
    if (retainedBytes > this.#limits.maxConversationBytes) {
      throw new Error(
        `Conversation runtime history requires ${String(retainedBytes)} bytes after compaction and exceeds its ${String(this.#limits.maxConversationBytes)} byte limit`,
      )
    }
  }

  #truncateLargestFinalMessage(state: ConversationHistoryState): boolean {
    const candidate = [...state.turns.values()]
      .filter((turn) => (turn.finalMessage?.length ?? 0) > 0)
      .sort(
        (left, right) =>
          encoder.encode(right.finalMessage ?? '').byteLength -
          encoder.encode(left.finalMessage ?? '').byteLength,
      )[0]
    if (candidate?.finalMessage === undefined) return false
    const currentBytes = encoder.encode(candidate.finalMessage).byteLength
    const bounded = boundText(
      candidate.finalMessage,
      Math.floor(currentBytes / 2),
    )
    state.turns.set(candidate.turnId, {
      ...candidate,
      finalMessage: bounded.text,
    })
    this.#markTruncated(state)
    return true
  }

  #canEvictCompletedTurn(state: ConversationHistoryState): boolean {
    return state.turns.size > 1
  }

  #evictOldestCompletedTurn(
    state: ConversationHistoryState,
    evictedTurnIds: TurnId[],
    potentiallyEvictedItemIds: Set<ItemId>,
  ): boolean {
    const turn = [...state.turns.values()].find(
      (candidate) => candidate.status !== 'running',
    )
    if (turn === undefined) return false
    state.turns.delete(turn.turnId)
    evictedTurnIds.push(turn.turnId)
    state.history = {
      ...state.history,
      evictedTurns: incrementBounded(state.history.evictedTurns),
      truncated: true,
    }
    state.snapshotRevision += 1
    this.#removeTurnEntries(state, turn.turnId, potentiallyEvictedItemIds)
    if (state.terminal.turnId === turn.turnId) state.terminal = emptyTerminal()
    return true
  }

  #removeTurnEntries(
    state: ConversationHistoryState,
    turnId: TurnId,
    potentiallyEvictedItemIds: Set<ItemId>,
  ): void {
    for (const [key, message] of state.messages) {
      if (message.turnId !== turnId) continue
      state.messages.delete(key)
      potentiallyEvictedItemIds.add(message.itemId)
      this.#incrementEviction(state, 'message')
    }
    for (const [key, tool] of state.tools) {
      if (tool.turnId !== turnId) continue
      state.tools.delete(key)
      potentiallyEvictedItemIds.add(tool.itemId)
      this.#incrementEviction(state, 'tool')
    }
    for (const [key, change] of state.changes) {
      if (change.turnId !== turnId) continue
      state.changes.delete(key)
      if (change.itemId !== undefined) {
        potentiallyEvictedItemIds.add(change.itemId)
      }
      this.#incrementEviction(state, 'change')
    }
  }

  #evictOldestEntry(
    state: ConversationHistoryState,
    potentiallyEvictedItemIds: Set<ItemId>,
  ): boolean {
    const entries = [
      ...[...state.messages.entries()].map(([key, value]) => ({
        kind: 'message' as const,
        key,
        itemId: value.itemId,
        order: value.order,
      })),
      ...[...state.tools.entries()].map(([key, value]) => ({
        kind: 'tool' as const,
        key,
        itemId: value.itemId,
        order: value.order,
      })),
      ...[...state.changes.entries()].map(([key, value]) => ({
        kind: 'change' as const,
        key,
        itemId: value.itemId,
        order: value.order,
      })),
    ].sort((left, right) => left.order - right.order)
    const oldest = entries[0]
    if (oldest === undefined) return false
    if (oldest.kind === 'message') state.messages.delete(oldest.key)
    if (oldest.kind === 'tool') {
      state.tools.delete(oldest.key)
      if (state.terminal.itemId === oldest.itemId) {
        state.terminal = emptyTerminal()
      }
    }
    if (oldest.kind === 'change') state.changes.delete(oldest.key)
    if (oldest.itemId !== undefined) {
      potentiallyEvictedItemIds.add(oldest.itemId)
    }
    this.#incrementEviction(state, oldest.kind)
    return true
  }

  #incrementEviction(
    state: ConversationHistoryState,
    kind: 'message' | 'tool' | 'change',
  ): void {
    state.history = {
      ...state.history,
      ...(kind === 'message'
        ? { evictedMessages: incrementBounded(state.history.evictedMessages) }
        : {}),
      ...(kind === 'tool'
        ? { evictedTools: incrementBounded(state.history.evictedTools) }
        : {}),
      ...(kind === 'change'
        ? { evictedChanges: incrementBounded(state.history.evictedChanges) }
        : {}),
      truncated: true,
    }
    state.snapshotRevision += 1
  }

  #markTruncated(state: ConversationHistoryState): void {
    if (state.history.truncated) return
    state.history = { ...state.history, truncated: true }
    state.snapshotRevision += 1
  }

  #retainsItem(state: ConversationHistoryState, itemId: ItemId): boolean {
    return (
      [...state.messages.values()].some((entry) => entry.itemId === itemId) ||
      [...state.tools.values()].some((entry) => entry.itemId === itemId) ||
      [...state.changes.values()].some((entry) => entry.itemId === itemId) ||
      state.terminal.itemId === itemId
    )
  }

  #snapshot(state: ConversationHistoryState): ConversationRuntimeSnapshot {
    return {
      conversationId: state.conversationId,
      turns: [...state.turns.values()],
      messages: [...state.messages.values()].sort(byOrder),
      tools: [...state.tools.values()].sort(byOrder),
      changes: [...state.changes.values()].sort(byOrder),
      terminal: state.terminal,
      history: state.history,
    }
  }
}

function resolveLimits(
  limits: ConversationRuntimeHistoryLimits,
): ResolvedHistoryLimits {
  const resolved = {
    ...DEFAULT_CONVERSATION_HISTORY_LIMITS,
    ...limits,
  }
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive safe integer`)
    }
  }
  if (resolved.maxTurns > conversationRuntimeWireLimits.turns) {
    throw new RangeError('maxTurns exceeds the Protocol runtime wire limit')
  }
  if (resolved.maxConversationBytes < MIN_CONVERSATION_RUNTIME_BYTES) {
    throw new RangeError(
      `maxConversationBytes must be at least ${String(MIN_CONVERSATION_RUNTIME_BYTES)}`,
    )
  }
  const maxWireEntries = Math.min(
    conversationRuntimeWireLimits.messages,
    conversationRuntimeWireLimits.tools,
    conversationRuntimeWireLimits.changes,
  )
  if (resolved.maxEntries > maxWireEntries) {
    throw new RangeError('maxEntries exceeds the Protocol runtime wire limit')
  }
  if (resolved.maxTerminalBytes > conversationRuntimeWireLimits.terminalBytes) {
    throw new RangeError(
      'maxTerminalBytes exceeds the Protocol runtime wire limit',
    )
  }
  if (resolved.maxPresentationTextBytes > 1024 * 1024) {
    throw new RangeError(
      'maxPresentationTextBytes exceeds the Protocol message wire limit',
    )
  }
  return resolved
}

function incrementBounded(value: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, value + 1)
}

function emptyTerminal(): RuntimeTerminal {
  return { text: '', truncated: false }
}

function itemKey(turnId: TurnId, itemId: ItemId): string {
  return `${turnId}:${itemId}`
}

function changeKey(
  turnId: TurnId,
  itemId: ItemId | undefined,
  path: string,
): string {
  return `${turnId}:${itemId ?? 'no-item'}:${path}`
}

function entryCount(state: ConversationHistoryState): number {
  return state.messages.size + state.tools.size + state.changes.size
}

function encodedRuntimeBytes(snapshot: ConversationRuntimeSnapshot): number {
  return encoder.encode(JSON.stringify(snapshot)).byteLength
}

function byOrder<T extends { readonly order: number }>(
  left: T,
  right: T,
): number {
  return left.order - right.order
}

function appendTail(
  existing: string,
  addition: string,
  maxBytes: number,
): { readonly text: string; readonly truncated: boolean } {
  const combined = `${existing}${addition}`
  const encoded = encoder.encode(combined)
  if (encoded.byteLength <= maxBytes) {
    return { text: combined, truncated: false }
  }
  return {
    text: decodeTail(encoded, maxBytes),
    truncated: true,
  }
}

function tailText(value: string, maxBytes: number): string {
  const encoded = encoder.encode(value)
  return encoded.byteLength <= maxBytes ? value : decodeTail(encoded, maxBytes)
}

function boundText(
  value: string,
  maxBytes: number,
): { readonly text: string; readonly truncated: boolean } {
  const encoded = encoder.encode(value)
  if (encoded.byteLength <= maxBytes) {
    return { text: value, truncated: false }
  }
  return {
    text: decodePrefix(encoded, maxBytes),
    truncated: true,
  }
}

function decodeTail(encoded: Uint8Array, maxBytes: number): string {
  let start = Math.max(0, encoded.byteLength - maxBytes)
  while (start < encoded.byteLength && isUtf8ContinuationByte(encoded[start])) {
    start += 1
  }
  return decoder.decode(encoded.subarray(start))
}

function decodePrefix(encoded: Uint8Array, maxBytes: number): string {
  let end = Math.min(encoded.byteLength, maxBytes)
  while (end > 0 && isUtf8ContinuationByte(encoded[end])) end -= 1
  return decoder.decode(encoded.subarray(0, end))
}

function isUtf8ContinuationByte(value: number | undefined): boolean {
  return value !== undefined && (value & 0xc0) === 0x80
}

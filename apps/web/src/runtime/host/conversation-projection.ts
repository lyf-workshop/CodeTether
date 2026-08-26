import type {
  ApprovalKind,
  EventCursor,
  FileChangeKind,
  HostEventEnvelope,
  HostSnapshot,
  StreamResetReason,
  ToolOutputStream,
} from '@codetether/protocol'

export const TERMINAL_OUTPUT_MAX_BYTES = 128 * 1024

const TOOL_OUTPUT_SUMMARY_MAX_CHARACTERS = 512
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

export interface CurrentTurnReadModel {
  readonly id: string
  readonly status: 'running' | 'completed' | 'failed' | 'interrupted'
  readonly startedAt: string
  readonly completedAt?: string
  readonly finalMessage?: string
  readonly errorMessage?: string
  readonly interruptionReason?: string
}

export interface MessageReadModel {
  /** Opaque presentation identity derived from the Turn and Item identities. */
  readonly id: string
  readonly body: string
  readonly status: ProjectedItemStatus
  readonly timestamp: string
  readonly order: number
}

export interface ToolReadModel {
  /** Opaque presentation identity derived from the Turn and Item identities. */
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly status: ProjectedItemStatus
  readonly outputSummary?: string
  readonly timestamp: string
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
  readonly kind: ApprovalKind
  readonly summary: string
  readonly requestedAt: string
}

export interface TerminalReadModel {
  readonly toolId?: string
  readonly command?: string
  readonly stream?: ToolOutputStream
  readonly text: string
  readonly truncated: boolean
}

export interface ConversationReadModel {
  readonly id: string
  readonly cwd: string
  readonly title: string
  readonly status: CanonicalConversationStatus
  readonly agent: 'codex'
  readonly model?: string
  readonly reasoning?: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly currentTurn?: CurrentTurnReadModel
  readonly messages: readonly MessageReadModel[]
  readonly tools: readonly ToolReadModel[]
  readonly changes: readonly FileChangeReadModel[]
  readonly terminal: TerminalReadModel
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

/** Builds the replace boundary. Protocol v1 snapshots intentionally contain no Item history. */
export function projectSnapshot(
  snapshot: HostSnapshot,
): ConversationProjection {
  const activeTurns = new Map(
    snapshot.activeTurns.map((turn) => [String(turn.turnId), turn]),
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
    const activeTurn =
      record.activeTurnId === undefined
        ? undefined
        : activeTurns.get(String(record.activeTurnId))
    conversations[conversationId] = projectConversationRecord(
      record,
      activeTurn,
      approvalsByConversation.get(conversationId) ?? [],
    )
  }

  return {
    cursor: { epoch: snapshot.epoch, seq: snapshot.currentSeq },
    conversations,
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

  if (event.type === 'conversation.started') {
    const conversation = projectConversationRecord(
      event.payload.conversation,
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
      const next: ConversationReadModel = {
        ...conversation,
        status: 'running',
        updatedAt: event.timestamp,
        currentTurn: projectCurrentTurn(event.payload.turn),
        messages: [],
        tools: [],
        changes: [],
        terminal: emptyTerminal(),
        pendingApprovals: [],
      }
      return applied(projection, event, next)
    }

    case 'message.delta': {
      if (!belongsToCurrentTurn(conversation, event.turnId)) {
        return resetRequired(projection, 'invalid-lifecycle')
      }
      const id = itemKey(event.turnId, event.itemId)
      const index = conversation.messages.findIndex(
        (message) => message.id === id,
      )
      let messages: readonly MessageReadModel[]
      if (index < 0) {
        messages = [
          ...conversation.messages,
          {
            id,
            body: event.payload.delta,
            status: 'running',
            timestamp: event.timestamp,
            order: event.seq,
          },
        ]
      } else {
        const current = conversation.messages[index]
        if (current === undefined || current.status !== 'running') {
          return resetRequired(projection, 'invalid-lifecycle')
        }
        messages = replaceAt(conversation.messages, index, {
          ...current,
          body: `${current.body}${event.payload.delta}`,
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
      if (!belongsToCurrentTurn(conversation, event.turnId)) {
        return resetRequired(projection, 'invalid-lifecycle')
      }
      const id = itemKey(event.turnId, event.itemId)
      const index = conversation.messages.findIndex(
        (message) => message.id === id,
      )
      const completed: MessageReadModel = {
        id,
        body: event.payload.message,
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
      if (!belongsToCurrentTurn(conversation, event.turnId)) {
        return resetRequired(projection, 'invalid-lifecycle')
      }
      const id = itemKey(event.turnId, event.itemId)
      const index = conversation.tools.findIndex((tool) => tool.id === id)
      const tool: ToolReadModel = {
        id,
        name: event.payload.name,
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
          toolId: id,
          command: event.payload.name,
          text: '',
          truncated: false,
        },
      })
    }

    case 'tool.output': {
      if (!belongsToCurrentTurn(conversation, event.turnId)) {
        return resetRequired(projection, 'invalid-lifecycle')
      }
      const id = itemKey(event.turnId, event.itemId)
      const index = conversation.tools.findIndex((tool) => tool.id === id)
      const currentTool = index < 0 ? undefined : conversation.tools[index]
      if (currentTool !== undefined && currentTool.status !== 'running') {
        return resetRequired(projection, 'invalid-lifecycle')
      }

      const baseTerminal =
        conversation.terminal.toolId === id
          ? conversation.terminal
          : {
              toolId: id,
              command: currentTool?.name ?? 'Command execution',
              text: '',
              truncated: false,
            }
      const terminal = appendTerminalOutput(
        baseTerminal,
        event.payload.output,
        event.payload.stream,
      )
      const tool: ToolReadModel = {
        id,
        name: currentTool?.name ?? 'Command execution',
        ...(currentTool?.description === undefined
          ? {}
          : { description: currentTool.description }),
        status: 'running',
        outputSummary: summarizeOutput(terminal.text),
        timestamp: event.timestamp,
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
      if (!belongsToCurrentTurn(conversation, event.turnId)) {
        return resetRequired(projection, 'invalid-lifecycle')
      }
      const id = itemKey(event.turnId, event.itemId)
      const index = conversation.tools.findIndex((tool) => tool.id === id)
      const current = index < 0 ? undefined : conversation.tools[index]
      const outputSummary =
        event.payload.summary === undefined
          ? current?.outputSummary
          : summarizeOutput(event.payload.summary)
      const tool: ToolReadModel = {
        id,
        name: event.payload.name,
        ...(current?.description === undefined
          ? {}
          : { description: current.description }),
        status: event.payload.success === false ? 'failed' : 'completed',
        ...(outputSummary === undefined ? {} : { outputSummary }),
        timestamp: event.timestamp,
        order: current?.order ?? event.seq,
      }
      const tools =
        index < 0
          ? [...conversation.tools, tool]
          : replaceAt(conversation.tools, index, tool)
      const terminal = completeTerminal(
        conversation.terminal,
        id,
        event.payload.name,
        event.payload.summary,
      )
      return applied(projection, event, {
        ...conversation,
        updatedAt: event.timestamp,
        tools,
        terminal,
      })
    }

    case 'file.changed': {
      if (!belongsToCurrentTurn(conversation, event.turnId)) {
        return resetRequired(projection, 'invalid-lifecycle')
      }
      const parsed = parseUnifiedDiff(event.payload.diff)
      const id = event.payload.path
      const index = conversation.changes.findIndex((change) => change.id === id)
      const change: FileChangeReadModel = {
        id,
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
      if (!belongsToCurrentTurn(conversation, event.turnId)) {
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
      if (!belongsToCurrentTurn(conversation, event.turnId)) {
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
      if (!belongsToCurrentTurn(conversation, event.turnId)) {
        return resetRequired(projection, 'invalid-lifecycle')
      }
      const messages = completeMessages(
        conversation.messages,
        event.turnId,
        event.payload.finalMessage,
        event.timestamp,
        event.seq,
      )
      return applied(projection, event, {
        ...conversation,
        status: 'completed',
        updatedAt: event.timestamp,
        currentTurn: {
          ...conversation.currentTurn,
          status: 'completed',
          completedAt: event.timestamp,
          ...(event.payload.finalMessage === undefined
            ? {}
            : { finalMessage: event.payload.finalMessage }),
        },
        messages,
        tools: settleRunningItems(conversation.tools, 'completed'),
        pendingApprovals: [],
      })
    }

    case 'turn.failed': {
      if (!belongsToCurrentTurn(conversation, event.turnId)) {
        return resetRequired(projection, 'invalid-lifecycle')
      }
      return applied(projection, event, {
        ...conversation,
        status: 'failed',
        updatedAt: event.timestamp,
        currentTurn: {
          ...conversation.currentTurn,
          status: 'failed',
          completedAt: event.timestamp,
          errorMessage: event.payload.error.message,
        },
        messages: settleRunningItems(conversation.messages, 'failed'),
        tools: settleRunningItems(conversation.tools, 'failed'),
        pendingApprovals: [],
      })
    }

    case 'turn.interrupted': {
      if (!belongsToCurrentTurn(conversation, event.turnId)) {
        return resetRequired(projection, 'invalid-lifecycle')
      }
      return applied(projection, event, {
        ...conversation,
        status: 'idle',
        updatedAt: event.timestamp,
        currentTurn: {
          ...conversation.currentTurn,
          status: 'interrupted',
          completedAt: event.timestamp,
          ...(event.payload.reason === undefined
            ? {}
            : { interruptionReason: event.payload.reason }),
        },
        messages: settleRunningItems(conversation.messages, 'idle'),
        tools: settleRunningItems(conversation.tools, 'idle'),
        pendingApprovals: [],
      })
    }
  }
}

function projectConversationRecord(
  record: HostSnapshot['conversations'][number],
  activeTurn: HostSnapshot['activeTurns'][number] | undefined,
  pendingApprovals: readonly PendingApprovalReadModel[],
): ConversationReadModel {
  return {
    id: String(record.conversationId),
    cwd: record.cwd,
    title: titleFromCwd(record.cwd),
    status: record.status,
    agent: 'codex',
    ...(record.model === undefined ? {} : { model: record.model }),
    ...(record.reasoning === undefined ? {} : { reasoning: record.reasoning }),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(activeTurn === undefined
      ? {}
      : { currentTurn: projectCurrentTurn(activeTurn) }),
    messages: [],
    tools: [],
    changes: [],
    terminal: emptyTerminal(),
    pendingApprovals,
  }
}

function projectCurrentTurn(
  turn: HostSnapshot['activeTurns'][number],
): CurrentTurnReadModel {
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
    ...(turn.error === undefined ? {} : { errorMessage: turn.error.message }),
  }
}

function projectPendingApproval(
  approval: HostSnapshot['pendingApprovals'][number],
): PendingApprovalReadModel {
  return {
    id: String(approval.approvalId),
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

function belongsToCurrentTurn(
  conversation: ConversationReadModel,
  turnId: string,
): conversation is ConversationReadModel & {
  readonly currentTurn: CurrentTurnReadModel
} {
  return conversation.currentTurn?.id === turnId
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

function settleRunningItems<T extends { readonly status: ProjectedItemStatus }>(
  items: readonly T[],
  status: Exclude<ProjectedItemStatus, 'running'>,
): readonly T[] {
  let changed = false
  const settled = items.map((item) => {
    if (item.status !== 'running') return item
    changed = true
    return { ...item, status }
  })
  return changed ? settled : items
}

function completeMessages(
  messages: readonly MessageReadModel[],
  turnId: string,
  finalMessage: string | undefined,
  timestamp: string,
  order: number,
): readonly MessageReadModel[] {
  let completed = settleRunningItems(messages, 'completed')
  if (finalMessage === undefined || finalMessage.length === 0) return completed
  if (completed.some((message) => message.body === finalMessage)) {
    return completed
  }

  const lastRunningIndex = messages.findLastIndex(
    (message) => message.status === 'running',
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
      body: finalMessage,
      status: 'completed',
      timestamp,
      order,
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
  }
}

function completeTerminal(
  terminal: TerminalReadModel,
  toolId: string,
  command: string,
  summary: string | undefined,
): TerminalReadModel {
  if (terminal.toolId !== toolId) {
    if (summary === undefined) return terminal
    const bounded = retainUtf8Tail(summary, TERMINAL_OUTPUT_MAX_BYTES)
    return {
      toolId,
      command,
      text: bounded.text,
      truncated: bounded.truncated,
    }
  }
  if (terminal.text.length > 0 || summary === undefined) {
    return terminal.command === command ? terminal : { ...terminal, command }
  }
  const bounded = retainUtf8Tail(summary, TERMINAL_OUTPUT_MAX_BYTES)
  return {
    ...terminal,
    command,
    text: bounded.text,
    truncated: terminal.truncated || bounded.truncated,
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

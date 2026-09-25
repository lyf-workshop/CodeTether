import type {
  HostEventEnvelope,
  RemoteConversationHistoryPage,
} from '@codetether/protocol'

export interface RemoteTranscriptEntry {
  readonly id: string
  readonly turnId?: string
  readonly role: 'user' | 'assistant' | 'tool' | 'system'
  readonly kind: 'message' | 'tool' | 'change' | 'status'
  readonly content: string
  readonly timestamp?: string
  readonly status?: 'running' | 'completed' | 'failed' | 'interrupted'
  readonly historical: boolean
}

export interface RemoteLiveTranscriptState {
  readonly entries: readonly RemoteTranscriptEntry[]
  readonly eventIds: ReadonlySet<string>
}

export function flattenRemoteConversationHistory(
  pages: readonly RemoteConversationHistoryPage[] | undefined,
): readonly RemoteTranscriptEntry[] {
  if (pages === undefined) return []
  const entries = [...pages].reverse().flatMap((page) =>
    page.source === 'native_provider'
      ? page.native.entries.map((entry) => ({
          id: entry.id,
          role: entry.role,
          kind:
            entry.kind === 'message'
              ? ('message' as const)
              : entry.kind === 'tool_call' || entry.kind === 'tool_result'
                ? ('tool' as const)
                : ('status' as const),
          content: entry.content,
          ...(entry.occurredAt === undefined
            ? {}
            : { timestamp: entry.occurredAt }),
          status: 'completed' as const,
          historical: true as const,
        }))
      : durablePageEntries(page),
  )
  return deduplicateEntries(entries)
}

export function applyRemoteConversationLiveEvents(
  state: RemoteLiveTranscriptState,
  events: readonly HostEventEnvelope[],
): RemoteLiveTranscriptState {
  const eventIds = new Set(state.eventIds)
  const entries = new Map(state.entries.map((entry) => [entry.id, entry]))
  for (const event of events) {
    if (event.type === 'stream.reset' || eventIds.has(event.eventId)) continue
    eventIds.add(event.eventId)
    switch (event.type) {
      case 'turn.started': {
        const input = event.payload.turn.input
        if (input !== undefined) {
          entries.set(`${event.turnId}:user`, {
            id: `${event.turnId}:user`,
            turnId: event.turnId,
            role: 'user',
            kind: 'message',
            content: input.text,
            timestamp: input.timestamp,
            status: 'completed',
            historical: false,
          })
        }
        break
      }
      case 'message.delta': {
        const current = entries.get(event.itemId)
        entries.set(event.itemId, {
          id: event.itemId,
          turnId: event.turnId,
          role: 'assistant',
          kind: 'message',
          content: `${current?.content ?? ''}${event.payload.delta}`,
          timestamp: current?.timestamp ?? event.timestamp,
          status: 'running',
          historical: false,
        })
        break
      }
      case 'message.completed':
        entries.set(event.itemId, {
          id: event.itemId,
          turnId: event.turnId,
          role: 'assistant',
          kind: 'message',
          content: event.payload.message,
          timestamp: entries.get(event.itemId)?.timestamp ?? event.timestamp,
          status: 'completed',
          historical: false,
        })
        break
      case 'tool.started':
        entries.set(event.itemId, {
          id: event.itemId,
          turnId: event.turnId,
          role: 'tool',
          kind: 'tool',
          content: event.payload.summary ?? event.payload.name,
          timestamp: event.timestamp,
          status: 'running',
          historical: false,
        })
        break
      case 'tool.completed':
        entries.set(event.itemId, {
          id: event.itemId,
          turnId: event.turnId,
          role: 'tool',
          kind: 'tool',
          content:
            event.payload.summary ??
            entries.get(event.itemId)?.content ??
            event.payload.name,
          timestamp: entries.get(event.itemId)?.timestamp ?? event.timestamp,
          status: event.payload.success === false ? 'failed' : 'completed',
          historical: false,
        })
        break
      case 'file.changed': {
        const id = event.itemId ?? `${event.eventId}:change`
        entries.set(id, {
          id,
          turnId: event.turnId,
          role: 'tool',
          kind: 'change',
          content: `${event.payload.kind}: ${event.payload.path}`,
          timestamp: event.timestamp,
          status: 'completed',
          historical: false,
        })
        break
      }
      case 'turn.completed':
      case 'turn.failed':
      case 'turn.interrupted': {
        const id = `${event.turnId}:terminal`
        entries.set(id, {
          id,
          turnId: event.turnId,
          role: 'system',
          kind: 'status',
          content:
            event.type === 'turn.completed'
              ? 'Turn completed'
              : event.type === 'turn.failed'
                ? 'Turn failed'
                : 'Turn interrupted',
          timestamp: event.timestamp,
          status:
            event.type === 'turn.completed'
              ? 'completed'
              : event.type === 'turn.failed'
                ? 'failed'
                : 'interrupted',
          historical: false,
        })
        break
      }
      default:
        break
    }
  }
  return { entries: [...entries.values()], eventIds }
}

export function mergeRemoteTranscriptEntries(
  historical: readonly RemoteTranscriptEntry[],
  live: readonly RemoteTranscriptEntry[],
): readonly RemoteTranscriptEntry[] {
  const merged = new Map(historical.map((entry) => [entry.id, entry]))
  for (const entry of live) {
    const durable = merged.get(entry.id)
    if (durable?.historical === true && durable.status !== 'running') continue
    merged.set(entry.id, entry)
  }
  return [...merged.values()]
}

function durablePageEntries(
  page: Extract<RemoteConversationHistoryPage, { source: 'durable' }>,
): readonly RemoteTranscriptEntry[] {
  const entries: RemoteTranscriptEntry[] = []
  const messages = new Map(
    page.runtime.messages.map((message) => [
      message.turnId,
      [
        ...(page.runtime.messages.filter(
          (candidate) => candidate.turnId === message.turnId,
        ) ?? []),
      ].sort((left, right) => left.order - right.order),
    ]),
  )
  const tools = new Map(
    page.runtime.tools.map((tool) => [
      tool.turnId,
      page.runtime.tools
        .filter((candidate) => candidate.turnId === tool.turnId)
        .sort((left, right) => left.order - right.order),
    ]),
  )
  const changes = new Map(
    page.runtime.changes.map((change) => [
      change.turnId,
      page.runtime.changes
        .filter((candidate) => candidate.turnId === change.turnId)
        .sort((left, right) => left.order - right.order),
    ]),
  )
  for (const turn of page.runtime.turns) {
    if (turn.input !== undefined) {
      entries.push({
        id: `${turn.turnId}:user`,
        turnId: turn.turnId,
        role: 'user',
        kind: 'message',
        content: turn.input.text,
        timestamp: turn.input.timestamp,
        status: 'completed',
        historical: true,
      })
    }
    const activities = [
      ...(messages.get(turn.turnId) ?? []).map((message) => ({
        order: message.order,
        entry: {
          id: message.itemId,
          turnId: turn.turnId,
          role: 'assistant' as const,
          kind: 'message' as const,
          content: message.text,
          timestamp: message.timestamp,
          status: message.status,
          historical: true as const,
        },
      })),
      ...(tools.get(turn.turnId) ?? []).map((tool) => ({
        order: tool.order,
        entry: {
          id: tool.itemId,
          turnId: turn.turnId,
          role: 'tool' as const,
          kind: 'tool' as const,
          content: tool.summary ?? tool.name,
          timestamp: tool.startedAt,
          status: tool.status,
          historical: true as const,
        },
      })),
      ...(changes.get(turn.turnId) ?? []).map((change) => ({
        order: change.order,
        entry: {
          id: `${turn.turnId}:change:${String(change.itemId ?? change.order)}`,
          turnId: turn.turnId,
          role: 'tool' as const,
          kind: 'change' as const,
          content: `${change.kind}: ${change.path}`,
          timestamp: change.timestamp,
          status: 'completed' as const,
          historical: true as const,
        },
      })),
    ].sort((left, right) => left.order - right.order)
    entries.push(...activities.map(({ entry }) => entry))
    if (
      activities.length === 0 &&
      turn.finalMessage !== undefined &&
      turn.finalMessage.length > 0
    ) {
      entries.push({
        id: `${turn.turnId}:final`,
        turnId: turn.turnId,
        role: 'assistant',
        kind: 'message',
        content: turn.finalMessage,
        timestamp: turn.completedAt ?? turn.startedAt,
        status: turn.status,
        historical: true,
      })
    }
  }
  return entries
}

function deduplicateEntries(
  entries: readonly RemoteTranscriptEntry[],
): readonly RemoteTranscriptEntry[] {
  const unique = new Map<string, RemoteTranscriptEntry>()
  for (const entry of entries) unique.set(entry.id, entry)
  return [...unique.values()]
}

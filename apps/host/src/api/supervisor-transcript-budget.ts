import type {
  ConversationRuntimeSnapshot,
  HostEventEnvelope,
  ReadNativeTranscriptResponse,
  TurnRecord,
} from '@codetether/protocol'

import {
  supervisorJsonBytes,
  supervisorRowsByteBudget,
  truncateSupervisorText,
} from '../supervisor-read-budget.js'

// Allow room for scoped identities, cursors, and page flags in addition to
// the transport's response envelope.
export const supervisorTranscriptByteBudget = supervisorRowsByteBudget - 1024

function truncateFields<T extends object>(
  value: T,
  fields: readonly (keyof T)[],
  maximumBytes: number,
): T {
  const projected = { ...value }
  for (const field of fields) {
    const text = value[field]
    if (typeof text === 'string') {
      Object.assign(projected, {
        [field]: truncateSupervisorText(text, maximumBytes),
      })
    }
  }
  return projected
}

function compactTurn(turn: TurnRecord): TurnRecord {
  const projected = truncateFields(turn, ['finalMessage'], 1024)
  if (turn.input !== undefined) {
    const input = truncateFields(turn.input, ['text'], 2048)
    projected.input = input
    if (
      input.text !== turn.input.text &&
      projected.error?.failure?.userAction === 'retry'
    ) {
      // Older clients use the displayed input as the retry prompt. Keep the
      // failure code and message, but do not offer a retry of a shortened copy.
      projected.error = { ...projected.error }
      delete projected.error.failure
    }
  }
  if (projected.error !== undefined) {
    projected.error = truncateFields(projected.error, ['message'], 512)
  }
  return projected
}

type RuntimeEntry =
  | { kind: 'message'; value: ConversationRuntimeSnapshot['messages'][number] }
  | { kind: 'tool'; value: ConversationRuntimeSnapshot['tools'][number] }
  | { kind: 'change'; value: ConversationRuntimeSnapshot['changes'][number] }

function compactEntry(entry: RuntimeEntry): RuntimeEntry {
  switch (entry.kind) {
    case 'message':
      return {
        kind: entry.kind,
        value: truncateFields(entry.value, ['text'], 2048),
      }
    case 'tool':
      return {
        kind: entry.kind,
        value: truncateFields(
          entry.value,
          ['summary', 'outputSummary', 'command'],
          1024,
        ),
      }
    case 'change': {
      // The file identity remains intact. File details can be read from the
      // separate changes operation when the full record is too large here.
      const value = { ...entry.value }
      delete value.diff
      return { kind: entry.kind, value }
    }
  }
}

export function compactSupervisorDurableTurn(
  runtime: ConversationRuntimeSnapshot,
  beforeEntryOrder?: number,
): { runtime: ConversationRuntimeSnapshot; beforeEntryOrder?: number } {
  const entries: RuntimeEntry[] = [
    ...runtime.messages.map((value) => ({ kind: 'message' as const, value })),
    ...runtime.tools.map((value) => ({ kind: 'tool' as const, value })),
    ...runtime.changes.map((value) => ({ kind: 'change' as const, value })),
  ]
  const older = entries
    .filter(
      ({ value }) =>
        beforeEntryOrder === undefined || value.order < beforeEntryOrder,
    )
    .sort((a, b) => b.value.order - a.value.order)
  const projected: ConversationRuntimeSnapshot = {
    ...runtime,
    turns: runtime.turns.map(compactTurn),
    messages: [],
    tools: [],
    changes: [],
    terminal:
      beforeEntryOrder === undefined
        ? {
            ...truncateFields(runtime.terminal, ['text', 'command'], 512),
            truncated: true,
          }
        : { text: '', truncated: true },
    history: { ...runtime.history, truncated: true },
  }
  const rowBudget =
    supervisorTranscriptByteBudget - supervisorJsonBytes(projected) - 24
  let remaining = rowBudget
  let nextOrder: number | undefined
  let pending = false
  for (const entry of older) {
    const compacted =
      supervisorJsonBytes(entry.value) + 1 > rowBudget
        ? compactEntry(entry)
        : entry
    const bytes = supervisorJsonBytes(compacted.value) + 1
    if (bytes > remaining) {
      if (nextOrder !== undefined) {
        pending = true
        break
      }
      // A path can consume an entire frame on its own. Do not invent a
      // shortened path and present it as the identity of a different file.
      if (compacted.kind === 'change') projected.history.evictedChanges += 1
      continue
    }
    switch (compacted.kind) {
      case 'message':
        projected.messages.unshift(compacted.value)
        break
      case 'tool':
        projected.tools.unshift(compacted.value)
        break
      case 'change':
        projected.changes.unshift(compacted.value)
        break
    }
    nextOrder = compacted.value.order
    remaining -= bytes
  }
  if (
    projected.terminal.itemId !== undefined &&
    !projected.tools.some((tool) => tool.itemId === projected.terminal.itemId)
  ) {
    delete projected.terminal.itemId
  }
  return {
    runtime: projected,
    ...(pending && nextOrder !== undefined
      ? { beforeEntryOrder: nextOrder }
      : {}),
  }
}

export function compactSupervisorNativeEntry(
  page: ReadNativeTranscriptResponse,
): ReadNativeTranscriptResponse {
  return {
    ...page,
    entries: page.entries.map((entry) =>
      truncateFields(entry, ['content'], supervisorTranscriptByteBudget - 2048),
    ),
    metrics: { ...page.metrics, truncated: true },
  }
}

export function compactSupervisorLiveEvent(
  event: HostEventEnvelope,
): HostEventEnvelope {
  if (supervisorJsonBytes(event) + 1 <= supervisorTranscriptByteBudget)
    return event

  switch (event.type) {
    case 'message.delta':
      return {
        ...event,
        payload: truncateFields(event.payload, ['delta'], 8192),
      }
    case 'message.completed':
      return {
        ...event,
        payload: truncateFields(event.payload, ['message'], 8192),
      }
    case 'tool.output':
      return {
        ...event,
        payload: truncateFields(event.payload, ['output'], 8192),
      }
    case 'tool.started':
    case 'tool.completed':
      return {
        ...event,
        payload: truncateFields(event.payload, ['summary', 'command'], 4096),
      }
    case 'turn.started':
      return { ...event, payload: { turn: compactTurn(event.payload.turn) } }
    case 'turn.completed':
      return {
        ...event,
        payload: truncateFields(event.payload, ['finalMessage'], 8192),
      }
    case 'file.changed': {
      const { diff, ...payload } = event.payload
      const projected = { ...event, payload }
      // Retain the real path even if a shortened diff has no room.
      const diffBudget =
        supervisorTranscriptByteBudget - supervisorJsonBytes(projected) - 16
      return diff === undefined || diffBudget < 8
        ? projected
        : {
            ...projected,
            payload: {
              ...payload,
              diff: truncateSupervisorText(diff, diffBudget),
            },
          }
    }
    case 'approval.requested':
    case 'approval.resolved':
      return {
        ...event,
        payload: {
          approval: truncateFields(event.payload.approval, ['summary'], 8192),
        },
      }
    case 'attention.created':
    case 'attention.resolved': {
      const attention = event.payload.attention
      return attention.type !== 'approval'
        ? event
        : {
            ...event,
            payload: {
              attention: {
                ...attention,
                payload: truncateFields(
                  attention.payload,
                  ['actionSubtitle'],
                  8192,
                ),
              },
            },
          }
    }
    default:
      // Keep non-display identities intact. The replay resets if such an
      // event cannot fit on an empty page.
      return event
  }
}

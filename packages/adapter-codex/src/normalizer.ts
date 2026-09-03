import { createHash } from 'node:crypto'

import {
  canonicalFailure,
  type AgentEvent,
  type ApprovalKind,
  type FileChangeKind,
} from '@codetether/agent-core'

import { CodexProtocolError } from './errors.js'
import { classifyCodexErrorInfo } from './failure-classifier.js'
import type { JsonRpcNotification, JsonRpcRequest } from './protocol.js'
import { isRecord, readString } from './protocol.js'

export interface NormalizationResult {
  readonly recognized: boolean
  readonly events: readonly AgentEvent[]
}

export const MAX_FILE_CHANGES_PER_TURN = 1024

/** Translates only the lifecycle and item shapes required by the Phase 2A spike. */
export class CodexEventNormalizer {
  readonly #seenFileChanges = new Map<string, Set<string>>()

  releaseTurn(threadId: string, turnId: string): void {
    this.#seenFileChanges.delete(turnKey(threadId, turnId))
  }

  normalize(
    notification: JsonRpcNotification,
    timestamp = new Date().toISOString(),
  ): NormalizationResult {
    const raw = { method: notification.method, payload: notification.params }
    if (!isNormalizedNotification(notification.method)) {
      return { recognized: false, events: [] }
    }
    const params = requireRecord(notification.params, notification.method)

    switch (notification.method) {
      case 'thread/started': {
        const thread = requireRecord(params.thread, notification.method)
        const threadId = requireString(thread, 'id', notification.method)
        return {
          recognized: true,
          events: [
            {
              type: 'conversation.started',
              provider: 'codex',
              timestamp,
              threadId,
              ...(readString(thread, 'cwd') === undefined
                ? {}
                : { cwd: readString(thread, 'cwd') }),
              raw,
            },
          ],
        }
      }
      case 'turn/started': {
        const turn = requireRecord(params.turn, notification.method)
        return {
          recognized: true,
          events: [
            {
              type: 'turn.started',
              provider: 'codex',
              timestamp,
              threadId: requireString(params, 'threadId', notification.method),
              turnId: requireString(turn, 'id', notification.method),
              raw,
            },
          ],
        }
      }
      case 'item/agentMessage/delta':
        return {
          recognized: true,
          events: [
            {
              type: 'message.delta',
              provider: 'codex',
              timestamp,
              threadId: requireString(params, 'threadId', notification.method),
              turnId: requireString(params, 'turnId', notification.method),
              itemId: requireString(params, 'itemId', notification.method),
              delta: requireString(params, 'delta', notification.method),
              raw,
            },
          ],
        }
      case 'item/commandExecution/outputDelta':
        return {
          recognized: true,
          events: [
            {
              type: 'tool.output',
              provider: 'codex',
              timestamp,
              threadId: requireString(params, 'threadId', notification.method),
              turnId: requireString(params, 'turnId', notification.method),
              itemId: requireString(params, 'itemId', notification.method),
              output: requireString(params, 'delta', notification.method),
              stream: 'combined',
              raw,
            },
          ],
        }
      case 'item/started':
        return this.#normalizeItemStarted(params, timestamp, raw)
      case 'item/completed':
        return this.#normalizeItemCompleted(params, timestamp, raw)
      case 'item/fileChange/patchUpdated':
        return {
          recognized: true,
          events: this.#normalizeFileChanges(params, timestamp, raw),
        }
      case 'turn/completed':
        return this.#normalizeTurnCompleted(params, timestamp, raw)
      case 'error': {
        // This notification can be transient. The authoritative terminal state
        // arrives through turn/completed, which prevents duplicate failures.
        return { recognized: true, events: [] }
      }
      case 'turn/diff/updated':
        // The aggregate diff has no path, so it remains provider metadata until
        // a real consumer requires a separate normalized diff event.
        return { recognized: true, events: [] }
      default:
        return { recognized: false, events: [] }
    }
  }

  #normalizeItemStarted(
    params: Record<string, unknown>,
    timestamp: string,
    raw: { readonly method: string; readonly payload: unknown },
  ): NormalizationResult {
    const item = requireRecord(params.item, raw.method)
    if (item.type !== 'commandExecution') {
      return { recognized: true, events: [] }
    }
    const command = requireString(item, 'command', raw.method)
    return {
      recognized: true,
      events: [
        {
          type: 'tool.started',
          provider: 'codex',
          timestamp,
          threadId: requireString(params, 'threadId', raw.method),
          turnId: requireString(params, 'turnId', raw.method),
          itemId: requireString(item, 'id', raw.method),
          kind: 'shell',
          name: command,
          summary: readString(item, 'cwd'),
          raw,
        },
      ],
    }
  }

  #normalizeItemCompleted(
    params: Record<string, unknown>,
    timestamp: string,
    raw: { readonly method: string; readonly payload: unknown },
  ): NormalizationResult {
    const item = requireRecord(params.item, raw.method)
    const threadId = requireString(params, 'threadId', raw.method)
    const turnId = requireString(params, 'turnId', raw.method)
    const itemId = requireString(item, 'id', raw.method)

    if (item.type === 'agentMessage') {
      return {
        recognized: true,
        events: [
          {
            type: 'message.completed',
            provider: 'codex',
            timestamp,
            threadId,
            turnId,
            itemId,
            message: requireString(item, 'text', raw.method),
            raw,
          },
        ],
      }
    }
    if (item.type === 'commandExecution') {
      const status = readString(item, 'status')
      return {
        recognized: true,
        events: [
          {
            type: 'tool.completed',
            provider: 'codex',
            timestamp,
            threadId,
            turnId,
            itemId,
            kind: 'shell',
            name: requireString(item, 'command', raw.method),
            success: status === 'completed',
            ...(readString(item, 'aggregatedOutput') === undefined
              ? {}
              : { summary: readString(item, 'aggregatedOutput') }),
            raw,
          },
        ],
      }
    }
    if (item.type === 'fileChange') {
      return {
        recognized: true,
        events: this.#normalizeFileChanges(
          { ...params, itemId, changes: item.changes },
          timestamp,
          raw,
        ),
      }
    }
    return { recognized: true, events: [] }
  }

  #normalizeFileChanges(
    params: Record<string, unknown>,
    timestamp: string,
    raw: { readonly method: string; readonly payload: unknown },
  ): AgentEvent[] {
    if (!Array.isArray(params.changes)) {
      throw new CodexProtocolError(`${raw.method} has no changes array`)
    }
    const threadId = requireString(params, 'threadId', raw.method)
    const turnId = requireString(params, 'turnId', raw.method)
    const itemId = readString(params, 'itemId')

    return params.changes.flatMap((candidate) => {
      const change = requireRecord(candidate, raw.method)
      const path = requireString(change, 'path', raw.method)
      const diff = readString(change, 'diff')
      const kind = normalizeChangeKind(change.kind)
      const key = fileChangeIdentity(itemId, path, kind, diff)
      const seenForTurn = this.#seenFileChanges.get(turnKey(threadId, turnId))
      if (seenForTurn?.has(key) === true) return []
      const seen = seenForTurn ?? new Set<string>()
      if (seen.size >= MAX_FILE_CHANGES_PER_TURN) {
        throw new CodexProtocolError(
          `File-change identity limit of ${String(MAX_FILE_CHANGES_PER_TURN)} was reached for one Turn`,
        )
      }
      seen.add(key)
      this.#seenFileChanges.set(turnKey(threadId, turnId), seen)
      return [
        {
          type: 'file.changed' as const,
          provider: 'codex' as const,
          timestamp,
          threadId,
          turnId,
          ...(itemId === undefined ? {} : { itemId }),
          path,
          kind,
          ...(diff === undefined ? {} : { diff }),
          raw,
        },
      ]
    })
  }

  #normalizeTurnCompleted(
    params: Record<string, unknown>,
    timestamp: string,
    raw: { readonly method: string; readonly payload: unknown },
  ): NormalizationResult {
    const turn = requireRecord(params.turn, raw.method)
    const threadId = requireString(params, 'threadId', raw.method)
    const turnId = requireString(turn, 'id', raw.method)
    const status = requireString(turn, 'status', raw.method)

    if (status === 'completed') {
      return {
        recognized: true,
        events: [
          {
            type: 'turn.completed',
            provider: 'codex',
            timestamp,
            threadId,
            turnId,
            raw,
          },
        ],
      }
    }
    if (status === 'interrupted') {
      return {
        recognized: true,
        events: [
          {
            type: 'turn.interrupted',
            provider: 'codex',
            timestamp,
            threadId,
            turnId,
            raw,
          },
        ],
      }
    }
    if (status === 'inProgress') {
      throw new CodexProtocolError(
        'turn/completed reported the non-terminal status inProgress',
      )
    }
    const error = isRecord(turn.error) ? turn.error : undefined
    return {
      recognized: true,
      events: [
        {
          type: 'turn.failed',
          provider: 'codex',
          timestamp,
          threadId,
          turnId,
          error: {
            message: 'Codex could not complete this turn.',
            failure: canonicalFailure(
              classifyCodexErrorInfo(error?.codexErrorInfo),
              timestamp,
            ),
          },
          raw,
        },
      ],
    }
  }
}

function fileChangeIdentity(
  itemId: string | undefined,
  path: string,
  kind: FileChangeKind,
  diff: string | undefined,
): string {
  return createHash('sha256')
    .update(itemId ?? '', 'utf8')
    .update('\u0000', 'utf8')
    .update(path, 'utf8')
    .update('\u0000', 'utf8')
    .update(kind, 'utf8')
    .update('\u0000', 'utf8')
    .update(diff ?? '', 'utf8')
    .digest('hex')
}

function turnKey(threadId: string, turnId: string): string {
  return `${threadId}\u0000${turnId}`
}

export function normalizeApprovalRequest(
  request: JsonRpcRequest,
  fallbackTurnId?: string,
  timestamp = new Date().toISOString(),
): AgentEvent | undefined {
  const kind = approvalKind(request.method)
  if (kind === undefined) return undefined

  const params = requireRecord(request.params, request.method)
  const threadId =
    readString(params, 'threadId') ?? readString(params, 'conversationId')
  const turnId = readString(params, 'turnId') ?? fallbackTurnId
  if (threadId === undefined || turnId === undefined) return undefined

  return {
    type: 'approval.requested',
    provider: 'codex',
    timestamp,
    threadId,
    turnId,
    approvalId: readString(params, 'approvalId') ?? String(request.id),
    ...(readString(params, 'itemId') === undefined
      ? {}
      : { itemId: readString(params, 'itemId') }),
    kind,
    summary: approvalSummary(request.method, params),
    raw: { method: request.method, payload: request.params },
  }
}

function isNormalizedNotification(method: string): boolean {
  return (
    method === 'thread/started' ||
    method === 'turn/started' ||
    method === 'item/agentMessage/delta' ||
    method === 'item/commandExecution/outputDelta' ||
    method === 'item/started' ||
    method === 'item/completed' ||
    method === 'item/fileChange/patchUpdated' ||
    method === 'turn/completed' ||
    method === 'error' ||
    method === 'turn/diff/updated'
  )
}

function approvalKind(method: string): ApprovalKind | undefined {
  if (
    method === 'item/commandExecution/requestApproval' ||
    method === 'execCommandApproval'
  ) {
    return 'command'
  }
  if (
    method === 'item/fileChange/requestApproval' ||
    method === 'applyPatchApproval'
  ) {
    return 'file-change'
  }
  if (method === 'item/permissions/requestApproval') return 'unknown'
  return undefined
}

function approvalSummary(
  method: string,
  params: Record<string, unknown>,
): string {
  if (method.includes('commandExecution')) {
    return readString(params, 'command') ?? 'Codex requested command approval'
  }
  if (method === 'execCommandApproval' && Array.isArray(params.command)) {
    return params.command
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
  }
  return (
    readString(params, 'reason') ?? 'Codex requested file or permission access'
  )
}

function normalizeChangeKind(value: unknown): FileChangeKind {
  if (!isRecord(value)) return 'unknown'
  if (value.type === 'add') return 'added'
  if (value.type === 'delete') return 'deleted'
  if (value.type === 'update') {
    return typeof value.move_path === 'string' ? 'renamed' : 'modified'
  }
  return 'unknown'
}

function requireRecord(
  value: unknown,
  method: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new CodexProtocolError(`${method} has invalid parameters`)
  }
  return value
}

function requireString(
  value: Record<string, unknown>,
  key: string,
  method: string,
): string {
  const candidate = readString(value, key)
  if (candidate === undefined) {
    throw new CodexProtocolError(`${method} is missing ${key}`)
  }
  return candidate
}

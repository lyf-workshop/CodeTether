import type { AgentEvent } from '@codetether/agent-core'
import type {
  ConversationId,
  HostEvent,
  HostError,
  TurnRecord,
} from '@codetether/protocol'

import {
  classifyCanonicalFailure,
  safeProviderHostError,
} from './canonical-failure.js'
import {
  publicItemId,
  type ConversationState,
  type TurnState,
} from './host-service-state.js'
import { providerSessionKey } from './provider-registry.js'

const COMMAND_TOOL_NAME = 'command'
const TOOL_COMMAND_MAX_CHARACTERS = 32 * 1024
const TOOL_SUMMARY_MAX_CHARACTERS = 4096

export interface ProviderEventTranslatorOptions {
  readonly providerThreads: ReadonlyMap<string, ConversationId>
  readonly conversations: ReadonlyMap<ConversationId, ConversationState>
  readonly publish: (event: HostEvent) => void
  readonly completeTurn: (
    conversation: ConversationState,
    turn: TurnState,
    status: Exclude<TurnRecord['status'], 'running'>,
    completedAt: string,
    fields: Pick<TurnRecord, 'finalMessage' | 'error'>,
  ) => void
  readonly executionSucceeded?: (
    conversation: ConversationState,
    provider: AgentEvent['provider'],
    occurredAt: string,
  ) => void
  readonly executionFailed?: (
    conversation: ConversationState,
    provider: AgentEvent['provider'],
    error: HostError,
  ) => void
}

/** Translates provider-owned event identity into the public Host namespace. */
export class ProviderEventTranslator {
  readonly #options: ProviderEventTranslatorOptions

  constructor(options: ProviderEventTranslatorOptions) {
    this.#options = options
  }

  translate(event: AgentEvent): boolean {
    // Host creates its own identities and publishes these lifecycle events
    // only after the matching provider RPC response is bound.
    if (
      event.type === 'conversation.started' ||
      event.type === 'turn.started' ||
      event.type === 'approval.requested'
    ) {
      return true
    }

    const conversationId = this.#options.providerThreads.get(
      providerSessionKey(event.provider, event.threadId),
    )
    // An event for a cold/evicted or unknown Provider Thread cannot acquire a
    // public binding. Consume it as diagnostics instead of filling the short
    // startTurn binding buffer; durable history remains authoritative.
    if (conversationId === undefined) return true
    const conversation = this.#options.conversations.get(conversationId)
    if (
      conversation === undefined ||
      conversation.record.provider !== event.provider
    ) {
      return true
    }
    const turnId = conversation.providerTurnIds.get(event.turnId)
    if (turnId === undefined) {
      // Provider events observed while startTurn is in flight must wait for the
      // public Turn binding. Once that command has settled, an unknown Turn is
      // historical/late (including an intentionally evicted Turn), so it must
      // not accumulate forever in the short binding buffer.
      return !conversation.startingTurn
    }
    const turn = conversation.turns.get(turnId)
    if (turn === undefined) return false
    if (
      turn.record.status !== 'running' ||
      conversation.record.activeTurnId !== turnId
    ) {
      // Provider events can arrive late or be duplicated after a terminal
      // transition. Historical Turns must never mutate the current Turn.
      return true
    }

    switch (event.type) {
      case 'message.delta': {
        const itemId = publicItemId(turn, event.itemId)
        this.#options.publish({
          conversationId,
          turnId,
          itemId,
          timestamp: event.timestamp,
          type: event.type,
          payload: { delta: event.delta },
        })
        return true
      }
      case 'message.completed': {
        const itemId = publicItemId(turn, event.itemId)
        this.#options.publish({
          conversationId,
          turnId,
          itemId,
          timestamp: event.timestamp,
          type: event.type,
          payload: { message: event.message },
        })
        return true
      }
      case 'tool.started': {
        const itemId = publicItemId(turn, event.itemId)
        this.#options.publish({
          conversationId,
          turnId,
          itemId,
          timestamp: event.timestamp,
          type: event.type,
          payload: {
            kind: event.kind ?? 'generic',
            name: COMMAND_TOOL_NAME,
            command: takeTextHead(
              event.command ?? event.name,
              TOOL_COMMAND_MAX_CHARACTERS,
            ),
            ...(event.summary === undefined
              ? {}
              : {
                  summary: takeTextHead(
                    event.summary,
                    TOOL_SUMMARY_MAX_CHARACTERS,
                  ),
                }),
          },
        })
        return true
      }
      case 'tool.output': {
        const itemId = publicItemId(turn, event.itemId)
        this.#options.publish({
          conversationId,
          turnId,
          itemId,
          timestamp: event.timestamp,
          type: event.type,
          payload: {
            output: event.output,
            ...(event.stream === undefined ? {} : { stream: event.stream }),
          },
        })
        return true
      }
      case 'tool.completed': {
        const itemId = publicItemId(turn, event.itemId)
        this.#options.publish({
          conversationId,
          turnId,
          itemId,
          timestamp: event.timestamp,
          type: event.type,
          payload: {
            kind: event.kind ?? 'generic',
            name: COMMAND_TOOL_NAME,
            command: takeTextHead(
              event.command ?? event.name,
              TOOL_COMMAND_MAX_CHARACTERS,
            ),
            ...(event.success === undefined ? {} : { success: event.success }),
            ...(event.summary === undefined
              ? {}
              : {
                  summary: takeTextTail(
                    event.summary,
                    TOOL_SUMMARY_MAX_CHARACTERS,
                  ),
                }),
          },
        })
        return true
      }
      case 'file.changed': {
        const itemId =
          event.itemId === undefined
            ? undefined
            : publicItemId(turn, event.itemId)
        this.#options.publish({
          conversationId,
          turnId,
          ...(itemId === undefined ? {} : { itemId }),
          timestamp: event.timestamp,
          type: event.type,
          payload: {
            path: event.path,
            kind: event.kind,
            ...(event.diff === undefined ? {} : { diff: event.diff }),
          },
        })
        return true
      }
      case 'turn.completed': {
        this.#options.completeTurn(
          conversation,
          turn,
          'completed',
          event.timestamp,
          {
            ...(event.finalMessage === undefined
              ? {}
              : { finalMessage: event.finalMessage }),
          },
        )
        this.#options.publish({
          conversationId,
          turnId,
          timestamp: event.timestamp,
          type: event.type,
          payload: {
            ...(event.finalMessage === undefined
              ? {}
              : { finalMessage: event.finalMessage }),
          },
        })
        this.#options.executionSucceeded?.(
          conversation,
          event.provider,
          event.timestamp,
        )
        return true
      }
      case 'turn.failed': {
        const failure = classifyCanonicalFailure(
          event.error,
          event.timestamp,
          'provider_error',
        )
        const error = safeProviderHostError(event.provider, failure)
        this.#options.completeTurn(
          conversation,
          turn,
          'failed',
          event.timestamp,
          { error },
        )
        this.#options.publish({
          conversationId,
          turnId,
          timestamp: event.timestamp,
          type: event.type,
          payload: { error },
        })
        this.#options.executionFailed?.(conversation, event.provider, error)
        return true
      }
      case 'turn.interrupted': {
        this.#options.completeTurn(
          conversation,
          turn,
          'interrupted',
          event.timestamp,
          {},
        )
        this.#options.publish({
          conversationId,
          turnId,
          timestamp: event.timestamp,
          type: event.type,
          payload: {},
        })
        return true
      }
      default:
        return true
    }
  }
}

function takeTextHead(value: string, maximum: number): string {
  if (value.length <= maximum) return value
  const bounded = value.slice(0, maximum)
  const finalCodeUnit = bounded.charCodeAt(bounded.length - 1)
  return finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff
    ? bounded.slice(0, -1)
    : bounded
}

function takeTextTail(value: string, maximum: number): string {
  if (value.length <= maximum) return value
  const bounded = value.slice(-maximum)
  const firstCodeUnit = bounded.charCodeAt(0)
  return firstCodeUnit >= 0xdc00 && firstCodeUnit <= 0xdfff
    ? bounded.slice(1)
    : bounded
}

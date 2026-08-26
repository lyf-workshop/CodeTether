import type { AgentEvent } from '@codetether/agent-core'
import type {
  ConversationId,
  HostEvent,
  TurnRecord,
} from '@codetether/protocol'

import {
  publicItemId,
  type ConversationState,
  type TurnState,
} from './host-service-state.js'

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

    const conversationId = this.#options.providerThreads.get(event.threadId)
    if (conversationId === undefined) return false
    const conversation = this.#options.conversations.get(conversationId)
    if (conversation === undefined) return false
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
            name: COMMAND_TOOL_NAME,
            command: takeTextHead(event.name, TOOL_COMMAND_MAX_CHARACTERS),
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
            name: COMMAND_TOOL_NAME,
            command: takeTextHead(event.name, TOOL_COMMAND_MAX_CHARACTERS),
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
        return true
      }
      case 'turn.failed': {
        const error = {
          code: 'provider_error' as const,
          message: 'Codex Turn failed',
        }
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

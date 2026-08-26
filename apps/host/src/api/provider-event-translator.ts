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
    if (turnId === undefined) return false
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
            name: event.name,
            ...(event.summary === undefined ? {} : { summary: event.summary }),
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
            name: event.name,
            ...(event.success === undefined ? {} : { success: event.success }),
            ...(event.summary === undefined ? {} : { summary: event.summary }),
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

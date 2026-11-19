import { CodeTetherResponseError } from '@codetether/client'
import type { ActionId, CanonicalFailure } from '@codetether/protocol'

import {
  canStartNewTurnAfterFailure,
  isTurnFailureUncertain,
} from '../../failures/failure-presentation.js'
import type { ConversationReadModel } from '../../runtime/host/conversation-projection.js'
import {
  HostEpochChangedError,
  mutationErrorMessage,
} from '../../runtime/host/live-conversation-actions.js'

interface SendAttempt {
  readonly actionId: ActionId
  readonly text: string
  readonly timestamp: string
  readonly previousTurnIds: ReadonlySet<string>
}

export type OptimisticSend = SendAttempt &
  (
    | { readonly state: 'sending' }
    | { readonly state: 'accepted'; readonly turnId: string }
    | {
        readonly state: 'failed' | 'uncertain'
        readonly message: string
        readonly failure?: CanonicalFailure
        readonly canRetry: boolean
      }
  )

export type OptimisticMessage = OptimisticSend & {
  readonly projectedTurnId?: string
}

export function rejectOptimisticSend(
  attempt: OptimisticSend,
  error: unknown,
): OptimisticSend {
  if (error instanceof CodeTetherResponseError) {
    const { failure } = error.envelope
    const uncertain =
      failure === undefined
        ? error.status >= 500 || error.envelope.code === 'timeout'
        : isTurnFailureUncertain(failure)
    return {
      ...attempt,
      state: uncertain ? 'uncertain' : 'failed',
      message:
        uncertain && failure === undefined
          ? '无法确认消息是否已发送。请查看会话状态。'
          : mutationErrorMessage(error, '发送消息'),
      ...(failure === undefined ? {} : { failure }),
      canRetry: !uncertain && canStartNewTurnAfterFailure(failure),
    }
  }
  return {
    ...attempt,
    state: 'uncertain',
    message:
      error instanceof HostEpochChangedError
        ? mutationErrorMessage(error, '发送消息')
        : '无法确认消息是否已发送。请查看会话状态。',
    canRetry: false,
  }
}

export function findOptimisticTurn(
  send: OptimisticSend,
  model: ConversationReadModel,
): string | undefined {
  if (send.state === 'accepted') {
    return model.turns.some((turn) => turn.id === send.turnId)
      ? send.turnId
      : undefined
  }

  // The stream can arrive ahead of HTTP and carries Turn identity only.
  // Match the newly observed input until HTTP supplies the exact Turn ID.
  const inputs = model.messages.filter(
    (message) =>
      message.author === 'user' &&
      message.body === send.text &&
      !send.previousTurnIds.has(message.turnId),
  )
  if (send.state === 'failed') {
    const rejectedFailure = send.failure
    if (rejectedFailure === undefined) return undefined
    const inputTurnIds = new Set(inputs.map((input) => input.turnId))
    const matches = model.turns.filter((turn) => {
      if (!inputTurnIds.has(turn.id)) return false
      const failure = turn.error?.failure
      return (
        failure?.reason === rejectedFailure.reason &&
        failure.occurredAt === rejectedFailure.occurredAt
      )
    })
    if (matches.length === 1) return matches[0]?.id
    if (inputs.length !== 1) return undefined
    // Persisted starts publish a running Turn before its failure event.
    const inputTurnId = inputs[0]?.turnId
    return model.turns.some(
      (turn) => turn.id === inputTurnId && turn.status === 'running',
    )
      ? inputTurnId
      : undefined
  }
  return inputs.length === 1 ? inputs[0]?.turnId : undefined
}

import { CodeTetherResponseError } from '@codetether/client'
import {
  ActionIdSchema,
  ApprovalIdSchema,
  ConversationIdSchema,
  TurnIdSchema,
  type ActionId,
  type ApprovalDecision,
  type ApprovalId,
  type ConversationId,
  type InterruptTurnResponse,
  type ResolveApprovalResponse,
  type StartTurnResponse,
  type TurnId,
} from '@codetether/protocol'

export interface LiveConversationMutationClient {
  startTurn(
    conversationId: ConversationId,
    request: {
      readonly actionId: ActionId
      readonly input: { readonly type: 'text'; readonly text: string }
    },
  ): Promise<StartTurnResponse>
  interruptTurn(
    conversationId: ConversationId,
    turnId: TurnId,
    request: { readonly actionId: ActionId },
  ): Promise<InterruptTurnResponse>
  resolveApproval(
    approvalId: ApprovalId,
    request: {
      readonly actionId: ActionId
      readonly decision: ApprovalDecision
    },
  ): Promise<ResolveApprovalResponse>
}

export type ActionIdFactory = () => ActionId

interface StartAttempt {
  readonly text: string
  readonly actionId: ActionId
  readonly promise: Promise<StartTurnResponse>
}

interface InterruptAttempt {
  readonly actionId: ActionId
  readonly promise: Promise<InterruptTurnResponse>
}

interface ApprovalAttempt {
  readonly decision: ApprovalDecision
  readonly actionId: ActionId
  readonly promise: Promise<ResolveApprovalResponse>
}

interface RetryIntent<TIdentity> {
  readonly identity: TIdentity
  readonly actionId: ActionId
}

/** A second, different mutation cannot replace an operation already in flight. */
export class ConversationMutationBusyError extends Error {
  constructor(operation: string) {
    super(`${operation} is already in progress`)
    this.name = 'ConversationMutationBusyError'
  }
}

/**
 * Owns one logical action identity across duplicate UI calls and ambiguous
 * network retries. It never writes to the Conversation projection.
 */
export class LiveConversationActions {
  readonly #client: LiveConversationMutationClient
  readonly #createActionId: ActionIdFactory
  readonly #starts = new Map<string, StartAttempt>()
  readonly #startRetries = new Map<string, RetryIntent<string>>()
  readonly #interrupts = new Map<string, InterruptAttempt>()
  readonly #interruptRetries = new Map<string, RetryIntent<true>>()
  readonly #approvals = new Map<string, ApprovalAttempt>()
  readonly #approvalRetries = new Map<string, RetryIntent<ApprovalDecision>>()

  constructor(
    client: LiveConversationMutationClient,
    createActionId: ActionIdFactory = createBrowserActionId,
  ) {
    this.#client = client
    this.#createActionId = createActionId
  }

  startTurn(conversationId: string, text: string): Promise<StartTurnResponse> {
    const conversation = ConversationIdSchema.parse(conversationId)
    const current = this.#starts.get(conversation)
    if (current !== undefined) {
      if (current.text === text) return current.promise
      return Promise.reject(new ConversationMutationBusyError('Start Turn'))
    }

    const retry = this.#startRetries.get(conversation)
    const actionId =
      retry?.identity === text ? retry.actionId : this.#createActionId()
    const promise = this.#client
      .startTurn(conversation, {
        actionId,
        input: { type: 'text', text },
      })
      .then((response) => {
        this.#startRetries.delete(conversation)
        return response
      })
      .catch((error: unknown) => {
        this.#rememberAmbiguousRetry(
          this.#startRetries,
          conversation,
          { identity: text, actionId },
          error,
        )
        throw error
      })
      .finally(() => {
        if (this.#starts.get(conversation)?.promise === promise) {
          this.#starts.delete(conversation)
        }
      })
    this.#starts.set(conversation, { text, actionId, promise })
    return promise
  }

  interruptTurn(
    conversationId: string,
    turnId: string,
  ): Promise<InterruptTurnResponse> {
    const conversation = ConversationIdSchema.parse(conversationId)
    const turn = TurnIdSchema.parse(turnId)
    const key = `${conversation}:${turn}`
    const current = this.#interrupts.get(key)
    if (current !== undefined) return current.promise

    const retry = this.#interruptRetries.get(key)
    const actionId = retry?.actionId ?? this.#createActionId()
    const promise = this.#client
      .interruptTurn(conversation, turn, { actionId })
      .then((response) => {
        this.#interruptRetries.delete(key)
        return response
      })
      .catch((error: unknown) => {
        this.#rememberAmbiguousRetry(
          this.#interruptRetries,
          key,
          { identity: true, actionId },
          error,
        )
        throw error
      })
      .finally(() => {
        if (this.#interrupts.get(key)?.promise === promise) {
          this.#interrupts.delete(key)
        }
      })
    this.#interrupts.set(key, { actionId, promise })
    return promise
  }

  resolveApproval(
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<ResolveApprovalResponse> {
    const approval = ApprovalIdSchema.parse(approvalId)
    const current = this.#approvals.get(approval)
    if (current !== undefined) {
      if (current.decision === decision) return current.promise
      return Promise.reject(
        new ConversationMutationBusyError('Approval resolution'),
      )
    }

    const retry = this.#approvalRetries.get(approval)
    const actionId =
      retry?.identity === decision ? retry.actionId : this.#createActionId()
    const promise = this.#client
      .resolveApproval(approval, { actionId, decision })
      .then((response) => {
        this.#approvalRetries.delete(approval)
        return response
      })
      .catch((error: unknown) => {
        this.#rememberAmbiguousRetry(
          this.#approvalRetries,
          approval,
          { identity: decision, actionId },
          error,
        )
        throw error
      })
      .finally(() => {
        if (this.#approvals.get(approval)?.promise === promise) {
          this.#approvals.delete(approval)
        }
      })
    this.#approvals.set(approval, { decision, actionId, promise })
    return promise
  }

  #rememberAmbiguousRetry<TIdentity>(
    retries: Map<string, RetryIntent<TIdentity>>,
    key: string,
    retry: RetryIntent<TIdentity>,
    error: unknown,
  ): void {
    if (error instanceof CodeTetherResponseError) retries.delete(key)
    else retries.set(key, retry)
  }
}

export function createBrowserActionId(): ActionId {
  const randomUUID = globalThis.crypto?.randomUUID
  if (randomUUID === undefined) {
    throw new Error('Secure random action IDs are unavailable')
  }
  return ActionIdSchema.parse(`act_${randomUUID.call(globalThis.crypto)}`)
}

/** Safe, concise product copy; Provider payloads never cross this boundary. */
export function mutationErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ConversationMutationBusyError) {
    return '已有操作正在提交，请稍候。'
  }
  if (!(error instanceof CodeTetherResponseError)) {
    return '无法连接到 CodeTether Host，请检查连接后重试。'
  }

  switch (error.envelope.code) {
    case 'invalid_request':
      return '请求内容无效，请检查后重试。'
    case 'not_found':
      return '目标会话或操作已不存在。'
    case 'conflict':
      return '会话状态已经变化，请刷新后重试。'
    case 'unsupported':
      return '当前 Host 不支持此操作。'
    case 'runtime_unavailable':
      return 'Codex Runtime 当前不可用。'
    case 'timeout':
      return '操作等待超时，请重试。'
    case 'provider_error':
      return `Codex 未能${fallback}。`
    case 'internal':
      return `Host 未能${fallback}。`
  }
}

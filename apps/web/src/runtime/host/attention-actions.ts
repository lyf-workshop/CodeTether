import {
  CodeTetherIncompatibleProtocolError,
  CodeTetherProtocolError,
  CodeTetherResponseError,
} from '@codetether/client'
import {
  AttentionIdSchema,
  type ActionId,
  type AttentionId,
  type EpochId,
  type ResolveAttentionResponse,
} from '@codetether/protocol'

import { createBrowserActionId, type ActionIdFactory } from './action-id.js'
import { HostEpochChangedError } from './live-conversation-actions.js'

export interface AttentionMutationClient {
  resolveAttention(
    attentionId: AttentionId,
    actionId: ActionId,
  ): Promise<ResolveAttentionResponse>
}

interface ResolveAttempt {
  readonly actionId: ActionId
  readonly promise: Promise<ResolveAttentionResponse>
}

/** Owns one idempotent browser intent per explicit review/acknowledgement. */
export class AttentionActions {
  readonly #client: AttentionMutationClient
  readonly #createActionId: ActionIdFactory
  readonly #attempts = new Map<AttentionId, ResolveAttempt>()
  readonly #ambiguousRetries = new Map<AttentionId, ActionId>()
  #hostEpoch?: EpochId
  #epochAbortController = new AbortController()

  constructor(
    client: AttentionMutationClient,
    createActionId: ActionIdFactory = createBrowserActionId,
  ) {
    this.#client = client
    this.#createActionId = createActionId
  }

  adoptHostEpoch(epoch: EpochId): void {
    if (this.#hostEpoch === epoch) return
    const previousEpoch = this.#epochAbortController
    this.#hostEpoch = epoch
    this.#epochAbortController = new AbortController()
    this.#attempts.clear()
    this.#ambiguousRetries.clear()
    previousEpoch.abort(new HostEpochChangedError())
  }

  resolveAttention(
    attentionId: AttentionId | string,
  ): Promise<ResolveAttentionResponse> {
    const attention = AttentionIdSchema.parse(attentionId)
    const current = this.#attempts.get(attention)
    if (current !== undefined) return current.promise

    const actionId =
      this.#ambiguousRetries.get(attention) ?? this.#createActionId()
    const signal = this.#epochAbortController.signal
    const promise = rejectOnEpochChange(
      this.#client.resolveAttention(attention, actionId),
      signal,
    )
      .then((response) => {
        this.#ambiguousRetries.delete(attention)
        return response
      })
      .catch((error: unknown) => {
        if (error instanceof CodeTetherResponseError) {
          this.#ambiguousRetries.delete(attention)
        } else if (!(error instanceof HostEpochChangedError)) {
          this.#ambiguousRetries.set(attention, actionId)
        }
        throw error
      })
      .finally(() => {
        if (this.#attempts.get(attention)?.promise === promise) {
          this.#attempts.delete(attention)
        }
      })
    this.#attempts.set(attention, { actionId, promise })
    return promise
  }
}

function rejectOnEpochChange<T>(
  request: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) return Promise.reject(epochChangeReason(signal))

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      cleanup()
      reject(epochChangeReason(signal))
    }
    const cleanup = (): void => signal.removeEventListener('abort', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
    void request.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      },
    )
  })
}

function epochChangeReason(signal: AbortSignal): HostEpochChangedError {
  return signal.reason instanceof HostEpochChangedError
    ? signal.reason
    : new HostEpochChangedError()
}

/** Stable product copy; Host and Provider diagnostics remain private. */
export function attentionErrorMessage(error: unknown): string {
  if (error instanceof HostEpochChangedError) {
    return 'CodeTether 已重新连接，请确认当前待处理状态后重试。'
  }
  if (error instanceof CodeTetherIncompatibleProtocolError) {
    return '当前 CodeTether 版本不兼容，请更新应用后重试。'
  }
  if (error instanceof CodeTetherProtocolError) {
    return 'CodeTether 暂时无法读取数据，请重试。'
  }
  if (!(error instanceof CodeTetherResponseError)) {
    return 'CodeTether 暂时无法连接，请重试。'
  }

  switch (error.envelope.code) {
    case 'not_found':
      return '该待处理事项已不存在。'
    case 'conflict':
      return '该事项的状态已经变化，请稍候重试。'
    case 'unsupported':
      return '当前事项不能通过此操作处理。'
    case 'timeout':
      return '操作等待超时，请重试。'
    case 'project_unavailable':
      return '项目目录当前不可用，但历史仍可查看。'
    case 'runtime_unavailable':
    case 'provider_not_installed':
    case 'provider_version_unsupported':
    case 'provider_unavailable':
      return '智能体当前不可用。'
    case 'invalid_request':
      return '请求无效，请刷新后重试。'
    case 'provider_session_lost':
    case 'provider_conversation_unavailable':
      return '智能体已无法恢复此会话；本地历史仍可查看。'
    case 'provider_error':
    case 'provider_start_failed':
    case 'conversation_archived':
    case 'project_has_conversations':
    case 'project_location_invalid':
    case 'project_location_missing':
    case 'project_location_inaccessible':
    case 'project_location_conflict':
    case 'project_location_not_found':
    case 'project_location_has_conversations':
    case 'project_location_local_required':
    case 'machine_has_project_locations':
    case 'machine_pairing_code_invalid':
    case 'machine_pairing_code_expired':
    case 'machine_pairing_rate_limited':
    case 'machine_authentication_failed':
    case 'machine_identity_mismatch':
    case 'machine_unreachable':
    case 'machine_protocol_incompatible':
    case 'machine_connection_failed':
    case 'internal':
      return 'CodeTether 未能处理该事项。'
  }
}

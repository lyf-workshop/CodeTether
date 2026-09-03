import {
  CodeTetherIncompatibleProtocolError,
  CodeTetherProtocolError,
  CodeTetherResponseError,
} from '@codetether/client'
import {
  ConversationIdSchema,
  type ArchiveConversationRequest,
  type ArchiveConversationResponse,
  type ConversationId,
  type ConversationSummary,
  type GetConversationResponse,
  type PinConversationRequest,
  type PinConversationResponse,
  type RenameConversationRequest,
  type RenameConversationResponse,
  type UnarchiveConversationRequest,
  type UnarchiveConversationResponse,
  type UnpinConversationRequest,
  type UnpinConversationResponse,
} from '@codetether/protocol'
import type { QueryClient } from '@tanstack/react-query'

import { createBrowserActionId, type ActionIdFactory } from './action-id.js'
import { conversationDetailQueryKeys } from './conversation-detail-query.js'
import { conversationListQueryKeys } from './conversation-list-query.js'
import { conversationSearchQueryKeys } from './conversation-search-query.js'

export interface ConversationOrganizationMutationClient {
  renameConversation(
    conversationId: ConversationId,
    request: RenameConversationRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<RenameConversationResponse>
  pinConversation(
    conversationId: ConversationId,
    request: PinConversationRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<PinConversationResponse>
  unpinConversation(
    conversationId: ConversationId,
    request: UnpinConversationRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<UnpinConversationResponse>
  archiveConversation(
    conversationId: ConversationId,
    request: ArchiveConversationRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ArchiveConversationResponse>
  unarchiveConversation(
    conversationId: ConversationId,
    request: UnarchiveConversationRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<UnarchiveConversationResponse>
}

export type ConversationOrganizationOperation =
  'rename' | 'pin' | 'unpin' | 'archive' | 'unarchive'

type ConversationOrganizationResponse =
  | RenameConversationResponse
  | PinConversationResponse
  | UnpinConversationResponse
  | ArchiveConversationResponse
  | UnarchiveConversationResponse

interface OrganizationAttempt {
  readonly identity: string
  readonly promise: Promise<ConversationOrganizationResponse>
}

export class ConversationOrganizationMutationBusyError extends Error {
  constructor() {
    super('The same Conversation organization mutation is already in progress')
    this.name = 'ConversationOrganizationMutationBusyError'
  }
}

/**
 * Owns browser action identity and duplicate-submit guards for durable
 * Conversation organization. Host responses remain the only final truth: no
 * pinned, archived, or title state is manufactured before a mutation succeeds.
 */
export class ConversationOrganizationActions {
  readonly #client: ConversationOrganizationMutationClient
  readonly #queryClient: QueryClient
  readonly #createActionId: ActionIdFactory
  readonly #attempts = new Map<string, OrganizationAttempt>()

  constructor(
    client: ConversationOrganizationMutationClient,
    queryClient: QueryClient,
    createActionId: ActionIdFactory = createBrowserActionId,
  ) {
    this.#client = client
    this.#queryClient = queryClient
    this.#createActionId = createActionId
  }

  renameConversation(
    conversationId: ConversationId | string,
    title: string,
  ): Promise<RenameConversationResponse> {
    const conversation = ConversationIdSchema.parse(conversationId)
    return this.#run('rename', conversation, title, () =>
      this.#client.renameConversation(conversation, {
        actionId: this.#createActionId(),
        title,
      }),
    )
  }

  pinConversation(
    conversationId: ConversationId | string,
  ): Promise<PinConversationResponse> {
    const conversation = ConversationIdSchema.parse(conversationId)
    return this.#run('pin', conversation, '', () =>
      this.#client.pinConversation(conversation, {
        actionId: this.#createActionId(),
      }),
    )
  }

  unpinConversation(
    conversationId: ConversationId | string,
  ): Promise<UnpinConversationResponse> {
    const conversation = ConversationIdSchema.parse(conversationId)
    return this.#run('unpin', conversation, '', () =>
      this.#client.unpinConversation(conversation, {
        actionId: this.#createActionId(),
      }),
    )
  }

  archiveConversation(
    conversationId: ConversationId | string,
  ): Promise<ArchiveConversationResponse> {
    const conversation = ConversationIdSchema.parse(conversationId)
    return this.#run('archive', conversation, '', () =>
      this.#client.archiveConversation(conversation, {
        actionId: this.#createActionId(),
      }),
    )
  }

  unarchiveConversation(
    conversationId: ConversationId | string,
  ): Promise<UnarchiveConversationResponse> {
    const conversation = ConversationIdSchema.parse(conversationId)
    return this.#run('unarchive', conversation, '', () =>
      this.#client.unarchiveConversation(conversation, {
        actionId: this.#createActionId(),
      }),
    )
  }

  #run<TResponse extends ConversationOrganizationResponse>(
    operation: ConversationOrganizationOperation,
    conversationId: ConversationId,
    identity: string,
    request: () => Promise<TResponse>,
  ): Promise<TResponse> {
    const key = `${operation}:${conversationId}`
    const current = this.#attempts.get(key)
    if (current !== undefined) {
      return current.identity === identity
        ? (current.promise as Promise<TResponse>)
        : Promise.reject(new ConversationOrganizationMutationBusyError())
    }

    const promise = request()
      .then((response) => {
        this.#acceptSummary(response.data.conversation)
        return response
      })
      .finally(() => {
        if (this.#attempts.get(key)?.promise === promise) {
          this.#attempts.delete(key)
        }
      })
    this.#attempts.set(key, { identity, promise })
    return promise
  }

  #acceptSummary(summary: ConversationSummary): void {
    this.#queryClient.setQueryData<GetConversationResponse>(
      conversationDetailQueryKeys.detail(summary.conversationId),
      (current) =>
        current === undefined
          ? undefined
          : { ...current, conversation: summary },
    )

    // Active and archived indexes have separate cache identities. Refetch both
    // after the Host accepts a mutation so ordering and membership stay Host-owned.
    void this.#queryClient.invalidateQueries({
      queryKey: conversationListQueryKeys.projectScope(summary.projectId),
    })
    void this.#queryClient.invalidateQueries({
      queryKey: conversationSearchQueryKeys.projectScope(summary.projectId),
    })
  }
}

/** Stable product copy; raw Host/provider diagnostics remain private. */
export function conversationOrganizationErrorMessage(
  error: unknown,
  operation: ConversationOrganizationOperation,
): string {
  if (error instanceof ConversationOrganizationMutationBusyError) {
    return '此会话的相同操作正在处理中，请稍候。'
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
    case 'invalid_request':
      return operation === 'rename'
        ? '请输入有效且长度合适的会话标题。'
        : '此会话操作无效，请刷新后重试。'
    case 'not_found':
      return '该会话不存在或已不可用。'
    case 'conflict':
      return operation === 'archive'
        ? '会话状态已变化；运行中或等待确认的会话暂时不能归档。'
        : '会话状态已变化，请刷新后重试。'
    case 'conversation_archived':
      return '此会话已归档，请先恢复后再继续。'
    case 'project_unavailable':
      return '项目目录当前不可用，但会话历史仍可查看。'
    case 'unsupported':
      return '当前 CodeTether 版本不支持此会话操作。'
    case 'timeout':
      return '会话操作等待超时，请重试。'
    case 'runtime_unavailable':
      return 'CodeTether 服务暂时不可用。'
    case 'provider_error':
    case 'provider_not_installed':
    case 'provider_version_unsupported':
    case 'provider_start_failed':
    case 'provider_session_lost':
    case 'provider_unavailable':
    case 'provider_conversation_unavailable':
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
    case 'relay_not_configured':
    case 'relay_unreachable':
    case 'relay_authentication_failed':
    case 'relay_identity_mismatch':
    case 'relay_protocol_incompatible':
    case 'relay_revoked':
    case 'relay_rate_limited':
    case 'internal':
      return 'CodeTether 未能完成此会话操作。'
  }
}

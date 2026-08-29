import {
  CodeTetherIncompatibleProtocolError,
  CodeTetherProtocolError,
  CodeTetherResponseError,
} from '@codetether/client'
import {
  ProjectIdSchema,
  type CreateConversationRequest,
  type CreateConversationResponse,
  type ProjectId,
} from '@codetether/protocol'

import { createBrowserActionId, type ActionIdFactory } from './action-id.js'

export interface NewConversationMutationClient {
  createConversation(
    request: CreateConversationRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<CreateConversationResponse>
}

interface CreationAttempt {
  readonly projectId: ProjectId
  readonly promise: Promise<CreateConversationResponse>
}

export class ConversationCreationBusyError extends Error {
  constructor() {
    super('A Conversation creation is already in progress')
    this.name = 'ConversationCreationBusyError'
  }
}

/** Owns one fresh action identity and one in-flight create per user submit. */
export class NewConversationActions {
  readonly #client: NewConversationMutationClient
  readonly #createActionId: ActionIdFactory
  #attempt?: CreationAttempt

  constructor(
    client: NewConversationMutationClient,
    createActionId: ActionIdFactory = createBrowserActionId,
  ) {
    this.#client = client
    this.#createActionId = createActionId
  }

  createConversation(
    projectId: ProjectId | string,
  ): Promise<CreateConversationResponse> {
    const project = ProjectIdSchema.parse(projectId)
    const current = this.#attempt
    if (current !== undefined) {
      return current.projectId === project
        ? current.promise
        : Promise.reject(new ConversationCreationBusyError())
    }

    const request: CreateConversationRequest = {
      actionId: this.#createActionId(),
      provider: 'codex',
      projectId: project,
    }
    const promise = this.#client
      .createConversation(request)
      .then((response) => {
        if (response.data.conversation.projectId !== project) {
          throw new CodeTetherProtocolError(
            'Created Conversation does not belong to the requested Project',
          )
        }
        return response
      })
      .finally(() => {
        if (this.#attempt?.promise === promise) this.#attempt = undefined
      })
    this.#attempt = { projectId: project, promise }
    return promise
  }
}

/** Stable product copy; raw Host and provider diagnostics remain private. */
export function newConversationErrorMessage(error: unknown): string {
  if (error instanceof ConversationCreationBusyError) {
    return '已有会话正在创建，请稍候。'
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
      return '会话配置无效，请刷新后重试。'
    case 'not_found':
      return '项目不存在或已被移除。'
    case 'conflict':
      return '项目状态已经变化，请刷新后重试。'
    case 'project_unavailable':
      return '项目目录当前不可用，暂时不能创建会话。'
    case 'runtime_unavailable':
      return 'Codex 当前不可用。'
    case 'unsupported':
      return '当前 CodeTether 版本不支持创建 Codex 会话。'
    case 'timeout':
      return '创建会话等待超时，请重试。'
    case 'provider_error':
    case 'provider_conversation_unavailable':
      return 'Codex 未能创建会话。'
    case 'conversation_archived':
    case 'project_has_conversations':
    case 'internal':
      return 'CodeTether 未能创建会话。'
  }
}

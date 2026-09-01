import {
  CodeTetherIncompatibleProtocolError,
  CodeTetherProtocolError,
  CodeTetherResponseError,
} from '@codetether/client'
import {
  ProjectIdSchema,
  MachineIdSchema,
  type CreateConversationRequest,
  type CreateConversationResponse,
  type ProjectId,
  type MachineId,
  type ProviderId,
} from '@codetether/protocol'

import { createBrowserActionId, type ActionIdFactory } from './action-id.js'
import { providerDisplayName } from '../../provider/provider-presentation.js'

export interface NewConversationMutationClient {
  createConversation(
    request: CreateConversationRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<CreateConversationResponse>
}

interface CreationAttempt {
  readonly projectId: ProjectId
  readonly machineId: MachineId
  readonly provider: ProviderId
  readonly model?: string
  readonly reasoning?: string
  readonly promise: Promise<CreateConversationResponse>
}

export interface CreateConversationOptions {
  readonly machineId: MachineId
  readonly provider: ProviderId
  readonly model?: string
  readonly reasoning?: string
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
    options: CreateConversationOptions,
  ): Promise<CreateConversationResponse> {
    const project = ProjectIdSchema.parse(projectId)
    const machine = MachineIdSchema.parse(options.machineId)
    const current = this.#attempt
    if (current !== undefined) {
      return current.projectId === project &&
        current.machineId === machine &&
        current.provider === options.provider &&
        current.model === options.model &&
        current.reasoning === options.reasoning
        ? current.promise
        : Promise.reject(new ConversationCreationBusyError())
    }

    const request: CreateConversationRequest = {
      actionId: this.#createActionId(),
      provider: options.provider,
      machineId: machine,
      projectId: project,
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.reasoning === undefined
        ? {}
        : { reasoning: options.reasoning }),
    }
    const promise = this.#client
      .createConversation(request)
      .then((response) => {
        if (response.data.conversation.projectId !== project) {
          throw new CodeTetherProtocolError(
            'Created Conversation does not belong to the requested Project',
          )
        }
        if (response.data.conversation.machineId !== machine) {
          throw new CodeTetherProtocolError(
            'Created Conversation does not belong to the requested Machine',
          )
        }
        if (response.data.conversation.provider !== options.provider) {
          throw new CodeTetherProtocolError(
            'Created Conversation does not belong to the requested Provider',
          )
        }
        return response
      })
      .finally(() => {
        if (this.#attempt?.promise === promise) this.#attempt = undefined
      })
    this.#attempt = {
      projectId: project,
      machineId: machine,
      provider: options.provider,
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.reasoning === undefined
        ? {}
        : { reasoning: options.reasoning }),
      promise,
    }
    return promise
  }
}

/** Stable product copy; raw Host and provider diagnostics remain private. */
export function newConversationErrorMessage(
  error: unknown,
  provider: ProviderId = 'codex',
): string {
  const providerName = providerDisplayName(provider)
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
      return '项目或机器不存在，或已被移除。'
    case 'conflict':
      return '项目状态已经变化，请刷新后重试。'
    case 'project_unavailable':
      return '项目目录当前不可用，暂时不能创建会话。'
    case 'runtime_unavailable':
    case 'provider_unavailable':
      return `${providerName} 当前不可用。`
    case 'provider_not_installed':
      return `${providerName} 尚未安装。`
    case 'provider_version_unsupported':
      return `${providerName} 版本不受支持。`
    case 'unsupported':
      return `当前 CodeTether 版本不支持创建 ${providerName} 会话。`
    case 'timeout':
      return '创建会话等待超时，请重试。'
    case 'provider_error':
    case 'provider_start_failed':
    case 'provider_session_lost':
    case 'provider_conversation_unavailable':
      return `${providerName} 未能创建会话。`
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
      return 'CodeTether 未能创建会话。'
  }
}

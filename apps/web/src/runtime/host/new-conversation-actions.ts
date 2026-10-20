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
  type ActionId,
  type ProjectId,
  type MachineId,
  type ProviderId,
} from '@codetether/protocol'

import { createBrowserActionId, type ActionIdFactory } from './action-id.js'
import { canonicalFailureActionPresentation } from '../../failures/failure-presentation.js'
import { providerDisplayName } from '../../provider/provider-presentation.js'

export interface NewConversationMutationClient {
  createConversation(
    request: CreateConversationRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<CreateConversationResponse>
}

interface CreationIdentity {
  readonly projectId: ProjectId
  readonly machineId: MachineId
  readonly provider: ProviderId
  readonly model?: string
  readonly reasoning?: string
}

interface CreationAttempt extends CreationIdentity {
  readonly promise: Promise<CreateConversationResponse>
}

interface CreationRetry extends CreationIdentity {
  readonly actionId: ActionId
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

/** One create intent survives duplicate submits and ambiguous manual retries. */
export class NewConversationActions {
  readonly #client: NewConversationMutationClient
  readonly #createActionId: ActionIdFactory
  #attempt?: CreationAttempt
  #retry?: CreationRetry

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
      return sameCreation(current, project, machine, options)
        ? current.promise
        : Promise.reject(new ConversationCreationBusyError())
    }

    const retry = this.#retry
    const request: CreateConversationRequest = {
      actionId:
        retry !== undefined && sameCreation(retry, project, machine, options)
          ? retry.actionId
          : this.#createActionId(),
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
        this.#retry = undefined
        return response
      })
      .catch((error: unknown) => {
        // An explicit Host response is definitive. Any lost or malformed reply
        // may already have created the conversation: only a user retry reuses
        // this exact identity, never an automatic request.
        this.#retry =
          error instanceof CodeTetherResponseError ? undefined : request
        throw error
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

function sameCreation(
  identity: CreationIdentity,
  projectId: ProjectId,
  machineId: MachineId,
  options: CreateConversationOptions,
): boolean {
  return (
    identity.projectId === projectId &&
    identity.machineId === machineId &&
    identity.provider === options.provider &&
    identity.model === options.model &&
    identity.reasoning === options.reasoning
  )
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

  if (error.envelope.failure !== undefined) {
    const presentation = canonicalFailureActionPresentation(
      error.envelope.failure,
      { providerDisplayName: providerName },
    )
    return `${presentation.cause} ${presentation.guidance}`
  }

  switch (error.envelope.code) {
    case 'invalid_request':
      return '会话配置无效，请刷新后重试。'
    case 'not_found':
      return '项目或电脑不存在，或已被移除。'
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
    case 'relay_not_configured':
    case 'relay_unreachable':
    case 'relay_authentication_failed':
    case 'relay_identity_mismatch':
    case 'relay_protocol_incompatible':
    case 'relay_revoked':
    case 'relay_rate_limited':
    case 'provider_session_discovery_unavailable':
    case 'provider_session_format_unsupported':
    case 'provider_session_store_unreadable':
    case 'installation_not_found':
    case 'installation_machine_mismatch':
    case 'installation_provider_mismatch':
    case 'installation_incompatible':
    case 'installation_not_ready':
    case 'selection_conflict':
    case 'selection_persistence_failed':
    case 'provider_session_candidate_expired':
    case 'internal':
      return 'CodeTether 未能创建会话。'
  }
}

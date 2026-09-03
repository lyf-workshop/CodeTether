import {
  CodeTetherIncompatibleProtocolError,
  CodeTetherProtocolError,
  CodeTetherResponseError,
} from '@codetether/client'
import {
  ProjectIdSchema,
  MachineIdSchema,
  type CreateProjectRequest,
  type CreateProjectResponse,
  type DeleteProjectRequest,
  type DeleteProjectResponse,
  type MachineId,
  type ProjectId,
  type RegisterProjectLocationRequest,
  type RegisterProjectLocationResponse,
  type RemoveProjectLocationRequest,
  type RemoveProjectLocationResponse,
} from '@codetether/protocol'
import type { QueryClient } from '@tanstack/react-query'

import { createBrowserActionId, type ActionIdFactory } from './action-id.js'
import { machineQueryKeys } from './machine-query.js'
import { projectQueryKeys, upsertProjectCache } from './project-query.js'

export interface ProjectMutationClient {
  createProject(
    request: CreateProjectRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<CreateProjectResponse>
  deleteProject(
    projectId: ProjectId,
    request: DeleteProjectRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<DeleteProjectResponse>
  registerProjectLocation(
    projectId: ProjectId,
    request: RegisterProjectLocationRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<RegisterProjectLocationResponse>
  removeProjectLocation(
    projectId: ProjectId,
    machineId: MachineId,
    request: RemoveProjectLocationRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<RemoveProjectLocationResponse>
}

export type ProjectOperation =
  'load' | 'create' | 'register-location' | 'remove-location' | 'remove'

interface CreateAttempt {
  readonly identity: string
  readonly promise: Promise<CreateProjectResponse>
}

export class ProjectMutationBusyError extends Error {
  constructor() {
    super('A Project mutation is already in progress')
    this.name = 'ProjectMutationBusyError'
  }
}

export class ProjectInputError extends Error {
  constructor() {
    super('Project path is required')
    this.name = 'ProjectInputError'
  }
}

/**
 * Owns browser action identity and duplicate-submit guards. Project data still
 * comes exclusively from Host responses and the TanStack Query cache.
 */
export class ProjectActions {
  readonly #client: ProjectMutationClient
  readonly #createActionId: ActionIdFactory
  readonly #queryClient?: QueryClient
  #createAttempt?: CreateAttempt
  readonly #deleteAttempts = new Map<
    ProjectId,
    Promise<DeleteProjectResponse>
  >()
  readonly #locationAttempts = new Map<
    string,
    Promise<RegisterProjectLocationResponse>
  >()
  readonly #locationRemovalAttempts = new Map<
    string,
    Promise<RemoveProjectLocationResponse>
  >()

  constructor(
    client: ProjectMutationClient,
    createActionId: ActionIdFactory = createBrowserActionId,
    queryClient?: QueryClient,
  ) {
    this.#client = client
    this.#createActionId = createActionId
    this.#queryClient = queryClient
  }

  registerProjectLocation(
    projectId: ProjectId | string,
    input: {
      readonly machineId: MachineId | string
      readonly rootPath: string
    },
  ): Promise<RegisterProjectLocationResponse> {
    const project = ProjectIdSchema.parse(projectId)
    const machine = MachineIdSchema.parse(input.machineId)
    const path = input.rootPath.trim()
    if (path.length === 0) return Promise.reject(new ProjectInputError())
    const identity = JSON.stringify([project, machine, path])
    const current = this.#locationAttempts.get(identity)
    if (current !== undefined) return current

    const request: RegisterProjectLocationRequest = {
      actionId: this.#createActionId(),
      machineId: machine,
      path,
    }
    const promise = this.#client
      .registerProjectLocation(project, request)
      .then((response) => {
        if (this.#queryClient !== undefined) {
          upsertProjectCache(this.#queryClient, response.data.project)
          void this.#queryClient.invalidateQueries({
            queryKey: projectQueryKeys.list,
            exact: true,
          })
          void this.#queryClient.invalidateQueries({
            queryKey: projectQueryKeys.detail(project),
            exact: true,
          })
          void this.#queryClient.invalidateQueries({
            queryKey: machineQueryKeys.detail(machine),
            exact: true,
          })
        }
        return response
      })
      .finally(() => {
        if (this.#locationAttempts.get(identity) === promise) {
          this.#locationAttempts.delete(identity)
        }
      })
    this.#locationAttempts.set(identity, promise)
    return promise
  }

  removeProjectLocation(
    projectId: ProjectId | string,
    machineId: MachineId | string,
  ): Promise<RemoveProjectLocationResponse> {
    const project = ProjectIdSchema.parse(projectId)
    const machine = MachineIdSchema.parse(machineId)
    const identity = JSON.stringify([project, machine])
    const current = this.#locationRemovalAttempts.get(identity)
    if (current !== undefined) return current

    const request: RemoveProjectLocationRequest = {
      actionId: this.#createActionId(),
    }
    const promise = this.#client
      .removeProjectLocation(project, machine, request)
      .then((response) => {
        if (this.#queryClient !== undefined) {
          upsertProjectCache(this.#queryClient, response.data.project)
          void this.#queryClient.invalidateQueries({
            queryKey: projectQueryKeys.list,
            exact: true,
          })
          void this.#queryClient.invalidateQueries({
            queryKey: projectQueryKeys.detail(project),
            exact: true,
          })
          void this.#queryClient.invalidateQueries({
            queryKey: machineQueryKeys.list,
            exact: true,
          })
          void this.#queryClient.invalidateQueries({
            queryKey: machineQueryKeys.detail(machine),
            exact: true,
          })
        }
        return response
      })
      .finally(() => {
        if (this.#locationRemovalAttempts.get(identity) === promise) {
          this.#locationRemovalAttempts.delete(identity)
        }
      })
    this.#locationRemovalAttempts.set(identity, promise)
    return promise
  }

  createProject(path: string, name?: string): Promise<CreateProjectResponse> {
    const normalizedPath = path.trim()
    if (normalizedPath.length === 0) {
      return Promise.reject(new ProjectInputError())
    }
    const normalizedName = name?.trim() || undefined
    const identity = JSON.stringify([normalizedPath, normalizedName])
    const current = this.#createAttempt
    if (current !== undefined) {
      return current.identity === identity
        ? current.promise
        : Promise.reject(new ProjectMutationBusyError())
    }

    const request: CreateProjectRequest = {
      actionId: this.#createActionId(),
      path: normalizedPath,
      ...(normalizedName === undefined ? {} : { name: normalizedName }),
    }
    const promise = this.#client.createProject(request).finally(() => {
      if (this.#createAttempt?.promise === promise) {
        this.#createAttempt = undefined
      }
    })
    this.#createAttempt = { identity, promise }
    return promise
  }

  deleteProject(projectId: ProjectId | string): Promise<DeleteProjectResponse> {
    const project = ProjectIdSchema.parse(projectId)
    const current = this.#deleteAttempts.get(project)
    if (current !== undefined) return current

    const request: DeleteProjectRequest = { actionId: this.#createActionId() }
    const promise = this.#client.deleteProject(project, request).finally(() => {
      if (this.#deleteAttempts.get(project) === promise) {
        this.#deleteAttempts.delete(project)
      }
    })
    this.#deleteAttempts.set(project, promise)
    return promise
  }
}

export function projectCreateSuccessMessage(created: boolean): string {
  return created ? '项目已添加。' : '项目已存在，已打开现有项目。'
}

/** Maps only stable error identity; raw Host/provider diagnostics stay hidden. */
export function projectErrorMessage(
  error: unknown,
  operation: ProjectOperation,
): string {
  if (error instanceof ProjectInputError) return '请输入项目的绝对路径。'
  if (error instanceof ProjectMutationBusyError) {
    return '已有项目操作正在提交，请稍候。'
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
      return operation === 'create'
        ? '项目路径无效或当前无法访问，请确认它是允许访问的绝对目录。'
        : '项目请求无效，请刷新后重试。'
    case 'not_found':
      return '项目不存在或已被移除。'
    case 'conflict':
      return '项目状态已经变化，请刷新后重试。'
    case 'project_unavailable':
      return '项目目录当前不可用；恢复原目录后 CodeTether 会重新识别。'
    case 'project_location_invalid':
      return '工作区路径无效；请输入所选机器上的绝对目录路径。'
    case 'project_location_missing':
      return '所选机器上不存在该目录。'
    case 'project_location_inaccessible':
      return '所选机器当前无法访问该目录。'
    case 'project_location_conflict':
      return '此项目已在所选机器上注册了工作区位置。'
    case 'project_location_not_found':
      return '工作区位置不存在或已被移除。'
    case 'project_location_has_conversations':
      return '此工作区位置仍有关联会话，当前不能移除。'
    case 'project_location_local_required':
      return '本地工作区位置属于当前项目授权，不能单独移除。'
    case 'machine_has_project_locations':
      return '这台机器仍有关联项目位置，当前不能取消配对。'
    case 'project_has_conversations':
      return '此项目仍有关联会话，当前不能移除。'
    case 'unsupported':
      return '当前 CodeTether 版本不支持此项目操作。'
    case 'timeout':
      return '项目操作等待超时，请重试。'
    case 'runtime_unavailable':
      return 'CodeTether 本地服务暂时不可用。'
    case 'provider_error':
    case 'provider_not_installed':
    case 'provider_version_unsupported':
    case 'provider_start_failed':
    case 'provider_session_lost':
    case 'provider_unavailable':
    case 'provider_conversation_unavailable':
    case 'conversation_archived':
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
      return operation === 'load'
        ? 'CodeTether 未能读取项目。'
        : operation === 'create'
          ? 'CodeTether 未能添加项目。'
          : operation === 'remove-location'
            ? 'CodeTether 未能移除工作区位置。'
            : 'CodeTether 未能移除项目。'
  }
}

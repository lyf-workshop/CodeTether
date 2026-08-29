import {
  CodeTetherIncompatibleProtocolError,
  CodeTetherProtocolError,
  CodeTetherResponseError,
} from '@codetether/client'
import {
  ProjectIdSchema,
  type CreateProjectRequest,
  type CreateProjectResponse,
  type DeleteProjectRequest,
  type DeleteProjectResponse,
  type ProjectId,
} from '@codetether/protocol'

import { createBrowserActionId, type ActionIdFactory } from './action-id.js'

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
}

export type ProjectOperation = 'load' | 'create' | 'remove'

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
  #createAttempt?: CreateAttempt
  readonly #deleteAttempts = new Map<
    ProjectId,
    Promise<DeleteProjectResponse>
  >()

  constructor(
    client: ProjectMutationClient,
    createActionId: ActionIdFactory = createBrowserActionId,
  ) {
    this.#client = client
    this.#createActionId = createActionId
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
    case 'project_has_conversations':
      return '此项目仍有关联会话，当前不能移除。'
    case 'unsupported':
      return '当前 CodeTether 版本不支持此项目操作。'
    case 'timeout':
      return '项目操作等待超时，请重试。'
    case 'runtime_unavailable':
      return 'CodeTether 本地服务暂时不可用。'
    case 'provider_error':
    case 'provider_conversation_unavailable':
    case 'internal':
      return operation === 'load'
        ? 'CodeTether 未能读取项目。'
        : operation === 'create'
          ? 'CodeTether 未能添加项目。'
          : 'CodeTether 未能移除项目。'
  }
}

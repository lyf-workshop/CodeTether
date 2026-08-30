import { randomUUID } from 'node:crypto'
import { basename, parse } from 'node:path'

import {
  MachineIdSchema,
  ProjectIdSchema,
  ProjectLocationSchema,
  ProjectRecordSchema,
  type MachineId,
  type ProjectId,
  type ProjectRecord,
  type Timestamp,
} from '@codetether/protocol'

import { ConversationStore, type DurableProject } from '../persistence/index.js'
import { normalizeTrustedProjectRoot } from '../project-path.js'
import { WorkspacePolicy, WorkspacePolicyError } from './workspace-policy.js'

export type ProjectRegistryErrorCode =
  'invalid_path' | 'not_found' | 'has_conversations' | 'unavailable'

export class ProjectRegistryError extends Error {
  constructor(
    readonly code: ProjectRegistryErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ProjectRegistryError'
  }
}

interface ProjectRegistryOptions {
  readonly workspacePolicy: WorkspacePolicy
  readonly persistence?: ConversationStore
  readonly now: () => Timestamp
  readonly localMachineId: MachineId
  readonly writeDurable: (operation: () => void) => void
  readonly hasRuntimeConversations: (projectId: ProjectId) => boolean
}

export interface ProjectConversationReservation {
  readonly project: DurableProject
  readonly machineId: MachineId
  readonly cwd: string
  readonly release: () => void
}

export class ProjectRegistry {
  readonly #workspacePolicy: WorkspacePolicy
  readonly #persistence?: ConversationStore
  readonly #now: () => Timestamp
  readonly #localMachineId: MachineId
  readonly #writeDurable: (operation: () => void) => void
  readonly #hasRuntimeConversations: (projectId: ProjectId) => boolean
  readonly #projects = new Map<ProjectId, DurableProject>()
  readonly #projectIdsByLocationKey = new Map<string, ProjectId>()
  readonly #conversationReservations = new Map<ProjectId, number>()

  constructor(options: ProjectRegistryOptions) {
    this.#workspacePolicy = options.workspacePolicy
    this.#persistence = options.persistence
    this.#now = options.now
    this.#localMachineId = MachineIdSchema.parse(options.localMachineId)
    this.#writeDurable = options.writeDurable
    this.#hasRuntimeConversations = options.hasRuntimeConversations
    for (const project of options.persistence?.listProjects() ?? []) {
      this.#retain(project)
    }
  }

  async registerInitialRoots(roots: readonly string[]): Promise<void> {
    for (const root of roots) await this.create(root)
  }

  async create(
    path: string,
    name?: string,
  ): Promise<{ readonly project: ProjectRecord; readonly created: boolean }> {
    let rootPath: string
    try {
      rootPath = await this.#workspacePolicy.authorizeProjectRoot(path)
    } catch (error) {
      throw projectPathError(error)
    }
    const { rootPathKey } = normalizeTrustedProjectRoot(rootPath)
    const existingId = this.#projectIdsByLocationKey.get(
      locationKey(this.#localMachineId, rootPathKey),
    )
    if (existingId !== undefined) {
      return {
        project: await this.get(existingId),
        created: false,
      }
    }

    const timestamp = this.#now()
    const projectId = newProjectId()
    const project: DurableProject = {
      projectId,
      name: normalizedProjectName(name, rootPath),
      location: {
        projectId,
        machineId: this.#localMachineId,
        rootPath,
        rootPathKey,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    this.#writeDurable(() => this.#persistence?.createProject(project))
    this.#retain(project)
    return {
      project: await this.#record(project),
      created: true,
    }
  }

  async list(): Promise<readonly ProjectRecord[]> {
    return await Promise.all(
      [...this.#projects.values()]
        .sort(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) ||
            left.projectId.localeCompare(right.projectId),
        )
        .map(async (project) => await this.#record(project)),
    )
  }

  async listForMachine(
    machineId: MachineId,
  ): Promise<readonly ProjectRecord[]> {
    const id = MachineIdSchema.parse(machineId)
    return await Promise.all(
      [...this.#projects.values()]
        .filter((project) => project.location.machineId === id)
        .sort(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) ||
            left.projectId.localeCompare(right.projectId),
        )
        .map(async (project) => await this.#record(project)),
    )
  }

  async get(projectId: ProjectId): Promise<ProjectRecord> {
    return await this.#record(this.require(projectId))
  }

  require(projectId: ProjectId): DurableProject {
    const id = ProjectIdSchema.parse(projectId)
    const project = this.#projects.get(id)
    if (project === undefined) {
      throw new ProjectRegistryError('not_found', 'Project was not found')
    }
    return project
  }

  async authorizeConversation(
    projectId: ProjectId,
    machineId: MachineId,
    cwd?: string,
  ): Promise<{ readonly project: DurableProject; readonly cwd: string }> {
    const project = this.require(projectId)
    const machine = MachineIdSchema.parse(machineId)
    if (project.location.machineId !== machine) {
      throw new ProjectRegistryError(
        'unavailable',
        'Project has no authorized location on the selected Machine',
      )
    }
    try {
      return {
        project,
        cwd: await this.#workspacePolicy.authorizeProjectWorkspace(
          project.location.rootPath,
          cwd ?? project.location.rootPath,
        ),
      }
    } catch (error) {
      if (error instanceof WorkspacePolicyError) {
        throw new ProjectRegistryError(
          'unavailable',
          'Project workspace is unavailable or no longer authorized',
        )
      }
      throw error
    }
  }

  async reserveConversationCreation(
    projectId: ProjectId,
    machineId: MachineId,
    cwd?: string,
  ): Promise<ProjectConversationReservation> {
    const project = this.require(projectId)
    const release = this.#reserveConversation(project)
    try {
      const workspace = await this.authorizeConversation(
        project.projectId,
        machineId,
        cwd,
      )
      return { ...workspace, machineId: project.location.machineId, release }
    } catch (error) {
      release()
      throw error
    }
  }

  /**
   * Protocol v1 compatibility only. A legacy cwd may select an already
   * registered Project, but it can never register a path or expand trust.
   */
  async resolveLegacyConversation(
    cwd: string,
    machineId: MachineId,
  ): Promise<{ readonly project: DurableProject; readonly cwd: string }> {
    const matches: Array<{
      readonly project: DurableProject
      readonly cwd: string
    }> = []
    const machine = MachineIdSchema.parse(machineId)
    for (const project of this.#projects.values()) {
      if (project.location.machineId !== machine) continue
      try {
        matches.push({
          project,
          cwd: await this.#workspacePolicy.authorizeProjectWorkspace(
            project.location.rootPath,
            cwd,
          ),
        })
      } catch (error) {
        if (error instanceof WorkspacePolicyError) continue
        throw error
      }
    }
    matches.sort(
      (left, right) =>
        right.project.location.rootPath.length -
        left.project.location.rootPath.length,
    )
    const match = matches[0]
    if (match === undefined) {
      throw new ProjectRegistryError(
        'invalid_path',
        'Legacy cwd does not belong to a registered available Project',
      )
    }
    return match
  }

  async reserveLegacyConversationCreation(
    cwd: string,
    machineId: MachineId,
  ): Promise<ProjectConversationReservation> {
    const match = await this.resolveLegacyConversation(cwd, machineId)
    const release = this.#reserveConversation(match.project)
    try {
      const workspace = await this.authorizeConversation(
        match.project.projectId,
        machineId,
        cwd,
      )
      return {
        ...workspace,
        machineId: match.project.location.machineId,
        release,
      }
    } catch (error) {
      release()
      throw error
    }
  }

  delete(projectId: ProjectId): ProjectId {
    const project = this.require(projectId)
    const hasConversations =
      (this.#conversationReservations.get(project.projectId) ?? 0) > 0 ||
      this.#hasRuntimeConversations(project.projectId) ||
      (this.#persistence?.countConversationsForProject(project.projectId) ??
        0) > 0
    if (hasConversations) {
      throw new ProjectRegistryError(
        'has_conversations',
        'Project has Conversations and cannot be removed',
      )
    }
    this.#writeDurable(() => {
      if (
        this.#persistence !== undefined &&
        !this.#persistence.deleteProject(project.projectId)
      ) {
        throw new Error(`Project ${project.projectId} does not exist`)
      }
    })
    this.#projects.delete(project.projectId)
    this.#projectIdsByLocationKey.delete(
      locationKey(project.location.machineId, project.location.rootPathKey),
    )
    return project.projectId
  }

  #reserveConversation(project: DurableProject): () => void {
    if (this.#projects.get(project.projectId) !== project) {
      throw new ProjectRegistryError(
        'unavailable',
        'Project is no longer registered',
      )
    }
    this.#conversationReservations.set(
      project.projectId,
      (this.#conversationReservations.get(project.projectId) ?? 0) + 1,
    )
    let released = false
    return () => {
      if (released) return
      released = true
      const remaining =
        (this.#conversationReservations.get(project.projectId) ?? 1) - 1
      if (remaining === 0) {
        this.#conversationReservations.delete(project.projectId)
      } else {
        this.#conversationReservations.set(project.projectId, remaining)
      }
    }
  }

  #retain(project: DurableProject): void {
    const key = locationKey(
      project.location.machineId,
      project.location.rootPathKey,
    )
    if (
      this.#projects.has(project.projectId) ||
      this.#projectIdsByLocationKey.has(key)
    ) {
      throw new Error('Durable Project identity is duplicated')
    }
    this.#projects.set(project.projectId, project)
    this.#projectIdsByLocationKey.set(key, project.projectId)
  }

  async #record(project: DurableProject): Promise<ProjectRecord> {
    const availability = await this.#workspacePolicy.inspectProjectRoot(
      project.location.rootPath,
    )
    return ProjectRecordSchema.parse({
      projectId: project.projectId,
      name: project.name,
      locations: [
        ProjectLocationSchema.parse({
          projectId: project.projectId,
          machineId: project.location.machineId,
          rootPath: project.location.rootPath,
          availability,
          createdAt: project.location.createdAt,
          updatedAt: project.location.updatedAt,
        }),
      ],
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    })
  }
}

function locationKey(machineId: MachineId, rootPathKey: string): string {
  return JSON.stringify([MachineIdSchema.parse(machineId), rootPathKey])
}

function newProjectId(): ProjectId {
  return ProjectIdSchema.parse(`proj_${randomUUID().replaceAll('-', '')}`)
}

function normalizedProjectName(
  name: string | undefined,
  rootPath: string,
): string {
  const candidate = name?.trim() || defaultProjectName(rootPath)
  return ProjectRecordSchema.shape.name.parse(candidate)
}

function defaultProjectName(rootPath: string): string {
  const leaf = basename(rootPath)
  if (leaf.length > 0) return leaf
  const volume = parse(rootPath).root.replaceAll(/[\\/:]+/gu, '')
  return volume.length > 0 ? volume : 'Workspace'
}

function projectPathError(error: unknown): Error {
  if (error instanceof WorkspacePolicyError) {
    return new ProjectRegistryError('invalid_path', error.message)
  }
  return error instanceof Error ? error : new Error(String(error))
}

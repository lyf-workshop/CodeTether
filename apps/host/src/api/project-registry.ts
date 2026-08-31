import { randomUUID } from 'node:crypto'
import { basename, parse } from 'node:path'

import {
  MachineIdSchema,
  ProjectIdSchema,
  ProjectLocationSchema,
  ProjectRecordSchema,
  type MachineId,
  type MachineAvailability,
  type ProjectId,
  type ProjectRecord,
  type Timestamp,
} from '@codetether/protocol'

import {
  ConversationStore,
  ProjectLocationConflictError,
  ProjectLocationRemovalError,
  type DurableProject,
  type DurableProjectLocation,
} from '../persistence/index.js'
import { normalizeTrustedProjectRoot } from '../project-path.js'
import { WorkspacePolicy, WorkspacePolicyError } from './workspace-policy.js'

export type ProjectRegistryErrorCode =
  | 'invalid_path'
  | 'not_found'
  | 'has_conversations'
  | 'unavailable'
  | 'location_conflict'
  | 'location_not_found'
  | 'location_has_conversations'
  | 'local_location_required'

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
  readonly machineAvailability?: (machineId: MachineId) => MachineAvailability
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
  readonly #machineAvailability?: (machineId: MachineId) => MachineAvailability
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
    this.#machineAvailability = options.machineAvailability
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
      locations: [
        {
          projectId,
          machineId: this.#localMachineId,
          rootPath,
          rootPathKey,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
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
        .filter((project) =>
          project.locations.some((location) => location.machineId === id),
        )
        .sort(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) ||
            left.projectId.localeCompare(right.projectId),
        )
        .map(async (project) => await this.#record(project, id)),
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

  async registerRemoteLocation(
    projectId: ProjectId,
    machineId: MachineId,
    canonicalPath: string,
  ): Promise<{
    readonly project: ProjectRecord
    readonly location: DurableProjectLocation
    readonly created: boolean
  }> {
    const project = this.require(projectId)
    const machine = MachineIdSchema.parse(machineId)
    if (machine === this.#localMachineId) {
      throw new ProjectRegistryError(
        'location_conflict',
        'The local Project location is already registered',
      )
    }
    if (this.#persistence === undefined) {
      throw new ProjectRegistryError(
        'unavailable',
        'Durable Project locations are unavailable',
      )
    }
    const timestamp = this.#now()
    const remoteRoot = normalizeTrustedProjectRoot(
      canonicalPath,
      canonicalPath.startsWith('/') ? 'linux' : 'win32',
    )
    const candidate: DurableProjectLocation = {
      projectId: project.projectId,
      machineId: machine,
      rootPath: remoteRoot.rootPath,
      // The authenticated Node has already resolved this exact path. Unlike a
      // local Windows path, the Controller must not reinterpret its case or
      // separators using the Controller's operating system.
      rootPathKey: remoteRoot.rootPathKey,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    let result:
      | {
          readonly location: DurableProjectLocation
          readonly created: boolean
        }
      | undefined
    try {
      this.#writeDurable(() => {
        result = this.#persistence?.createProjectLocation(candidate)
      })
    } catch (error) {
      if (error instanceof ProjectLocationConflictError) {
        throw new ProjectRegistryError('location_conflict', error.message)
      }
      throw error
    }
    if (result === undefined) {
      throw new Error(
        'Durable Project location registration produced no result',
      )
    }
    if (result.created) {
      const updated: DurableProject = {
        ...project,
        locations: [...project.locations, result.location].sort((left, right) =>
          left.machineId.localeCompare(right.machineId),
        ),
      }
      this.#replace(updated)
    }
    return {
      project: await this.get(project.projectId),
      location: result.location,
      created: result.created,
    }
  }

  async removeLocation(
    projectId: ProjectId,
    machineId: MachineId,
  ): Promise<ProjectRecord> {
    const project = this.require(projectId)
    const machine = MachineIdSchema.parse(machineId)
    if (this.#persistence === undefined) {
      throw new ProjectRegistryError(
        'unavailable',
        'Durable Project locations are unavailable',
      )
    }
    try {
      this.#writeDurable(() => {
        this.#persistence?.removeProjectLocation(project.projectId, machine)
      })
    } catch (error) {
      if (error instanceof ProjectLocationRemovalError) {
        switch (error.reason) {
          case 'not_found':
            throw new ProjectRegistryError('location_not_found', error.message)
          case 'local_required':
            throw new ProjectRegistryError(
              'local_location_required',
              error.message,
            )
          case 'has_conversations':
            throw new ProjectRegistryError(
              'location_has_conversations',
              error.message,
            )
        }
      }
      throw error
    }
    this.#replace({
      ...project,
      locations: project.locations.filter(
        (location) => location.machineId !== machine,
      ),
    })
    return await this.get(project.projectId)
  }

  async authorizeConversation(
    projectId: ProjectId,
    machineId: MachineId,
    cwd?: string,
  ): Promise<{ readonly project: DurableProject; readonly cwd: string }> {
    const project = this.require(projectId)
    const machine = MachineIdSchema.parse(machineId)
    const location = project.locations.find(
      (candidate) => candidate.machineId === machine,
    )
    if (location === undefined) {
      throw new ProjectRegistryError(
        'unavailable',
        'Project has no authorized location on the selected Machine',
      )
    }
    if (machine !== this.#localMachineId) {
      throw new ProjectRegistryError(
        'unavailable',
        'Agent execution is not available on this Machine',
      )
    }
    try {
      return {
        project,
        cwd: await this.#workspacePolicy.authorizeProjectWorkspace(
          location.rootPath,
          cwd ?? location.rootPath,
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
      return { ...workspace, machineId, release }
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
      readonly rootPathLength: number
    }> = []
    const machine = MachineIdSchema.parse(machineId)
    if (machine !== this.#localMachineId) {
      throw new ProjectRegistryError(
        'unavailable',
        'Legacy workspace selection is available only on the local Machine',
      )
    }
    for (const project of this.#projects.values()) {
      const location = project.locations.find(
        (candidate) => candidate.machineId === machine,
      )
      if (location === undefined) continue
      try {
        matches.push({
          project,
          cwd: await this.#workspacePolicy.authorizeProjectWorkspace(
            location.rootPath,
            cwd,
          ),
          rootPathLength: location.rootPath.length,
        })
      } catch (error) {
        if (error instanceof WorkspacePolicyError) continue
        throw error
      }
    }
    matches.sort((left, right) => right.rootPathLength - left.rootPathLength)
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
        machineId,
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
    for (const location of project.locations) {
      this.#projectIdsByLocationKey.delete(
        locationKey(location.machineId, location.rootPathKey),
      )
    }
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
    if (this.#projects.has(project.projectId)) {
      throw new Error('Durable Project identity is duplicated')
    }
    for (const location of project.locations) {
      const key = locationKey(location.machineId, location.rootPathKey)
      if (this.#projectIdsByLocationKey.has(key)) {
        throw new Error('Durable Project location identity is duplicated')
      }
    }
    this.#projects.set(project.projectId, project)
    for (const location of project.locations) {
      this.#projectIdsByLocationKey.set(
        locationKey(location.machineId, location.rootPathKey),
        project.projectId,
      )
    }
  }

  #replace(project: DurableProject): void {
    const existing = this.#projects.get(project.projectId)
    if (existing === undefined) {
      throw new ProjectRegistryError('not_found', 'Project was not found')
    }
    for (const location of existing.locations) {
      this.#projectIdsByLocationKey.delete(
        locationKey(location.machineId, location.rootPathKey),
      )
    }
    this.#projects.delete(project.projectId)
    this.#retain(project)
  }

  async #record(
    project: DurableProject,
    onlyMachineId?: MachineId,
  ): Promise<ProjectRecord> {
    const locations =
      onlyMachineId === undefined
        ? project.locations
        : project.locations.filter(
            (location) => location.machineId === onlyMachineId,
          )
    return ProjectRecordSchema.parse({
      projectId: project.projectId,
      name: project.name,
      locations: await Promise.all(
        locations.map(async (location) =>
          ProjectLocationSchema.parse({
            projectId: project.projectId,
            machineId: location.machineId,
            rootPath: location.rootPath,
            availability:
              location.machineId === this.#localMachineId
                ? await this.#workspacePolicy.inspectProjectRoot(
                    location.rootPath,
                  )
                : (this.#machineAvailability?.(location.machineId) ??
                  'unavailable'),
            createdAt: location.createdAt,
            updatedAt: location.updatedAt,
          }),
        ),
      ),
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

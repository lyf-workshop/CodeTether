import type {
  CreateProjectResponse,
  CreateRemoteProjectResponse,
  MachineId,
  MachineSummary,
} from '@codetether/protocol'
import { CodeTetherResponseError } from '@codetether/client'

import {
  ProjectCreationMachineUnavailableError,
  selectFixedProjectCreationMachine,
} from './project-creation-machine.js'

interface ProjectCreationActions {
  createProject(path: string, name?: string): Promise<CreateProjectResponse>
  createRemoteProject(
    machineId: MachineId,
    input: { readonly rootPath: string; readonly name?: string },
  ): Promise<CreateRemoteProjectResponse>
}

export class ProjectFolderRegistrationConflictError extends Error {
  constructor(
    readonly listUpdated: boolean,
    cause: unknown,
  ) {
    super(
      listUpdated
        ? '这个文件夹刚被添加过，列表已更新。请打开已有项目。'
        : '这个文件夹刚被添加过，但列表暂时无法更新。请重新读取项目后重试。',
      { cause },
    )
    this.name = 'ProjectFolderRegistrationConflictError'
  }
}

/** Only the canonical create-folder conflict permits this one metadata refresh. */
export async function refreshProjectRegistrationConflict(
  error: unknown,
  refresh: () => Promise<unknown>,
): Promise<ProjectFolderRegistrationConflictError | undefined> {
  if (
    !(error instanceof CodeTetherResponseError) ||
    error.status !== 409 ||
    error.envelope.code !== 'project_location_conflict'
  )
    return undefined
  try {
    await refresh()
    return new ProjectFolderRegistrationConflictError(true, error)
  } catch {
    return new ProjectFolderRegistrationConflictError(false, error)
  }
}

/** Presentation ordering only; disabled devices remain visible with a reason. */
export function projectCreationMachines(
  machines: readonly MachineSummary[] | undefined,
): readonly MachineSummary[] {
  return [...(machines ?? [])].sort(
    (first, second) => Number(second.isLocal) - Number(first.isLocal),
  )
}

/** Used once per opening. Explicit selections are never replaced on refresh. */
export function chooseInitialProjectMachineId(
  machines: readonly MachineSummary[] | undefined,
): MachineId | undefined {
  return projectCreationMachines(machines).find(
    (machine) =>
      selectFixedProjectCreationMachine([machine], machine.machineId).state ===
      'ready',
  )?.machineId
}

export async function createProjectForMachine(
  actions: ProjectCreationActions,
  machine: MachineSummary,
  input: { readonly path: string; readonly name?: string },
): Promise<CreateProjectResponse | CreateRemoteProjectResponse> {
  const target = selectFixedProjectCreationMachine([machine], machine.machineId)
  if (target.state !== 'ready')
    throw new ProjectCreationMachineUnavailableError(target.state)
  // The existing Runtime actions still own actionId, canonicalization and
  // idempotency. There is no generic filesystem call or alternative target.
  if (machine.kind === 'remote') {
    return await actions.createRemoteProject(machine.machineId, {
      rootPath: input.path,
      ...(input.name === undefined ? {} : { name: input.name }),
    })
  }
  return await actions.createProject(input.path, input.name)
}

export function nextProjectCreationStep(
  created: boolean,
  deferPreviousConversations: boolean,
): 'finished' | 'previous_conversations' {
  return created && !deferPreviousConversations
    ? 'previous_conversations'
    : 'finished'
}

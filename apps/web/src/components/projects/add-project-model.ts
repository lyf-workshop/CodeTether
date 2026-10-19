import type {
  CreateProjectResponse,
  CreateRemoteProjectResponse,
  MachineId,
  MachineSummary,
} from '@codetether/protocol'

import { selectFixedProjectCreationMachine } from './project-creation-machine.js'

interface ProjectCreationActions {
  createProject(path: string, name?: string): Promise<CreateProjectResponse>
  createRemoteProject(
    machineId: MachineId,
    input: { readonly rootPath: string; readonly name?: string },
  ): Promise<CreateRemoteProjectResponse>
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
  if (
    selectFixedProjectCreationMachine([machine], machine.machineId).state !==
    'ready'
  ) {
    throw new Error(
      'Selected Machine is not available for Project registration',
    )
  }
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

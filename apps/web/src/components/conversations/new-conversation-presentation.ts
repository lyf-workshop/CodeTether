import type { MachineId, ProjectRecord } from '@codetether/protocol'

import {
  projectLocationForMachine,
  soleProjectLocation,
} from '../../runtime/host/project-location.js'

export interface ProjectOptionPresentation {
  readonly name: string
  readonly rootPath: string
  readonly textValue: string
}

export function createProjectOptionPresentation(
  project: Pick<ProjectRecord, 'name' | 'locations'>,
  machineId?: MachineId,
): ProjectOptionPresentation {
  const location =
    machineId === undefined
      ? soleProjectLocation(project)
      : projectLocationForMachine(project, machineId)
  const rootPath = location?.rootPath ?? '工作区位置不可用'
  return {
    name: project.name,
    rootPath,
    textValue: `${project.name} — ${rootPath}`,
  }
}

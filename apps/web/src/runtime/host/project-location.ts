import type {
  MachineId,
  ProjectAvailability,
  ProjectRecord,
} from '@codetether/protocol'

export type ProjectLocation = ProjectRecord['locations'][number]

/** Phase 6A accepts exactly one durable location while refusing path inference. */
export function soleProjectLocation(
  project: Pick<ProjectRecord, 'locations'>,
): ProjectLocation | undefined {
  return project.locations.length === 1 ? project.locations[0] : undefined
}

export function projectLocationForMachine(
  project: Pick<ProjectRecord, 'locations'>,
  machineId: MachineId,
): ProjectLocation | undefined {
  return project.locations.find((location) => location.machineId === machineId)
}

export function projectLocationAvailability(
  project: Pick<ProjectRecord, 'locations'>,
  machineId?: MachineId,
): ProjectAvailability {
  const location =
    machineId === undefined
      ? soleProjectLocation(project)
      : projectLocationForMachine(project, machineId)
  return location?.availability ?? 'unavailable'
}

export function projectLocationRootPath(
  project: Pick<ProjectRecord, 'locations'>,
): string | undefined {
  return soleProjectLocation(project)?.rootPath
}

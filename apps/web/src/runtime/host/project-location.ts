import type {
  MachineId,
  ProjectAvailability,
  ProjectRecord,
} from '@codetether/protocol'

export type ProjectLocation = ProjectRecord['locations'][number]

/** Returns the only Location without inventing a preferred Machine. */
export function soleProjectLocation(
  project: Pick<ProjectRecord, 'locations'>,
): ProjectLocation | undefined {
  return project.locations.length === 1 ? project.locations[0] : undefined
}

export function availableProjectLocations(
  project: Pick<ProjectRecord, 'locations'>,
): readonly ProjectLocation[] {
  return project.locations.filter(
    (location) => location.availability === 'available',
  )
}

export function projectHasAvailableLocation(
  project: Pick<ProjectRecord, 'locations'>,
): boolean {
  return availableProjectLocations(project).length > 0
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
  if (machineId !== undefined) {
    return (
      projectLocationForMachine(project, machineId)?.availability ??
      'unavailable'
    )
  }
  return projectHasAvailableLocation(project) ? 'available' : 'unavailable'
}

export function projectLocationRootPath(
  project: Pick<ProjectRecord, 'locations'>,
  machineId?: MachineId,
): string | undefined {
  return machineId === undefined
    ? soleProjectLocation(project)?.rootPath
    : projectLocationForMachine(project, machineId)?.rootPath
}

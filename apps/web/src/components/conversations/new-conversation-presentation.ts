import type { ProjectRecord } from '@codetether/protocol'

export interface ProjectOptionPresentation {
  readonly name: string
  readonly rootPath: string
  readonly textValue: string
}

export function createProjectOptionPresentation(
  project: Pick<ProjectRecord, 'name' | 'rootPath'>,
): ProjectOptionPresentation {
  return {
    name: project.name,
    rootPath: project.rootPath,
    textValue: `${project.name} — ${project.rootPath}`,
  }
}

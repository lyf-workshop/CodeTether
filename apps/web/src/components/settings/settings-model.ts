export const settingsSections = [
  'appearance',
  'account',
  'notify',
  'background',
  'about',
] as const
export type SettingsSection = (typeof settingsSections)[number]

export function parseSettingsSearch(search: Record<string, unknown>): {
  projectId?: ProjectId
} {
  const projectId = ProjectIdSchema.safeParse(search.projectId)
  return projectId.success ? { projectId: projectId.data } : {}
}

export function settingsSectionFromPath(pathname: string): SettingsSection {
  const match = /^\/settings\/([^/]+)\/?$/u.exec(pathname)
  const section = match?.[1]
  return (
    settingsSections.find((candidate) => candidate === section) ?? 'appearance'
  )
}
import { ProjectIdSchema, type ProjectId } from '@codetether/protocol'

import { Link } from '@tanstack/react-router'
import { FolderOpen } from 'lucide-react'

import { Separator } from '@codetether/ui'
import type { MachineSummary, ProjectRecord } from '@codetether/protocol'

import { projectLocationForMachine } from '../../runtime/host/project-location'
import {
  compactProjectPath,
  projectFolderName,
} from '../projects/project-format'

interface MachineProjectsSectionProps {
  machine: MachineSummary
  projects: readonly ProjectRecord[]
}

export function MachineProjectsSection({
  machine,
  projects,
}: MachineProjectsSectionProps) {
  return (
    <section
      className="mt-5 min-w-0 rounded-lg border border-border bg-surface/65 p-5"
      aria-labelledby="machine-projects-heading"
    >
      <div className="flex min-w-0 items-end justify-between gap-4">
        <div className="min-w-0">
          <h2
            id="machine-projects-heading"
            className="text-section font-semibold text-text-primary"
          >
            项目
          </h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            注册在这台机器上的工作区位置。
          </p>
        </div>
        <span className="shrink-0 text-xs text-text-muted">
          {projects.length} 个
        </span>
      </div>
      <Separator className="my-4" />
      {projects.length === 0 ? (
        <p className="text-sm text-text-muted">这台机器上还没有项目位置。</p>
      ) : (
        <ul className="grid min-w-0 gap-3 lg:grid-cols-2">
          {projects.map((project) => {
            const location = projectLocationForMachine(
              project,
              machine.machineId,
            )
            return (
              <li
                key={project.projectId}
                className="min-w-0 rounded-md border border-border bg-surface-muted/35 p-3"
              >
                <Link
                  to="/projects/$projectId"
                  params={{ projectId: project.projectId }}
                  aria-label={`打开项目：${project.name}`}
                  className="flex min-w-0 items-center gap-3 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  <FolderOpen
                    aria-hidden="true"
                    className="size-4 shrink-0 text-primary"
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className="block truncate text-sm font-medium text-text-primary"
                      title={project.name}
                    >
                      {project.name}
                    </span>
                    {location === undefined ? null : (
                      <span
                        className="mt-0.5 block truncate font-mono text-xs text-text-muted"
                        title={location.rootPath}
                      >
                        {projectFolderName(location.rootPath)} ·{' '}
                        {compactProjectPath(location.rootPath)}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

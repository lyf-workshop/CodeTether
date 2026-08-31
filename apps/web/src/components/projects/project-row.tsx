import { useRef } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, Folder, MoreHorizontal, Trash2 } from 'lucide-react'

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  MachineBadge,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@codetether/ui'
import type { MachineSummary, ProjectRecord } from '@codetether/protocol'

import {
  projectHasAvailableLocation,
  type ProjectLocation,
} from '../../runtime/host/project-location'
import { ProjectAvailabilityBadge } from './project-availability-badge'
import {
  compactProjectPath,
  formatProjectTime,
  projectFolderName,
} from './project-format'

interface ProjectRowProps {
  onRemove: (
    project: ProjectRecord,
    returnFocusTarget: HTMLElement | null,
  ) => void
  project: ProjectRecord
  machines?: readonly MachineSummary[]
}

export function ProjectRow({
  machines = [],
  onRemove,
  project,
}: ProjectRowProps) {
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const initial = Array.from(project.name)[0]?.toLocaleUpperCase('zh-CN') ?? 'P'
  const location = primaryProjectLocation(project.locations)
  const availability = projectHasAvailableLocation(project)
    ? 'available'
    : 'unavailable'
  const primaryMachine = machines.find(
    (candidate) => candidate.machineId === location?.machineId,
  )

  return (
    <article
      className={cn(
        'grid min-w-0 gap-5 rounded-lg border border-border bg-surface/70 p-5',
        'transition-colors duration-150 hover:border-border-strong hover:bg-surface/90 motion-reduce:transition-none',
        'sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'grid size-11 shrink-0 place-items-center rounded-md border text-base font-semibold',
          availability === 'available'
            ? 'border-primary/35 bg-primary-muted text-primary'
            : 'border-border-strong bg-surface-muted text-text-muted',
        )}
      >
        {initial}
      </span>

      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <h2 className="min-w-0 truncate text-section font-semibold text-text-primary">
            {project.name}
          </h2>
          <ProjectAvailabilityBadge availability={availability} />
        </div>
        {location === undefined ? (
          <p className="mt-1.5 text-sm text-warning">工作区位置不可用</p>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="mt-1.5 flex min-w-0 items-center gap-2 text-sm text-text-secondary">
                <span className="shrink-0 font-medium text-text-primary">
                  {projectFolderName(location.rootPath)}
                </span>
                <span className="min-w-0 truncate font-mono text-xs">
                  {compactProjectPath(location.rootPath)}
                </span>
              </p>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              className="max-w-xl break-all font-mono"
            >
              {location.rootPath}
            </TooltipContent>
          </Tooltip>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-regular text-text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Folder aria-hidden="true" className="size-3.5" />
            已授权的工作区
          </span>
          {primaryMachine === undefined ? null : (
            <MachineBadge
              name={primaryMachine.displayName}
              title={primaryMachine.displayName}
              className="h-6"
            />
          )}
          {project.locations.length > 1 ? (
            <span className="text-xs text-text-muted">
              共 {project.locations.length} 个位置
            </span>
          ) : null}
          <time dateTime={project.updatedAt}>
            更新于 {formatProjectTime(project.updatedAt)}
          </time>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-stretch">
        <Button asChild size="sm" className="min-w-24">
          <Link
            to="/projects/$projectId"
            params={{ projectId: project.projectId }}
          >
            打开
            <ArrowUpRight aria-hidden="true" />
          </Link>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              ref={menuTriggerRef}
              label={`更多项目操作：${project.name}`}
              size="sm"
              variant="outline"
              className="min-w-9 flex-1 sm:w-full"
            >
              <MoreHorizontal aria-hidden="true" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link
                to="/projects/$projectId"
                params={{ projectId: project.projectId }}
              >
                <ArrowUpRight aria-hidden="true" />
                打开项目
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="danger"
              onSelect={() => onRemove(project, menuTriggerRef.current)}
            >
              <Trash2 aria-hidden="true" />
              移除项目
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  )
}

function primaryProjectLocation(
  locations: readonly ProjectLocation[],
): ProjectLocation | undefined {
  return (
    locations.find((location) => location.availability === 'available') ??
    locations[0]
  )
}

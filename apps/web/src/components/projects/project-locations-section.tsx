import { useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  Check,
  Copy,
  FolderOpen,
  Monitor,
  MoreHorizontal,
  Trash2,
} from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  MachineBadge,
  Separator,
} from '@codetether/ui'
import type { MachineSummary, ProjectRecord } from '@codetether/protocol'

import { machineConnectionStateLabel } from '../machines/machine-presentation'
import { ProjectAvailabilityBadge } from './project-availability-badge'
import { compactProjectPath, projectFolderName } from './project-format'
import { RemoveProjectLocationDialog } from './remove-project-location-dialog'

interface ProjectLocationsSectionProps {
  machines: readonly MachineSummary[]
  project: ProjectRecord
}

export function ProjectLocationsSection({
  machines,
  project,
}: ProjectLocationsSectionProps) {
  const sectionRef = useRef<HTMLElement>(null)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [removalTarget, setRemovalTarget] = useState<{
    readonly location: ProjectRecord['locations'][number]
    readonly machine: MachineSummary
  }>()
  const machinesById = new Map(
    machines.map((machine) => [machine.machineId, machine]),
  )

  function openRemoveDialog(
    location: ProjectRecord['locations'][number],
    machine: MachineSummary,
  ) {
    setRemovalTarget({ location, machine })
    setRemoveOpen(true)
  }

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-labelledby="project-locations-heading"
      className="min-w-0 rounded-lg border border-border bg-surface/65 p-5 outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-md border border-primary/30 bg-primary-muted text-primary"
        >
          <FolderOpen className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2
            id="project-locations-heading"
            className="text-section font-semibold text-text-primary"
          >
            工作区位置
          </h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            每个位置都属于一台机器，并拥有独立的根目录与可用状态。
          </p>
        </div>
        <span className="shrink-0 text-xs text-text-muted">
          {project.locations.length} 个
        </span>
      </div>

      <Separator className="my-5" />

      <ul className="grid min-w-0 gap-3 2xl:grid-cols-2">
        {project.locations.map((location) => (
          <ProjectLocationCard
            key={location.machineId}
            location={location}
            machine={machinesById.get(location.machineId)}
            onRemove={openRemoveDialog}
          />
        ))}
      </ul>

      {removalTarget === undefined ? null : (
        <RemoveProjectLocationDialog
          location={removalTarget.location}
          machine={removalTarget.machine}
          open={removeOpen}
          project={project}
          returnFocus={() => sectionRef.current}
          onOpenChange={setRemoveOpen}
        />
      )}
    </section>
  )
}

function ProjectLocationCard({
  location,
  machine,
  onRemove,
}: {
  location: ProjectRecord['locations'][number]
  machine?: MachineSummary
  onRemove: (
    location: ProjectRecord['locations'][number],
    machine: MachineSummary,
  ) => void
}) {
  const dialogOpeningRef = useRef(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>(
    'idle',
  )
  const machineReachable =
    machine !== undefined && machine.availability === 'available'
  const availability =
    location.availability === 'available' && machineReachable
      ? 'available'
      : 'unavailable'

  async function copyRootPath() {
    try {
      if (navigator.clipboard === undefined) throw new Error('unavailable')
      await navigator.clipboard.writeText(location.rootPath)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  return (
    <li className="min-w-0 rounded-md border border-border bg-surface-muted/35 p-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {machine === undefined ? (
          <span className="inline-flex min-w-0 items-center gap-1.5 text-sm text-text-secondary">
            <Monitor aria-hidden="true" className="size-3.5 shrink-0" />
            机器信息不可用
          </span>
        ) : (
          <Link
            to="/machines/$machineId"
            params={{ machineId: machine.machineId }}
            aria-label={`打开机器：${machine.displayName}`}
            className="min-w-0 rounded-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <MachineBadge
              name={machine.displayName}
              title={machine.displayName}
              className="max-w-full"
            />
          </Link>
        )}
        <ProjectAvailabilityBadge availability={availability} />
        {machine?.kind === 'remote' ? (
          <span className="text-xs text-text-muted">
            {machineConnectionStateLabel(machine.connectionState)}
          </span>
        ) : null}
      </div>

      <div className="mt-3 flex min-w-0 items-center gap-2">
        <FolderOpen
          aria-hidden="true"
          className="size-4 shrink-0 text-primary"
        />
        <span className="min-w-0 flex-1">
          <span
            className="block truncate text-sm font-medium text-text-primary"
            title={projectFolderName(location.rootPath)}
          >
            {projectFolderName(location.rootPath)}
          </span>
          <span
            className="mt-0.5 block truncate font-mono text-xs text-text-muted"
            title={location.rootPath}
          >
            {compactProjectPath(location.rootPath)}
          </span>
        </span>
        <IconButton
          type="button"
          variant="ghost"
          size="sm"
          label={copyState === 'copied' ? '路径已复制' : '复制完整路径'}
          className="size-7 shrink-0 text-text-muted hover:text-text-primary"
          onClick={() => void copyRootPath()}
        >
          {copyState === 'copied' ? (
            <Check aria-hidden="true" />
          ) : (
            <Copy aria-hidden="true" />
          )}
        </IconButton>
        {machine?.kind === 'remote' ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                type="button"
                variant="ghost"
                size="sm"
                label={`更多工作区位置操作：${machine.displayName}，${projectFolderName(location.rootPath)}`}
                className="size-7 shrink-0 text-text-muted hover:text-text-primary"
              >
                <MoreHorizontal aria-hidden="true" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onCloseAutoFocus={(event) => {
                if (!dialogOpeningRef.current) return
                event.preventDefault()
                dialogOpeningRef.current = false
              }}
            >
              <DropdownMenuItem
                variant="danger"
                onSelect={() => {
                  dialogOpeningRef.current = true
                  onRemove(location, machine)
                }}
              >
                <Trash2 aria-hidden="true" />
                移除位置
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {machine?.kind === 'remote' && !machineReachable ? (
        <p className="mt-3 text-xs leading-relaxed text-warning">
          该目录已在注册时由远程节点验证。远程机器当前离线；位置元数据仍然保留，但不会在后台重新检查目录。
        </p>
      ) : null}
      {copyState === 'failed' ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          路径复制失败。
        </p>
      ) : null}
    </li>
  )
}

import { useId, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronDown, ChevronRight, Monitor, Plus, Server } from 'lucide-react'
import { IconButton, cn } from '@codetether/ui'
import { useHostConnectionState } from '../../runtime/host/host-runtime-hooks'
import {
  formatMachineLastSeen,
  machineConnectionStateLabel,
} from '../machines/machine-presentation'
import {
  machineCanAddProject,
  machineCannotAddProjectReason,
} from '../machines/device-project-model'
import type { WorkspaceSidebarProps } from './workspace-sidebar'
import type { WorkspaceDeviceGroup } from './workspace-sidebar-model'

export function WorkspaceDeviceSection({
  group,
  active,
  expanded,
  onExpandedChange,
  onAddProject,
  children,
}: {
  group: WorkspaceDeviceGroup
  active: boolean
  expanded: boolean
  onExpandedChange: () => void
  onAddProject?: WorkspaceSidebarProps['onAddProject']
  children: ReactNode
}) {
  const contentId = useId()
  const { machine, projects } = group
  const connectionState = useHostConnectionState()
  const Icon = machine.kind === 'local' ? Monitor : Server
  const canAddProject =
    connectionState === 'connected' && machineCanAddProject(machine)
  const status =
    machine.connectionState === 'local'
      ? '这台电脑'
      : machineConnectionStateLabel(machine.connectionState)
  const lastSeen = formatMachineLastSeen(machine.lastSeenAt)
  return (
    <div data-workspace-machine={machine.machineId}>
      <div
        data-state={active ? 'selected' : undefined}
        className={cn(
          'group/device flex h-[var(--tree-device-h)] min-w-0 items-center rounded-sm px-1',
          active ? 'bg-surface-muted' : 'hover:bg-surface-muted/55',
        )}
      >
        <IconButton
          type="button"
          size="sm"
          variant="ghost"
          className="size-5 shrink-0 text-text-muted"
          aria-controls={contentId}
          aria-expanded={expanded}
          label={`${expanded ? '折叠' : '展开'}设备：${machine.displayName}`}
          onClick={onExpandedChange}
        >
          {expanded ? (
            <ChevronDown aria-hidden="true" />
          ) : (
            <ChevronRight aria-hidden="true" />
          )}
        </IconButton>
        <Link
          to="/devices/$machineId"
          params={{ machineId: machine.machineId }}
          aria-current={active ? 'location' : undefined}
          title={`${machine.displayName} · ${status}${lastSeen === undefined ? '' : ` · 上次在线 ${lastSeen}`}`}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-xs text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <Icon
            aria-hidden="true"
            className="size-4 shrink-0 text-text-muted"
          />
          <span className="truncate">{machine.displayName}</span>
        </Link>
        {canAddProject && onAddProject !== undefined ? (
          <IconButton
            type="button"
            size="sm"
            variant="ghost"
            label={`在 ${machine.displayName} 上添加项目`}
            className="size-6 shrink-0 text-text-muted opacity-0 group-hover/device:opacity-100 group-focus-within/device:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none"
            onClick={() => onAddProject(machine.machineId)}
          >
            <Plus aria-hidden="true" />
          </IconButton>
        ) : machine.connectionState !== 'local' &&
          machine.connectionState !== 'online' ? (
          <span
            className="shrink-0 text-2xs font-normal text-text-muted"
            title={lastSeen === undefined ? status : `上次在线 ${lastSeen}`}
          >
            {status}
          </span>
        ) : !machineCanAddProject(machine) ? (
          <span
            className="min-w-0 max-w-1/2 truncate text-2xs font-normal text-text-muted"
            title={machineCannotAddProjectReason()}
          >
            {machineCannotAddProjectReason()}
          </span>
        ) : null}
      </div>
      {expanded ? (
        <div id={contentId} className="ml-5">
          {projects.length === 0 ? (
            <p className="flex h-[var(--tree-secondary-h)] items-center px-2 text-xs text-text-muted">
              还没有项目
            </p>
          ) : (
            children
          )}
        </div>
      ) : null}
    </div>
  )
}

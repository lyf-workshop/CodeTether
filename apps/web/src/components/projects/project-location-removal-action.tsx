import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@codetether/ui'
import type { MachineSummary, ProjectRecord } from '@codetether/protocol'

import { allProjectConversationsQueryOptions } from '../../runtime/host/conversation-list-query'
import {
  useHostConnectionState,
  useHostRuntime,
} from '../../runtime/host/host-runtime-hooks'
import { projectLocationForMachine } from '../../runtime/host/project-location'
import { RemoveProjectLocationDialog } from './remove-project-location-dialog'

interface ProjectLocationRemovalActionProps {
  machine: MachineSummary
  project: ProjectRecord
  onRemoved?: () => void
  returnFocus?: () => HTMLElement | null
}

/** Removes only an exact remote registration; the Host still makes the final check. */
export function ProjectLocationRemovalAction({
  machine,
  project,
  onRemoved,
  returnFocus,
}: ProjectLocationRemovalActionProps) {
  const runtime = useHostRuntime()
  const connection = useHostConnectionState()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const location = projectLocationForMachine(project, machine.machineId)
  const connected = connection === 'connected'
  const conversations = useQuery({
    ...allProjectConversationsQueryOptions(runtime, project.projectId),
    enabled: connected && machine.kind === 'remote' && location !== undefined,
  })
  if (machine.kind !== 'remote' || location === undefined) return null

  const own = conversations.data?.filter(
    (conversation) => conversation.machineId === machine.machineId,
  )
  const archivedCount = own?.filter(
    (conversation) => conversation.archivedAt !== undefined,
  ).length
  const reason = !connected
    ? '恢复连接后才能确认这台设备上的项目是否可以移除。'
    : conversations.isFetching || conversations.isPending
      ? '正在检查这台设备上的会话，包括已归档的会话。'
      : conversations.isError || own === undefined
        ? '暂时无法确认这台设备上的会话，请重新检查后再移除。'
        : own.length > 0
          ? `这台设备上的项目还有 ${own.length} 个会话${archivedCount ? `，其中 ${archivedCount} 个已归档` : ''}，暂时不能移除。`
          : (conversations.data?.length ?? 0) >= 100
            ? '当前只读取了最近 100 个会话，暂时无法确认这台设备上没有其他会话，不能移除。'
            : undefined

  return (
    <div className="min-w-0 space-y-2" data-slot="project-location-removal">
      {reason === undefined ? (
        <Button
          ref={triggerRef}
          variant="ghost"
          size="sm"
          className="text-danger-text"
          aria-label={`从这台设备移除：${project.name}`}
          onClick={() => setOpen(true)}
        >
          从这台设备移除
        </Button>
      ) : (
        <p className="break-words text-xs text-text-secondary">{reason}</p>
      )}
      {connected && conversations.isError ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={conversations.isFetching}
          onClick={() => void conversations.refetch()}
        >
          重新检查
        </Button>
      ) : null}
      {open ? (
        <RemoveProjectLocationDialog
          location={location}
          machine={machine}
          project={project}
          open={open}
          onOpenChange={setOpen}
          onRemoved={onRemoved}
          returnFocus={() => triggerRef.current ?? returnFocus?.() ?? null}
        />
      ) : null}
    </div>
  )
}

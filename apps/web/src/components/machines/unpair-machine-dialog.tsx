import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Unplug } from 'lucide-react'

import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@codetether/ui'
import type { MachineSummary, ProjectRecord } from '@codetether/protocol'

import { useHostRuntime } from '../../runtime/host/host-runtime-hooks'
import { machineErrorMessage } from '../../runtime/host/machine-actions'
import { machineQueryKeys } from '../../runtime/host/machine-query'
import {
  runMachineTrustMutation,
  MachineTrustFlowBusyError,
} from './machine-trust-flow'
import { useMachineTrustBusy } from './use-remote-machine-pairing'
import { unpairMachinePreflight } from './device-project-model'

interface UnpairMachineDialogProps {
  machine: MachineSummary
  onOpenChange: (open: boolean) => void
  open: boolean
  projects?: readonly ProjectRecord[]
  /** Compatibility for earlier callers; exact projects are preferred. */
  projectCount?: number
}

export function UnpairMachineDialog({
  machine,
  onOpenChange,
  open,
  projects,
  projectCount,
}: UnpairMachineDialogProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const runtime = useHostRuntime()
  const trustBusy = useMachineTrustBusy()
  const preflight = unpairMachinePreflight(projects ?? [], machine.machineId)
  const count =
    projects === undefined ? projectCount : preflight.projects.length
  const unknown = count === undefined
  const blocked = unknown || (count !== undefined && count > 0)
  const unpairMutation = useMutation({
    mutationFn: async () => {
      if (blocked) throw new Error('Unpair preflight is not clear')
      return await runMachineTrustMutation(
        runtime,
        async () => await runtime.unpairMachine(machine.machineId),
      )
    },
    onSuccess: async () => {
      onOpenChange(false)
      queryClient.removeQueries({
        queryKey: machineQueryKeys.detail(machine.machineId),
        exact: true,
      })
      await navigate({ to: '/devices' })
    },
  })

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && unpairMutation.isPending) return
    if (nextOpen) unpairMutation.reset()
    onOpenChange(nextOpen)
  }

  if (machine.kind !== 'remote') return null

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        closeLabel="关闭取消配对确认"
        className="max-w-md"
        showCloseButton={!unpairMutation.isPending}
      >
        <DialogHeader>
          <span
            aria-hidden="true"
            className="grid size-10 place-items-center rounded-md bg-danger-muted text-danger-text"
          >
            <Unplug className="size-5" />
          </span>
          <DialogTitle>
            {blocked ? '暂时不能取消配对' : '取消设备配对'}
          </DialogTitle>
          <DialogDescription className="break-words">
            {blocked
              ? unknown
                ? '尚未取得这台设备上的项目记录，请恢复连接后重试。'
                : `“${machine.displayName}”上仍有 ${count} 个项目。取消配对不会自动移除项目。`
              : `移除与“${machine.displayName}”的长期信任关系。`}
          </DialogDescription>
        </DialogHeader>
        {blocked ? (
          <>
            {preflight.projects.length > 0 ? (
              <ul className="max-h-64 space-y-3 overflow-y-auto rounded-sm border border-border bg-surface-inset p-3">
                {preflight.projects.map((project) => (
                  <li key={project.projectId} className="min-w-0">
                    <p
                      title={project.name}
                      className="truncate text-md font-medium"
                    >
                      {project.name}
                    </p>
                    <p
                      title={project.rootPath}
                      className="mt-1 truncate font-mono text-xs text-text-muted"
                    >
                      {project.rootPath}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-sm text-text-secondary">
              项目的会话历史会继续保留。此处只能关闭说明，不能移除项目或更改配对。
            </p>
          </>
        ) : (
          <p className="rounded-sm bg-surface-inset px-3 py-3 text-sm text-text-secondary">
            {machine.connectionState === 'online'
              ? 'CodeTether 会先请求远程 Node 撤销信任，确认成功后才移除本地设备记录。此操作不会删除设备上的文件。'
              : '需要连接到远程 Node 才能确认撤销信任。无法连接时会保留设备和信任记录。'}
          </p>
        )}
        {trustBusy && !unpairMutation.isPending ? (
          <p role="status" className="text-sm text-text-secondary">
            另一项设备配对或取消配对正在进行，请先完成或取消那项操作。
          </p>
        ) : null}
        {unpairMutation.isError ? (
          <p
            role="alert"
            className="rounded-sm bg-danger-muted px-3 py-2 text-sm text-danger-text"
          >
            {unpairMutation.error instanceof MachineTrustFlowBusyError
              ? '另一项设备信任操作正在进行，请稍后再试。'
              : machineErrorMessage(unpairMutation.error, 'unpair')}
          </p>
        ) : null}
        <DialogFooter>
          {blocked ? (
            <DialogClose asChild>
              <Button size="sm">知道了</Button>
            </DialogClose>
          ) : (
            <>
              <DialogClose asChild>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={unpairMutation.isPending}
                >
                  保留配对
                </Button>
              </DialogClose>
              <Button
                variant="danger"
                size="sm"
                disabled={unpairMutation.isPending || trustBusy}
                onClick={() => {
                  if (!trustBusy && !unpairMutation.isPending)
                    unpairMutation.mutate()
                }}
              >
                {unpairMutation.isPending ? '正在取消…' : '取消配对'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

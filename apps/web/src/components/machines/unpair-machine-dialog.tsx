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
import type { MachineSummary } from '@codetether/protocol'

import { useHostRuntime } from '../../runtime/host/host-runtime-hooks'
import { machineErrorMessage } from '../../runtime/host/machine-actions'
import { machineQueryKeys } from '../../runtime/host/machine-query'

interface UnpairMachineDialogProps {
  machine: MachineSummary
  onOpenChange: (open: boolean) => void
  open: boolean
  projectCount?: number
}

export function UnpairMachineDialog({
  machine,
  onOpenChange,
  open,
  projectCount = 0,
}: UnpairMachineDialogProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const runtime = useHostRuntime()
  const unpairMutation = useMutation({
    mutationFn: async () => await runtime.unpairMachine(machine.machineId),
    onSuccess: async () => {
      onOpenChange(false)
      queryClient.removeQueries({
        queryKey: machineQueryKeys.detail(machine.machineId),
        exact: true,
      })
      await navigate({ to: '/machines' })
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
            className="grid size-10 place-items-center rounded-md border border-danger/30 bg-danger-muted text-danger"
          >
            <Unplug className="size-5" />
          </span>
          <DialogTitle>取消机器配对</DialogTitle>
          <DialogDescription className="break-words">
            移除与“{machine.displayName}”的长期信任关系。
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-sm border border-border bg-surface-muted/60 px-3 py-3 text-sm text-text-secondary">
          {projectCount > 0
            ? `这台机器仍有 ${projectCount} 个项目位置。当前版本不会自动删除这些位置，因此暂时不能取消配对。`
            : machine.connectionState === 'online'
              ? 'CodeTether 会先请求远程节点撤销信任，确认成功后才移除本地机器记录。该操作不会删除远程机器上的文件或更改本地电脑。'
              : '远程节点需要可连接才能确认撤销信任。如果无法连接，CodeTether 会保留本地机器和信任记录，不会假装已经远程撤销。'}
        </div>

        {unpairMutation.isError ? (
          <p
            role="alert"
            className="break-words rounded-sm border border-danger/30 bg-danger-muted px-3 py-2 text-sm text-danger"
          >
            {machineErrorMessage(unpairMutation.error, 'unpair')}
          </p>
        ) : null}

        <DialogFooter>
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
            disabled={unpairMutation.isPending || projectCount > 0}
            title={
              projectCount > 0
                ? '当前版本无法在保留项目位置时取消配对'
                : undefined
            }
            onClick={() => unpairMutation.mutate()}
          >
            {unpairMutation.isPending ? '正在取消…' : '取消配对'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

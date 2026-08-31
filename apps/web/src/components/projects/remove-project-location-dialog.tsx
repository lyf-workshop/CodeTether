import { useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'

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
import { projectErrorMessage } from '../../runtime/host/project-actions'

interface RemoveProjectLocationDialogProps {
  location: ProjectRecord['locations'][number]
  machine: MachineSummary
  onOpenChange: (open: boolean) => void
  open: boolean
  project: ProjectRecord
  returnFocus: () => HTMLElement | null
}

export function RemoveProjectLocationDialog({
  location,
  machine,
  onOpenChange,
  open,
  project,
  returnFocus,
}: RemoveProjectLocationDialogProps) {
  const runtime = useHostRuntime()
  const removedRef = useRef(false)
  const removeMutation = useMutation({
    mutationFn: async () =>
      await runtime.removeProjectLocation(
        project.projectId,
        location.machineId,
      ),
    onSuccess: () => {
      removedRef.current = true
      onOpenChange(false)
    },
  })
  const busy = removeMutation.isPending
  const errorMessage = removeMutation.isError
    ? projectErrorMessage(removeMutation.error, 'remove-location')
    : ''

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && busy) return
    if (nextOpen) {
      removedRef.current = false
      removeMutation.reset()
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        closeLabel="关闭移除工作区位置确认"
        className="max-w-md overflow-x-hidden"
        showCloseButton={!busy}
        onCloseAutoFocus={(event) => {
          if (!removedRef.current) return
          event.preventDefault()
          requestAnimationFrame(() => returnFocus()?.focus())
        }}
      >
        <DialogHeader>
          <span
            aria-hidden="true"
            className="grid size-10 place-items-center rounded-md border border-danger/30 bg-danger-muted text-danger"
          >
            <Trash2 className="size-5" />
          </span>
          <DialogTitle>移除工作区位置</DialogTitle>
          <DialogDescription className="break-words">
            {`将从 CodeTether 中移除“${project.name}”在“${machine.displayName}”上的工作区位置。`}
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 rounded-sm border border-border bg-surface-muted/60 px-3 py-3 text-sm text-text-secondary">
          <p>
            {'远程目录“'}
            <span className="break-all font-mono text-xs text-text-primary">
              {location.rootPath}
            </span>
            {'”及其中的文件不会被删除。'}
          </p>
          <p className="mt-2">
            此操作不会删除项目，也不会自动取消与这台机器的配对。
          </p>
        </div>

        {errorMessage ? (
          <p
            id="remove-project-location-error"
            role="alert"
            className="break-words rounded-sm border border-danger/30 bg-danger-muted px-3 py-2 text-sm text-danger"
          >
            {errorMessage}
          </p>
        ) : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary" size="sm" disabled={busy}>
              取消
            </Button>
          </DialogClose>
          <Button
            variant="danger"
            size="sm"
            aria-describedby={
              errorMessage ? 'remove-project-location-error' : undefined
            }
            disabled={busy}
            onClick={() => removeMutation.mutate()}
          >
            {busy ? '正在移除…' : '移除位置'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

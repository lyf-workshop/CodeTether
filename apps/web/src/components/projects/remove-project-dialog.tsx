import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
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
import type { ProjectRecord } from '@codetether/protocol'

import { useHostRuntime } from '../../runtime/host/host-runtime-hooks'
import { projectErrorMessage } from '../../runtime/host/project-actions'
import {
  projectQueryKeys,
  removeProjectCache,
} from '../../runtime/host/project-query'

interface RemoveProjectDialogProps {
  onOpenChange: (open: boolean) => void
  open: boolean
  project: ProjectRecord
}

export function RemoveProjectDialog({
  onOpenChange,
  open,
  project,
}: RemoveProjectDialogProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const runtime = useHostRuntime()
  const removeMutation = useMutation({
    mutationFn: async () => await runtime.deleteProject(project.projectId),
    onSuccess: async () => {
      onOpenChange(false)
      await navigate({ to: '/projects' })
      removeProjectCache(queryClient, project.projectId)
      void queryClient.invalidateQueries({
        queryKey: projectQueryKeys.list,
        exact: true,
      })
    },
  })

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && removeMutation.isPending) return
    if (nextOpen) removeMutation.reset()
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent closeLabel="关闭移除项目确认" className="max-w-md">
        <DialogHeader>
          <span
            aria-hidden="true"
            className="grid size-10 place-items-center rounded-md border border-danger/30 bg-danger-muted text-danger"
          >
            <Trash2 className="size-5" />
          </span>
          <DialogTitle>移除项目</DialogTitle>
          <DialogDescription>
            将“{project.name}”从 CodeTether 的已授权项目中移除。
          </DialogDescription>
        </DialogHeader>

        <div className="mt-1 rounded-sm border border-border bg-surface-muted/60 px-3 py-3 text-sm font-regular text-text-secondary">
          该操作只会移除 CodeTether 中的项目注册，不会删除本地目录、Git
          仓库或任何源文件。
        </div>

        {removeMutation.isError ? (
          <p
            role="alert"
            className="rounded-sm border border-danger/30 bg-danger-muted px-3 py-2 text-sm font-regular text-danger"
          >
            {projectErrorMessage(removeMutation.error, 'remove')}
          </p>
        ) : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button
              variant="secondary"
              size="sm"
              disabled={removeMutation.isPending}
            >
              取消
            </Button>
          </DialogClose>
          <Button
            variant="danger"
            size="sm"
            disabled={removeMutation.isPending}
            onClick={() => removeMutation.mutate()}
          >
            {removeMutation.isPending ? '正在移除…' : '移除项目'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

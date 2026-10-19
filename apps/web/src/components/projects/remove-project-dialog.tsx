import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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

import { allProjectConversationsQueryOptions } from '../../runtime/host/conversation-list-query'
import {
  useHostConnectionState,
  useHostRuntime,
} from '../../runtime/host/host-runtime-hooks'
import { projectErrorMessage } from '../../runtime/host/project-actions'
import {
  projectQueryKeys,
  removeProjectCache,
} from '../../runtime/host/project-query'
import { projectRemovalPreflight } from './project-workspace-model'

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
  const connectionState = useHostConnectionState()
  const conversationsQuery = useQuery({
    ...allProjectConversationsQueryOptions(runtime, project.projectId),
    enabled: open && connectionState === 'connected',
  })
  const preflight = projectRemovalPreflight(
    conversationsQuery.data?.length
      ? conversationsQuery.data
      : connectionState !== 'connected' ||
          conversationsQuery.isFetching ||
          conversationsQuery.isError
        ? undefined
        : conversationsQuery.data,
  )
  const clear = preflight.kind === 'clear'
  const removeMutation = useMutation({
    mutationFn: async () => {
      if (!clear) throw new Error('Project removal preflight is not clear')
      return await runtime.deleteProject(project.projectId)
    },
    onError: () => {
      if (connectionState === 'connected') void conversationsQuery.refetch()
    },
    onSuccess: async () => {
      onOpenChange(false)
      await navigate({ to: '/devices' })
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
      <DialogContent
        closeLabel="关闭移除项目确认"
        className="max-w-md"
        showCloseButton={!removeMutation.isPending}
      >
        <DialogHeader>
          <span
            aria-hidden="true"
            className="grid size-10 place-items-center rounded-md bg-danger-muted text-danger-text"
          >
            <Trash2 className="size-5" />
          </span>
          <DialogTitle>
            {clear
              ? '移除项目'
              : preflight.kind === 'blocked'
                ? '暂时不能移除项目'
                : '正在检查项目'}
          </DialogTitle>
          <DialogDescription>
            {clear
              ? `将“${project.name}”从 CodeTether 中移除。`
              : preflight.kind === 'blocked'
                ? `“${project.name}”仍有${preflight.capped ? '至少 ' : ''}${preflight.count} 个会话，其中${preflight.capped ? '已加载 ' : ''}${preflight.archivedCount} 个已归档。`
                : '需要先确认这个项目没有任何会话，包括已归档和其他设备上的会话。'}
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-sm bg-surface-inset px-3 py-3 text-sm text-text-secondary">
          {clear
            ? '只移除 CodeTether 中的项目注册，不会删除文件夹、代码仓库或任何源文件。'
            : preflight.kind === 'blocked'
              ? '会话历史会继续保留。当前版本没有删除会话的入口，因此暂时不能移除这个项目。'
              : conversationsQuery.isError
                ? '暂时无法读取会话记录，请恢复连接后重新打开。'
                : '正在读取项目的全部会话记录；结果未取得前不能移除。'}
        </p>
        {removeMutation.isError ? (
          <p
            role="alert"
            className="rounded-sm bg-danger-muted px-3 py-2 text-sm text-danger-text"
          >
            {projectErrorMessage(removeMutation.error, 'remove')}
          </p>
        ) : null}
        <DialogFooter>
          {clear ? (
            <>
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
            </>
          ) : (
            <DialogClose asChild>
              <Button size="sm">知道了</Button>
            </DialogClose>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

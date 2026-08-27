import { useState, type FormEvent, type ReactElement } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { FolderPlus } from 'lucide-react'

import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
} from '@codetether/ui'

import { useHostRuntime } from '../../runtime/host/host-runtime-hooks'
import {
  projectErrorMessage,
  type ProjectOperation,
} from '../../runtime/host/project-actions'
import {
  projectQueryKeys,
  upsertProjectCache,
} from '../../runtime/host/project-query'

interface AddProjectDialogProps {
  trigger: ReactElement
}

interface AddProjectValues {
  name?: string
  path: string
}

export function AddProjectDialog({ trigger }: AddProjectDialogProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const runtime = useHostRuntime()
  const [name, setName] = useState('')
  const [open, setOpen] = useState(false)
  const [path, setPath] = useState('')
  const [validationError, setValidationError] = useState('')

  const createMutation = useMutation({
    mutationFn: async ({
      name: projectName,
      path: projectPath,
    }: AddProjectValues) =>
      await runtime.createProject(projectPath, projectName),
    onSuccess: async (response) => {
      upsertProjectCache(queryClient, response.data.project)
      await queryClient.invalidateQueries({
        queryKey: projectQueryKeys.list,
        exact: true,
      })
      setOpen(false)
      setName('')
      setPath('')
      await navigate({
        to: '/projects/$projectId',
        params: { projectId: response.data.project.projectId },
      })
    },
  })

  const errorMessage = createMutation.isError
    ? projectErrorMessage(
        createMutation.error,
        'create' satisfies ProjectOperation,
      )
    : validationError

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && createMutation.isPending) return
    setOpen(nextOpen)
    if (nextOpen) {
      setValidationError('')
      createMutation.reset()
      return
    }

    setName('')
    setPath('')
    setValidationError('')
    createMutation.reset()
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedPath = path.trim()
    const normalizedName = name.trim()

    if (normalizedPath.length === 0) {
      setValidationError('请输入项目的绝对路径。')
      return
    }

    setValidationError('')
    createMutation.mutate({
      path: normalizedPath,
      ...(normalizedName.length === 0 ? {} : { name: normalizedName }),
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        closeLabel="关闭添加项目对话框"
        className="max-w-lg"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          document.getElementById('add-project-path')?.focus()
        }}
      >
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <span
              aria-hidden="true"
              className="grid size-10 place-items-center rounded-md border border-primary/30 bg-primary-muted text-primary"
            >
              <FolderPlus className="size-5" />
            </span>
            <DialogTitle>添加项目</DialogTitle>
            <DialogDescription>
              注册一个本地工作区，让 CodeTether 获得在该目录中运行智能体的授权。
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 space-y-4">
            <div>
              <label
                htmlFor="add-project-path"
                className="text-sm font-medium text-text-primary"
              >
                项目路径
              </label>
              <p
                id="add-project-path-description"
                className="mt-1 text-xs font-regular text-text-muted"
              >
                输入或粘贴本机上的绝对目录路径。
              </p>
              <Input
                id="add-project-path"
                value={path}
                onChange={(event) => setPath(event.target.value)}
                aria-describedby={
                  errorMessage
                    ? 'add-project-path-description add-project-error'
                    : 'add-project-path-description'
                }
                aria-invalid={errorMessage ? true : undefined}
                autoComplete="off"
                disabled={createMutation.isPending}
                placeholder="E:\\Projects\\CodeTether"
                spellCheck={false}
                className="mt-2 font-mono text-sm"
              />
            </div>

            <div>
              <label
                htmlFor="add-project-name"
                className="text-sm font-medium text-text-primary"
              >
                项目名称 <span className="text-text-muted">（可选）</span>
              </label>
              <p className="mt-1 text-xs font-regular text-text-muted">
                留空时使用目录名称。
              </p>
              <Input
                id="add-project-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="off"
                disabled={createMutation.isPending}
                placeholder="CodeTether"
                className="mt-2"
              />
            </div>

            {errorMessage ? (
              <p
                id="add-project-error"
                role="alert"
                className="rounded-sm border border-danger/30 bg-danger-muted px-3 py-2 text-sm font-regular text-danger"
              >
                {errorMessage}
              </p>
            ) : null}
          </div>

          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button
                variant="secondary"
                size="sm"
                disabled={createMutation.isPending}
              >
                取消
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={createMutation.isPending}>
              {createMutation.isPending ? '正在添加…' : '添加项目'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

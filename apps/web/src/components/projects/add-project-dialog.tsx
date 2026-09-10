import { useRef, useState, type FormEvent, type ReactElement } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { FolderOpen, FolderPlus } from 'lucide-react'

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
import type { MachineId, ProjectRecord } from '@codetether/protocol'

import { useHostRuntime } from '../../runtime/host/host-runtime-hooks'
import {
  nativeCapabilities,
  type DirectoryPicker,
} from '../../runtime/native/native-capabilities'
import {
  projectErrorMessage,
  type ProjectOperation,
} from '../../runtime/host/project-actions'
import {
  projectQueryKeys,
  upsertProjectCache,
} from '../../runtime/host/project-query'
import {
  runProjectDirectoryPicker,
  type ProjectDirectoryPickOutcome,
} from './add-project-directory-interaction'
import { createSelectedDirectoryPresentation } from './add-project-presentation'
import { PreviousConversationsStep } from './previous-conversations-step'

interface AddProjectDialogProps {
  deferPreviousConversations?: boolean
  directoryPicker?: DirectoryPicker
  onOpenChange?: (open: boolean) => void
  onProjectCreated?: (
    project: ProjectRecord,
    created: boolean,
    machineId?: MachineId,
  ) => Promise<void> | void
  open?: boolean
  trigger?: ReactElement
}

interface AddProjectValues {
  name?: string
  path: string
}

interface CreatedProjectContext {
  readonly created: boolean
  readonly machineId: MachineId
  readonly project: ProjectRecord
}

export function AddProjectDialog({
  deferPreviousConversations = false,
  directoryPicker = nativeCapabilities.directoryPicker,
  onOpenChange,
  onProjectCreated,
  open: controlledOpen,
  trigger,
}: AddProjectDialogProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const runtime = useHostRuntime()
  const pathInputRef = useRef<HTMLInputElement>(null)
  const pickerButtonRef = useRef<HTMLButtonElement>(null)
  const pickerInFlightRef = useRef<Promise<ProjectDirectoryPickOutcome> | null>(
    null,
  )
  const completionInFlightRef = useRef<Promise<void> | null>(null)
  const [name, setName] = useState('')
  const [internalOpen, setInternalOpen] = useState(false)
  const [path, setPath] = useState('')
  const [pickerError, setPickerError] = useState('')
  const [pickerState, setPickerState] = useState<'idle' | 'picking'>('idle')
  const [validationError, setValidationError] = useState('')
  const [createdProject, setCreatedProject] = useState<CreatedProjectContext>()
  const open = controlledOpen ?? internalOpen
  const selectedDirectory =
    directoryPicker.available && path.length > 0
      ? createSelectedDirectoryPresentation(path)
      : undefined

  const createMutation = useMutation({
    mutationFn: async ({
      name: projectName,
      path: projectPath,
    }: AddProjectValues) =>
      await runtime.createProject(projectPath, projectName),
    onSuccess: async (response) => {
      const project = response.data.project
      upsertProjectCache(queryClient, project)
      await queryClient.invalidateQueries({
        queryKey: projectQueryKeys.list,
        exact: true,
      })
      try {
        const machines = await runtime.listMachines()
        const localMachine = machines.machines.find(
          (machine) => machine.kind === 'local' && machine.isLocal,
        )
        if (
          localMachine !== undefined &&
          project.locations.some(
            (location) => location.machineId === localMachine.machineId,
          )
        ) {
          if (deferPreviousConversations) {
            await finishCreatedProject(
              project,
              response.data.created,
              localMachine.machineId,
            )
            return
          }
          setCreatedProject({
            project,
            created: response.data.created,
            machineId: localMachine.machineId,
          })
          return
        }
      } catch {
        // Project creation is already durable. Discovery is optional, so a
        // Machine-list read failure must not strand the successful flow.
      }
      await finishCreatedProject(project, response.data.created)
    },
  })

  const errorMessage = createMutation.isError
    ? projectErrorMessage(
        createMutation.error,
        'create' satisfies ProjectOperation,
      )
    : pickerError || validationError
  const busy = pickerState === 'picking' || createMutation.isPending

  function setDialogOpen(nextOpen: boolean) {
    if (controlledOpen === undefined) setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  function resetForm() {
    setName('')
    setPath('')
    setPickerError('')
    setValidationError('')
    setCreatedProject(undefined)
  }

  async function finishCreatedProject(
    project: ProjectRecord,
    created: boolean,
    machineId?: MachineId,
  ) {
    const current = completionInFlightRef.current
    if (current !== null) return await current
    const completion = (async () => {
      setDialogOpen(false)
      resetForm()
      if (onProjectCreated !== undefined) {
        if (machineId === undefined) {
          await onProjectCreated(project, created)
        } else {
          await onProjectCreated(project, created, machineId)
        }
        return
      }
      await navigate({
        to: '/projects/$projectId',
        params: { projectId: project.projectId },
      })
    })().finally(() => {
      if (completionInFlightRef.current === completion) {
        completionInFlightRef.current = null
      }
    })
    completionInFlightRef.current = completion
    await completion
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && (busy || createdProject !== undefined)) return
    setDialogOpen(nextOpen)
    if (nextOpen) {
      setPickerError('')
      setValidationError('')
      createMutation.reset()
      return
    }

    resetForm()
    createMutation.reset()
  }

  async function handlePickDirectory() {
    if (
      !directoryPicker.available ||
      pickerInFlightRef.current !== null ||
      createMutation.isPending
    ) {
      return
    }

    setPickerError('')
    setValidationError('')
    createMutation.reset()
    setPickerState('picking')
    const interaction = runProjectDirectoryPicker(directoryPicker, () => {
      requestAnimationFrame(() => pickerButtonRef.current?.focus())
    })
    pickerInFlightRef.current = interaction

    try {
      const outcome = await interaction
      if (outcome.kind === 'selected') setPath(outcome.path)
      if (outcome.kind === 'error') {
        setPickerError('无法打开文件夹选择器，请重试。')
      }
    } finally {
      if (pickerInFlightRef.current === interaction) {
        pickerInFlightRef.current = null
        setPickerState('idle')
      }
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const normalizedPath = path.trim()
    const normalizedName = name.trim()

    if (normalizedPath.length === 0) {
      setValidationError(
        directoryPicker.available
          ? '请选择项目目录。'
          : '请输入项目的绝对路径。',
      )
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
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent
        closeLabel="关闭添加项目对话框"
        className="max-w-lg overflow-x-hidden"
        showCloseButton={createdProject === undefined && !busy}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          if (directoryPicker.available) pickerButtonRef.current?.focus()
          else pathInputRef.current?.focus()
        }}
      >
        {createdProject === undefined ? (
          <form className="min-w-0" onSubmit={handleSubmit}>
            <DialogHeader>
              <span
                aria-hidden="true"
                className="grid size-10 place-items-center rounded-md border border-primary/30 bg-primary-muted text-primary"
              >
                <FolderPlus className="size-5" />
              </span>
              <DialogTitle>添加项目</DialogTitle>
              <DialogDescription>
                注册一个本地工作区，让 CodeTether
                获得在该目录中运行智能体的授权。
              </DialogDescription>
            </DialogHeader>

            <div className="mt-5 min-w-0 space-y-4">
              <div className="min-w-0">
                {directoryPicker.available ? (
                  <span className="text-sm font-medium text-text-primary">
                    项目目录
                  </span>
                ) : (
                  <label
                    htmlFor="add-project-path"
                    className="text-sm font-medium text-text-primary"
                  >
                    项目目录
                  </label>
                )}
                <p
                  id="add-project-path-description"
                  className="mt-1 text-xs font-regular text-text-muted"
                >
                  {directoryPicker.available
                    ? '使用系统文件夹选择器选择一个本地工作区。'
                    : '输入或粘贴本机上的绝对目录路径。'}
                </p>
                {directoryPicker.available ? (
                  <div className="mt-2 min-w-0 space-y-2.5">
                    <Button
                      ref={pickerButtonRef}
                      id="add-project-directory-picker"
                      type="button"
                      variant="secondary"
                      size="sm"
                      aria-describedby={
                        errorMessage
                          ? 'add-project-path-description add-project-error'
                          : 'add-project-path-description'
                      }
                      aria-invalid={errorMessage ? true : undefined}
                      aria-busy={pickerState === 'picking'}
                      disabled={busy}
                      onClick={() => void handlePickDirectory()}
                    >
                      <FolderOpen aria-hidden="true" />
                      {pickerState === 'picking'
                        ? '正在打开…'
                        : selectedDirectory
                          ? '重新选择'
                          : '选择文件夹'}
                    </Button>

                    {selectedDirectory ? (
                      <div
                        aria-live="polite"
                        className="flex w-full min-w-0 max-w-full items-center gap-3 overflow-hidden rounded-sm border border-border bg-surface-muted px-3 py-2.5"
                      >
                        <FolderOpen
                          aria-hidden="true"
                          className="size-4 shrink-0 text-primary"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-text-primary">
                            {selectedDirectory.name}
                          </span>
                          <span
                            className="mt-0.5 block truncate font-mono text-xs text-text-muted"
                            title={selectedDirectory.path}
                          >
                            {selectedDirectory.path}
                          </span>
                        </span>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <Input
                    ref={pathInputRef}
                    id="add-project-path"
                    value={path}
                    onChange={(event) => {
                      setPath(event.target.value)
                      setPickerError('')
                      setValidationError('')
                    }}
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
                )}
              </div>

              <div className="min-w-0">
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
                  disabled={busy}
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
                <Button variant="secondary" size="sm" disabled={busy}>
                  取消
                </Button>
              </DialogClose>
              <Button type="submit" size="sm" disabled={busy}>
                {createMutation.isPending ? '正在添加…' : '添加项目'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <PreviousConversationsStep
            projectId={createdProject.project.projectId}
            machineId={createdProject.machineId}
            onFinished={() =>
              finishCreatedProject(
                createdProject.project,
                createdProject.created,
                createdProject.machineId,
              )
            }
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

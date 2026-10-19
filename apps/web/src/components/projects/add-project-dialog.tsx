import { useRef, useState, type FormEvent, type ReactElement } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

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
  Notice,
  SectionState,
} from '@codetether/ui'
import type { MachineId, ProjectId, ProjectRecord } from '@codetether/protocol'

import {
  useHostConnectionState,
  useHostRuntime,
} from '../../runtime/host/host-runtime-hooks'
import {
  machineListQueryOptions,
  machineQueryKeys,
} from '../../runtime/host/machine-query'
import {
  nativeCapabilities,
  type DirectoryPicker,
} from '../../runtime/native/native-capabilities'
import { projectErrorMessage } from '../../runtime/host/project-actions'
import {
  projectDetailQueryOptions,
  projectQueryKeys,
  upsertProjectCache,
} from '../../runtime/host/project-query'
import {
  runProjectDirectoryPicker,
  type ProjectDirectoryPickOutcome,
} from './add-project-directory-interaction'
import { createSelectedDirectoryPresentation } from './add-project-presentation'
import { AddProjectFields } from './add-project-fields'
import {
  chooseInitialProjectMachineId,
  createProjectForMachine,
  nextProjectCreationStep,
  projectCreationMachines,
} from './add-project-model'
import { PreviousConversationsStep } from './previous-conversations-step'
import {
  fixedProjectCreationMachineExplanation,
  selectFixedProjectCreationMachine,
} from './project-creation-machine'

interface AddProjectDialogProps {
  fixedMachineId?: MachineId
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
  readonly machineId: MachineId
  readonly name?: string
  readonly path: string
}

interface CreatedProjectContext {
  readonly created: boolean
  readonly machineId: MachineId
  readonly projectId: ProjectId
}

export function AddProjectDialog({
  fixedMachineId,
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
  const connectionState = useHostConnectionState()
  const pathInputRef = useRef<HTMLInputElement>(null)
  const pickerButtonRef = useRef<HTMLButtonElement>(null)
  const pickerInFlightRef = useRef<Promise<ProjectDirectoryPickOutcome> | null>(
    null,
  )
  const registrationInFlightRef = useRef(false)
  const completionInFlightRef = useRef<Promise<void> | null>(null)
  const [internalOpen, setInternalOpen] = useState(false)
  const [selectedMachineId, setSelectedMachineId] = useState<MachineId>()
  const [nameOverride, setNameOverride] = useState<string>()
  const [path, setPath] = useState('')
  const [pickerError, setPickerError] = useState('')
  const [pickerState, setPickerState] = useState<'idle' | 'picking'>('idle')
  const [validationError, setValidationError] = useState('')
  const [createdProject, setCreatedProject] = useState<CreatedProjectContext>()
  const open = controlledOpen ?? internalOpen
  const machinesQuery = useQuery({
    ...machineListQueryOptions(runtime),
    enabled: open && connectionState === 'connected',
  })
  const machines = projectCreationMachines(machinesQuery.data)
  const machineId = fixedMachineId ?? selectedMachineId
  const target = selectFixedProjectCreationMachine(
    machinesQuery.data,
    machineId,
  )
  const targetReady =
    connectionState === 'connected' && target.state === 'ready'
  const targetExplanation =
    connectionState !== 'connected'
      ? 'CodeTether 暂时无法连接。恢复连接后可以继续添加项目。'
      : fixedProjectCreationMachineExplanation(target.state)
  const canPickDirectory =
    directoryPicker.available && target.machine?.kind === 'local'
  const name =
    nameOverride ??
    (path.trim().length > 0
      ? createSelectedDirectoryPresentation(path.trim()).name
      : '')

  // Record only the initial UI selection as metadata arrives, never replace
  // an explicit target when availability changes or a Query refresh completes.
  const initialMachineId = chooseInitialProjectMachineId(machinesQuery.data)
  if (
    open &&
    fixedMachineId === undefined &&
    selectedMachineId === undefined &&
    initialMachineId !== undefined
  ) {
    setSelectedMachineId(initialMachineId)
  }

  const createMutation = useMutation({
    retry: false,
    mutationFn: async (values: AddProjectValues) => {
      const current = selectFixedProjectCreationMachine(
        queryClient.getQueryData(machineQueryKeys.list),
        values.machineId,
      )
      if (
        connectionState !== 'connected' ||
        current.machine === undefined ||
        current.state !== 'ready'
      ) {
        throw new Error(
          'Selected Machine is not available for Project registration',
        )
      }
      return await createProjectForMachine(runtime, current.machine, values)
    },
    onSuccess: async (response, values) => {
      const project = response.data.project
      upsertProjectCache(queryClient, project)
      void queryClient.invalidateQueries({
        queryKey: projectQueryKeys.list,
        exact: true,
      })
      void queryClient.invalidateQueries({
        queryKey: machineQueryKeys.detail(values.machineId),
        exact: true,
      })
      if (
        nextProjectCreationStep(
          response.data.created,
          deferPreviousConversations,
        ) === 'finished'
      ) {
        await finishCreatedProject(
          project,
          response.data.created,
          values.machineId,
        )
        return
      }
      setCreatedProject({
        projectId: project.projectId,
        created: response.data.created,
        machineId: values.machineId,
      })
    },
  })

  const errorMessage = createMutation.isError
    ? projectErrorMessage(
        createMutation.error,
        target.machine?.kind === 'remote' ? 'create-remote' : 'create',
      )
    : pickerError || validationError
  const busy = pickerState === 'picking' || createMutation.isPending

  function setDialogOpen(nextOpen: boolean) {
    if (controlledOpen === undefined) setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  function resetForm() {
    setSelectedMachineId(undefined)
    setNameOverride(undefined)
    setPath('')
    setPickerError('')
    setValidationError('')
    setCreatedProject(undefined)
  }

  async function finishCreatedProject(
    project: ProjectRecord,
    created: boolean,
    exactMachineId: MachineId,
  ) {
    const current = completionInFlightRef.current
    if (current !== null) return await current
    const completion = (async () => {
      setDialogOpen(false)
      resetForm()
      if (onProjectCreated !== undefined) {
        await onProjectCreated(project, created, exactMachineId)
        return
      }
      await navigate({
        to: '/projects/$projectId',
        params: { projectId: project.projectId },
        search: { machineId: exactMachineId },
      })
    })().finally(() => {
      if (completionInFlightRef.current === completion)
        completionInFlightRef.current = null
    })
    completionInFlightRef.current = completion
    await completion
  }

  function clearErrors() {
    setPickerError('')
    setValidationError('')
    createMutation.reset()
  }

  function handleOpenChange(nextOpen: boolean) {
    if (
      !nextOpen &&
      (busy ||
        registrationInFlightRef.current ||
        pickerInFlightRef.current !== null ||
        createdProject !== undefined)
    )
      return
    setDialogOpen(nextOpen)
    clearErrors()
    if (!nextOpen) resetForm()
  }

  function handleMachineChange(nextMachineId: MachineId) {
    if (
      busy ||
      registrationInFlightRef.current ||
      pickerInFlightRef.current !== null
    )
      return
    const next = selectFixedProjectCreationMachine(
      machinesQuery.data,
      nextMachineId,
    )
    if (fixedMachineId !== undefined || next.state !== 'ready') return
    setSelectedMachineId(nextMachineId)
    setPath('')
    setNameOverride(undefined)
    clearErrors()
    requestAnimationFrame(() => pathInputRef.current?.focus())
  }

  async function handlePickDirectory() {
    if (
      !canPickDirectory ||
      !targetReady ||
      pickerInFlightRef.current !== null ||
      registrationInFlightRef.current
    )
      return
    clearErrors()
    setPickerState('picking')
    const interaction = runProjectDirectoryPicker(directoryPicker, () => {
      requestAnimationFrame(() => pickerButtonRef.current?.focus())
    })
    pickerInFlightRef.current = interaction
    try {
      const outcome = await interaction
      if (outcome.kind === 'selected') setPath(outcome.path)
      if (outcome.kind === 'error')
        setPickerError('无法打开文件夹选择器，请重试或直接输入路径。')
    } finally {
      if (pickerInFlightRef.current === interaction) {
        pickerInFlightRef.current = null
        setPickerState('idle')
      }
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (
      busy ||
      registrationInFlightRef.current ||
      pickerInFlightRef.current !== null
    )
      return
    if (!targetReady || machineId === undefined) {
      setValidationError(
        targetExplanation ?? '请选择一台可以运行 AI 工具的设备。',
      )
      return
    }
    const normalizedPath = path.trim()
    const normalizedName = name.trim()
    if (normalizedPath.length === 0) {
      setValidationError('请选择文件夹，或输入项目的完整路径。')
      pathInputRef.current?.focus()
      return
    }
    clearErrors()
    registrationInFlightRef.current = true
    try {
      await createMutation.mutateAsync({
        machineId,
        path: normalizedPath,
        ...(normalizedName.length === 0 ? {} : { name: normalizedName }),
      })
    } catch {
      // The canonical error is presented below. No retry, fallback or replay.
    } finally {
      registrationInFlightRef.current = false
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent
        closeLabel="关闭添加项目对话框"
        className="ct-add-project-dialog max-w-lg overflow-x-hidden"
        showCloseButton={createdProject === undefined && !busy}
        aria-busy={busy}
        onOpenAutoFocus={(event) => {
          if (pathInputRef.current !== null) {
            event.preventDefault()
            pathInputRef.current.focus()
          }
        }}
      >
        {createdProject === undefined ? (
          <form
            className="min-w-0"
            onSubmit={(event) => void handleSubmit(event)}
          >
            <DialogHeader>
              <DialogTitle>添加项目</DialogTitle>
              <DialogDescription>
                选择你平时用 Codex 或 Claude Code
                打开的文件夹。添加后会自动查找以前的会话。
              </DialogDescription>
            </DialogHeader>
            <div className="mt-5 min-w-0 space-y-4">
              {machinesQuery.isPending && connectionState === 'connected' ? (
                <SectionState state="loading" title="正在读取设备" />
              ) : machinesQuery.isError ? (
                <SectionState
                  state="error"
                  title="暂时无法读取设备"
                  description="你的项目没有变化。请检查连接后重试。"
                  action={
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void machinesQuery.refetch()}
                    >
                      重新读取
                    </Button>
                  }
                />
              ) : (
                <>
                  <AddProjectFields
                    machines={machines}
                    machine={target.machine}
                    fixedMachine={fixedMachineId !== undefined}
                    ready={targetReady}
                    busy={busy}
                    canPickDirectory={canPickDirectory}
                    picking={pickerState === 'picking'}
                    path={path}
                    name={name}
                    hasError={errorMessage.length > 0}
                    pathInputRef={pathInputRef}
                    pickerButtonRef={pickerButtonRef}
                    onMachineChange={handleMachineChange}
                    onPathChange={(value) => {
                      setPath(value)
                      clearErrors()
                    }}
                    onNameChange={(value) => {
                      setNameOverride(value)
                      clearErrors()
                    }}
                    onPickDirectory={() => void handlePickDirectory()}
                  />
                  {targetExplanation ? (
                    <Notice tone="warn">{targetExplanation}</Notice>
                  ) : null}
                  {machinesQuery.data?.length === 0 ? (
                    <Notice title="还没有可用的设备">
                      在设备页添加设备，或等这台电脑恢复后再添加项目。
                    </Notice>
                  ) : null}
                </>
              )}
              {errorMessage ? (
                <Notice id="add-project-error" tone="err">
                  {errorMessage}
                </Notice>
              ) : null}
            </div>
            <DialogFooter className="mt-6">
              <DialogClose asChild>
                <Button variant="secondary" disabled={busy}>
                  取消
                </Button>
              </DialogClose>
              <Button type="submit" disabled={busy || !targetReady}>
                {createMutation.isPending ? '正在添加…' : '添加'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <CreatedProjectStep
            context={createdProject}
            machineName={
              machinesQuery.data?.find(
                (machine) => machine.machineId === createdProject.machineId,
              )?.displayName ?? '所选设备'
            }
            onFinished={finishCreatedProject}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function CreatedProjectStep({
  context,
  machineName,
  onFinished,
}: {
  readonly context: CreatedProjectContext
  readonly machineName: string
  readonly onFinished: (
    project: ProjectRecord,
    created: boolean,
    machineId: MachineId,
  ) => Promise<void>
}) {
  const runtime = useHostRuntime()
  const projectQuery = useQuery({
    ...projectDetailQueryOptions(runtime, context.projectId),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const project = projectQuery.data
  const location = project?.locations.find(
    (candidate) => candidate.machineId === context.machineId,
  )
  return (
    <div className="min-w-0 space-y-5">
      <DialogHeader>
        <DialogTitle className="break-words">
          已添加 {project?.name ?? '项目'}
        </DialogTitle>
        <DialogDescription>
          可以选择导入以前的会话，也可以跳过并直接开始。
        </DialogDescription>
      </DialogHeader>
      <Notice tone="ok" title="项目已添加">
        <span className="block break-words">{machineName}</span>
        {location ? (
          <span
            className="block break-all font-mono text-xs"
            title={location.rootPath}
          >
            {location.rootPath}
          </span>
        ) : null}
      </Notice>
      {project ? (
        <PreviousConversationsStep
          key={`${context.projectId}:${context.machineId}`}
          presentation="page"
          projectId={context.projectId}
          machineId={context.machineId}
          onFinished={() =>
            onFinished(project, context.created, context.machineId)
          }
        />
      ) : (
        <SectionState
          state={projectQuery.isError ? 'error' : 'loading'}
          title={projectQuery.isError ? '暂时无法读取项目' : '正在读取项目'}
          description="项目已经添加成功，不需要重新添加。"
          action={
            projectQuery.isError ? (
              <Button
                variant="secondary"
                onClick={() => void projectQuery.refetch()}
              >
                重新读取
              </Button>
            ) : undefined
          }
        />
      )}
    </div>
  )
}

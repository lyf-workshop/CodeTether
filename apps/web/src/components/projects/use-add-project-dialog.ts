import {
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
  type RefObject,
} from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
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
  projectListQueryOptions,
  projectQueryKeys,
  upsertProjectCache,
} from '../../runtime/host/project-query'
import {
  runProjectDirectoryPicker,
  type ProjectDirectoryPickOutcome,
} from './add-project-directory-interaction'
import { createSelectedDirectoryPresentation } from './add-project-presentation'
import {
  chooseInitialProjectMachineId,
  createProjectForMachine,
  nextProjectCreationStep,
  ProjectFolderRegistrationConflictError,
  projectCreationMachines,
  refreshProjectRegistrationConflict,
} from './add-project-model'
import {
  fixedProjectCreationMachineExplanation,
  ProjectCreationMachineUnavailableError,
  selectFixedProjectCreationMachine,
} from './project-creation-machine'

export interface AddProjectDialogProps {
  fixedMachineId?: MachineId
  returnFocusRef?: RefObject<HTMLElement | null>
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

export interface CreatedProjectContext {
  readonly created: boolean
  readonly machineId: MachineId
  readonly projectId: ProjectId
}

export function useAddProjectDialog({
  fixedMachineId,
  deferPreviousConversations = false,
  directoryPicker = nativeCapabilities.directoryPicker,
  onOpenChange,
  onProjectCreated,
  open: controlledOpen,
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
  const skipCloseFocusRestore = useRef(false)
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
      if (runtime.getConnectionState() !== 'connected')
        throw new ProjectCreationMachineUnavailableError('host_unavailable')
      if (current.machine === undefined || current.state !== 'ready')
        throw new ProjectCreationMachineUnavailableError(current.state)
      try {
        return await createProjectForMachine(runtime, current.machine, values)
      } catch (error) {
        const conflict = await refreshProjectRegistrationConflict(
          error,
          async () => {
            await queryClient.fetchQuery(projectListQueryOptions(runtime))
            void queryClient.invalidateQueries({
              queryKey: machineQueryKeys.detail(values.machineId),
              exact: true,
            })
          },
        )
        throw conflict ?? error
      }
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
    ? createMutation.error instanceof ProjectCreationMachineUnavailableError ||
      createMutation.error instanceof ProjectFolderRegistrationConflictError
      ? createMutation.error.message
      : projectErrorMessage(
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
      skipCloseFocusRestore.current = true
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
    if (nextOpen) skipCloseFocusRestore.current = false
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

  return {
    open,
    handleOpenChange,
    createdProject,
    busy,
    skipCloseFocusRestore,
    pathInputRef,
    pickerButtonRef,
    machinesQuery,
    connectionState,
    machines,
    target,
    targetReady,
    targetExplanation,
    canPickDirectory,
    pickerState,
    path,
    name,
    errorMessage,
    handleMachineChange,
    setPath,
    clearErrors,
    setNameOverride,
    handlePickDirectory,
    createMutation,
    handleSubmit,
    finishCreatedProject,
  }
}

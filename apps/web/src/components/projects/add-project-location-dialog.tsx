import { useRef, useState, type FormEvent, type ReactElement } from 'react'
import { useMutation } from '@tanstack/react-query'
import { FolderPlus, Monitor } from 'lucide-react'

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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@codetether/ui'
import {
  MachineIdSchema,
  type MachineId,
  type MachineSummary,
  type ProjectRecord,
} from '@codetether/protocol'

import { useHostRuntime } from '../../runtime/host/host-runtime-hooks'
import { projectErrorMessage } from '../../runtime/host/project-actions'
import { machineConnectionStateLabel } from '../machines/machine-presentation'
import { PreviousConversationsStep } from './previous-conversations-step'

interface AddProjectLocationDialogProps {
  createNewProject?: boolean
  deferPreviousConversations?: boolean
  machines: readonly MachineSummary[]
  onProjectCreated?: (
    project: ProjectRecord,
    machineId: MachineId,
  ) => Promise<void> | void
  onOpenChange?: (open: boolean) => void
  presentation?: 'technical' | 'ordinary'
  project?: ProjectRecord
  trigger: ReactElement
}

export function AddProjectLocationDialog({
  createNewProject = false,
  deferPreviousConversations = false,
  machines,
  onProjectCreated,
  onOpenChange,
  presentation = 'technical',
  project,
  trigger,
}: AddProjectLocationDialogProps) {
  const runtime = useHostRuntime()
  const pathInputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [rootPath, setRootPath] = useState('')
  const [selectedMachineId, setSelectedMachineId] = useState<MachineId>()
  const [registeredLocation, setRegisteredLocation] = useState<{
    readonly machineId: MachineId
    readonly project: ProjectRecord
  }>()
  const registeredMachineIds = new Set(
    project?.locations.map((location) => location.machineId) ?? [],
  )
  const candidates = machines.filter(
    (machine) =>
      machine.kind === 'remote' &&
      machine.trustState === 'trusted' &&
      machine.capabilities.projectAccess &&
      !registeredMachineIds.has(machine.machineId),
  )
  const defaultMachine =
    candidates.find(
      (machine) =>
        machine.availability === 'available' &&
        machine.connectionState === 'online',
    ) ?? candidates[0]
  const effectiveMachineId = selectedMachineId ?? defaultMachine?.machineId
  const selectedMachine = candidates.find(
    (machine) => machine.machineId === effectiveMachineId,
  )
  const machineReady =
    selectedMachine?.availability === 'available' &&
    selectedMachine.connectionState === 'online'

  const registerMutation = useMutation({
    mutationFn: async () => {
      if (selectedMachine === undefined) {
        throw new Error('No remote Machine selected')
      }
      if (createNewProject) {
        return await runtime.createRemoteProject(selectedMachine.machineId, {
          rootPath,
        })
      }
      if (project === undefined) {
        throw new Error('No Project selected for remote location')
      }
      return await runtime.registerProjectLocation(project.projectId, {
        machineId: selectedMachine.machineId,
        rootPath,
      })
    },
    onSuccess: async (response) => {
      const context = {
        machineId: response.data.location.machineId,
        project: response.data.project,
      }
      if (deferPreviousConversations) {
        setDialogOpen(false)
        await onProjectCreated?.(context.project, context.machineId)
        return
      }
      setRegisteredLocation(context)
    },
  })
  const busy = registerMutation.isPending
  const canSubmit =
    selectedMachine !== undefined && machineReady && rootPath.trim().length > 0
  const errorMessage = registerMutation.isError
    ? projectErrorMessage(
        registerMutation.error,
        createNewProject ? 'create-remote' : 'register-location',
      )
    : ''

  function setDialogOpen(nextOpen: boolean) {
    if (!nextOpen && busy) return
    setOpen(nextOpen)
    onOpenChange?.(nextOpen)
    if (nextOpen) {
      registerMutation.reset()
      setRegisteredLocation(undefined)
      setRootPath('')
      setSelectedMachineId(undefined)
      return
    }
    registerMutation.reset()
    setRegisteredLocation(undefined)
    setRootPath('')
    setSelectedMachineId(undefined)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit || busy) return
    registerMutation.mutate()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && registeredLocation !== undefined) return
        setDialogOpen(nextOpen)
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        closeLabel={
          presentation === 'ordinary'
            ? '关闭选择远程项目文件夹对话框'
            : '关闭添加工作区位置'
        }
        className="max-w-lg overflow-x-hidden"
        showCloseButton={!busy && registeredLocation === undefined}
        onOpenAutoFocus={(event) => {
          if (!machineReady) return
          event.preventDefault()
          pathInputRef.current?.focus()
        }}
      >
        {registeredLocation === undefined ? (
          <form aria-busy={busy} onSubmit={handleSubmit}>
            <DialogHeader>
              <span
                aria-hidden="true"
                className="grid size-10 place-items-center rounded-md border border-primary/30 bg-primary-muted text-primary"
              >
                <FolderPlus className="size-5" />
              </span>
              <DialogTitle>
                {presentation === 'ordinary'
                  ? createNewProject
                    ? '使用另一台电脑上的项目'
                    : '选择另一台电脑上的项目文件夹'
                  : '添加工作区位置'}
              </DialogTitle>
              <DialogDescription>
                {presentation === 'ordinary'
                  ? createNewProject
                    ? '验证另一台已安全连接电脑上的现有项目文件夹。'
                    : `验证“${project?.name ?? '此项目'}”在另一台已安全连接电脑上的现有文件夹。`
                  : `将“${project?.name ?? '此项目'}”在一台已配对远程机器上的真实目录注册为独立位置。`}
              </DialogDescription>
            </DialogHeader>

            <div className="mt-5 min-w-0 space-y-4">
              {project !== undefined ? (
                <div className="min-w-0">
                  <label className="text-sm font-medium text-text-primary">
                    项目
                  </label>
                  <div className="mt-2 min-w-0 rounded-sm border border-border bg-surface-muted px-3 py-2.5 text-sm text-text-primary">
                    <span className="block truncate" title={project.name}>
                      {project.name}
                    </span>
                  </div>
                </div>
              ) : null}

              <div className="min-w-0">
                <label className="text-sm font-medium text-text-primary">
                  {presentation === 'ordinary' ? '电脑' : '机器'}
                </label>
                {candidates.length === 0 ? (
                  <p
                    role="status"
                    className="mt-2 rounded-sm border border-warning/30 bg-warning-muted/35 px-3 py-2 text-sm text-text-secondary"
                  >
                    {presentation === 'ordinary'
                      ? '没有可选择的电脑。请先安全连接另一台电脑，或检查这个项目是否已经添加。'
                      : '没有可添加的位置。请先配对一台支持项目访问的远程机器，或检查该项目是否已在机器上注册。'}
                  </p>
                ) : (
                  <Select
                    value={effectiveMachineId ?? ''}
                    onValueChange={(value) => {
                      const machineId = MachineIdSchema.safeParse(value)
                      if (machineId.success)
                        setSelectedMachineId(machineId.data)
                      registerMutation.reset()
                    }}
                    disabled={busy}
                  >
                    <SelectTrigger
                      className="mt-2 min-w-0"
                      aria-label="选择远程机器"
                    >
                      <SelectValue
                        placeholder={
                          presentation === 'ordinary'
                            ? '选择另一台电脑'
                            : '选择远程机器'
                        }
                      >
                        {selectedMachine === undefined ? undefined : (
                          <span className="flex min-w-0 items-center gap-2">
                            <Monitor
                              aria-hidden="true"
                              className="size-3.5 shrink-0"
                            />
                            <span className="truncate">
                              {selectedMachine.displayName}
                            </span>
                          </span>
                        )}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {candidates.map((machine) => {
                        const online =
                          machine.availability === 'available' &&
                          machine.connectionState === 'online'
                        return (
                          <SelectItem
                            key={machine.machineId}
                            value={machine.machineId}
                            textValue={`${machine.displayName} ${machineConnectionStateLabel(machine.connectionState)}`}
                            disabled={!online}
                            className="py-2"
                          >
                            <span className="grid min-w-0 gap-0.5">
                              <span className="truncate text-text-primary">
                                {machine.displayName}
                              </span>
                              <span className="truncate text-xs text-text-muted">
                                {online
                                  ? presentation === 'ordinary'
                                    ? '已连接 · 可以验证项目文件夹'
                                    : '在线 · 可验证工作区位置'
                                  : `${machineConnectionStateLabel(machine.connectionState)} · 当前不能选择项目文件夹`}
                              </span>
                            </span>
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="min-w-0">
                <label
                  htmlFor="add-project-location-path"
                  className="text-sm font-medium text-text-primary"
                >
                  {presentation === 'ordinary' ? '项目文件夹' : '远程目录'}
                </label>
                <p
                  id="add-project-location-path-description"
                  className="mt-1 text-xs leading-relaxed text-text-muted"
                >
                  {presentation === 'ordinary'
                    ? '输入这台电脑上已有项目文件夹的完整路径。CodeTether 只验证该文件夹，不会浏览文件或执行命令。'
                    : '输入所选远程机器上的绝对目录路径。CodeTether 只验证并注册此目录，不浏览文件或执行命令。'}
                </p>
                <Input
                  ref={pathInputRef}
                  id="add-project-location-path"
                  className="mt-2 min-w-0 font-mono"
                  value={rootPath}
                  maxLength={4096}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="例如 /home/user/project"
                  aria-describedby={
                    errorMessage
                      ? 'add-project-location-path-description add-project-location-error'
                      : 'add-project-location-path-description'
                  }
                  aria-invalid={errorMessage ? true : undefined}
                  disabled={
                    busy || selectedMachine === undefined || !machineReady
                  }
                  onChange={(event) => {
                    setRootPath(event.currentTarget.value)
                    registerMutation.reset()
                  }}
                />
              </div>

              {selectedMachine !== undefined && !machineReady ? (
                <p
                  role="status"
                  className="rounded-sm border border-warning/30 bg-warning-muted/35 px-3 py-2 text-sm text-text-secondary"
                >
                  “{selectedMachine.displayName}
                  ”当前离线。已配对关系仍保留，但恢复在线前不能验证新位置。
                </p>
              ) : null}

              {errorMessage ? (
                <p
                  id="add-project-location-error"
                  role="alert"
                  className="break-words rounded-sm border border-danger/30 bg-danger-muted px-3 py-2 text-sm text-danger"
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
              <Button type="submit" size="sm" disabled={!canSubmit || busy}>
                {busy
                  ? '正在验证…'
                  : createNewProject
                    ? '添加项目'
                    : '添加位置'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <PreviousConversationsStep
            projectId={registeredLocation.project.projectId}
            machineId={registeredLocation.machineId}
            onFinished={() => setDialogOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

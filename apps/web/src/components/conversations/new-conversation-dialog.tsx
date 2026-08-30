import {
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
  type RefObject,
} from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { FolderOpen, LockKeyhole, Plus } from 'lucide-react'

import {
  AgentBadge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@codetether/ui'
import {
  ProjectIdSchema,
  type ProjectId,
  type ProjectRecord,
  type ProviderId,
} from '@codetether/protocol'

import {
  useHostConnectionState,
  useHostRuntime,
} from '../../runtime/host/host-runtime-hooks'
import { conversationListQueryKeys } from '../../runtime/host/conversation-list-query'
import { newConversationErrorMessage } from '../../runtime/host/new-conversation-actions'
import { projectErrorMessage } from '../../runtime/host/project-actions'
import { projectListQueryOptions } from '../../runtime/host/project-query'
import {
  providerPresentation,
  providerPresentations,
} from '../../provider/provider-presentation'
import { createProjectOptionPresentation } from './new-conversation-presentation'
import {
  defaultProviderControls,
  defaultProviderModel,
  effectiveProviderReasoning,
  providerDefaultReasoningSelection,
  providerReasoningFromControl,
} from './new-conversation-provider-selection'

interface NewConversationDialogProps {
  currentProject?: ProjectRecord
  onAddProject?: () => void
  onOpenChange?: (open: boolean) => void
  open?: boolean
  returnFocusRef?: RefObject<HTMLButtonElement | null>
  trigger?: ReactElement
}

/** Minimal real create flow: one authorized Project and one durable Provider. */
export function NewConversationDialog({
  currentProject,
  onAddProject,
  onOpenChange,
  open: controlledOpen,
  returnFocusRef,
  trigger,
}: NewConversationDialogProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const runtime = useHostRuntime()
  const connectionState = useHostConnectionState()
  const [internalOpen, setInternalOpen] = useState(false)
  const [selectedProjectId, setSelectedProjectId] = useState<
    ProjectId | undefined
  >()
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>('codex')
  const [selectedModel, setSelectedModel] = useState<string>()
  const [selectedReasoning, setSelectedReasoning] = useState<string>()
  const skipCloseFocusRestore = useRef(false)
  const open = controlledOpen ?? internalOpen
  const projectsQuery = useQuery({
    ...projectListQueryOptions(runtime),
    enabled:
      open && currentProject === undefined && connectionState === 'connected',
  })
  const availableProjects = (projectsQuery.data ?? []).filter(
    (project) => project.availability === 'available',
  )

  const createMutation = useMutation({
    mutationFn: (selection: {
      readonly projectId: ProjectId
      readonly provider: ProviderId
      readonly model?: string
      readonly reasoning?: string
    }) =>
      runtime.createConversation(selection.projectId, {
        provider: selection.provider,
        ...(selection.model === undefined ? {} : { model: selection.model }),
        ...(selection.reasoning === undefined
          ? {}
          : { reasoning: selection.reasoning }),
      }),
    onSuccess: async (response) => {
      const projectId = response.data.conversation.projectId
      if (projectId !== undefined) {
        await queryClient.invalidateQueries({
          queryKey: conversationListQueryKeys.project(projectId),
          exact: true,
        })
      }
      skipCloseFocusRestore.current = true
      await navigate({
        to: '/conversations/$conversationId',
        params: {
          conversationId: response.data.conversation.conversationId,
        },
        search: { focus: 'composer' },
      })
      closeAfterSuccess()
    },
  })

  const effectiveSelectedProjectId =
    selectedProjectId ?? availableProjects[0]?.projectId
  const selectedProject =
    currentProject ??
    availableProjects.find(
      (project) => project.projectId === effectiveSelectedProjectId,
    )
  const providers = providerPresentations(runtime.bootstrap)
  const selectedProviderPresentation = providerPresentation(
    runtime.bootstrap,
    selectedProvider,
  )
  const showsModelSelection =
    selectedProviderPresentation.capabilities.modelSelection &&
    selectedProviderPresentation.models.length > 0
  const showsReasoning =
    selectedProviderPresentation.capabilities.reasoningControl
  const supportsReasoningSelection =
    showsReasoning && selectedProviderPresentation.reasoningOptions.length > 0
  const effectiveSelectedReasoning = effectiveProviderReasoning(
    selectedReasoning,
    selectedProviderPresentation,
  )
  const defaultReasoningSelection = providerDefaultReasoningSelection(
    selectedProviderPresentation,
  )
  const effectiveSelectedModel =
    selectedModel ?? defaultProviderModel(selectedProviderPresentation)
  const settingCount = 1 + Number(showsModelSelection) + Number(showsReasoning)
  const hostUnavailable =
    connectionState === 'unavailable' || connectionState === 'incompatible'
  const projectUnavailable = selectedProject?.availability === 'unavailable'
  const noAvailableProjects =
    currentProject === undefined &&
    projectsQuery.isSuccess &&
    availableProjects.length === 0
  const canSubmit =
    connectionState === 'connected' &&
    selectedProviderPresentation.available &&
    selectedProviderPresentation.capabilities.streaming &&
    selectedProject !== undefined &&
    !projectUnavailable &&
    !createMutation.isPending

  function setDialogOpen(nextOpen: boolean) {
    if (!nextOpen && createMutation.isPending) return
    if (controlledOpen === undefined) setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
    if (nextOpen) {
      skipCloseFocusRestore.current = false
      createMutation.reset()
      setSelectedProjectId(currentProject?.projectId)
      setSelectedProvider('codex')
      const defaults = defaultProviderControls(
        providerPresentation(runtime.bootstrap, 'codex'),
      )
      setSelectedModel(defaults.model)
      setSelectedReasoning(defaults.reasoning)
      return
    }
    createMutation.reset()
    setSelectedProjectId(undefined)
    setSelectedProvider('codex')
    setSelectedModel(undefined)
    setSelectedReasoning(undefined)
  }

  function closeAfterSuccess() {
    if (controlledOpen === undefined) setInternalOpen(false)
    onOpenChange?.(false)
    setSelectedProjectId(undefined)
    setSelectedProvider('codex')
    setSelectedModel(undefined)
    setSelectedReasoning(undefined)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return
    createMutation.mutate({
      projectId: selectedProject.projectId,
      provider: selectedProvider,
      ...(showsModelSelection && effectiveSelectedModel !== undefined
        ? { model: effectiveSelectedModel }
        : {}),
      ...(supportsReasoningSelection && effectiveSelectedReasoning !== undefined
        ? { reasoning: effectiveSelectedReasoning }
        : {}),
    })
  }

  function handleProviderChange(value: string) {
    const provider = value as ProviderId
    const presentation = providerPresentation(runtime.bootstrap, provider)
    const defaults = defaultProviderControls(presentation)
    setSelectedProvider(provider)
    setSelectedModel(defaults.model)
    setSelectedReasoning(defaults.reasoning)
    createMutation.reset()
  }

  return (
    <Dialog open={open} onOpenChange={setDialogOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent
        closeLabel="关闭新建会话对话框"
        className="max-w-lg"
        onCloseAutoFocus={(event) => {
          if (skipCloseFocusRestore.current) {
            skipCloseFocusRestore.current = false
            event.preventDefault()
            return
          }
          if (returnFocusRef?.current === undefined) return
          event.preventDefault()
          returnFocusRef.current?.focus()
        }}
      >
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <span
              aria-hidden="true"
              className="grid size-10 place-items-center rounded-md border border-primary/30 bg-primary-muted text-primary"
            >
              <Plus className="size-5" />
            </span>
            <DialogTitle>新建会话</DialogTitle>
            <DialogDescription>
              在已授权项目中创建一个会话。智能体创建后将保持不变。
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 space-y-4">
            <div>
              <p className="text-sm font-medium text-text-primary">项目</p>
              {currentProject ? (
                <div className="mt-2 flex min-w-0 items-center gap-2.5 rounded-sm border border-border-strong bg-surface-muted px-3 py-2.5">
                  <FolderOpen
                    aria-hidden="true"
                    className="size-4 shrink-0 text-primary"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                    {currentProject.name}
                  </span>
                  <LockKeyhole
                    aria-label="当前项目已锁定"
                    className="size-3.5 shrink-0 text-text-muted"
                  />
                </div>
              ) : connectionState === 'connected' && !noAvailableProjects ? (
                <Select
                  value={effectiveSelectedProjectId ?? ''}
                  onValueChange={(value) => {
                    const projectId = ProjectIdSchema.safeParse(value)
                    if (projectId.success) setSelectedProjectId(projectId.data)
                  }}
                  disabled={projectsQuery.isPending || createMutation.isPending}
                >
                  <SelectTrigger className="mt-2" aria-label="选择项目">
                    <SelectValue placeholder="选择可用项目">
                      {selectedProject === undefined
                        ? undefined
                        : createProjectOptionPresentation(selectedProject)
                            .textValue}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {availableProjects.map((project) => {
                      const presentation =
                        createProjectOptionPresentation(project)

                      return (
                        <SelectItem
                          key={project.projectId}
                          value={project.projectId}
                          textValue={presentation.textValue}
                          className="py-2"
                        >
                          <span className="grid min-w-0 gap-0.5">
                            <span className="truncate text-text-primary">
                              {presentation.name}
                            </span>
                            <span
                              className="truncate text-xs text-text-muted"
                              title={presentation.rootPath}
                            >
                              {presentation.rootPath}
                            </span>
                          </span>
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              ) : null}
            </div>

            <dl
              className={cn(
                'grid gap-3 rounded-sm border border-border bg-surface/55 px-3 py-3 text-sm',
                settingCount === 3
                  ? 'grid-cols-2 sm:grid-cols-3'
                  : settingCount === 2
                    ? 'grid-cols-2'
                    : 'grid-cols-1',
              )}
            >
              <LockedSetting
                label="智能体"
                value={
                  <Select
                    value={selectedProvider}
                    onValueChange={handleProviderChange}
                    disabled={createMutation.isPending}
                  >
                    <SelectTrigger size="sm" aria-label="选择智能体">
                      <SelectValue>
                        <span className="flex min-w-0 items-center gap-1.5">
                          <AgentBadge
                            agent={selectedProviderPresentation.agent}
                            variant="compact"
                          />
                          <span className="truncate">
                            {selectedProviderPresentation.displayName}
                          </span>
                        </span>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {providers.map((provider) => (
                        <SelectItem
                          key={provider.provider}
                          value={provider.provider}
                          textValue={`${provider.displayName} ${provider.availabilityLabel}`}
                          disabled={!provider.available}
                          className="py-2"
                        >
                          <span className="grid min-w-0 gap-0.5">
                            <span className="flex min-w-0 items-center gap-1.5 text-text-primary">
                              <AgentBadge
                                agent={provider.agent}
                                variant="compact"
                              />
                              <span className="truncate">
                                {provider.displayName}
                              </span>
                            </span>
                            <span className="truncate text-xs text-text-muted">
                              {provider.availabilityLabel}
                              {provider.version === undefined
                                ? ''
                                : ` · ${provider.version}`}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
              />
              {showsModelSelection ? (
                <LockedSetting
                  label="模型"
                  value={
                    <Select
                      value={effectiveSelectedModel}
                      onValueChange={setSelectedModel}
                      disabled={createMutation.isPending}
                    >
                      <SelectTrigger size="sm" aria-label="选择模型">
                        <SelectValue placeholder="选择模型" />
                      </SelectTrigger>
                      <SelectContent>
                        {selectedProviderPresentation.models.map((model) => (
                          <SelectItem
                            key={model.id}
                            value={model.id}
                            textValue={model.label}
                          >
                            {model.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  }
                />
              ) : null}
              {showsReasoning ? (
                <LockedSetting
                  label={selectedProviderPresentation.reasoningLabel}
                  value={
                    supportsReasoningSelection ? (
                      <Select
                        value={
                          effectiveSelectedReasoning ??
                          defaultReasoningSelection
                        }
                        onValueChange={(value) =>
                          setSelectedReasoning(
                            providerReasoningFromControl(
                              value,
                              selectedProviderPresentation,
                            ),
                          )
                        }
                        disabled={createMutation.isPending}
                      >
                        <SelectTrigger
                          size="sm"
                          aria-label={`选择${selectedProviderPresentation.reasoningLabel}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={defaultReasoningSelection}>
                            默认
                          </SelectItem>
                          {selectedProviderPresentation.reasoningOptions.map(
                            (option) => (
                              <SelectItem
                                key={option.id}
                                value={option.id}
                                textValue={option.label}
                              >
                                {option.label}
                              </SelectItem>
                            ),
                          )}
                        </SelectContent>
                      </Select>
                    ) : (
                      '默认'
                    )
                  }
                />
              ) : null}
            </dl>

            {projectUnavailable ? (
              <InlineNotice>
                项目目录当前不可用；恢复原目录后才能创建会话。
              </InlineNotice>
            ) : null}
            {hostUnavailable ? (
              <InlineNotice>
                {connectionState === 'incompatible'
                  ? '当前 CodeTether 版本不兼容。'
                  : 'CodeTether 暂时无法连接。'}
              </InlineNotice>
            ) : null}
            {connectionState === 'connected' &&
            !selectedProviderPresentation.available ? (
              <InlineNotice>
                {`${selectedProviderPresentation.displayName}：${selectedProviderPresentation.availabilityLabel}。`}
              </InlineNotice>
            ) : null}
            {connectionState === 'connected' &&
            selectedProviderPresentation.available &&
            !selectedProviderPresentation.capabilities.streaming ? (
              <InlineNotice>
                {`${selectedProviderPresentation.displayName} 当前不支持通过 CodeTether 启动流式会话。`}
              </InlineNotice>
            ) : null}
            {noAvailableProjects ? (
              <InlineNotice>
                还没有可用项目。请先添加或恢复一个本地工作区。
              </InlineNotice>
            ) : null}
            {projectsQuery.isError ? (
              <p
                role="alert"
                className="rounded-sm border border-danger/30 bg-danger-muted px-3 py-2 text-sm text-danger"
              >
                {projectErrorMessage(projectsQuery.error, 'load')}
              </p>
            ) : null}
            {createMutation.isError ? (
              <p
                role="alert"
                className="rounded-sm border border-danger/30 bg-danger-muted px-3 py-2 text-sm text-danger"
              >
                {newConversationErrorMessage(
                  createMutation.error,
                  selectedProvider,
                )}
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
            {noAvailableProjects ? (
              <Button
                type="button"
                size="sm"
                disabled={onAddProject === undefined}
                onClick={onAddProject}
              >
                添加项目
              </Button>
            ) : (
              <Button type="submit" size="sm" disabled={!canSubmit}>
                {createMutation.isPending ? '正在创建…' : '创建会话'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function LockedSetting({
  label,
  value,
}: {
  label: string
  value: ReactElement | string
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="mt-1 flex min-h-7 items-center truncate font-medium text-text-primary">
        {value}
      </dd>
    </div>
  )
}

function InlineNotice({ children }: { children: string }) {
  return (
    <p
      role="status"
      className="rounded-sm border border-warning/30 bg-warning-muted/35 px-3 py-2 text-sm text-text-secondary"
    >
      {children}
    </p>
  )
}

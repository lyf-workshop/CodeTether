import {
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
  type RefObject,
} from 'react'
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
} from '@codetether/ui'
import {
  MachineIdSchema,
  type MachineId,
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
import {
  machineDetailQueryOptions,
  machineListQueryOptions,
} from '../../runtime/host/machine-query'
import { projectListQueryOptions } from '../../runtime/host/project-query'
import { providerPresentationsForMachine } from '../../provider/provider-presentation'
import {
  effectiveProviderReasoning,
  providerDefaultReasoningSelection,
  providerReasoningFromControl,
} from './new-conversation-provider-selection'
import { NewConversationFields } from './new-conversation-fields'
import {
  conversationCreationProviderOptions,
  conversationProjectGroups,
  eligibleConversationProjectSelection,
  resolveConversationCreationProvider,
  resolveConversationProject,
  type ConversationProjectSelection,
  type NewConversationLaunchContext,
} from './new-conversation-selection'

interface NewConversationDialogProps {
  /** Legacy project-page callers remain fixed; global launchers use identifiers. */
  currentProject?: ProjectRecord
  currentMachineId?: MachineId
  launchContext?: NewConversationLaunchContext
  onAddProject?: (machineId?: MachineId) => void
  onOpenChange?: (open: boolean) => void
  open?: boolean
  returnFocusRef?: RefObject<HTMLElement | null>
  trigger?: ReactElement
}

const unavailableMachineQueryId = MachineIdSchema.parse('machine_unavailable')

/** Selection is identifiers only; records, descriptors and installation state belong to Query. */
export function NewConversationDialog({
  currentProject,
  currentMachineId,
  launchContext,
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
  const [selectedProject, setSelectedProject] =
    useState<ConversationProjectSelection>()
  const [selectedProviderId, setSelectedProviderId] = useState<ProviderId>()
  const [selectedReasoning, setSelectedReasoning] = useState<string>()
  const formId = useId()
  const skipCloseFocusRestore = useRef(false)
  const submitRef = useRef(false)
  const open = controlledOpen ?? internalOpen
  const context: NewConversationLaunchContext | undefined =
    launchContext ??
    (currentProject === undefined
      ? currentMachineId === undefined
        ? undefined
        : { kind: 'preselected', machineId: currentMachineId }
      : {
          kind: 'fixed-project',
          projectId: currentProject.projectId,
          ...(currentMachineId === undefined
            ? {}
            : { machineId: currentMachineId }),
        })
  const projectsQuery = useQuery({
    ...projectListQueryOptions(runtime),
    enabled: open && connectionState === 'connected',
  })
  const machinesQuery = useQuery({
    ...machineListQueryOptions(runtime),
    enabled: open && connectionState === 'connected',
  })
  const groups = conversationProjectGroups(
    machinesQuery.data ?? [],
    projectsQuery.data ?? [],
  )
  const projectSelection = resolveConversationProject(
    groups,
    context,
    selectedProject,
  )
  const project = projectSelection.choice
  const selectedMachineId = project?.machineId
  const machineDetailQuery = useQuery({
    ...machineDetailQueryOptions(
      runtime,
      selectedMachineId ?? unavailableMachineQueryId,
    ),
    enabled:
      open && connectionState === 'connected' && project?.machine !== undefined,
  })
  const providerOptions = conversationCreationProviderOptions(
    providerPresentationsForMachine(machineDetailQuery.data?.providers ?? []),
    machineDetailQuery.data?.providerLifecycles,
  )
  const selectedProvider = resolveConversationCreationProvider(
    providerOptions,
    selectedProviderId,
  )
  const presentation = selectedProvider?.provider
  const reasoning =
    presentation === undefined
      ? undefined
      : effectiveProviderReasoning(selectedReasoning, presentation)
  const defaultReasoning =
    presentation === undefined
      ? '__provider_default__'
      : providerDefaultReasoningSelection(presentation)
  const loading =
    projectsQuery.isPending ||
    machinesQuery.isPending ||
    (project?.machine !== undefined && machineDetailQuery.isPending)
  const scopedGroups =
    context?.kind !== 'fixed-project'
      ? groups
      : groups
          .map((group) => ({
            ...group,
            choices: group.choices.filter(
              (choice) =>
                choice.projectId === context.projectId &&
                (context.machineId === undefined ||
                  choice.machineId === context.machineId),
            ),
          }))
          .filter((group) => group.choices.length > 0)
  const emptyProjectScope =
    projectsQuery.isSuccess &&
    machinesQuery.isSuccess &&
    (context?.machineId === undefined
      ? groups.length === 0
      : !groups.some((group) => group.machineId === context.machineId))

  const createMutation = useMutation({
    retry: false,
    onSettled: () => {
      submitRef.current = false
    },
    mutationFn: (selection: {
      readonly projectId: ProjectId
      readonly machineId: MachineId
      readonly provider: ProviderId
      readonly reasoning?: string
    }) =>
      runtime.createConversation(selection.projectId, {
        machineId: selection.machineId,
        provider: selection.provider,
        ...(selection.reasoning === undefined
          ? {}
          : { reasoning: selection.reasoning }),
      }),
    onSuccess: async (response) => {
      const projectId = response.data.conversation.projectId
      if (projectId !== undefined)
        await queryClient.invalidateQueries({
          queryKey: conversationListQueryKeys.project(projectId),
          exact: true,
        })
      skipCloseFocusRestore.current = true
      await navigate({
        to: '/c/$conversationId',
        params: { conversationId: response.data.conversation.conversationId },
        search: { focus: 'composer' },
      })
      closeAfterSuccess()
    },
  })
  const canSubmit =
    connectionState === 'connected' &&
    projectsQuery.isSuccess &&
    machinesQuery.isSuccess &&
    project !== undefined &&
    project.unavailableReason === undefined &&
    machineDetailQuery.isSuccess &&
    selectedProvider?.eligibility.eligible === true &&
    !createMutation.isPending

  function resetSelection() {
    setSelectedProject(undefined)
    setSelectedProviderId(undefined)
    setSelectedReasoning(undefined)
  }
  function closeAfterSuccess() {
    if (controlledOpen === undefined) setInternalOpen(false)
    onOpenChange?.(false)
    resetSelection()
  }
  function setDialogOpen(nextOpen: boolean) {
    if (!nextOpen && (createMutation.isPending || submitRef.current)) return
    if (controlledOpen === undefined) setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
    createMutation.reset()
    resetSelection()
    if (nextOpen) skipCloseFocusRestore.current = false
  }
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (
      submitRef.current ||
      !canSubmit ||
      project === undefined ||
      presentation === undefined
    )
      return
    submitRef.current = true
    createMutation.mutate({
      projectId: project.projectId,
      machineId: project.machineId,
      provider: presentation.provider,
      ...(presentation.capabilities.reasoningControl && reasoning !== undefined
        ? { reasoning }
        : {}),
    })
  }

  return (
    <Dialog open={open} onOpenChange={setDialogOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent
        closeLabel="关闭新建会话对话框"
        showCloseButton={!createMutation.isPending}
        className="ct-new-conversation-dialog overflow-x-hidden"
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
            <DialogTitle>新建会话</DialogTitle>
            <DialogDescription>
              选择项目和 AI 工具，CodeTether 会在对应文件夹里启动一个会话。
            </DialogDescription>
          </DialogHeader>
          <div className="mt-5 space-y-4">
            <NewConversationFields
              groups={scopedGroups}
              project={project}
              fixed={projectSelection.fixed}
              loading={loading}
              busy={createMutation.isPending}
              providerOptions={providerOptions}
              selectedProvider={selectedProvider}
              reasoning={reasoning}
              defaultReasoning={defaultReasoning}
              formId={formId}
              onProjectChange={(key) => {
                if (submitRef.current) return
                const selection = eligibleConversationProjectSelection(
                  groups,
                  key,
                  context,
                )
                if (selection === undefined) return
                setSelectedProject(selection)
                if (selection.machineId !== selectedMachineId)
                  setSelectedProviderId(undefined)
                setSelectedReasoning(undefined)
                createMutation.reset()
              }}
              onProviderChange={(providerId) => {
                if (submitRef.current) return
                if (
                  !providerOptions.some(
                    (option) =>
                      option.provider.provider === providerId &&
                      option.eligibility.eligible,
                  )
                )
                  return
                setSelectedProviderId(providerId)
                setSelectedReasoning(undefined)
                createMutation.reset()
              }}
              onReasoningChange={(value) => {
                if (submitRef.current) return
                if (presentation !== undefined)
                  setSelectedReasoning(
                    providerReasoningFromControl(value, presentation),
                  )
              }}
            />
            {project?.unavailableReason === undefined ? null : (
              <InlineNotice>
                {project.unavailableReason +
                  '。请在设备详情恢复连接或目录访问后再创建会话。'}
              </InlineNotice>
            )}
            {!loading && projectSelection.requiresSelection ? (
              <InlineNotice>
                {context?.kind === 'fixed-project'
                  ? '此项目没有唯一可用的位置。请选择此项目所在的设备，或返回设备详情检查原位置。'
                  : '原先选择的项目或设备不可用。请选择项目，不会自动改用其他设备。'}
              </InlineNotice>
            ) : null}
            {selectedProvider?.eligibility.executionAdvisory ===
            undefined ? null : (
              <InlineNotice>
                {selectedProvider.eligibility.executionAdvisory}
              </InlineNotice>
            )}
            {selectedProvider?.eligibility.eligible === false ? (
              <InlineNotice>{selectedProvider.eligibility.label}</InlineNotice>
            ) : null}
            {!loading &&
            project !== undefined &&
            project.unavailableReason === undefined &&
            selectedProvider === undefined ? (
              <InlineNotice>
                此设备当前没有可通过 CodeTether 启动可恢复流式会话的 AI
                工具。请在设备详情检查当前安装，不会自动改用其他工具。
              </InlineNotice>
            ) : null}
            {emptyProjectScope ? (
              <InlineNotice>
                此设备还没有项目。请先添加一个已授权文件夹。
              </InlineNotice>
            ) : null}
            {connectionState !== 'connected' ? (
              <InlineNotice>
                {connectionState === 'incompatible'
                  ? '当前 CodeTether 版本不兼容。'
                  : 'CodeTether 暂时无法连接，连接恢复后才能创建会话。'}
              </InlineNotice>
            ) : null}
            {projectsQuery.isError ? (
              <InlineError>
                {projectErrorMessage(projectsQuery.error, 'load')}
              </InlineError>
            ) : null}
            {machinesQuery.isError || machineDetailQuery.isError ? (
              <InlineError>CodeTether 暂时无法读取设备，请重试。</InlineError>
            ) : null}
            {createMutation.isError ? (
              <>
                <InlineError>
                  {newConversationErrorMessage(
                    createMutation.error,
                    presentation?.provider ?? selectedProviderId ?? 'codex',
                  )}
                </InlineError>
                <p className="text-xs text-text-muted">
                  不会自动重试。如果创建结果尚未确认，请先返回项目检查会话列表。
                </p>
              </>
            ) : null}
          </div>
          <DialogFooter className="mt-6">
            {onAddProject === undefined ? null : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="sm:mr-auto"
                disabled={createMutation.isPending}
                onClick={() => {
                  if (submitRef.current) return
                  skipCloseFocusRestore.current = true
                  onAddProject(selectedMachineId ?? context?.machineId)
                }}
              >
                添加项目
              </Button>
            )}
            <DialogClose asChild>
              <Button
                variant="secondary"
                size="sm"
                disabled={createMutation.isPending}
              >
                取消
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {createMutation.isPending ? '正在创建…' : '创建会话'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
function InlineError({ children }: { children: string }) {
  return (
    <p
      role="alert"
      className="rounded-sm border border-danger/30 bg-danger-muted px-3 py-2 text-sm text-danger"
    >
      {children}
    </p>
  )
}

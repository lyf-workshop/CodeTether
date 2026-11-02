import { useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
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
import {
  ManualConversationTitleSchema,
  type ConversationSummary,
} from '@codetether/protocol'
import {
  conversationOrganizationErrorMessage,
  type ConversationOrganizationOperation,
} from '../../runtime/host/conversation-organization-actions'
import { useHostRuntime } from '../../runtime/host/host-runtime-hooks'
import { conversationDetailQueryOptions } from '../../runtime/host/conversation-detail-query'
import { projectDetailQueryOptions } from '../../runtime/host/project-query'
import { machineListQueryOptions } from '../../runtime/host/machine-query'
import { projectLocationForMachine } from '../../runtime/host/project-location'
import { providerDisplayName } from './conversation-list-model'
import { ConversationSettingsFields } from './conversation-settings-fields'
import {
  conversationArchiveBlockedReason,
  restoreTriggerFocus,
  type OrganizationConversation,
} from './conversation-organization-shared'

interface ConversationSettingsDialogProps {
  conversation: OrganizationConversation
  onOpenChange: (open: boolean) => void
  onRenamed?: (conversation: ConversationSummary) => void
  onArchived?: (conversation: ConversationSummary) => void
  onUnarchived?: (conversation: ConversationSummary) => void
  open: boolean
  returnFocus: () => HTMLButtonElement | null
}

export function ConversationSettingsDialog({
  conversation,
  onOpenChange,
  onRenamed,
  onArchived,
  onUnarchived,
  open,
  returnFocus,
}: ConversationSettingsDialogProps) {
  const runtime = useHostRuntime()
  const [title, setTitle] = useState(conversation.title)
  const [localError, setLocalError] = useState<string>()
  const operationPendingRef = useRef(false)
  const organizationMovedRef = useRef(false)
  const detail = useQuery(
    conversationDetailQueryOptions(runtime, conversation.conversationId),
  )
  const project = useQuery({
    ...projectDetailQueryOptions(
      runtime,
      detail.data?.conversation.projectId ?? conversation.projectId,
    ),
    enabled: detail.data !== undefined,
  })
  const machines = useQuery(machineListQueryOptions(runtime))
  const current = detail.data?.conversation ?? conversation
  const location =
    project.data === undefined || detail.data === undefined
      ? undefined
      : projectLocationForMachine(
          project.data,
          detail.data.conversation.machineId,
        )
  const machine = machines.data?.find(
    (candidate) => candidate.machineId === detail.data?.conversation.machineId,
  )
  const archiveBlockedReason =
    conversationArchiveBlockedReason(conversation) ??
    conversationArchiveBlockedReason(current)
  const mutation = useMutation({
    mutationFn: async (nextTitle: string) =>
      await runtime.renameConversation(conversation.conversationId, nextTitle),
    onSuccess: (response) => {
      onOpenChange(false)
      onRenamed?.(response.data.conversation)
      restoreTriggerFocus(returnFocus())
    },
    onSettled: () => {
      operationPendingRef.current = false
    },
  })
  const organization = useMutation({
    mutationFn: async (
      operation: Exclude<ConversationOrganizationOperation, 'rename'>,
    ) => {
      switch (operation) {
        case 'pin':
          return await runtime.pinConversation(conversation.conversationId)
        case 'unpin':
          return await runtime.unpinConversation(conversation.conversationId)
        case 'archive':
          return await runtime.archiveConversation(conversation.conversationId)
        case 'unarchive':
          return await runtime.unarchiveConversation(
            conversation.conversationId,
          )
      }
    },
    onSuccess: (response, operation) => {
      if (operation !== 'archive' && operation !== 'unarchive') return
      const callback = operation === 'archive' ? onArchived : onUnarchived
      organizationMovedRef.current = callback !== undefined
      onOpenChange(false)
      callback?.(response.data.conversation)
      if (callback === undefined) restoreTriggerFocus(returnFocus())
    },
    onSettled: () => {
      operationPendingRef.current = false
    },
  })
  const pending = mutation.isPending || organization.isPending

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && operationPendingRef.current) return
    onOpenChange(nextOpen)
    if (!nextOpen) restoreTriggerFocus(returnFocus())
  }
  function submitRename() {
    if (operationPendingRef.current) return
    if (!ManualConversationTitleSchema.safeParse(title).success) {
      setLocalError('请输入有效的会话标题；名称过长时请缩短后重试。')
      return
    }
    setLocalError(undefined)
    operationPendingRef.current = true
    mutation.mutate(title)
  }
  function changeOrganization(
    operation: Exclude<ConversationOrganizationOperation, 'rename'>,
  ) {
    if (operationPendingRef.current) return
    if (operation === 'archive' && archiveBlockedReason !== undefined) return
    if (operation === 'pin' && current.archivedAt !== undefined) return
    operationPendingRef.current = true
    setLocalError(undefined)
    mutation.reset()
    organization.mutate(operation)
  }
  const error =
    localError ??
    (mutation.isError
      ? conversationOrganizationErrorMessage(mutation.error, 'rename')
      : organization.isError
        ? conversationOrganizationErrorMessage(
            organization.error,
            organization.variables ?? 'pin',
          )
        : undefined)
  const knownLocation =
    location === undefined ||
    machine === undefined ||
    project.data === undefined ||
    detail.data === undefined
      ? undefined
      : {
          machineName:
            machine.kind === 'local' ? '这台电脑' : machine.displayName,
          projectName: project.data.name,
          rootPath: location.rootPath,
          providerName: providerDisplayName(detail.data.conversation.provider),
        }
  const locationMessage =
    detail.isError || project.isError || machines.isError
      ? '位置暂时无法读取。'
      : detail.isPending || project.isPending || machines.isPending
        ? '正在读取位置…'
        : '这个设备上的项目位置登记不可用。'
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        closeLabel="关闭会话设置"
        className="max-w-(--layout-conversation-settings-width)"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (!organizationMovedRef.current) restoreTriggerFocus(returnFocus())
        }}
      >
        <form
          className="min-w-0"
          onSubmit={(event) => {
            event.preventDefault()
            submitRename()
          }}
        >
          <DialogHeader>
            <DialogTitle>会话设置</DialogTitle>
            <DialogDescription className="sr-only">
              重命名、置顶或归档会话。位置和 AI 工具不会改变。
            </DialogDescription>
          </DialogHeader>
          <ConversationSettingsFields
            conversationId={conversation.conversationId}
            title={title}
            pinned={current.pinnedAt !== undefined}
            archived={current.archivedAt !== undefined}
            pending={pending}
            archiveBlockedReason={archiveBlockedReason}
            location={knownLocation}
            locationMessage={locationMessage}
            error={error}
            onTitleChange={(value) => {
              setTitle(value)
              setLocalError(undefined)
              mutation.reset()
              organization.reset()
            }}
            onPinChange={() =>
              changeOrganization(
                current.pinnedAt === undefined ? 'pin' : 'unpin',
              )
            }
            onArchiveChange={() =>
              changeOrganization(
                current.archivedAt === undefined ? 'archive' : 'unarchive',
              )
            }
          />
          <DialogFooter className="mt-5">
            <DialogClose asChild>
              <Button size="sm" variant="secondary" disabled={pending}>
                取消
              </Button>
            </DialogClose>
            <Button size="sm" type="submit" disabled={pending}>
              {mutation.isPending ? '正在保存…' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

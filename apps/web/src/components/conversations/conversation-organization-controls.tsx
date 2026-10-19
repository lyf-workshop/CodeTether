import {
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type MouseEvent,
} from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
} from 'lucide-react'

import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  cn,
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

export type OrganizationConversation = Pick<
  ConversationSummary,
  | 'conversationId'
  | 'projectId'
  | 'title'
  | 'titleSource'
  | 'pinnedAt'
  | 'archivedAt'
  | 'status'
>

interface ConversationOrganizationMenuProps {
  align?: 'start' | 'center' | 'end'
  conversation: OrganizationConversation
  onArchived?: (conversation: ConversationSummary) => void
  onRenamed?: (conversation: ConversationSummary) => void
  onUnarchived?: (conversation: ConversationSummary) => void
  showRestoreAction?: boolean
  quickActions?: boolean
  trigger?: ReactElement
}

export function ConversationOrganizationMenu({
  align = 'end',
  conversation,
  onArchived,
  onRenamed,
  onUnarchived,
  showRestoreAction = true,
  quickActions = false,
  trigger,
}: ConversationOrganizationMenuProps) {
  const runtime = useHostRuntime()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const archiveTriggerRef = useRef<HTMLButtonElement>(null)
  const dialogOpeningRef = useRef(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuOperationPendingRef = useRef(false)
  const [menuError, setMenuError] = useState<string>()
  const [organizationDialog, setOrganizationDialog] = useState<
    'settings' | 'archive' | null
  >(null)

  const pinMutation = useMutation({
    mutationFn: async () =>
      conversation.pinnedAt === undefined
        ? await runtime.pinConversation(conversation.conversationId)
        : await runtime.unpinConversation(conversation.conversationId),
    onSettled: () => {
      menuOperationPendingRef.current = false
    },
    onSuccess: () => setMenuOpen(false),
    onError: (error) => {
      setMenuError(
        conversationOrganizationErrorMessage(
          error,
          conversation.pinnedAt === undefined ? 'pin' : 'unpin',
        ),
      )
      setMenuOpen(true)
    },
  })
  const unarchiveMutation = useMutation({
    onSettled: () => {
      menuOperationPendingRef.current = false
    },
    mutationFn: async () =>
      await runtime.unarchiveConversation(conversation.conversationId),
    onSuccess: (response) => {
      const updated = response.data.conversation
      setMenuOpen(false)
      onUnarchived?.(updated)
      if (onUnarchived === undefined) {
        restoreTriggerFocus(triggerRef.current)
      }
    },
    onError: (error) => {
      setMenuError(conversationOrganizationErrorMessage(error, 'unarchive'))
      setMenuOpen(true)
    },
  })
  const archiveBlockedReason = conversationArchiveBlockedReason(conversation)
  const menuBusy = pinMutation.isPending || unarchiveMutation.isPending

  function togglePin() {
    if (menuOperationPendingRef.current || menuBusy) return
    menuOperationPendingRef.current = true
    pinMutation.mutate()
  }

  function openRenameDialog() {
    if (menuOperationPendingRef.current || menuBusy) return
    dialogOpeningRef.current = true
    setOrganizationDialog('settings')
  }

  function openArchiveDialog() {
    if (
      menuOperationPendingRef.current ||
      menuBusy ||
      archiveBlockedReason !== undefined
    )
      return
    dialogOpeningRef.current = menuOpen
    if (menuOpen) archiveTriggerRef.current = triggerRef.current
    setOrganizationDialog('archive')
  }

  function openQuickArchive(event: MouseEvent<HTMLButtonElement>) {
    archiveTriggerRef.current = event.currentTarget
    openArchiveDialog()
  }

  return (
    <>
      {quickActions && conversation.archivedAt === undefined ? (
        <>
          <IconButton
            data-slot="conversation-quick-pin"
            label={conversation.pinnedAt === undefined ? '置顶' : '取消置顶'}
            aria-pressed={conversation.pinnedAt !== undefined}
            size="sm"
            variant="ghost"
            disabled={menuBusy}
            onClick={togglePin}
          >
            {conversation.pinnedAt === undefined ? (
              <Pin aria-hidden="true" />
            ) : (
              <PinOff aria-hidden="true" />
            )}
          </IconButton>
          <IconButton
            data-slot="conversation-quick-archive"
            label="归档"
            title={archiveBlockedReason}
            size="sm"
            variant="ghost"
            disabled={archiveBlockedReason !== undefined || menuBusy}
            onClick={openQuickArchive}
          >
            <Archive aria-hidden="true" />
          </IconButton>
        </>
      ) : null}
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(nextOpen) => {
          setMenuOpen(nextOpen)
          if (nextOpen) setMenuError(undefined)
        }}
      >
        <DropdownMenuTrigger ref={triggerRef} asChild>
          {trigger ?? (
            <IconButton
              label={`更多会话操作：${conversation.title}`}
              size="sm"
              variant="ghost"
            >
              <MoreHorizontal aria-hidden="true" />
            </IconButton>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align={align}
          onCloseAutoFocus={(event) => {
            if (!dialogOpeningRef.current) return
            event.preventDefault()
            dialogOpeningRef.current = false
          }}
        >
          {conversation.archivedAt === undefined ? (
            <>
              <DropdownMenuItem
                disabled={menuBusy}
                onSelect={(event) => {
                  event.preventDefault()
                  togglePin()
                }}
              >
                {conversation.pinnedAt === undefined ? (
                  <Pin aria-hidden="true" />
                ) : (
                  <PinOff aria-hidden="true" />
                )}
                {pinMutation.isPending
                  ? '正在更新…'
                  : conversation.pinnedAt === undefined
                    ? '置顶'
                    : '取消置顶'}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={menuBusy} onSelect={openRenameDialog}>
                <Pencil aria-hidden="true" />
                会话设置
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={archiveBlockedReason !== undefined || menuBusy}
                aria-describedby={
                  archiveBlockedReason === undefined
                    ? undefined
                    : `archive-disabled-${conversation.conversationId}`
                }
                title={archiveBlockedReason}
                onSelect={openArchiveDialog}
              >
                <Archive aria-hidden="true" />
                归档
              </DropdownMenuItem>
              {archiveBlockedReason === undefined ? null : (
                <p
                  id={`archive-disabled-${conversation.conversationId}`}
                  className="max-w-56 px-2 py-1 text-xs leading-relaxed text-text-muted"
                >
                  {archiveBlockedReason}
                </p>
              )}
            </>
          ) : (
            <>
              {showRestoreAction ? (
                <DropdownMenuItem
                  disabled={menuBusy}
                  onSelect={(event) => {
                    event.preventDefault()
                    if (menuOperationPendingRef.current || menuBusy) return
                    menuOperationPendingRef.current = true
                    unarchiveMutation.mutate()
                  }}
                >
                  <ArchiveRestore aria-hidden="true" />
                  {unarchiveMutation.isPending ? '正在恢复…' : '恢复'}
                </DropdownMenuItem>
              ) : null}
              {showRestoreAction ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem disabled={menuBusy} onSelect={openRenameDialog}>
                <Pencil aria-hidden="true" />
                会话设置
              </DropdownMenuItem>
            </>
          )}
          {menuError === undefined ? null : (
            <p
              role="alert"
              className="mt-1 max-w-64 border-t border-border px-2 pt-2 pb-1 text-xs leading-relaxed text-danger"
            >
              {menuError}
            </p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {organizationDialog === 'settings' ? (
        <ConversationSettingsDialog
          conversation={conversation}
          open
          returnFocus={() => triggerRef.current}
          onOpenChange={(open) =>
            setOrganizationDialog(open ? 'settings' : null)
          }
          onRenamed={onRenamed}
          onArchived={onArchived}
          onUnarchived={onUnarchived}
        />
      ) : null}
      {organizationDialog === 'archive' ? (
        <ArchiveConversationDialog
          conversation={conversation}
          open
          returnFocus={() => archiveTriggerRef.current ?? triggerRef.current}
          onOpenChange={(open) =>
            setOrganizationDialog(open ? 'archive' : null)
          }
          onArchived={onArchived}
        />
      ) : null}
    </>
  )
}

interface ConversationRestoreButtonProps extends Omit<
  ComponentPropsWithoutRef<typeof Button>,
  'onClick'
> {
  conversation: OrganizationConversation
  onRestoreError?: (message: string | undefined) => void
  onRestored?: (conversation: ConversationSummary) => void
  showInlineError?: boolean
}

export function ConversationRestoreButton({
  className,
  conversation,
  onRestoreError,
  onRestored,
  showInlineError = true,
  ...buttonProps
}: ConversationRestoreButtonProps) {
  const runtime = useHostRuntime()
  const mutation = useMutation({
    mutationFn: async () =>
      await runtime.unarchiveConversation(conversation.conversationId),
    onMutate: () => onRestoreError?.(undefined),
    onSuccess: (response) => {
      const updated = response.data.conversation
      onRestoreError?.(undefined)
      onRestored?.(updated)
    },
    onError: (error) =>
      onRestoreError?.(
        conversationOrganizationErrorMessage(error, 'unarchive'),
      ),
  })

  return (
    <div className="min-w-0">
      <Button
        {...buttonProps}
        className={cn(className)}
        disabled={buttonProps.disabled || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        <ArchiveRestore aria-hidden="true" />
        {mutation.isPending ? '正在恢复…' : '恢复会话'}
      </Button>
      {showInlineError && mutation.isError ? (
        <p className="mt-1.5 text-sm text-danger" role="alert">
          {conversationOrganizationErrorMessage(mutation.error, 'unarchive')}
        </p>
      ) : null}
    </div>
  )
}

interface ConversationSettingsDialogProps {
  conversation: OrganizationConversation
  onOpenChange: (open: boolean) => void
  onRenamed?: (conversation: ConversationSummary) => void
  onArchived?: (conversation: ConversationSummary) => void
  onUnarchived?: (conversation: ConversationSummary) => void
  open: boolean
  returnFocus: () => HTMLButtonElement | null
}

function ConversationSettingsDialog({
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

interface ArchiveConversationDialogProps {
  conversation: OrganizationConversation
  onArchived?: (conversation: ConversationSummary) => void
  onOpenChange: (open: boolean) => void
  open: boolean
  returnFocus: () => HTMLButtonElement | null
}

function ArchiveConversationDialog({
  conversation,
  onArchived,
  onOpenChange,
  open,
  returnFocus,
}: ArchiveConversationDialogProps) {
  const runtime = useHostRuntime()
  const archivedRef = useRef(false)
  const mutation = useMutation({
    mutationFn: async () =>
      await runtime.archiveConversation(conversation.conversationId),
    onSuccess: (response) => {
      const updated = response.data.conversation
      archivedRef.current = true
      onOpenChange(false)
      onArchived?.(updated)
    },
  })

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && mutation.isPending) return
    if (nextOpen) mutation.reset()
    onOpenChange(nextOpen)
    if (!nextOpen && !archivedRef.current) {
      restoreTriggerFocus(returnFocus())
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        closeLabel="关闭归档会话确认"
        className="max-w-md"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (!archivedRef.current) restoreTriggerFocus(returnFocus())
        }}
      >
        <DialogHeader>
          <span
            aria-hidden="true"
            className="grid size-10 place-items-center rounded-md border border-border-strong bg-surface-muted text-text-secondary"
          >
            <Archive className="size-5" />
          </span>
          <DialogTitle>归档会话</DialogTitle>
          <DialogDescription className="break-words">
            归档“{conversation.title}”后，该会话不会出现在活跃会话列表中。
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-sm border border-border bg-surface-muted/60 px-3 py-3 text-sm text-text-secondary">
          历史记录仍会保留，你可以随时恢复。这不是删除操作。
        </div>

        {mutation.isError ? (
          <p
            role="alert"
            className="rounded-sm border border-danger/30 bg-danger-muted px-3 py-2 text-sm text-danger"
          >
            {conversationOrganizationErrorMessage(mutation.error, 'archive')}
          </p>
        ) : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button size="sm" variant="secondary" disabled={mutation.isPending}>
              取消
            </Button>
          </DialogClose>
          <Button
            size="sm"
            variant="secondary"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? '正在归档…' : '归档'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function conversationArchiveBlockedReason(
  conversation: Pick<ConversationSummary, 'status'>,
): string | undefined {
  if (conversation.status === 'running') {
    return '运行中的会话暂时不能归档。'
  }
  if (conversation.status === 'waiting') {
    return '当前会话仍在等待你的确认。'
  }
  return undefined
}

function restoreTriggerFocus(target: HTMLButtonElement | null) {
  requestAnimationFrame(() => {
    if (target?.isConnected) target.focus()
  })
}

export type {
  ConversationOrganizationMenuProps,
  ConversationRestoreButtonProps,
  ConversationOrganizationOperation,
}

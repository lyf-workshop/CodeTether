import {
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactElement,
} from 'react'
import { useMutation } from '@tanstack/react-query'
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
  Input,
  cn,
} from '@codetether/ui'
import type { ConversationSummary } from '@codetether/protocol'

import {
  conversationOrganizationErrorMessage,
  type ConversationOrganizationOperation,
} from '../../runtime/host/conversation-organization-actions'
import { useHostRuntime } from '../../runtime/host/host-runtime-hooks'

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
  trigger?: ReactElement
}

export function ConversationOrganizationMenu({
  align = 'end',
  conversation,
  onArchived,
  onRenamed,
  onUnarchived,
  showRestoreAction = true,
  trigger,
}: ConversationOrganizationMenuProps) {
  const runtime = useHostRuntime()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogOpeningRef = useRef(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuError, setMenuError] = useState<string>()
  const [renameOpen, setRenameOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)

  const pinMutation = useMutation({
    mutationFn: async () =>
      conversation.pinnedAt === undefined
        ? await runtime.pinConversation(conversation.conversationId)
        : await runtime.unpinConversation(conversation.conversationId),
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

  function openRenameDialog() {
    dialogOpeningRef.current = true
    setRenameOpen(true)
  }

  function openArchiveDialog() {
    dialogOpeningRef.current = true
    setArchiveOpen(true)
  }

  return (
    <>
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
                  pinMutation.mutate()
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
                重命名
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
                重命名
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

      {renameOpen ? (
        <RenameConversationDialog
          conversation={conversation}
          open
          returnFocus={() => triggerRef.current}
          onOpenChange={setRenameOpen}
          onRenamed={onRenamed}
        />
      ) : null}
      {archiveOpen ? (
        <ArchiveConversationDialog
          conversation={conversation}
          open
          returnFocus={() => triggerRef.current}
          onOpenChange={setArchiveOpen}
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

interface RenameConversationDialogProps {
  conversation: OrganizationConversation
  onOpenChange: (open: boolean) => void
  onRenamed?: (conversation: ConversationSummary) => void
  open: boolean
  returnFocus: () => HTMLButtonElement | null
}

function RenameConversationDialog({
  conversation,
  onOpenChange,
  onRenamed,
  open,
  returnFocus,
}: RenameConversationDialogProps) {
  const runtime = useHostRuntime()
  const [title, setTitle] = useState(conversation.title)
  const [localError, setLocalError] = useState<string>()
  const mutation = useMutation({
    mutationFn: async (nextTitle: string) =>
      await runtime.renameConversation(conversation.conversationId, nextTitle),
    onSuccess: (response) => {
      const updated = response.data.conversation
      onOpenChange(false)
      onRenamed?.(updated)
      restoreTriggerFocus(returnFocus())
    },
  })

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && mutation.isPending) return
    if (nextOpen) {
      setTitle(conversation.title)
      setLocalError(undefined)
      mutation.reset()
    }
    onOpenChange(nextOpen)
    if (!nextOpen) restoreTriggerFocus(returnFocus())
  }

  function submitRename() {
    if (title.trim().length === 0) {
      setLocalError('请输入会话标题。')
      return
    }
    setLocalError(undefined)
    mutation.mutate(title)
  }

  const error =
    localError ??
    (mutation.isError
      ? conversationOrganizationErrorMessage(mutation.error, 'rename')
      : undefined)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        closeLabel="关闭重命名会话"
        className="max-w-md"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          restoreTriggerFocus(returnFocus())
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
            <DialogTitle>重命名会话</DialogTitle>
            <DialogDescription>
              设置一个容易辨认的标题，历史记录与智能体上下文不会改变。
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 min-w-0">
            <label
              htmlFor={`conversation-title-${conversation.conversationId}`}
              className="text-sm font-medium text-text-primary"
            >
              会话标题
            </label>
            <Input
              autoFocus
              id={`conversation-title-${conversation.conversationId}`}
              value={title}
              aria-invalid={error === undefined ? undefined : true}
              aria-describedby={
                error === undefined
                  ? `conversation-title-count-${conversation.conversationId}`
                  : `conversation-title-error-${conversation.conversationId} conversation-title-count-${conversation.conversationId}`
              }
              className="mt-2"
              disabled={mutation.isPending}
              onChange={(event) => {
                setTitle(event.target.value)
                setLocalError(undefined)
                mutation.reset()
              }}
            />
            <p
              id={`conversation-title-count-${conversation.conversationId}`}
              className={cn(
                'mt-1 text-right text-xs tabular-nums text-text-muted',
                title.length > 240 && 'text-danger',
              )}
            >
              {title.length} / 240
            </p>
            {error === undefined ? null : (
              <p
                id={`conversation-title-error-${conversation.conversationId}`}
                role="alert"
                className="mt-2 rounded-sm border border-danger/30 bg-danger-muted px-3 py-2 text-sm text-danger"
              >
                {error}
              </p>
            )}
          </div>

          <DialogFooter className="mt-5">
            <DialogClose asChild>
              <Button
                size="sm"
                variant="secondary"
                disabled={mutation.isPending}
              >
                取消
              </Button>
            </DialogClose>
            <Button size="sm" type="submit" disabled={mutation.isPending}>
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

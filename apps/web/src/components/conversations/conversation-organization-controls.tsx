import {
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type MouseEvent,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  cn,
} from '@codetether/ui'
import type { ConversationSummary } from '@codetether/protocol'
import {
  conversationOrganizationErrorMessage,
  type ConversationOrganizationOperation,
} from '../../runtime/host/conversation-organization-actions'
import { useHostRuntime } from '../../runtime/host/host-runtime-hooks'
import { ConversationSettingsDialog } from './conversation-settings-dialog'
import { ArchiveConversationDialog } from './archive-conversation-dialog'
import {
  conversationArchiveBlockedReason,
  restoreTriggerFocus,
  type OrganizationConversation,
} from './conversation-organization-shared'

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
              className="mt-1 max-w-64 border-t border-border px-2 pt-2 pb-1 text-xs leading-relaxed text-danger-text"
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
        <p className="mt-1.5 text-sm text-danger-text" role="alert">
          {conversationOrganizationErrorMessage(mutation.error, 'unarchive')}
        </p>
      ) : null}
    </div>
  )
}

export type {
  OrganizationConversation,
  ConversationOrganizationMenuProps,
  ConversationRestoreButtonProps,
  ConversationOrganizationOperation,
}

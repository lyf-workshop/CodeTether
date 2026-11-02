import { useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Archive } from 'lucide-react'
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
import type { ConversationSummary } from '@codetether/protocol'
import { conversationOrganizationErrorMessage } from '../../runtime/host/conversation-organization-actions'
import { useHostRuntime } from '../../runtime/host/host-runtime-hooks'
import {
  restoreTriggerFocus,
  type OrganizationConversation,
} from './conversation-organization-shared'

interface ArchiveConversationDialogProps {
  conversation: OrganizationConversation
  onArchived?: (conversation: ConversationSummary) => void
  onOpenChange: (open: boolean) => void
  open: boolean
  returnFocus: () => HTMLButtonElement | null
}

export function ArchiveConversationDialog({
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
            className="rounded-sm border border-danger/30 bg-danger-muted px-3 py-2 text-sm text-danger-text"
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

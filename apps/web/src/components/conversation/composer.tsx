import {
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { LoaderCircle, Send } from 'lucide-react'

import { IconButton, Separator, Textarea } from '@codetether/ui'

import type { ConversationCapabilitiesViewModel } from './conversation-view-model'
import {
  draftAfterSubmit,
  isComposerEditableState,
  shouldSubmitComposerKey,
  type ComposerController,
} from './conversation-controls'

interface ComposerProps {
  capabilities: ConversationCapabilitiesViewModel
  controller?: ComposerController
  externalError?: string
}

const composerStateLabels = {
  idle: 'Enter 发送 · Shift + Enter 换行',
  submitting: '正在发送…',
  running: '智能体正在运行',
  waiting: '智能体正在等待审批',
  interrupted: '已中断，可以继续发送',
  unavailable: 'CodeTether 暂时无法连接',
} as const

export function Composer({
  capabilities,
  controller,
  externalError,
}: ComposerProps) {
  const statusId = useId()
  const [value, setValue] = useState('')
  const compositionActive = useRef(false)
  const submitActive = useRef(false)
  const controlState = controller?.state ?? 'idle'
  const canEdit =
    capabilities.canCompose && isComposerEditableState(controlState)
  const canSend = canEdit && value.trim().length > 0
  const isLive = controller !== undefined
  const disabledExplanation = capabilities.composerDisabled?.message

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSend || submitActive.current || controller === undefined) return

    const submittedValue = value
    submitActive.current = true
    try {
      const accepted = await controller.submit(submittedValue)
      setValue((current) => draftAfterSubmit(current, submittedValue, accepted))
    } finally {
      submitActive.current = false
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      !canSend ||
      !shouldSubmitComposerKey({
        key: event.key,
        shiftKey: event.shiftKey,
        isComposing: compositionActive.current || event.nativeEvent.isComposing,
        keyCode: event.nativeEvent.keyCode,
      })
    )
      return

    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  const feedback = controller?.error ?? externalError

  return (
    <form
      aria-label="会话输入区"
      onSubmit={handleSubmit}
      className="flex h-[var(--layout-conversation-composer-height)] min-w-0 flex-col overflow-hidden rounded-md border border-border-strong bg-surface/70 transition-[border-color,box-shadow] duration-150 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25 motion-reduce:transition-none"
    >
      <div className="flex min-h-0 flex-1 items-start gap-2 px-3 py-2">
        <label htmlFor="conversation-composer" className="sr-only">
          输入消息
        </label>
        <Textarea
          id="conversation-composer"
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => {
            compositionActive.current = true
          }}
          onCompositionEnd={() => {
            compositionActive.current = false
          }}
          rows={2}
          readOnly={!canEdit}
          aria-disabled={!canEdit || undefined}
          aria-describedby={statusId}
          placeholder="输入消息…"
          aria-keyshortcuts="Enter"
          className="min-h-12 flex-1 resize-none border-0 bg-transparent px-1 py-2.5 text-base font-regular leading-normal placeholder:text-text-secondary/80 hover:border-transparent hover:bg-transparent focus-visible:border-transparent focus-visible:ring-0"
        />
        <IconButton
          type="submit"
          label={isLive ? '发送消息' : '发送消息（演示）'}
          disabled={!canSend}
          aria-describedby={statusId}
          className="mt-2 size-[var(--avatar-size-md)]"
        >
          {controlState === 'submitting' ? (
            <LoaderCircle
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : (
            <Send aria-hidden="true" />
          )}
        </IconButton>
      </div>

      <Separator className="bg-border/65" />

      <div className="flex min-w-0 items-center px-3 py-2">
        {feedback ? (
          <span
            id={statusId}
            role="alert"
            className="ml-auto max-w-xl text-right text-xs leading-relaxed text-danger"
          >
            {feedback}
          </span>
        ) : (
          <span
            id={statusId}
            role="status"
            className="ml-auto max-w-xl text-right text-xs leading-relaxed text-text-muted"
          >
            {disabledExplanation ??
              (isLive
                ? composerStateLabels[controlState]
                : 'Enter 发送 · Shift + Enter 换行')}
          </span>
        )}
      </div>
    </form>
  )
}

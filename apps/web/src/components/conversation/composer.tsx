import {
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import {
  CirclePause,
  FolderOpen,
  LoaderCircle,
  Send,
  ShieldCheck,
  Square,
  WifiOff,
} from 'lucide-react'

import { Button, IconButton, Textarea, cn } from '@codetether/ui'

import type {
  ConversationCapabilitiesViewModel,
  ConversationProjectBoundaryViewModel,
} from './conversation-view-model'
import {
  draftAfterSubmit,
  shouldSubmitComposerKey,
  type ComposerController,
  type InterruptController,
} from './conversation-controls'
import {
  composerGatePresentation,
  type ConversationDisplayContext,
} from './conversation-gate-presentation'

interface ComposerProps {
  capabilities: ConversationCapabilitiesViewModel
  controller?: ComposerController
  interruptController?: InterruptController
  context?: ConversationDisplayContext
  providerName?: string
  archived?: boolean
  projectBoundary?: ConversationProjectBoundaryViewModel
  recoveryAction?: ReactNode
  externalError?: string
}

export function Composer({
  capabilities,
  controller,
  interruptController,
  context,
  providerName = 'AI 工具',
  archived = false,
  projectBoundary,
  recoveryAction,
  externalError,
}: ComposerProps) {
  const statusId = useId()
  const [value, setValue] = useState('')
  const compositionActive = useRef(false)
  const submitActive = useRef(false)
  const controlState = controller?.state ?? 'idle'
  const gate = composerGatePresentation({
    capabilities,
    state: controlState,
    providerName,
    machineKind: context?.machineKind,
    archived,
    projectBoundary,
  })
  const canEdit = gate === undefined
  const canSend = canEdit && value.trim().length > 0
  const feedback =
    controller?.error ?? interruptController?.error ?? externalError

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

  const GateIcon =
    gate?.kind === 'waiting'
      ? ShieldCheck
      : gate?.kind === 'unavailable'
        ? gate.navigation === 'project'
          ? FolderOpen
          : WifiOff
        : gate?.kind === 'archived'
          ? FolderOpen
          : CirclePause

  return (
    <div className="min-w-0">
      <form
        aria-label="会话输入区"
        data-composer-state={gate?.kind ?? 'ready'}
        data-state={gate?.kind ?? 'ready'}
        onSubmit={handleSubmit}
        className={cn(
          'min-w-0 overflow-hidden rounded-xl border border-border-strong bg-surface shadow-sm transition-colors focus-within:border-ring motion-reduce:transition-none',
          gate?.kind === 'running' && 'border-info/40',
          gate?.kind === 'waiting' && 'border-warning/45',
        )}
      >
        {/* Keep this editor mounted even when the gate replaces its visible UI.
            A blocked/archived state must never discard or replay the draft. */}
        <div
          hidden={gate !== undefined}
          data-composer-editor
          className="min-w-0 p-3 pl-4"
        >
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
            placeholder={`继续和 ${providerName} 对话…`}
            aria-keyshortcuts="Enter"
            className="min-h-12 w-full resize-none border-0 bg-transparent p-0 text-md leading-relaxed shadow-none placeholder:text-text-muted hover:border-transparent hover:bg-transparent focus-visible:border-transparent focus-visible:ring-0"
          />
          <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
            <span
              className="flex min-w-0 items-center gap-1.5 text-xs text-text-secondary"
              title={context?.projectPath}
            >
              <FolderOpen aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">
                {context === undefined
                  ? '当前项目'
                  : `${context.projectName} · ${context.machineName}`}
              </span>
            </span>
            <IconButton
              type="submit"
              label={controller === undefined ? '发送消息（演示）' : '发送消息'}
              disabled={!canSend}
              aria-describedby={statusId}
              className="shrink-0"
            >
              <Send aria-hidden="true" />
            </IconButton>
          </div>
        </div>

        {gate === undefined ? null : (
          <div
            role="status"
            className="flex min-h-16 min-w-0 flex-wrap items-center gap-3 p-3.5"
          >
            <span
              aria-hidden="true"
              className={cn(
                'grid size-9 shrink-0 place-items-center rounded-md bg-surface-inset text-text-secondary',
                gate.kind === 'running' && 'bg-info-muted text-info-text',
                gate.kind === 'waiting' && 'bg-warning-muted text-warning-text',
              )}
            >
              {gate.kind === 'running' || gate.kind === 'submitting' ? (
                <LoaderCircle className="size-4 motion-safe:animate-spin" />
              ) : (
                <GateIcon className="size-4" />
              )}
            </span>
            <div className="min-w-0 flex-1 basis-40">
              <p className="text-md font-semibold text-text-primary">
                {gate.title}
              </p>
              <p className="mt-0.5 break-words text-sm text-text-secondary">
                {gate.description}
              </p>
            </div>
            {gate.canInterrupt && interruptController !== undefined ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={interruptController.pending}
                onClick={() => void interruptController.execute()}
              >
                {interruptController.pending ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="motion-safe:animate-spin"
                  />
                ) : (
                  <Square aria-hidden="true" />
                )}
                {interruptController.pending ? '正在停止…' : '停止'}
              </Button>
            ) : null}
            {gate.kind === 'unavailable' || gate.kind === 'archived'
              ? recoveryAction
              : null}
          </div>
        )}
      </form>

      <p
        id={statusId}
        role={feedback ? 'alert' : 'status'}
        className={cn(
          'mt-2 text-center text-xs leading-relaxed',
          feedback ? 'text-danger-text' : 'text-text-muted',
        )}
      >
        {feedback ??
          (context?.readSearchOnly
            ? `${providerName} 在这里只读取和搜索文件，不会修改代码。`
            : gate === undefined
              ? '回车发送，Shift + 回车换行'
              : '草稿会保留，CodeTether 不会自动重发消息。')}
      </p>
    </div>
  )
}

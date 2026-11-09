import {
  useCallback,
  useEffect,
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

import {
  Button,
  IconButton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  cn,
} from '@codetether/ui'

import type {
  ConversationCapabilitiesViewModel,
  ConversationProjectBoundaryViewModel,
} from './conversation-view-model'
import {
  draftAfterSubmit,
  shouldSubmitComposerKey,
  type ComposerModelSettings,
  type ComposerController,
  type InterruptController,
  type ModelSwitchController,
} from './conversation-controls'
import {
  composerGatePresentation,
  type ConversationDisplayContext,
} from './conversation-gate-presentation'
import { conversationDrafts } from './conversation-drafts'

interface ComposerProps {
  conversationId: string
  capabilities: ConversationCapabilitiesViewModel
  controller: ComposerController
  modelSettings?: ComposerModelSettings
  modelSwitchController?: ModelSwitchController
  interruptController?: InterruptController
  context?: ConversationDisplayContext
  providerName?: string
  archived?: boolean
  projectBoundary?: ConversationProjectBoundaryViewModel
  recoveryAction?: ReactNode
  externalError?: string
}

export function Composer({
  conversationId,
  capabilities,
  controller,
  modelSettings,
  modelSwitchController,
  interruptController,
  context,
  providerName = 'AI 工具',
  archived = false,
  projectBoundary,
  recoveryAction,
  externalError,
}: ComposerProps) {
  const statusId = useId()
  const [value, setValue] = useState(() =>
    archived ? '' : conversationDrafts.read(conversationId),
  )
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const restoreFocusRef = useRef(false)
  const compositionActive = useRef(false)
  const submitActive = useRef(false)
  const controlState = controller.state
  const gate = composerGatePresentation({
    capabilities,
    state: controlState,
    providerName,
    machineKind: context?.machineKind,
    archived,
    projectBoundary,
  })
  const canEdit = gate === undefined
  const editorHidden = gate?.kind === 'archived' || gate?.kind === 'unavailable'
  const canSend =
    canEdit &&
    modelSwitchController?.pending !== true &&
    value.trim().length > 0
  const feedback =
    controller.error ??
    modelSwitchController?.error ??
    interruptController?.error ??
    externalError
  const modelCanChange =
    canEdit && !archived && modelSwitchController?.pending !== true
  const availableModels =
    modelSwitchController?.catalog === undefined
      ? (modelSettings?.availableModels ?? [])
      : (modelSwitchController.catalog.availableModels ?? [])
  const reasoningOptions =
    modelSwitchController?.catalog === undefined
      ? (modelSettings?.reasoningOptions ?? [])
      : (modelSwitchController.catalog.reasoningOptions ?? [])
  const currentModel = modelSettings?.currentModel
  const modelName =
    availableModels.find((model) => model.id === currentModel)?.name ??
    currentModel ??
    '默认模型'
  const currentReasoning = modelSettings?.currentReasoning
  const reasoningName =
    reasoningOptions.find((option) => option.id === currentReasoning)?.label ??
    currentReasoning ??
    '默认'

  const restoreSubmitFocus = useCallback(() => {
    const editor = editorRef.current
    if (
      !restoreFocusRef.current ||
      editor === null ||
      !editor.isConnected ||
      editor.readOnly ||
      editor.closest('[hidden]') !== null
    )
      return
    restoreFocusRef.current = false
    if (
      !document.hasFocus() ||
      document.querySelector('[role="dialog"]') !== null ||
      (document.activeElement !== document.body &&
        document.activeElement !== editor)
    )
      return
    editor.focus()
  }, [])

  useEffect(() => {
    const abandonFocus = (event: FocusEvent) => {
      if (event.target !== editorRef.current && event.target !== document.body)
        restoreFocusRef.current = false
    }
    const abandonWindowFocus = () => {
      restoreFocusRef.current = false
    }
    document.addEventListener('focusin', abandonFocus)
    window.addEventListener('blur', abandonWindowFocus)
    return () => {
      restoreFocusRef.current = false
      document.removeEventListener('focusin', abandonFocus)
      window.removeEventListener('blur', abandonWindowFocus)
    }
  }, [])

  useEffect(() => {
    if (canEdit) restoreSubmitFocus()
  }, [canEdit, restoreSubmitFocus])

  useEffect(() => {
    if (archived) {
      restoreFocusRef.current = false
      conversationDrafts.clear(conversationId)
    }
  }, [archived, conversationId])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSend || submitActive.current) return
    const submittedValue = value
    restoreFocusRef.current = document.activeElement === editorRef.current
    submitActive.current = true
    try {
      const accepted = await controller.submit(submittedValue)
      if (
        accepted &&
        conversationDrafts.read(conversationId) === submittedValue
      )
        conversationDrafts.clear(conversationId)
      if (!archived) {
        setValue((current) =>
          draftAfterSubmit(current, submittedValue, accepted),
        )
      }
    } finally {
      submitActive.current = false
      restoreSubmitFocus()
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
        {modelSettings === undefined ? null : (
          <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs text-text-secondary">
            <span className="shrink-0 font-medium text-text-primary">
              {providerName}
            </span>
            <span aria-hidden="true">·</span>
            {modelSettings.canSelectModel &&
            modelSwitchController !== undefined ? (
              <Select
                value={
                  availableModels.some((model) => model.id === currentModel)
                    ? currentModel
                    : undefined
                }
                onOpenChange={(open) => {
                  if (open) void modelSwitchController.refreshModels()
                }}
                onValueChange={(model) =>
                  void modelSwitchController.update({ model })
                }
                disabled={!modelCanChange}
              >
                <SelectTrigger
                  size="sm"
                  aria-label={`切换模型，当前 ${modelName}`}
                  className="h-7 w-auto max-w-52 border-0 bg-transparent px-1 text-xs shadow-none"
                >
                  <SelectValue placeholder={modelName} />
                </SelectTrigger>
                <SelectContent>
                  {availableModels.map((model) => (
                    <SelectItem
                      key={model.id}
                      value={model.id}
                      title={model.description}
                    >
                      {model.name}
                    </SelectItem>
                  ))}
                  {availableModels.length === 0 ? (
                    <div
                      role="status"
                      className="px-2 py-2 text-xs text-text-muted"
                    >
                      {modelSwitchController.loadingModels
                        ? '正在读取模型…'
                        : '暂无可用模型'}
                    </div>
                  ) : null}
                </SelectContent>
              </Select>
            ) : (
              <span className="min-w-0 truncate" title={modelName}>
                {modelName}
              </span>
            )}
            {modelSettings.canSelectReasoning &&
            modelSwitchController !== undefined ? (
              <Select
                value={
                  reasoningOptions.some(
                    (option) => option.id === currentReasoning,
                  )
                    ? currentReasoning
                    : undefined
                }
                onValueChange={(reasoning) =>
                  void modelSwitchController.update({ reasoning })
                }
                disabled={!modelCanChange}
              >
                <SelectTrigger
                  size="sm"
                  aria-label={`调整推理强度，当前 ${reasoningName}`}
                  className="ml-auto h-7 w-auto max-w-36 border-0 bg-transparent px-1 text-xs shadow-none"
                >
                  <SelectValue placeholder={`推理：${reasoningName}`} />
                </SelectTrigger>
                <SelectContent>
                  {reasoningOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : currentReasoning === undefined ? null : (
              <span className="ml-auto truncate">推理：{reasoningName}</span>
            )}
          </div>
        )}
        {/* Submission and active work keep the same focused, read-only editor.
            Only archived/unavailable gates replace the visible input. */}
        <div
          hidden={editorHidden}
          data-composer-editor
          className="min-w-0 p-3 pl-4"
        >
          <label htmlFor="conversation-composer" className="sr-only">
            输入消息
          </label>
          <Textarea
            ref={editorRef}
            id="conversation-composer"
            value={value}
            onChange={(event) => {
              if (!canEdit || submitActive.current) return
              const next = event.currentTarget.value
              conversationDrafts.write(conversationId, next)
              setValue(next)
            }}
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
              label="发送消息"
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

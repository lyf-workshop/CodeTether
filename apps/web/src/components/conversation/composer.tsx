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
  FolderOpen,
  LoaderCircle,
  Mic,
  Paperclip,
  Send,
  Square,
  WifiOff,
} from 'lucide-react'

import {
  AgentBadge,
  type AgentId,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  cn,
} from '@codetether/ui'

import type {
  ConversationApprovalViewModel,
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
import {
  conversationModelFallbackNotices,
  type ConversationModelFallbackNotice,
} from './conversation-model-fallback-notices'
import {
  COMPOSER_SEND_SHORTCUT_EVENT,
  COMPOSER_SEND_SHORTCUT_KEY,
  readComposerSendShortcut,
} from './composer-shortcut'

interface ComposerProps {
  formId?: string
  conversationId: string
  capabilities: ConversationCapabilitiesViewModel
  controller: ComposerController
  modelSettings?: ComposerModelSettings
  modelSwitchController?: ModelSwitchController
  interruptController?: InterruptController
  context?: ConversationDisplayContext
  providerName?: string
  approvalKind?: ConversationApprovalViewModel['kind']
  agent?: AgentId
  modelControlRequest?: number
  model?: string
  previousUserInput?: string
  hasStartedTurn?: boolean
  archived?: boolean
  projectBoundary?: ConversationProjectBoundaryViewModel
  recoveryAction?: ReactNode
  externalError?: string
}

export function Composer({
  formId,
  conversationId,
  capabilities,
  controller,
  modelSettings = {
    availableModels: [],
    reasoningOptions: [],
    canSelectModel: false,
    canSelectReasoning: false,
  },
  modelSwitchController,
  interruptController,
  context,
  providerName = 'AI 工具',
  approvalKind,
  agent,
  model,
  modelControlRequest = 0,
  previousUserInput,
  hasStartedTurn = false,
  archived = false,
  projectBoundary,
  recoveryAction,
  externalError,
}: ComposerProps) {
  const statusId = useId()
  const [value, setValue] = useState(() =>
    archived ? '' : conversationDrafts.read(conversationId),
  )
  const [acceptedActionId, setAcceptedActionId] = useState<string>()
  const [sendShortcut, setSendShortcut] = useState(readComposerSendShortcut)
  const [modelFallback, setModelFallback] = useState<{
    conversationId: string
    notice: ConversationModelFallbackNotice
  }>()
  const fallbackHandledConversationIdRef = useRef<string | undefined>(undefined)
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
    approvalKind,
  })
  const canEdit =
    controlState !== 'submitting' &&
    (gate === undefined || gate.kind === 'running' || gate.kind === 'waiting')
  const optimisticSend = controller.optimisticSend
  // The Composer can reopen while its earlier submit handler is still pending.
  if (
    optimisticSend?.state === 'accepted' &&
    optimisticSend.actionId !== acceptedActionId
  ) {
    setAcceptedActionId(optimisticSend.actionId)
    if (value === optimisticSend.text) setValue('')
  }
  const editorValue =
    controlState === 'submitting' && optimisticSend?.text === value ? '' : value
  const editorHidden = gate?.kind === 'archived' || gate?.kind === 'unavailable'
  const feedback =
    controller.error ??
    modelSwitchController?.error ??
    interruptController?.error ??
    externalError
  const modelCanChange =
    canEdit && gate === undefined && modelSwitchController?.pending !== true
  const availableModels =
    modelSwitchController?.catalog === undefined
      ? (modelSettings?.availableModels ?? [])
      : (modelSwitchController.catalog.availableModels ?? [])
  const reasoningOptions =
    modelSwitchController?.catalog === undefined
      ? (modelSettings?.reasoningOptions ?? [])
      : (modelSwitchController.catalog.reasoningOptions ?? [])
  const [modelOpen, setModelOpen] = useState(false)
  const modelTriggerRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (modelControlRequest > 0) {
      modelTriggerRef.current?.focus()
      modelTriggerRef.current?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      )
    }
  }, [modelControlRequest])
  const catalog = modelSwitchController?.catalog
  const currentModel = modelSettings?.currentModel ?? model
  const modelMissing =
    catalog?.availableModels !== undefined &&
    currentModel !== undefined &&
    !catalog.availableModels.some((item) => item.id === currentModel)
  const canSend =
    canEdit &&
    gate === undefined &&
    !modelMissing &&
    modelSwitchController?.pending !== true &&
    value.trim().length > 0 &&
    !(optimisticSend?.state === 'uncertain' && optimisticSend.text === value)
  useEffect(() => {
    if (fallbackHandledConversationIdRef.current === conversationId) return
    fallbackHandledConversationIdRef.current = conversationId
    const notice = conversationModelFallbackNotices.take(conversationId)
    setModelFallback(
      notice === undefined ? undefined : { conversationId, notice },
    )
  }, [conversationId])
  const visibleModelFallback =
    !hasStartedTurn &&
    modelFallback?.conversationId === conversationId &&
    modelFallback.notice.selectedModel === currentModel
      ? modelFallback.notice
      : undefined
  const modelName =
    availableModels.find((model) => model.id === currentModel)?.name ??
    currentModel ??
    '默认模型'
  const currentReasoning = modelSettings?.currentReasoning
  const reasoningName =
    reasoningOptions.find((option) => option.id === currentReasoning)?.label ??
    currentReasoning ??
    '默认'
  const basePlaceholder =
    agent === 'codex'
      ? '告诉 Codex 要做什么…'
      : agent === 'claude'
        ? '问 Claude 一个问题…'
        : '输入消息…'
  const placeholder = context?.readSearchOnly
    ? `${basePlaceholder.slice(0, -1)}（只读取和搜索文件）…`
    : basePlaceholder
  const keyboardHint =
    sendShortcut === 'enter'
      ? '回车发送，Shift + 回车换行'
      : 'Ctrl + 回车发送，回车换行'
  const sendUnavailableReason =
    gate?.description ??
    (controlState === 'submitting'
      ? '正在发送消息'
      : modelMissing
        ? '请先从模型菜单选择可用模型，再发送消息'
        : modelSwitchController?.pending
          ? '正在更新模型设置'
          : value.trim().length === 0
            ? '输入消息后即可发送'
            : undefined)

  useEffect(() => {
    const syncShortcut = () => setSendShortcut(readComposerSendShortcut())
    const onStorage = (event: StorageEvent) => {
      if (event.key === COMPOSER_SEND_SHORTCUT_KEY) syncShortcut()
    }
    window.addEventListener(COMPOSER_SEND_SHORTCUT_EVENT, syncShortcut)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(COMPOSER_SEND_SHORTCUT_EVENT, syncShortcut)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

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
    if (submitActive.current) return
    const retryAction =
      (event.nativeEvent as SubmitEvent).submitter?.getAttribute(
        'data-retry-action',
      ) ?? undefined
    const retry =
      retryAction !== undefined &&
      optimisticSend?.state === 'failed' &&
      optimisticSend.canRetry &&
      optimisticSend.actionId === retryAction
        ? optimisticSend
        : undefined
    if (
      retryAction === undefined
        ? !canSend
        : retry === undefined ||
          !canEdit ||
          modelMissing ||
          modelSwitchController?.pending === true
    )
      return
    const submittedValue = retry?.text ?? value
    if (retry !== undefined && value === '') {
      conversationDrafts.write(conversationId, submittedValue)
      setValue(submittedValue)
    }
    restoreFocusRef.current = document.activeElement === editorRef.current
    submitActive.current = true
    try {
      const accepted = await controller.submit(submittedValue, retry?.actionId)
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
    if (!canEdit || compositionActive.current || event.nativeEvent.isComposing)
      return
    if (event.key === 'Escape' && value !== '') {
      event.preventDefault()
      conversationDrafts.clear(conversationId)
      setValue('')
      return
    }
    if (
      event.key === 'ArrowUp' &&
      event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      previousUserInput !== undefined
    ) {
      event.preventDefault()
      conversationDrafts.write(conversationId, previousUserInput)
      setValue(previousUserInput)
      return
    }
    if (
      !shouldSubmitComposerKey({
        key: event.key,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        isComposing: false,
        keyCode: event.nativeEvent.keyCode,
        shortcut: sendShortcut,
      })
    )
      return
    event.preventDefault()
    if (canSend) event.currentTarget.form?.requestSubmit()
  }

  const GateIcon =
    gate?.kind === 'archived' || gate?.navigation === 'project'
      ? FolderOpen
      : WifiOff

  return (
    <div className="min-w-0">
      <form
        id={formId}
        aria-label="会话输入区"
        data-composer-state={gate?.kind ?? (canEdit ? 'ready' : 'submitting')}
        data-state={gate?.kind ?? (canEdit ? 'ready' : 'submitting')}
        onSubmit={handleSubmit}
        className={cn(
          'min-w-0 overflow-hidden rounded-xl border border-border-strong bg-surface shadow-sm transition-colors focus-within:border-ring motion-reduce:transition-none',
          gate?.kind === 'running' && 'border-info/40',
          gate?.kind === 'waiting' && 'border-warning/45',
        )}
      >
        {modelSettings === undefined ? null : (
          <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs text-text-secondary">
            <AgentBadge agent={agent ?? 'codex'} size="sm" />
            <span aria-hidden="true">·</span>
            {modelSettings.canSelectModel &&
            modelSwitchController !== undefined ? (
              <Select
                open={modelOpen}
                value={
                  availableModels.some((model) => model.id === currentModel)
                    ? currentModel
                    : ''
                }
                onOpenChange={(open) => {
                  setModelOpen(open)
                  if (open) void modelSwitchController.refreshModels()
                }}
                onValueChange={(model) => {
                  if (model === '' || model === currentModel) return
                  setModelFallback(undefined)
                  void modelSwitchController.update({ model })
                }}
                disabled={!modelCanChange}
              >
                <SelectTrigger
                  size="sm"
                  ref={modelTriggerRef}
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
                    : ''
                }
                onValueChange={(reasoning) => {
                  if (reasoning === '' || reasoning === currentReasoning) return
                  void modelSwitchController.update({ reasoning })
                }}
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
        {visibleModelFallback ? (
          <p
            role="status"
            data-model-fallback-notice
            className="break-words px-4 py-2 text-xs text-text-secondary"
          >
            Codex 配置的默认模型 {visibleModelFallback.configuredModel}{' '}
            当前不在模型列表中，CodeTether 已选择可用模型 {modelName}
            。可在上方菜单切换模型。
          </p>
        ) : null}
        {modelMissing ? (
          <p role="status" className="px-4 py-2 text-xs text-warning-text">
            {currentModel} 不在此账号的可用模型中。请先从模型菜单选择可用模型。
          </p>
        ) : null}
        {/* Only archived and unavailable gates replace the visible input. */}
        <div hidden={editorHidden} data-composer-editor className="min-w-0">
          <label htmlFor="conversation-composer" className="sr-only">
            输入消息
          </label>
          <Textarea
            ref={editorRef}
            id="conversation-composer"
            value={editorValue}
            onChange={(event) => {
              if (!canEdit) return
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
            placeholder={placeholder}
            aria-keyshortcuts={
              sendShortcut === 'enter' ? 'Enter' : 'Control+Enter'
            }
            className="ct-composer-textarea block w-full border-0 bg-transparent px-4 pt-3 pb-2 text-md leading-relaxed shadow-none placeholder:text-text-muted hover:border-transparent hover:bg-transparent focus-visible:border-transparent focus-visible:ring-0"
          />
          <div className="flex min-h-10 min-w-0 items-center gap-2 border-t border-border px-2 py-1">
            <span className="flex min-w-0 items-center gap-0.5">
              <span title="即将推出">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled
                  aria-label="附件即将推出"
                  className="pointer-events-none px-2"
                >
                  <Paperclip aria-hidden="true" />
                  <span className="hidden sm:inline">附件</span>
                </Button>
              </span>
              <span title="即将推出">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled
                  aria-label="语音即将推出"
                  className="pointer-events-none px-2"
                >
                  <Mic aria-hidden="true" />
                  <span className="hidden sm:inline">语音</span>
                </Button>
              </span>
            </span>
            <span
              className="flex min-w-0 flex-1 items-center justify-center gap-1.5 text-center text-xs text-text-muted"
              role={
                gate?.kind === 'running' || gate?.kind === 'waiting'
                  ? 'status'
                  : undefined
              }
            >
              {gate?.kind === 'running' ? (
                <>
                  <LoaderCircle
                    aria-hidden="true"
                    className="size-3.5 shrink-0 motion-safe:animate-spin"
                  />
                  <span className="block min-w-0 truncate">{gate.title}</span>
                </>
              ) : gate?.kind === 'waiting' ? (
                <span className="block min-w-0 truncate">等你批准</span>
              ) : (
                <>字数 {editorValue.length}</>
              )}
            </span>
            <span
              title={
                gate?.canInterrupt && interruptController !== undefined
                  ? undefined
                  : sendUnavailableReason
              }
              className="shrink-0"
            >
              {gate?.canInterrupt &&
              interruptController !== undefined &&
              (gate.kind === 'running' || gate.kind === 'waiting') ? (
                <Button
                  type="button"
                  size="sm"
                  className="w-20 justify-center"
                  aria-label={
                    interruptController.pending ? '正在停止' : '停止这一轮'
                  }
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
                  停止
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="sm"
                  className="w-20 justify-center"
                  aria-label="发送消息"
                  disabled={!canSend}
                  aria-describedby={statusId}
                >
                  <Send aria-hidden="true" />
                  发送
                </Button>
              )}
            </span>
          </div>
        </div>

        {gate?.kind === 'archived' || gate?.kind === 'unavailable' ? (
          <div
            role="status"
            className="flex min-h-16 min-w-0 flex-wrap items-center gap-3 p-3.5"
          >
            <span
              aria-hidden="true"
              className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-inset text-text-secondary"
            >
              <GateIcon className="size-4" />
            </span>
            <div className="min-w-0 flex-1 basis-40">
              <p className="text-md font-semibold text-text-primary">
                {gate.title}
              </p>
              <p className="mt-0.5 break-words text-sm text-text-secondary">
                {gate.description}
              </p>
            </div>
            {gate.kind === 'unavailable' &&
            gate.canInterrupt &&
            interruptController !== undefined ? (
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
            {recoveryAction}
          </div>
        ) : null}
      </form>

      <p
        id={statusId}
        role={feedback ? 'alert' : 'status'}
        className={cn(
          'mt-1 truncate text-center text-xs leading-relaxed',
          feedback ? 'text-danger-text' : 'text-text-muted',
        )}
        title={feedback}
      >
        {feedback ??
          (gate?.kind === 'running'
            ? `这一轮结束后：${keyboardHint}`
            : gate?.kind === 'waiting'
              ? `批准后：${keyboardHint}`
              : canEdit || controlState === 'submitting'
                ? keyboardHint
                : '草稿会保留，CodeTether 不会自动重发消息。')}
      </p>
    </div>
  )
}

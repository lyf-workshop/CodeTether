import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query'

import type {
  ActionId,
  ApprovalDecision,
  ProviderDescriptor,
} from '@codetether/protocol'

import type { ConversationReadModel } from '../../runtime/host/conversation-projection.js'
import { canStartNewTurnAfterFailure } from '../../failures/failure-presentation.js'
import {
  useHostConnectionState,
  useHostRuntime,
} from '../../runtime/host/host-runtime-hooks.js'
import { mutationErrorMessage } from '../../runtime/host/live-conversation-actions.js'
import type {
  ApprovalControlState,
  ComposerSubmitPhase,
  ConversationControls,
} from './conversation-controls.js'
import { deriveComposerControlState } from './conversation-controls.js'
import type { ConversationCapabilitiesViewModel } from './conversation-view-model.js'
import {
  findOptimisticTurn,
  rejectOptimisticSend,
  type OptimisticSend,
} from './optimistic-send.js'

export function useLiveConversationControls(
  model: ConversationReadModel,
  capabilities: ConversationCapabilitiesViewModel,
  machineKind: 'local' | 'remote' | undefined,
): ConversationControls {
  const archived = model.archivedAt !== undefined
  const runtime = useHostRuntime()
  const connectionState = useHostConnectionState()
  const queryClient = useQueryClient()
  const sendKey = useMemo(
    () => ['host', 'optimistic-send', model.id],
    [model.id],
  )
  const { data: send } = useQuery<OptimisticSend | null>({
    queryKey: sendKey,
    queryFn: skipToken,
  })
  const projectedTurnId = useMemo(
    () => (send == null ? undefined : findOptimisticTurn(send, model)),
    [model, send],
  )
  const [retryPhase, setRetryPhase] = useState<ComposerSubmitPhase>('idle')
  const [submitError, setSubmitError] = useState<string>()
  const [modelSwitchPending, setModelSwitchPending] = useState(false)
  const [modelSwitchError, setModelSwitchError] = useState<string>()
  const modelSwitchGuard = useRef(false)
  const [modelCatalog, setModelCatalog] = useState<{
    readonly conversationId: string
    readonly provider: ProviderDescriptor
  }>()
  const [modelCatalogLoading, setModelCatalogLoading] = useState<string>()
  const [queuedExplicitCatalogRead, setQueuedExplicitCatalogRead] =
    useState<string>()
  const modelCatalogGuard = useRef<
    | {
        readonly conversationId: string
        readonly showError: boolean
        explicitQueued: boolean
      }
    | undefined
  >(undefined)
  const automaticModelCatalog = useRef({
    conversationId: model.id,
    started: false,
  })
  const expectedTurnId = useRef<string | undefined>(undefined)
  const submitGuard = useRef(false)
  const retryGuard = useRef(false)
  const [retryingTurnId, setRetryingTurnId] = useState<string>()
  const [retryErrorTurnId, setRetryErrorTurnId] = useState<string>()
  const [retryError, setRetryError] = useState<string>()
  const [interruptingTurnId, setInterruptingTurnId] = useState<string>()
  const [interruptError, setInterruptError] = useState<string>()
  const interruptGuard = useRef(false)
  const [approvalStates, setApprovalStates] = useState<
    Readonly<Record<string, ApprovalControlState>>
  >({})
  const approvalGuards = useRef(new Set<string>())
  const submitPhase: ComposerSubmitPhase =
    send?.state === 'sending'
      ? 'submitting'
      : send?.state === 'accepted'
        ? 'awaiting-event'
        : retryPhase

  useEffect(() => {
    if (send?.state === 'accepted' && projectedTurnId !== undefined) {
      queryClient.setQueryData<OptimisticSend | null>(sendKey, (current) =>
        current?.actionId === send.actionId ? null : current,
      )
    }
  }, [projectedTurnId, queryClient, send, sendKey])

  useEffect(() => {
    const expected = expectedTurnId.current
    if (
      expected !== undefined &&
      model.turns.some((turn) => turn.id === expected)
    ) {
      expectedTurnId.current = undefined
      setRetryPhase('idle')
      setRetryingTurnId(undefined)
    }
  }, [model.turns])

  useEffect(() => {
    if (interruptingTurnId === undefined) return
    const turn = model.turns.find(
      (candidate) => candidate.id === interruptingTurnId,
    )
    if (turn === undefined || turn.status === 'running') return
    interruptGuard.current = false
    setInterruptingTurnId(undefined)
  }, [interruptingTurnId, model.turns])

  useEffect(() => {
    const pendingIds = new Set(
      model.pendingApprovals.map((approval) => approval.id),
    )
    for (const approvalId of approvalGuards.current) {
      if (!pendingIds.has(approvalId)) approvalGuards.current.delete(approvalId)
    }
    setApprovalStates((current) => {
      const retained = Object.fromEntries(
        Object.entries(current).filter(([approvalId]) =>
          pendingIds.has(approvalId),
        ),
      )
      return Object.keys(retained).length === Object.keys(current).length
        ? current
        : retained
    })
  }, [model.pendingApprovals])

  const submit = useCallback(
    async (text: string, retryActionId?: ActionId): Promise<boolean> => {
      const current = queryClient.getQueryData<OptimisticSend | null>(sendKey)
      if (
        submitGuard.current ||
        modelSwitchGuard.current ||
        retryGuard.current ||
        submitPhase !== 'idle' ||
        !capabilities.canCompose ||
        current?.state === 'sending' ||
        current?.state === 'accepted' ||
        (current?.state === 'uncertain' && current.text === text) ||
        (retryActionId !== undefined &&
          (current?.state !== 'failed' ||
            !current.canRetry ||
            current.actionId !== retryActionId ||
            current.text !== text))
      ) {
        return false
      }

      submitGuard.current = true
      setSubmitError(undefined)
      let attempt: OptimisticSend | undefined
      try {
        const onActionId = (actionId: ActionId) => {
          attempt = {
            state: 'sending',
            actionId,
            text,
            timestamp: new Date().toISOString(),
            previousTurnIds: new Set(model.turns.map((turn) => turn.id)),
          }
          queryClient.setQueryData<OptimisticSend>(sendKey, attempt)
        }
        const response =
          retryActionId === undefined
            ? await runtime.startTurn(model.id, text, onActionId)
            : await runtime.startNewTurn(model.id, text, onActionId)
        if (attempt !== undefined) {
          const accepted: OptimisticSend = {
            ...attempt,
            state: 'accepted',
            turnId: String(response.data.turn.turnId),
          }
          queryClient.setQueryData<OptimisticSend | null>(sendKey, (entry) =>
            entry?.actionId === accepted.actionId ? accepted : entry,
          )
        }
        return true
      } catch (error) {
        if (attempt === undefined) {
          setSubmitError(mutationErrorMessage(error, '发送消息'))
        } else {
          const failure = rejectOptimisticSend(attempt, error)
          queryClient.setQueryData<OptimisticSend | null>(sendKey, (entry) =>
            entry?.actionId === failure.actionId ? failure : entry,
          )
        }
        return false
      } finally {
        submitGuard.current = false
      }
    },
    [
      capabilities.canCompose,
      model.id,
      model.turns,
      queryClient,
      runtime,
      sendKey,
      submitPhase,
    ],
  )

  const retryFailedTurn = useCallback(
    async (turnId: string): Promise<void> => {
      const turn = model.turns.find((candidate) => candidate.id === turnId)
      const input = model.messages.find(
        (message) => message.turnId === turnId && message.author === 'user',
      )?.body
      if (
        submitGuard.current ||
        modelSwitchGuard.current ||
        retryGuard.current ||
        submitPhase !== 'idle' ||
        !capabilities.canCompose ||
        turn?.status !== 'failed' ||
        model.currentTurn?.id !== turnId ||
        !canStartNewTurnAfterFailure(turn.error?.failure) ||
        input === undefined
      ) {
        return
      }

      retryGuard.current = true
      setRetryingTurnId(turnId)
      setRetryErrorTurnId(undefined)
      setRetryError(undefined)
      setSubmitError(undefined)
      setRetryPhase('submitting')
      try {
        const response = await runtime.startNewTurn(model.id, input)
        const newTurnId = String(response.data.turn.turnId)
        expectedTurnId.current = newTurnId
        const projected = runtime.projection?.conversations[model.id]
        if (projected?.turns.some((candidate) => candidate.id === newTurnId)) {
          expectedTurnId.current = undefined
          setRetryPhase('idle')
          setRetryingTurnId(undefined)
        } else {
          setRetryPhase('awaiting-event')
        }
      } catch (error) {
        expectedTurnId.current = undefined
        setRetryPhase('idle')
        setRetryingTurnId(undefined)
        setRetryErrorTurnId(turnId)
        setRetryError(mutationErrorMessage(error, '开始新的重试轮次'))
      } finally {
        retryGuard.current = false
      }
    },
    [
      capabilities.canCompose,
      model.id,
      model.currentTurn?.id,
      model.messages,
      model.turns,
      runtime,
      submitPhase,
    ],
  )

  const interrupt = useCallback(async (): Promise<void> => {
    const turn = model.currentTurn
    if (
      interruptGuard.current ||
      interruptingTurnId !== undefined ||
      !capabilities.canInterrupt ||
      turn?.status !== 'running'
    ) {
      return
    }

    interruptGuard.current = true
    setInterruptError(undefined)
    setInterruptingTurnId(turn.id)
    try {
      await runtime.interruptTurn(model.id, turn.id)
      // The Host event, not HTTP 202, owns the terminal Turn state.
    } catch (error) {
      interruptGuard.current = false
      setInterruptingTurnId(undefined)
      setInterruptError(mutationErrorMessage(error, '中断当前执行'))
    }
  }, [
    capabilities.canInterrupt,
    interruptingTurnId,
    model.currentTurn,
    model.id,
    runtime,
  ])

  const updateModel = useCallback(
    async (selection: {
      readonly model?: string
      readonly reasoning?: string
    }) => {
      if (
        modelSwitchGuard.current ||
        submitGuard.current ||
        retryGuard.current ||
        submitPhase !== 'idle' ||
        !capabilities.canCompose ||
        (selection.model === undefined && selection.reasoning === undefined)
      ) {
        return
      }
      modelSwitchGuard.current = true
      setModelSwitchPending(true)
      setModelSwitchError(undefined)
      try {
        await runtime.updateConversationModel(model.id, selection)
        if (selection.model !== undefined) {
          setSubmitError(undefined)
          queryClient.setQueryData<OptimisticSend | null>(sendKey, (current) =>
            current?.state === 'failed' ? null : current,
          )
        }
      } catch (error) {
        setModelSwitchError(mutationErrorMessage(error, '更新模型设置'))
      } finally {
        modelSwitchGuard.current = false
        setModelSwitchPending(false)
      }
    },
    [
      capabilities.canCompose,
      model.id,
      queryClient,
      runtime,
      sendKey,
      submitPhase,
    ],
  )

  const readModels = useCallback(
    async (showError: boolean) => {
      if (archived || !capabilities.canCompose) return
      if (modelCatalogGuard.current?.conversationId === model.id) {
        // An explicit menu open gets its own fresh result after the quiet
        // automatic read settles, without racing two catalog requests.
        if (showError && !modelCatalogGuard.current.showError)
          modelCatalogGuard.current.explicitQueued = true
        return
      }
      const request = {
        conversationId: model.id,
        showError,
        explicitQueued: false,
      }
      modelCatalogGuard.current = request
      setModelCatalogLoading(model.id)
      setModelSwitchError(undefined)
      try {
        const response = await runtime.refreshConversationModels(model.id)
        if (modelCatalogGuard.current !== request) return
        if (response.provider.provider !== model.provider) {
          setModelCatalog(undefined)
          if (request.showError)
            setModelSwitchError('模型列表与当前会话不匹配，请刷新后重试。')
          return
        }
        setModelCatalog({
          conversationId: model.id,
          provider: response.provider,
        })
      } catch (error) {
        if (modelCatalogGuard.current !== request) return
        setModelCatalog(undefined)
        if (request.showError)
          setModelSwitchError(mutationErrorMessage(error, '读取模型列表'))
      } finally {
        if (modelCatalogGuard.current === request) {
          modelCatalogGuard.current = undefined
          setModelCatalogLoading(undefined)
          if (request.explicitQueued) setQueuedExplicitCatalogRead(model.id)
        }
      }
    },
    [archived, capabilities.canCompose, model.id, model.provider, runtime],
  )

  const refreshModels = useCallback(() => readModels(true), [readModels])

  useEffect(() => {
    if (queuedExplicitCatalogRead === undefined) return
    setQueuedExplicitCatalogRead(undefined)
    if (
      queuedExplicitCatalogRead === model.id &&
      !archived &&
      capabilities.canCompose
    )
      void readModels(true)
  }, [
    archived,
    capabilities.canCompose,
    model.id,
    queuedExplicitCatalogRead,
    readModels,
  ])

  useEffect(() => {
    if (automaticModelCatalog.current.conversationId !== model.id || archived) {
      modelCatalogGuard.current = undefined
      automaticModelCatalog.current = {
        conversationId: model.id,
        started: false,
      }
    }
    if (archived) {
      setModelCatalog(undefined)
      setModelCatalogLoading(undefined)
      setModelSwitchError(undefined)
      return
    }
    if (
      machineKind !== 'local' ||
      !capabilities.canCompose ||
      automaticModelCatalog.current.started
    )
      return
    automaticModelCatalog.current.started = true
    void readModels(false)
  }, [archived, capabilities.canCompose, machineKind, model.id, readModels])

  const resolveApproval = useCallback(
    async (approvalId: string, decision: ApprovalDecision): Promise<void> => {
      if (
        approvalGuards.current.has(approvalId) ||
        !capabilities.canResolveApproval ||
        !model.pendingApprovals.some((approval) => approval.id === approvalId)
      ) {
        return
      }

      approvalGuards.current.add(approvalId)
      setApprovalStates((current) => ({
        ...current,
        [approvalId]: { state: 'submitting', decision },
      }))
      try {
        await runtime.resolveApproval(approvalId, decision)
        // Keep the card pending until approval.resolved removes it.
      } catch (error) {
        approvalGuards.current.delete(approvalId)
        setApprovalStates((current) => ({
          ...current,
          [approvalId]: {
            state: 'pending',
            error: mutationErrorMessage(error, '处理批准请求'),
          },
        }))
      }
    },
    [capabilities.canResolveApproval, model.pendingApprovals, runtime],
  )

  const composerState = useMemo(
    () =>
      deriveComposerControlState(
        connectionState,
        submitPhase,
        model.currentTurn?.status,
        model.pendingApprovals.length,
      ),
    [
      connectionState,
      model.currentTurn?.status,
      model.pendingApprovals.length,
      submitPhase,
    ],
  )
  const composerError =
    submitError ??
    (send?.state === 'failed' || send?.state === 'uncertain'
      ? send.message
      : undefined)
  const optimisticSend = useMemo(
    () =>
      send == null
        ? undefined
        : {
            ...send,
            ...(projectedTurnId === undefined ? {} : { projectedTurnId }),
          },
    [projectedTurnId, send],
  )

  return useMemo(
    () => ({
      composer: {
        state: composerState,
        ...(composerError === undefined ? {} : { error: composerError }),
        ...(optimisticSend === undefined ? {} : { optimisticSend }),
        submit,
      },
      modelSwitch: {
        pending: modelSwitchPending,
        loadingModels: modelCatalogLoading === model.id,
        ...(modelCatalog?.conversationId === model.id
          ? { catalog: modelCatalog.provider }
          : {}),
        ...(modelSwitchError === undefined ? {} : { error: modelSwitchError }),
        update: updateModel,
        refreshModels,
      },
      interrupt: {
        pending: interruptingTurnId !== undefined,
        ...(interruptError === undefined ? {} : { error: interruptError }),
        execute: interrupt,
      },
      approvals: {
        enabled: capabilities.canResolveApproval,
        states: approvalStates,
        resolve: resolveApproval,
      },
      failedTurnRetry: {
        enabled:
          capabilities.canCompose &&
          submitPhase === 'idle' &&
          !modelSwitchPending,
        ...(capabilities.composerDisabled === undefined
          ? {}
          : { disabledReason: capabilities.composerDisabled.message }),
        ...(retryingTurnId === undefined
          ? {}
          : { pendingTurnId: retryingTurnId }),
        ...(retryErrorTurnId === undefined
          ? {}
          : { errorTurnId: retryErrorTurnId }),
        ...(retryError === undefined ? {} : { error: retryError }),
        execute: retryFailedTurn,
      },
    }),
    [
      approvalStates,
      capabilities.canResolveApproval,
      capabilities.canCompose,
      capabilities.composerDisabled,
      composerState,
      composerError,
      interrupt,
      interruptError,
      interruptingTurnId,
      modelSwitchError,
      modelSwitchPending,
      modelCatalog,
      model.id,
      modelCatalogLoading,
      optimisticSend,
      resolveApproval,
      retryError,
      retryErrorTurnId,
      retryFailedTurn,
      retryingTurnId,
      refreshModels,
      submit,
      submitPhase,
      updateModel,
    ],
  )
}

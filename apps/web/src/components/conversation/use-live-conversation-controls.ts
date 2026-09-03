import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ApprovalDecision } from '@codetether/protocol'

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

export function useLiveConversationControls(
  model: ConversationReadModel,
  capabilities: ConversationCapabilitiesViewModel,
): ConversationControls {
  const runtime = useHostRuntime()
  const connectionState = useHostConnectionState()
  const [submitPhase, setSubmitPhase] = useState<ComposerSubmitPhase>('idle')
  const [submitError, setSubmitError] = useState<string>()
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

  useEffect(() => {
    const expected = expectedTurnId.current
    if (
      expected !== undefined &&
      model.turns.some((turn) => turn.id === expected)
    ) {
      expectedTurnId.current = undefined
      setSubmitPhase('idle')
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
    async (text: string): Promise<boolean> => {
      if (
        submitGuard.current ||
        retryGuard.current ||
        submitPhase !== 'idle' ||
        !capabilities.canCompose
      ) {
        return false
      }

      submitGuard.current = true
      setSubmitError(undefined)
      setSubmitPhase('submitting')
      try {
        const response = await runtime.startTurn(model.id, text)
        const turnId = String(response.data.turn.turnId)
        expectedTurnId.current = turnId
        const projected = runtime.projection?.conversations[model.id]
        if (projected?.turns.some((turn) => turn.id === turnId)) {
          expectedTurnId.current = undefined
          setSubmitPhase('idle')
        } else {
          setSubmitPhase('awaiting-event')
        }
        return true
      } catch (error) {
        expectedTurnId.current = undefined
        setSubmitPhase('idle')
        setSubmitError(mutationErrorMessage(error, '发送消息'))
        return false
      } finally {
        submitGuard.current = false
      }
    },
    [capabilities.canCompose, model.id, runtime, submitPhase],
  )

  const retryFailedTurn = useCallback(
    async (turnId: string): Promise<void> => {
      const turn = model.turns.find((candidate) => candidate.id === turnId)
      const input = model.messages.find(
        (message) => message.turnId === turnId && message.author === 'user',
      )?.body
      if (
        submitGuard.current ||
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
      setSubmitPhase('submitting')
      try {
        const response = await runtime.startNewTurn(model.id, input)
        const newTurnId = String(response.data.turn.turnId)
        expectedTurnId.current = newTurnId
        const projected = runtime.projection?.conversations[model.id]
        if (projected?.turns.some((candidate) => candidate.id === newTurnId)) {
          expectedTurnId.current = undefined
          setSubmitPhase('idle')
          setRetryingTurnId(undefined)
        } else {
          setSubmitPhase('awaiting-event')
        }
      } catch (error) {
        expectedTurnId.current = undefined
        setSubmitPhase('idle')
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
            error: mutationErrorMessage(error, '处理审批'),
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

  return useMemo(
    () => ({
      composer: {
        state: composerState,
        ...(submitError === undefined ? {} : { error: submitError }),
        submit,
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
        enabled: capabilities.canCompose && submitPhase === 'idle',
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
      interrupt,
      interruptError,
      interruptingTurnId,
      resolveApproval,
      retryError,
      retryErrorTurnId,
      retryFailedTurn,
      retryingTurnId,
      submit,
      submitError,
      submitPhase,
    ],
  )
}

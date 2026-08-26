import type { ApprovalDecision, HostCapabilities } from '@codetether/protocol'

import type { HostConnectionState } from '../../runtime/host/host-runtime.js'

export type ComposerControlState =
  'idle' | 'submitting' | 'running' | 'waiting' | 'interrupted' | 'unavailable'

export interface ComposerController {
  readonly state: ComposerControlState
  readonly error?: string
  submit(text: string): Promise<boolean>
}

export interface InterruptController {
  readonly pending: boolean
  readonly error?: string
  execute(): Promise<void>
}

export interface ApprovalControlState {
  readonly state: 'pending' | 'submitting'
  readonly decision?: ApprovalDecision
  readonly error?: string
}

export interface ApprovalController {
  readonly enabled: boolean
  readonly states: Readonly<Record<string, ApprovalControlState>>
  resolve(approvalId: string, decision: ApprovalDecision): Promise<void>
}

export interface ConversationControls {
  readonly composer: ComposerController
  readonly interrupt: InterruptController
  readonly approvals: ApprovalController
}

export interface LiveControlAvailability {
  readonly canCompose: boolean
  readonly canInterrupt: boolean
  readonly canStop: false
  readonly canResolveApproval: boolean
}

export type ComposerSubmitPhase = 'idle' | 'submitting' | 'awaiting-event'

export function deriveComposerControlState(
  connectionState: HostConnectionState,
  submitPhase: ComposerSubmitPhase,
  currentTurnStatus:
    'running' | 'completed' | 'failed' | 'interrupted' | undefined,
  pendingApprovalCount: number,
): ComposerControlState {
  if (connectionState !== 'connected') return 'unavailable'
  if (submitPhase !== 'idle') return 'submitting'
  if (currentTurnStatus === 'running') {
    return pendingApprovalCount > 0 ? 'waiting' : 'running'
  }
  if (currentTurnStatus === 'interrupted') return 'interrupted'
  return 'idle'
}

export function deriveLiveControlAvailability(
  connectionState: HostConnectionState,
  capabilities: HostCapabilities | undefined,
  currentTurnStatus:
    'running' | 'completed' | 'failed' | 'interrupted' | undefined,
): LiveControlAvailability {
  const connected = connectionState === 'connected'
  const hasActiveTurn = currentTurnStatus === 'running'
  return {
    canCompose:
      connected &&
      capabilities?.codex === true &&
      capabilities.streaming &&
      !hasActiveTurn,
    canInterrupt:
      connected && capabilities?.interrupt === true && hasActiveTurn,
    canStop: false,
    canResolveApproval: connected && capabilities?.approvals === true,
  }
}

export interface ComposerKeyIntent {
  readonly key: string
  readonly shiftKey: boolean
  readonly isComposing: boolean
  readonly keyCode?: number
}

export function shouldSubmitComposerKey(intent: ComposerKeyIntent): boolean {
  return (
    intent.key === 'Enter' &&
    !intent.shiftKey &&
    !intent.isComposing &&
    intent.keyCode !== 229
  )
}

export function isComposerEditableState(state: ComposerControlState): boolean {
  return state === 'idle' || state === 'interrupted'
}

export function draftAfterSubmit(
  currentDraft: string,
  submittedDraft: string,
  accepted: boolean,
): string {
  return accepted && currentDraft === submittedDraft ? '' : currentDraft
}

export function isNearTimelineBottom(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  threshold = 48,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold
}

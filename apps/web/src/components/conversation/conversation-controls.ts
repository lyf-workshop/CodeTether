import type {
  ApprovalDecision,
  CanonicalFailure,
  HostCapabilities,
  HostError,
  MachineSummary,
  ProjectAvailability,
  ProviderCapabilities,
  ProviderDescriptor,
  ProviderExecutionHealth,
} from '@codetether/protocol'

import type { HostConnectionState } from '../../runtime/host/host-runtime.js'
import { canonicalFailureActionPresentation } from '../../failures/failure-presentation.js'

type CanonicalFailureReason = CanonicalFailure['reason']

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

export interface FailedTurnRetryController {
  readonly enabled: boolean
  readonly disabledReason?: string
  readonly pendingTurnId?: string
  readonly errorTurnId?: string
  readonly error?: string
  execute(turnId: string): Promise<void>
}

export interface ConversationControls {
  readonly composer: ComposerController
  readonly interrupt: InterruptController
  readonly approvals: ApprovalController
  readonly failedTurnRetry: FailedTurnRetryController
}

export interface LiveControlAvailability {
  readonly canCompose: boolean
  readonly canInterrupt: boolean
  readonly canStop: false
  readonly canResolveApproval: boolean
  readonly supportsInterrupt: boolean
  readonly supportsApprovals: boolean
  readonly supportsDiff: boolean
  readonly supportsShell: boolean
  readonly supportsReasoningControl: boolean
  readonly composerDisabled?: ComposerDisabledPresentation
}

export type ComposerDisabledReason =
  | CanonicalFailureReason
  | 'host_incompatible'
  | 'host_unavailable'
  | 'provider_capability_unsupported'

export interface ComposerDisabledPresentation {
  readonly reason: ComposerDisabledReason
  readonly message: string
  readonly navigation?: 'machine' | 'project'
}

export type ProjectLocationBoundaryReason =
  | 'project_location_missing'
  | 'project_location_invalid'
  | 'project_location_unavailable'

export type ConversationExecutionBoundaryReason =
  | 'machine_offline'
  | 'reconnecting'
  | 'transport_authentication_failed'
  | 'remote_execution_unavailable'
  | 'execution_unavailable'

export interface ConversationExecutionBoundaryPresentation {
  readonly title: string
  readonly description: string
}

export interface ComposerEligibilityInput {
  readonly connectionState: HostConnectionState
  readonly currentTurnStatus:
    'running' | 'completed' | 'failed' | 'interrupted' | undefined
  readonly machine: MachineSummary | undefined
  readonly projectAvailability: ProjectAvailability
  readonly provider: ProviderDescriptor | undefined
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
  capabilities: HostCapabilities | ProviderCapabilities | undefined,
  currentTurnStatus:
    'running' | 'completed' | 'failed' | 'interrupted' | undefined,
  composerDisabled?: ComposerDisabledPresentation,
): LiveControlAvailability {
  const connected = connectionState === 'connected'
  const hasActiveTurn = currentTurnStatus === 'running'
  const providerAvailable =
    capabilities !== undefined &&
    (!('codex' in capabilities) || capabilities.codex === true)
  const streaming = capabilities?.streaming === true
  const supportsInterrupt = capabilities?.interrupt === true
  const supportsApprovals = capabilities?.approvals === true
  const supportsDiff = capabilities?.diff === true
  const supportsShell =
    capabilities !== undefined &&
    ('codex' in capabilities ? capabilities.codex : capabilities.shell)
  const supportsReasoningControl =
    capabilities !== undefined &&
    ('codex' in capabilities
      ? capabilities.codex
      : capabilities.reasoningControl)
  return {
    canCompose:
      connected &&
      providerAvailable &&
      streaming &&
      !hasActiveTurn &&
      composerDisabled === undefined,
    canInterrupt: connected && supportsInterrupt && hasActiveTurn,
    canStop: false,
    canResolveApproval: connected && supportsApprovals,
    supportsInterrupt,
    supportsApprovals,
    supportsDiff,
    supportsShell,
    supportsReasoningControl,
    ...(composerDisabled === undefined ? {} : { composerDisabled }),
  }
}

/**
 * Derives one presentation-safe Composer gate from typed Host/Machine truth.
 * Ordering is deliberate: connectivity, Project, Provider, then active work.
 */
export function deriveComposerEligibility(
  input: ComposerEligibilityInput,
): ComposerDisabledPresentation | undefined {
  switch (input.connectionState) {
    case 'connecting':
    case 'reconnecting':
      return disabled(
        'reconnecting',
        '正在重新连接 CodeTether，请等待连接恢复。',
      )
    case 'unavailable':
      return disabled(
        'host_unavailable',
        'CodeTether Host 当前不可用，暂时无法开始新轮次。',
      )
    case 'incompatible':
      return disabled(
        'host_incompatible',
        'CodeTether Host 版本不兼容，请先更新应用。',
      )
    case 'connected':
      break
  }

  const { machine } = input
  if (machine === undefined) {
    return disabled(
      'remote_execution_unavailable',
      '无法读取执行机器状态，暂时不能开始新轮次。',
      'machine',
    )
  }
  if (machine.kind === 'remote') {
    switch (machine.connectionState) {
      case 'connecting':
        return disabled(
          'reconnecting',
          '正在验证并连接远程机器，请等待连接恢复。',
          'machine',
        )
      case 'offline':
      case 'recovery_required':
        return disabled(
          'machine_offline',
          '远程执行机器当前离线；历史记录仍可查看。',
          'machine',
        )
      case 'authentication_failed':
        return disabled(
          'transport_authentication_failed',
          '远程机器身份验证失败，请在机器详情中检查连接。',
          'machine',
        )
      case 'incompatible':
        return disabled(
          'remote_execution_unavailable',
          '远程机器协议不兼容，请更新 CodeTether Node。',
          'machine',
        )
      case 'online':
        break
      case 'local':
        return disabled(
          'remote_execution_unavailable',
          '远程机器连接状态无效，暂时不能开始新轮次。',
          'machine',
        )
    }
  }

  if (input.projectAvailability !== 'available') {
    return disabled(
      'project_location_unavailable',
      '这台机器当前无法访问已注册的项目位置。',
      'project',
    )
  }

  const { provider } = input
  if (provider === undefined) {
    return disabled(
      'remote_execution_unavailable',
      '这台机器尚未提供当前智能体的检测结果。',
      'machine',
    )
  }
  switch (provider.availability) {
    case 'not_installed':
      return disabled(
        'provider_not_installed',
        '执行机器上未安装当前智能体。',
        'machine',
      )
    case 'unsupported_version':
      return disabled(
        'provider_unsupported_version',
        '执行机器上的智能体版本不受支持。',
        'machine',
      )
    case 'misconfigured':
      return disabled(
        'provider_misconfigured',
        '执行机器上的智能体配置当前不可用。',
        'machine',
      )
    case 'unavailable':
      return disabled(
        'remote_execution_unavailable',
        '当前智能体在这台机器上不可用。',
        'machine',
      )
    case 'available':
      break
  }

  const currentExecutionFailure =
    provider.executionHealth?.freshness === 'current'
      ? provider.executionHealth.failure
      : undefined
  if (
    machine.capabilities.providerExecution !== true ||
    provider.capabilities.streaming !== true ||
    provider.capabilities.resume !== true
  ) {
    if (currentExecutionFailure !== undefined) {
      const presentation = canonicalFailureActionPresentation(
        currentExecutionFailure,
        {
          providerDisplayName: provider.displayName,
          machineDisplayName: machine.displayName,
        },
      )
      return disabled(
        currentExecutionFailure.reason,
        `${presentation.cause} ${presentation.guidance}`,
        presentation.navigation,
      )
    }
    return disabled(
      'provider_capability_unsupported',
      '当前智能体不支持此会话所需的远程执行能力。',
      'machine',
    )
  }
  if (input.currentTurnStatus === 'running') {
    return disabled('conversation_busy', '智能体正在执行当前轮次，请等待完成。')
  }
  return undefined
}

export function deriveConversationExecutionBoundaryReason(
  machine: MachineSummary | undefined,
): ConversationExecutionBoundaryReason {
  if (machine?.kind !== 'remote') return 'execution_unavailable'
  switch (machine.connectionState) {
    case 'offline':
    case 'recovery_required':
      return 'machine_offline'
    case 'connecting':
      return 'reconnecting'
    case 'authentication_failed':
      return 'transport_authentication_failed'
    case 'incompatible':
    case 'local':
      return 'remote_execution_unavailable'
    case 'online':
      return 'execution_unavailable'
  }
}

export function conversationExecutionBoundaryPresentation(
  reason: ConversationExecutionBoundaryReason,
): ConversationExecutionBoundaryPresentation {
  switch (reason) {
    case 'machine_offline':
      return {
        title: '远程执行机器当前离线',
        description: '历史记录仍可查看；机器重新连接后才能开始新轮次。',
      }
    case 'reconnecting':
      return {
        title: '正在重新连接远程执行机器',
        description: '历史记录仍可查看；请等待身份验证和连接完成。',
      }
    case 'transport_authentication_failed':
      return {
        title: '远程执行机器身份验证失败',
        description: '历史记录仍可查看；请在机器详情中检查受信任连接。',
      }
    case 'remote_execution_unavailable':
      return {
        title: '远程执行当前不可用',
        description:
          '历史记录仍可查看；请在机器详情中检查 CodeTether Node 版本和状态。',
      }
    case 'execution_unavailable':
      return {
        title: '这台机器当前无法执行此智能体',
        description:
          '历史记录仍可查看；请在机器详情确认连接和智能体状态后再继续。',
      }
  }
}

/**
 * Execution health is a bounded recent observation, not a live admission
 * lock. A fresh explicit action revalidates current Provider truth; hard
 * admission gates (Machine, installation, Location, capability, and active
 * Turn) are evaluated separately. Retry of an old Prompt has its own stricter
 * policy and never uses this helper.
 */
export function providerExecutionHealthAllowsExplicitStart(
  health: ProviderExecutionHealth | undefined,
  remote: boolean,
  currentTurnStatus:
    'running' | 'completed' | 'failed' | 'interrupted' | undefined,
): boolean {
  void health
  void remote
  void currentTurnStatus
  return true
}

/**
 * A current unavailable Location owns the boundary. Historical failure data
 * may refine its safe reason, but can never keep a repaired Location blocked.
 */
export function deriveProjectLocationBoundaryReason(
  projectAvailability: ProjectAvailability,
  latestTurnError: HostError | undefined,
): ProjectLocationBoundaryReason | undefined {
  if (projectAvailability === 'available') return undefined

  switch (latestTurnError?.failure?.reason) {
    case 'project_location_missing':
    case 'project_location_invalid':
    case 'project_location_unavailable':
      return latestTurnError.failure.reason
    default:
      break
  }

  switch (latestTurnError?.code) {
    case 'project_location_missing':
    case 'project_location_not_found':
      return 'project_location_missing'
    case 'project_location_invalid':
      return 'project_location_invalid'
    case 'project_location_inaccessible':
    case 'project_unavailable':
    default:
      return 'project_location_unavailable'
  }
}

function disabled(
  reason: ComposerDisabledReason,
  message: string,
  navigation?: 'machine' | 'project',
): ComposerDisabledPresentation {
  return {
    reason,
    message,
    ...(navigation === undefined ? {} : { navigation }),
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

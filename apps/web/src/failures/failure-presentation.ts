import type {
  CanonicalFailure,
  HostError,
  HostErrorCode,
} from '@codetether/protocol'

type CanonicalFailureReason = CanonicalFailure['reason']
type CanonicalFailureSource = CanonicalFailure['source']

interface FailureReasonCopy {
  readonly title: string
  readonly cause: string
  readonly guidance: string
}

export interface FailureTechnicalDetail {
  readonly label: string
  readonly value: string
}

export interface ExecutionFailurePresentation {
  readonly title: string
  readonly cause: string
  readonly guidance: string
  readonly historyNote: string
  readonly canStartNewTurn: boolean
  readonly navigation?: 'machine' | 'project'
  readonly technicalDetails: readonly FailureTechnicalDetail[]
}

export interface CanonicalFailureActionPresentation {
  readonly cause: string
  readonly guidance: string
  readonly navigation?: 'machine' | 'project'
}

/** Public, protocol-validated display labels only; never Provider diagnostics. */
export interface FailurePresentationContext {
  readonly providerDisplayName?: string
  readonly machineDisplayName?: string
}

const failureReasonCopy = {
  login_required: {
    title: '需要登录智能体',
    cause: '执行机器上的智能体登录状态不可用。',
    guidance: '请在执行机器上完成登录，然后再开始新一轮。',
  },
  authentication_expired: {
    title: '智能体登录已过期',
    cause: '执行机器上的智能体凭据已过期。',
    guidance: '请在执行机器上重新登录，然后再开始新一轮。',
  },
  authentication_invalid: {
    title: '智能体验证失败',
    cause: '执行机器无法使用当前智能体凭据。',
    guidance: '请在执行机器上重新登录并确认账号状态。',
  },
  account_unavailable: {
    title: '智能体账号不可用',
    cause: '当前账号暂时不能执行这项工作。',
    guidance: '请检查智能体账号状态或联系智能体服务方。',
  },
  usage_limit_reached: {
    title: '已达到使用限额',
    cause: '智能体服务暂时没有可用配额。',
    guidance: '请等待配额恢复后再开始新一轮。',
  },
  rate_limited: {
    title: '请求过于频繁',
    cause: '智能体服务暂时限制了请求频率。',
    guidance: '请稍后再开始新一轮。',
  },
  provider_capacity_limited: {
    title: '智能体服务繁忙',
    cause: '智能体服务当前没有可用执行容量。',
    guidance: '请等待服务恢复后再开始新一轮。',
  },
  provider_not_installed: {
    title: '未安装智能体',
    cause: '执行机器上没有检测到该智能体。',
    guidance: '请在机器详情中确认安装状态。',
  },
  provider_unsupported_version: {
    title: '智能体版本不受支持',
    cause: '执行机器上的智能体版本不在当前支持范围内。',
    guidance: '请更新智能体后重新检测。',
  },
  provider_misconfigured: {
    title: '智能体配置不可用',
    cause: '智能体已安装，但当前配置无法安全执行。',
    guidance: '请在执行机器上检查配置，并在机器详情中重新检测。',
  },
  provider_service_unavailable: {
    title: '智能体服务暂时不可用',
    cause: '智能体服务当前无法接受执行请求。',
    guidance: '请稍后再开始新一轮。',
  },
  provider_start_failed: {
    title: '智能体启动失败',
    cause: 'CodeTether 未能安全启动智能体进程。',
    guidance: '请检查机器详情中的执行状态后再继续。',
  },
  provider_crashed: {
    title: '智能体意外退出',
    cause: '智能体进程在完成本轮工作前意外退出。',
    guidance: '确认执行环境可用后，可以明确开始一个新轮次。',
  },
  provider_session_lost: {
    title: '智能体会话已丢失',
    cause: '智能体无法继续识别这段原生会话。',
    guidance: '请查看机器详情；CodeTether 不会假装恢复原生连续性。',
  },
  provider_protocol_error: {
    title: '智能体协议不兼容',
    cause: '智能体返回了 CodeTether 无法安全接受的响应。',
    guidance: '请更新智能体并在机器详情中重新检测。',
  },
  machine_offline: {
    title: '执行机器离线',
    cause: 'CodeTether 当前无法连接到这台执行机器。',
    guidance: '请恢复机器连接并等待状态重新验证。',
  },
  node_disconnected: {
    title: 'CodeTether Node 已断开',
    cause: '执行机器上的 CodeTether Node 不再连接。',
    guidance: '请恢复 Node 运行并等待安全重连。',
  },
  machine_identity_mismatch: {
    title: '机器身份验证失败',
    cause: '远程端身份与已信任的机器不一致。',
    guidance: '请在机器详情中检查连接；不要绕过身份验证。',
  },
  remote_execution_unavailable: {
    title: '远程执行不可用',
    cause: '这台机器当前不满足远程执行条件。',
    guidance: '请在机器详情中检查连接和智能体执行状态。',
  },
  project_location_missing: {
    title: '缺少项目位置',
    cause: '这台机器上没有可用于本会话的已注册项目位置。',
    guidance: '请在项目详情中注册或修复对应机器上的项目位置。',
  },
  project_location_invalid: {
    title: '项目位置已改变',
    cause: '已注册的项目位置不再匹配原来的工作区。',
    guidance: '请在项目详情中修复项目位置后再继续。',
  },
  project_location_unavailable: {
    title: '项目位置不可用',
    cause: '执行机器当前无法访问已注册的项目位置。',
    guidance: '请在项目详情中检查该机器的项目位置。',
  },
  execution_capacity_reached: {
    title: '执行容量已满',
    cause: 'CodeTether 当前没有可用的远程运行时槽位。',
    guidance: '请等待其他工作结束后再开始新一轮。',
  },
  conversation_busy: {
    title: '会话正在执行',
    cause: '这个会话已经有一个活动轮次。',
    guidance: '请等待当前轮次结束。',
  },
  execution_lost: {
    title: '执行状态已丢失',
    cause: 'CodeTether 无法再证明本轮执行的最终状态。',
    guidance: '为避免重复工作，本轮不会自动恢复或重新发送。',
  },
  execution_ownership_uncertain: {
    title: '执行归属无法确认',
    cause: '请求可能已被执行端接收，但 CodeTether 无法确认执行归属。',
    guidance: '为避免重复工作，原请求不会自动重新发送。',
  },
  output_limit_exceeded: {
    title: '输出超过安全上限',
    cause: '智能体输出超过了 CodeTether 的有界处理范围。',
    guidance: '请查看已保存的结果；本轮不会继续接收更多输出。',
  },
  protocol_limit_exceeded: {
    title: '执行数据超过安全上限',
    cause: '远程执行数据超过了协议允许的有界范围。',
    guidance: '请查看已保存的结果和机器执行状态。',
  },
  transport_lost: {
    title: '执行连接已中断',
    cause: '活动执行与 CodeTether 之间的安全连接已丢失。',
    guidance: '为避免重复工作，原请求不会自动重新发送。',
  },
  transport_authentication_failed: {
    title: '执行连接验证失败',
    cause: 'CodeTether 无法验证远程执行连接。',
    guidance: '请在机器详情中检查受信任连接。',
  },
  reconnecting: {
    title: '正在重新连接',
    cause: 'CodeTether 正在恢复与执行机器的安全连接。',
    guidance: '请等待连接状态重新验证。',
  },
  relay_not_configured: {
    title: 'Internet Relay 尚未配置',
    cause: '这台 Machine 尚未配置用于互联网连通性的 CodeTether Relay。',
    guidance: '请在 Machine 详情中配置并确认 Relay 身份。',
  },
  relay_unreachable: {
    title: 'Internet Relay 暂时无法连接',
    cause: 'CodeTether 当前无法建立到已配置 Relay 的安全连接。',
    guidance: '直接局域网功能不受影响；CodeTether 将按有界退避继续重连。',
  },
  relay_authentication_failed: {
    title: 'Internet Relay 验证失败',
    cause: 'Relay 无法验证这个已注册的 CodeTether 身份。',
    guidance: '请在 Machine 详情中检查注册状态；不要绕过身份验证。',
  },
  relay_identity_mismatch: {
    title: 'Internet Relay 身份不匹配',
    cause: '端点返回的 Relay 身份与已确认的身份不一致。',
    guidance: 'CodeTether 已拒绝连接。请先核实 Relay 身份，再明确更新配置。',
  },
  relay_protocol_incompatible: {
    title: 'Internet Relay 版本不兼容',
    cause: 'Relay 控制协议与当前 CodeTether 版本不兼容。',
    guidance: '请升级 Relay 或 CodeTether 后重新连接。',
  },
  relay_revoked: {
    title: 'Internet Relay 注册已撤销',
    cause: 'Relay 已撤销这个基础设施身份的连接权限。',
    guidance: 'Machine trust 未被修改；如需恢复，请使用新的单次注册流程。',
  },
  relay_rate_limited: {
    title: 'Internet Relay 暂时限制连接',
    cause: 'Relay 已暂时限制新的连接或验证尝试。',
    guidance: '请稍后重试；不要重复快速提交注册或连接请求。',
  },
  relay_channel_open_failed: {
    title: 'Internet Relay 通道无法建立',
    cause: 'CodeTether 无法为这台受信任的 Machine 建立执行通道。',
    guidance: '请等待 Relay 与远程 Node 恢复后，再开始新的请求。',
  },
  relay_channel_lost: {
    title: 'Internet Relay 执行通道已中断',
    cause: '活动执行使用的 Relay 通道在完成状态确认前断开。',
    guidance: '为避免重复操作，CodeTether 没有自动重发原请求。',
  },
  relay_peer_offline: {
    title: '远程 Node 未连接到 Internet Relay',
    cause: 'Relay 当前无法到达这台受信任 Machine 的 Node。',
    guidance: '请等待 Node 重新连接；会话历史仍可查看。',
  },
  relay_transport_capacity_reached: {
    title: 'Internet Relay 执行通道已满',
    cause: '当前 Relay Machine 通道已达到有界容量。',
    guidance: '请等待其他远程任务结束后再试。',
  },
  relay_protocol_error: {
    title: 'Internet Relay 执行协议异常',
    cause: 'CodeTether 拒绝了无效或不兼容的 Relay Machine 通道数据。',
    guidance: '请检查 Relay、Desktop 与 Node 版本后再试。',
  },
  provider_error: {
    title: '智能体执行失败',
    cause: '智能体未能完成本轮工作。',
    guidance: '请查看机器详情中的执行状态后再继续。',
  },
  runtime_error: {
    title: '运行时执行失败',
    cause: 'CodeTether 运行时未能完成本轮工作。',
    guidance: '请查看技术详情和当前执行状态。',
  },
  unknown_failure: {
    title: '执行失败',
    cause: 'CodeTether 无法安全确认本轮已完成。',
    guidance: '请查看技术详情，并在确认执行状态后再继续。',
  },
} as const satisfies Record<CanonicalFailureReason, FailureReasonCopy>

const sourceLabels = {
  provider: '智能体',
  machine: '机器',
  transport: '安全连接',
  project: '项目位置',
  runtime: 'CodeTether 运行时',
  relay: 'Internet Relay',
} as const satisfies Record<CanonicalFailureSource, string>

const replayUnsafeReasons = new Set<CanonicalFailureReason>([
  'execution_lost',
  'execution_ownership_uncertain',
  'transport_lost',
  'relay_channel_lost',
])

export function executionFailurePresentation(
  error: HostError | undefined,
  context?: FailurePresentationContext,
): ExecutionFailurePresentation {
  const failure = error?.failure
  const reason = failure?.reason ?? legacyFailureReason(error?.code)
  const copy = contextualizedCopy(failureReasonCopy[reason], context)
  const canStartNewTurn = canStartNewTurnAfterFailure(failure)
  const navigation = failureNavigation(failure)

  return {
    title: copy.title,
    cause: copy.cause,
    guidance: copy.guidance,
    historyNote: replayUnsafeReasons.has(reason)
      ? '本轮工作可能不完整。已保存的会话历史仍可查看，CodeTether 未自动重新发送原请求。'
      : '本轮工作可能不完整。已保存的会话历史仍可查看。',
    canStartNewTurn,
    ...(navigation === undefined ? {} : { navigation }),
    technicalDetails: technicalDetails(error, failure),
  }
}

export function canonicalFailureCause(failure: CanonicalFailure): string {
  return failureReasonCopy[failure.reason].cause
}

export function canonicalFailureActionPresentation(
  failure: CanonicalFailure,
  context?: FailurePresentationContext,
): CanonicalFailureActionPresentation {
  const copy = contextualizedCopy(failureReasonCopy[failure.reason], context)
  const navigation = failureNavigation(failure)
  return {
    cause: copy.cause,
    guidance: copy.guidance,
    ...(navigation === undefined ? {} : { navigation }),
  }
}

function contextualizedCopy(
  copy: FailureReasonCopy,
  context: FailurePresentationContext | undefined,
): FailureReasonCopy {
  const providerName = context?.providerDisplayName?.trim()
  const machineName = context?.machineDisplayName?.trim()
  const contextualize = (value: string): string => {
    const providerCopy =
      providerName === undefined || providerName.length === 0
        ? value
        : value.replaceAll('智能体', contextualLabel(providerName))
    const machineCopy =
      machineName === undefined || machineName.length === 0
        ? providerCopy
        : providerCopy
            .replaceAll('执行机器', contextualLabel(machineName))
            .replaceAll('这台机器', contextualLabel(machineName))
    return machineCopy.replace(/\s+/gu, ' ').trim()
  }
  return {
    title: contextualize(copy.title),
    cause: contextualize(copy.cause),
    guidance: contextualize(copy.guidance),
  }
}

function contextualLabel(label: string): string {
  return /[a-z0-9]/iu.test(label) ? ` ${label} ` : label
}

export function canStartNewTurnAfterFailure(
  failure: CanonicalFailure | undefined,
): boolean {
  return (
    failure !== undefined &&
    !replayUnsafeReasons.has(failure.reason) &&
    failure.retryability === 'retry_now' &&
    failure.userAction === 'retry'
  )
}

function failureNavigation(
  failure: CanonicalFailure | undefined,
): 'machine' | 'project' | undefined {
  switch (failure?.userAction) {
    case 'login_on_machine':
    case 'open_machine':
    case 'reconnect_machine':
    case 'reinstall_provider':
    case 'update_provider':
      return 'machine'
    case 'open_project':
    case 'repair_project_location':
      return 'project'
    case 'retry':
    case 'wait':
    case 'reduce_active_work':
    case 'view_details':
    case 'contact_provider':
    case 'none':
    case undefined:
      return undefined
  }
}

function technicalDetails(
  error: HostError | undefined,
  failure: CanonicalFailure | undefined,
): readonly FailureTechnicalDetail[] {
  const details: FailureTechnicalDetail[] = []
  if (error !== undefined) {
    details.push({ label: '主机错误代码', value: error.code })
  }
  if (failure !== undefined) {
    details.push(
      { label: '故障代码', value: failure.technicalCode },
      { label: '来源', value: sourceLabels[failure.source] },
      { label: '发生时间', value: failure.occurredAt },
    )
  }
  if (details.length === 0) {
    details.push({ label: '故障代码', value: 'unknown_failure' })
  }
  return details
}

function legacyFailureReason(
  code: HostErrorCode | undefined,
): CanonicalFailureReason {
  switch (code) {
    case 'provider_not_installed':
      return 'provider_not_installed'
    case 'provider_version_unsupported':
      return 'provider_unsupported_version'
    case 'provider_start_failed':
      return 'provider_start_failed'
    case 'provider_session_lost':
      return 'provider_session_lost'
    case 'project_location_invalid':
      return 'project_location_invalid'
    case 'project_location_missing':
    case 'project_location_not_found':
      return 'project_location_missing'
    case 'project_location_inaccessible':
    case 'project_unavailable':
      return 'project_location_unavailable'
    case 'machine_identity_mismatch':
      return 'machine_identity_mismatch'
    case 'machine_unreachable':
      return 'machine_offline'
    case 'machine_connection_failed':
      // The legacy code covered coordinator, discovery, validation, and
      // transport failures. Do not guess that the Machine itself was offline.
      return 'unknown_failure'
    case 'machine_authentication_failed':
      return 'transport_authentication_failed'
    case 'provider_unavailable':
      // Historical provider_unavailable covered both local and remote
      // failures. Do not invent a remote Machine cause that was never
      // durably observed.
      return 'provider_error'
    case 'provider_conversation_unavailable':
      return 'provider_session_lost'
    case 'provider_error':
      return 'provider_error'
    case 'runtime_unavailable':
      return 'runtime_error'
    case 'invalid_request':
    case 'not_found':
    case 'conflict':
    case 'unsupported':
    case 'project_has_conversations':
    case 'project_location_conflict':
    case 'project_location_has_conversations':
    case 'project_location_local_required':
    case 'conversation_archived':
    case 'machine_pairing_code_invalid':
    case 'machine_pairing_code_expired':
    case 'machine_pairing_rate_limited':
    case 'machine_protocol_incompatible':
    case 'machine_has_project_locations':
    case 'timeout':
    case 'internal':
    case undefined:
      return 'unknown_failure'
    default:
      // Runtime callers normally receive Protocol-validated HostError codes;
      // retain a conservative fallback for stale fixtures or older clients.
      return 'unknown_failure'
  }
}

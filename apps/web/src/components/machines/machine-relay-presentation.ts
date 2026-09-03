import {
  RelayEndpointSchema,
  RelayIdentityFingerprintSchema,
  type RelayConnectionState,
  type RelayEndpoint,
  type RelayMachineConnectivity,
  type RelayNodePresence,
  type RelayTransportSecurity,
} from '@codetether/protocol'

export interface RelayConnectivityPresentation {
  readonly label: string
  readonly description: string
  readonly tone: 'neutral' | 'progress' | 'success' | 'warning' | 'danger'
}

export function relayConnectivityPresentation(
  state: RelayConnectionState,
): RelayConnectivityPresentation {
  switch (state) {
    case 'not_configured':
      return {
        label: '未配置',
        description: '尚未为这台远程机器配置 Internet Relay。',
        tone: 'neutral',
      }
    case 'enrollment_required':
      return {
        label: '需要注册',
        description: 'Relay 身份已确认；请使用一次性注册令牌完成注册。',
        tone: 'warning',
      }
    case 'connecting':
      return {
        label: '正在连接',
        description: '正在验证 Relay 身份并建立加密控制连接。',
        tone: 'progress',
      }
    case 'connected':
      return {
        label: '已连接',
        description: 'Controller 已通过身份验证连接到 Internet Relay。',
        tone: 'success',
      }
    case 'reconnecting':
      return {
        label: '正在重连',
        description: 'Relay 连接已中断，CodeTether 正在使用有界退避重新连接。',
        tone: 'progress',
      }
    case 'offline':
      return {
        label: '离线',
        description:
          'Internet Relay 当前未连接；局域网直连和历史记录不受影响。',
        tone: 'warning',
      }
    case 'identity_mismatch':
      return {
        label: '身份不匹配',
        description: '端点返回的 Relay 身份与已确认指纹不同，连接已被拒绝。',
        tone: 'danger',
      }
    case 'authentication_failed':
      return {
        label: '身份验证失败',
        description: 'Relay 无法验证此 Controller；机器配对信任未发生变化。',
        tone: 'danger',
      }
    case 'revoked':
      return {
        label: '注册已撤销',
        description:
          '此 Controller 已被 Relay 撤销；普通重连会被拒绝，需要使用新的一次性令牌明确重新注册。',
        tone: 'danger',
      }
    case 'incompatible':
      return {
        label: '版本不兼容',
        description: 'Relay 控制协议版本不兼容，不会降级到不安全协议。',
        tone: 'danger',
      }
  }
}

export function relayNodePresenceLabel(presence: RelayNodePresence): string {
  switch (presence) {
    case 'not_observed':
      return '尚未观察'
    case 'online':
      return '在线'
    case 'offline':
      return '离线'
    case 'unauthorized':
      return '未获授权'
  }
}

export function relayStatusTone(
  tone: RelayConnectivityPresentation['tone'],
): string {
  switch (tone) {
    case 'success':
      return 'text-success'
    case 'warning':
    case 'progress':
      return 'text-warning'
    case 'danger':
      return 'text-danger'
    case 'neutral':
      return 'text-text-secondary'
  }
}

export function relayEndpointLabel(endpoint: RelayEndpoint): string {
  const host = endpoint.host.includes(':')
    ? `[${endpoint.host}]`
    : endpoint.host
  return `${host}:${endpoint.port}`
}

export function parseRelayConfigurationInput(input: {
  readonly host: string
  readonly port: string
  readonly transportSecurity: RelayTransportSecurity
  readonly relayIdentityFingerprint: string
  readonly displayLabel: string
}):
  | {
      readonly endpoint: RelayEndpoint
      readonly relayIdentityFingerprint: string
      readonly displayLabel?: string
    }
  | undefined {
  if (!/^\d{1,5}$/u.test(input.port.trim())) return undefined
  const endpoint = RelayEndpointSchema.safeParse({
    host: input.host,
    port: Number(input.port),
    transportSecurity: input.transportSecurity,
  })
  const fingerprint = RelayIdentityFingerprintSchema.safeParse(
    input.relayIdentityFingerprint.trim(),
  )
  const label = input.displayLabel.trim()
  if (!endpoint.success || !fingerprint.success || label.length > 120) {
    return undefined
  }
  return {
    endpoint: endpoint.data,
    relayIdentityFingerprint: fingerprint.data,
    ...(label.length === 0 ? {} : { displayLabel: label }),
  }
}

export function relayCanRetry(relay: RelayMachineConnectivity): boolean {
  return (
    relay.enrollment === 'enrolled' &&
    (relay.state === 'offline' || relay.state === 'authentication_failed')
  )
}

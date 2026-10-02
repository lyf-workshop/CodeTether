import type { PendingHostAccessRequest } from '../../runtime/account/control-plane-client.js'

export interface RequestingDevicePresentation {
  readonly name: string
  readonly platform: string
  readonly shortFingerprint: string
}

function platformName(value: string): string {
  const platform = value.toLowerCase()
  if (platform.startsWith('macos') || platform.startsWith('darwin'))
    return 'macOS'
  if (platform.startsWith('windows') || platform.startsWith('win32'))
    return 'Windows'
  if (platform.startsWith('linux')) return 'Linux'
  return 'Other platform'
}

export function presentRequestingDevice(
  request: PendingHostAccessRequest,
): RequestingDevicePresentation | null {
  const device = request.requestingDevice
  if (
    request.scope !== 'supervisor_read' ||
    request.payload.scope !== 'supervisor_read' ||
    device.deviceId !== request.deviceId ||
    request.payload.deviceId !== device.deviceId ||
    request.payload.deviceFingerprint !== device.fingerprint ||
    request.payload.deviceKeyGeneration !== device.keyGeneration ||
    !/^sha256:[A-Za-z0-9_-]{32,128}$/u.test(device.fingerprint)
  )
    return null

  const platform = platformName(device.platform)
  const label = device.label.trim()
  const genericLabel =
    label === '' ||
    /^CodeTether(?: Desktop)?$/iu.test(label) ||
    /^(?:Desktop|Device)$/iu.test(label)
  return {
    name: genericLabel
      ? platform === 'Other platform'
        ? 'Registered device'
        : `${platform} device`
      : label,
    platform,
    shortFingerprint: `${device.fingerprint.slice(7, 11)}…${device.fingerprint.slice(-3)}`,
  }
}

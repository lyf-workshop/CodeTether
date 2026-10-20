import type {
  AccountProductDevice,
  HostSupervisorAuthorization,
} from './control-plane-client.js'

export interface AuthorizedMobileDevice {
  readonly deviceId: string
  readonly name: string
  readonly type: 'mobile' | 'tablet'
  readonly authorizedAt: string
}

/** Presentation only: the existing coordinator remains the grant authority. */
export function authorizedMobileDevices(
  context: {
    readonly hostId: string
    readonly ownerUserId: string
    readonly now?: number
  },
  authorizations: readonly HostSupervisorAuthorization[],
  devices: readonly AccountProductDevice[],
): readonly AuthorizedMobileDevice[] {
  const now = context.now ?? Date.now()
  const knownDevices = new Map(
    devices.map((device) => [device.deviceId, device]),
  )
  const result = new Map<string, AuthorizedMobileDevice>()
  for (const authorization of authorizations) {
    const device = knownDevices.get(authorization.deviceId)
    if (
      !device ||
      (device.deviceType !== 'mobile' && device.deviceType !== 'tablet') ||
      device.ownerUserId !== context.ownerUserId ||
      authorization.userId !== context.ownerUserId ||
      authorization.hostId !== context.hostId ||
      authorization.scope !== 'supervisor_read' ||
      authorization.deviceFingerprint !== device.fingerprint ||
      authorization.deviceKeyGeneration !== device.keyGeneration ||
      !Number.isFinite(Date.parse(authorization.issuedAt)) ||
      !(Date.parse(authorization.expiresAt) > now)
    )
      continue
    const previous = result.get(device.deviceId)
    if (
      previous &&
      Date.parse(previous.authorizedAt) >= Date.parse(authorization.issuedAt)
    )
      continue
    result.set(device.deviceId, {
      deviceId: device.deviceId,
      name: device.label,
      type: device.deviceType,
      authorizedAt: authorization.issuedAt,
    })
  }
  return [...result.values()]
}

export const localAuthorizedMobileDevicesKey = (
  userId?: string,
  hostId?: string,
) =>
  [
    'account',
    'host-supervisor-grants',
    hostId ?? 'unavailable',
    userId ?? 'signed-out',
  ] as const

export interface AuthorizedMobileDeviceObservation {
  readonly devices: readonly AuthorizedMobileDevice[]
  readonly observedAt: string
}

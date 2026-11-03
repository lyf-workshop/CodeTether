import type { PairedDevice } from './pairing-client.js'

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
  readonly devices: readonly PairedDevice[]
  readonly observedAt: string
}

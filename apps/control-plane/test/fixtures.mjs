const padded = (value) => value.replaceAll(/[^a-z0-9]/g, '').padEnd(32, '0')

export const id = (prefix, value) => `${prefix}_${padded(value)}`
export const fingerprint = (value) => `sha256:${value.repeat(43).slice(0, 43)}`
export const publicKey = (value) => `public-key-${value}`.padEnd(48, value)

export function accountInput(
  value,
  now = new Date('2026-09-20T12:00:00.000Z'),
) {
  return {
    userId: id('usr', `${value}user`),
    status: 'active',
    displayName: `User ${value}`,
    spaceId: id('space', `${value}space`),
    spaceName: `Personal ${value}`,
    now,
  }
}

export function deviceInput(account, value, now = account.now) {
  return {
    deviceId: id('dev', `${value}device`),
    ownerUserId: account.userId,
    deviceType: 'desktop_client',
    publicKey: publicKey(value),
    keyAlgorithm: 'ed25519',
    fingerprint: fingerprint(value),
    label: `Device ${value}`,
    platform: 'windows',
    appVersion: '9.0.0-test',
    protocolVersion: 1,
    keyGeneration: 0,
    createdAt: now,
  }
}

export function hostInput(account, value, now = account.now) {
  return {
    hostId: id('host', `${value}host`),
    owningSpaceId: account.spaceId,
    publicKey: publicKey(`host${value}`),
    keyAlgorithm: 'ed25519',
    fingerprint: fingerprint(`h${value}`),
    safeLabel: `Host ${value}`,
    coarsePlatform: 'windows',
    protocolVersionMin: 1,
    protocolVersionMax: 1,
    claimGeneration: 0,
    claimState: 'claimed',
    createdAt: now,
  }
}

import assert from 'node:assert/strict'
import test from 'node:test'
import { loadWebComponent } from './fixtures/render-ui.mjs'

const {
  machinePlatformFamily,
  machinePlatformLabel,
  machineSubtitleLabel,
  sortMachinesForDisplay,
} = loadWebComponent('components/machines/machine-presentation.ts')

for (const [platform, family] of [
  ['Windows', 'windows'],
  ['windows', 'windows'],
  ['WINDOWS', 'windows'],
  ['win32', 'windows'],
  ['WIN32', 'windows'],
  ['macOS', 'macos'],
  ['MACOS', 'macos'],
  ['darwin', 'macos'],
  ['Darwin', 'macos'],
  ['Linux', 'linux'],
  ['LINUX', 'linux'],
  ['FreeBSD', 'other'],
  ['', 'other'],
  [' Windows ', 'other'],
]) {
  test(`platform family classifies ${JSON.stringify(platform)} as ${family}`, () => {
    assert.equal(machinePlatformFamily(platform), family)
  })
}

test('computer subtitle maps OS and connection while preserving architecture', () => {
  for (const platform of ['Windows', 'windows', 'WINDOWS', 'win32']) {
    assert.equal(machinePlatformLabel(platform), 'Windows')
  }
  for (const platform of ['macOS', 'darwin'])
    assert.equal(machinePlatformLabel(platform), 'macOS')
  assert.equal(machinePlatformLabel('linux'), 'Linux')
  assert.equal(machinePlatformLabel('FreeBSD'), 'FreeBSD')
  assert.equal(
    machineSubtitleLabel({
      platform: 'darwin',
      architecture: 'arm64',
      connectionState: 'online',
    }),
    'macOS · arm64 · 在线',
  )
  assert.equal(
    machineSubtitleLabel({
      platform: 'windows',
      architecture: 'x64',
      connectionState: 'local',
    }),
    'Windows · x64 · 在线',
  )
})

test('each Machine stays an independent computer, with local first and offline last', () => {
  const machines = [
    {
      machineId: 'machine_offline',
      computerId: 'same-hardware',
      displayName: 'Windows WSL',
      kind: 'remote',
      connectionState: 'offline',
      lastSeenAt: '2026-11-09T10:00:00Z',
    },
    {
      machineId: 'machine_online_older',
      displayName: 'MacBook Pro',
      kind: 'remote',
      connectionState: 'online',
      lastSeenAt: '2026-11-08T10:00:00Z',
    },
    {
      machineId: 'machine_local',
      computerId: 'same-hardware',
      displayName: 'Windows Desktop',
      kind: 'local',
      connectionState: 'local',
    },
    {
      machineId: 'machine_online_newer',
      displayName: 'Ubuntu Server',
      kind: 'remote',
      connectionState: 'online',
      lastSeenAt: '2026-11-09T11:00:00Z',
    },
  ]
  assert.deepEqual(
    sortMachinesForDisplay(machines).map((machine) => machine.machineId),
    [
      'machine_local',
      'machine_online_newer',
      'machine_online_older',
      'machine_offline',
    ],
  )
  assert.equal(machines.length, 4)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { loadWebComponent } from './fixtures/render-ui.mjs'

const { machinePlatformFamily, machinePlatformLabel } = loadWebComponent(
  'components/machines/machine-presentation.ts',
)

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

test('platform family does not change the existing platform display labels', () => {
  for (const platform of ['Windows', 'windows', 'WINDOWS']) {
    assert.equal(machinePlatformLabel(platform), 'Windows')
  }
  for (const platform of ['win32', 'macOS', 'darwin', 'Linux', 'FreeBSD', '']) {
    assert.equal(machinePlatformLabel(platform), platform)
  }
})

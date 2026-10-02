import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { presentRequestingDevice } from '../.tmp/test-dist/components/hosts/requesting-device-presentation.js'

const fingerprint = 'sha256:Eu36_8muS1BDAzIjK7CSLamjYx4R6b1xi1uis2CXWV0'

function pendingRequest(label = 'Mac mini') {
  return {
    deviceId: 'dev_mac',
    scope: 'supervisor_read',
    payload: {
      deviceId: 'dev_mac',
      deviceFingerprint: fingerprint,
      deviceKeyGeneration: 1,
      scope: 'supervisor_read',
    },
    requestingDevice: {
      deviceId: 'dev_mac',
      label,
      platform: 'macOS-arm64',
      fingerprint,
      keyGeneration: 1,
    },
  }
}

test('registered device name, platform, scope, and short identity are distinguishable', () => {
  const display = presentRequestingDevice(pendingRequest())
  assert.deepEqual(display, {
    name: 'Mac mini',
    platform: 'macOS',
    shortFingerprint: 'Eu36…WV0',
  })
  assert.equal(display.name.includes('dev_'), false)
})

test('generic or absent name falls back to platform and stable fingerprint', () => {
  for (const label of ['CodeTether Desktop', '']) {
    assert.deepEqual(presentRequestingDevice(pendingRequest(label)), {
      name: 'macOS device',
      platform: 'macOS',
      shortFingerprint: 'Eu36…WV0',
    })
  }
})

test('requester payload cannot override the Control Plane-bound display name', () => {
  const request = pendingRequest('Registered Mac')
  request.payload.label = 'Spoofed Windows workstation'
  assert.equal(presentRequestingDevice(request).name, 'Registered Mac')
})

test('another ProductDevice or mismatched fingerprint, generation, or scope fails closed', () => {
  const wrongDevice = pendingRequest()
  wrongDevice.requestingDevice.deviceId = 'dev_other'
  assert.equal(presentRequestingDevice(wrongDevice), null)

  const wrongFingerprint = pendingRequest()
  wrongFingerprint.requestingDevice.fingerprint = `sha256:${'A'.repeat(43)}`
  assert.equal(presentRequestingDevice(wrongFingerprint), null)

  const wrongGeneration = pendingRequest()
  wrongGeneration.requestingDevice.keyGeneration = 2
  assert.equal(presentRequestingDevice(wrongGeneration), null)

  const wrongScope = pendingRequest()
  wrongScope.scope = 'supervisor_control'
  assert.equal(presentRequestingDevice(wrongScope), null)
})

test('approval card presents verified identity and keeps existing Allow and Deny handlers', async () => {
  const source = await readFile(
    new URL('../src/components/hosts/host-directory-page.tsx', import.meta.url),
    'utf8',
  )
  assert.match(source, /presentRequestingDevice\(request\)/u)
  assert.match(
    source,
    /Device identity: \{requestingDevice\.shortFingerprint\}/u,
  )
  assert.match(source, /Permission: Read workspace/u)
  assert.match(source, /onClick=\{\(\) => deny\.mutate\(\)\}/u)
  assert.match(source, /onClick=\{\(\) => approve\.mutate\(\)\}/u)
  assert.match(source, /requestingDevice === null/u)
  assert.doesNotMatch(source, /A device requests read-only workspace access/u)
})

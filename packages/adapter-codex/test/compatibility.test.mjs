import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

import {
  observeCodexBackendConfiguration,
  observeCodexInstallation,
} from '../dist/index.js'

const executable = join(tmpdir(), 'codetether-codex-compatibility-fixture')
const installation = {
  launcherPath: executable,
  executable,
  fileIdentity: 'fixture-codex-installation',
  launcherKind: 'native',
  installMethod: 'manual',
}

test('unknown Codex versions keep execution usable when official metadata discovery is unavailable', async () => {
  let metadataProbes = 0
  const observation = await observeCodexInstallation({
    installation,
    environment: { PATH: process.env.PATH },
    probeVersion: async () => 'codex-cli 0.152.0',
    probeContract: async () => true,
    probeSessionDiscoveryContract: async () => {
      metadataProbes += 1
      return false
    },
    fingerprint: async () => 'b'.repeat(64),
  })

  assert.equal(metadataProbes, 1)
  assert.equal(observation.compatibility.state, 'limited')
  assert.deepEqual(observation.compatibility.capabilities.execution, {
    observed: 'supported',
    enabled: true,
    effective: true,
  })
  assert.deepEqual(
    observation.compatibility.capabilities.nativeSessionDiscovery,
    { observed: 'unsupported', enabled: true, effective: false },
  )
})

test('unknown Codex versions become compatible_unverified when execution and thread/list contracts pass', async () => {
  const observation = await observeCodexInstallation({
    installation,
    environment: { PATH: process.env.PATH },
    probeVersion: async () => 'codex 0.152.0',
    probeContract: async () => true,
    probeSessionDiscoveryContract: async () => true,
    fingerprint: async () => 'c'.repeat(64),
  })

  assert.equal(observation.compatibility.state, 'compatible_unverified')
  assert.equal(
    observation.compatibility.capabilities.nativeSessionDiscovery.effective,
    true,
  )
})

test('unavailable Codex observation preserves enabled policy while effective support is false', async () => {
  const observation = await observeCodexInstallation({
    installation,
    probeVersion: async () => {
      throw new Error('bounded fixture failure')
    },
    fingerprint: async () => 'd'.repeat(64),
  })

  assert.equal(observation.compatibility.state, 'unavailable')
  assert.equal(observation.privateRevision, 'd'.repeat(64))
  for (const capability of Object.values(
    observation.compatibility.capabilities,
  )) {
    assert.equal(capability.observed, 'unavailable')
    assert.equal(capability.enabled, true)
    assert.equal(capability.effective, false)
  }
})

test('backend revisions describe safe configuration shape and never credential values', () => {
  const first = observeCodexBackendConfiguration({
    OPENAI_BASE_URL: 'https://gateway.example.test/v1?token=one',
    OPENAI_API_KEY: 'first-secret-value',
  })
  const second = observeCodexBackendConfiguration({
    OPENAI_BASE_URL: 'https://gateway.example.test/private?token=two',
    OPENAI_API_KEY: 'second-secret-value',
  })

  assert.equal(
    first.privateConfigurationRevision,
    second.privateConfigurationRevision,
  )
  assert.equal(second.sanitizedOrigin, 'gateway.example.test')
  assert.equal(JSON.stringify(second).includes('second-secret-value'), false)
  assert.equal(JSON.stringify(second).includes('/private'), false)
  assert.equal(JSON.stringify(second).includes('token=two'), false)
})

test('malformed version output continues bounded capability probing without guessing a version', async () => {
  let contractProbes = 0
  const observation = await observeCodexInstallation({
    installation,
    environment: { PATH: process.env.PATH },
    probeVersion: async () => 'Codex changed its version prose',
    probeContract: async () => {
      contractProbes += 1
      return true
    },
    probeSessionDiscoveryContract: async () => false,
    fingerprint: async () => 'e'.repeat(64),
  })

  assert.equal(contractProbes, 1)
  assert.equal(observation.version, undefined)
  assert.equal(observation.compatibility.state, 'limited')
  assert.equal(observation.compatibility.capabilities.execution.effective, true)
  assert.equal(
    observation.compatibility.capabilities.nativeSessionDiscovery.effective,
    false,
  )
})

test('native resume loss is conversation-specific and does not block fresh execution', async () => {
  const observation = await observeCodexInstallation({
    installation,
    probeVersion: async () => 'codex-cli 0.152.0',
    probeRuntimeContract: async () => ({
      execution: true,
      streaming: true,
      nativeResume: false,
      nativeSessionDiscovery: true,
    }),
    probeSessionDiscoveryContract: async () => true,
    fingerprint: async () => '6'.repeat(64),
  })

  assert.equal(observation.compatibility.state, 'limited')
  assert.equal(observation.compatibility.runtimeReadiness, 'limited')
  assert.equal(observation.compatibility.capabilities.execution.effective, true)
  assert.equal(observation.compatibility.capabilities.streaming.effective, true)
  assert.deepEqual(observation.compatibility.capabilities.nativeResume, {
    observed: 'unsupported',
    enabled: true,
    effective: false,
  })
  assert.equal(
    observation.compatibility.capabilities.nativeSessionDiscovery.effective,
    true,
  )
})

test('unknown versions require both exact execution and streaming contracts', async () => {
  const observation = await observeCodexInstallation({
    installation,
    probeVersion: async () => 'codex-cli 99.0.0',
    probeRuntimeContract: async () => ({
      execution: true,
      streaming: false,
      nativeResume: true,
      nativeSessionDiscovery: true,
    }),
    fingerprint: async () => '7'.repeat(64),
  })

  assert.equal(observation.compatibility.state, 'incompatible')
  assert.deepEqual(observation.compatibility.capabilities.execution, {
    observed: 'supported',
    enabled: true,
    effective: false,
  })
  assert.deepEqual(observation.compatibility.capabilities.streaming, {
    observed: 'unsupported',
    enabled: true,
    effective: false,
  })
})

test('unknown versions require method-level proof beyond an initialize handshake', async () => {
  const observation = await observeCodexInstallation({
    installation,
    probeVersion: async () => 'codex-cli 99.0.0',
    probeRuntimeContract: async () => ({
      execution: true,
      streaming: true,
      requiredMethodsObserved: false,
      nativeResume: undefined,
      nativeSessionDiscovery: undefined,
    }),
    fingerprint: async () => '8'.repeat(64),
  })

  assert.equal(observation.compatibility.state, 'incompatible')
  assert.equal(observation.compatibility.runtimeReadiness, 'blocked')
  assert.equal(observation.compatibility.failureCode, 'provider_protocol_error')
  assert.equal(
    observation.compatibility.capabilities.execution.effective,
    false,
  )
  assert.equal(
    observation.compatibility.capabilities.streaming.effective,
    false,
  )
})

test('a shipped Codex version may use its shipped method contract after exact initialize succeeds', async () => {
  const observation = await observeCodexInstallation({
    installation,
    verifiedVersions: ['0.149.1'],
    probeVersion: async () => 'codex-cli 0.149.1',
    probeRuntimeContract: async () => ({
      execution: true,
      streaming: true,
      requiredMethodsObserved: false,
      nativeResume: undefined,
      nativeSessionDiscovery: undefined,
    }),
    fingerprint: async () => '9'.repeat(64),
  })

  assert.equal(observation.compatibility.state, 'limited')
  assert.equal(observation.compatibility.runtimeReadiness, 'limited')
  assert.equal(observation.compatibility.capabilities.execution.effective, true)
  assert.equal(observation.compatibility.capabilities.streaming.effective, true)
  assert.equal(
    observation.compatibility.capabilities.nativeResume.effective,
    false,
  )
})

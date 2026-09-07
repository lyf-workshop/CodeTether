import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

import {
  observeCodexInstallation,
  runBoundedCodexProbe,
} from '../dist/index.js'

const executable = join(tmpdir(), 'codetether-codex-lifecycle-fixture')
const installation = {
  launcherPath: executable,
  executable,
  fileIdentity: 'fixture-codex-lifecycle-installation',
  launcherKind: 'native',
  installMethod: 'unknown',
}

test('Codex compatibility is capability-driven for older and newer unknown versions', async () => {
  for (const version of ['0.1.0', '99.0.0']) {
    const observation = await observeCodexInstallation({
      installation,
      verifiedVersions: ['0.149.1'],
      probeVersion: async () => `codex ${version}`,
      probeContract: async () => true,
      probeSessionDiscoveryContract: async () => true,
      fingerprint: async () => version.padEnd(64, 'a').slice(0, 64),
    })

    assert.equal(observation.version, version)
    assert.equal(observation.compatibility.state, 'compatible_unverified')
    assert.equal(observation.compatibility.runtimeReadiness, 'ready')
  }
})

test('verified Codex versions still revalidate the exact runtime contracts', async () => {
  let contractProbes = 0
  const observation = await observeCodexInstallation({
    installation,
    verifiedVersions: ['0.149.1'],
    probeVersion: async () => 'codex-cli 0.149.1',
    probeContract: async () => {
      contractProbes += 1
      return true
    },
    probeSessionDiscoveryContract: async () => true,
    fingerprint: async () => 'e'.repeat(64),
  })

  assert.equal(observation.compatibility.state, 'verified')
  assert.equal(observation.compatibility.runtimeReadiness, 'ready')
  assert.equal(contractProbes, 1)
})

test('a changed binary claiming the same shipped version is not trusted by version alone', async () => {
  let probeRevision = 'a'
  const observe = async () =>
    await observeCodexInstallation({
      installation,
      verifiedVersions: ['0.149.1'],
      probeVersion: async () => 'codex-cli 0.149.1',
      probeRuntimeContract: async () => ({
        execution: true,
        streaming: probeRevision === 'a',
        nativeResume: true,
        nativeSessionDiscovery: true,
      }),
      probeSessionDiscoveryContract: async () => true,
      fingerprint: async () => probeRevision.repeat(64),
    })

  const before = await observe()
  probeRevision = 'b'
  const after = await observe()

  assert.equal(before.compatibility.state, 'verified')
  assert.equal(after.version, before.version)
  assert.notEqual(after.privateRevision, before.privateRevision)
  assert.equal(after.compatibility.state, 'incompatible')
})

test('malformed versions and missing mandatory contracts are incompatible', async () => {
  const malformed = await observeCodexInstallation({
    installation,
    probeVersion: async () => 'private arbitrary prose 0.149.1',
    probeContract: async () => false,
    fingerprint: async () => 'f'.repeat(64),
  })
  const missingContract = await observeCodexInstallation({
    installation,
    probeVersion: async () => 'codex 99.0.0',
    probeContract: async () => false,
    fingerprint: async () => '1'.repeat(64),
  })

  assert.equal(malformed.version, undefined)
  assert.equal(malformed.compatibility.state, 'incompatible')
  assert.equal(malformed.compatibility.failureCode, 'provider_protocol_error')
  assert.equal(missingContract.compatibility.state, 'incompatible')
  assert.equal(
    missingContract.compatibility.capabilities.execution.effective,
    false,
  )
})

test('Codex process probes enforce elapsed-time and combined-output bounds', async () => {
  await assert.rejects(
    runBoundedCodexProbe({
      executable: process.execPath,
      arguments: ['--eval', 'setInterval(() => undefined, 60_000)'],
      environment: { ...process.env },
      timeoutMs: 100,
    }),
    /timed out/u,
  )

  await assert.rejects(
    runBoundedCodexProbe({
      executable: process.execPath,
      arguments: ['--eval', "process.stdout.write('x'.repeat(1024))"],
      environment: { ...process.env },
      maximumOutputBytes: 64,
    }),
    /exceeded its bound/u,
  )
})

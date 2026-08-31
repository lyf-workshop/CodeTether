import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import {
  beginRemoteMachinePairing,
  connectTrustedRemoteMachine,
  generateMachineTlsIdentity,
  newControllerId,
} from '@codetether/machine-transport'

import { parseNodeCli, runNode } from '../dist/main.js'
import { CodeTetherNodeService } from '../dist/node-service.js'
import { NodeStateStore } from '../dist/state-store.js'

async function controller(controllerId = newControllerId()) {
  return {
    controllerId,
    tls: await generateMachineTlsIdentity('CodeTether Controller'),
  }
}

async function startNode(
  dataDirectory,
  name = 'Development Server',
  authenticatedIdleTimeoutMs,
  port = 0,
) {
  const state = await NodeStateStore.open({
    dataDirectory,
    displayName: name,
    platform: 'Linux',
    architecture: 'x64',
  })
  const service = new CodeTetherNodeService({
    state,
    bindAddress: '127.0.0.1',
    port,
    authenticatedIdleTimeoutMs,
  })
  const address = await service.listen()
  return { state, service, endpoint: { host: '127.0.0.1', port: address.port } }
}

test('real loopback pairing, staged trust recovery, restart, ping, and unpair', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-node-'))
  const localController = await controller()
  let running
  try {
    running = await startNode(directory)
    const originalMachine = running.state.machine
    const mode = await running.service.enablePairing()
    const verification = new Promise((resolve) =>
      running.service.once('pairingVerification', resolve),
    )
    const pending = await beginRemoteMachinePairing({
      endpoint: running.endpoint,
      pairingCode: mode.code,
      controller: localController,
    })
    // This candidate is sufficient to stage trust before the remote commit.
    const staged = pending.trustCandidate
    const nodeVerification = await verification
    assert.equal(nodeVerification.verificationCode, pending.verificationCode)
    assert.equal(staged.machine.machineId, originalMachine.machineId)
    const trusted = await pending.confirm()
    assert.deepEqual(trusted, staged)
    assert.equal(running.state.trustedControllerCount, 1)
    await assert.rejects(
      beginRemoteMachinePairing({
        endpoint: running.endpoint,
        pairingCode: mode.code,
        controller: await controller(),
      }),
      /disabled/u,
    )

    const connected = await connectTrustedRemoteMachine({
      peer: staged,
      controller: localController,
    })
    await connected.ping()
    connected.close()

    const restartPort = running.endpoint.port
    await running.service.close()
    running = await startNode(
      directory,
      'A renamed launch argument',
      undefined,
      restartPort,
    )
    assert.deepEqual(running.state.machine, originalMachine)
    assert.equal(running.state.trustedControllerCount, 1)
    const recovered = await connectTrustedRemoteMachine({
      peer: staged,
      controller: localController,
    })
    const secondConnected = await connectTrustedRemoteMachine({
      peer: staged,
      controller: localController,
    })
    await recovered.ping()
    await secondConnected.ping()
    await recovered.revoke()
    await assert.rejects(secondConnected.ping(), /connection/u)
    assert.equal(running.state.trustedControllerCount, 0)
    await assert.rejects(
      connectTrustedRemoteMachine({
        peer: staged,
        controller: localController,
      }),
      /authentication|disabled/u,
    )

    const replacementController = await controller()
    const replacementMode = await running.service.enablePairing()
    const replacementPending = await beginRemoteMachinePairing({
      endpoint: running.endpoint,
      pairingCode: replacementMode.code,
      controller: replacementController,
    })
    await replacementPending.confirm()
    assert.equal(running.state.trustedControllerCount, 1)
  } finally {
    await running?.service.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

test('wrong codes are rejected while the correct one remains usable until the bound limit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-node-'))
  let running
  try {
    running = await startNode(directory)
    const localController = await controller()
    const mode = await running.service.enablePairing()
    await assert.rejects(
      beginRemoteMachinePairing({
        endpoint: running.endpoint,
        pairingCode: mode.code === '000000' ? '000001' : '000000',
        controller: localController,
      }),
      /invalid|failed/u,
    )
    const pending = await beginRemoteMachinePairing({
      endpoint: running.endpoint,
      pairingCode: mode.code,
      controller: localController,
    })
    await pending.confirm()
    assert.equal(running.state.trustedControllerCount, 1)
    await assert.rejects(running.service.enablePairing(), /already paired/u)
  } finally {
    await running?.service.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

test('concurrent pairing handshakes are bounded to one active attempt', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-node-'))
  let running
  try {
    running = await startNode(directory)
    const mode = await running.service.enablePairing()
    const first = await beginRemoteMachinePairing({
      endpoint: running.endpoint,
      pairingCode: mode.code,
      controller: await controller(),
    })
    await assert.rejects(
      beginRemoteMachinePairing({
        endpoint: running.endpoint,
        pairingCode: mode.code,
        controller: await controller(),
      }),
      /limit|busy|connection failed/u,
    )
    await first.cancel()
    await assert.rejects(
      beginRemoteMachinePairing({
        endpoint: running.endpoint,
        pairingCode: mode.code,
        controller: await controller(),
      }),
      /disabled/u,
    )
  } finally {
    await running?.service.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

test('changed controller key and unavailable Node fail closed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-node-'))
  const localController = await controller()
  let running
  try {
    running = await startNode(directory)
    const mode = await running.service.enablePairing()
    const pending = await beginRemoteMachinePairing({
      endpoint: running.endpoint,
      pairingCode: mode.code,
      controller: localController,
    })
    const trusted = await pending.confirm()
    await assert.rejects(
      connectTrustedRemoteMachine({
        peer: trusted,
        controller: {
          controllerId: localController.controllerId,
          tls: await generateMachineTlsIdentity('CodeTether Controller'),
        },
      }),
      /authentication/u,
    )
    await running.service.close()
    running = undefined
    await assert.rejects(
      connectTrustedRemoteMachine({
        peer: trusted,
        controller: localController,
      }),
      /connection/u,
    )
  } finally {
    await running?.service.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

test('authenticated connection remains usable across repeated idle intervals with heartbeats', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-node-'))
  const localController = await controller()
  let running
  try {
    running = await startNode(directory, 'Heartbeat Node', 50)
    const mode = await running.service.enablePairing()
    const pending = await beginRemoteMachinePairing({
      endpoint: running.endpoint,
      pairingCode: mode.code,
      controller: localController,
    })
    const trusted = await pending.confirm()
    const connected = await connectTrustedRemoteMachine({
      peer: trusted,
      controller: localController,
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    await connected.ping()
    await new Promise((resolve) => setTimeout(resolve, 30))
    await connected.ping()
    connected.close()
  } finally {
    await running?.service.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

test('state refuses partial/corrupt identity and duplicate writers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-node-'))
  let state
  try {
    state = await NodeStateStore.open({
      dataDirectory: directory,
      displayName: 'Node',
      platform: 'Linux',
      architecture: 'arm64',
    })
    await assert.rejects(
      NodeStateStore.open({
        dataDirectory: directory,
        displayName: 'Node',
        platform: 'Linux',
        architecture: 'arm64',
      }),
      /already in use/u,
    )
    await state.close()
    state = undefined
    const identityPath = join(directory, 'node-identity.json')
    const before = await readFile(identityPath, 'utf8')
    await writeFile(identityPath, '{"schemaVersion":1}', 'utf8')
    await assert.rejects(
      NodeStateStore.open({
        dataDirectory: directory,
        displayName: 'Node',
        platform: 'Linux',
        architecture: 'arm64',
      }),
    )
    assert.equal(await readFile(identityPath, 'utf8'), '{"schemaVersion":1}')
    assert.notEqual(before, '{"schemaVersion":1}')
  } finally {
    await state?.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

test('stale lock takeover is fail-closed for every concurrent opener', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-node-'))
  try {
    await writeFile(
      join(directory, 'node.lock'),
      `${JSON.stringify({ pid: 2147483647, nonce: 'a'.repeat(32) })}\n`,
      { encoding: 'utf8', flag: 'wx' },
    )
    const attempts = await Promise.allSettled(
      Array.from(
        { length: 16 },
        async () =>
          await NodeStateStore.open({
            dataDirectory: directory,
            displayName: 'Node',
            platform: 'Linux',
            architecture: 'x64',
          }),
      ),
    )
    assert.equal(
      attempts.every(
        (attempt) =>
          attempt.status === 'rejected' &&
          /stale.*explicit/u.test(String(attempt.reason)),
      ),
      true,
    )
    assert.match(
      await readFile(join(directory, 'node.lock'), 'utf8'),
      /2147483647/u,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a failed network bind releases the exact Node writer lock', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-node-'))
  const blocker = createServer()
  let reopened
  try {
    await new Promise((resolve, reject) => {
      blocker.once('error', reject)
      blocker.listen({ host: '127.0.0.1', port: 0 }, resolve)
    })
    const address = blocker.address()
    assert.ok(address !== null && typeof address !== 'string')
    await assert.rejects(
      runNode({
        bindAddress: '127.0.0.1',
        port: address.port,
        dataDirectory: directory,
        displayName: 'Bind Failure Node',
        pairing: false,
        json: true,
      }),
      (error) => error instanceof Error && 'code' in error,
    )
    reopened = await NodeStateStore.open({
      dataDirectory: directory,
      displayName: 'Bind Failure Node',
      platform: 'Linux',
      architecture: 'x64',
    })
  } finally {
    await reopened?.close().catch(() => undefined)
    await new Promise((resolve) => blocker.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
})

test('intentional state deletion creates a new Machine and cryptographic identity', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-node-'))
  let state
  try {
    state = await NodeStateStore.open({
      dataDirectory: directory,
      displayName: 'Node',
      platform: 'Linux',
      architecture: 'arm64',
    })
    const originalMachineId = state.machine.machineId
    const originalNodeId = state.machine.nodeId
    const originalFingerprint = state.identity.publicKeyFingerprint
    await state.close()
    state = undefined
    await rm(directory, { recursive: true, force: true })

    state = await NodeStateStore.open({
      dataDirectory: directory,
      displayName: 'Node',
      platform: 'Linux',
      architecture: 'arm64',
    })
    assert.notEqual(state.machine.machineId, originalMachineId)
    assert.notEqual(state.machine.nodeId, originalNodeId)
    assert.notEqual(state.identity.publicKeyFingerprint, originalFingerprint)
  } finally {
    await state?.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

test('CLI supports explicit LAN bind, port, absolute state, and pairing mode', () => {
  const dataDirectory = resolve('test-node-state')
  assert.deepEqual(
    parseNodeCli([
      '--bind',
      '0.0.0.0',
      '--port',
      '4319',
      '--data-dir',
      dataDirectory,
      '--name',
      '开发服务器 🚀',
      '--pair',
      '--json',
    ]),
    {
      bindAddress: '0.0.0.0',
      port: 4319,
      dataDirectory,
      displayName: '开发服务器 🚀',
      pairing: true,
      json: true,
    },
  )
})

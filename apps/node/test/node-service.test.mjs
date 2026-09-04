import assert from 'node:assert/strict'
import { once } from 'node:events'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import {
  beginRemoteMachinePairing,
  connectMachineTls,
  connectTrustedRemoteMachine,
  generateMachineTlsIdentity,
  newControllerId,
} from '@codetether/machine-transport'

import { parseNodeCli, runNode } from '../dist/main.js'
import { CodeTetherNodeService } from '../dist/node-service.js'
import { validateProjectLocationPath } from '../dist/project-location-validation.js'
import {
  RemoteProviderDetector,
  supportsRemoteCodexExecutionPlatform,
} from '../dist/provider-discovery.js'
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
  providerDetector,
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
    providerDetector,
  })
  const address = await service.listen()
  return { state, service, endpoint: { host: '127.0.0.1', port: address.port } }
}

test('trusted Provider discovery is identity-bound, deduplicated, and non-executable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-node-'))
  const localController = await controller()
  let running
  let connected
  const providerDetector = new RemoteProviderDetector({
    probes: [
      {
        provider: 'codex',
        displayName: 'Codex',
        executable: process.execPath,
        arguments: [
          '-e',
          "setTimeout(() => process.stdout.write('codex-cli 0.149.1'), 30)",
        ],
        parseVersion: (output) => /^codex-cli (\S+)$/u.exec(output)?.[1],
        isSupportedVersion: () => true,
      },
      {
        provider: 'claude-code',
        displayName: 'Claude Code',
        executable: process.execPath,
        arguments: [
          '-e',
          "setTimeout(() => process.stdout.write('2.1.251 (Claude Code)'), 30)",
        ],
        parseVersion: (output) => /^(\S+) \(Claude Code\)$/u.exec(output)?.[1],
        isSupportedVersion: (version) => version === '2.1.251',
      },
    ],
  })
  try {
    running = await startNode(
      directory,
      'Discovery Node',
      undefined,
      0,
      providerDetector,
    )
    const mode = await running.service.enablePairing()
    const pending = await beginRemoteMachinePairing({
      endpoint: running.endpoint,
      pairingCode: mode.code,
      controller: localController,
    })
    const trusted = await pending.confirm()
    connected = await connectTrustedRemoteMachine({
      peer: trusted,
      controller: localController,
    })
    const first = connected.discoverProviders()
    const duplicate = connected.discoverProviders()
    assert.equal(first, duplicate)
    const discovery = await first
    assert.deepEqual(
      discovery.providers.map(({ provider, availability }) => ({
        provider,
        availability,
      })),
      [
        { provider: 'codex', availability: 'available' },
        { provider: 'claude-code', availability: 'available' },
      ],
    )
    assert.deepEqual(
      Object.entries(discovery.providers[0].capabilities)
        .filter(([, enabled]) => enabled)
        .map(([capability]) => capability)
        .sort(),
      supportsRemoteCodexExecutionPlatform() ? ['resume', 'streaming'] : [],
    )
    assert.equal(
      Object.values(discovery.providers[1].capabilities).some(Boolean),
      false,
    )

    connected.machine.nodeId = 'node_wrong_identity'
    await assert.rejects(
      connected.discoverProviders(),
      (error) =>
        error.code === 'identity_mismatch' && error.peerAuthenticated === true,
    )
  } finally {
    connected?.close()
    await running?.service.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

test('Node disconnect during Provider discovery cancels exact owned probes boundedly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-node-'))
  const localController = await controller()
  let running
  let connected
  const hangingProbe = (provider) => ({
    provider,
    displayName: provider === 'codex' ? 'Codex' : 'Claude Code',
    executable: process.execPath,
    arguments: ['-e', 'setInterval(() => {}, 1000)'],
    parseVersion: () => undefined,
    isSupportedVersion: () => false,
  })
  const providerDetector = new RemoteProviderDetector({
    probes: [hangingProbe('codex'), hangingProbe('claude-code')],
    timeoutMs: 5_000,
  })
  try {
    running = await startNode(
      directory,
      'Disconnect Discovery Node',
      undefined,
      0,
      providerDetector,
    )
    const mode = await running.service.enablePairing()
    const pending = await beginRemoteMachinePairing({
      endpoint: running.endpoint,
      pairingCode: mode.code,
      controller: localController,
    })
    const trusted = await pending.confirm()
    connected = await connectTrustedRemoteMachine({
      peer: trusted,
      controller: localController,
    })
    const discovery = connected.discoverProviders()
    const disconnected = assert.rejects(discovery, /connection/u)
    await new Promise((resolve) => setTimeout(resolve, 30))
    const startedAt = performance.now()
    await running.service.close()
    running = undefined
    await disconnected
    assert.ok(performance.now() - startedAt < 2_000)
  } finally {
    connected?.close()
    await running?.service.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

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

test('trust revocation closes a pinned TLS peer stalled before Machine hello', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-node-'))
  const localController = await controller()
  let running
  let revoker
  let stalledTls
  try {
    running = await startNode(directory)
    const mode = await running.service.enablePairing()
    const pending = await beginRemoteMachinePairing({
      endpoint: running.endpoint,
      pairingCode: mode.code,
      controller: localController,
    })
    const trusted = await pending.confirm()

    stalledTls = await connectMachineTls({
      ...running.endpoint,
      identity: localController.tls,
      expectedPeerFingerprint: trusted.nodeFingerprint,
    })
    const stalledClosed = once(stalledTls.socket, 'close', {
      signal: AbortSignal.timeout(2_000),
    })
    // Yield after TLS so the Node is blocked on the deliberately withheld
    // Machine hello when another authenticated socket revokes durable trust.
    await new Promise((resolve) => setTimeout(resolve, 30))

    revoker = await connectTrustedRemoteMachine({
      peer: trusted,
      controller: localController,
    })
    await revoker.revoke()
    await stalledClosed

    assert.equal(stalledTls.socket.destroyed, true)
    assert.equal(running.state.trustedControllerCount, 0)
    await assert.rejects(
      connectTrustedRemoteMachine({
        peer: trusted,
        controller: localController,
      }),
      /authentication|disabled/u,
    )
  } finally {
    stalledTls?.socket.destroy()
    revoker?.close()
    await running?.service.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

test('trusted Project Location validation canonicalizes only existing directories', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-node-'))
  const workspace = join(directory, '项目 with spaces')
  const linkedWorkspace = join(directory, 'workspace-link')
  const file = join(directory, 'not-a-directory.txt')
  const localController = await controller()
  let running
  let connected
  try {
    await mkdir(join(workspace, 'nested'), { recursive: true })
    await writeFile(file, 'not returned by the Node', 'utf8')
    await symlink(
      workspace,
      linkedWorkspace,
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    running = await startNode(join(directory, 'node-state'))
    const mode = await running.service.enablePairing()
    const pending = await beginRemoteMachinePairing({
      endpoint: running.endpoint,
      pairingCode: mode.code,
      controller: localController,
    })
    const trusted = await pending.confirm()
    connected = await connectTrustedRemoteMachine({
      peer: trusted,
      controller: localController,
    })

    const expectedCanonicalPath = await realpath(workspace)
    assert.deepEqual(await connected.validateProjectLocation(workspace), {
      canonicalPath: expectedCanonicalPath,
      basename: '项目 with spaces',
      exists: true,
      directory: true,
    })
    assert.deepEqual(await connected.validateProjectLocation(linkedWorkspace), {
      canonicalPath: expectedCanonicalPath,
      basename: '项目 with spaces',
      exists: true,
      directory: true,
    })
    await assert.rejects(
      connected.validateProjectLocation(join(directory, 'missing')),
      (error) =>
        error.code === 'project_location_missing' &&
        error.peerAuthenticated === true,
    )
    await assert.rejects(
      connected.validateProjectLocation(file),
      (error) =>
        error.code === 'project_location_not_directory' &&
        error.peerAuthenticated === true,
    )
    await assert.rejects(
      connected.validateProjectLocation('relative/project'),
      (error) => error.code === 'project_location_path_invalid',
    )
    await assert.rejects(
      connected.validateProjectLocation(`/${'界'.repeat(1_400)}`),
      (error) => error.code === 'project_location_path_invalid',
    )

    connected.machine.nodeId = 'node_wrong_identity'
    await assert.rejects(
      connected.validateProjectLocation(workspace),
      (error) =>
        error.code === 'identity_mismatch' && error.peerAuthenticated === true,
    )
  } finally {
    connected?.close()
    await running?.service.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

test('Project Location validation maps inaccessible paths without leaking filesystem errors', async () => {
  const denied = Object.assign(new Error('secret operating-system detail'), {
    code: 'EACCES',
  })
  await assert.rejects(
    validateProjectLocationPath(resolve('unreadable'), {
      realpath: async () => {
        throw denied
      },
      stat: async () => {
        throw new Error('must not stat after failed realpath')
      },
    }),
    (error) =>
      error.code === 'project_location_inaccessible' &&
      !error.message.includes('secret'),
  )
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

test('one concurrent opener atomically recovers a dead Node lock', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-node-'))
  let recovered
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
    const fulfilled = attempts.filter(
      (attempt) => attempt.status === 'fulfilled',
    )
    const rejected = attempts.filter((attempt) => attempt.status === 'rejected')
    assert.equal(fulfilled.length, 1)
    assert.equal(rejected.length, 15)
    assert.equal(
      rejected.every((attempt) =>
        /already in use/u.test(String(attempt.reason)),
      ),
      true,
    )
    recovered = fulfilled[0].value
    assert.equal(recovered.machine.machineId.startsWith('machine_'), true)
    assert.match(
      await readFile(join(directory, 'node.lock'), 'utf8'),
      /"pid":/u,
    )
  } finally {
    await recovered?.close().catch(() => undefined)
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

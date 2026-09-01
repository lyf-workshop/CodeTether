import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import test from 'node:test'

import { z } from 'zod'

import {
  FramedMachineConnection,
  beginRemoteMachinePairing,
  connectTrustedRemoteMachine,
  connectMachineTls,
  generateMachineTlsIdentity,
  machineProtocolVersion,
  machineTransportLimits,
  newControllerId,
  newMachineNonce,
  openRemoteCodexSession,
} from '@codetether/machine-transport'

import { CodeTetherNodeService } from '../dist/node-service.js'
import {
  RemoteProviderDetector,
  isRemoteCodexExecutionVersion,
} from '../dist/provider-discovery.js'
import {
  RemoteCodexRunnerPool,
  validateRemoteCodexTextNotification,
} from '../dist/remote-codex-runner.js'
import { NodeStateStore } from '../dist/state-store.js'

function sessionRequest(rootPath, conversationId = 'conv_remote_a') {
  return {
    type: 'codex.session.open',
    protocolVersion: 1,
    requestId: 'S'.repeat(43),
    expectedMachineId: 'machine_remote_a',
    expectedNodeId: 'node_remote_a',
    conversationId,
    projectId: 'proj_remote_a',
    rootPath,
  }
}

function turnRequest(providerThreadId, actionId = 'act_remote_a') {
  return {
    type: 'codex.turn.start',
    protocolVersion: 1,
    actionId,
    conversationId: 'conv_remote_a',
    turnId: 'turn_remote_a',
    providerThreadId,
    prompt: 'Return a bounded marker.',
  }
}

function fakeClientFactory(options = {}) {
  let callbacks
  let launches = 0
  let starts = 0
  let resumes = 0
  let shutdowns = 0
  const factory = async (value) => {
    launches += 1
    callbacks = value
    options.onFactoryOwned?.()
    await options.factoryGate
    return {
      startRemoteTextThread: async ({ cwd }) => ({
        thread: { id: 'provider-thread-a', cwd },
        model: 'test',
        modelProvider: 'test',
        cwd,
      }),
      resumeRemoteTextThread: async ({ threadId, cwd }) => {
        resumes += 1
        return {
          thread: { id: threadId, cwd },
          model: 'test',
          modelProvider: 'test',
          cwd,
        }
      },
      startRemoteTextTurn: async () => {
        starts += 1
        callbacks.onEvent({
          type: 'turn.started',
          provider: 'codex',
          timestamp: new Date().toISOString(),
          threadId: 'provider-thread-a',
          turnId: 'provider-turn-a',
        })
        return { turn: { id: 'provider-turn-a', status: 'inProgress' } }
      },
      waitForTurn: async () => ({}),
      shutdown: async () => {
        shutdowns += 1
        options.onShutdown?.()
        await options.shutdownGate
      },
    }
  }
  return {
    factory,
    emit: (event) => callbacks.onEvent(event),
    fail: (error) => callbacks.onError(error),
    get starts() {
      return starts
    },
    get launches() {
      return launches
    },
    get resumes() {
      return resumes
    },
    get shutdowns() {
      return shutdowns
    },
  }
}

function deferred() {
  let resolve
  const promise = new Promise((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

function executionDetector(options = {}) {
  const codexExecutable = options.codexExecutable ?? process.execPath
  const codexScript =
    options.codexScript ?? "process.stdout.write('codex-cli 0.149.1')"
  return new RemoteProviderDetector({
    platform: 'linux',
    probes: [
      {
        provider: 'codex',
        displayName: 'Codex',
        executable: codexExecutable,
        arguments: ['-e', codexScript],
        parseVersion: (output) => /^codex-cli (\S+)$/u.exec(output)?.[1],
        isSupportedVersion: isRemoteCodexExecutionVersion,
      },
      {
        provider: 'claude-code',
        displayName: 'Claude Code',
        executable: process.execPath,
        arguments: ['-e', "process.stdout.write('2.1.251 (Claude Code)')"],
        parseVersion: (output) => /^(\S+) \(Claude Code\)$/u.exec(output)?.[1],
        isSupportedVersion: (version) => version === '2.1.251',
      },
    ],
  })
}

async function pairService(service, controller) {
  const address = await service.listen()
  const pairing = await service.enablePairing()
  const pending = await beginRemoteMachinePairing({
    endpoint: { host: '127.0.0.1', port: address.port },
    pairingCode: pairing.code,
    controller,
  })
  return await pending.confirm()
}

function providerEvent(type, fields = {}) {
  return {
    type,
    provider: 'codex',
    timestamp: new Date().toISOString(),
    threadId: 'provider-thread-a',
    turnId: 'provider-turn-a',
    ...fields,
  }
}

test('runner owns one idempotent text Turn and chunks bounded output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-runner-'))
  const fake = fakeClientFactory()
  const pool = new RemoteCodexRunnerPool({
    codexHome: directory,
    clientFactory: fake.factory,
  })
  try {
    const runner = await pool.open(sessionRequest(directory))
    const request = turnRequest(runner.providerThreadId)
    const turn = await runner.startTurn(request)
    assert.equal(await runner.startTurn(request), turn)
    assert.equal(fake.starts, 1)

    fake.emit(
      providerEvent('message.delta', {
        itemId: 'item_remote_a',
        delta: '界'.repeat(4_000),
      }),
    )
    fake.emit(
      providerEvent('message.completed', {
        itemId: 'item_remote_a',
        message: 'private assembled message',
      }),
    )
    fake.emit(providerEvent('turn.completed'))

    const events = []
    for await (const event of turn.events()) events.push(event)
    const deltas = events.filter(({ type }) => type === 'message.delta')
    assert.ok(deltas.length > 1)
    assert.equal(
      deltas.every(({ text }) => Buffer.byteLength(text, 'utf8') <= 8 * 1024),
      true,
    )
    assert.deepEqual(events.at(-1), { type: 'turn.completed' })
    await assert.rejects(
      runner.startTurn(request),
      (error) => error.code === 'duplicate_action_conflict',
    )
    await pool.release(runner)
    assert.equal(pool.activeCount, 0)
    assert.equal(fake.shutdowns, 1)
  } finally {
    await pool.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('runner rejects Tool events and closes only its exact client', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-runner-'))
  const fake = fakeClientFactory()
  const pool = new RemoteCodexRunnerPool({
    codexHome: directory,
    clientFactory: fake.factory,
  })
  try {
    const runner = await pool.open(sessionRequest(directory))
    const turn = await runner.startTurn(turnRequest(runner.providerThreadId))
    fake.emit(
      providerEvent('tool.started', {
        itemId: 'item_remote_tool',
        name: 'Shell',
        kind: 'shell',
        command: 'cat /etc/passwd',
      }),
    )
    const events = []
    for await (const event of turn.events()) events.push(event)
    assert.deepEqual(events, [
      {
        type: 'turn.failed',
        code: 'remote_policy_violation',
        message: 'Remote Codex emitted an unsupported operation',
      },
    ])
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(fake.shutdowns, 1)
  } finally {
    await pool.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('raw notification policy admits only text lifecycle and private reasoning', () => {
  const correlation = {
    threadId: 'provider-thread-a',
    turnId: 'provider-turn-a',
    itemId: 'provider-item-a',
  }
  assert.doesNotThrow(() =>
    validateRemoteCodexTextNotification({
      method: 'item/agentMessage/delta',
      params: { ...correlation, delta: 'safe text' },
    }),
  )
  assert.doesNotThrow(() =>
    validateRemoteCodexTextNotification({
      method: 'remoteControl/status/changed',
      params: {
        environmentId: null,
        installationId: 'installation-a',
        serverName: 'codex',
        status: 'disabled',
      },
    }),
  )
  assert.doesNotThrow(() =>
    validateRemoteCodexTextNotification({
      method: 'configWarning',
      params: {
        summary: 'private warning',
        details: null,
      },
    }),
  )
  assert.doesNotThrow(() =>
    validateRemoteCodexTextNotification({
      method: 'configWarning',
      params: {
        summary: 'private warning',
        details: 'private details',
        path: '/private/config.toml',
        range: {
          start: { line: 1, column: 2 },
          end: { line: 1, column: 3 },
        },
      },
    }),
  )
  assert.doesNotThrow(() =>
    validateRemoteCodexTextNotification({
      method: 'deprecationNotice',
      params: { details: 'private details', summary: 'private summary' },
    }),
  )
  assert.doesNotThrow(() =>
    validateRemoteCodexTextNotification({
      method: 'warning',
      params: { message: 'private warning', threadId: correlation.threadId },
    }),
  )
  for (const [method, timestampKey] of [
    ['item/started', 'startedAtMs'],
    ['item/completed', 'completedAtMs'],
  ]) {
    assert.doesNotThrow(() =>
      validateRemoteCodexTextNotification({
        method,
        params: {
          threadId: correlation.threadId,
          turnId: correlation.turnId,
          [timestampKey]: 1_777_777_777_777,
          item: {
            id: correlation.itemId,
            type: 'userMessage',
            clientId: null,
            content: [
              { type: 'text', text: 'private prompt', text_elements: [] },
            ],
          },
        },
      }),
    )
  }
  assert.doesNotThrow(() =>
    validateRemoteCodexTextNotification({
      method: 'item/reasoning/textDelta',
      params: { ...correlation, delta: 'private reasoning' },
    }),
  )
  assert.doesNotThrow(() =>
    validateRemoteCodexTextNotification({
      method: 'item/completed',
      params: {
        threadId: correlation.threadId,
        turnId: correlation.turnId,
        item: {
          id: correlation.itemId,
          type: 'reasoning',
          summary: ['private reasoning'],
        },
      },
    }),
  )
  assert.doesNotThrow(() =>
    validateRemoteCodexTextNotification({
      method: 'item/completed',
      params: {
        threadId: correlation.threadId,
        turnId: correlation.turnId,
        item: {
          id: correlation.itemId,
          type: 'agentMessage',
          text: 'safe text',
        },
      },
    }),
  )

  for (const notification of [
    {
      method: 'remoteControl/status/changed',
      params: {
        environmentId: null,
        installationId: 'installation-a',
        serverName: 'codex',
        status: 'disabled',
        unexpected: true,
      },
    },
    {
      method: 'configWarning',
      params: {
        summary: 'warning',
        unexpected: true,
      },
    },
    {
      method: 'configWarning',
      params: {
        summary: 'warning',
        range: {
          start: { line: -1, column: 2 },
          end: { line: 1, column: 3 },
        },
      },
    },
    {
      method: 'deprecationNotice',
      params: { details: 'x'.repeat(4 * 1024 + 1), summary: 'summary' },
    },
    {
      method: 'warning',
      params: { message: 'warning', threadId: '' },
    },
    {
      method: 'item/completed',
      params: {
        threadId: correlation.threadId,
        turnId: correlation.turnId,
        completedAtMs: 1_777_777_777_777,
        item: {
          id: correlation.itemId,
          type: 'userMessage',
          clientId: null,
          content: [
            {
              type: 'text',
              text: 'x'.repeat(
                machineTransportLimits.maximumRemoteCodexPromptBytes + 1,
              ),
              text_elements: [],
            },
          ],
        },
      },
    },
    {
      method: 'item/started',
      params: {
        threadId: correlation.threadId,
        turnId: correlation.turnId,
        startedAtMs: 1_777_777_777_777,
        item: {
          id: correlation.itemId,
          type: 'userMessage',
          clientId: null,
          content: [
            {
              type: 'text',
              text: 'private prompt',
              text_elements: [{ unexpected: true }],
            },
          ],
        },
      },
    },
    {
      method: 'item/completed',
      params: {
        threadId: correlation.threadId,
        turnId: correlation.turnId,
        item: {
          id: correlation.itemId,
          type: 'commandExecution',
          command: 'cat /etc/passwd',
        },
      },
    },
    {
      method: 'item/fileChange/patchUpdated',
      params: correlation,
    },
    {
      method: 'mcpServer/status/updated',
      params: correlation,
    },
    { method: 'unknown/provider/event', params: {} },
  ]) {
    assert.throws(
      () => validateRemoteCodexTextNotification(notification),
      (error) => error.code === 'remote_policy_violation',
    )
  }
})

test('raw policy failure releases the exact idle child and pool slot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-raw-policy-'))
  const fake = fakeClientFactory()
  const pool = new RemoteCodexRunnerPool({
    codexHome: directory,
    clientFactory: fake.factory,
  })
  try {
    await pool.open(sessionRequest(directory))
    let violation
    try {
      validateRemoteCodexTextNotification({
        method: 'mcpServer/status/updated',
        params: { server: 'untrusted' },
      })
    } catch (error) {
      violation = error
    }
    assert.equal(violation?.code, 'remote_policy_violation')
    fake.fail(violation)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(pool.activeCount, 0)
    assert.equal(fake.shutdowns, 1)
  } finally {
    await pool.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('every Turn revalidates the exact registered root before Prompt send', async () => {
  for (const scenario of ['missing', 'non-directory', 'symlink-change']) {
    const directory = await mkdtemp(join(tmpdir(), 'codetether-revalidate-'))
    const project = join(directory, 'project')
    const moved = join(directory, 'moved-project')
    const replacement = join(directory, 'replacement-project')
    const codexHome = join(directory, 'codex-home')
    await mkdir(project)
    await mkdir(codexHome)
    const fake = fakeClientFactory()
    const pool = new RemoteCodexRunnerPool({
      codexHome,
      clientFactory: fake.factory,
    })
    try {
      const runner = await pool.open(sessionRequest(project))
      if (scenario === 'missing') {
        await rm(project, { recursive: true })
      } else if (scenario === 'non-directory') {
        await rm(project, { recursive: true })
        await writeFile(project, 'not a directory', 'utf8')
      } else {
        await rename(project, moved)
        await mkdir(replacement)
        await symlink(
          replacement,
          project,
          process.platform === 'win32' ? 'junction' : 'dir',
        )
      }
      await assert.rejects(
        runner.startTurn(turnRequest(runner.providerThreadId)),
        (error) =>
          error.code ===
          (scenario === 'missing'
            ? 'project_location_missing'
            : scenario === 'non-directory'
              ? 'project_location_not_directory'
              : 'project_location_path_invalid'),
      )
      assert.equal(fake.starts, 0)
      await pool.release(runner)
    } finally {
      await pool.close()
      await rm(directory, { recursive: true, force: true })
    }
  }
})

test('runner enforces canonical roots and the global session cap', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-runner-'))
  const nested = join(directory, 'nested')
  await mkdir(nested)
  const fake = fakeClientFactory()
  const pool = new RemoteCodexRunnerPool({
    codexHome: directory,
    clientFactory: fake.factory,
    maximumSessions: 1,
  })
  try {
    await assert.rejects(
      pool.open(sessionRequest(`${nested}${sep}..`)),
      (error) => error.code === 'project_location_path_invalid',
    )
    const first = await pool.open(sessionRequest(directory))
    await assert.rejects(
      pool.open(sessionRequest(directory, 'conv_remote_b')),
      (error) => error.code === 'busy',
    )
    await pool.release(first)
  } finally {
    await pool.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('pool close waits for exact cleanup of an in-flight owned runner opening', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-opening-close-'))
  const factoryOwned = deferred()
  const releaseFactory = deferred()
  const fake = fakeClientFactory({
    onFactoryOwned: factoryOwned.resolve,
    factoryGate: releaseFactory.promise,
  })
  const pool = new RemoteCodexRunnerPool({
    codexHome: directory,
    clientFactory: fake.factory,
  })
  try {
    const opening = pool.open(sessionRequest(directory))
    const rejectedOpening = assert.rejects(
      opening,
      (error) => error.code === 'remote_execution_unavailable',
    )
    await factoryOwned.promise

    let closeSettled = false
    const closing = pool.close().then(() => {
      closeSettled = true
    })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(closeSettled, false)

    releaseFactory.resolve()
    await rejectedOpening
    await closing
    assert.equal(closeSettled, true)
    assert.equal(fake.launches, 1)
    assert.equal(fake.shutdowns, 1)
    assert.equal(pool.activeCount, 0)
  } finally {
    releaseFactory.resolve()
    await pool.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('Node service close waits for fatal exact runner cleanup before returning', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-fatal-close-'))
  const shutdownStarted = deferred()
  const releaseShutdown = deferred()
  const fake = fakeClientFactory({
    onShutdown: shutdownStarted.resolve,
    shutdownGate: releaseShutdown.promise,
  })
  const pool = new RemoteCodexRunnerPool({
    codexHome: directory,
    clientFactory: fake.factory,
  })
  const state = await NodeStateStore.open({
    dataDirectory: join(directory, 'node-state'),
    displayName: 'Fatal Cleanup Node',
    platform: 'Linux',
    architecture: 'x64',
  })
  const service = new CodeTetherNodeService({
    state,
    providerDetector: executionDetector(),
    remoteCodexRunners: pool,
  })
  try {
    await pool.open(sessionRequest(directory))
    fake.fail(new Error('controlled fatal Provider failure'))
    await shutdownStarted.promise

    let closeSettled = false
    const closing = service.close().then(() => {
      closeSettled = true
    })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(closeSettled, false)

    releaseShutdown.resolve()
    await closing
    assert.equal(closeSettled, true)
    assert.equal(fake.shutdowns, 1)
    assert.equal(pool.activeCount, 0)
  } finally {
    releaseShutdown.resolve()
    await service.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

test('released execution connections reopen by exact native session identity', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-resume-'))
  const fake = fakeClientFactory()
  const pool = new RemoteCodexRunnerPool({
    codexHome: directory,
    clientFactory: fake.factory,
  })
  try {
    const created = await pool.open(sessionRequest(directory))
    const providerThreadId = created.providerThreadId
    await pool.release(created)
    assert.equal(pool.activeCount, 0)

    const resumed = await pool.open({
      ...sessionRequest(directory),
      providerThreadId,
    })
    assert.equal(resumed.providerThreadId, providerThreadId)
    assert.equal(resumed.resumed, true)
    assert.equal(fake.resumes, 1)
    await pool.release(resumed)
    assert.equal(fake.shutdowns, 2)
  } finally {
    await pool.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('real authenticated transport streams one fake-owned remote Codex Turn', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-node-'))
  const project = join(directory, 'project')
  const codexHome = join(directory, 'codex-home')
  await mkdir(project)
  await mkdir(codexHome)
  const fake = fakeClientFactory()
  const runners = new RemoteCodexRunnerPool({
    codexHome,
    clientFactory: async (callbacks) => {
      const client = await fake.factory(callbacks)
      const start = client.startRemoteTextTurn
      client.startRemoteTextTurn = async (options) => {
        const result = await start(options)
        queueMicrotask(() => {
          fake.emit(
            providerEvent('message.delta', {
              itemId: 'item_remote_a',
              delta: 'REAL TRANSPORT MARKER',
            }),
          )
          fake.emit(
            providerEvent('message.completed', {
              itemId: 'item_remote_a',
              message: 'REAL TRANSPORT MARKER',
            }),
          )
          fake.emit(providerEvent('turn.completed'))
        })
        return result
      }
      return client
    },
  })
  const state = await NodeStateStore.open({
    dataDirectory: join(directory, 'node-state'),
    displayName: 'Remote Codex Test Node',
    platform: 'Linux',
    architecture: 'x64',
  })
  const service = new CodeTetherNodeService({
    state,
    bindAddress: '127.0.0.1',
    port: 0,
    providerDetector: executionDetector(),
    remoteCodexRunners: runners,
  })
  const controller = {
    controllerId: newControllerId(),
    tls: await generateMachineTlsIdentity('Remote Codex Test Controller'),
  }
  let session
  try {
    const address = await service.listen()
    const pairing = await service.enablePairing()
    const pending = await beginRemoteMachinePairing({
      endpoint: { host: '127.0.0.1', port: address.port },
      pairingCode: pairing.code,
      controller,
    })
    const peer = await pending.confirm()
    session = await openRemoteCodexSession({
      peer,
      controller,
      conversationId: 'conv_remote_a',
      projectId: 'proj_remote_a',
      rootPath: project,
    })
    assert.equal(session.resumed, false)
    const turn = await session.startTurn({
      actionId: 'act_remote_a',
      turnId: 'turn_remote_a',
      prompt: 'Return the marker.',
    })
    const events = []
    for await (const event of turn.events()) events.push(event.event)
    assert.equal(events[0].text, 'REAL TRANSPORT MARKER')
    assert.deepEqual(events.at(-1), { type: 'turn.completed' })
    await session.close()
    session = undefined
    assert.equal(runners.activeCount, 0)
    assert.equal(fake.launches, 1)
    assert.equal(fake.starts, 1)
  } finally {
    await session?.close().catch(() => undefined)
    await service.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

test('execution admission re-probes and refuses Codex that disappeared after positive discovery', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-admission-'))
  const project = join(directory, 'project')
  const codexHome = join(directory, 'codex-home')
  const codexExecutable = join(
    directory,
    process.platform === 'win32' ? 'codex-probe.exe' : 'codex-probe',
  )
  await mkdir(project)
  await mkdir(codexHome)
  await symlink(
    process.execPath,
    codexExecutable,
    process.platform === 'win32' ? 'file' : undefined,
  )
  const fake = fakeClientFactory()
  const runners = new RemoteCodexRunnerPool({
    codexHome,
    clientFactory: fake.factory,
  })
  const state = await NodeStateStore.open({
    dataDirectory: join(directory, 'node-state'),
    displayName: 'Execution Admission Node',
    platform: 'Linux',
    architecture: 'x64',
  })
  const service = new CodeTetherNodeService({
    state,
    bindAddress: '127.0.0.1',
    port: 0,
    providerDetector: executionDetector({ codexExecutable }),
    remoteCodexRunners: runners,
  })
  const controller = {
    controllerId: newControllerId(),
    tls: await generateMachineTlsIdentity('Execution Admission Controller'),
  }
  let connected
  try {
    const peer = await pairService(service, controller)
    connected = await connectTrustedRemoteMachine({ peer, controller })
    const [codex] = (await connected.discoverProviders()).providers
    assert.equal(codex.availability, 'available')
    assert.equal(codex.capabilities.streaming, true)
    assert.equal(codex.capabilities.resume, true)
    connected.close()
    connected = undefined

    await rm(codexExecutable)
    await assert.rejects(
      openRemoteCodexSession({
        peer,
        controller,
        conversationId: 'conv_remote_a',
        projectId: 'proj_remote_a',
        rootPath: project,
      }),
      (error) =>
        error.code === 'remote_execution_unavailable' &&
        error.peerAuthenticated === true,
    )
    assert.equal(fake.launches, 0)
    assert.equal(runners.activeCount, 0)
  } finally {
    connected?.close()
    await service.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

test('execution admission keeps an untested installed Codex discoverable but never launches it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-admission-'))
  const project = join(directory, 'project')
  const codexHome = join(directory, 'codex-home')
  await mkdir(project)
  await mkdir(codexHome)
  const fake = fakeClientFactory()
  const runners = new RemoteCodexRunnerPool({
    codexHome,
    clientFactory: fake.factory,
  })
  const state = await NodeStateStore.open({
    dataDirectory: join(directory, 'node-state'),
    displayName: 'Untested Codex Node',
    platform: 'Linux',
    architecture: 'x64',
  })
  const service = new CodeTetherNodeService({
    state,
    bindAddress: '127.0.0.1',
    port: 0,
    providerDetector: executionDetector({
      codexScript: "process.stdout.write('codex-cli 0.151.0')",
    }),
    remoteCodexRunners: runners,
  })
  const controller = {
    controllerId: newControllerId(),
    tls: await generateMachineTlsIdentity('Untested Codex Controller'),
  }
  let connected
  try {
    const peer = await pairService(service, controller)
    connected = await connectTrustedRemoteMachine({ peer, controller })
    const [codex] = (await connected.discoverProviders()).providers
    assert.equal(codex.availability, 'available')
    assert.equal(codex.version, '0.151.0')
    assert.equal(Object.values(codex.capabilities).some(Boolean), false)
    connected.close()
    connected = undefined

    await assert.rejects(
      openRemoteCodexSession({
        peer,
        controller,
        conversationId: 'conv_remote_a',
        projectId: 'proj_remote_a',
        rootPath: project,
      }),
      (error) =>
        error.code === 'remote_execution_unavailable' &&
        error.peerAuthenticated === true,
    )
    assert.equal(fake.launches, 0)
    assert.equal(runners.activeCount, 0)
  } finally {
    connected?.close()
    await service.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

test('duplicate control during streaming does not consume the pending event', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-duplicate-'))
  const project = join(directory, 'project')
  const codexHome = join(directory, 'codex-home')
  await mkdir(project)
  await mkdir(codexHome)
  const fake = fakeClientFactory()
  const runners = new RemoteCodexRunnerPool({
    codexHome,
    clientFactory: async (callbacks) => {
      const client = await fake.factory(callbacks)
      const start = client.startRemoteTextTurn
      client.startRemoteTextTurn = async (options) => {
        const result = await start(options)
        setTimeout(() => {
          fake.emit(
            providerEvent('message.delta', {
              itemId: 'item_remote_a',
              delta: 'FIRST',
            }),
          )
          fake.emit(
            providerEvent('message.delta', {
              itemId: 'item_remote_a',
              delta: 'SECOND',
            }),
          )
          fake.emit(
            providerEvent('message.completed', {
              itemId: 'item_remote_a',
              message: 'FIRSTSECOND',
            }),
          )
          fake.emit(providerEvent('turn.completed'))
        }, 50)
        return result
      }
      return client
    },
  })
  const state = await NodeStateStore.open({
    dataDirectory: join(directory, 'node-state'),
    displayName: 'Duplicate Control Test Node',
    platform: 'Linux',
    architecture: 'x64',
  })
  const service = new CodeTetherNodeService({
    state,
    bindAddress: '127.0.0.1',
    port: 0,
    providerDetector: executionDetector(),
    remoteCodexRunners: runners,
  })
  const controller = {
    controllerId: newControllerId(),
    tls: await generateMachineTlsIdentity('Duplicate Control Controller'),
  }
  let connection
  try {
    const address = await service.listen()
    const pairing = await service.enablePairing()
    const pending = await beginRemoteMachinePairing({
      endpoint: { host: '127.0.0.1', port: address.port },
      pairingCode: pairing.code,
      controller,
    })
    const peer = await pending.confirm()
    const tls = await connectMachineTls({
      ...peer.endpoint,
      identity: controller.tls,
      expectedPeerFingerprint: peer.nodeFingerprint,
    })
    connection = new FramedMachineConnection(tls.socket)
    const helloNonce = newMachineNonce()
    await connection.send({
      type: 'machine.hello',
      protocolVersion: machineProtocolVersion,
      controllerId: controller.controllerId,
      expectedMachineId: peer.machine.machineId,
      nonce: helloNonce,
    })
    const status = await connection.receive(z.unknown())
    assert.equal(status.type, 'machine.status')
    assert.equal(status.nonce, helloNonce)

    const requestId = newMachineNonce()
    await connection.send({
      ...sessionRequest(project),
      requestId,
      expectedMachineId: peer.machine.machineId,
      expectedNodeId: peer.machine.nodeId,
    })
    const ready = await connection.receive(z.unknown())
    assert.equal(ready.type, 'codex.session.ready')
    const request = turnRequest(ready.providerThreadId)
    await connection.send(request)
    const firstStarted = await connection.receive(z.unknown())
    assert.equal(firstStarted.type, 'codex.turn.started')
    await connection.send(request)

    const messages = []
    while (true) {
      const message = await connection.receive(z.unknown())
      messages.push(message)
      if (
        message.type === 'codex.turn.event' &&
        message.event.type === 'turn.completed'
      ) {
        break
      }
    }
    assert.equal(messages[0].type, 'codex.turn.started')
    assert.deepEqual(
      messages
        .filter(({ type }) => type === 'codex.turn.event')
        .map(({ event }) => event),
      [
        { type: 'message.delta', text: 'FIRST' },
        { type: 'message.delta', text: 'SECOND' },
        { type: 'message.completed' },
        { type: 'turn.completed' },
      ],
    )
    assert.equal(fake.starts, 1)
    await connection.send({
      type: 'codex.session.dispose',
      protocolVersion: machineProtocolVersion,
      requestId: newMachineNonce(),
      conversationId: ready.conversationId,
      providerThreadId: ready.providerThreadId,
    })
    assert.equal(
      (await connection.receive(z.unknown())).type,
      'codex.session.disposed',
    )
  } finally {
    connection?.destroy()
    await service.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

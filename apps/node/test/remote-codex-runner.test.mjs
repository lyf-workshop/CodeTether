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

import { canonicalFailure } from '@codetether/agent-core'
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
  openRemoteClaudeSession,
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
import { RemoteClaudeRunnerPool } from '../dist/remote-claude-runner.js'
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
        if (options.turnStartFailure !== undefined) {
          throw options.turnStartFailure
        }
        callbacks.onEvent({
          type: 'turn.started',
          provider: 'codex',
          timestamp: new Date().toISOString(),
          threadId: 'provider-thread-a',
          turnId: options.observedProviderTurnId ?? 'provider-turn-a',
        })
        return {
          turn: {
            id: options.returnedProviderTurnId ?? 'provider-turn-a',
            status: 'inProgress',
          },
        }
      },
      waitForTurn: async () => ({}),
      shutdown: async () => {
        shutdowns += 1
        options.onShutdown?.()
        await options.shutdownGate
        if (options.shutdownFailure !== undefined) {
          throw options.shutdownFailure
        }
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

function connectionOwner(generation, retire = () => undefined) {
  return {
    controllerId: 'controller_remote_owner01',
    generation: BigInt(generation),
    retire,
  }
}

function executionDetector(options = {}) {
  const codexExecutable = options.codexExecutable ?? process.execPath
  const codexScript =
    options.codexScript ?? "process.stdout.write('codex-cli 0.149.1')"
  return new RemoteProviderDetector({
    platform: 'linux',
    claudeExecutionProbe:
      options.claudeExecutionProbe ?? (async () => ({ available: false })),
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

test('runner preserves a controlled Codex Provider failure without its prose', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-failure-wire-'))
  const fake = fakeClientFactory()
  const pool = new RemoteCodexRunnerPool({
    codexHome: directory,
    clientFactory: fake.factory,
  })
  try {
    const runner = await pool.open(sessionRequest(directory))
    const turn = await runner.startTurn(turnRequest(runner.providerThreadId))
    const occurredAt = '2026-09-02T12:00:00.000Z'
    fake.emit(
      providerEvent('turn.failed', {
        error: {
          message: 'private Provider account and token detail',
          failure: canonicalFailure('rate_limited', occurredAt),
        },
      }),
    )
    const events = []
    for await (const event of turn.events()) events.push(event)
    assert.equal(events[0].failure.reason, 'rate_limited')
    assert.equal(events[0].failure.occurredAt, occurredAt)
    assert.doesNotMatch(JSON.stringify(events), /private|account|token/u)
  } finally {
    await pool.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('fatal Codex child failure preserves the controlled crash reason', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-fatal-wire-'))
  const fake = fakeClientFactory()
  const pool = new RemoteCodexRunnerPool({
    codexHome: directory,
    clientFactory: fake.factory,
  })
  try {
    const runner = await pool.open(sessionRequest(directory))
    const turn = await runner.startTurn(turnRequest(runner.providerThreadId))
    fake.fail(
      Object.assign(new Error('private process path and stderr'), {
        failureReason: 'provider_crashed',
      }),
    )

    const events = []
    for await (const event of turn.events()) events.push(event)
    assert.equal(events.length, 1)
    assert.equal(events[0].type, 'turn.failed')
    assert.equal(events[0].failure.reason, 'provider_crashed')
    assert.doesNotMatch(JSON.stringify(events), /private|process path|stderr/u)
  } finally {
    await pool.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('runner preserves a controlled pre-ownership Codex failure reason', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-start-failure-'))
  const fake = fakeClientFactory({
    turnStartFailure: Object.assign(
      new Error('private authentication and token detail'),
      { failureReason: 'authentication_invalid' },
    ),
  })
  const pool = new RemoteCodexRunnerPool({
    codexHome: directory,
    clientFactory: fake.factory,
  })
  try {
    const runner = await pool.open(sessionRequest(directory))
    await assert.rejects(
      runner.startTurn(turnRequest(runner.providerThreadId)),
      (error) =>
        error.code === 'provider_start_failed' &&
        error.failureReason === 'authentication_invalid' &&
        !error.message.includes('private') &&
        !error.message.includes('token'),
    )
    assert.equal(fake.starts, 1)
  } finally {
    await pool.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('post-acceptance Codex Turn identity failures are never replay-safe', async (t) => {
  const scenarios = [
    { name: 'malformed returned identity', returnedProviderTurnId: '' },
    {
      name: 'returned identity mismatches the observed Turn',
      returnedProviderTurnId: 'provider-turn-b',
    },
  ]

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const directory = await mkdtemp(
        join(tmpdir(), 'codetether-post-acceptance-identity-'),
      )
      const fake = fakeClientFactory({
        returnedProviderTurnId: scenario.returnedProviderTurnId,
      })
      const pool = new RemoteCodexRunnerPool({
        codexHome: directory,
        clientFactory: fake.factory,
      })
      try {
        const runner = await pool.open(sessionRequest(directory))
        await assert.rejects(
          runner.startTurn(turnRequest(runner.providerThreadId)),
          (error) =>
            error.code === 'remote_execution_lost' &&
            error.failureReason === 'execution_ownership_uncertain' &&
            error.failureReason !== 'provider_start_failed',
        )
        assert.equal(fake.starts, 1)
        assert.equal(fake.shutdowns, 1)
      } finally {
        await pool.close()
        await rm(directory, { recursive: true, force: true })
      }
    })
  }
})

test('slow consumers receive coalesced Codex deltas without queue growth', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-coalesce-'))
  const fake = fakeClientFactory()
  const pool = new RemoteCodexRunnerPool({
    codexHome: directory,
    clientFactory: fake.factory,
  })
  try {
    const runner = await pool.open(sessionRequest(directory))
    const turn = await runner.startTurn(turnRequest(runner.providerThreadId))
    for (let index = 0; index < 300; index += 1) {
      fake.emit(
        providerEvent('message.delta', {
          itemId: 'item_remote_a',
          delta: 'x',
        }),
      )
    }
    fake.emit(
      providerEvent('message.completed', {
        itemId: 'item_remote_a',
        message: 'x'.repeat(300),
      }),
    )
    fake.emit(providerEvent('turn.completed'))

    const events = []
    for await (const event of turn.events()) events.push(event)
    assert.equal(
      events
        .filter(({ type }) => type === 'message.delta')
        .map(({ text }) => text)
        .join(''),
      'x'.repeat(300),
    )
    assert.ok(events.length < 10)
    assert.deepEqual(events.at(-1), { type: 'turn.completed' })
    await pool.release(runner)
  } finally {
    await pool.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('high-volume Codex output fails the Turn and closes the exact client', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-overflow-'))
  const fake = fakeClientFactory()
  const pool = new RemoteCodexRunnerPool({
    codexHome: directory,
    clientFactory: fake.factory,
  })
  try {
    const runner = await pool.open(sessionRequest(directory))
    const turn = await runner.startTurn(turnRequest(runner.providerThreadId))
    for (let index = 0; index < 40; index += 1) {
      fake.emit(
        providerEvent('message.delta', {
          itemId: 'item_remote_a',
          delta: 'x'.repeat(
            machineTransportLimits.maximumRemoteCodexDeltaBytes,
          ),
        }),
      )
    }
    const events = []
    for await (const event of turn.events()) events.push(event)
    assert.equal(events[0].failure.reason, 'output_limit_exceeded')
    assert.deepEqual(events.map(stripCanonicalFailure), [
      {
        type: 'turn.failed',
        code: 'remote_execution_lost',
        message: 'Remote Codex execution was lost',
      },
    ])
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(fake.shutdowns, 1)
    assert.equal(pool.activeCount, 0)
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
    assert.equal(events[0].failure.reason, 'provider_protocol_error')
    assert.deepEqual(events.map(stripCanonicalFailure), [
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
      method: 'account/rateLimits/updated',
      params: {
        rateLimits: {
          limitId: 'codex',
          limitName: null,
          primary: {
            usedPercent: 12,
            windowDurationMins: 300,
            resetsAt: 1_777_777_777,
          },
          secondary: null,
          credits: {
            hasCredits: true,
            unlimited: false,
            balance: '42.00',
          },
          individualLimit: {
            limit: '100.00',
            used: '10.00',
            remainingPercent: 90,
            resetsAt: 1_777_777_777,
          },
          spendControlReached: false,
          planType: 'plus',
          rateLimitReachedType: null,
        },
      },
    }),
  )
  for (const rateLimits of [
    {},
    { primary: { usedPercent: 12 } },
    { credits: { hasCredits: true, unlimited: false } },
  ]) {
    assert.doesNotThrow(() =>
      validateRemoteCodexTextNotification({
        method: 'account/rateLimits/updated',
        params: { rateLimits },
      }),
    )
  }
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
      method: 'account/rateLimits/updated',
      params: {
        rateLimits: {
          limitId: 'codex',
          limitName: null,
          primary: null,
          secondary: null,
          credits: null,
          individualLimit: null,
          spendControlReached: null,
          planType: 'plus',
          rateLimitReachedType: null,
          secret: 'not admitted',
        },
      },
    },
    {
      method: 'account/rateLimits/updated',
      params: {
        rateLimits: {
          primary: {
            usedPercent: 1.5,
          },
        },
      },
    },
    {
      method: 'account/rateLimits/updated',
      params: { rateLimits: { primary: {} } },
    },
    {
      method: 'account/rateLimits/updated',
      params: {
        rateLimits: { credits: { hasCredits: true } },
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

test('fatal Codex cleanup retains its exact pool slot until ownership ends', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-fatal-slot-'))
  const cleanup = deferred()
  const fake = fakeClientFactory({ shutdownGate: cleanup.promise })
  const pool = new RemoteCodexRunnerPool({
    codexHome: directory,
    clientFactory: fake.factory,
    maximumSessions: 1,
  })
  try {
    await pool.open(sessionRequest(directory))
    fake.fail(new Error('controlled Provider ownership loss'))
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(pool.activeCount, 1)
    await assert.rejects(
      pool.open(sessionRequest(directory, 'conv_remote_b')),
      (error) => error.code === 'busy',
    )
    cleanup.resolve()
    for (let attempt = 0; attempt < 20 && pool.activeCount > 0; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve))
    }
    assert.equal(pool.activeCount, 0)
    assert.equal(fake.shutdowns, 1)
  } finally {
    cleanup.resolve()
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

test('remote Codex cleanup failure is latched and blocks new ownership', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-codex-cleanup-'))
  const cleanupFailure = new Error('private exact cleanup failure')
  const fake = fakeClientFactory({ shutdownFailure: cleanupFailure })
  const pool = new RemoteCodexRunnerPool({
    codexHome: directory,
    clientFactory: fake.factory,
  })
  try {
    const runner = await pool.open(sessionRequest(directory))
    await assert.rejects(
      pool.release(runner),
      (error) =>
        error.code === 'remote_execution_lost' &&
        error.cause === cleanupFailure,
    )
    await assert.rejects(
      pool.open(sessionRequest(directory, 'conv_remote_b')),
      (error) => error.code === 'remote_execution_unavailable',
    )
    await assert.rejects(
      pool.close(),
      (error) =>
        error instanceof AggregateError &&
        error.message === 'Remote Codex owned process cleanup did not complete',
    )
  } finally {
    await pool.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

test('Node service retains and reports remote Claude cleanup failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-cleanup-fail-'))
  const state = await NodeStateStore.open({
    dataDirectory: join(directory, 'node-state'),
    displayName: 'Cleanup Failure Node',
    platform: 'Linux',
    architecture: 'x64',
  })
  const cleanupFailure = new Error('private owned cleanup diagnostic')
  let cleanupAttempts = 0
  const service = new CodeTetherNodeService({
    state,
    providerDetector: executionDetector(),
    remoteClaudeRunners: {
      close: async () => {
        cleanupAttempts += 1
        throw cleanupFailure
      },
    },
  })
  try {
    await assert.rejects(
      service.close(),
      (error) =>
        error instanceof AggregateError &&
        error.message ===
          'CodeTether Node owned resource cleanup did not complete' &&
        error.errors.includes(cleanupFailure),
    )
    await assert.rejects(service.close(), AggregateError)
    assert.equal(cleanupAttempts, 1)
  } finally {
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

test('a newer authenticated connection supersedes only the exact idle Codex session after cleanup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-idle-handoff-'))
  const cleanup = deferred()
  const fake = fakeClientFactory({ shutdownGate: cleanup.promise })
  const pool = new RemoteCodexRunnerPool({
    codexHome: directory,
    clientFactory: fake.factory,
  })
  let retired = 0
  try {
    const stale = await pool.open(
      sessionRequest(directory),
      connectionOwner(1, () => {
        retired += 1
      }),
    )
    let replacementSettled = false
    const replacementOpening = pool
      .open(
        {
          ...sessionRequest(directory),
          requestId: 'T'.repeat(43),
          providerThreadId: stale.providerThreadId,
        },
        connectionOwner(2),
      )
      .then((runner) => {
        replacementSettled = true
        return runner
      })

    await waitForCondition(() => fake.shutdowns === 1)
    assert.equal(retired, 1)
    assert.equal(replacementSettled, false)
    assert.equal(pool.activeCount, 1)
    await assert.rejects(
      stale.startTurn(turnRequest(stale.providerThreadId)),
      (error) => error.code === 'provider_session_lost',
    )
    await assert.rejects(
      pool.open(
        {
          ...sessionRequest(directory),
          requestId: 'U'.repeat(43),
          providerThreadId: stale.providerThreadId,
        },
        connectionOwner(3),
      ),
      (error) => error.code === 'conversation_busy',
    )
    assert.equal(fake.launches, 1)

    cleanup.resolve()
    const replacement = await replacementOpening
    assert.equal(replacement.resumed, true)
    assert.equal(fake.launches, 2)
    assert.equal(fake.resumes, 1)
    assert.equal(pool.activeCount, 1)

    // The stale connection's eventual finally/release cannot remove the new
    // exact owner from the pool.
    await pool.release(stale)
    assert.equal(pool.activeCount, 1)
    await pool.release(replacement)
    assert.equal(pool.activeCount, 0)
  } finally {
    cleanup.resolve()
    await pool.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

test('Codex idle-session handoff rejects active, older, or mismatched owners without eviction', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-handoff-guard-'))
  const otherRoot = join(directory, 'other-root')
  await mkdir(otherRoot)
  const fake = fakeClientFactory()
  const pool = new RemoteCodexRunnerPool({
    codexHome: directory,
    clientFactory: fake.factory,
  })
  let retired = 0
  try {
    const runner = await pool.open(
      sessionRequest(directory),
      connectionOwner(10, () => {
        retired += 1
      }),
    )
    const exact = {
      ...sessionRequest(directory),
      providerThreadId: runner.providerThreadId,
    }
    const mismatches = [
      [exact, connectionOwner(10)],
      [
        exact,
        {
          ...connectionOwner(11),
          controllerId: 'controller_remote_owner02',
        },
      ],
      [
        { ...exact, providerThreadId: 'provider-thread-b' },
        connectionOwner(11),
      ],
      [{ ...exact, providerThreadId: undefined }, connectionOwner(11)],
      [{ ...exact, projectId: 'proj_remote_b' }, connectionOwner(11)],
      [{ ...exact, rootPath: otherRoot }, connectionOwner(11)],
    ]
    for (const [request, owner] of mismatches) {
      await assert.rejects(
        pool.open(request, owner),
        (error) => error.code === 'conversation_busy',
      )
    }
    assert.equal(retired, 0)
    assert.equal(fake.launches, 1)

    const turn = await runner.startTurn(turnRequest(runner.providerThreadId))
    await assert.rejects(
      pool.open({ ...exact, requestId: 'V'.repeat(43) }, connectionOwner(12)),
      (error) => error.code === 'conversation_busy',
    )
    assert.equal(retired, 0)
    assert.equal(fake.launches, 1)
    fake.emit(providerEvent('message.completed'))
    fake.emit(providerEvent('turn.completed'))
    for await (const _event of turn.events()) void _event
    await pool.release(runner)
  } finally {
    await pool.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

test('pool shutdown racing an idle Codex handoff cannot install a replacement', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-handoff-close-'))
  const cleanup = deferred()
  const fake = fakeClientFactory({ shutdownGate: cleanup.promise })
  const pool = new RemoteCodexRunnerPool({
    codexHome: directory,
    clientFactory: fake.factory,
  })
  try {
    const stale = await pool.open(sessionRequest(directory), connectionOwner(1))
    const replacing = pool.open(
      {
        ...sessionRequest(directory),
        providerThreadId: stale.providerThreadId,
      },
      connectionOwner(2),
    )
    await waitForCondition(() => fake.shutdowns === 1)
    let closeSettled = false
    const closing = pool.close().then(() => {
      closeSettled = true
    })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(closeSettled, false)

    cleanup.resolve()
    await assert.rejects(
      replacing,
      (error) => error.code === 'remote_execution_unavailable',
    )
    await closing
    assert.equal(closeSettled, true)
    assert.equal(fake.launches, 1)
    assert.equal(pool.activeCount, 0)
  } finally {
    cleanup.resolve()
    await pool.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

test('lost session-ready after pinned authentication remains peer-authenticated', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-ready-loss-'))
  const project = join(directory, 'project')
  const codexHome = join(directory, 'codex-home')
  await mkdir(project)
  await mkdir(codexHome)
  const factoryStarted = deferred()
  const factoryRelease = deferred()
  const fake = fakeClientFactory({
    factoryGate: factoryRelease.promise,
    onFactoryOwned: () => factoryStarted.resolve(),
  })
  const runners = new RemoteCodexRunnerPool({
    codexHome,
    clientFactory: fake.factory,
  })
  const state = await NodeStateStore.open({
    dataDirectory: join(directory, 'node-state'),
    displayName: 'Remote ready-loss Node',
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
    tls: await generateMachineTlsIdentity('Ready-loss Controller'),
  }
  try {
    const peer = await pairService(service, controller)
    const abort = new AbortController()
    const opening = openRemoteCodexSession({
      peer,
      controller,
      conversationId: 'conv_ready_loss01',
      projectId: 'proj_ready_loss01',
      rootPath: project,
      signal: abort.signal,
    })
    await factoryStarted.promise
    abort.abort()
    await assert.rejects(
      opening,
      (error) =>
        error.code === 'connection_failed' && error.peerAuthenticated === true,
    )
  } finally {
    factoryRelease.resolve()
    await service.close().catch(() => undefined)
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

test('a newer authenticated Machine connection retires an exact idle stale session', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-node-handoff-'))
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
    displayName: 'Remote handoff Test Node',
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
    tls: await generateMachineTlsIdentity('Remote handoff Controller'),
  }
  let stale
  let replacement
  try {
    const peer = await pairService(service, controller)
    stale = await openRemoteCodexSession({
      peer,
      controller,
      conversationId: 'conv_remote_a',
      projectId: 'proj_remote_a',
      rootPath: project,
    })
    const providerThreadId = stale.providerThreadId
    replacement = await openRemoteCodexSession({
      peer,
      controller,
      conversationId: 'conv_remote_a',
      projectId: 'proj_remote_a',
      rootPath: project,
      providerThreadId,
    })
    await waitForCondition(() => stale.closed)
    assert.equal(replacement.providerThreadId, providerThreadId)
    assert.equal(replacement.resumed, true)
    assert.equal(runners.activeCount, 1)
    assert.equal(fake.launches, 2)
    assert.equal(fake.resumes, 1)
    assert.equal(fake.shutdowns, 1)
    await assert.rejects(
      stale.startTurn({
        actionId: 'act_remote_stale',
        turnId: 'turn_remote_stale',
        prompt: 'This stale connection must not execute.',
      }),
    )
    await stale.close()
    stale = undefined
    assert.equal(runners.activeCount, 1)

    const turn = await replacement.startTurn({
      actionId: 'act_remote_handoff',
      turnId: 'turn_remote_handoff',
      prompt: 'Execute once on the replacement connection.',
    })
    fake.emit(
      providerEvent('message.delta', {
        itemId: 'item_remote_handoff',
        delta: 'HANDOFF MARKER',
      }),
    )
    fake.emit(
      providerEvent('message.completed', {
        itemId: 'item_remote_handoff',
        message: 'HANDOFF MARKER',
      }),
    )
    fake.emit(providerEvent('turn.completed'))
    const events = []
    for await (const event of turn.events()) events.push(event.event)
    assert.deepEqual(events.at(-1), { type: 'turn.completed' })
    assert.equal(fake.starts, 1)
    await replacement.close()
    replacement = undefined
    assert.equal(runners.activeCount, 0)
  } finally {
    await stale?.close().catch(() => undefined)
    await replacement?.close().catch(() => undefined)
    await service.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

test('authenticated Node startup failure preserves canonical reason end to end', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-node-failure-'))
  const project = join(directory, 'project')
  const codexHome = join(directory, 'codex-home')
  await mkdir(project)
  await mkdir(codexHome)
  const fake = fakeClientFactory({
    turnStartFailure: Object.assign(
      new Error('private Provider authentication and token detail'),
      { failureReason: 'authentication_invalid' },
    ),
  })
  const runners = new RemoteCodexRunnerPool({
    codexHome,
    clientFactory: fake.factory,
  })
  const state = await NodeStateStore.open({
    dataDirectory: join(directory, 'node-state'),
    displayName: 'Remote failure Node',
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
    tls: await generateMachineTlsIdentity('Remote failure Controller'),
  }
  let session
  try {
    const peer = await pairService(service, controller)
    session = await openRemoteCodexSession({
      peer,
      controller,
      conversationId: 'conv_remote_a',
      projectId: 'proj_remote_a',
      rootPath: project,
    })
    await assert.rejects(
      session.startTurn({
        actionId: 'act_remote_a',
        turnId: 'turn_remote_a',
        prompt: 'Return a public fixture marker.',
      }),
      (error) =>
        error.code === 'provider_start_failed' &&
        error.peerAuthenticated === true &&
        error.failureReason === 'authentication_invalid' &&
        error.failure?.reason === 'authentication_invalid' &&
        !JSON.stringify(error.failure).includes('private') &&
        !error.message.includes('token'),
    )
    assert.equal(fake.starts, 1)
    assert.equal(session.closed, true)
  } finally {
    await session?.close().catch(() => undefined)
    await service.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

test('authenticated transport streams canonical restricted Claude events and resumes exact identity', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-node-claude-'))
  const project = join(directory, 'project')
  await mkdir(project)
  const providerSessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const factoryCalls = []
  let processStarts = 0
  const runtimes = new Set()
  const runners = new RemoteClaudeRunnerPool({
    runtimeFactory: async (options) => {
      factoryCalls.push(options)
      let listener = () => undefined
      const runtime = {
        sessionId: options.providerSessionId ?? providerSessionId,
        cwd: options.cwd,
        subscribeEvents(next) {
          listener = next
          return () => {
            listener = () => undefined
          }
        },
        async startTurn(turn) {
          processStarts += 1
          const base = {
            provider: 'claude-code',
            timestamp: new Date().toISOString(),
            threadId: runtime.sessionId,
            turnId: turn.turnId,
          }
          listener({
            type: 'conversation.started',
            provider: 'claude-code',
            timestamp: base.timestamp,
            threadId: runtime.sessionId,
            cwd: options.cwd,
          })
          listener({ type: 'turn.started', ...base })
          listener({
            type: 'message.delta',
            ...base,
            itemId: 'message_remote_claude',
            delta: 'CLAUDE TRANSPORT MARKER',
          })
          listener({
            type: 'message.completed',
            ...base,
            itemId: 'message_remote_claude',
            message: 'CLAUDE TRANSPORT MARKER',
          })
          listener({
            type: 'tool.started',
            ...base,
            itemId: 'tool_remote_read',
            kind: 'read',
            name: 'Read',
            command: 'Read fixture.txt',
            summary: 'Read fixture.txt',
          })
          listener({
            type: 'tool.output',
            ...base,
            itemId: 'tool_remote_read',
            output: 'known fixture',
            stream: 'combined',
          })
          listener({
            type: 'tool.completed',
            ...base,
            itemId: 'tool_remote_read',
            kind: 'read',
            name: 'Read',
            command: 'Read fixture.txt',
            success: true,
            summary: 'Read fixture.txt',
          })
          listener({ type: 'turn.completed', ...base })
          return {
            sessionId: runtime.sessionId,
            turnId: turn.turnId,
            finalMessage: 'CLAUDE TRANSPORT MARKER',
          }
        },
        async close() {
          runtimes.delete(runtime)
        },
      }
      runtimes.add(runtime)
      return runtime
    },
  })
  const state = await NodeStateStore.open({
    dataDirectory: join(directory, 'node-state'),
    displayName: 'Remote Claude Test Node',
    platform: 'Linux',
    architecture: 'x64',
  })
  const service = new CodeTetherNodeService({
    state,
    bindAddress: '127.0.0.1',
    port: 0,
    providerDetector: executionDetector({
      claudeExecutionProbe: async () => ({
        available: true,
        version: '2.1.251',
      }),
    }),
    remoteClaudeRunners: runners,
  })
  const controller = {
    controllerId: newControllerId(),
    tls: await generateMachineTlsIdentity('Remote Claude Test Controller'),
  }
  let session
  try {
    const peer = await pairService(service, controller)
    session = await openRemoteClaudeSession({
      peer,
      controller,
      conversationId: 'conv_remote_claude01',
      projectId: 'proj_remote_claude01',
      rootPath: project,
      effort: 'high',
    })
    assert.equal(session.providerSessionId, providerSessionId)
    assert.equal(session.resumed, false)
    assert.equal(session.effort, 'high')
    const turn = await session.startTurn({
      actionId: 'act_remote_claude01',
      turnId: 'turn_remote_claude01',
      prompt: 'Inspect the fixture.',
    })
    const events = []
    for await (const event of turn.events()) events.push(event.event)
    assert.deepEqual(
      events.map(({ type }) => type),
      [
        'message.delta',
        'tool.started',
        'tool.output',
        'tool.completed',
        'message.completed',
        'turn.completed',
      ],
    )
    assert.equal(events[0].text, 'CLAUDE TRANSPORT MARKER')
    assert.deepEqual(events[1], {
      type: 'tool.started',
      itemId: 'tool_remote_read',
      kind: 'read',
      name: 'Read',
      command: 'Read fixture.txt',
      summary: 'Read fixture.txt',
    })
    await session.close()
    session = undefined

    session = await openRemoteClaudeSession({
      peer,
      controller,
      conversationId: 'conv_remote_claude01',
      projectId: 'proj_remote_claude01',
      rootPath: project,
      providerSessionId,
      providerSessionMaterialized: true,
      effort: 'high',
    })
    assert.equal(session.resumed, true)
    assert.equal(factoryCalls.length, 2)
    assert.equal(factoryCalls[0].resume, false)
    assert.equal(factoryCalls[1].resume, true)
    assert.equal(factoryCalls[1].providerSessionId, providerSessionId)
    assert.equal(processStarts, 1)
    await session.close()
    session = undefined
    assert.equal(runners.activeCount, 0)
    assert.equal(runtimes.size, 0)
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

test('authenticated execution heartbeats keep a quiet Provider Turn alive without replay', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-lease-live-'))
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
    displayName: 'Execution lease Node',
    platform: 'Linux',
    architecture: 'x64',
  })
  const service = new CodeTetherNodeService({
    state,
    bindAddress: '127.0.0.1',
    port: 0,
    // Keep this integration fixture comfortably above ordinary CI/WSL timer
    // jitter while retaining the production ordering: several authenticated
    // heartbeats must renew the lease before the quiet Turn is completed.
    executionSessionLeaseTimeoutMs: 500,
    providerDetector: executionDetector(),
    remoteCodexRunners: runners,
  })
  const controller = {
    controllerId: newControllerId(),
    tls: await generateMachineTlsIdentity('Execution lease Controller'),
  }
  let session
  try {
    const peer = await pairService(service, controller)
    session = await openRemoteCodexSession({
      peer,
      controller,
      conversationId: 'conv_execution_lease_live01',
      projectId: 'proj_execution_lease_live01',
      rootPath: project,
      heartbeatIntervalMs: 50,
      heartbeatTimeoutMs: 250,
    })
    const turn = await session.startTurn({
      actionId: 'act_execution_lease_live01',
      turnId: 'turn_execution_lease_live01',
      prompt: 'Remain quiet until the deterministic fixture completes.',
    })
    const events = []
    const collecting = (async () => {
      for await (const event of turn.events()) events.push(event.event)
    })()
    await new Promise((resolve) => setTimeout(resolve, 1_200))
    assert.equal(session.closed, false)
    assert.equal(runners.activeCount, 1)
    assert.equal(fake.starts, 1)
    fake.emit(
      providerEvent('message.completed', {
        itemId: 'item_remote_a',
        message: '',
      }),
    )
    fake.emit(providerEvent('turn.completed'))
    await collecting
    assert.deepEqual(events, [
      { type: 'message.completed' },
      { type: 'turn.completed' },
    ])
    await session.close()
    session = undefined
    assert.equal(fake.starts, 1)
    assert.equal(fake.shutdowns, 1)
  } finally {
    await session?.close().catch(() => undefined)
    await service.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

test('expired authenticated execution lease cleans a blackholed quiet Provider exactly once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-lease-expired-'))
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
    displayName: 'Expired execution lease Node',
    platform: 'Linux',
    architecture: 'x64',
  })
  const service = new CodeTetherNodeService({
    state,
    bindAddress: '127.0.0.1',
    port: 0,
    executionSessionLeaseTimeoutMs: 30,
    providerDetector: executionDetector(),
    remoteCodexRunners: runners,
  })
  const controller = {
    controllerId: newControllerId(),
    tls: await generateMachineTlsIdentity('Expired lease Controller'),
  }
  let session
  try {
    const peer = await pairService(service, controller)
    session = await openRemoteCodexSession({
      peer,
      controller,
      conversationId: 'conv_execution_lease_expired01',
      projectId: 'proj_execution_lease_expired01',
      rootPath: project,
      // The first heartbeat is intentionally later than the Node lease.
      heartbeatIntervalMs: 1_000,
      heartbeatTimeoutMs: 1_000,
    })
    const turn = await session.startTurn({
      actionId: 'act_execution_lease_expired01',
      turnId: 'turn_execution_lease_expired01',
      prompt: 'Remain quiet while the Controller path is blackholed.',
    })
    await assert.rejects(async () => {
      for await (const _event of turn.events()) void _event
    })
    await waitForCondition(() => runners.activeCount === 0)
    assert.equal(session.closed, true)
    assert.equal(fake.starts, 1)
    assert.equal(fake.shutdowns, 1)
    await session.close()
    session = undefined
  } finally {
    await session?.close().catch(() => undefined)
    await service.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

test('expired authenticated execution lease cleans a quiet Claude Provider exactly once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-claude-lease-'))
  const project = join(directory, 'project')
  await mkdir(project)
  const providerSessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const completion = deferred()
  let starts = 0
  let closes = 0
  const runners = new RemoteClaudeRunnerPool({
    runtimeFactory: async ({ cwd }) => ({
      sessionId: providerSessionId,
      cwd,
      subscribeEvents() {
        return () => undefined
      },
      async startTurn() {
        starts += 1
        return await completion.promise
      },
      async close() {
        closes += 1
      },
    }),
  })
  const state = await NodeStateStore.open({
    dataDirectory: join(directory, 'node-state'),
    displayName: 'Expired Claude lease Node',
    platform: 'Linux',
    architecture: 'x64',
  })
  const service = new CodeTetherNodeService({
    state,
    bindAddress: '127.0.0.1',
    port: 0,
    executionSessionLeaseTimeoutMs: 30,
    providerDetector: executionDetector({
      claudeExecutionProbe: async () => ({
        available: true,
        version: '2.1.251',
      }),
    }),
    remoteClaudeRunners: runners,
  })
  const controller = {
    controllerId: newControllerId(),
    tls: await generateMachineTlsIdentity('Expired Claude lease Controller'),
  }
  let session
  try {
    const peer = await pairService(service, controller)
    session = await openRemoteClaudeSession({
      peer,
      controller,
      conversationId: 'conv_claude_lease_expired01',
      projectId: 'proj_claude_lease_expired01',
      rootPath: project,
      effort: 'high',
      // The first heartbeat is intentionally later than the Node lease.
      heartbeatIntervalMs: 1_000,
      heartbeatTimeoutMs: 1_000,
    })
    const turn = await session.startTurn({
      actionId: 'act_claude_lease_expired01',
      turnId: 'turn_claude_lease_expired01',
      prompt: 'Remain quiet while the Controller path is blackholed.',
    })
    await assert.rejects(async () => {
      for await (const _event of turn.events()) void _event
    })
    await waitForCondition(() => runners.activeCount === 0)
    assert.equal(session.closed, true)
    assert.equal(starts, 1)
    assert.equal(closes, 1)
    await session.close()
    session = undefined
  } finally {
    await session?.close().catch(() => undefined)
    await service.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

async function waitForCondition(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for deterministic lifecycle state')
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function stripCanonicalFailure(event) {
  const legacyEvent = { ...event }
  delete legacyEvent.failure
  return legacyEvent
}

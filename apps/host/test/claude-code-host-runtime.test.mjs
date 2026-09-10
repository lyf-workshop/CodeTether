import assert from 'node:assert/strict'
import {
  mkdtemp as makeTemporaryDirectory,
  readFile,
  realpath,
  rm,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  CLAUDE_CODE_CAPABILITIES,
  ClaudeCodeOwnedProcessCleanupError,
  ClaudeCodeSessionRuntime,
} from '@codetether/adapter-claude'

import { ClaudeCodeHostRuntime } from '../dist/api/claude-code-host-runtime.js'
import { HostEventPublisher } from '../dist/api/host-event-publisher.js'
import { HostService, newEpoch } from '../dist/api/host-service.js'
import { WorkspacePolicy } from '../dist/api/workspace-policy.js'
import { ConversationStore } from '../dist/persistence/conversation-store.js'
import { claudeCodeUnavailableDescriptor } from '../dist/api/local-codex-host.js'

const fixture = fileURLToPath(
  new URL(
    '../../../packages/adapter-claude/test/fixtures/fake-claude.mjs',
    import.meta.url,
  ),
)

async function mkdtemp(prefix) {
  return await realpath(await makeTemporaryDirectory(prefix))
}

test('keeps a tested logged-out Claude installation separate from execution health', () => {
  const observedAt = '2026-09-02T20:00:00.000Z'
  const descriptor = claudeCodeUnavailableDescriptor(
    {
      provider: 'claude-code',
      status: 'misconfigured',
      capabilities: CLAUDE_CODE_CAPABILITIES,
      durationMs: 1,
      diagnosticCode: 'auth_not_logged_in',
    },
    observedAt,
  )

  assert.equal(descriptor.availability, 'available')
  assert.equal(descriptor.executionHealth.state, 'unavailable')
  assert.equal(descriptor.executionHealth.freshness, 'current')
  assert.equal(descriptor.executionHealth.failure.reason, 'login_required')
  assert.equal(descriptor.executionHealth.failure.occurredAt, observedAt)
})

test('publishes only a controlled canonical failure when the Claude child crashes', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'codetether-claude-crash-'))
  const runtime = createRuntime('--fixture-scenario=after-delta-crash')
  const events = []
  const terminal = new Promise((resolve) => {
    runtime.subscribeEvents((event) => {
      events.push(event)
      if (event.type === 'turn.completed' || event.type === 'turn.failed') {
        resolve(event)
      }
    })
  })

  try {
    const session = await runtime.startConversation({ cwd })
    await runtime.startTurn({
      providerThreadId: session.providerThreadId,
      cwd,
      input: 'deliberately public crash fixture',
    })
    const terminalEvent = await terminal
    assert.equal(terminalEvent.type, 'turn.failed')
    assert.equal(terminalEvent.error.failure.reason, 'provider_crashed')
    assert.equal(terminalEvent.error.failure.retryability, 'unknown')
    assert.equal(terminalEvent.error.failure.userAction, 'view_details')
    assert.doesNotMatch(JSON.stringify(events), /private diagnostic|stderr/u)
  } finally {
    await runtime.close()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('bridges a cold Claude session into canonical streaming Host events', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'codetether-claude-host-'))
  const runtime = new ClaudeCodeHostRuntime({
    provider: 'claude-code',
    status: 'available',
    capabilities: {
      streaming: true,
      resume: true,
      interrupt: false,
      approvals: false,
      fileRead: true,
      fileEdit: false,
      shell: false,
      search: true,
      diff: false,
      toolEvents: true,
      modelSelection: false,
      reasoningControl: true,
    },
    durationMs: 1,
    version: '2.1.251',
    executablePath: process.execPath,
    launcher: {
      kind: 'native',
      executable: process.execPath,
      prefixArguments: [fixture],
      sourcePath: process.execPath,
    },
  })
  const events = []
  let resolveTerminal
  const terminal = new Promise((resolve) => {
    resolveTerminal = resolve
  })
  runtime.subscribeEvents((event) => {
    events.push(event)
    if (event.type === 'turn.completed' || event.type === 'turn.failed') {
      resolveTerminal(event)
    }
  })

  try {
    const session = await runtime.startConversation({
      cwd,
      reasoning: 'low',
    })
    const turn = await runtime.startTurn({
      providerThreadId: session.providerThreadId,
      cwd,
      input: 'fixture prompt',
      reasoning: 'low',
    })
    const terminalEvent = await terminal
    assert.equal(terminalEvent.type, 'turn.completed')
    assert.equal(terminalEvent.turnId, turn.providerTurnId)
    assert.equal(terminalEvent.threadId, session.providerThreadId)
    assert.equal(
      events.some(
        (event) =>
          event.type === 'message.delta' &&
          event.provider === 'claude-code' &&
          event.delta === 'HELLO',
      ),
      true,
    )
    assert.equal(runtime.descriptor.capabilities.approvals, false)
    assert.equal(runtime.descriptor.capabilities.interrupt, false)
    assert.equal(runtime.descriptor.capabilities.reasoningControl, true)
    assert.equal(runtime.descriptor.reasoningLabel, '思考强度')
    assert.deepEqual(
      runtime.descriptor.reasoningOptions.map((option) => option.id),
      ['low', 'medium', 'high', 'xhigh', 'max'],
    )
    await assert.rejects(
      runtime.startConversation({ cwd, reasoning: 'unsupported' }),
      /effort is unsupported/u,
    )
    await runtime.disposeConversation({
      providerThreadId: session.providerThreadId,
    })
  } finally {
    await runtime.close()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('Host runtime preserves a typed Claude session cleanup barrier across close attempts', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'codetether-claude-host-cleanup-'))
  const runtime = createRuntime()
  const cleanupFailure = new ClaudeCodeOwnedProcessCleanupError()
  const originalClose = ClaudeCodeSessionRuntime.prototype.close
  try {
    await runtime.startConversation({ cwd })
    ClaudeCodeSessionRuntime.prototype.close = async () => {
      throw cleanupFailure
    }
    const results = await Promise.allSettled([runtime.close(), runtime.close()])
    assert.deepEqual(
      results.map((result) => result.status),
      ['rejected', 'rejected'],
    )
    for (const result of results) assert.equal(result.reason, cleanupFailure)
    await assert.rejects(runtime.close(), (error) => error === cleanupFailure)
  } finally {
    ClaudeCodeSessionRuntime.prototype.close = originalClose
    await rm(cwd, { recursive: true, force: true })
  }
})

test('uses session creation for a restored zero-Turn Claude Conversation', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'codetether-claude-zero-turn-'))
  const capturePath = join(cwd, 'capture.jsonl')
  const runtime = createRuntime('--fixture-capture=capture.jsonl')
  const sessionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  let resolveTerminal
  const terminal = new Promise((resolve) => {
    resolveTerminal = resolve
  })
  runtime.subscribeEvents((event) => {
    if (event.type === 'turn.completed' || event.type === 'turn.failed') {
      resolveTerminal(event)
    }
  })

  try {
    await runtime.resumeConversation({
      providerThreadId: sessionId,
      cwd,
      providerSessionMaterialized: false,
    })
    await runtime.startTurn({
      providerThreadId: sessionId,
      cwd,
      input: 'first Turn after restart',
    })
    assert.equal((await terminal).type, 'turn.completed')
    const capture = JSON.parse((await readFile(capturePath, 'utf8')).trim())
    assert.equal(capture.arguments.includes('--session-id'), true)
    assert.equal(capture.arguments.includes('--resume'), false)
  } finally {
    await runtime.close()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('persists owner-closed running Claude Turns as interrupted, not failed', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'codetether-claude-close-'))
  const databasePath = join(cwd, 'host.sqlite')
  let service
  let turnId
  try {
    const runtime = createRuntime('--fixture-scenario=hang')
    let resolveStarted
    const started = new Promise((resolve) => {
      resolveStarted = resolve
    })
    runtime.subscribeEvents((event) => {
      if (event.type === 'turn.started') resolveStarted()
    })
    service = new HostService({
      runtimes: [runtime],
      workspacePolicy: await WorkspacePolicy.create([cwd]),
      publisher: new HostEventPublisher({ epoch: newEpoch() }),
      hostVersion: 'test',
      persistence: ConversationStore.open({ databasePath }),
    })
    await service.registerInitialProjectRoots([cwd])
    const projectId = (await service.listProjects()).projects[0].projectId
    const machineId = service.listMachines().machines[0].machineId
    const conversation = await service.createConversation({
      actionId: 'act_claude_close_create',
      projectId,
      machineId,
      provider: 'claude-code',
    })
    const turn = await service.startTurn(
      conversation.data.conversation.conversationId,
      {
        actionId: 'act_claude_close_turn',
        input: { type: 'text', text: 'wait for owner shutdown' },
      },
    )
    turnId = turn.data.turn.turnId
    await started
    await service.close()
    service = undefined

    const reopened = ConversationStore.open({ databasePath })
    try {
      const durableTurn = reopened.getTurn(turnId)
      assert.equal(durableTurn.status, 'interrupted')
      assert.equal(durableTurn.snapshot.turn.status, 'interrupted')
      assert.equal(durableTurn.snapshot.turn.error, undefined)
    } finally {
      reopened.close()
    }
  } finally {
    await service?.close().catch(() => undefined)
    await rm(cwd, { recursive: true, force: true })
  }
})

function createRuntime(...fixtureArguments) {
  return new ClaudeCodeHostRuntime({
    provider: 'claude-code',
    status: 'available',
    capabilities: {
      streaming: true,
      resume: true,
      interrupt: false,
      approvals: false,
      fileRead: true,
      fileEdit: false,
      shell: false,
      search: true,
      diff: false,
      toolEvents: true,
      modelSelection: false,
      reasoningControl: true,
    },
    durationMs: 1,
    version: '2.1.251',
    executablePath: process.execPath,
    launcher: {
      kind: 'native',
      executable: process.execPath,
      prefixArguments: [fixture, ...fixtureArguments],
      sourcePath: process.execPath,
    },
  })
}

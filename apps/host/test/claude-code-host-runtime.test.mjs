import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { ClaudeCodeHostRuntime } from '../dist/api/claude-code-host-runtime.js'
import { HostEventPublisher } from '../dist/api/host-event-publisher.js'
import { HostService, newEpoch } from '../dist/api/host-service.js'
import { WorkspacePolicy } from '../dist/api/workspace-policy.js'
import { ConversationStore } from '../dist/persistence/conversation-store.js'

const fixture = fileURLToPath(
  new URL(
    '../../../packages/adapter-claude/test/fixtures/fake-claude.mjs',
    import.meta.url,
  ),
)

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
      reasoningControl: false,
    },
    durationMs: 1,
    version: '2.1.250',
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
    const session = await runtime.startConversation({ cwd })
    const turn = await runtime.startTurn({
      providerThreadId: session.providerThreadId,
      cwd,
      input: 'fixture prompt',
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
    await runtime.disposeConversation({
      providerThreadId: session.providerThreadId,
    })
  } finally {
    await runtime.close()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('uses session creation for a restored zero-Turn Claude Conversation', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'codetether-claude-zero-turn-'))
  const capturePath = join(cwd, 'capture.jsonl')
  const previousCapture = process.env.FAKE_CLAUDE_CAPTURE_PATH
  process.env.FAKE_CLAUDE_CAPTURE_PATH = capturePath
  const runtime = createRuntime()
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
    if (previousCapture === undefined)
      delete process.env.FAKE_CLAUDE_CAPTURE_PATH
    else process.env.FAKE_CLAUDE_CAPTURE_PATH = previousCapture
    await runtime.close()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('persists owner-closed running Claude Turns as interrupted, not failed', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'codetether-claude-close-'))
  const databasePath = join(cwd, 'host.sqlite')
  const previousScenario = process.env.FAKE_CLAUDE_SCENARIO
  process.env.FAKE_CLAUDE_SCENARIO = 'hang'
  let service
  let turnId
  try {
    const runtime = createRuntime()
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
    const conversation = await service.createConversation({
      actionId: 'act_claude_close_create',
      projectId,
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
    if (previousScenario === undefined) delete process.env.FAKE_CLAUDE_SCENARIO
    else process.env.FAKE_CLAUDE_SCENARIO = previousScenario
    await service?.close().catch(() => undefined)
    await rm(cwd, { recursive: true, force: true })
  }
})

function createRuntime() {
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
      reasoningControl: false,
    },
    durationMs: 1,
    version: '2.1.250',
    executablePath: process.execPath,
    launcher: {
      kind: 'native',
      executable: process.execPath,
      prefixArguments: [fixture],
      sourcePath: process.execPath,
    },
  })
}

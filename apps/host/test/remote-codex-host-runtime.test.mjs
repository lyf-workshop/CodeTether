import assert from 'node:assert/strict'
import test from 'node:test'

import { RemoteCodexHostRuntime } from '../dist/api/remote-codex-host-runtime.js'

const machineId = 'machine_remote_runtime01'
const conversationId = 'conv_remote_runtime01'
const projectId = 'proj_remote_runtime01'

test('remote Codex runtime keeps native identity private and normalizes bounded text events', async () => {
  const opens = []
  const session = fakeSession('native-thread-private')
  const runtime = new RemoteCodexHostRuntime({
    machineId,
    now: () => new Date('2026-08-31T12:00:00.000Z'),
    opener: {
      async open(input) {
        opens.push(input)
        return session
      },
    },
  })
  const events = []
  runtime.subscribeEvents((event) => events.push(event))

  const created = await runtime.startConversation({
    cwd: '/srv/project',
    machineId,
    conversationId,
    projectId,
  })
  assert.equal(opens.length, 1)
  assert.equal(opens[0].providerThreadId, undefined)
  assert.equal(
    created.providerThreadId.includes('native-thread-private'),
    false,
  )
  assert.equal(runtime.hasConversationSession(created.providerThreadId), true)

  const turn = await runtime.startTurn({
    providerThreadId: created.providerThreadId,
    cwd: '/srv/project',
    input: 'reply safely',
    machineId,
    conversationId,
    projectId,
    actionId: 'act_remote_runtime01',
    turnId: 'turn_remote_runtime01',
  })
  assert.equal(turn.providerTurnId.includes('turn_remote_runtime01'), false)
  await waitFor(() => events.some((event) => event.type === 'turn.completed'))
  assert.deepEqual(
    events.map((event) => event.type),
    ['message.delta', 'message.delta', 'message.completed', 'turn.completed'],
  )
  assert.equal(events[2].message, 'hello world')
  assert.equal(events[3].finalMessage, 'hello world')
  assert.equal(JSON.stringify(events).includes('native-thread-private'), false)

  await runtime.startTurn({
    providerThreadId: created.providerThreadId,
    cwd: '/srv/project',
    input: 'second explicit prompt',
    machineId,
    conversationId,
    projectId,
    actionId: 'act_remote_runtime_second01',
    turnId: 'turn_remote_runtime_second01',
  })
  await waitFor(
    () =>
      events.filter((event) => event.type === 'turn.completed').length === 2,
  )
  assert.equal(opens.length, 1)
  assert.equal(session.startTurnCalls, 2)

  await runtime.disposeConversation({
    providerThreadId: created.providerThreadId,
  })
  assert.equal(session.closeCalls, 1)
  assert.equal(runtime.hasConversationSession(created.providerThreadId), false)
  await runtime.close()
})

test('remote Codex runtime decodes only the exact Machine-bound session on native resume', async () => {
  const firstSession = fakeSession('native-resume-thread')
  const first = new RemoteCodexHostRuntime({
    machineId,
    opener: { open: async () => firstSession },
  })
  const created = await first.startConversation({
    cwd: '/srv/project',
    machineId,
    conversationId,
    projectId,
  })
  await first.close()

  const opens = []
  const second = new RemoteCodexHostRuntime({
    machineId,
    opener: {
      async open(input) {
        opens.push(input)
        return fakeSession('native-resume-thread')
      },
    },
  })
  const resumed = await second.resumeConversation({
    providerThreadId: created.providerThreadId,
    providerSessionMaterialized: true,
    cwd: '/srv/project',
    machineId,
    conversationId,
    projectId,
  })
  assert.equal(resumed.providerThreadId, created.providerThreadId)
  assert.equal(opens[0].providerThreadId, 'native-resume-thread')

  await assert.rejects(
    second.resumeConversation({
      providerThreadId: created.providerThreadId,
      providerSessionMaterialized: true,
      cwd: '/srv/project',
      machineId: 'machine_other_runtime01',
      conversationId,
      projectId,
    }),
    /Machine identity/,
  )
  await second.close()
})

test('remote Codex runtime invalidates a failed connection so the next explicit Turn must resume', async () => {
  const session = fakeSession('native-lost-thread', { fail: true })
  const runtime = new RemoteCodexHostRuntime({
    machineId,
    opener: { open: async () => session },
  })
  const events = []
  runtime.subscribeEvents((event) => events.push(event))
  const created = await runtime.startConversation({
    cwd: '/srv/project',
    machineId,
    conversationId,
    projectId,
  })
  await runtime.startTurn({
    providerThreadId: created.providerThreadId,
    cwd: '/srv/project',
    input: 'one explicit prompt',
    machineId,
    conversationId,
    projectId,
    actionId: 'act_remote_runtime02',
    turnId: 'turn_remote_runtime02',
  })
  await waitFor(() => events.some((event) => event.type === 'turn.failed'))
  assert.equal(runtime.hasConversationSession(created.providerThreadId), false)
  assert.equal(session.startTurnCalls, 1)
  await runtime.close()
})

test('remote Codex runtime removes an idle closed session and natively resumes before the next Prompt', async () => {
  const firstSession = fakeSession('native-idle-thread')
  const resumedSession = fakeSession('native-idle-thread')
  const opens = []
  const runtime = new RemoteCodexHostRuntime({
    machineId,
    opener: {
      async open(input) {
        opens.push(input)
        return opens.length === 1 ? firstSession : resumedSession
      },
    },
  })
  const events = []
  runtime.subscribeEvents((event) => events.push(event))
  const created = await runtime.startConversation({
    cwd: '/srv/project',
    machineId,
    conversationId,
    projectId,
  })

  firstSession.closed = true
  assert.equal(runtime.hasConversationSession(created.providerThreadId), false)
  assert.equal(firstSession.closeCalls, 1)

  const resumed = await runtime.resumeConversation({
    providerThreadId: created.providerThreadId,
    providerSessionMaterialized: true,
    cwd: '/srv/project',
    machineId,
    conversationId,
    projectId,
  })
  assert.equal(resumed.providerThreadId, created.providerThreadId)
  assert.equal(opens.length, 2)
  assert.equal(opens[1].providerThreadId, 'native-idle-thread')

  await runtime.startTurn({
    providerThreadId: created.providerThreadId,
    cwd: '/srv/project',
    input: 'send exactly once after native resume',
    machineId,
    conversationId,
    projectId,
    actionId: 'act_remote_idle_resume01',
    turnId: 'turn_remote_idle_resume01',
  })
  await waitFor(() => events.some((event) => event.type === 'turn.completed'))
  assert.equal(firstSession.startTurnCalls, 0)
  assert.equal(resumedSession.startTurnCalls, 1)
  assert.equal(
    events.some((event) => event.type === 'turn.failed'),
    false,
  )
  await runtime.close()
})

function fakeSession(providerThreadId, options = {}) {
  return {
    machineId,
    conversationId,
    providerThreadId,
    closed: false,
    closeCalls: 0,
    startTurnCalls: 0,
    async startTurn() {
      this.startTurnCalls += 1
      return {
        async *events() {
          yield { type: 'message.delta', text: 'hello ', sequence: 1 }
          if (options.fail) throw new Error('controlled disconnect')
          yield { type: 'message.delta', text: 'world', sequence: 2 }
          yield { type: 'message.completed', sequence: 3 }
          yield { type: 'turn.completed', sequence: 4 }
        },
      }
    },
    async close() {
      this.closed = true
      this.closeCalls += 1
    },
  }
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setImmediate(resolve))
  }
  throw new Error('Timed out waiting for remote runtime event')
}

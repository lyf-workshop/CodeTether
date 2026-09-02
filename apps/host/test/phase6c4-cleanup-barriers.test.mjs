import assert from 'node:assert/strict'
import test from 'node:test'

import { RemoteClaudeHostRuntime } from '../dist/api/remote-claude-host-runtime.js'
import { RemoteCodexHostRuntime } from '../dist/api/remote-codex-host-runtime.js'

function deferred() {
  let resolve
  const promise = new Promise((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function providerScenarios() {
  return [
    {
      name: 'Codex',
      machineId: 'machine_cleanup_codex01',
      conversationId: 'conv_cleanup_codex01',
      projectId: 'proj_cleanup_codex01',
      createRuntime: (opener) =>
        new RemoteCodexHostRuntime({
          machineId: 'machine_cleanup_codex01',
          opener,
        }),
      createSession: (closeGate, closeFailure) =>
        fakeCodexSession(closeGate, closeFailure),
      startOptions: {
        cwd: '/srv/cleanup-codex',
        machineId: 'machine_cleanup_codex01',
        conversationId: 'conv_cleanup_codex01',
        projectId: 'proj_cleanup_codex01',
      },
    },
    {
      name: 'Claude',
      machineId: 'machine_cleanup_claude01',
      conversationId: 'conv_cleanup_claude01',
      projectId: 'proj_cleanup_claude01',
      createRuntime: (opener) =>
        new RemoteClaudeHostRuntime({
          machineId: 'machine_cleanup_claude01',
          opener,
        }),
      createSession: (closeGate, closeFailure) =>
        fakeClaudeSession(closeGate, closeFailure),
      startOptions: {
        cwd: '/srv/cleanup-claude',
        reasoning: 'high',
        machineId: 'machine_cleanup_claude01',
        conversationId: 'conv_cleanup_claude01',
        projectId: 'proj_cleanup_claude01',
      },
    },
  ]
}

test('remote Host runtimes serialize same-Conversation create and hydration behind exact cleanup', async (t) => {
  for (const scenario of providerScenarios()) {
    await t.test(scenario.name, async () => {
      const closeGate = deferred()
      const sessions = [
        scenario.createSession(closeGate.promise),
        scenario.createSession(Promise.resolve()),
      ]
      const opens = []
      const runtime = scenario.createRuntime({
        async open(options) {
          opens.push(options)
          return sessions[opens.length - 1]
        },
      })
      const created = await runtime.startConversation(scenario.startOptions)
      const disposing = runtime.disposeConversation({
        providerThreadId: created.providerThreadId,
      })
      await waitFor(() => sessions[0].closeCalls === 1, 'cleanup to begin')

      let createSettled = false
      let hydrateSettled = false
      const creating = runtime
        .startConversation(scenario.startOptions)
        .finally(() => {
          createSettled = true
        })
      const hydrating = runtime
        .resumeConversation({
          ...scenario.startOptions,
          providerThreadId: created.providerThreadId,
          providerSessionMaterialized: true,
        })
        .finally(() => {
          hydrateSettled = true
        })
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(createSettled, false)
      assert.equal(hydrateSettled, false)
      assert.equal(opens.length, 1)

      closeGate.resolve()
      await disposing
      const outcomes = await Promise.allSettled([creating, hydrating])
      assert.equal(
        outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
        1,
      )
      assert.equal(
        outcomes.filter((outcome) => outcome.status === 'rejected').length,
        1,
      )
      assert.equal(opens.length, 2)
      await runtime.close()
      assert.equal(sessions[1].closeCalls, 1)
    })
  }
})

test('remote Host cleanup failure permanently blocks same-Conversation create and hydration', async (t) => {
  for (const scenario of providerScenarios()) {
    await t.test(scenario.name, async () => {
      const cleanupFailure = new Error(`private ${scenario.name} cleanup`)
      const session = scenario.createSession(Promise.resolve(), cleanupFailure)
      const opens = []
      const runtime = scenario.createRuntime({
        async open(options) {
          opens.push(options)
          return session
        },
      })
      const created = await runtime.startConversation(scenario.startOptions)
      await assert.rejects(
        runtime.disposeConversation({
          providerThreadId: created.providerThreadId,
        }),
        /conversation is no longer available/u,
      )

      const outcomes = await Promise.allSettled([
        runtime.startConversation(scenario.startOptions),
        runtime.resumeConversation({
          ...scenario.startOptions,
          providerThreadId: created.providerThreadId,
          providerSessionMaterialized: true,
        }),
      ])
      assert.equal(
        outcomes.every(
          (outcome) =>
            outcome.status === 'rejected' &&
            /conversation is no longer available/u.test(String(outcome.reason)),
        ),
        true,
      )
      assert.equal(opens.length, 1)
      await runtime.close().catch(() => undefined)
    })
  }
})

function fakeCodexSession(closeGate, closeFailure) {
  return {
    machineId: 'machine_cleanup_codex01',
    conversationId: 'conv_cleanup_codex01',
    providerThreadId: 'native-cleanup-codex',
    closed: false,
    closeCalls: 0,
    async startTurn() {
      throw new Error('Turn execution is outside this cleanup test')
    },
    async close() {
      this.closed = true
      this.closeCalls += 1
      await closeGate
      if (closeFailure !== undefined) throw closeFailure
    },
  }
}

function fakeClaudeSession(closeGate, closeFailure) {
  let closed = false
  return {
    machineId: 'machine_cleanup_claude01',
    conversationId: 'conv_cleanup_claude01',
    providerSessionId: '123e4567-e89b-42d3-a456-426614174001',
    effort: 'high',
    closeCalls: 0,
    get closed() {
      return closed
    },
    async startTurn() {
      throw new Error('Turn execution is outside this cleanup test')
    },
    async close() {
      closed = true
      this.closeCalls += 1
      await closeGate
      if (closeFailure !== undefined) throw closeFailure
    },
  }
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setImmediate(resolve))
  }
  assert.fail(`Timed out waiting for ${label}`)
}

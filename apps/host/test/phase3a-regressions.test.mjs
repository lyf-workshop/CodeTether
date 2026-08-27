import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { HostSnapshotSchema } from '@codetether/protocol'

import { HostEventPublisher } from '../dist/api/host-event-publisher.js'
import { HostService, HostServiceError } from '../dist/api/host-service.js'
import { WorkspacePolicy } from '../dist/api/workspace-policy.js'
import { normalizeTrustedProjectRoot } from '../dist/project-path.js'
import {
  ConversationStore,
  DURABLE_TURN_SNAPSHOT_VERSION,
  restoreDurableConversations,
} from '../dist/persistence/index.js'

const timestamp = '2026-08-27T08:00:00.000Z'

class FakeRuntime {
  provider = 'codex'
  resumeCalls = []
  turnCalls = []
  approvalDecisions = []
  resumeDelayMs = 0
  turnDelayMs = 0
  #events = new Set()
  #failures = new Set()
  #approvals = new Set()

  subscribeEvents(listener) {
    this.#events.add(listener)
    return () => this.#events.delete(listener)
  }

  subscribeFailures(listener) {
    this.#failures.add(listener)
    return () => this.#failures.delete(listener)
  }

  subscribeApprovals(onRequest, onResolved) {
    const listeners = { onRequest, onResolved }
    this.#approvals.add(listeners)
    return () => this.#approvals.delete(listeners)
  }

  async startConversation(options) {
    return {
      providerThreadId: 'provider-thread-regression',
      model: options.model,
    }
  }

  async resumeConversation(options) {
    this.resumeCalls.push(options)
    await delay(this.resumeDelayMs)
    return { providerThreadId: options.providerThreadId }
  }

  async startTurn(options) {
    this.turnCalls.push(options)
    await delay(this.turnDelayMs)
    return {
      providerTurnId: `provider-turn-${String(this.turnCalls.length)}`,
    }
  }

  async interruptTurn() {}

  async close() {}

  requestApproval() {
    for (const listeners of this.#approvals) {
      listeners.onRequest({
        providerRequestId: 1,
        providerApprovalId: 'provider-approval-regression',
        providerThreadId: 'provider-thread-regression',
        providerTurnId: 'provider-turn-1',
        kind: 'command',
        summary: 'Run a safe command',
        respond: (decision) => this.approvalDecisions.push(decision),
      })
    }
  }
}

test('durable cwd is re-authorized before Provider resume', async () => {
  const environment = await createEnvironment()
  const removedRoot = join(environment.directory, 'removed-root')
  await mkdir(removedRoot)
  const store = ConversationStore.open({
    databasePath: environment.databasePath,
  })
  const projectId = seedProject(store, removedRoot)
  store.createConversation({
    conversationId: 'conv_regression_auth',
    projectId,
    provider: 'codex',
    providerThreadId: 'provider-thread-regression',
    cwd: removedRoot,
    status: 'completed',
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  await rm(removedRoot, { recursive: true })

  const runtime = new FakeRuntime()
  const service = new HostService({
    runtime,
    workspacePolicy: await WorkspacePolicy.create([environment.workspace]),
    publisher: publisher('10000000-0000-4000-8000-000000000001'),
    persistence: store,
    hostVersion: '0.0.0-test',
    now: () => new Date(timestamp),
  })
  try {
    await assert.rejects(
      service.startTurn('conv_regression_auth', {
        actionId: 'act_regression_auth',
        input: { type: 'text', text: 'Must not reach Codex' },
      }),
      (error) =>
        error instanceof HostServiceError &&
        error.code === 'project_unavailable',
    )
    assert.equal(runtime.resumeCalls.length, 0)
    assert.equal(runtime.turnCalls.length, 0)
  } finally {
    await service.close()
    await removeEnvironment(environment.directory)
  }
})

test('concurrent Turn starts serialize across lazy resume', async () => {
  const environment = await createEnvironment()
  const store = ConversationStore.open({
    databasePath: environment.databasePath,
  })
  const projectId = seedProject(store, environment.workspace)
  store.createConversation({
    conversationId: 'conv_regression_race',
    projectId,
    provider: 'codex',
    providerThreadId: 'provider-thread-regression',
    cwd: environment.workspace,
    status: 'completed',
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  const runtime = new FakeRuntime()
  runtime.resumeDelayMs = 20
  runtime.turnDelayMs = 20
  const service = new HostService({
    runtime,
    workspacePolicy: await WorkspacePolicy.create([environment.workspace]),
    publisher: publisher('10000000-0000-4000-8000-000000000002'),
    persistence: store,
    hostVersion: '0.0.0-test',
    now: () => new Date(timestamp),
  })
  try {
    const results = await Promise.allSettled([
      service.startTurn('conv_regression_race', {
        actionId: 'act_regression_race_a',
        input: { type: 'text', text: 'First' },
      }),
      service.startTurn('conv_regression_race', {
        actionId: 'act_regression_race_b',
        input: { type: 'text', text: 'Second' },
      }),
    ])
    assert.deepEqual(results.map((result) => result.status).sort(), [
      'fulfilled',
      'rejected',
    ])
    const rejection = results.find((result) => result.status === 'rejected')
    assert.ok(rejection?.reason instanceof HostServiceError)
    assert.equal(rejection.reason.code, 'conflict')
    assert.equal(runtime.resumeCalls.length, 1)
    assert.equal(runtime.turnCalls.length, 1)
    assert.equal(service.snapshot().activeTurns.length, 1)
  } finally {
    await service.close()
    await removeEnvironment(environment.directory)
  }
})

test('restore entry cap follows durable Turn chronology across Host epochs', async () => {
  const environment = await createEnvironment()
  const store = ConversationStore.open({
    databasePath: environment.databasePath,
  })
  const projectId = seedProject(store, environment.workspace)
  store.createConversation({
    conversationId: 'conv_regression_order',
    projectId,
    provider: 'codex',
    providerThreadId: 'provider-thread-regression',
    cwd: environment.workspace,
    status: 'completed',
    createdAt: timestamp,
    updatedAt: '2026-08-27T08:02:00.000Z',
  })
  store.createTurn(
    durableTurn('turn_regression_old', '2026-08-27T08:00:00.000Z', [
      message('turn_regression_old', 'item_regression_old_a', 100),
      message('turn_regression_old', 'item_regression_old_b', 101),
    ]),
  )
  store.createTurn(
    durableTurn('turn_regression_new', '2026-08-27T08:01:00.000Z', [
      message('turn_regression_new', 'item_regression_new_a', 1),
      message('turn_regression_new', 'item_regression_new_b', 2),
    ]),
  )
  try {
    const [restored] = restoreDurableConversations(store, {
      maxConversations: 1,
      maxTurns: 20,
      maxEntries: 2,
      now: '2026-08-27T08:03:00.000Z',
    })
    assert.deepEqual(
      restored.runtime.messages.map((entry) => String(entry.itemId)),
      ['item_regression_new_a', 'item_regression_new_b'],
    )
    assert.equal(restored.runtime.history.evictedMessages, 2)
  } finally {
    store.close()
    await removeEnvironment(environment.directory)
  }
})

test('restored presentation order remains unique and precedes the new Host epoch', async () => {
  const environment = await createEnvironment()
  const store = ConversationStore.open({
    databasePath: environment.databasePath,
  })
  const projectId = seedProject(store, environment.workspace)
  store.createConversation({
    conversationId: 'conv_regression_order',
    projectId,
    provider: 'codex',
    providerThreadId: 'provider-thread-regression',
    cwd: environment.workspace,
    status: 'completed',
    createdAt: timestamp,
    updatedAt: '2026-08-27T08:02:00.000Z',
  })
  store.createTurn(
    durableTurn('turn_regression_epoch_a', '2026-08-27T08:00:00.000Z', [
      message('turn_regression_epoch_a', 'item_regression_epoch_a', 2),
    ]),
  )
  store.createTurn(
    durableTurn('turn_regression_epoch_b', '2026-08-27T08:01:00.000Z', [
      message('turn_regression_epoch_b', 'item_regression_epoch_b', 2),
    ]),
  )
  const eventPublisher = publisher('10000000-0000-4000-8000-000000000005')
  const service = new HostService({
    runtime: new FakeRuntime(),
    workspacePolicy: await WorkspacePolicy.create([environment.workspace]),
    publisher: eventPublisher,
    persistence: store,
    hostVersion: '0.0.0-test',
    now: () => new Date(timestamp),
  })
  try {
    const restored = HostSnapshotSchema.parse(service.snapshot())
    assert.deepEqual(
      restored.conversationRuntimes[0].messages.map((message) => message.order),
      [1, 2],
    )
    assert.equal(restored.currentSeq, 2)

    await service.startTurn('conv_regression_order', {
      actionId: 'act_regression_next_epoch',
      input: { type: 'text', text: 'Continue after another Host restart' },
    })
    assert.equal(eventPublisher.currentSeq, 3)
  } finally {
    await service.close()
    await removeEnvironment(environment.directory)
  }
})

test('approval persistence failure keeps the fail-closed Snapshot coherent', async () => {
  const environment = await createEnvironment()
  const actualStore = ConversationStore.open({
    databasePath: environment.databasePath,
  })
  const store = new Proxy(actualStore, {
    get(target, property) {
      if (property === 'updateTurn') {
        return (turn) => {
          if (turn.status === 'waiting')
            throw new Error('approval disk failure')
          return target.updateTurn(turn)
        }
      }
      const value = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const runtime = new FakeRuntime()
  const service = new HostService({
    runtime,
    workspacePolicy: await WorkspacePolicy.create([environment.workspace]),
    publisher: publisher('10000000-0000-4000-8000-000000000004'),
    persistence: store,
    hostVersion: '0.0.0-test',
    now: () => new Date(timestamp),
  })
  try {
    await service.registerInitialProjectRoots([environment.workspace])
    const created = await service.createConversation({
      actionId: 'act_regression_approval_create',
      provider: 'codex',
      cwd: environment.workspace,
    })
    await service.startTurn(created.data.conversation.conversationId, {
      actionId: 'act_regression_approval_turn',
      input: { type: 'text', text: 'Request approval' },
    })
    assert.throws(() => runtime.requestApproval(), /durability is unavailable/u)

    const snapshot = HostSnapshotSchema.parse(service.snapshot())
    assert.equal(snapshot.conversations[0]?.status, 'failed')
    assert.equal(snapshot.conversations[0]?.activeTurnId, undefined)
    assert.equal(snapshot.activeTurns.length, 0)
    assert.equal(snapshot.pendingApprovals.length, 0)
    assert.deepEqual(runtime.approvalDecisions, ['decline'])
    assert.equal(service.bootstrap().capabilities.codex, false)
  } finally {
    await service.close().catch(() => undefined)
    await removeEnvironment(environment.directory)
  }
})

function seedProject(store, rootPath) {
  const projectId = 'proj_phase3a_regression'
  const canonical = normalizeTrustedProjectRoot(rootPath)
  store.createProject({
    projectId,
    name: 'Phase 3A regression',
    rootPath: canonical.rootPath,
    rootPathKey: canonical.rootPathKey,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  return projectId
}

function publisher(epoch) {
  return new HostEventPublisher({ epoch })
}

function durableTurn(turnId, startedAt, messages) {
  const completedAt = new Date(Date.parse(startedAt) + 30_000).toISOString()
  const input = { type: 'text', text: turnId, timestamp: startedAt }
  const turn = {
    turnId,
    conversationId: 'conv_regression_order',
    status: 'completed',
    input,
    startedAt,
    completedAt,
  }
  return {
    turnId,
    conversationId: 'conv_regression_order',
    providerTurnId: `provider-${turnId}`,
    input,
    status: 'completed',
    startedAt,
    completedAt,
    snapshotVersion: DURABLE_TURN_SNAPSHOT_VERSION,
    snapshot: {
      turn,
      messages,
      tools: [],
      changes: [],
      approvals: [],
      presentationTruncated: false,
    },
  }
}

function message(turnId, itemId, order) {
  return {
    turnId,
    itemId,
    text: itemId,
    status: 'completed',
    timestamp,
    order,
  }
}

async function createEnvironment() {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-phase3a-regression-'),
  )
  const workspace = join(directory, 'workspace')
  await mkdir(workspace)
  return {
    directory,
    workspace,
    databasePath: join(directory, 'data', 'codetether.sqlite3'),
  }
}

async function removeEnvironment(directory) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true })
      return
    } catch (error) {
      if (
        process.platform !== 'win32' ||
        (error?.code !== 'EBUSY' && error?.code !== 'EPERM') ||
        attempt === 9
      ) {
        throw error
      }
      await delay(25)
    }
  }
}

async function delay(milliseconds) {
  if (milliseconds <= 0) return
  await new Promise((resolve) => setTimeout(resolve, milliseconds))
}

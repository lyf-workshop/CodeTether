import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { Worker } from 'node:worker_threads'

import { HostEventPublisher } from '../dist/api/host-event-publisher.js'
import { ProviderConversationUnavailableError } from '../dist/api/agent-runtime.js'
import {
  HostService,
  HostServiceError,
  newEpoch,
} from '../dist/api/host-service.js'
import { WorkspacePolicy } from '../dist/api/workspace-policy.js'
import {
  ConversationStore,
  NativeProviderSessionBindingConflictError,
  currentSchemaVersion,
  restoreDurableConversations,
} from '../dist/persistence/index.js'
import { normalizeTrustedProjectRoot } from '../dist/project-path.js'
import { downgradeExistingProviderSessionsToVersionFourteen } from './fixtures/existing-provider-sessions-v14.mjs'

const timestamp = '2026-10-01T12:00:00.000Z'

test('migration 015 backfills CodeTether origin and materialized native-session truth', async (t) => {
  const fixture = await createFixture(t)
  const store = ConversationStore.open({ databasePath: fixture.databasePath })
  store.createConversation(
    conversation(fixture, 'conv_phase8a_unmaterialized', {
      providerThreadId: 'native-session-unmaterialized',
    }),
  )
  store.createConversation(
    conversation(fixture, 'conv_phase8a_materialized', {
      providerThreadId: 'native-session-materialized',
    }),
  )
  store.createTurn({
    turnId: 'turn_phase8a_materialized',
    conversationId: 'conv_phase8a_materialized',
    providerTurnId: 'provider-turn-phase8a-materialized',
    input: { type: 'text', text: 'Synthetic migration marker', timestamp },
    status: 'completed',
    startedAt: timestamp,
    completedAt: timestamp,
    snapshotVersion: 1,
    snapshot: { migration: 15 },
  })
  store.close()

  const downgrade = new DatabaseSync(fixture.databasePath)
  downgradeExistingProviderSessionsToVersionFourteen(downgrade)
  downgrade.close()

  const migrated = ConversationStore.open({
    databasePath: fixture.databasePath,
  })
  assert.equal(currentSchemaVersion, 15)
  assert.equal(migrated.schemaVersion, 15)
  assert.deepEqual(
    pickSessionState(migrated.getConversation('conv_phase8a_unmaterialized')),
    { origin: 'codetether', providerSessionMaterialized: false },
  )
  assert.deepEqual(
    pickSessionState(migrated.getConversation('conv_phase8a_materialized')),
    { origin: 'codetether', providerSessionMaterialized: true },
  )
  migrated.close()

  const inspect = new DatabaseSync(fixture.databasePath)
  assert.equal(
    inspect
      .prepare(
        `SELECT COUNT(*) AS count FROM sqlite_master
         WHERE type = 'index' AND name = 'idx_conversations_provider_session_identity'`,
      )
      .get().count,
    1,
  )
  assert.deepEqual(inspect.prepare('PRAGMA foreign_key_check').all(), [])
  inspect.close()
})

test('sequential and concurrent duplicate adoption converge on one durable Conversation', async (t) => {
  const fixture = await createFixture(t)
  const store = ConversationStore.open({ databasePath: fixture.databasePath })
  const firstInput = adoptedConversation(fixture, 'conv_phase8a_adopted_first')
  const duplicateInput = adoptedConversation(
    fixture,
    'conv_phase8a_adopted_duplicate',
  )

  const first = store.createOrGetAdoptedConversation(firstInput)
  const sequential = store.createOrGetAdoptedConversation(duplicateInput)

  assert.equal(first.created, true)
  assert.equal(sequential.created, false)
  assert.equal(first.conversation.conversationId, firstInput.conversationId)
  assert.equal(
    sequential.conversation.conversationId,
    first.conversation.conversationId,
  )
  assert.equal(store.listConversations().length, 1)
  assert.deepEqual(pickSessionState(first.conversation), {
    origin: 'adopted_native',
    providerSessionMaterialized: true,
  })
  assert.equal(
    store.getConversationByProviderSession(
      fixture.machineId,
      'codex',
      firstInput.providerThreadId,
    )?.conversationId,
    first.conversation.conversationId,
  )

  store.close()
  const concurrentInput = adoptedConversation(
    fixture,
    'conv_phase8a_adopted_race_a',
  )
  const [concurrentA, concurrentB] = await raceConcurrentAdoptions(
    fixture.databasePath,
    [
      {
        ...concurrentInput,
        providerThreadId: 'native-session-phase8a-concurrent',
      },
      {
        ...concurrentInput,
        conversationId: 'conv_phase8a_adopted_race_b',
        providerThreadId: 'native-session-phase8a-concurrent',
      },
    ],
  )
  assert.deepEqual([concurrentA.created, concurrentB.created].sort(), [
    false,
    true,
  ])
  assert.equal(concurrentA.conversationId, concurrentB.conversationId)

  const verify = ConversationStore.open({ databasePath: fixture.databasePath })
  assert.equal(verify.listConversations().length, 2)

  assert.throws(
    () =>
      verify.createConversation(
        conversation(fixture, 'conv_phase8a_index_duplicate', {
          providerThreadId: firstInput.providerThreadId,
        }),
      ),
    /UNIQUE constraint failed/u,
  )

  const otherProject = createProjectRecord(
    fixture,
    'proj_phase8a_other',
    join(fixture.directory, 'other-workspace'),
  )
  await mkdir(otherProject.locations[0].rootPath, { recursive: true })
  verify.createProject(otherProject)
  assert.throws(
    () =>
      verify.createOrGetAdoptedConversation({
        ...duplicateInput,
        conversationId: 'conv_phase8a_wrong_project',
        projectId: otherProject.projectId,
        cwd: otherProject.locations[0].rootPath,
      }),
    NativeProviderSessionBindingConflictError,
  )
  verify.close()
})

test('adopted zero-Turn Conversations hydrate as materialized native sessions', async (t) => {
  const fixture = await createFixture(t)
  const store = ConversationStore.open({ databasePath: fixture.databasePath })
  const adopted = store.createOrGetAdoptedConversation(
    adoptedConversation(fixture, 'conv_phase8a_hydration'),
  )

  const [restored] = restoreDurableConversations(store, {
    maxConversations: 8,
    maxTurns: 20,
    maxEntries: 512,
    now: timestamp,
  })
  assert.ok(restored)
  assert.equal(
    restored.record.conversationId,
    adopted.conversation.conversationId,
  )
  assert.equal(restored.origin, 'adopted_native')
  assert.equal(restored.providerSessionMaterialized, true)
  assert.equal(restored.runtime.turns.length, 0)
  store.close()
})

test('Host hydration resumes an adopted zero-Turn session without creating one', async (t) => {
  const fixture = await createFixture(t)
  const seed = ConversationStore.open({ databasePath: fixture.databasePath })
  const adopted = seed.createOrGetAdoptedConversation(
    adoptedConversation(fixture, 'conv_phase8a_host_hydration'),
  )
  seed.close()

  const runtime = new ResumeOnlyRuntime()
  const persistence = ConversationStore.open({
    databasePath: fixture.databasePath,
  })
  const service = new HostService({
    runtime,
    persistence,
    workspacePolicy: await WorkspacePolicy.create([fixture.workspace]),
    publisher: new HostEventPublisher({ epoch: newEpoch() }),
    hostVersion: 'phase8a-test',
    now: () => new Date(timestamp),
  })
  try {
    await service.startTurn(adopted.conversation.conversationId, {
      actionId: 'act_phase8a_adopted_resume',
      input: { type: 'text', text: 'Continue the adopted session' },
    })
    assert.equal(runtime.startConversationCalls, 0)
    assert.equal(runtime.resumeCalls.length, 1)
    assert.equal(
      runtime.resumeCalls[0].providerThreadId,
      'native-session-phase8a-adoption',
    )
    assert.equal(runtime.resumeCalls[0].providerSessionMaterialized, true)
    assert.equal(runtime.turnCalls.length, 1)
    const afterResume = await service.getConversation(
      adopted.conversation.conversationId,
    )
    assert.equal(afterResume.conversation.title, 'Existing provider session')
    assert.equal(afterResume.conversation.origin, 'adopted_native')
  } finally {
    await service.close()
  }
})

test('removed native session leaves its adopted Conversation and private binding intact while resume fails closed', async (t) => {
  const fixture = await createFixture(t)
  const seed = ConversationStore.open({ databasePath: fixture.databasePath })
  const adopted = seed.createOrGetAdoptedConversation(
    adoptedConversation(fixture, 'conv_phase8a_removed_native'),
  )
  seed.close()

  const runtime = new ResumeOnlyRuntime()
  runtime.resumeError = new ProviderConversationUnavailableError(
    'codex',
    'native-session-phase8a-adoption',
  )
  const persistence = ConversationStore.open({
    databasePath: fixture.databasePath,
  })
  const service = new HostService({
    runtime,
    persistence,
    workspacePolicy: await WorkspacePolicy.create([fixture.workspace]),
    publisher: new HostEventPublisher({ epoch: newEpoch() }),
    hostVersion: 'phase8a-test',
    now: () => new Date(timestamp),
  })
  try {
    await assert.rejects(
      service.startTurn(adopted.conversation.conversationId, {
        actionId: 'act_phase8a_removed_native_resume',
        input: { type: 'text', text: 'Explicit continuation after removal' },
      }),
      (error) => {
        assert.ok(error instanceof HostServiceError)
        assert.equal(error.code, 'provider_session_lost')
        assert.equal(error.failure?.reason, 'provider_session_lost')
        return true
      },
    )

    assert.equal(runtime.startConversationCalls, 0)
    assert.equal(runtime.resumeCalls.length, 1)
    assert.equal(runtime.turnCalls.length, 0)
    const detail = service.getConversation(adopted.conversation.conversationId)
    assert.equal(detail.conversation.origin, 'adopted_native')
    assert.equal(detail.runtime.turns.length, 1)
    assert.equal(detail.runtime.turns[0].status, 'failed')
    assert.equal(
      detail.runtime.turns[0].error?.failure?.reason,
      'provider_session_lost',
    )

    const durable = persistence.getConversation(
      adopted.conversation.conversationId,
    )
    assert.ok(durable)
    assert.equal(durable.providerThreadId, 'native-session-phase8a-adoption')
    assert.equal(durable.providerSessionMaterialized, true)
    assert.equal(durable.origin, 'adopted_native')
    assert.equal(
      persistence.getConversationByProviderSession(
        fixture.machineId,
        'codex',
        'native-session-phase8a-adoption',
      )?.conversationId,
      adopted.conversation.conversationId,
    )
  } finally {
    await service.close()
  }

  const restarted = ConversationStore.open({
    databasePath: fixture.databasePath,
  })
  try {
    const durable = restarted.getConversation(
      adopted.conversation.conversationId,
    )
    assert.ok(durable)
    assert.equal(durable.providerThreadId, 'native-session-phase8a-adoption')
    assert.equal(durable.providerSessionMaterialized, true)
    assert.equal(durable.origin, 'adopted_native')
    assert.equal(
      restarted.listTurns(adopted.conversation.conversationId).length,
      1,
    )
  } finally {
    restarted.close()
  }
})

test('organization changes on an adopted Conversation never replace its private native binding', async (t) => {
  const fixture = await createFixture(t)
  const persistence = ConversationStore.open({
    databasePath: fixture.databasePath,
  })
  const adopted = persistence.createOrGetAdoptedConversation(
    adoptedConversation(fixture, 'conv_phase8a_adopted_organization'),
  )
  const runtime = new ResumeOnlyRuntime()
  const service = new HostService({
    runtime,
    persistence,
    workspacePolicy: await WorkspacePolicy.create([fixture.workspace]),
    publisher: new HostEventPublisher({ epoch: newEpoch() }),
    hostVersion: 'phase8a-test',
    now: () => new Date(timestamp),
  })
  try {
    const renamed = await service.renameConversation(
      adopted.conversation.conversationId,
      {
        actionId: 'act_phase8a_adopted_organization_rename',
        title: 'Renamed adopted conversation',
      },
    )
    assert.equal(
      renamed.data.conversation.title,
      'Renamed adopted conversation',
    )
    const pinned = await service.pinConversation(
      adopted.conversation.conversationId,
      { actionId: 'act_phase8a_adopted_organization_pin' },
    )
    assert.ok(pinned.data.conversation.pinnedAt)
    const archived = await service.archiveConversation(
      adopted.conversation.conversationId,
      { actionId: 'act_phase8a_adopted_organization_archive' },
    )
    assert.ok(archived.data.conversation.archivedAt)
    assert.equal(archived.data.conversation.pinnedAt, undefined)
    const restored = await service.unarchiveConversation(
      adopted.conversation.conversationId,
      { actionId: 'act_phase8a_adopted_organization_restore' },
    )
    assert.equal(restored.data.conversation.archivedAt, undefined)
    assert.equal(restored.data.conversation.origin, 'adopted_native')

    const durable = persistence.getConversation(
      adopted.conversation.conversationId,
    )
    assert.ok(durable)
    assert.equal(durable.providerThreadId, 'native-session-phase8a-adoption')
    assert.equal(durable.providerSessionMaterialized, true)
    assert.equal(durable.origin, 'adopted_native')
    assert.equal(runtime.startConversationCalls, 0)
    assert.equal(runtime.resumeCalls.length, 0)
    assert.equal(runtime.turnCalls.length, 0)
  } finally {
    await service.close()
  }
})

async function createFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-phase8a-store-'))
  const workspace = join(directory, 'workspace')
  const databasePath = join(directory, 'codetether.sqlite3')
  await mkdir(workspace, { recursive: true })
  const store = ConversationStore.open({ databasePath })
  const machine = store.listMachines()[0]
  assert.ok(machine)
  const fixture = {
    directory,
    workspace,
    databasePath,
    machineId: machine.machineId,
    projectId: 'proj_phase8a_store',
  }
  store.createProject(
    createProjectRecord(fixture, fixture.projectId, fixture.workspace),
  )
  store.close()
  t.after(async () => {
    await rm(directory, { recursive: true, force: true, maxRetries: 5 })
  })
  return fixture
}

function createProjectRecord(fixture, projectId, workspace) {
  const root = normalizeTrustedProjectRoot(workspace)
  return {
    projectId,
    name: projectId,
    locations: [
      {
        projectId,
        machineId: fixture.machineId,
        rootPath: root.rootPath,
        rootPathKey: root.rootPathKey,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function conversation(fixture, conversationId, overrides = {}) {
  return {
    conversationId,
    projectId: fixture.projectId,
    machineId: fixture.machineId,
    title: 'Existing provider session',
    provider: 'codex',
    cwd: fixture.workspace,
    status: 'idle',
    createdAt: timestamp,
    updatedAt: timestamp,
    lastActivityAt: timestamp,
    ...overrides,
  }
}

function adoptedConversation(fixture, conversationId) {
  return conversation(fixture, conversationId, {
    providerThreadId: 'native-session-phase8a-adoption',
  })
}

function pickSessionState(conversation) {
  assert.ok(conversation)
  return {
    origin: conversation.origin,
    providerSessionMaterialized: conversation.providerSessionMaterialized,
  }
}

async function raceConcurrentAdoptions(databasePath, conversations) {
  const workerUrl = new URL(
    './fixtures/concurrent-adoption-worker.mjs',
    import.meta.url,
  )
  const workers = conversations.map(
    (conversation) =>
      new Worker(workerUrl, {
        workerData: { databasePath, conversation },
      }),
  )
  try {
    const readyMessages = await Promise.all(
      workers.map(async (worker) => (await once(worker, 'message'))[0]),
    )
    assert.ok(readyMessages.every((message) => message.type === 'ready'))
    const resultPromises = workers.map(async (worker) => {
      const [message] = await once(worker, 'message')
      return message
    })
    const exitPromises = workers.map((worker) => once(worker, 'exit'))
    for (const worker of workers) worker.postMessage('start')
    const results = await Promise.all(resultPromises)
    assert.ok(results.every((result) => result.type === 'result'))
    await Promise.all(exitPromises)
    return results
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()))
  }
}

class ResumeOnlyRuntime {
  provider = 'codex'
  startConversationCalls = 0
  resumeCalls = []
  turnCalls = []
  #eventListeners = new Set()
  #failureListeners = new Set()

  subscribeEvents(listener) {
    this.#eventListeners.add(listener)
    return () => this.#eventListeners.delete(listener)
  }

  subscribeFailures(listener) {
    this.#failureListeners.add(listener)
    return () => this.#failureListeners.delete(listener)
  }

  subscribeApprovals() {
    return () => undefined
  }

  async startConversation() {
    this.startConversationCalls += 1
    throw new Error('Adopted session must not create a Provider session')
  }

  async resumeConversation(options) {
    this.resumeCalls.push(options)
    if (this.resumeError !== undefined) throw this.resumeError
    return { providerThreadId: options.providerThreadId }
  }

  async startTurn(options) {
    this.turnCalls.push(options)
    return { providerTurnId: 'provider-turn-phase8a-adopted-resume' }
  }

  async interruptTurn() {}

  async close() {}
}

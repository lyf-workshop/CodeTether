import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import {
  ConversationStore,
  currentSchemaVersion,
} from '../dist/persistence/index.js'
import { normalizeTrustedProjectRoot } from '../dist/project-path.js'

const startedAt = '2026-09-07T12:00:00.000Z'

test('migration 017 distinguishes a fresh database from an existing user without copying readiness', async (t) => {
  const fixture = await createFixture(t)
  let store = ConversationStore.open({ databasePath: fixture.databasePath })
  assert.equal(currentSchemaVersion, 18)
  assert.deepEqual(store.getOnboardingProgress(), {
    flowVersion: 1,
    step: 'welcome',
    revision: 1,
    startedAt: store.getOnboardingProgress().startedAt,
    updatedAt: store.getOnboardingProgress().updatedAt,
  })
  const machine = store.listMachines()[0]
  store.createProject(project(fixture.projectRoot, machine.machineId))
  store.close()

  const v16 = new DatabaseSync(fixture.databasePath)
  v16.exec(`
    ALTER TABLE conversations DROP COLUMN native_transcript_boundary;
    DROP TABLE onboarding_progress;
    DELETE FROM schema_migrations WHERE version IN (17, 18);
  `)
  v16.close()

  store = ConversationStore.open({ databasePath: fixture.databasePath })
  const migrated = store.getOnboardingProgress()
  assert.equal(migrated.step, 'ready')
  assert.equal(migrated.revision, 1)
  assert.ok(migrated.completedAt)
  assert.equal(migrated.projectId, undefined)
  assert.equal(migrated.machineId, undefined)
  store.close()

  const inspect = new DatabaseSync(fixture.databasePath)
  const columns = inspect
    .prepare('PRAGMA table_info(onboarding_progress)')
    .all()
    .map(({ name }) => name)
  for (const forbidden of [
    'provider_readiness',
    'backend_readiness',
    'provider_installation_id',
    'project_path',
    'credential',
  ]) {
    assert.equal(columns.includes(forbidden), false)
  }
  inspect.close()
})

test('onboarding transitions are resumable, revision guarded, restart idempotent, and completion monotonic', async (t) => {
  const fixture = await createFixture(t)
  let store = ConversationStore.open({ databasePath: fixture.databasePath })
  const machine = store.listMachines()[0]
  store.createProject(project(fixture.projectRoot, machine.machineId))

  let current = store.getOnboardingProgress()
  for (const [actionId, expectedStep] of [
    ['act_onboarding_continue01', 'computer_check'],
    ['act_onboarding_continue02', 'provider_check'],
    ['act_onboarding_continue03', 'project_setup'],
  ]) {
    const result = store.updateOnboardingProgress(
      {
        actionId,
        expectedRevision: current.revision,
        transition: { kind: 'continue' },
      },
      nextTimestamp(current.revision),
    )
    assert.equal(result.status, 'updated')
    assert.equal(result.onboarding.step, expectedStep)
    current = result.onboarding
  }

  const selectedRequest = {
    actionId: 'act_onboarding_project01',
    expectedRevision: current.revision,
    transition: {
      kind: 'project_selected',
      projectId: 'proj_onboarding01',
      machineId: machine.machineId,
    },
  }
  let result = store.updateOnboardingProgress(
    selectedRequest,
    nextTimestamp(current.revision),
  )
  assert.equal(result.status, 'updated')
  assert.equal(result.onboarding.step, 'previous_conversations')
  current = result.onboarding

  result = store.updateOnboardingProgress(
    {
      actionId: 'act_onboarding_previous01',
      expectedRevision: current.revision,
      transition: {
        kind: 'previous_conversations_finished',
        disposition: 'skipped',
      },
    },
    nextTimestamp(current.revision),
  )
  assert.equal(result.status, 'updated')
  current = result.onboarding

  result = store.updateOnboardingProgress(
    {
      actionId: 'act_onboarding_remote01',
      expectedRevision: current.revision,
      transition: { kind: 'remote_setup_finished', disposition: 'skipped' },
    },
    nextTimestamp(current.revision),
  )
  assert.equal(result.status, 'updated')
  assert.equal(result.onboarding.step, 'ready')
  const completedAt = result.onboarding.completedAt
  assert.ok(completedAt)
  current = result.onboarding
  store.close()

  store = ConversationStore.open({ databasePath: fixture.databasePath })
  const duplicate = store.updateOnboardingProgress(
    {
      actionId: 'act_onboarding_remote01',
      expectedRevision: current.revision - 1,
      transition: { kind: 'remote_setup_finished', disposition: 'skipped' },
    },
    nextTimestamp(current.revision + 1),
  )
  assert.equal(duplicate.status, 'unchanged')
  assert.equal(duplicate.onboarding.revision, current.revision)

  const conflict = store.updateOnboardingProgress(
    {
      actionId: 'act_onboarding_stale01',
      expectedRevision: 1,
      transition: { kind: 'continue' },
    },
    nextTimestamp(current.revision + 2),
  )
  assert.equal(conflict.status, 'revision_conflict')

  result = store.updateOnboardingProgress(
    {
      actionId: 'act_onboarding_reopen01',
      expectedRevision: current.revision,
      transition: { kind: 'reopen' },
    },
    nextTimestamp(current.revision + 3),
  )
  assert.equal(result.status, 'updated')
  assert.equal(result.onboarding.step, 'welcome')
  assert.equal(result.onboarding.completedAt, completedAt)
  store.close()
})

test('deleting a selected ProjectLocation preserves data and allows resumable project re-selection', async (t) => {
  const fixture = await createFixture(t)
  let store = ConversationStore.open({ databasePath: fixture.databasePath })
  const machine = store.listMachines()[0]
  store.createProject(project(fixture.projectRoot, machine.machineId))
  let current = store.getOnboardingProgress()
  for (let index = 0; index < 3; index += 1) {
    const result = store.updateOnboardingProgress(
      {
        actionId: `act_onboarding_fk_continue${String(index)}`,
        expectedRevision: current.revision,
        transition: { kind: 'continue' },
      },
      nextTimestamp(current.revision),
    )
    assert.equal(result.status, 'updated')
    current = result.onboarding
  }
  const selected = store.updateOnboardingProgress(
    {
      actionId: 'act_onboarding_fk_project',
      expectedRevision: current.revision,
      transition: {
        kind: 'project_selected',
        projectId: 'proj_onboarding01',
        machineId: machine.machineId,
      },
    },
    nextTimestamp(current.revision),
  )
  assert.equal(selected.status, 'updated')
  store.close()

  const database = new DatabaseSync(fixture.databasePath)
  database.exec('PRAGMA foreign_keys = ON')
  database
    .prepare('DELETE FROM projects WHERE project_id = ?')
    .run('proj_onboarding01')
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])
  database.close()

  store = ConversationStore.open({ databasePath: fixture.databasePath })
  const retained = store.getOnboardingProgress()
  assert.equal(retained.projectId, undefined)
  assert.equal(retained.machineId, undefined)
  assert.equal(retained.step, 'previous_conversations')
  assert.equal(retained.revision, selected.onboarding.revision)

  const invalidAdvance = store.updateOnboardingProgress(
    {
      actionId: 'act_onboarding_fk_previous',
      expectedRevision: retained.revision,
      transition: {
        kind: 'previous_conversations_finished',
        disposition: 'skipped',
      },
    },
    nextTimestamp(retained.revision),
  )
  assert.equal(invalidAdvance.status, 'invalid_transition')

  const recovered = store.updateOnboardingProgress(
    {
      actionId: 'act_onboarding_fk_reselect',
      expectedRevision: retained.revision,
      transition: { kind: 'project_reselect' },
    },
    nextTimestamp(retained.revision + 1),
  )
  assert.equal(recovered.status, 'updated')
  assert.equal(recovered.onboarding.step, 'project_setup')
  assert.equal(recovered.onboarding.projectId, undefined)
  assert.equal(recovered.onboarding.machineId, undefined)
  store.close()
})

function project(rootPath, machineId) {
  const normalized = normalizeTrustedProjectRoot(rootPath)
  return {
    projectId: 'proj_onboarding01',
    name: 'Onboarding fixture',
    locations: [
      {
        projectId: 'proj_onboarding01',
        machineId,
        rootPath: normalized.rootPath,
        rootPathKey: normalized.rootPathKey,
        createdAt: startedAt,
        updatedAt: startedAt,
      },
    ],
    createdAt: startedAt,
    updatedAt: startedAt,
  }
}

function nextTimestamp(revision) {
  return new Date(Date.parse(startedAt) + revision * 1_000).toISOString()
}

async function createFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-onboarding-'))
  const databasePath = join(directory, 'codetether.sqlite3')
  const projectRoot = join(directory, 'project')
  await mkdir(projectRoot)
  t.after(async () => {
    await rm(directory, { recursive: true, force: true })
  })
  return { databasePath, projectRoot }
}

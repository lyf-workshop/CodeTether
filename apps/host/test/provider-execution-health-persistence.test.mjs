import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import {
  ConversationStore,
  currentSchemaVersion,
  providerExecutionHealthFailureMaximumBytes,
} from '../dist/persistence/index.js'

const observedAt = '2026-09-02T12:00:00.000Z'
const olderObservedAt = '2026-09-02T11:59:00.000Z'
const laterObservedAt = '2026-09-02T12:01:00.000Z'

test('migration 013 adds Provider execution health transactionally', () => {
  withDatabase((databasePath) => {
    const seed = ConversationStore.open({ databasePath })
    seed.close()

    const downgrade = new DatabaseSync(databasePath)
    downgrade.exec(`
      DELETE FROM schema_migrations WHERE version = 13;
      DROP TABLE machine_provider_execution_health;
      CREATE TABLE machine_provider_execution_health (
        blocked INTEGER
      ) STRICT;
    `)
    downgrade.close()

    assert.throws(
      () => ConversationStore.open({ databasePath }),
      /machine_provider_execution_health already exists/u,
    )

    const rolledBack = new DatabaseSync(databasePath)
    assert.equal(
      rolledBack
        .prepare('SELECT MAX(version) AS version FROM schema_migrations')
        .get().version,
      12,
    )
    assert.deepEqual(rolledBack.prepare('PRAGMA foreign_key_check').all(), [])
    rolledBack.exec('DROP TABLE machine_provider_execution_health')
    rolledBack.close()

    const migrated = ConversationStore.open({ databasePath })
    assert.equal(migrated.schemaVersion, currentSchemaVersion)
    assert.equal(currentSchemaVersion, 13)
    const machineId = migrated.listMachines()[0].machineId
    assert.deepEqual(migrated.listProviderExecutionHealth(machineId), [])
    migrated.close()

    const bounded = new DatabaseSync(databasePath)
    assert.throws(
      () =>
        bounded
          .prepare(
            `INSERT INTO machine_provider_execution_health (
               machine_id, provider, state, failure_json, observed_at
             ) VALUES (?, 'codex', 'unknown', ?, ?)`,
          )
          .run(machineId, JSON.stringify('x'.repeat(4_096)), observedAt),
      /CHECK constraint failed/u,
    )
    assert.throws(
      () =>
        bounded
          .prepare(
            `INSERT INTO machine_provider_execution_health (
               machine_id, provider, state, failure_json, observed_at
             ) VALUES (?, 'codex', 'unknown', '{}', ?)`,
          )
          .run(machineId, observedAt),
      /CHECK constraint failed/u,
    )
    bounded.close()
  })
})

test('latest Provider execution health replaces durably and cascades with its Machine', () => {
  withDatabase((databasePath) => {
    const machineId = 'machine_providerhealth01'
    const initialFailure = canonicalFailure('provider_crashed', observedAt)
    const store = ConversationStore.open({ databasePath })
    const candidate = remoteCandidate(machineId)
    store.createRemoteMachineWithTrust(candidate.machine, candidate.trust)

    const unavailable = store.recordProviderExecutionHealth({
      machineId,
      provider: 'codex',
      state: 'unavailable',
      failure: initialFailure,
      observedAt,
    })
    assert.deepEqual(unavailable, {
      machineId,
      provider: 'codex',
      state: 'unavailable',
      failure: initialFailure,
      observedAt,
    })

    assert.deepEqual(
      store.recordProviderExecutionHealth({
        machineId,
        provider: 'codex',
        state: 'healthy',
        observedAt: olderObservedAt,
      }),
      unavailable,
    )
    assert.throws(
      () =>
        store.recordProviderExecutionHealth({
          machineId,
          provider: 'codex',
          state: 'healthy',
          failure: initialFailure,
          observedAt: laterObservedAt,
        }),
      /Healthy or unknown execution state cannot carry a failure/u,
    )
    store.close()

    const reopened = ConversationStore.open({ databasePath })
    assert.deepEqual(
      reopened.getProviderExecutionHealth(machineId, 'codex'),
      unavailable,
    )
    assert.deepEqual(
      reopened.recordProviderExecutionHealth({
        machineId,
        provider: 'codex',
        state: 'healthy',
        observedAt: laterObservedAt,
      }),
      {
        machineId,
        provider: 'codex',
        state: 'healthy',
        observedAt: laterObservedAt,
      },
    )
    const claudeFailure = canonicalFailure('rate_limited', laterObservedAt)
    reopened.recordProviderExecutionHealth({
      machineId,
      provider: 'claude-code',
      state: 'degraded',
      failure: claudeFailure,
      observedAt: laterObservedAt,
    })
    assert.deepEqual(reopened.listProviderExecutionHealth(machineId), [
      {
        machineId,
        provider: 'codex',
        state: 'healthy',
        observedAt: laterObservedAt,
      },
      {
        machineId,
        provider: 'claude-code',
        state: 'degraded',
        failure: claudeFailure,
        observedAt: laterObservedAt,
      },
    ])

    const inspect = new DatabaseSync(databasePath)
    const rows = inspect
      .prepare(
        `SELECT provider, failure_json
         FROM machine_provider_execution_health
         WHERE machine_id = ?
         ORDER BY provider`,
      )
      .all(machineId)
    assert.equal(rows.length, 2)
    const retainedFailure = rows.find(
      (row) => row.provider === 'claude-code',
    ).failure_json
    assert.ok(
      Buffer.byteLength(retainedFailure, 'utf8') <=
        providerExecutionHealthFailureMaximumBytes,
    )
    inspect.close()

    assert.equal(reopened.deleteRemoteMachine(machineId), true)
    assert.deepEqual(reopened.listProviderExecutionHealth(machineId), [])
    reopened.close()

    const afterDelete = new DatabaseSync(databasePath)
    assert.equal(
      afterDelete
        .prepare(
          `SELECT COUNT(*) AS count
           FROM machine_provider_execution_health
           WHERE machine_id = ?`,
        )
        .get(machineId).count,
      0,
    )
    assert.deepEqual(afterDelete.prepare('PRAGMA foreign_key_check').all(), [])
    afterDelete.close()
  })
})

test('Provider health precedence compares timestamp instants rather than offset spellings', () => {
  withDatabase((databasePath) => {
    const machineId = 'machine_providerhealth02'
    const store = ConversationStore.open({ databasePath })
    const candidate = remoteCandidate(machineId)
    store.createRemoteMachineWithTrust(candidate.machine, candidate.trust)

    const initial = store.recordProviderExecutionHealth({
      machineId,
      provider: 'codex',
      state: 'unavailable',
      failure: canonicalFailure('provider_crashed', observedAt),
      observedAt,
    })
    assert.deepEqual(
      store.recordProviderExecutionHealth({
        machineId,
        provider: 'codex',
        state: 'healthy',
        // Lexically later than 12:00Z, but the instant is 11:30Z.
        observedAt: '2026-09-02T13:30:00.000+02:00',
      }),
      initial,
    )
    assert.deepEqual(
      store.recordProviderExecutionHealth({
        machineId,
        provider: 'codex',
        state: 'healthy',
        // Lexically earlier than 12:00Z, but the instant is 12:30Z.
        observedAt: '2026-09-02T11:30:00.000-01:00',
      }),
      {
        machineId,
        provider: 'codex',
        state: 'healthy',
        observedAt: '2026-09-02T12:30:00.000Z',
      },
    )

    store.close()
  })
})

function canonicalFailure(reason, occurredAt) {
  const profiles = {
    provider_crashed: {
      category: 'provider',
      retryability: 'unknown',
      userAction: 'view_details',
      source: 'provider',
    },
    rate_limited: {
      category: 'quota',
      retryability: 'retry_later',
      userAction: 'wait',
      source: 'provider',
    },
  }
  return {
    ...profiles[reason],
    reason,
    occurredAt,
    technicalCode: reason,
  }
}

function remoteCandidate(machineId) {
  return {
    machine: {
      machineId,
      displayName: 'Execution health fixture',
      kind: 'remote',
      platform: 'Linux',
      architecture: 'x64',
      createdAt: observedAt,
    },
    trust: {
      machineId,
      nodeIdentity: 'node_identity_provider_health_01',
      peerPublicKeySpki: new Uint8Array(64).fill(1),
      peerKeyFingerprint: 'a'.repeat(43),
      controllerCredentialRef: 'credential-provider-health-01',
      controllerKeyFingerprint: 'b'.repeat(43),
      trustState: 'pending',
      protocolVersion: 1,
      address: { host: '192.0.2.20', port: 43_217 },
      pairedAt: observedAt,
      updatedAt: observedAt,
    },
  }
}

function withDatabase(run) {
  const directory = mkdtempSync(
    join(tmpdir(), 'codetether-provider-execution-health-'),
  )
  const databasePath = join(directory, 'codetether.sqlite3')
  let runError
  try {
    run(databasePath)
  } catch (error) {
    runError = error
  }

  try {
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    })
  } catch (cleanupError) {
    if (runError === undefined) {
      throw cleanupError
    }
  }

  if (runError !== undefined) {
    throw runError
  }
}

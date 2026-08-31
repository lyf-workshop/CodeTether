import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import { MachineRegistry } from '../dist/api/machine-registry.js'
import {
  ConversationStore,
  RemoteMachineTrustConflictError,
  currentSchemaVersion,
} from '../dist/persistence/index.js'
import { normalizeTrustedProjectRoot } from '../dist/project-path.js'
import { downgradeMachineFoundationToVersionSeven } from './fixtures/machine-foundation-v7.mjs'

const timestamp = '2026-08-30T12:00:00.000Z'
const later = '2026-08-30T12:01:00.000Z'

test('migration 009 preserves the v8 graph and rolls back replacement tables atomically', () => {
  withDatabase((databasePath) => {
    const seed = ConversationStore.open({ databasePath })
    const [local] = seed.listMachines()
    assert.ok(local)
    const root = resolve(databasePath, '..', 'remote-migration-project')
    const normalized = normalizeTrustedProjectRoot(root)
    seed.createProject({
      projectId: 'proj_remotemigration01',
      name: 'Remote migration',
      location: {
        projectId: 'proj_remotemigration01',
        machineId: local.machineId,
        rootPath: normalized.rootPath,
        rootPathKey: normalized.rootPathKey,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    seed.createConversation({
      conversationId: 'conv_remotemigration01',
      projectId: 'proj_remotemigration01',
      machineId: local.machineId,
      provider: 'claude-code',
      providerThreadId: 'private-session-preserved',
      cwd: normalized.rootPath,
      status: 'completed',
      title: 'Migration marker',
      titleSource: 'manual',
      pinnedAt: later,
      createdAt: timestamp,
      updatedAt: later,
      lastActivityAt: later,
    })
    seed.close()

    downgradeMachineFoundationToVersionSeven(databasePath)
    const blocker = new DatabaseSync(databasePath)
    blocker.exec('CREATE TABLE trusted_machine_peers (blocked INTEGER) STRICT')
    blocker.close()

    assert.throws(
      () => ConversationStore.open({ databasePath }),
      /trusted_machine_peers already exists/u,
    )

    const rolledBack = new DatabaseSync(databasePath)
    assert.equal(
      rolledBack
        .prepare('SELECT MAX(version) AS version FROM schema_migrations')
        .get().version,
      8,
    )
    for (const table of [
      'machines_v9',
      'project_locations_v9',
      'conversations_v9',
      'turns_v9',
      'attention_items_v9',
      'conversation_search_documents_v9',
    ]) {
      assert.equal(tableCount(rolledBack, table), 0)
    }
    assert.equal(
      rolledBack
        .prepare(
          'SELECT provider_thread_id FROM conversations WHERE conversation_id = ?',
        )
        .get('conv_remotemigration01').provider_thread_id,
      'private-session-preserved',
    )
    const v8MachineId = rolledBack
      .prepare("SELECT machine_id FROM machines WHERE kind = 'local'")
      .get().machine_id
    rolledBack.exec('DROP TABLE trusted_machine_peers')
    rolledBack.close()

    const migrated = ConversationStore.open({ databasePath })
    assert.equal(currentSchemaVersion, 9)
    assert.equal(migrated.schemaVersion, 9)
    assert.deepEqual(
      migrated.listMachines().map((machine) => machine.machineId),
      [v8MachineId],
    )
    const conversation = migrated.getConversation('conv_remotemigration01')
    assert.equal(conversation.machineId, v8MachineId)
    assert.equal(conversation.provider, 'claude-code')
    assert.equal(conversation.providerThreadId, 'private-session-preserved')
    assert.equal(conversation.title, 'Migration marker')
    assert.equal(conversation.pinnedAt, later)
    assert.deepEqual(migrated.listTrustedMachinePeers(), [])
    migrated.close()

    const inspect = new DatabaseSync(databasePath)
    assert.deepEqual(inspect.prepare('PRAGMA foreign_key_check').all(), [])
    assert.equal(
      inspect.prepare('PRAGMA integrity_check').get().integrity_check,
      'ok',
    )
    inspect.close()
  })
})

test('private remote trust is staged, hidden until active, durable, unique, and removable', () => {
  withDatabase((databasePath) => {
    const store = ConversationStore.open({ databasePath })
    const [local] = store.listMachines()
    assert.ok(local)
    const candidate = remoteCandidate('machine_remotetrust01', 'a')
    store.createRemoteMachineWithTrust(candidate.machine, candidate.trust)

    assert.equal(store.listMachines().length, 2)
    assert.equal(
      store.getTrustedMachinePeer(candidate.machine.machineId).trustState,
      'pending',
    )
    const pendingRegistry = registry(store)
    assert.deepEqual(
      pendingRegistry.list().map((machine) => machine.machineId),
      [local.machineId],
    )

    assert.throws(
      () =>
        store.createRemoteMachineWithTrust(
          remoteCandidate('machine_remotetrust02', 'a').machine,
          {
            ...remoteCandidate('machine_remotetrust02', 'b').trust,
            nodeIdentity: candidate.trust.nodeIdentity,
          },
        ),
      (error) =>
        error instanceof RemoteMachineTrustConflictError &&
        error.reason === 'peer_identity',
    )

    store.activateTrustedMachinePeer(candidate.machine.machineId, later)
    const activeRegistry = registry(store)
    const machines = activeRegistry.list()
    assert.equal(machines.length, 2)
    const remote = machines.find((machine) => machine.kind === 'remote')
    assert.ok(remote)
    assert.equal(remote.machineId, candidate.machine.machineId)
    assert.equal(remote.availability, 'unavailable')
    assert.equal(remote.connectionState, 'offline')
    assert.equal(remote.trustState, 'trusted')
    assert.deepEqual(remote.capabilities, {
      projectAccess: false,
      providerExecution: false,
      backgroundRuntime: false,
      nativeFolderPicker: false,
      notifications: false,
    })

    store.markTrustedMachinePeerRevoking(candidate.machine.machineId, later)
    store.restoreRevokingTrustedMachinePeer(candidate.machine.machineId, later)
    assert.equal(
      store.getTrustedMachinePeer(candidate.machine.machineId).trustState,
      'active',
    )
    assert.equal(store.deleteRemoteMachine(candidate.machine.machineId), true)
    assert.equal(store.getMachine(candidate.machine.machineId), undefined)
    assert.equal(
      store.getTrustedMachinePeer(candidate.machine.machineId),
      undefined,
    )
    assert.equal(store.listMachines().length, 1)
    store.close()

    const reopened = ConversationStore.open({ databasePath })
    assert.deepEqual(
      reopened.listMachines().map((machine) => machine.machineId),
      [local.machineId],
    )
    reopened.close()
  })
})

function registry(store) {
  return new MachineRegistry({
    persistence: store,
    now: () => later,
    capabilities: {
      projectAccess: true,
      providerExecution: true,
      backgroundRuntime: false,
      nativeFolderPicker: false,
      notifications: false,
    },
  })
}

function remoteCandidate(machineId, marker) {
  const fingerprint = `${marker.repeat(43)}`
  return {
    machine: {
      machineId,
      displayName: `Remote ${marker}`,
      kind: 'remote',
      platform: 'Linux',
      architecture: 'x64',
      createdAt: timestamp,
    },
    trust: {
      machineId,
      nodeIdentity: `node_identity_${marker.repeat(20)}`,
      peerPublicKeySpki: new Uint8Array(64).fill(marker.codePointAt(0)),
      peerKeyFingerprint: fingerprint,
      controllerCredentialRef: `credential-${marker.repeat(20)}`,
      controllerKeyFingerprint: `c${marker.repeat(42)}`,
      trustState: 'pending',
      protocolVersion: 1,
      address: { host: '192.0.2.10', port: 43_217 },
      pairedAt: timestamp,
      updatedAt: timestamp,
    },
  }
}

function tableCount(database, name) {
  return database
    .prepare(
      `SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?`,
    )
    .get(name).count
}

function withDatabase(run) {
  const directory = mkdtempSync(join(tmpdir(), 'codetether-remote-machine-'))
  const databasePath = join(directory, 'codetether.sqlite3')
  let operationError
  try {
    run(databasePath)
  } catch (error) {
    operationError = error
  }
  try {
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    })
  } catch (cleanupError) {
    operationError ??= cleanupError
  }
  if (operationError !== undefined) throw operationError
}

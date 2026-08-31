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
    assert.equal(currentSchemaVersion, 10)
    assert.equal(migrated.schemaVersion, 10)
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

test('migration 010 backfills one preferred endpoint from v9 and rolls back without partial endpoint state', () => {
  withDatabase((databasePath) => {
    const seed = ConversationStore.open({ databasePath })
    const [local] = seed.listMachines()
    assert.ok(local)
    const root = resolve(databasePath, '..', 'endpoint-v10-project')
    const normalized = normalizeTrustedProjectRoot(root)
    seed.createProject({
      projectId: 'proj_endpointmigration01',
      name: 'Endpoint migration',
      location: {
        projectId: 'proj_endpointmigration01',
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
      conversationId: 'conv_endpointmigration01',
      projectId: 'proj_endpointmigration01',
      machineId: local.machineId,
      provider: 'codex',
      cwd: normalized.rootPath,
      status: 'completed',
      title: 'Endpoint migration marker',
      createdAt: timestamp,
      updatedAt: later,
      lastActivityAt: later,
    })
    const candidate = remoteCandidate('machine_endpointmigration01', 'e')
    seed.createRemoteMachineWithTrust(candidate.machine, candidate.trust)
    seed.activateTrustedMachinePeer(candidate.machine.machineId, later)
    seed.close()

    downgradeRemoteMachineEndpointsToVersionNine(databasePath)
    const blocker = new DatabaseSync(databasePath)
    blocker.exec(
      'CREATE TABLE trusted_machine_endpoints (blocked INTEGER) STRICT',
    )
    blocker.close()

    assert.throws(
      () => ConversationStore.open({ databasePath }),
      /trusted_machine_endpoints/u,
    )
    const rolledBack = new DatabaseSync(databasePath)
    assert.equal(
      rolledBack
        .prepare('SELECT MAX(version) AS version FROM schema_migrations')
        .get().version,
      9,
    )
    assert.equal(tableCount(rolledBack, 'trusted_machine_peers_v10'), 0)
    assert.equal(tableCount(rolledBack, 'trusted_machine_endpoints_v10'), 0)
    assert.equal(
      rolledBack
        .prepare(
          'SELECT endpoint_host FROM trusted_machine_peers WHERE machine_id = ?',
        )
        .get(candidate.machine.machineId).endpoint_host,
      '192.0.2.10',
    )
    rolledBack.exec('DROP TABLE trusted_machine_endpoints')
    rolledBack.close()

    const migrated = ConversationStore.open({ databasePath })
    assert.equal(migrated.schemaVersion, 10)
    const trust = migrated.getTrustedMachinePeer(candidate.machine.machineId)
    assert.deepEqual(trust?.endpoints, [
      {
        address: { host: '192.0.2.10', port: 43_217 },
        source: 'pairing',
        preferred: true,
        createdAt: timestamp,
        updatedAt: later,
        lastSuccessfulAt: later,
      },
    ])
    assert.equal(trust?.trustState, 'active')
    assert.equal(
      migrated.getConversation('conv_endpointmigration01').title,
      'Endpoint migration marker',
    )
    migrated.close()

    const reopened = ConversationStore.open({ databasePath })
    assert.equal(
      reopened.getTrustedMachinePeer(candidate.machine.machineId)?.endpoints
        .length,
      1,
    )
    reopened.close()
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

test('authenticated endpoint history canonicalizes literal duplicates and evicts only the oldest fallback at capacity', () => {
  withDatabase((databasePath) => {
    const store = ConversationStore.open({ databasePath })
    const candidate = remoteCandidate('machine_endpointhistory01', 'h')
    store.createRemoteMachineWithTrust(candidate.machine, candidate.trust)
    store.activateTrustedMachinePeer(candidate.machine.machineId, timestamp)

    store.recordTrustedMachineAuthentication(
      candidate.machine.machineId,
      { host: '[FD00:0:0:0:0:0:0:1]', port: 4319 },
      later,
      'manual',
    )
    store.recordTrustedMachineAuthentication(
      candidate.machine.machineId,
      { host: 'fd00::1', port: 4319 },
      '2026-08-30T12:02:00.000Z',
      'manual',
    )
    let trust = store.getTrustedMachinePeer(candidate.machine.machineId)
    assert.equal(
      trust?.endpoints.filter((endpoint) => endpoint.address.host === 'fd00::1')
        .length,
      1,
    )

    for (let octet = 11; octet <= 18; octet += 1) {
      store.recordTrustedMachineAuthentication(
        candidate.machine.machineId,
        { host: `172.20.1.${octet}`, port: 4319 },
        `2026-08-30T12:${String(octet).padStart(2, '0')}:00.000Z`,
        'manual',
      )
    }
    trust = store.getTrustedMachinePeer(candidate.machine.machineId)
    assert.equal(trust?.endpoints.length, 8)
    assert.equal(
      trust?.endpoints.filter((endpoint) => endpoint.preferred).length,
      1,
    )
    assert.deepEqual(trust?.endpoints[0]?.address, {
      host: '172.20.1.18',
      port: 4319,
    })
    assert.equal(
      trust?.endpoints.some(
        (endpoint) => endpoint.address.host === '192.0.2.10',
      ),
      false,
    )
    store.close()
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

function downgradeRemoteMachineEndpointsToVersionNine(databasePath) {
  const database = new DatabaseSync(databasePath)
  try {
    database.exec('PRAGMA foreign_keys = OFF')
    database.exec(`
      BEGIN IMMEDIATE;
      DELETE FROM schema_migrations WHERE version = 10;
      CREATE TABLE trusted_machine_peers_v9 (
        machine_id TEXT PRIMARY KEY,
        node_identity TEXT NOT NULL UNIQUE,
        peer_public_key_spki BLOB NOT NULL UNIQUE,
        peer_key_fingerprint TEXT NOT NULL UNIQUE,
        controller_credential_ref TEXT NOT NULL UNIQUE,
        controller_key_fingerprint TEXT NOT NULL,
        trust_state TEXT NOT NULL CHECK (trust_state IN ('pending', 'active', 'revoking')),
        protocol_version INTEGER NOT NULL,
        endpoint_host TEXT NOT NULL,
        endpoint_port INTEGER NOT NULL,
        paired_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_authenticated_at TEXT,
        FOREIGN KEY (machine_id) REFERENCES machines(machine_id) ON DELETE CASCADE
      ) STRICT;
      INSERT INTO trusted_machine_peers_v9 (
        machine_id, node_identity, peer_public_key_spki,
        peer_key_fingerprint, controller_credential_ref,
        controller_key_fingerprint, trust_state, protocol_version,
        endpoint_host, endpoint_port, paired_at, updated_at,
        last_authenticated_at
      )
      SELECT
        peer.machine_id, peer.node_identity, peer.peer_public_key_spki,
        peer.peer_key_fingerprint, peer.controller_credential_ref,
        peer.controller_key_fingerprint, peer.trust_state, peer.protocol_version,
        endpoint.endpoint_host, endpoint.endpoint_port, peer.paired_at,
        peer.updated_at, peer.last_authenticated_at
      FROM trusted_machine_peers AS peer
      INNER JOIN trusted_machine_endpoints AS endpoint
        ON endpoint.machine_id = peer.machine_id AND endpoint.preferred = 1;
      DROP TABLE trusted_machine_endpoints;
      DROP TABLE trusted_machine_peers;
      ALTER TABLE trusted_machine_peers_v9 RENAME TO trusted_machine_peers;
      CREATE TRIGGER trg_trusted_machine_peer_remote_insert
      BEFORE INSERT ON trusted_machine_peers
      WHEN (SELECT kind FROM machines WHERE machine_id = NEW.machine_id) IS NOT 'remote'
      BEGIN
        SELECT RAISE(ABORT, 'Trusted peer must belong to a remote Machine');
      END;
      CREATE TRIGGER trg_trusted_machine_peer_remote_update
      BEFORE UPDATE OF machine_id ON trusted_machine_peers
      WHEN (SELECT kind FROM machines WHERE machine_id = NEW.machine_id) IS NOT 'remote'
      BEGIN
        SELECT RAISE(ABORT, 'Trusted peer must belong to a remote Machine');
      END;
      COMMIT;
    `)
  } finally {
    database.close()
  }
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

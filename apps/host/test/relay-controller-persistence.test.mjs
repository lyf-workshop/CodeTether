import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import {
  ConversationStore,
  currentSchemaVersion,
} from '../dist/persistence/index.js'
import { downgradeExistingProviderSessionsToVersionFourteen } from './fixtures/existing-provider-sessions-v14.mjs'

const createdAt = '2026-09-03T12:00:00.000Z'
const enrolledAt = '2026-09-03T12:01:00.000Z'
const connectedAt = '2026-09-03T12:02:00.000Z'
const updatedAt = '2026-09-03T12:03:00.000Z'
const relayFingerprint = 'r'.repeat(43)
const replacementFingerprint = 's'.repeat(43)

test('migration 014 creates the bounded Relay configuration atomically', () => {
  withDatabase((databasePath) => {
    const seed = ConversationStore.open({ databasePath })
    seed.close()

    const downgrade = new DatabaseSync(databasePath)
    downgradeExistingProviderSessionsToVersionFourteen(downgrade)
    downgrade.exec(`
      DELETE FROM schema_migrations WHERE version = 14;
      DROP TABLE machine_relay_configurations;
      CREATE TABLE machine_relay_configurations (blocked INTEGER) STRICT;
    `)
    downgrade.close()

    assert.throws(
      () => ConversationStore.open({ databasePath }),
      /machine_relay_configurations already exists/u,
    )

    const rolledBack = new DatabaseSync(databasePath)
    assert.equal(
      rolledBack
        .prepare('SELECT MAX(version) AS version FROM schema_migrations')
        .get().version,
      13,
    )
    rolledBack.exec('DROP TABLE machine_relay_configurations')
    rolledBack.close()

    const migrated = ConversationStore.open({ databasePath })
    assert.equal(currentSchemaVersion, 17)
    assert.equal(migrated.schemaVersion, 17)
    migrated.close()

    const inspect = new DatabaseSync(databasePath)
    const columns = inspect
      .prepare('PRAGMA table_info(machine_relay_configurations)')
      .all()
      .map((column) => column.name)
    assert.equal(
      columns.some((column) => /token|secret|private/u.test(column)),
      false,
    )
    assert.deepEqual(inspect.prepare('PRAGMA foreign_key_check').all(), [])
    inspect.close()
  })
})

test('Relay configuration persists enrollment but not live presence or connection epochs', () => {
  withDatabase((databasePath) => {
    const machineId = 'machine_relaypersistence01'
    const store = ConversationStore.open({ databasePath })
    addActiveRemoteMachine(store, machineId)

    assert.deepEqual(
      store.configureMachineRelay(
        machineId,
        endpoint('relay.example.test', 443, 'public_ca'),
        relayFingerprint,
        createdAt,
        'Owner Relay',
      ),
      {
        machineId,
        endpoint: endpoint('relay.example.test', 443, 'public_ca'),
        relayIdentityFingerprint: relayFingerprint,
        displayLabel: 'Owner Relay',
        enabled: true,
        enrollmentState: 'required',
        createdAt,
        updatedAt: createdAt,
      },
    )
    store.markMachineRelayEnrolled(machineId, enrolledAt)
    store.recordMachineRelayConnected(machineId, connectedAt)
    store.close()

    const reopened = ConversationStore.open({ databasePath })
    assert.deepEqual(reopened.getMachineRelayConfiguration(machineId), {
      machineId,
      endpoint: endpoint('relay.example.test', 443, 'public_ca'),
      relayIdentityFingerprint: relayFingerprint,
      displayLabel: 'Owner Relay',
      enabled: true,
      enrollmentState: 'enrolled',
      createdAt,
      updatedAt: connectedAt,
      enrolledAt,
      lastConnectedAt: connectedAt,
      lastAttemptAt: connectedAt,
    })

    const inspect = new DatabaseSync(databasePath)
    const columns = inspect
      .prepare('PRAGMA table_info(machine_relay_configurations)')
      .all()
      .map((column) => column.name)
    assert.equal(
      columns.some((column) =>
        /presence|connection_epoch|challenge|signature|token/u.test(column),
      ),
      false,
    )
    inspect.close()
    reopened.close()
  })
})

test('same-identity endpoint mobility preserves enrollment and mismatch resets it', () => {
  withDatabase((databasePath) => {
    const machineId = 'machine_relaymobility0001'
    const store = ConversationStore.open({ databasePath })
    addActiveRemoteMachine(store, machineId)
    store.configureMachineRelay(
      machineId,
      endpoint('relay-one.example.test', 443, 'public_ca'),
      relayFingerprint,
      createdAt,
    )
    store.markMachineRelayEnrolled(machineId, enrolledAt)
    store.recordMachineRelayConnected(machineId, connectedAt)

    assert.deepEqual(
      store.configureMachineRelay(
        machineId,
        endpoint('39.104.94.53', 443, 'pinned_identity'),
        relayFingerprint,
        updatedAt,
        'Moved Relay',
      ),
      {
        machineId,
        endpoint: endpoint('39.104.94.53', 443, 'pinned_identity'),
        relayIdentityFingerprint: relayFingerprint,
        displayLabel: 'Moved Relay',
        enabled: true,
        enrollmentState: 'enrolled',
        createdAt,
        updatedAt,
        enrolledAt,
        lastConnectedAt: connectedAt,
      },
    )

    assert.deepEqual(
      store.configureMachineRelay(
        machineId,
        endpoint('39.104.94.53', 443, 'pinned_identity'),
        replacementFingerprint,
        '2026-09-03T12:04:00.000Z',
      ),
      {
        machineId,
        endpoint: endpoint('39.104.94.53', 443, 'pinned_identity'),
        relayIdentityFingerprint: replacementFingerprint,
        enabled: true,
        enrollmentState: 'required',
        createdAt,
        updatedAt: '2026-09-03T12:04:00.000Z',
      },
    )
    store.close()
  })
})

test('Relay revocation disables reconnect and remains separate from Machine trust', () => {
  withDatabase((databasePath) => {
    const machineId = 'machine_relayrevocation01'
    const store = ConversationStore.open({ databasePath })
    addActiveRemoteMachine(store, machineId)
    store.configureMachineRelay(
      machineId,
      endpoint('39.104.94.53', 443, 'pinned_identity'),
      relayFingerprint,
      createdAt,
    )
    store.markMachineRelayEnrolled(machineId, enrolledAt)

    assert.deepEqual(store.markMachineRelayRevoked(machineId, updatedAt), {
      machineId,
      endpoint: endpoint('39.104.94.53', 443, 'pinned_identity'),
      relayIdentityFingerprint: relayFingerprint,
      enabled: false,
      enrollmentState: 'revoked',
      createdAt,
      updatedAt,
    })
    assert.throws(
      () => store.setMachineRelayEnabled(machineId, true, updatedAt),
      /revoked Relay enrollment cannot be enabled/u,
    )
    assert.equal(store.getTrustedMachinePeer(machineId)?.trustState, 'active')

    assert.deepEqual(store.markMachineRelayEnrolled(machineId, updatedAt), {
      machineId,
      endpoint: endpoint('39.104.94.53', 443, 'pinned_identity'),
      relayIdentityFingerprint: relayFingerprint,
      enabled: true,
      enrollmentState: 'enrolled',
      createdAt,
      updatedAt,
      enrolledAt: updatedAt,
    })
    assert.equal(store.getTrustedMachinePeer(machineId)?.trustState, 'active')

    assert.equal(store.deleteRemoteMachine(machineId), true)
    assert.equal(store.getMachineRelayConfiguration(machineId), undefined)
    store.close()
  })
})

test('Relay configuration rejects local, pending, and unknown Machines', () => {
  withDatabase((databasePath) => {
    const store = ConversationStore.open({ databasePath })
    const localMachineId = store.listMachines()[0].machineId
    assert.throws(
      () =>
        store.configureMachineRelay(
          localMachineId,
          endpoint('relay.example.test', 443, 'public_ca'),
          relayFingerprint,
          createdAt,
        ),
      /actively trusted remote Machine/u,
    )

    const pendingMachineId = 'machine_relaypending00001'
    const candidate = remoteCandidate(pendingMachineId)
    store.createRemoteMachineWithTrust(candidate.machine, candidate.trust)
    assert.throws(
      () =>
        store.configureMachineRelay(
          pendingMachineId,
          endpoint('relay.example.test', 443, 'public_ca'),
          relayFingerprint,
          createdAt,
        ),
      /actively trusted remote Machine/u,
    )
    assert.throws(
      () =>
        store.configureMachineRelay(
          'machine_relayunknown00001',
          endpoint('relay.example.test', 443, 'public_ca'),
          relayFingerprint,
          createdAt,
        ),
      /actively trusted remote Machine/u,
    )
    store.close()
  })
})

function endpoint(host, port, transportSecurity) {
  return { host, port, transportSecurity }
}

function addActiveRemoteMachine(store, machineId) {
  const candidate = remoteCandidate(machineId)
  store.createRemoteMachineWithTrust(candidate.machine, candidate.trust)
  store.activateTrustedMachinePeer(machineId, createdAt)
}

function remoteCandidate(machineId) {
  return {
    machine: {
      machineId,
      displayName: 'Relay persistence fixture',
      kind: 'remote',
      platform: 'Linux',
      architecture: 'x64',
      createdAt,
    },
    trust: {
      machineId,
      nodeIdentity: `node_identity_${machineId}`,
      peerPublicKeySpki: new Uint8Array(64).fill(1),
      peerKeyFingerprint: 'n'.repeat(43),
      controllerCredentialRef: 'controller_relay_fixture.json',
      controllerKeyFingerprint: 'c'.repeat(43),
      trustState: 'pending',
      protocolVersion: 1,
      address: { host: '192.0.2.30', port: 43_217 },
      pairedAt: createdAt,
      updatedAt: createdAt,
    },
  }
}

function withDatabase(run) {
  const directory = mkdtempSync(join(tmpdir(), 'codetether-relay-store-'))
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
    if (runError === undefined) throw cleanupError
  }

  if (runError !== undefined) throw runError
}

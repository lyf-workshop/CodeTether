import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'

import { ConversationStore, currentSchemaVersion } from '../dist/persistence/index.js'

test('durable Host identity remains distinct from Machine identity across restart', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'codetether-host-identity-'))
  const databasePath = resolve(directory, 'codetether.sqlite3')
  const identity = {
    hostId: 'host_0123456789abcdef0123456789abcdef',
    publicJwk:
      '{"crv":"P-256","kty":"EC","x":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","y":"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"}',
    fingerprint: 'sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    keyAlgorithm: 'ES256',
    keyHandle: 'CodeTether.HostIdentity.0123456789abcdef0123456789abcdef',
    identityGeneration: 1,
    safeLabel: 'Development Host',
    platform: 'windows',
    appVersion: '0.1.0-alpha.0',
    createdAt: '2026-09-22T12:00:00.000Z',
    updatedAt: '2026-09-22T12:00:00.000Z',
  }

  try {
    const first = ConversationStore.open({ databasePath })
    assert.equal(currentSchemaVersion, 19)
    assert.equal(first.getHostIdentity(), undefined)
    const machineId = first.listMachines()[0].machineId
    assert.notEqual(identity.hostId, machineId)
    assert.deepEqual(first.createHostIdentity(identity), identity)
    first.close()

    const restarted = ConversationStore.open({ databasePath })
    assert.deepEqual(restarted.getHostIdentity(), identity)
    assert.deepEqual(restarted.createHostIdentity(identity), identity)
    assert.throws(
      () =>
        restarted.createHostIdentity({
          ...identity,
          hostId: 'host_fedcba9876543210fedcba9876543210',
        }),
      /cannot be replaced/,
    )
    restarted.close()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

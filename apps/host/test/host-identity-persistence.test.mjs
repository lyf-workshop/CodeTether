import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'

import {
  ConversationStore,
  currentSchemaVersion,
} from '../dist/persistence/index.js'

test('durable Host identity remains distinct from Machine identity across restart', async () => {
  const directory = await mkdtemp(
    resolve(tmpdir(), 'codetether-host-identity-'),
  )
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
  const grant = {
    payload: {
      v: 1,
      aud: 'codetether-host-supervisor',
      purpose: 'host_supervisor_grant',
      authorizationId: 'hauth_0123456789abcdef0123456789abcdef',
      hostId: identity.hostId,
      hostFingerprint: identity.fingerprint,
      hostIdentityGeneration: 1,
      deviceId: 'dev_0123456789abcdef0123456789abcdef',
      deviceFingerprint: 'sha256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      deviceKeyGeneration: 1,
      userId: 'usr_0123456789abcdef0123456789abcdef',
      spaceId: 'space_0123456789abcdef0123456789abcdef',
      scope: 'supervisor_read',
      authorizationSerial: '1',
      authorizationGeneration: 1,
      issuedAt: 1_795_000_000,
      expiresAt: 1_795_086_400,
    },
    proof: 'S'.repeat(80),
  }

  let first
  let restarted
  try {
    first = ConversationStore.open({ databasePath })
    assert.equal(currentSchemaVersion, 23)
    assert.equal(first.getHostIdentity(), undefined)
    const machineId = first.listMachines()[0].machineId
    assert.notEqual(identity.hostId, machineId)
    assert.deepEqual(first.createHostIdentity(identity), identity)
    assert.deepEqual(
      first.storeHostSupervisorGrant(grant, '2026-09-22T12:00:00.000Z'),
      grant,
    )
    assert.equal(
      first.hasHostSupervisorControl(grant.payload.authorizationId),
      false,
    )
    first.approveHostSupervisorControl(
      grant.payload.authorizationId,
      '2026-09-22T12:00:01.000Z',
    )
    assert.equal(
      first.hasHostSupervisorControl(grant.payload.authorizationId),
      true,
    )
    first.close()
    first = undefined

    restarted = ConversationStore.open({ databasePath })
    assert.deepEqual(restarted.getHostIdentity(), identity)
    assert.deepEqual(restarted.createHostIdentity(identity), identity)
    assert.deepEqual(
      restarted.getHostSupervisorGrant(grant.payload.authorizationId),
      grant,
    )
    assert.equal(
      restarted.hasHostSupervisorControl(grant.payload.authorizationId),
      true,
    )
    assert.throws(
      () =>
        restarted.createHostIdentity({
          ...identity,
          hostId: 'host_fedcba9876543210fedcba9876543210',
        }),
      /cannot be replaced/,
    )
    restarted.close()
    restarted = undefined
  } finally {
    restarted?.close()
    first?.close()
    await rm(directory, { recursive: true, force: true })
  }
})

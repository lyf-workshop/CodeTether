import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import {
  fingerprintRelayPublicKeySpki,
  generateRelayApplicationIdentity,
} from '@codetether/relay-protocol'

import { RelayStateStore, restoreRelayStateBackup } from '../dist/index.js'

async function withTemporaryRoot(run) {
  const root = await mkdtemp(join(tmpdir(), 'codetether-relay-store-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function enroll(store, token, role, identity, extra = {}) {
  return store.enroll({
    token,
    role,
    publicKeySpki: identity.publicKeySpki,
    fingerprint: identity.publicKeyFingerprint,
    clientBuildIdentity: 'test-build',
    ...extra,
  })
}

test('Relay identity and minimal peer state survive restart without plaintext tokens', async () => {
  await withTemporaryRoot(async (root) => {
    const state = join(root, 'state')
    let store = new RelayStateStore(state)
    assert.equal(
      await readFile(join(state, 'relay-state-initialized'), 'utf8'),
      'codetether-relay-state-v1\n',
    )
    const initialIdentity = store.identity
    const controller = generateRelayApplicationIdentity()
    const token = store.createEnrollmentToken('controller')
    const peer = enroll(store, token, 'controller', controller)
    assert.equal(
      fingerprintRelayPublicKeySpki(controller.publicKeySpki),
      controller.publicKeyFingerprint,
    )
    assert.equal(store.counts().enrolledControllers, 1)
    assert.equal(store.counts().unconsumedTokens, 0)
    assert.equal(
      (await readFile(store.databasePath)).includes(Buffer.from(token, 'utf8')),
      false,
    )
    store.close()

    store = new RelayStateStore(state)
    assert.equal(store.identity.relayId, initialIdentity.relayId)
    assert.equal(
      store.identity.publicKeyFingerprint,
      initialIdentity.publicKeyFingerprint,
    )
    assert.equal(
      store.getPeerByFingerprint(controller.publicKeyFingerprint)?.peerId,
      peer.peerId,
    )
    assert.throws(
      () => enroll(store, token, 'controller', controller),
      /enrollment failed/u,
    )
    store.close()
  })
})

test('an existing Relay database with missing identity fails closed instead of regenerating', async () => {
  await withTemporaryRoot(async (root) => {
    const state = join(root, 'state')
    const store = new RelayStateStore(state)
    const databasePath = store.databasePath
    store.close()

    const database = new DatabaseSync(databasePath)
    database.exec('DELETE FROM relay_metadata')
    database.close()

    assert.throws(
      () => new RelayStateStore(state),
      /Relay identity is missing from an existing state database/u,
    )
  })
})

test('an initialized state directory with a deleted database fails before creating a replacement identity', async () => {
  await withTemporaryRoot(async (root) => {
    const state = join(root, 'state')
    const store = new RelayStateStore(state)
    const databasePath = store.databasePath
    store.close()
    await rm(databasePath)

    assert.throws(
      () => new RelayStateStore(state),
      /Relay state database is missing from an initialized state directory/u,
    )
    await assert.rejects(readFile(databasePath))
  })
})

test('a partial or modified initialization marker fails closed', async () => {
  await withTemporaryRoot(async (root) => {
    const state = join(root, 'state')
    const store = new RelayStateStore(state)
    store.close()
    await writeFile(join(state, 'relay-state-initialized'), 'partial\n')

    assert.throws(
      () => new RelayStateStore(state),
      /Relay state initialization marker is invalid/u,
    )
  })
})

test('one enrollment token has exactly one winner under concurrent attempts', async () => {
  await withTemporaryRoot(async (root) => {
    const store = new RelayStateStore(join(root, 'state'))
    const token = store.createEnrollmentToken('node')
    const first = generateRelayApplicationIdentity()
    const second = generateRelayApplicationIdentity()
    const results = await Promise.allSettled([
      Promise.resolve().then(() => enroll(store, token, 'node', first)),
      Promise.resolve().then(() => enroll(store, token, 'node', second)),
    ])
    assert.equal(
      results.filter((result) => result.status === 'fulfilled').length,
      1,
    )
    assert.equal(
      results.filter((result) => result.status === 'rejected').length,
      1,
    )
    assert.equal(store.counts().enrolledNodes, 1)
    store.close()
  })
})

test('expired and role-scoped enrollment tokens fail without registering a peer', async () => {
  await withTemporaryRoot(async (root) => {
    const store = new RelayStateStore(join(root, 'state'))
    const issuedAt = new Date('2026-01-01T00:00:00.000Z')
    const expiredAt = new Date(issuedAt.getTime() + 1_001)
    const expired = store.createEnrollmentToken('controller', {
      now: issuedAt,
      ttlMs: 1_000,
    })

    assert.throws(
      () =>
        enroll(
          store,
          expired,
          'controller',
          generateRelayApplicationIdentity(),
          { now: expiredAt },
        ),
      (error) => error?.code === 'enrollment_expired',
    )

    const nodeOnly = store.createEnrollmentToken('node', { now: issuedAt })
    assert.throws(
      () =>
        enroll(
          store,
          nodeOnly,
          'controller',
          generateRelayApplicationIdentity(),
          { now: issuedAt },
        ),
      (error) => error?.code === 'enrollment_invalid',
    )
    assert.deepEqual(store.counts(expiredAt), {
      enrolledControllers: 0,
      enrolledNodes: 0,
      revokedPeers: 0,
      unconsumedTokens: 1,
    })
    store.close()
  })
})

test('unused enrollment token can be revoked by its non-secret reference', async () => {
  await withTemporaryRoot(async (root) => {
    const store = new RelayStateStore(join(root, 'state'))
    const grant = store.createEnrollmentGrant('controller')
    assert.equal(store.counts().unconsumedTokens, 1)
    assert.equal(store.revokeEnrollmentToken(grant.tokenReference), true)
    assert.equal(store.revokeEnrollmentToken(grant.tokenReference), false)
    assert.equal(store.counts().unconsumedTokens, 0)
    assert.throws(
      () =>
        enroll(
          store,
          grant.token,
          'controller',
          generateRelayApplicationIdentity(),
        ),
      /enrollment failed/u,
    )
    store.close()
  })
})

test('Node-authored Controller grant is exact and revocation remains Relay-local', async () => {
  await withTemporaryRoot(async (root) => {
    const store = new RelayStateStore(join(root, 'state'))
    const controller = generateRelayApplicationIdentity()
    const otherController = generateRelayApplicationIdentity()
    const node = generateRelayApplicationIdentity()
    const controllerPeer = enroll(
      store,
      store.createEnrollmentToken('controller'),
      'controller',
      controller,
    )
    enroll(
      store,
      store.createEnrollmentToken('controller'),
      'controller',
      otherController,
    )
    const nodePeer = enroll(
      store,
      store.createEnrollmentToken('node'),
      'node',
      node,
      { authorizedControllerFingerprint: controller.publicKeyFingerprint },
    )
    assert.equal(
      store.canControllerObserveNode(
        controller.publicKeyFingerprint,
        node.publicKeyFingerprint,
      ),
      true,
    )
    assert.equal(
      store.canControllerObserveNode(
        otherController.publicKeyFingerprint,
        node.publicKeyFingerprint,
      ),
      false,
    )
    assert.equal(store.revokePeer(controllerPeer.peerId), true)
    assert.equal(
      store.canControllerObserveNode(
        controller.publicKeyFingerprint,
        node.publicKeyFingerprint,
      ),
      false,
    )
    assert.equal(store.getPeerById(nodePeer.peerId)?.revokedAt, undefined)
    store.close()
  })
})

test('revoked peer requires a fresh scoped token and the exact durable key and role to re-enroll', async () => {
  await withTemporaryRoot(async (root) => {
    const store = new RelayStateStore(join(root, 'state'))
    const identity = generateRelayApplicationIdentity()
    const replacement = generateRelayApplicationIdentity()
    const first = enroll(
      store,
      store.createEnrollmentToken('controller'),
      'controller',
      identity,
    )
    assert.equal(
      store.revokePeerByFingerprint(identity.publicKeyFingerprint),
      true,
    )
    assert.equal(
      store.revokePeerByFingerprint(identity.publicKeyFingerprint),
      false,
    )
    assert.notEqual(store.getPeerById(first.peerId)?.revokedAt, undefined)

    const wrongRoleToken = store.createEnrollmentToken('node')
    assert.throws(
      () => enroll(store, wrongRoleToken, 'node', identity),
      (error) => error?.code === 'identity_mismatch',
    )
    assert.notEqual(store.getPeerById(first.peerId)?.revokedAt, undefined)

    const replacementToken = store.createEnrollmentToken('controller')
    assert.throws(
      () =>
        store.enroll({
          token: replacementToken,
          role: 'controller',
          publicKeySpki: replacement.publicKeySpki,
          fingerprint: identity.publicKeyFingerprint,
          clientBuildIdentity: 'test-build',
        }),
      (error) => error?.code === 'identity_mismatch',
    )
    assert.notEqual(store.getPeerById(first.peerId)?.revokedAt, undefined)

    const freshToken = store.createEnrollmentToken('controller')
    const reenrolled = enroll(store, freshToken, 'controller', identity)
    assert.equal(reenrolled.peerId, first.peerId)
    assert.equal(reenrolled.role, first.role)
    assert.equal(reenrolled.fingerprint, first.fingerprint)
    assert.equal(reenrolled.revokedAt, undefined)
    assert.equal(store.counts().revokedPeers, 0)
    assert.equal(store.counts().enrolledControllers, 1)
    assert.equal(store.counts().unconsumedTokens, 2)
    store.close()
  })
})

test('online backup and empty-directory restore retain identity and registry', async () => {
  await withTemporaryRoot(async (root) => {
    const state = join(root, 'state')
    const backup = join(root, 'backup')
    const restoredState = join(root, 'restored')
    const store = new RelayStateStore(state)
    const identity = store.identity
    const peerIdentity = generateRelayApplicationIdentity()
    const peer = enroll(
      store,
      store.createEnrollmentToken('controller'),
      'controller',
      peerIdentity,
    )
    await store.backupTo(backup)
    store.close()

    restoreRelayStateBackup(backup, restoredState)
    const restored = new RelayStateStore(restoredState)
    assert.equal(
      await readFile(join(restoredState, 'relay-state-initialized'), 'utf8'),
      'codetether-relay-state-v1\n',
    )
    assert.equal(restored.identity.relayId, identity.relayId)
    assert.equal(
      restored.identity.publicKeyFingerprint,
      identity.publicKeyFingerprint,
    )
    assert.equal(
      restored.getPeerById(peer.peerId)?.fingerprint,
      peer.fingerprint,
    )
    restored.close()
  })
})

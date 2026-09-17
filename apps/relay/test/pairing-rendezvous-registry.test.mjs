import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

import {
  newRelayPairingRendezvousId,
  relayProtocolLimits,
} from '@codetether/relay-protocol'

import { RelayPairingRendezvousRegistry } from '../dist/index.js'

const nodeFingerprint = 'A'.repeat(43)

function digest(capability) {
  return createHash('sha256').update(capability, 'utf8').digest('base64url')
}

function registration(node, overrides = {}) {
  const capability = overrides.capability ?? 'B'.repeat(43)
  return {
    capability,
    input: {
      rendezvousId: overrides.rendezvousId ?? newRelayPairingRendezvousId(),
      capabilityDigest: digest(capability),
      nodeFingerprint,
      node,
      expiresAt:
        overrides.expiresAt ?? new Date(Date.now() + 5_000).toISOString(),
      ...overrides.input,
    },
  }
}

test('registers, authorizes, consumes, and removes one opaque capability', () => {
  const registry = new RelayPairingRendezvousRegistry()
  const node = {}
  const entry = registration(node)

  assert.deepEqual(registry.register(entry.input), { ok: true })
  assert.equal(registry.count, 1)
  assert.equal(
    registry.authorize({
      rendezvousId: entry.input.rendezvousId,
      capability: entry.capability,
      targetNodeFingerprint: nodeFingerprint,
    })?.node,
    node,
  )
  assert.equal(
    registry.consume(entry.input.rendezvousId, node)?.rendezvousId,
    entry.input.rendezvousId,
  )
  assert.equal(registry.count, 0)
  assert.equal(
    registry.authorize({
      rendezvousId: entry.input.rendezvousId,
      capability: entry.capability,
      targetNodeFingerprint: nodeFingerprint,
    }),
    undefined,
  )
  assert.equal(registry.remove(entry.input.rendezvousId, node), false)
})

test('rejects unknown, wrong, and exhausted capability opens without leaking a match', () => {
  const registry = new RelayPairingRendezvousRegistry(4, 1, 2)
  const node = {}
  const entry = registration(node)
  assert.deepEqual(registry.register(entry.input), { ok: true })

  assert.equal(
    registry.authorize({
      rendezvousId: newRelayPairingRendezvousId(),
      capability: entry.capability,
      targetNodeFingerprint: nodeFingerprint,
    }),
    undefined,
  )
  assert.equal(
    registry.authorize({
      rendezvousId: entry.input.rendezvousId,
      capability: 'C'.repeat(43),
      targetNodeFingerprint: nodeFingerprint,
    }),
    undefined,
  )
  assert.equal(
    registry.authorize({
      rendezvousId: entry.input.rendezvousId,
      capability: entry.capability,
      targetNodeFingerprint: 'D'.repeat(43),
    }),
    undefined,
  )
  assert.equal(
    registry.authorize({
      rendezvousId: entry.input.rendezvousId,
      capability: entry.capability,
      targetNodeFingerprint: nodeFingerprint,
    }),
    undefined,
  )
  assert.equal(registry.count, 0)
})

test('enforces duplicate, per-Node, global, and expiry bounds', () => {
  const registry = new RelayPairingRendezvousRegistry(2, 1, 3, 10_000)
  const firstNode = {}
  const secondNode = {}
  const thirdNode = {}
  const first = registration(firstNode)
  const duplicate = registration(secondNode, {
    rendezvousId: first.input.rendezvousId,
  })

  assert.deepEqual(registry.register(first.input), { ok: true })
  assert.deepEqual(registry.register(duplicate.input), {
    ok: false,
    reason: 'capacity',
  })
  assert.deepEqual(registry.register(registration(firstNode).input), {
    ok: false,
    reason: 'node_capacity',
  })
  assert.deepEqual(registry.register(registration(secondNode).input), {
    ok: true,
  })
  assert.deepEqual(registry.register(registration(thirdNode).input), {
    ok: false,
    reason: 'capacity',
  })

  const expired = new RelayPairingRendezvousRegistry()
  assert.deepEqual(
    expired.register(
      registration(
        {},
        {
          expiresAt: new Date(Date.now() - 1).toISOString(),
        },
      ).input,
    ),
    { ok: false, reason: 'invalid_expiry' },
  )
  assert.deepEqual(
    expired.register(
      registration(
        {},
        {
          expiresAt: new Date(
            Date.now() + relayProtocolLimits.maximumPairingLifetimeMs + 1_000,
          ).toISOString(),
        },
      ).input,
    ),
    { ok: false, reason: 'invalid_expiry' },
  )
  registry.clear()
})

test('expires, removes on Node disconnect, and clears restart state', async () => {
  const expired = []
  const registry = new RelayPairingRendezvousRegistry(
    4,
    1,
    3,
    10_000,
    (entry) => expired.push(entry.rendezvousId),
  )
  const expiringNode = {}
  const expiring = registration(expiringNode, {
    expiresAt: new Date(Date.now() + 25).toISOString(),
  })
  assert.deepEqual(registry.register(expiring.input), { ok: true })
  await delay(50)
  assert.equal(registry.count, 0)
  assert.deepEqual(expired, [expiring.input.rendezvousId])

  const disconnectedNode = {}
  const disconnected = registration(disconnectedNode)
  assert.deepEqual(registry.register(disconnected.input), { ok: true })
  assert.equal(
    registry.removeForNode(disconnectedNode)?.rendezvousId,
    disconnected.input.rendezvousId,
  )
  assert.equal(registry.count, 0)

  assert.deepEqual(registry.register(registration({}).input), { ok: true })
  registry.clear()
  assert.equal(registry.count, 0)
})

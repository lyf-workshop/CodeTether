import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import { generateRelayApplicationIdentity } from '@codetether/relay-protocol'

import {
  RelayConfigurationSchema,
  RelayConnectionRegistry,
  BoundedTokenBucketRateLimiter,
  RelayStateStore,
  createJsonRelayLogger,
  opaqueReference,
} from '../dist/index.js'

const execFileAsync = promisify(execFile)

test('bounded token bucket limits abuse and refuses unbounded identity state', () => {
  const limiter = new BoundedTokenBucketRateLimiter({
    capacity: 2,
    refillIntervalMs: 1_000,
    maximumEntries: 2,
  })
  assert.deepEqual(limiter.consume('first', 0), { allowed: true })
  assert.deepEqual(limiter.consume('first', 0), { allowed: true })
  assert.equal(limiter.consume('first', 0).allowed, false)
  assert.deepEqual(limiter.consume('second', 0), { allowed: true })
  assert.equal(limiter.consume('third', 0).allowed, false)
  assert.equal(limiter.size, 2)
  assert.equal(limiter.consume('first', 1_000).allowed, true)
})

test('safe structured logs never interpolate hostile remote fields', () => {
  const lines = []
  const logger = createJsonRelayLogger((line) => lines.push(line))
  const malicious =
    '\u001b[31m\n{"event":"relay.started","token":"relay_enroll_secret"}<script>' +
    'A'.repeat(100_000)
  logger.log('connection.rejected', {
    code: malicious,
    peerReference: malicious,
    connectionEpoch: malicious,
    channelId: malicious,
    data: Buffer.from('private Machine TLS ciphertext').toString('base64url'),
  })
  assert.equal(lines.length, 1)
  assert.equal(lines[0].includes('relay_enroll_secret'), false)
  assert.equal(lines[0].includes('<script>'), false)
  assert.equal(lines[0].includes('\u001b'), false)
  assert.equal(lines[0].includes('private'), false)
  assert.equal(lines[0].includes('cHJpdmF0ZQ'), false)
  const parsed = JSON.parse(lines[0])
  assert.equal(parsed.event, 'connection.rejected')
  assert.equal(parsed.peer, opaqueReference(malicious))
  assert.equal(typeof parsed.connection, 'string')
  assert.equal('code' in parsed, false)
})

test('configuration requires explicit paths and loopback management', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codetether-relay-config-'))
  try {
    const valid = {
      stateDirectory: join(root, 'state'),
      listen: { host: '0.0.0.0', port: 443 },
      management: { host: '127.0.0.1', port: 9443 },
      tls: { mode: 'pinned_identity' },
    }
    assert.equal(RelayConfigurationSchema.safeParse(valid).success, true)
    assert.equal(
      RelayConfigurationSchema.safeParse({
        ...valid,
        management: { host: '0.0.0.0', port: 9443 },
      }).success,
      false,
    )
    assert.equal(
      RelayConfigurationSchema.safeParse({
        ...valid,
        stateDirectory: './relative',
      }).success,
      false,
    )
    assert.equal(
      RelayConfigurationSchema.safeParse({
        ...valid,
        tls: { mode: 'plaintext' },
      }).success,
      false,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('connection registry deterministically keeps latest ownership epoch', () => {
  const invalidations = []
  const peer = {
    peerId: 'relay_peer_123456',
    role: 'controller',
    publicKeySpki: 'A'.repeat(80),
    fingerprint: 'B'.repeat(43),
    clientBuildIdentity: 'test',
    enrolledAt: new Date(0).toISOString(),
    lastSeenAt: new Date(0).toISOString(),
  }
  const first = {
    peer,
    epoch: 'relay_connection_first000',
    invalidate: (reason) => invalidations.push(`first:${reason}`),
  }
  const second = {
    peer,
    epoch: 'relay_connection_second00',
    invalidate: (reason) => invalidations.push(`second:${reason}`),
  }
  const registry = new RelayConnectionRegistry()
  assert.equal(registry.replace(first), undefined)
  assert.equal(registry.replace(second), first)
  assert.deepEqual(invalidations, ['first:replaced'])
  assert.equal(registry.owns(first), false)
  assert.equal(registry.remove(first), false)
  assert.equal(registry.owns(second), true)
  assert.equal(registry.count(), 1)
})

test('operator CLI revokes one exact peer fingerprint without exposing a directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codetether-relay-cli-revoke-'))
  const stateDirectory = join(root, 'state')
  try {
    const store = new RelayStateStore(stateDirectory)
    const identity = generateRelayApplicationIdentity()
    const peer = store.enroll({
      token: store.createEnrollmentToken('controller'),
      role: 'controller',
      publicKeySpki: identity.publicKeySpki,
      fingerprint: identity.publicKeyFingerprint,
      clientBuildIdentity: 'test-build',
    })
    store.close()

    const { stdout, stderr } = await execFileAsync(process.execPath, [
      join(process.cwd(), 'dist', 'main.js'),
      'peer',
      'revoke',
      '--state-dir',
      stateDirectory,
      '--peer-fingerprint',
      identity.publicKeyFingerprint,
    ])
    assert.equal(stderr, '')
    assert.deepEqual(JSON.parse(stdout), {
      peerFingerprint: identity.publicKeyFingerprint,
      revoked: true,
    })

    const reopened = new RelayStateStore(stateDirectory)
    assert.notEqual(reopened.getPeerById(peer.peerId)?.revokedAt, undefined)
    reopened.close()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

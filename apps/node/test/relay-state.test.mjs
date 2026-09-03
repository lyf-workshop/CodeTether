import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  NODE_RELAY_CONFIGURATION_FILE,
  NODE_RELAY_ENROLLMENT_TOKEN_FILE,
  NODE_RELAY_PENDING_ENROLLMENT_TOKEN_FILE,
  NODE_RELAY_REGISTRATION_FILE,
  consumeNodeRelayEnrollmentToken,
  readNodeRelayConfiguration,
  readNodeRelayEnrollmentToken,
  readNodeRelayRegistration,
  writeNodeRelayRegistration,
  writeNodeRelayConfiguration,
} from '../dist/relay-state.js'
import { parseNodeCli } from '../dist/main.js'

const fingerprint = 'A'.repeat(43)

test('Node Relay configuration is bounded, private, and contains no enrollment secret', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-node-relay-state-'),
  )
  t.after(async () => {
    await import('node:fs/promises').then(async ({ rm }) =>
      rm(directory, { recursive: true, force: true }),
    )
  })
  assert.equal(await readNodeRelayConfiguration(directory), undefined)
  const path = join(directory, NODE_RELAY_CONFIGURATION_FILE)
  await writeNodeRelayConfiguration(directory, {
    schemaVersion: 1,
    enabled: true,
    endpoint: { host: 'relay.example.test', port: 443 },
    relayIdentityFingerprint: fingerprint,
    tls: { mode: 'public_ca', serverName: 'relay.example.test' },
  })
  const configuration = await readNodeRelayConfiguration(directory)
  assert.deepEqual(configuration, {
    schemaVersion: 1,
    enabled: true,
    endpoint: { host: 'relay.example.test', port: 443 },
    relayIdentityFingerprint: fingerprint,
    tls: { mode: 'public_ca', serverName: 'relay.example.test' },
  })
  assert.equal(Object.hasOwn(configuration, 'enrollmentToken'), false)
  if (process.platform !== 'win32') {
    assert.equal((await stat(path)).mode & 0o777, 0o600)
  }
})

test('Node Relay configuration rejects plaintext-shaped endpoints and unknown fields', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-node-relay-bad-'))
  t.after(async () => {
    await import('node:fs/promises').then(async ({ rm }) =>
      rm(directory, { recursive: true, force: true }),
    )
  })
  const path = join(directory, NODE_RELAY_CONFIGURATION_FILE)
  await writeFile(
    path,
    `${JSON.stringify({
      schemaVersion: 1,
      enabled: true,
      endpoint: { host: 'tls://relay.example.test', port: 443 },
      relayIdentityFingerprint: fingerprint,
      tls: { mode: 'public_ca', serverName: 'relay.example.test' },
      enrollmentToken: 'must-never-be-durable',
    })}\n`,
  )
  await assert.rejects(
    readNodeRelayConfiguration(directory),
    /Node Relay configuration is invalid/u,
  )
})

test('one-use enrollment token is removed only when the exact input is consumed', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-node-relay-token-'),
  )
  t.after(async () => {
    await import('node:fs/promises').then(async ({ rm }) =>
      rm(directory, { recursive: true, force: true }),
    )
  })
  const path = join(directory, NODE_RELAY_ENROLLMENT_TOKEN_FILE)
  const firstSecret = `relay_enroll_${'A'.repeat(43)}`
  await writeFile(path, `${firstSecret}\n`, { mode: 0o600 })
  const token = await readNodeRelayEnrollmentToken(directory)
  assert.equal(token?.secret, firstSecret)
  assert.equal(token?.contentDigest.byteLength, 32)
  await assert.rejects(access(path))
  await access(join(directory, NODE_RELAY_PENDING_ENROLLMENT_TOKEN_FILE))

  const replacement = `relay_enroll_${'B'.repeat(43)}`
  await writeFile(path, `${replacement}\n`)
  await consumeNodeRelayEnrollmentToken(directory, token)
  assert.equal((await readFile(path, 'utf8')).trim(), replacement)

  const current = await readNodeRelayEnrollmentToken(directory)
  await consumeNodeRelayEnrollmentToken(directory, current)
  await assert.rejects(access(path))
  assert.equal(await readNodeRelayEnrollmentToken(directory), undefined)
})

test('one-use enrollment token refuses modified in-flight input', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-node-relay-token-race-'),
  )
  t.after(async () => {
    await import('node:fs/promises').then(async ({ rm }) =>
      rm(directory, { recursive: true, force: true }),
    )
  })
  await writeFile(
    join(directory, NODE_RELAY_ENROLLMENT_TOKEN_FILE),
    `relay_enroll_${'A'.repeat(43)}\n`,
    { mode: 0o600 },
  )
  const token = await readNodeRelayEnrollmentToken(directory)
  const pendingPath = join(directory, NODE_RELAY_PENDING_ENROLLMENT_TOKEN_FILE)
  await writeFile(pendingPath, `relay_enroll_${'B'.repeat(43)}\n`)
  await assert.rejects(
    consumeNodeRelayEnrollmentToken(directory, token),
    /changed before consumption/u,
  )
  assert.equal(
    (await readFile(pendingPath, 'utf8')).trim(),
    `relay_enroll_${'B'.repeat(43)}`,
  )
})

test('one-use enrollment token rejects oversized and structured input', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-node-relay-token-'),
  )
  t.after(async () => {
    await import('node:fs/promises').then(async ({ rm }) =>
      rm(directory, { recursive: true, force: true }),
    )
  })
  const path = join(directory, NODE_RELAY_ENROLLMENT_TOKEN_FILE)
  await writeFile(path, JSON.stringify({ token: 'A'.repeat(48) }))
  await assert.rejects(
    readNodeRelayEnrollmentToken(directory),
    /enrollment token is invalid/u,
  )
  await writeFile(path, 'A'.repeat(513))
  await assert.rejects(
    readNodeRelayEnrollmentToken(directory),
    /state file size is invalid/u,
  )
})

test('Node CLI never accepts Relay enrollment secrets through argv', () => {
  assert.throws(
    () => parseNodeCli(['--relay-token', `relay_enroll_${'T'.repeat(43)}`]),
    /Unknown argument: --relay-token/u,
  )
})

test('Node Relay registration persists only bounded opaque identity metadata', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-node-relay-reg-'))
  t.after(async () => {
    await import('node:fs/promises').then(async ({ rm }) =>
      rm(directory, { recursive: true, force: true }),
    )
  })
  assert.equal(await readNodeRelayRegistration(directory), undefined)
  const registration = {
    schemaVersion: 1,
    relayId: 'relay_abcdef',
    relayIdentityFingerprint: fingerprint,
    peerId: 'relay_peer_abcdef',
    observedAt: '2026-09-03T12:00:00.000Z',
  }
  await writeNodeRelayRegistration(directory, registration)
  assert.deepEqual(await readNodeRelayRegistration(directory), registration)
  const text = await readFile(
    join(directory, NODE_RELAY_REGISTRATION_FILE),
    'utf8',
  )
  assert.equal(text.includes('token'), false)
  assert.equal(text.includes('private'), false)
})

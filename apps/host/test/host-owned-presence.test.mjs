import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  RelayService,
  RelayStateStore,
  generateRelayPinnedTlsIdentity,
} from '@codetether/relay'
import {
  canonicalJsonBytes,
  supervisorDescriptorProofType,
  supervisorGrantProofType,
  verifySupervisorHostPresence,
} from '@codetether/supervisor-transport'
import {
  HostPresenceDiagnosticError,
  HostPresencePublisher,
  publishHostPresence,
} from '../dist/api/host-presence-publisher.js'
import { SupervisorTransportManager } from '../dist/api/supervisor-transport-manager.js'
import {
  HostPresenceDiagnostics,
  HOST_PRESENCE_DIAGNOSTIC_MAX_FILE_BYTES,
} from '../dist/api/host-presence-diagnostics.js'
import { HostPresenceSigningBridge } from '../dist/host-presence-signing.js'
import { ConversationStore } from '../dist/persistence/index.js'

const payload = (seconds = Math.floor(Date.now() / 1000)) => ({
  v: 1,
  aud: 'codetether-host-supervisor',
  purpose: 'host_supervisor_presence',
  hostId: `host_${'h'.repeat(32)}`,
  hostFingerprint: `sha256:${'H'.repeat(43)}`,
  hostIdentityGeneration: 1,
  spaceId: `space_${'s'.repeat(32)}`,
  transportTlsFingerprint: 'T'.repeat(43),
  controlPlaneOrigin: 'https://control-plane.example.test',
  directEndpoints: [{ host: '192.0.2.7', port: 4318 }],
  relay: null,
  iat: seconds,
  exp: seconds + 600,
  protocolVersion: 2,
})
const flush = async () => {
  for (let n = 0; n < 12; n++) await Promise.resolve()
}

test('invalid scheduler bounds fail synchronously before starting a worker', () => {
  for (const invalid of [
    { retryMinimumMs: 0 },
    { retryMaximumMs: 1, retryMinimumMs: 2 },
    { renewalMs: 600_000 },
    { renewalMs: Number.NaN },
  ]) {
    assert.throws(
      () =>
        new HostPresencePublisher({
          createPresence: async () => undefined,
          ...invalid,
        }),
      /Invalid Host presence scheduler bounds/u,
    )
  }
})

test('renderer disappears/window hidden beyond lease: only Host worker continues monotonic renewals', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const published = []
  let rendererAlive = true
  assert.equal(rendererAlive, true)
  const worker = new HostPresencePublisher({
    createPresence: async () => ({
      payload: payload(),
      proof: 'test'.repeat(24),
    }),
    publish: async (presence) => published.push(presence.payload.exp),
  })
  await flush()
  rendererAlive = false // No renderer callback is connected to the worker.
  for (let n = 0; n < 7; n++) {
    t.mock.timers.tick(120_000)
    await flush()
  }
  assert.equal(rendererAlive, false)
  assert.equal(published.length, 8)
  assert.ok(published.at(-1) > published[0] + 600)
  assert.ok(published.every((exp, n) => n === 0 || exp > published[n - 1]))
  await worker.close()
  t.mock.timers.tick(600_000)
  await flush()
  assert.equal(published.length, 8)
})

test('transient network failures back off, recover, and wake coalesces without tight loops', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const times = []
  const diagnostics = []
  const worker = new HostPresencePublisher({
    createPresence: async () => ({
      payload: payload(),
      proof: 'test'.repeat(24),
    }),
    publish: async () => {
      times.push(Date.now())
      if (times.length < 4) throw Error('private failure not logged')
    },
    onDiagnostic: (event, fields) => diagnostics.push({ event, fields }),
  })
  await flush()
  for (const wait of [1000, 2000, 4000]) {
    t.mock.timers.tick(wait)
    await flush()
  }
  assert.deepEqual(
    times.map((time) => time - times[0]),
    [0, 1000, 3000, 7000],
  )
  assert.deepEqual(
    diagnostics
      .filter(({ event }) => event === 'PRESENCE_RETRY_SCHEDULED')
      .map(({ fields }) => fields.retryDelayMs),
    [1000, 2000, 4000],
  )
  assert.ok(
    diagnostics.some(({ event }) => event === 'PRESENCE_RENEWAL_SCHEDULED'),
  )
  t.mock.timers.tick(120_000)
  await flush()
  assert.equal(times.length, 5)
  // Existing native wake/network signal requests a fresh lease immediately.
  worker.requestRenewal()
  worker.requestRenewal()
  await flush()
  assert.equal(times.length, 6)
  await worker.close()
})

test('Presence lifecycle snapshot remains alive across a post-publish failure', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const diagnostics = []
  let attempts = 0
  const worker = new HostPresencePublisher({
    createPresence: async () => ({
      payload: payload(),
      proof: 'test'.repeat(24),
    }),
    publish: async () => {
      attempts++
      if (attempts === 1) throw Error('post-publish fixture failure')
    },
    onDiagnostic: (event, fields) => diagnostics.push({ event, fields }),
  })
  await flush()
  let snapshot = worker.diagnosticSnapshot()
  assert.equal(snapshot.publisherTaskAlive, true)
  assert.equal(snapshot.totalAttempts, 1)
  assert.equal(snapshot.totalFailures, 1)
  assert.equal(snapshot.lastPublishFailureCategory, 'unknown')
  assert.equal(snapshot.currentRequestInFlight, false)
  t.mock.timers.tick(1_000)
  await flush()
  snapshot = worker.diagnosticSnapshot()
  assert.equal(attempts, 2)
  assert.equal(snapshot.totalSuccesses, 1)
  assert.equal(snapshot.consecutiveFailures, 0)
  assert.equal(snapshot.publisherTaskAlive, true)
  assert.ok(
    diagnostics.some(({ event }) => event === 'PRESENCE_LOOP_ITERATION'),
  )
  assert.ok(
    diagnostics.some(({ event }) => event === 'PRESENCE_PUBLISH_ATTEMPT'),
  )
  assert.ok(
    diagnostics.some(({ event }) => event === 'PRESENCE_PUBLISH_FAILURE'),
  )
  assert.ok(
    diagnostics.some(({ event }) => event === 'PRESENCE_PUBLISH_SUCCESS'),
  )
  const closing = worker.close()
  await closing
  assert.ok(
    diagnostics.some(
      ({ event, fields }) =>
        event === 'PRESENCE_PUBLISHER_EXIT' &&
        fields.exitReason === 'shutdown' &&
        fields.shutdownExpected === true,
    ),
  )
})

test('descriptor/configuration failure is observed and does not terminate the publisher', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  let attempts = 0
  const worker = new HostPresencePublisher({
    createPresence: async () => {
      attempts++
      if (attempts === 1) throw new HostPresenceDiagnosticError('signing')
      return { payload: payload(), proof: 'test'.repeat(24) }
    },
    publish: async () => undefined,
  })
  await flush()
  assert.equal(
    worker.diagnosticSnapshot().lastPublishFailureCategory,
    'signing',
  )
  t.mock.timers.tick(1_000)
  await flush()
  assert.equal(attempts, 2)
  assert.equal(worker.diagnosticSnapshot().publisherTaskAlive, true)
  await worker.close()
})

test('Controller-only/unclaimed Host never signs/publishes; late enable and real disable are respected', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let claimed = false,
    published = 0
  const worker = new HostPresencePublisher({
    createPresence: async () =>
      claimed ? { payload: payload(), proof: 'test'.repeat(24) } : undefined,
    publish: async () => {
      published++
    },
  })
  await flush()
  assert.equal(published, 0)
  claimed = true
  worker.requestRenewal()
  await flush()
  assert.equal(published, 1)
  claimed = false
  worker.requestRenewal()
  await flush()
  t.mock.timers.tick(720_000)
  await flush()
  assert.equal(published, 1)
  await worker.close()
})

test('HTTP publisher sends only Host envelope, no token/proof/cookies and no redirect fallback', async () => {
  const original = globalThis.fetch
  let seen = false
  const diagnostics = []
  globalThis.fetch = async (url, init) => {
    seen = true
    assert.equal(
      url,
      `https://control-plane.example.test/v1/hosts/${payload().hostId}/supervisor-host-presence`,
    )
    assert.deepEqual(init.headers, { 'content-type': 'application/json' })
    assert.equal(init.redirect, 'error')
    assert.equal(
      JSON.parse(init.body).payload.purpose,
      'host_supervisor_presence',
    )
    return new Response('{}', { status: 200 })
  }
  try {
    await publishHostPresence(
      { payload: payload(), proof: 'test'.repeat(24) },
      new AbortController().signal,
      (event, fields) => diagnostics.push({ event, fields }),
    )
    assert.ok(seen)
    assert.deepEqual(
      diagnostics.map(({ event, fields }) => [event, fields.statusClass]),
      [
        ['PRESENCE_HTTP_START', undefined],
        ['PRESENCE_HTTP_RESULT', '2xx'],
      ],
    )
  } finally {
    globalThis.fetch = original
  }
})

test('presence diagnostics retain only allowlisted fields in a bounded owner-only file', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-presence-diagnostics-'),
  )
  try {
    const diagnostics = new HostPresenceDiagnostics(
      join(directory, 'state.sqlite3'),
    )
    diagnostics.record('PRESENCE_HTTP_RESULT', {
      hostId: payload().hostId,
      generation: 1,
      endpointOrigin: 'https://api.codetether.org',
      authMode: 'host_es256_jws',
      statusClass: '4xx',
      errorCategory: 'http_rejected',
      retryDelayMs: 1000,
      proof: 'NEVER-LOG-THIS',
      authorization: 'NEVER-LOG-THIS',
    })
    diagnostics.record('TRANSPORT_STATE_UPDATED', {
      directEndpointCount: 1,
      relayConnected: false,
      host: 'NEVER-LOG-THIS',
    })
    const file = join(directory, 'logs', 'host-presence.jsonl')
    const [entry, transport] = (await readFile(file, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    assert.equal(entry.event, 'PRESENCE_HTTP_RESULT')
    assert.equal(entry.statusClass, '4xx')
    assert.equal(entry.errorCategory, 'http_rejected')
    assert.equal(entry.endpointOrigin, 'https://api.codetether.org')
    assert.equal(entry.proof, undefined)
    assert.equal(entry.authorization, undefined)
    assert.equal(transport.directEndpointCount, 1)
    assert.equal(transport.relayConnected, false)
    assert.equal(transport.host, undefined)
    assert.equal((await stat(file)).mode & 0o777, 0o600)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('presence diagnostics rotate instead of stopping at one full file', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-presence-rotation-'),
  )
  try {
    const diagnostics = new HostPresenceDiagnostics(
      join(directory, 'state.sqlite3'),
    )
    for (let n = 0; n < 2_000; n++) {
      diagnostics.record('PRESENCE_LOOP_ITERATION', {
        hostId: payload().hostId,
        generation: 1,
        endpointOrigin: 'https://api.codetether.org',
        authMode: 'host_es256_jws',
      })
    }
    const file = join(directory, 'logs', 'host-presence.jsonl')
    const rotated = `${file}.1`
    assert.ok((await stat(rotated)).size > 0)
    assert.ok(
      (await stat(file)).size <= HOST_PRESENCE_DIAGNOSTIC_MAX_FILE_BYTES,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('purpose-limited native pipe replies are single-flight, bounded, not logged and do not accept late signatures', async () => {
  const emitted = []
  const bridge = new HostPresenceSigningBridge((line) => emitted.push(line))
  const first = bridge.sign(
    'CodeTether.HostIdentity.fixture',
    payload(),
    new AbortController().signal,
  )
  const request = JSON.parse(emitted[0].slice('host-presence-sign '.length))
  await assert.rejects(
    bridge.sign(
      'CodeTether.HostIdentity.fixture',
      payload(),
      new AbortController().signal,
    ),
  )
  bridge.receive(
    `host-presence-signature ${JSON.stringify({ id: 'wrong-id', signature: 'S'.repeat(86) })}`,
  )
  bridge.receive(
    `host-presence-signature ${JSON.stringify({ id: request.id, signature: 'S'.repeat(86) })}`,
  )
  assert.ok((await first).endsWith(`.${'S'.repeat(86)}`))
  const abort = new AbortController()
  const next = bridge.sign(
    'CodeTether.HostIdentity.fixture',
    payload(),
    abort.signal,
  )
  abort.abort()
  await assert.rejects(next)
})

test('existing claimed Windows/macOS Host restores same identity/context and immediately publishes after process restart without renderer', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-host-publisher-'))
  const originalFetch = globalThis.fetch
  const captured = []
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  })
  const publicJwk = publicKey.export({ format: 'jwk' })
  const canonical = JSON.stringify({
    crv: publicJwk.crv,
    kty: publicJwk.kty,
    x: publicJwk.x,
    y: publicJwk.y,
  })
  const signPayload = (p, type) => {
    const encoded = `${Buffer.from(JSON.stringify({ alg: 'ES256', typ: type })).toString('base64url')}.${Buffer.from(canonicalJsonBytes(p)).toString('base64url')}`
    return `${encoded}.${sign('sha256', Buffer.from(encoded), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`
  }
  globalThis.fetch = async (_url, init) => {
    captured.push(JSON.parse(init.body))
    return new Response('{}', { status: 200 })
  }
  try {
    for (const platform of ['windows', 'macos']) {
      const dbPath = join(directory, `${platform}.sqlite3`)
      let interfaces = {
        Ethernet: [
          {
            address: '192.0.2.7',
            netmask: '255.255.255.0',
            family: 'IPv4',
            mac: '00:00:00:00:00:01',
            internal: false,
            cidr: '192.0.2.7/24',
          },
        ],
      }
      let store = ConversationStore.open({ databasePath: dbPath })
      const time = new Date().toISOString()
      const identity = {
        hostId: payload().hostId,
        publicJwk: canonical,
        fingerprint: `sha256:${createHash('sha256').update(canonical).digest('base64url')}`,
        keyAlgorithm: 'ES256',
        keyHandle: `CodeTether.HostIdentity.${'0'.repeat(32)}`,
        identityGeneration: 1,
        safeLabel: 'Synthetic Host',
        platform,
        appVersion: 'test',
        createdAt: time,
        updatedAt: time,
        lastRegisteredAt: time,
      }
      store.createHostIdentity(identity)
      const grantPayload = {
        v: 1,
        aud: 'codetether-host-supervisor',
        purpose: 'host_supervisor_grant',
        authorizationId: `hauth_${'a'.repeat(32)}`,
        hostId: identity.hostId,
        hostFingerprint: identity.fingerprint,
        hostIdentityGeneration: 1,
        deviceId: `dev_${'d'.repeat(32)}`,
        deviceFingerprint: `sha256:${'D'.repeat(43)}`,
        deviceKeyGeneration: 1,
        userId: `usr_${'u'.repeat(32)}`,
        spaceId: payload().spaceId,
        scope: 'supervisor_read',
        authorizationSerial: '1',
        authorizationGeneration: 1,
        issuedAt: payload().iat,
        expiresAt: payload().iat + 86400,
      }
      store.storeHostSupervisorGrant(
        {
          payload: grantPayload,
          proof: signPayload(grantPayload, supervisorGrantProofType),
        },
        time,
      )
      for (let restart = 0; restart < 2; restart++) {
        const before = captured.length
        const manager = await SupervisorTransportManager.create({
          service: { getHostIdentity: () => store.getHostIdentity() },
          persistence: store,
          port: 0,
          bindHost: '127.0.0.1',
          ...(platform === 'macos'
            ? { discoverNetworkInterfaces: () => interfaces }
            : { advertiseHost: '192.0.2.7' }),
          clientBuildIdentity: 'fixture',
          // The first startup may seed migration-23 context from the verified
          // grant; later restarts must use the durable Host-owned config alone.
          ...(restart === 0
            ? { controlPlaneOrigin: payload().controlPlaneOrigin }
            : {}),
          signHostPresence: async (_handle, p) =>
            signPayload(p, supervisorDescriptorProofType),
        })
        try {
          for (let n = 0; captured.length === before && n < 100; n++)
            await new Promise((resolve) => setTimeout(resolve, 10))
          assert.equal(captured.length, before + 1)
          await verifySupervisorHostPresence(captured.at(-1), publicJwk)
          assert.equal(captured.at(-1).payload.hostId, identity.hostId)
          assert.equal(store.listEnabledHostSupervisorGrants().length, 1)
          assert.deepEqual(store.getHostIdentity(), identity)
          if (platform === 'macos' && restart === 0) {
            interfaces = {}
            manager.requestTransportRecovery()
            await waitForPresence(
              () => manager.presenceDiagnostics().totalFailures >= 1,
            )
            assert.deepEqual(manager.presence().directEndpoints, [])
            assert.equal(captured.length, before + 1)
            assert.equal(manager.presenceDiagnostics().publisherTaskAlive, true)
            assert.equal(
              manager.presenceDiagnostics().lastPublishFailureCategory,
              'transport_unavailable',
            )
            assert.equal(manager.presenceDiagnostics().currentBackoffMs, 1_000)
            await new Promise((resolve) => setTimeout(resolve, 50))
            assert.equal(manager.presenceDiagnostics().totalFailures, 1)

            interfaces = {
              Ethernet: [
                {
                  address: '192.0.2.8',
                  netmask: '255.255.255.0',
                  family: 'IPv4',
                  mac: '00:00:00:00:00:01',
                  internal: false,
                  cidr: '192.0.2.8/24',
                },
              ],
            }
            await waitForPresence(() => captured.length === before + 2)
            assert.deepEqual(captured.at(-1).payload.directEndpoints, [
              {
                host: '192.0.2.8',
                port: manager.presence().directEndpoints[0].port,
              },
            ])
            assert.equal(manager.presenceDiagnostics().totalSuccesses, 2)
          }
          if (restart === 1) {
            const context = {
              spaceId: payload().spaceId,
              controlPlaneOrigin: payload().controlPlaneOrigin,
            }
            assert.equal(
              await manager.configureHostPresence({
                ...context,
                enabled: false,
              }),
              null,
            )
            const stoppedAt = captured.length
            assert.equal(await manager.configureHostPresence(context), null)
            manager.requestPresenceRenewal()
            await new Promise((resolve) => setTimeout(resolve, 20))
            assert.equal(captured.length, stoppedAt)
            assert.equal(store.getHostPresenceConfiguration().enabled, false)
          }
        } finally {
          await manager.close()
        }
        store.close()
        store = ConversationStore.open({ databasePath: dbPath })
      }
      // Revoked/pruned activation must not resurrect at next renewal/restart.
      store.pruneHostSupervisorGrants([])
      assert.equal(store.listEnabledHostSupervisorGrants().length, 0)
      assert.ok(store.getHostSupervisorGrant(grantPayload.authorizationId))
      store.close()
    }
  } finally {
    globalThis.fetch = originalFetch
    await rm(directory, { recursive: true, force: true })
  }
})

async function waitForPresence(predicate, timeoutMs = 2_000) {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error('Timed out waiting for local Presence state')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test('Relay reconnect restores descriptor and Presence; either transport can recover alone', async () => {
  const root = await mkdtemp(
    join(tmpdir(), 'codetether-host-transport-recovery-'),
  )
  const statePath = join(root, 'relay-state')
  const relayLogs = []
  const makeRelay = async (port) => {
    const stateStore = new RelayStateStore(statePath)
    const relay = new RelayService({
      stateStore,
      tls: await generateRelayPinnedTlsIdentity(stateStore.identity),
      host: '127.0.0.1',
      port,
      managementPort: 0,
      logger: {
        log: (event, fields = {}) => relayLogs.push({ event, ...fields }),
      },
    })
    await relay.start()
    return relay
  }
  let relay = await makeRelay(0)
  let manager
  const originalFetch = globalThis.fetch
  const captured = []
  let interfaces = {}
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  })
  const publicJwk = publicKey.export({ format: 'jwk' })
  const canonical = JSON.stringify({
    crv: publicJwk.crv,
    kty: publicJwk.kty,
    x: publicJwk.x,
    y: publicJwk.y,
  })
  const store = ConversationStore.open({
    databasePath: join(root, 'host.sqlite3'),
  })
  const now = new Date().toISOString()
  store.createHostIdentity({
    hostId: payload().hostId,
    publicJwk: canonical,
    fingerprint: `sha256:${createHash('sha256').update(canonical).digest('base64url')}`,
    keyAlgorithm: 'ES256',
    keyHandle: `CodeTether.HostIdentity.${'0'.repeat(32)}`,
    identityGeneration: 1,
    safeLabel: 'Synthetic Host',
    platform: 'macos',
    appVersion: 'test',
    createdAt: now,
    updatedAt: now,
    lastRegisteredAt: now,
  })
  store.configureHostPresence({
    spaceId: payload().spaceId,
    controlPlaneOrigin: payload().controlPlaneOrigin,
    enabled: true,
  })
  globalThis.fetch = async (_url, init) => {
    captured.push(JSON.parse(init.body))
    return new Response('{}', { status: 200 })
  }
  try {
    const relayPort = relay.listeningAddress.port
    manager = await SupervisorTransportManager.create({
      service: { getHostIdentity: () => store.getHostIdentity() },
      persistence: store,
      port: 0,
      bindHost: '127.0.0.1',
      clientBuildIdentity: 'fixture',
      discoverNetworkInterfaces: () => interfaces,
      relay: {
        endpoint: `tls+pinned://127.0.0.1:${relayPort}/`,
        relayId: relay.relayId,
        relayFingerprint: relay.relayFingerprint,
      },
      signHostPresence: async (_handle, p) => {
        const encoded = `${Buffer.from(JSON.stringify({ alg: 'ES256', typ: supervisorDescriptorProofType })).toString('base64url')}.${Buffer.from(canonicalJsonBytes(p)).toString('base64url')}`
        return `${encoded}.${sign('sha256', Buffer.from(encoded), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`
      },
    })
    await waitForPresence(() => captured.length >= 1, 5_000)
    assert.deepEqual(captured.at(-1).payload.directEndpoints, [])
    const descriptor = captured.at(-1).payload.relay
    assert.notEqual(descriptor, null)

    await relay.close()
    await waitForPresence(() => manager.presence().relay === null)
    const beforeOutage = captured.length
    await waitForPresence(
      () => manager.presenceDiagnostics().totalFailures >= 1,
    )
    assert.equal(captured.length, beforeOutage)

    relay = await makeRelay(relayPort)
    await waitForPresence(() => captured.length > beforeOutage, 5_000)
    assert.deepEqual(captured.at(-1).payload.directEndpoints, [])
    assert.deepEqual(captured.at(-1).payload.relay, descriptor)
    const reconnects = relayLogs.filter(
      (entry) =>
        entry.event === 'supervisor.connection.authenticated' &&
        entry.role === 'host',
    ).length
    for (let index = 0; index < 5; index++) manager.requestTransportRecovery()
    assert.equal(
      relayLogs.filter(
        (entry) =>
          entry.event === 'supervisor.connection.authenticated' &&
          entry.role === 'host',
      ).length,
      reconnects,
    )

    await relay.close()
    await waitForPresence(() => manager.presence().relay === null)
    interfaces = {
      Ethernet: [
        {
          address: '192.0.2.9',
          netmask: '255.255.255.0',
          family: 'IPv4',
          mac: '00:00:00:00:00:01',
          internal: false,
          cidr: '192.0.2.9/24',
        },
      ],
    }
    const beforeDirect = captured.length
    manager.requestTransportRecovery()
    await waitForPresence(() => captured.length > beforeDirect)
    assert.deepEqual(captured.at(-1).payload.directEndpoints, [
      { host: '192.0.2.9', port: manager.presence().directEndpoints[0].port },
    ])
    assert.equal(captured.at(-1).payload.relay, null)
    await manager.close()
    assert.equal(manager.presenceDiagnostics().publisherTaskAlive, false)
    manager = undefined
  } finally {
    globalThis.fetch = originalFetch
    await manager?.close()
    await relay.close()
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('UI only reconciles grants; native Host pipe, not WebView, owns Host signing capability', async () => {
  const [remote, coordinator, native] = await Promise.all([
    readFile(
      new URL(
        '../../web/src/runtime/account/remote-supervisor.ts',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(
      new URL(
        '../../web/src/runtime/account/local-supervisor-presence.tsx',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(
      new URL(
        '../../desktop/src-tauri/src/host_presence_signer.rs',
        import.meta.url,
      ),
      'utf8',
    ),
  ])
  assert.doesNotMatch(remote, /\/supervisor-host-presence/u)
  assert.doesNotMatch(coordinator, /publishLocalSupervisorPresence/u)
  assert.match(native, /host_identity_key_sign/u)
  assert.doesNotMatch(
    native,
    /product_device_key_sign|refresh_token|access_token|create_key/u,
  )
})

test('managed production serve wires native signer to runtime assembly, not argument parsing', async () => {
  const source = await readFile(
    new URL('../src/serve.ts', import.meta.url),
    'utf8',
  )
  const assembly = source.slice(
    source.indexOf('host = await startLocalCodexHost('),
  )
  assert.match(assembly, /signHostPresence:/u)
  assert.match(assembly, /signer\.sign\(keyHandle, payload, signal\)/u)
  const argumentsOnly = source.slice(
    source.indexOf('const arguments_ = parseServeArguments'),
    source.indexOf('const hostVersion ='),
  )
  assert.doesNotMatch(argumentsOnly, /signHostPresence/u)
})

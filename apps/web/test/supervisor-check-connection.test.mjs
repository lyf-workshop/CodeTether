import assert from 'node:assert/strict'
import test from 'node:test'
import {
  connectRemoteSupervisor,
  currentRemoteSupervisorSession,
  disconnectRemoteSupervisor,
  readRemoteBootstrap,
  readRemoteMachine,
  readRemoteMachines,
  reconnectRemoteSupervisor,
} from '../.tmp/test-dist/runtime/account/remote-supervisor.js'
import { runSupervisorCheck } from '../.tmp/test-dist/dev/supervisor-check-model.js'

test('machine.get accepts the Supervisor projection and rejects mismatched identity or shape', async () => {
  const previousFetch = globalThis.fetch
  const machineId = 'machine_diagnostic'
  const session = {
    sessionId: 'session_diagnostic',
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
  }
  const machine = {
    machineId,
    displayName: 'Fixture PC',
    kind: 'local',
    platform: 'windows',
    architecture: 'x64',
    availability: 'available',
    connectionState: 'local',
    trustState: 'local',
    isLocal: true,
    createdAt: '2026-11-03T00:00:00.000Z',
    capabilities: {
      projectAccess: true,
      providerExecution: true,
      backgroundRuntime: true,
      nativeFolderPicker: true,
      notifications: true,
    },
  }
  const projection = {
    protocolVersion: 1,
    machine,
    providers: [],
    providerLifecycles: [],
  }
  let payload = projection
  globalThis.fetch = async (input) => {
    assert.ok(
      String(input).endsWith(
        `/sessions/${session.sessionId}/machines/${machineId}`,
      ),
    )
    return Response.json(payload)
  }
  try {
    assert.deepEqual(await readRemoteMachine(session, machineId), {
      machine,
      providers: [],
    })
    for (const invalid of [
      { ...projection, machine: { ...machine, machineId: 'machine_other' } },
      { ...projection, providers: [{}] },
      { ...projection, projects: [] },
    ]) {
      payload = invalid
      await assert.rejects(readRemoteMachine(session, machineId), {
        message: 'remote_supervisor_response_invalid',
      })
    }
  } finally {
    globalThis.fetch = previousFetch
  }
})

function options(hostId) {
  return {
    session: { access_token: 'original-test-session' },
    host: {
      hostId,
      fingerprint: 'public-fingerprint',
      identityGeneration: 1,
      publicKey: {},
      supervisor: { grant: {}, transport: {} },
    },
    productDevice: {
      device: { deviceId: 'dev_diagnostic', keyGeneration: 1 },
      key: { keyHandle: 'test-key' },
    },
    deviceIdentity: {
      available: true,
      sign: async () => ({
        keyAlgorithm: 'ES256',
        signatureBase64Url: 'test-signature',
      }),
    },
  }
}

function mockTransport() {
  const requests = []
  let sequence = 0
  let beforeAuthentication = async () => {}
  const fetch = async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body === undefined ? undefined : JSON.parse(init.body)
    requests.push({ url, method, body })
    if (url.endsWith('/connections')) {
      sequence += 1
      return Response.json({
        connectionId: `connection_${sequence}`,
        admissionResource: '/v1/hosts/admit',
        challengeBodyBase64Url: 'e30',
        transport: body.forceRelay === true ? 'relay' : 'direct',
      })
    }
    if (url.endsWith('/authenticate')) {
      const id = /connection_(\d+)/u.exec(url)[1]
      await beforeAuthentication()
      return Response.json({
        sessionId: `session_${id}`,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        control: 'read',
      })
    }
    if (method === 'DELETE') return new Response(null, { status: 204 })
    if (url.endsWith('/bootstrap')) return Response.json({ protocolVersion: 1 })
    if (url.endsWith('/machines')) return Response.json({ machines: [] })
    assert.fail('unexpected request')
  }
  return {
    requests,
    fetch,
    beforeAuthentication: (value) => {
      beforeAuthentication = value
    },
  }
}

test('detached checks keep same-Host cached sessions and reconnect contexts unchanged', async () => {
  const previousFetch = globalThis.fetch
  const transport = mockTransport()
  globalThis.fetch = transport.fetch
  const originalOptions = options('host_diagnostic_cache')
  let cached
  let reconnected
  try {
    cached = await connectRemoteSupervisor(originalOptions)
    const beforeDetached = transport.requests.length
    const detached = await connectRemoteSupervisor({
      ...originalOptions,
      session: { access_token: 'isolated-test-session' },
      detached: true,
      forceRelay: true,
    })
    assert.equal(
      transport.requests.length - beforeDetached,
      2,
      'individual reads must not be prefetched',
    )
    assert.equal(
      currentRemoteSupervisorSession(originalOptions.host.hostId),
      cached,
    )
    await readRemoteBootstrap(detached)
    await readRemoteMachines(detached)
    assert.ok(
      transport.requests.at(-1).url.endsWith('/sessions/session_2/machines'),
    )
    await disconnectRemoteSupervisor(detached)
    assert.ok(transport.requests.at(-1).url.endsWith('/sessions/session_2'))
    assert.equal(
      currentRemoteSupervisorSession(originalOptions.host.hostId),
      cached,
    )
    const beforeReuse = transport.requests.length
    assert.equal(await connectRemoteSupervisor(originalOptions), cached)
    assert.equal(transport.requests.length, beforeReuse)
    reconnected = await reconnectRemoteSupervisor(originalOptions.host.hostId)
    assert.equal(reconnected.transport, 'direct')
    const authentications = transport.requests.filter((request) =>
      request.url.endsWith('/authenticate'),
    )
    assert.equal(
      authentications.at(-1).body.accessToken,
      'original-test-session',
    )
    assert.ok(
      !transport.requests.some((request) =>
        /turns|activations|\/control\//u.test(request.url),
      ),
    )
  } finally {
    if (reconnected !== undefined) await disconnectRemoteSupervisor(reconnected)
    else if (cached !== undefined) await disconnectRemoteSupervisor(cached)
    globalThis.fetch = previousFetch
  }
})

test('an already aborted detached connect makes zero requests', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () =>
    assert.fail('aborted checks cannot begin a connection')
  const controller = new AbortController()
  controller.abort()
  try {
    await assert.rejects(
      connectRemoteSupervisor({
        ...options('host_diagnostic_preabort'),
        detached: true,
        signal: controller.signal,
      }),
      { name: 'AbortError' },
    )
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('cancelling as begin responds releases pending ownership without signing or authenticating', async () => {
  const previousFetch = globalThis.fetch
  const transport = mockTransport()
  const controller = new AbortController()
  globalThis.fetch = async (input, init) => {
    const response = await transport.fetch(input, init)
    if (String(input).endsWith('/connections')) controller.abort()
    return response
  }
  try {
    const input = options('host_diagnostic_pending_abort')
    await assert.rejects(
      connectRemoteSupervisor({
        ...input,
        deviceIdentity: {
          ...input.deviceIdentity,
          sign: async () =>
            assert.fail('cancelled pending connection must not sign'),
        },
        detached: true,
        signal: controller.signal,
      }),
      { name: 'AbortError' },
    )
    assert.deepEqual(
      transport.requests.map((request) => request.method),
      ['POST', 'DELETE'],
    )
    assert.ok(
      transport.requests.at(-1).url.endsWith('/connections/connection_1'),
    )
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('a cancelled authentication releases its late session without touching another session', async () => {
  const previousFetch = globalThis.fetch
  const transport = mockTransport()
  globalThis.fetch = transport.fetch
  let authenticated
  const waiting = new Promise((resolve) => {
    authenticated = resolve
  })
  transport.beforeAuthentication(() => waiting)
  const controller = new AbortController()
  try {
    const connecting = connectRemoteSupervisor({
      ...options('host_diagnostic_late'),
      detached: true,
      signal: controller.signal,
    })
    while (
      !transport.requests.some((request) =>
        request.url.endsWith('/authenticate'),
      )
    )
      await new Promise((resolve) => setImmediate(resolve))
    controller.abort()
    authenticated()
    await assert.rejects(connecting, { name: 'AbortError' })
    assert.deepEqual(
      transport.requests
        .filter((request) => request.method === 'DELETE')
        .map((request) => request.url.split('/').at(-1)),
      ['session_1'],
    )
    assert.equal(
      currentRemoteSupervisorSession('host_diagnostic_late'),
      undefined,
    )
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('native signing failure releases the exact pending connection before returning failure', async () => {
  const previousFetch = globalThis.fetch
  const transport = mockTransport()
  globalThis.fetch = transport.fetch
  try {
    const input = options('host_diagnostic_sign_failure')
    await assert.rejects(
      connectRemoteSupervisor({
        ...input,
        detached: true,
        deviceIdentity: {
          ...input.deviceIdentity,
          sign: async () => {
            throw new Error('private native error')
          },
        },
      }),
      /private native error/u,
    )
    assert.deepEqual(
      transport.requests.map((request) => [
        request.method,
        request.url.split('/').slice(-2).join('/'),
      ]),
      [
        ['POST', 'remote-supervisor/connections'],
        ['DELETE', 'connections/connection_1'],
      ],
    )
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('failed cleanup after a late authentication is visible for HTTP and network errors', async () => {
  const previousFetch = globalThis.fetch
  try {
    for (const networkError of [false, true]) {
      const transport = mockTransport()
      const controller = new AbortController()
      globalThis.fetch = async (input, init) => {
        if (init?.method === 'DELETE') {
          if (networkError) throw new Error('private network error')
          return new Response(null, { status: 500 })
        }
        return await transport.fetch(input, init)
      }
      transport.beforeAuthentication(async () => {
        controller.abort()
      })
      const result = await runSupervisorCheck({
        connect: () =>
          connectRemoteSupervisor({
            ...options(`host_diagnostic_cleanup_${networkError}`),
            detached: true,
            signal: controller.signal,
          }),
        forceRelay: false,
        signal: controller.signal,
      })
      assert.equal(result.connection.error, 'cleanup_failed')
      assert.equal(result.cleanup.status, 'failed')
      assert.equal(result.cleanup.error, 'cleanup_failed')
      assert.ok(!JSON.stringify(result).includes('private network error'))
    }
  } finally {
    globalThis.fetch = previousFetch
  }
})

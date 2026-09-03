import assert from 'node:assert/strict'
import { X509Certificate, createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:tls'
import test from 'node:test'

import { generateMachineTlsIdentity } from '@codetether/machine-transport'
import {
  FramedRelayConnection,
  RelayClientMessageSchema,
  generateRelayApplicationIdentity,
  newRelayChallengeId,
  newRelayConnectionEpoch,
  newRelayId,
  newRelayNonce,
  newRelayPeerId,
  newRelayPingId,
  relayAuthenticationTranscript,
  relayChallengeTranscript,
  relayEnrollmentTranscript,
  relayProtocolAlpn,
  relayProtocolLimits,
  relayProtocolVersion,
  relayPublicKeySpkiFromCertificate,
  signRelayTranscript,
  verifyRelayTranscript,
} from '@codetether/relay-protocol'

import {
  RelayService,
  RelayStateStore,
  generateRelayPinnedTlsIdentity,
} from '../../../apps/relay/dist/index.js'

import { RelayClientError, connectRelayControl } from '../dist/index.js'

const enrollmentToken = `relay_enroll_${'T'.repeat(43)}`

async function peerIdentity(role = 'node') {
  const tls = await generateMachineTlsIdentity(
    role === 'node' ? 'CodeTether Node' : 'CodeTether Controller',
  )
  return {
    role,
    privateKeyPem: tls.privateKeyPem,
    publicKeySpki: relayPublicKeySpkiFromCertificate(tls.certificatePem),
    publicKeyFingerprint: tls.publicKeyFingerprint,
  }
}

async function startRelayFixture(options = {}) {
  const tls =
    options.tls ?? (await generateMachineTlsIdentity('CodeTether Node'))
  const application = options.application ?? generateRelayApplicationIdentity()
  const relayId = options.relayId ?? newRelayId()
  const peerId = options.peerId ?? newRelayPeerId()
  let enrolled = options.enrolled ?? false
  let connections = 0
  let pongs = 0
  const grants = []
  const failures = []
  const sockets = new Set()
  const server = createServer(
    {
      key: tls.privateKeyPem,
      cert: tls.certificatePem,
      ALPNProtocols: [relayProtocolAlpn],
      minVersion: 'TLSv1.3',
      maxVersion: 'TLSv1.3',
    },
    (socket) => {
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
      void serve(socket).catch((error) => {
        failures.push(error)
        socket.destroy()
      })
    },
  )

  async function serve(socket) {
    connections += 1
    const framed = new FramedRelayConnection(socket)
    const issuedAt = new Date()
    const expiresAt = new Date(
      issuedAt.getTime() + relayProtocolLimits.challengeLifetimeMs,
    )
    const unsigned = {
      type: 'relay.challenge',
      protocolVersion: options.challengeProtocolVersion ?? relayProtocolVersion,
      relayId,
      relayPublicKeySpki: application.publicKeySpki,
      relayFingerprint: application.publicKeyFingerprint,
      challengeId: newRelayChallengeId(),
      nonce: newRelayNonce(),
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    }
    const challenge = {
      ...unsigned,
      signature: signRelayTranscript(
        application.privateKeyPem,
        relayChallengeTranscript(unsigned),
      ),
    }
    await framed.send(challenge)
    const request = await framed.receive(RelayClientMessageSchema)
    if (request.type === 'peer.enroll') {
      assert.equal(request.enrollmentToken, enrollmentToken)
      assert.equal(
        verifyRelayTranscript(
          request.peerPublicKeySpki,
          relayEnrollmentTranscript({
            challenge,
            role: request.role,
            enrollmentToken: request.enrollmentToken,
            peerPublicKeySpki: request.peerPublicKeySpki,
            peerFingerprint: request.peerFingerprint,
            clientBuildIdentity: request.clientBuildIdentity,
            ...(request.authorizedControllerFingerprint === undefined
              ? {}
              : {
                  authorizedControllerFingerprint:
                    request.authorizedControllerFingerprint,
                }),
          }),
          request.signature,
        ),
        true,
      )
      enrolled = true
    } else if (request.type === 'peer.authenticate') {
      if (!enrolled) {
        await framed.send({
          type: 'relay.error',
          protocolVersion: relayProtocolVersion,
          code: 'authentication_failed',
          message: options.rawError ?? 'Authentication failed',
        })
        framed.end()
        return
      }
      assert.equal(
        verifyRelayTranscript(
          options.expectedPeerPublicKeySpki,
          relayAuthenticationTranscript({
            challenge,
            peerFingerprint: request.peerFingerprint,
            role: request.role,
            clientBuildIdentity: request.clientBuildIdentity,
          }),
          request.signature,
        ),
        true,
      )
    } else {
      throw new Error('fixture expected Relay authentication')
    }
    const connectionEpoch = newRelayConnectionEpoch()
    await framed.send({
      type: 'peer.ready',
      protocolVersion: options.readyProtocolVersion ?? relayProtocolVersion,
      peerId,
      role: request.role,
      connectionEpoch,
      heartbeatIntervalMs:
        options.heartbeatIntervalMs ?? relayProtocolLimits.heartbeatIntervalMs,
      heartbeatTimeoutMs:
        options.heartbeatTimeoutMs ?? relayProtocolLimits.heartbeatTimeoutMs,
      authenticatedAt: new Date().toISOString(),
    })
    if (options.sendHeartbeat === true) {
      await framed.send({
        type: 'heartbeat.ping',
        protocolVersion:
          options.postAuthenticationProtocolVersion ?? relayProtocolVersion,
        connectionEpoch,
        pingId: newRelayPingId(),
        sentAt: new Date().toISOString(),
      })
    }
    while (!framed.closed) {
      let message
      try {
        message = await framed.receive(RelayClientMessageSchema, {
          timeoutMs: null,
        })
      } catch {
        return
      }
      if (message.connectionEpoch !== connectionEpoch) return
      if (message.type === 'heartbeat.pong') {
        pongs += 1
      } else if (message.type === 'grant.replace') {
        grants.push(message.authorizedControllerFingerprint)
        await framed.send({
          type: 'grant.replaced',
          protocolVersion: relayProtocolVersion,
          connectionEpoch,
          requestId: message.requestId,
          observedAt: new Date().toISOString(),
        })
      } else if (message.type === 'peer.goodbye') {
        framed.end()
        return
      }
    }
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, resolve)
  })
  const address = server.address()
  assert.notEqual(address, null)
  assert.equal(typeof address, 'object')
  return {
    application,
    tls,
    relayId,
    peerId,
    endpoint: { host: '127.0.0.1', port: address.port },
    tlsFingerprint: certificateSpkiFingerprint(tls.certificatePem),
    get connections() {
      return connections
    },
    get pongs() {
      return pongs
    },
    grants,
    failures,
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

function clientOptions(fixture, identity, extra = {}) {
  return {
    endpoint: fixture.endpoint,
    tls: {
      mode: 'pinned_certificate',
      certificatePublicKeyFingerprint: fixture.tlsFingerprint,
    },
    expectedRelayIdentityFingerprint: fixture.application.publicKeyFingerprint,
    identity,
    clientBuildIdentity: 'git-cb2c412def81',
    ...extra,
  }
}

test('Relay client enrolls, verifies both pins, updates grant, and answers heartbeat', async (t) => {
  const identity = await peerIdentity()
  const fixture = await startRelayFixture({
    sendHeartbeat: true,
    expectedPeerPublicKeySpki: identity.publicKeySpki,
  })
  t.after(() => fixture.close())
  const controllerFingerprint = 'C'.repeat(43)
  const connected = await connectRelayControl(
    clientOptions(fixture, identity, {
      enrollmentToken,
      authorizedControllerFingerprint: controllerFingerprint,
    }),
  )
  assert.equal(connected.enrolled, true)
  assert.equal(connected.registration.relayId, fixture.relayId)
  assert.equal(connected.registration.peerId, fixture.peerId)
  await connected.connection.replaceAuthorizedController(controllerFingerprint)
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(fixture.pongs, 1)
  assert.deepEqual(fixture.grants, [controllerFingerprint])
  await connected.connection.close()
  assert.deepEqual(fixture.failures, [])
})

test('Relay client authenticates an enrolled identity without an enrollment token', async (t) => {
  const identity = await peerIdentity()
  const fixture = await startRelayFixture({
    enrolled: true,
    expectedPeerPublicKeySpki: identity.publicKeySpki,
  })
  t.after(() => fixture.close())
  const connected = await connectRelayControl(clientOptions(fixture, identity))
  assert.equal(connected.enrolled, false)
  await connected.connection.close()
})

test('Relay client fails closed on TLS and application identity mismatch', async (t) => {
  const identity = await peerIdentity()
  const fixture = await startRelayFixture({
    enrolled: true,
    expectedPeerPublicKeySpki: identity.publicKeySpki,
  })
  t.after(() => fixture.close())
  await assert.rejects(
    connectRelayControl({
      ...clientOptions(fixture, identity),
      tls: {
        mode: 'pinned_certificate',
        certificatePublicKeyFingerprint: 'Z'.repeat(43),
      },
    }),
    (error) =>
      error instanceof RelayClientError &&
      error.code === 'relay_tls_identity_mismatch',
  )
  await assert.rejects(
    connectRelayControl({
      ...clientOptions(fixture, identity),
      expectedRelayIdentityFingerprint: 'Z'.repeat(43),
    }),
    (error) =>
      error instanceof RelayClientError &&
      error.code === 'relay_identity_mismatch',
  )
})

test('Relay client classifies an incompatible challenge version before strict v1 parsing', async (t) => {
  const identity = await peerIdentity()
  const fixture = await startRelayFixture({
    challengeProtocolVersion: 2,
    expectedPeerPublicKeySpki: identity.publicKeySpki,
  })
  t.after(() => fixture.close())
  await assert.rejects(
    connectRelayControl(clientOptions(fixture, identity)),
    (error) =>
      error instanceof RelayClientError &&
      error.code === 'relay_protocol_incompatible',
  )
})

test('Relay client classifies an incompatible authentication response version', async (t) => {
  const identity = await peerIdentity()
  const fixture = await startRelayFixture({
    enrolled: true,
    readyProtocolVersion: 2,
    expectedPeerPublicKeySpki: identity.publicKeySpki,
  })
  t.after(() => fixture.close())
  await assert.rejects(
    connectRelayControl(clientOptions(fixture, identity)),
    (error) =>
      error instanceof RelayClientError &&
      error.code === 'relay_protocol_incompatible',
  )
})

test('Relay client classifies an incompatible post-authentication frame version', async (t) => {
  const identity = await peerIdentity()
  const fixture = await startRelayFixture({
    enrolled: true,
    sendHeartbeat: true,
    postAuthenticationProtocolVersion: 2,
    expectedPeerPublicKeySpki: identity.publicKeySpki,
  })
  t.after(() => fixture.close())
  const connected = await connectRelayControl(clientOptions(fixture, identity))
  await assert.rejects(
    connected.connection.waitUntilClosed(),
    (error) =>
      error instanceof RelayClientError &&
      error.code === 'relay_protocol_incompatible',
  )
})

test('Relay client supports endpoint mobility only with the same application identity', async (t) => {
  const identity = await peerIdentity()
  const application = generateRelayApplicationIdentity()
  const first = await startRelayFixture({
    enrolled: true,
    application,
    expectedPeerPublicKeySpki: identity.publicKeySpki,
  })
  const firstConnection = await connectRelayControl(
    clientOptions(first, identity),
  )
  const relayId = firstConnection.registration.relayId
  await firstConnection.connection.close()
  await first.close()

  const moved = await startRelayFixture({
    enrolled: true,
    application,
    relayId,
    expectedPeerPublicKeySpki: identity.publicKeySpki,
  })
  t.after(() => moved.close())
  const movedConnection = await connectRelayControl(
    clientOptions(moved, identity, { expectedRelayId: relayId }),
  )
  await movedConnection.connection.close()

  const replacement = await startRelayFixture({
    enrolled: true,
    expectedPeerPublicKeySpki: identity.publicKeySpki,
  })
  t.after(() => replacement.close())
  await assert.rejects(
    connectRelayControl({
      ...clientOptions(replacement, identity, { expectedRelayId: relayId }),
      expectedRelayIdentityFingerprint: application.publicKeyFingerprint,
    }),
    (error) =>
      error instanceof RelayClientError &&
      error.code === 'relay_identity_mismatch',
  )
})

test(
  '100 authenticated Relay connection lifecycles return to one bounded peer',
  {
    timeout: 60_000,
  },
  async (t) => {
    const identity = await peerIdentity()
    const fixture = await startRelayFixture({
      enrolled: true,
      expectedPeerPublicKeySpki: identity.publicKeySpki,
    })
    t.after(() => fixture.close())
    for (let index = 0; index < 100; index += 1) {
      const connected = await connectRelayControl(
        clientOptions(fixture, identity),
      )
      assert.equal(connected.registration.peerId, fixture.peerId)
      await connected.connection.close()
    }
    assert.equal(fixture.connections, 100)
    assert.deepEqual(fixture.failures, [])
  },
)

test('server error prose cannot become client-facing instructions', async (t) => {
  const identity = await peerIdentity()
  const marker = 'https://evil.invalid LOGIN WITH TOKEN secret-value'
  const fixture = await startRelayFixture({
    rawError: marker,
    expectedPeerPublicKeySpki: identity.publicKeySpki,
  })
  t.after(() => fixture.close())
  await assert.rejects(
    connectRelayControl(clientOptions(fixture, identity)),
    (error) => {
      assert.equal(error instanceof RelayClientError, true)
      assert.equal(error.code, 'relay_authentication_failed')
      assert.equal(error.message.includes(marker), false)
      return true
    },
  )
})

test('invalid enrollment token input is rejected without reflecting its value', async () => {
  const identity = await peerIdentity()
  const secret = '<script>steal-this-enrollment-token</script>'
  await assert.rejects(
    connectRelayControl({
      endpoint: { host: '127.0.0.1', port: 443 },
      tls: {
        mode: 'pinned_certificate',
        certificatePublicKeyFingerprint: 'Z'.repeat(43),
      },
      expectedRelayIdentityFingerprint: 'Z'.repeat(43),
      identity,
      clientBuildIdentity: 'git-cb2c412def81',
      enrollmentToken: secret,
    }),
    (error) => {
      assert.equal(error instanceof RelayClientError, true)
      assert.equal(error.code, 'relay_enrollment_required')
      assert.equal(error.message.includes(secret), false)
      return true
    },
  )
})

test('negotiated heartbeat timeout bounds an otherwise silent control connection', async (t) => {
  const identity = await peerIdentity()
  const fixture = await startRelayFixture({
    enrolled: true,
    heartbeatIntervalMs: 10,
    heartbeatTimeoutMs: 30,
    expectedPeerPublicKeySpki: identity.publicKeySpki,
  })
  t.after(() => fixture.close())
  const connected = await connectRelayControl(clientOptions(fixture, identity))
  await assert.rejects(
    connected.connection.waitUntilClosed(),
    (error) =>
      error instanceof RelayClientError && error.code === 'relay_unreachable',
  )
})

test('Relay client interoperates with the production Relay service across presence reconnect', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'codetether-relay-client-service-'))
  const store = new RelayStateStore(join(root, 'state'))
  const tls = await generateRelayPinnedTlsIdentity(store.identity)
  const service = new RelayService({
    stateStore: store,
    tls,
    host: '127.0.0.1',
    port: 0,
    managementPort: null,
    heartbeatIntervalMs: 100,
    heartbeatTimeoutMs: 300,
    logger: { log() {} },
  })
  await service.start()
  t.after(async () => {
    await service.close()
    await rm(root, { recursive: true, force: true })
  })

  const endpoint = {
    host: '127.0.0.1',
    port: service.listeningAddress.port,
  }
  const common = {
    endpoint,
    tls: {
      mode: 'pinned_certificate',
      certificatePublicKeyFingerprint: service.relayFingerprint,
    },
    expectedRelayIdentityFingerprint: service.relayFingerprint,
    clientBuildIdentity: 'relay-client-service-smoke',
  }
  const controllerIdentity = generateRelayApplicationIdentity()
  const nodeIdentity = generateRelayApplicationIdentity()
  const nodeToken = store.createEnrollmentToken('node')
  const controllerToken = store.createEnrollmentToken('controller')
  const node = await connectRelayControl({
    ...common,
    identity: { role: 'node', ...nodeIdentity },
    enrollmentToken: nodeToken,
    authorizedControllerFingerprint: controllerIdentity.publicKeyFingerprint,
  })
  const controller = await connectRelayControl({
    ...common,
    identity: { role: 'controller', ...controllerIdentity },
    enrollmentToken: controllerToken,
  })
  t.after(async () => {
    await controller.connection.close()
    await node.connection.close()
  })

  const observations = createPresenceObserver()
  const firstObservation = observations.waitFor('online')
  const subscription = await controller.connection.subscribeToNode(
    nodeIdentity.publicKeyFingerprint,
    observations.listener,
  )
  t.after(subscription)
  assert.equal((await firstObservation).state, 'online')
  await assert.rejects(
    controller.connection.subscribeToNode(
      nodeIdentity.publicKeyFingerprint,
      observations.listener,
    ),
    (error) =>
      error instanceof RelayClientError &&
      error.code === 'relay_protocol_error',
  )

  const offline = observations.waitFor('offline')
  await node.connection.close()
  assert.equal((await offline).state, 'offline')

  const online = observations.waitFor('online')
  const reconnectedNode = await connectRelayControl({
    ...common,
    identity: { role: 'node', ...nodeIdentity },
  })
  t.after(async () => reconnectedNode.connection.close())
  assert.equal(reconnectedNode.registration.peerId, node.registration.peerId)
  assert.notEqual(
    reconnectedNode.connection.connectionEpoch,
    node.connection.connectionEpoch,
  )
  assert.equal((await online).state, 'online')
})

function certificateSpkiFingerprint(certificatePem) {
  const certificate = new X509Certificate(certificatePem)
  return createHash('sha256')
    .update(certificate.publicKey.export({ type: 'spki', format: 'der' }))
    .digest('base64url')
}

function createPresenceObserver() {
  const pending = new Map()
  return {
    listener(observation) {
      const waiter = pending.get(observation.state)
      if (waiter === undefined) return
      pending.delete(observation.state)
      clearTimeout(waiter.timer)
      waiter.resolve(observation)
    },
    waitFor(state) {
      assert.equal(pending.has(state), false)
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(state)
          reject(new Error(`Timed out waiting for Relay presence ${state}`))
        }, 2_000)
        pending.set(state, { resolve, timer })
      })
    },
  }
}

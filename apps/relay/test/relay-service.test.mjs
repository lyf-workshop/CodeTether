import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { X509Certificate, createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect as connectTls } from 'node:tls'
import test from 'node:test'

import {
  FramedRelayConnection,
  RelayChallengeMessageSchema,
  RelayServerMessageSchema,
  fingerprintRelayPublicKeySpki,
  generateRelayApplicationIdentity,
  newRelayRequestId,
  relayAuthenticationTranscript,
  relayChallengeTranscript,
  relayEnrollmentTranscript,
  relayProtocolAlpn,
  relayProtocolLimits,
  relayProtocolVersion,
  signRelayTranscript,
  verifyRelayTranscript,
} from '@codetether/relay-protocol'

import {
  RelayService,
  RelayStateStore,
  generateRelayPinnedTlsIdentity,
} from '../dist/index.js'

const silentLogger = { log() {} }
const relayProcessFixture = fileURLToPath(
  new URL('./fixtures/relay-process.mjs', import.meta.url),
)

async function withService(run, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'codetether-relay-service-'))
  const store = new RelayStateStore(join(root, 'state'))
  const tls = await generateRelayPinnedTlsIdentity(store.identity)
  const service = new RelayService({
    stateStore: store,
    tls,
    host: '127.0.0.1',
    port: 0,
    managementHost: '127.0.0.1',
    managementPort: 0,
    heartbeatIntervalMs: 500,
    heartbeatTimeoutMs: 1_500,
    logger: silentLogger,
    ...overrides,
  })
  try {
    await service.start()
    await run({ root, store, service, tls })
  } finally {
    await service.close()
    await rm(root, { recursive: true, force: true })
  }
}

async function openChallenge(service, tlsFingerprint) {
  const port = service.listeningAddress.port
  const socket = connectTls({
    host: '127.0.0.1',
    port,
    rejectUnauthorized: false,
    ALPNProtocols: [relayProtocolAlpn],
  })
  await new Promise((resolve, reject) => {
    socket.once('secureConnect', resolve)
    socket.once('error', reject)
  })
  assert.equal(socket.alpnProtocol, relayProtocolAlpn)
  const certificate = new X509Certificate(socket.getPeerCertificate(true).raw)
  const observedTlsFingerprint = createHash('sha256')
    .update(certificate.publicKey.export({ type: 'spki', format: 'der' }))
    .digest('base64url')
  assert.equal(observedTlsFingerprint, tlsFingerprint)
  const channel = new FramedRelayConnection(socket)
  const challenge = await channel.receive(RelayChallengeMessageSchema, {
    timeoutMs: 2_000,
  })
  assert.equal(challenge.relayFingerprint, service.relayFingerprint)
  assert.equal(
    fingerprintRelayPublicKeySpki(challenge.relayPublicKeySpki),
    challenge.relayFingerprint,
  )
  const { signature, ...unsigned } = challenge
  assert.equal(
    verifyRelayTranscript(
      challenge.relayPublicKeySpki,
      relayChallengeTranscript(unsigned),
      signature,
    ),
    true,
  )
  return { channel, challenge, socket }
}

async function enrollPeer(
  service,
  tlsFingerprint,
  token,
  role,
  identity,
  authorizedControllerFingerprint,
) {
  const opened = await openChallenge(service, tlsFingerprint)
  const unsigned = {
    type: 'peer.enroll',
    protocolVersion: relayProtocolVersion,
    role,
    enrollmentToken: token,
    peerPublicKeySpki: identity.publicKeySpki,
    peerFingerprint: identity.publicKeyFingerprint,
    clientBuildIdentity: 'test-build',
    ...(role === 'node' && authorizedControllerFingerprint !== undefined
      ? { authorizedControllerFingerprint }
      : {}),
  }
  await opened.channel.send({
    ...unsigned,
    signature: signRelayTranscript(
      identity.privateKeyPem,
      relayEnrollmentTranscript({
        challenge: opened.challenge,
        role,
        enrollmentToken: token,
        peerPublicKeySpki: identity.publicKeySpki,
        peerFingerprint: identity.publicKeyFingerprint,
        clientBuildIdentity: 'test-build',
        ...(authorizedControllerFingerprint === undefined
          ? {}
          : { authorizedControllerFingerprint }),
      }),
    ),
  })
  const ready = await receiveType(opened.channel, 'peer.ready')
  return { ...opened, ready, identity }
}

async function authenticatePeer(service, tlsFingerprint, role, identity) {
  const opened = await openChallenge(service, tlsFingerprint)
  await opened.channel.send({
    type: 'peer.authenticate',
    protocolVersion: relayProtocolVersion,
    peerFingerprint: identity.publicKeyFingerprint,
    role,
    clientBuildIdentity: 'test-build',
    signature: signRelayTranscript(
      identity.privateKeyPem,
      relayAuthenticationTranscript({
        challenge: opened.challenge,
        peerFingerprint: identity.publicKeyFingerprint,
        role,
        clientBuildIdentity: 'test-build',
      }),
    ),
  })
  const ready = await receiveType(opened.channel, 'peer.ready')
  return { ...opened, ready, identity }
}

async function submitAuthentication(
  service,
  tlsFingerprint,
  role,
  claimedIdentity,
  signingIdentity = claimedIdentity,
) {
  const opened = await openChallenge(service, tlsFingerprint)
  const transcript = {
    challenge: opened.challenge,
    peerFingerprint: claimedIdentity.publicKeyFingerprint,
    role,
    clientBuildIdentity: 'test-build',
  }
  await opened.channel.send({
    type: 'peer.authenticate',
    protocolVersion: relayProtocolVersion,
    peerFingerprint: claimedIdentity.publicKeyFingerprint,
    role,
    clientBuildIdentity: 'test-build',
    signature: signRelayTranscript(
      signingIdentity.privateKeyPem,
      relayAuthenticationTranscript(transcript),
    ),
  })
  return opened
}

async function receiveType(channel, expectedType, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const message = await channel.receive(RelayServerMessageSchema, {
      timeoutMs: Math.max(1, deadline - Date.now()),
    })
    if (message.type === 'heartbeat.ping') {
      await channel.send({
        type: 'heartbeat.pong',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: message.connectionEpoch,
        pingId: message.pingId,
      })
      continue
    }
    assert.equal(message.type, expectedType)
    return message
  }
  throw new Error(`Timed out waiting for ${expectedType}`)
}

async function closePeer(peer) {
  if (peer.channel.closed) return
  await peer.channel
    .send({
      type: 'peer.goodbye',
      protocolVersion: relayProtocolVersion,
      connectionEpoch: peer.ready.connectionEpoch,
    })
    .catch(() => undefined)
  peer.channel.end()
}

async function waitUntil(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail('Condition did not become true before timeout')
}

async function startRelayProcess(stateDirectory) {
  const child = spawn(process.execPath, [relayProcessFixture, stateDirectory], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-2_048)
  })
  const metadata = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Relay process fixture start timed out')),
      5_000,
    )
    const fail = (message) => {
      clearTimeout(timer)
      reject(new Error(`${message}${stderr === '' ? '' : `: ${stderr}`}`))
    }
    child.once('error', (error) => fail(error.message))
    child.once('exit', (code, signal) => {
      fail(`Relay process fixture exited before ready (${code ?? signal})`)
    })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout = `${stdout}${chunk}`
      const newline = stdout.indexOf('\n')
      if (newline < 0) return
      clearTimeout(timer)
      try {
        resolve(JSON.parse(stdout.slice(0, newline)))
      } catch {
        reject(new Error('Relay process fixture returned invalid metadata'))
      }
    })
  })
  return { child, ...metadata }
}

async function stopRelayProcess(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  assert.equal(child.kill(signal), true)
  await exited
}

test('pinned TLS, enrollment, reconnect, authorization and presence stay separate from Machine trust', async () => {
  await withService(async ({ store, service, tls }) => {
    assert.equal(tls.publicKeySpkiFingerprint, service.relayFingerprint)
    const controllerIdentity = generateRelayApplicationIdentity()
    const nodeIdentity = generateRelayApplicationIdentity()
    const controller = await enrollPeer(
      service,
      tls.publicKeySpkiFingerprint,
      store.createEnrollmentToken('controller'),
      'controller',
      controllerIdentity,
    )
    let node = await enrollPeer(
      service,
      tls.publicKeySpkiFingerprint,
      store.createEnrollmentToken('node'),
      'node',
      nodeIdentity,
      controllerIdentity.publicKeyFingerprint,
    )
    const requestId = newRelayRequestId()
    await controller.channel.send({
      type: 'rendezvous.subscribe',
      protocolVersion: relayProtocolVersion,
      connectionEpoch: controller.ready.connectionEpoch,
      requestId,
      targetNodeFingerprint: nodeIdentity.publicKeyFingerprint,
    })
    const online = await receiveType(controller.channel, 'rendezvous.status')
    assert.equal(online.state, 'online')
    assert.equal(
      online.targetNodeFingerprint,
      nodeIdentity.publicKeyFingerprint,
    )

    await closePeer(node)
    const offline = await receiveType(controller.channel, 'rendezvous.status')
    assert.equal(offline.state, 'offline')

    node = await authenticatePeer(
      service,
      tls.publicKeySpkiFingerprint,
      'node',
      nodeIdentity,
    )
    const restored = await receiveType(controller.channel, 'rendezvous.status')
    assert.equal(restored.state, 'online')
    assert.equal(
      node.ready.peerId,
      store.getPeerByFingerprint(nodeIdentity.publicKeyFingerprint).peerId,
    )

    const health = await fetch(
      `http://127.0.0.1:${service.managementAddress.port}/healthz`,
    )
    assert.equal(health.status, 200)
    assert.deepEqual(await health.json(), { status: 'ok' })
    const metrics = await fetch(
      `http://127.0.0.1:${service.managementAddress.port}/metrics`,
    ).then((response) => response.json())
    assert.equal(metrics.authenticatedControllers, 1)
    assert.equal(metrics.authenticatedNodes, 1)
    assert.equal('peers' in metrics, false)

    await closePeer(node)
    await closePeer(controller)
  })
})

test('challenge and enrollment-token replay fail while fingerprint reconnect remains available', async () => {
  await withService(async ({ store, service, tls }) => {
    const identity = generateRelayApplicationIdentity()
    const token = store.createEnrollmentToken('controller')
    const enrolled = await enrollPeer(
      service,
      tls.publicKeySpkiFingerprint,
      token,
      'controller',
      identity,
    )
    const firstChallenge = enrolled.challenge
    await closePeer(enrolled)

    const tokenReplay = await openChallenge(
      service,
      tls.publicKeySpkiFingerprint,
    )
    const replayEnrollInput = {
      challenge: tokenReplay.challenge,
      role: 'controller',
      enrollmentToken: token,
      peerPublicKeySpki: identity.publicKeySpki,
      peerFingerprint: identity.publicKeyFingerprint,
      clientBuildIdentity: 'test-build',
    }
    await tokenReplay.channel.send({
      type: 'peer.enroll',
      protocolVersion: relayProtocolVersion,
      role: 'controller',
      enrollmentToken: token,
      peerPublicKeySpki: identity.publicKeySpki,
      peerFingerprint: identity.publicKeyFingerprint,
      clientBuildIdentity: 'test-build',
      signature: signRelayTranscript(
        identity.privateKeyPem,
        relayEnrollmentTranscript(replayEnrollInput),
      ),
    })
    const tokenError = await receiveType(tokenReplay.channel, 'relay.error')
    assert.equal(tokenError.code, 'enrollment_consumed')

    const challengeReplay = await openChallenge(
      service,
      tls.publicKeySpkiFingerprint,
    )
    await challengeReplay.channel.send({
      type: 'peer.authenticate',
      protocolVersion: relayProtocolVersion,
      peerFingerprint: identity.publicKeyFingerprint,
      role: 'controller',
      clientBuildIdentity: 'test-build',
      signature: signRelayTranscript(
        identity.privateKeyPem,
        relayAuthenticationTranscript({
          challenge: firstChallenge,
          peerFingerprint: identity.publicKeyFingerprint,
          role: 'controller',
          clientBuildIdentity: 'test-build',
        }),
      ),
    })
    const challengeError = await receiveType(
      challengeReplay.channel,
      'relay.error',
    )
    assert.equal(challengeError.code, 'authentication_failed')

    const recovered = await authenticatePeer(
      service,
      tls.publicKeySpkiFingerprint,
      'controller',
      identity,
    )
    assert.equal(recovered.ready.peerId, enrolled.ready.peerId)
    await closePeer(recovered)
  })
})

test('wrong signatures, role mutation, and unknown identities are indistinguishable authentication failures', async () => {
  await withService(async ({ store, service, tls }) => {
    const identity = generateRelayApplicationIdentity()
    const attacker = generateRelayApplicationIdentity()
    const unknown = generateRelayApplicationIdentity()
    const enrolled = await enrollPeer(
      service,
      tls.publicKeySpkiFingerprint,
      store.createEnrollmentToken('controller'),
      'controller',
      identity,
    )
    await closePeer(enrolled)

    const cases = [
      { role: 'controller', claimed: identity, signer: attacker },
      { role: 'node', claimed: identity, signer: identity },
      { role: 'controller', claimed: unknown, signer: unknown },
    ]
    const failures = []
    for (const authCase of cases) {
      const attempt = await submitAuthentication(
        service,
        tls.publicKeySpkiFingerprint,
        authCase.role,
        authCase.claimed,
        authCase.signer,
      )
      const failure = await receiveType(attempt.channel, 'relay.error')
      failures.push({ code: failure.code, message: failure.message })
    }
    assert.deepEqual(failures, [
      {
        code: 'authentication_failed',
        message: 'Relay authentication failed',
      },
      {
        code: 'authentication_failed',
        message: 'Relay authentication failed',
      },
      {
        code: 'authentication_failed',
        message: 'Relay authentication failed',
      },
    ])
    assert.equal(service.metrics().authenticationFailures, 3)
  })
})

test('expired connection challenges fail before consuming enrollment state', async () => {
  await withService(
    async ({ store, service, tls }) => {
      const identity = generateRelayApplicationIdentity()
      const token = store.createEnrollmentToken('controller')
      const opened = await openChallenge(service, tls.publicKeySpkiFingerprint)
      await new Promise((resolve) => setTimeout(resolve, 30))
      const transcript = {
        challenge: opened.challenge,
        role: 'controller',
        enrollmentToken: token,
        peerPublicKeySpki: identity.publicKeySpki,
        peerFingerprint: identity.publicKeyFingerprint,
        clientBuildIdentity: 'test-build',
      }
      await opened.channel.send({
        type: 'peer.enroll',
        protocolVersion: relayProtocolVersion,
        role: 'controller',
        enrollmentToken: token,
        peerPublicKeySpki: identity.publicKeySpki,
        peerFingerprint: identity.publicKeyFingerprint,
        clientBuildIdentity: 'test-build',
        signature: signRelayTranscript(
          identity.privateKeyPem,
          relayEnrollmentTranscript(transcript),
        ),
      })
      const failure = await receiveType(opened.channel, 'relay.error')
      assert.equal(failure.code, 'authentication_failed')
      assert.equal(store.counts().enrolledControllers, 0)
      assert.equal(store.counts().unconsumedTokens, 1)
    },
    { challengeLifetimeMs: 10 },
  )
})

test('latest authenticated connection owns the epoch and stale frames fail closed', async () => {
  await withService(async ({ store, service, tls }) => {
    const identity = generateRelayApplicationIdentity()
    const first = await enrollPeer(
      service,
      tls.publicKeySpkiFingerprint,
      store.createEnrollmentToken('controller'),
      'controller',
      identity,
    )
    const second = await authenticatePeer(
      service,
      tls.publicKeySpkiFingerprint,
      'controller',
      identity,
    )
    assert.notEqual(first.ready.connectionEpoch, second.ready.connectionEpoch)
    await waitUntil(() => first.channel.closed)
    assert.equal(service.metrics().authenticatedControllers, 1)
    assert.equal(service.metrics().reconnectReplacements, 1)

    await second.channel.send({
      type: 'rendezvous.subscribe',
      protocolVersion: relayProtocolVersion,
      connectionEpoch: first.ready.connectionEpoch,
      requestId: newRelayRequestId(),
      targetNodeFingerprint:
        generateRelayApplicationIdentity().publicKeyFingerprint,
    })
    const error = await receiveType(second.channel, 'relay.error')
    assert.equal(error.code, 'stale_connection')
  })
})

test('rendezvous grants are exact, revocable, and reveal no peer membership to unauthorized controllers', async () => {
  await withService(async ({ store, service, tls }) => {
    const authorizedIdentity = generateRelayApplicationIdentity()
    const unauthorizedIdentity = generateRelayApplicationIdentity()
    const nodeIdentity = generateRelayApplicationIdentity()
    const authorized = await enrollPeer(
      service,
      tls.publicKeySpkiFingerprint,
      store.createEnrollmentToken('controller'),
      'controller',
      authorizedIdentity,
    )
    let unauthorized = await enrollPeer(
      service,
      tls.publicKeySpkiFingerprint,
      store.createEnrollmentToken('controller'),
      'controller',
      unauthorizedIdentity,
    )
    const node = await enrollPeer(
      service,
      tls.publicKeySpkiFingerprint,
      store.createEnrollmentToken('node'),
      'node',
      nodeIdentity,
      authorizedIdentity.publicKeyFingerprint,
    )

    await unauthorized.channel.send({
      type: 'rendezvous.subscribe',
      protocolVersion: relayProtocolVersion,
      connectionEpoch: unauthorized.ready.connectionEpoch,
      requestId: newRelayRequestId(),
      targetNodeFingerprint: nodeIdentity.publicKeyFingerprint,
    })
    const enrolledTargetFailure = await receiveType(
      unauthorized.channel,
      'relay.error',
    )
    await waitUntil(() => unauthorized.channel.closed)

    unauthorized = await authenticatePeer(
      service,
      tls.publicKeySpkiFingerprint,
      'controller',
      unauthorizedIdentity,
    )
    await unauthorized.channel.send({
      type: 'rendezvous.subscribe',
      protocolVersion: relayProtocolVersion,
      connectionEpoch: unauthorized.ready.connectionEpoch,
      requestId: newRelayRequestId(),
      targetNodeFingerprint:
        generateRelayApplicationIdentity().publicKeyFingerprint,
    })
    const unknownTargetFailure = await receiveType(
      unauthorized.channel,
      'relay.error',
    )
    assert.deepEqual(
      {
        code: unknownTargetFailure.code,
        message: unknownTargetFailure.message,
      },
      {
        code: enrolledTargetFailure.code,
        message: enrolledTargetFailure.message,
      },
    )
    assert.equal(unknownTargetFailure.code, 'not_authorized')

    const requestId = newRelayRequestId()
    await authorized.channel.send({
      type: 'rendezvous.subscribe',
      protocolVersion: relayProtocolVersion,
      connectionEpoch: authorized.ready.connectionEpoch,
      requestId,
      targetNodeFingerprint: nodeIdentity.publicKeyFingerprint,
    })
    assert.equal(
      (await receiveType(authorized.channel, 'rendezvous.status')).state,
      'online',
    )
    await node.channel.send({
      type: 'grant.replace',
      protocolVersion: relayProtocolVersion,
      connectionEpoch: node.ready.connectionEpoch,
      requestId: newRelayRequestId(),
    })
    await receiveType(node.channel, 'grant.replaced')
    const revokedGrant = await receiveType(
      authorized.channel,
      'rendezvous.status',
    )
    assert.equal(revokedGrant.requestId, requestId)
    assert.equal(revokedGrant.state, 'unavailable')

    await closePeer(node)
    await closePeer(authorized)
  })
})

test('two reciprocal Controller and Node pairs remain identity-isolated without cross-peer presence or a directory', async () => {
  await withService(
    async ({ store, service, tls }) => {
      const controllerAIdentity = generateRelayApplicationIdentity()
      const controllerBIdentity = generateRelayApplicationIdentity()
      const nodeAIdentity = generateRelayApplicationIdentity()
      const nodeBIdentity = generateRelayApplicationIdentity()
      const controllerA = await enrollPeer(
        service,
        tls.publicKeySpkiFingerprint,
        store.createEnrollmentToken('controller'),
        'controller',
        controllerAIdentity,
      )
      const controllerB = await enrollPeer(
        service,
        tls.publicKeySpkiFingerprint,
        store.createEnrollmentToken('controller'),
        'controller',
        controllerBIdentity,
      )
      const nodeA = await enrollPeer(
        service,
        tls.publicKeySpkiFingerprint,
        store.createEnrollmentToken('node'),
        'node',
        nodeAIdentity,
        controllerAIdentity.publicKeyFingerprint,
      )
      let nodeB = await enrollPeer(
        service,
        tls.publicKeySpkiFingerprint,
        store.createEnrollmentToken('node'),
        'node',
        nodeBIdentity,
        controllerBIdentity.publicKeyFingerprint,
      )

      assert.equal(
        new Set([
          controllerA.ready.peerId,
          controllerB.ready.peerId,
          nodeA.ready.peerId,
          nodeB.ready.peerId,
        ]).size,
        4,
      )
      assert.deepEqual(store.counts(), {
        enrolledControllers: 2,
        enrolledNodes: 2,
        revokedPeers: 0,
        unconsumedTokens: 0,
      })

      const requestA = newRelayRequestId()
      await controllerA.channel.send({
        type: 'rendezvous.subscribe',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: controllerA.ready.connectionEpoch,
        requestId: requestA,
        targetNodeFingerprint: nodeAIdentity.publicKeyFingerprint,
      })
      const initialA = await receiveType(
        controllerA.channel,
        'rendezvous.status',
      )
      assert.equal(initialA.requestId, requestA)
      assert.equal(initialA.state, 'online')

      const requestB = newRelayRequestId()
      await controllerB.channel.send({
        type: 'rendezvous.subscribe',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: controllerB.ready.connectionEpoch,
        requestId: requestB,
        targetNodeFingerprint: nodeBIdentity.publicKeyFingerprint,
      })
      const initialB = await receiveType(
        controllerB.channel,
        'rendezvous.status',
      )
      assert.equal(initialB.requestId, requestB)
      assert.equal(initialB.state, 'online')

      await closePeer(nodeB)
      const offlineB = await receiveType(
        controllerB.channel,
        'rendezvous.status',
      )
      assert.equal(offlineB.requestId, requestB)
      assert.equal(offlineB.state, 'offline')
      await assert.rejects(
        controllerA.channel.receive(RelayServerMessageSchema, {
          timeoutMs: 100,
        }),
        (error) => error?.code === 'timeout',
      )

      nodeB = await authenticatePeer(
        service,
        tls.publicKeySpkiFingerprint,
        'node',
        nodeBIdentity,
      )
      const onlineB = await receiveType(
        controllerB.channel,
        'rendezvous.status',
      )
      assert.equal(onlineB.requestId, requestB)
      assert.equal(onlineB.state, 'online')

      await controllerA.channel.send({
        type: 'rendezvous.subscribe',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: controllerA.ready.connectionEpoch,
        requestId: newRelayRequestId(),
        targetNodeFingerprint: nodeBIdentity.publicKeyFingerprint,
      })
      const crossFailureA = await receiveType(
        controllerA.channel,
        'relay.error',
      )
      assert.equal(crossFailureA.code, 'not_authorized')

      await controllerB.channel.send({
        type: 'rendezvous.subscribe',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: controllerB.ready.connectionEpoch,
        requestId: newRelayRequestId(),
        targetNodeFingerprint: nodeAIdentity.publicKeyFingerprint,
      })
      const crossFailureB = await receiveType(
        controllerB.channel,
        'relay.error',
      )
      assert.deepEqual(
        {
          code: crossFailureB.code,
          message: crossFailureB.message,
        },
        {
          code: crossFailureA.code,
          message: crossFailureA.message,
        },
      )

      const directoryAttempt = await authenticatePeer(
        service,
        tls.publicKeySpkiFingerprint,
        'controller',
        controllerAIdentity,
      )
      await directoryAttempt.channel.send({
        type: 'peer.list',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: directoryAttempt.ready.connectionEpoch,
      })
      const directoryFailure = await receiveType(
        directoryAttempt.channel,
        'relay.error',
      )
      assert.equal(directoryFailure.code, 'malformed_message')

      const metrics = await fetch(
        `http://127.0.0.1:${service.managementAddress.port}/metrics`,
      ).then((response) => response.json())
      assert.equal('peers' in metrics, false)
      assert.equal('peerIds' in metrics, false)
      assert.equal('fingerprints' in metrics, false)

      await closePeer(directoryAttempt)
      await closePeer(nodeB)
      await closePeer(nodeA)
      await closePeer(controllerB)
      await closePeer(controllerA)
    },
    { heartbeatIntervalMs: 10_000, heartbeatTimeoutMs: 20_000 },
  )
})

test('revocation denies signed reconnect until the exact peer explicitly re-enrolls with a fresh token', async () => {
  await withService(async ({ store, service, tls }) => {
    const identity = generateRelayApplicationIdentity()
    const peer = await enrollPeer(
      service,
      tls.publicKeySpkiFingerprint,
      store.createEnrollmentToken('node'),
      'node',
      identity,
    )
    assert.equal(service.revokePeer(peer.ready.peerId), true)
    await waitUntil(() => peer.channel.closed)

    const opened = await openChallenge(service, tls.publicKeySpkiFingerprint)
    await opened.channel.send({
      type: 'peer.authenticate',
      protocolVersion: relayProtocolVersion,
      peerFingerprint: identity.publicKeyFingerprint,
      role: 'node',
      clientBuildIdentity: 'test-build',
      signature: signRelayTranscript(
        identity.privateKeyPem,
        relayAuthenticationTranscript({
          challenge: opened.challenge,
          peerFingerprint: identity.publicKeyFingerprint,
          role: 'node',
          clientBuildIdentity: 'test-build',
        }),
      ),
    })
    const error = await receiveType(opened.channel, 'relay.error')
    assert.equal(error.code, 'revoked')

    const reenrolled = await enrollPeer(
      service,
      tls.publicKeySpkiFingerprint,
      store.createEnrollmentToken('node'),
      'node',
      identity,
    )
    assert.equal(reenrolled.ready.peerId, peer.ready.peerId)
    assert.equal(store.getPeerById(peer.ready.peerId)?.revokedAt, undefined)
    await closePeer(reenrolled)

    const reconnected = await authenticatePeer(
      service,
      tls.publicKeySpkiFingerprint,
      'node',
      identity,
    )
    assert.equal(reconnected.ready.peerId, peer.ready.peerId)
    await closePeer(reconnected)
  })
})

test('100 authenticated connection lifecycles return the registry to bounded idle state', async () => {
  await withService(async ({ store, service, tls }) => {
    const identity = generateRelayApplicationIdentity()
    const enrolled = await enrollPeer(
      service,
      tls.publicKeySpkiFingerprint,
      store.createEnrollmentToken('controller'),
      'controller',
      identity,
    )
    await closePeer(enrolled)
    await waitUntil(() => service.metrics().authenticatedConnections === 0)

    for (let index = 0; index < 100; index += 1) {
      const peer = await authenticatePeer(
        service,
        tls.publicKeySpkiFingerprint,
        'controller',
        identity,
      )
      await closePeer(peer)
      await waitUntil(() => service.metrics().authenticatedConnections === 0)
    }
    assert.equal(service.metrics().connectionRegistryEntries, 0)
    assert.equal(service.metrics().authenticatedConnections, 0)
    assert.equal(service.metrics().activeTlsConnections <= 1, true)
  })
})

test('authenticated idle connections outlive the TLS handshake deadline', async () => {
  await withService(
    async ({ store, service, tls }) => {
      const peer = await enrollPeer(
        service,
        tls.publicKeySpkiFingerprint,
        store.createEnrollmentToken('controller'),
        'controller',
        generateRelayApplicationIdentity(),
      )
      await new Promise((resolve) => setTimeout(resolve, 70))
      assert.equal(peer.channel.closed, false)
      assert.equal(service.metrics().authenticatedConnections, 1)
      await closePeer(peer)
    },
    {
      handshakeTimeoutMs: 40,
      heartbeatIntervalMs: 100,
      heartbeatTimeoutMs: 300,
    },
  )
})

test('missed heartbeat closes an authenticated peer without persistent registry growth', async () => {
  await withService(
    async ({ store, service, tls }) => {
      const identity = generateRelayApplicationIdentity()
      const peer = await enrollPeer(
        service,
        tls.publicKeySpkiFingerprint,
        store.createEnrollmentToken('controller'),
        'controller',
        identity,
      )
      await waitUntil(() => peer.channel.closed, 1_000)
      await waitUntil(() => service.metrics().authenticatedConnections === 0)
      assert.equal(service.metrics().heartbeatTimeouts, 1)
      const recovered = await authenticatePeer(
        service,
        tls.publicKeySpkiFingerprint,
        'controller',
        identity,
      )
      assert.equal(recovered.ready.peerId, peer.ready.peerId)
      await closePeer(recovered)
    },
    { heartbeatIntervalMs: 20, heartbeatTimeoutMs: 70 },
  )
})

test('delayed and duplicate heartbeat acknowledgements remain bounded and do not replace connection ownership', async () => {
  await withService(
    async ({ store, service, tls }) => {
      const peer = await enrollPeer(
        service,
        tls.publicKeySpkiFingerprint,
        store.createEnrollmentToken('controller'),
        'controller',
        generateRelayApplicationIdentity(),
      )
      const firstPing = await peer.channel.receive(RelayServerMessageSchema, {
        timeoutMs: 500,
      })
      assert.equal(firstPing.type, 'heartbeat.ping')
      await new Promise((resolve) => setTimeout(resolve, 35))
      const firstPong = {
        type: 'heartbeat.pong',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: peer.ready.connectionEpoch,
        pingId: firstPing.pingId,
      }
      await peer.channel.send(firstPong)
      await peer.channel.send(firstPong)

      let nextPing
      while (nextPing === undefined) {
        const message = await peer.channel.receive(RelayServerMessageSchema, {
          timeoutMs: 500,
        })
        if (message.type === 'heartbeat.ping') nextPing = message
      }
      await peer.channel.send({
        type: 'heartbeat.pong',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: peer.ready.connectionEpoch,
        pingId: nextPing.pingId,
      })
      assert.equal(service.metrics().authenticatedConnections, 1)
      assert.equal(service.metrics().connectionRegistryEntries, 1)
      assert.equal(service.metrics().reconnectReplacements, 0)
      await closePeer(peer)
    },
    { heartbeatIntervalMs: 20, heartbeatTimeoutMs: 150 },
  )
})

test('protocol mismatch and unknown messages fail with controlled codes', async () => {
  await withService(async ({ store, service, tls }) => {
    const incompatible = await openChallenge(
      service,
      tls.publicKeySpkiFingerprint,
    )
    await incompatible.channel.send({
      type: 'peer.authenticate',
      protocolVersion: 999,
    })
    const versionError = await receiveType(incompatible.channel, 'relay.error')
    assert.equal(versionError.code, 'protocol_incompatible')
    assert.equal(versionError.message.includes('999'), false)

    const unknown = await openChallenge(service, tls.publicKeySpkiFingerprint)
    await unknown.channel.send({
      type: 'execute',
      protocolVersion: relayProtocolVersion,
      prompt: '<script>steal()</script>',
    })
    const unknownError = await receiveType(unknown.channel, 'relay.error')
    assert.equal(unknownError.code, 'malformed_message')
    assert.equal(unknownError.message.includes('script'), false)

    const authenticated = await enrollPeer(
      service,
      tls.publicKeySpkiFingerprint,
      store.createEnrollmentToken('controller'),
      'controller',
      generateRelayApplicationIdentity(),
    )
    await authenticated.channel.send({
      type: 'execute',
      protocolVersion: relayProtocolVersion,
      prompt: 'must never reach a Provider',
    })
    const postAuthenticationError = await receiveType(
      authenticated.channel,
      'relay.error',
    )
    assert.equal(postAuthenticationError.code, 'malformed_message')
    assert.equal(postAuthenticationError.message.includes('Provider'), false)
    await waitUntil(() => authenticated.channel.closed)
    assert.equal(service.metrics().authenticatedConnections, 0)
  })
})

test('oversized and malformed wire frames fail closed at the service boundary', async () => {
  await withService(async ({ service, tls }) => {
    const oversized = await openChallenge(service, tls.publicKeySpkiFingerprint)
    const oversizedHeader = Buffer.alloc(4)
    oversizedHeader.writeUInt32BE(relayProtocolLimits.maximumFrameBytes + 1)
    oversized.socket.write(oversizedHeader)
    await waitUntil(() => oversized.channel.closed)
    await waitUntil(() => service.metrics().malformedFrames === 1)

    const malformed = await openChallenge(service, tls.publicKeySpkiFingerprint)
    const invalidJson = Buffer.from('{"type":', 'utf8')
    const invalidFrame = Buffer.alloc(4 + invalidJson.length)
    invalidFrame.writeUInt32BE(invalidJson.length, 0)
    invalidJson.copy(invalidFrame, 4)
    malformed.socket.write(invalidFrame)
    await waitUntil(() => malformed.channel.closed)
    await waitUntil(() => service.metrics().malformedFrames === 2)
    assert.equal(service.metrics().authenticatedConnections, 0)
    assert.equal(service.metrics().connectionRegistryEntries, 0)
  })
})

test('enrollment abuse reaches a bounded service-side rate limit', async () => {
  await withService(async ({ service, tls }) => {
    const identity = generateRelayApplicationIdentity()
    const invalidToken = `relay_enroll_${'A'.repeat(43)}`
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const opened = await openChallenge(service, tls.publicKeySpkiFingerprint)
      const transcript = {
        challenge: opened.challenge,
        role: 'controller',
        enrollmentToken: invalidToken,
        peerPublicKeySpki: identity.publicKeySpki,
        peerFingerprint: identity.publicKeyFingerprint,
        clientBuildIdentity: 'test-build',
      }
      await opened.channel.send({
        type: 'peer.enroll',
        protocolVersion: relayProtocolVersion,
        role: 'controller',
        enrollmentToken: invalidToken,
        peerPublicKeySpki: identity.publicKeySpki,
        peerFingerprint: identity.publicKeyFingerprint,
        clientBuildIdentity: 'test-build',
        signature: signRelayTranscript(
          identity.privateKeyPem,
          relayEnrollmentTranscript(transcript),
        ),
      })
      const error = await receiveType(opened.channel, 'relay.error')
      assert.equal(
        error.code,
        attempt < 5 ? 'enrollment_invalid' : 'rate_limited',
      )
    }
    assert.equal(service.metrics().rateLimitEvents, 1)
    assert.equal(service.metrics().enrollmentFailures, 5)
  })
})

test('authentication attempts are bounded by claimed fingerprint as well as network address', async () => {
  await withService(async ({ service, tls }) => {
    const unknownIdentity = generateRelayApplicationIdentity()
    for (let attempt = 0; attempt < 121; attempt += 1) {
      const opened = await openChallenge(service, tls.publicKeySpkiFingerprint)
      await opened.channel.send({
        type: 'peer.authenticate',
        protocolVersion: relayProtocolVersion,
        peerFingerprint: unknownIdentity.publicKeyFingerprint,
        role: 'controller',
        clientBuildIdentity: 'test-build',
        signature: signRelayTranscript(
          unknownIdentity.privateKeyPem,
          relayAuthenticationTranscript({
            challenge: opened.challenge,
            peerFingerprint: unknownIdentity.publicKeyFingerprint,
            role: 'controller',
            clientBuildIdentity: 'test-build',
          }),
        ),
      })
      const error = await receiveType(opened.channel, 'relay.error')
      assert.equal(
        error.code,
        attempt < 120 ? 'authentication_failed' : 'rate_limited',
      )
    }
    assert.equal(service.metrics().authenticationFailures, 120)
    assert.equal(service.metrics().rateLimitEvents, 1)
  })
})

test('graceful shutdown invalidates every owned connection and returns to bounded idle state', async () => {
  await withService(async ({ store, service, tls }) => {
    const controller = await enrollPeer(
      service,
      tls.publicKeySpkiFingerprint,
      store.createEnrollmentToken('controller'),
      'controller',
      generateRelayApplicationIdentity(),
    )
    const node = await enrollPeer(
      service,
      tls.publicKeySpkiFingerprint,
      store.createEnrollmentToken('node'),
      'node',
      generateRelayApplicationIdentity(),
    )
    const startedAt = Date.now()
    await service.close()
    assert.equal(Date.now() - startedAt < 2_000, true)
    await waitUntil(() => controller.channel.closed && node.channel.closed)
    assert.equal(service.metrics().authenticatedConnections, 0)
    assert.equal(service.metrics().connectionRegistryEntries, 0)
    assert.equal(service.metrics().activeTlsConnections, 0)
    await service.close()
  })
})

test('Relay service restart retains identity and enrollment but rotates connection epoch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codetether-relay-restart-'))
  let firstService
  let secondService
  try {
    const firstStore = new RelayStateStore(join(root, 'state'))
    const firstTls = await generateRelayPinnedTlsIdentity(firstStore.identity)
    firstService = new RelayService({
      stateStore: firstStore,
      tls: firstTls,
      host: '127.0.0.1',
      port: 0,
      managementPort: null,
      logger: silentLogger,
    })
    await firstService.start()
    const identity = generateRelayApplicationIdentity()
    const enrolled = await enrollPeer(
      firstService,
      firstTls.publicKeySpkiFingerprint,
      firstStore.createEnrollmentToken('node'),
      'node',
      identity,
    )
    const relayId = firstService.relayId
    const relayFingerprint = firstService.relayFingerprint
    const peerId = enrolled.ready.peerId
    const firstEpoch = enrolled.ready.connectionEpoch
    await firstService.close()
    firstService = undefined

    const secondStore = new RelayStateStore(join(root, 'state'))
    const secondTls = await generateRelayPinnedTlsIdentity(secondStore.identity)
    secondService = new RelayService({
      stateStore: secondStore,
      tls: secondTls,
      host: '127.0.0.1',
      port: 0,
      managementPort: null,
      logger: silentLogger,
    })
    await secondService.start()
    assert.equal(secondService.relayId, relayId)
    assert.equal(secondService.relayFingerprint, relayFingerprint)
    assert.equal(secondTls.publicKeySpkiFingerprint, relayFingerprint)
    const reconnected = await authenticatePeer(
      secondService,
      secondTls.publicKeySpkiFingerprint,
      'node',
      identity,
    )
    assert.equal(reconnected.ready.peerId, peerId)
    assert.notEqual(reconnected.ready.connectionEpoch, firstEpoch)
    await closePeer(reconnected)
  } finally {
    if (firstService !== undefined) await firstService.close()
    if (secondService !== undefined) await secondService.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('hard Relay process termination preserves identity and enrolled reconnect state', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'codetether-relay-hard-restart-'))
  const stateDirectory = join(root, 'state')
  let firstProcess
  let secondProcess
  t.after(async () => {
    if (firstProcess !== undefined)
      await stopRelayProcess(firstProcess.child, 'SIGKILL')
    if (secondProcess !== undefined)
      await stopRelayProcess(secondProcess.child, 'SIGKILL')
    await rm(root, { recursive: true, force: true })
  })

  const bootstrap = new RelayStateStore(stateDirectory)
  const token = bootstrap.createEnrollmentToken('node')
  const expectedRelayId = bootstrap.identity.relayId
  const expectedRelayFingerprint = bootstrap.identity.publicKeyFingerprint
  bootstrap.close()

  firstProcess = await startRelayProcess(stateDirectory)
  assert.equal(firstProcess.relayId, expectedRelayId)
  assert.equal(firstProcess.relayFingerprint, expectedRelayFingerprint)
  const firstService = {
    listeningAddress: { port: firstProcess.port },
    relayFingerprint: firstProcess.relayFingerprint,
  }
  const identity = generateRelayApplicationIdentity()
  const enrolled = await enrollPeer(
    firstService,
    firstProcess.relayFingerprint,
    token,
    'node',
    identity,
  )
  const peerId = enrolled.ready.peerId
  const firstEpoch = enrolled.ready.connectionEpoch

  await stopRelayProcess(firstProcess.child, 'SIGKILL')
  await waitUntil(() => enrolled.channel.closed)
  secondProcess = await startRelayProcess(stateDirectory)
  assert.equal(secondProcess.relayId, expectedRelayId)
  assert.equal(secondProcess.relayFingerprint, expectedRelayFingerprint)
  const secondService = {
    listeningAddress: { port: secondProcess.port },
    relayFingerprint: secondProcess.relayFingerprint,
  }
  const reconnected = await authenticatePeer(
    secondService,
    secondProcess.relayFingerprint,
    'node',
    identity,
  )
  assert.equal(reconnected.ready.peerId, peerId)
  assert.notEqual(reconnected.ready.connectionEpoch, firstEpoch)
  await closePeer(reconnected)
  await stopRelayProcess(secondProcess.child, 'SIGTERM')
})

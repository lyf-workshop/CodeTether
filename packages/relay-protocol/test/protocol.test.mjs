import assert from 'node:assert/strict'
import { Duplex } from 'node:stream'
import test from 'node:test'

import {
  FramedRelayConnection,
  RelayClientMessageSchema,
  RelayChannelDataSchema,
  RelayFrameDecoder,
  RelayPeerRoleSchema,
  RelayServerMessageSchema,
  RelayWireMessageSchema,
  encodeRelayFrame,
  fingerprintRelayPublicKeySpki,
  generateRelayApplicationIdentity,
  newRelayChallengeId,
  newRelayChannelGeneration,
  newRelayChannelId,
  newRelayConnectionEpoch,
  newRelayNonce,
  newRelayRequestId,
  relayAuthenticationTranscript,
  relayChallengeTranscript,
  relayProtocolLimits,
  relayProtocolVersion,
  signRelayTranscript,
  verifyRelayTranscript,
} from '../dist/index.js'

function signedChallenge(identity, overrides = {}) {
  const issuedAt = new Date('2026-01-01T00:00:00.000Z')
  const unsigned = {
    type: 'relay.challenge',
    protocolVersion: relayProtocolVersion,
    relayId: 'relay_0123456789abcdef',
    relayPublicKeySpki: identity.publicKeySpki,
    relayFingerprint: identity.publicKeyFingerprint,
    challengeId: newRelayChallengeId(),
    nonce: newRelayNonce(),
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 15_000).toISOString(),
    ...overrides,
  }
  return {
    ...unsigned,
    signature: signRelayTranscript(
      identity.privateKeyPem,
      relayChallengeTranscript(unsigned),
    ),
  }
}

test('Relay application identity signs fixed challenge and authentication transcripts', () => {
  const relay = generateRelayApplicationIdentity()
  const peer = generateRelayApplicationIdentity()
  const challenge = signedChallenge(relay)
  const { signature: challengeSignature, ...unsignedChallenge } = challenge
  assert.equal(
    fingerprintRelayPublicKeySpki(relay.publicKeySpki),
    relay.publicKeyFingerprint,
  )
  assert.equal(
    verifyRelayTranscript(
      challenge.relayPublicKeySpki,
      relayChallengeTranscript(unsignedChallenge),
      challengeSignature,
    ),
    true,
  )

  const input = {
    challenge,
    peerFingerprint: peer.publicKeyFingerprint,
    role: 'node',
    clientBuildIdentity: 'git-0123456789ab',
  }
  const signature = signRelayTranscript(
    peer.privateKeyPem,
    relayAuthenticationTranscript(input),
  )
  assert.equal(
    verifyRelayTranscript(
      peer.publicKeySpki,
      relayAuthenticationTranscript(input),
      signature,
    ),
    true,
  )
  const replayChallenge = signedChallenge(relay)
  assert.equal(
    verifyRelayTranscript(
      peer.publicKeySpki,
      relayAuthenticationTranscript({ ...input, challenge: replayChallenge }),
      signature,
    ),
    false,
  )
})

test('control schemas cannot represent Agent execution or opaque payloads', () => {
  const epoch = newRelayConnectionEpoch()
  const requestId = newRelayRequestId()
  const forbidden = [
    { type: 'prompt', protocolVersion: relayProtocolVersion, input: 'do work' },
    {
      type: 'execute',
      protocolVersion: relayProtocolVersion,
      prompt: 'do work',
    },
    {
      type: 'shell',
      protocolVersion: relayProtocolVersion,
      command: 'whoami',
    },
    {
      type: 'provider.command',
      protocolVersion: relayProtocolVersion,
      command: 'resume',
    },
    {
      type: 'provider.event',
      protocolVersion: relayProtocolVersion,
      payload: {},
    },
    {
      type: 'tool.event',
      protocolVersion: relayProtocolVersion,
      tool: 'Read',
    },
    {
      type: 'conversation.event',
      protocolVersion: relayProtocolVersion,
      output: 'secret',
    },
    {
      type: 'filesystem.read',
      protocolVersion: relayProtocolVersion,
      path: '/etc/passwd',
    },
    {
      type: 'filesystem.operation',
      protocolVersion: relayProtocolVersion,
      operation: 'read',
    },
    {
      type: 'arbitrary_payload',
      protocolVersion: relayProtocolVersion,
      bytes: 'AAAA',
    },
    { type: 'peers.list', protocolVersion: relayProtocolVersion },
    {
      type: 'peer.search',
      protocolVersion: relayProtocolVersion,
      query: 'node',
    },
    {
      type: 'peer.goodbye',
      protocolVersion: relayProtocolVersion,
      connectionEpoch: epoch,
      payload: { prompt: 'hidden' },
    },
    {
      type: 'rendezvous.subscribe',
      protocolVersion: relayProtocolVersion,
      connectionEpoch: epoch,
      requestId,
      targetNodeFingerprint: 'A'.repeat(43),
      conversationId: 'conv_secret',
    },
  ]
  for (const message of forbidden) {
    assert.equal(RelayWireMessageSchema.safeParse(message).success, false)
  }
})

test('machine TLS channels are purpose-bound, epoch-bound, and strictly bounded', () => {
  const controllerConnectionEpoch = newRelayConnectionEpoch()
  const nodeConnectionEpoch = newRelayConnectionEpoch()
  const channelId = newRelayChannelId()
  const channelGeneration = newRelayChannelGeneration()
  const requestId = newRelayRequestId()
  const binding = {
    protocolVersion: relayProtocolVersion,
    connectionEpoch: controllerConnectionEpoch,
    channelId,
    channelGeneration,
    controllerConnectionEpoch,
    nodeConnectionEpoch,
  }
  const oneByte = Buffer.from([0]).toString('base64url')
  const maximumData = Buffer.alloc(
    relayProtocolLimits.maximumChannelDataBytes,
    0xa5,
  ).toString('base64url')

  assert.equal(relayProtocolVersion, 2)
  assert.equal(RelayChannelDataSchema.safeParse(oneByte).success, true)
  assert.equal(RelayChannelDataSchema.safeParse(maximumData).success, true)
  assert.equal(
    RelayClientMessageSchema.safeParse({
      type: 'channel.open',
      protocolVersion: relayProtocolVersion,
      connectionEpoch: controllerConnectionEpoch,
      requestId,
      targetNodeFingerprint: 'A'.repeat(43),
      purpose: 'machine_tls_v1',
    }).success,
    true,
  )
  assert.equal(
    RelayClientMessageSchema.safeParse({
      type: 'channel.data',
      ...binding,
      sequence: 1,
      data: oneByte,
    }).success,
    true,
  )
  assert.equal(
    RelayClientMessageSchema.safeParse({
      type: 'channel.data.ack',
      ...binding,
      acknowledgedSequence: 1,
    }).success,
    true,
  )

  const forbiddenOpenFields = [
    { host: '127.0.0.1' },
    { port: 22 },
    { provider: 'codex' },
    { prompt: 'secret' },
    { targetUrl: 'tcp://example.invalid:22' },
    { destination: { host: 'example.invalid', port: 443 } },
  ]
  for (const extra of forbiddenOpenFields) {
    assert.equal(
      RelayClientMessageSchema.safeParse({
        type: 'channel.open',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: controllerConnectionEpoch,
        requestId,
        targetNodeFingerprint: 'A'.repeat(43),
        purpose: 'machine_tls_v1',
        ...extra,
      }).success,
      false,
    )
  }
  assert.equal(
    RelayClientMessageSchema.safeParse({
      type: 'channel.open',
      protocolVersion: relayProtocolVersion,
      connectionEpoch: controllerConnectionEpoch,
      requestId,
      targetNodeFingerprint: 'A'.repeat(43),
      purpose: 'arbitrary_bytes',
    }).success,
    false,
  )
  assert.equal(
    RelayClientMessageSchema.safeParse({
      type: 'channel.data',
      ...binding,
      sequence: 1,
      data: oneByte,
      payload: { prompt: 'secret' },
    }).success,
    false,
  )
  assert.equal(
    RelayChannelDataSchema.safeParse(
      Buffer.alloc(relayProtocolLimits.maximumChannelDataBytes + 1).toString(
        'base64url',
      ),
    ).success,
    false,
  )
  assert.equal(RelayChannelDataSchema.safeParse('AB').success, false)
  assert.equal(RelayChannelDataSchema.safeParse('AA==').success, false)
  assert.equal(RelayChannelDataSchema.safeParse('').success, false)
})

test('peer roles are explicit and cannot mutate into product or operator roles', () => {
  assert.deepEqual(RelayPeerRoleSchema.options, ['controller', 'node'])
  for (const role of ['admin', 'provider', 'project', 'conversation', 'NODE']) {
    assert.equal(RelayPeerRoleSchema.safeParse(role).success, false)
  }
})

test('client reconnect authentication is fingerprint-based and strictly bounded', () => {
  const peer = generateRelayApplicationIdentity()
  const valid = {
    type: 'peer.authenticate',
    protocolVersion: relayProtocolVersion,
    peerFingerprint: peer.publicKeyFingerprint,
    role: 'controller',
    clientBuildIdentity: 'test-build',
    signature: 'A'.repeat(86),
  }
  assert.equal(RelayClientMessageSchema.safeParse(valid).success, true)
  assert.equal(
    RelayClientMessageSchema.safeParse({ ...valid, peerId: 'relay_peer_extra' })
      .success,
    false,
  )
  assert.equal(
    RelayClientMessageSchema.safeParse({
      ...valid,
      clientBuildIdentity: 'A'.repeat(
        relayProtocolLimits.maximumBuildIdentityCharacters + 1,
      ),
    }).success,
    false,
  )
})

test('length-prefixed framing is incremental, bounded, and rejects malformed input', () => {
  const message = {
    type: 'relay.error',
    protocolVersion: relayProtocolVersion,
    code: 'internal',
    message: 'Relay connection failed',
  }
  assert.equal(RelayServerMessageSchema.safeParse(message).success, true)
  const frame = encodeRelayFrame(message)
  const decoder = new RelayFrameDecoder()
  assert.deepEqual(decoder.push(frame.subarray(0, 2)), [])
  assert.deepEqual(decoder.push(frame.subarray(2)), [message])
  decoder.finish()

  assert.throws(
    () => encodeRelayFrame('x'.repeat(relayProtocolLimits.maximumFrameBytes)),
    /frame bound/u,
  )
  const oversizedHeader = Buffer.alloc(4)
  oversizedHeader.writeUInt32BE(relayProtocolLimits.maximumFrameBytes + 1)
  assert.throws(() => new RelayFrameDecoder().push(oversizedHeader), /length/u)
  const invalidUtf8 = Buffer.from([0, 0, 0, 2, 0xc3, 0x28])
  assert.throws(() => new RelayFrameDecoder().push(invalidUtf8), /UTF-8/u)
})

test('decoder parses coalesced valid frames before bounding only the undecoded residual', () => {
  const values = [
    'a'.repeat(relayProtocolLimits.maximumFrameBytes - 2),
    'b'.repeat(relayProtocolLimits.maximumFrameBytes - 2),
    'c'.repeat(relayProtocolLimits.maximumFrameBytes - 2),
  ]
  const encoded = values.map((value) => encodeRelayFrame(value))
  const decoder = new RelayFrameDecoder()

  assert.deepEqual(decoder.push(encoded[0].subarray(0, 2)), [])
  assert.deepEqual(
    decoder.push(
      Buffer.concat([encoded[0].subarray(2), encoded[1], encoded[2]]),
    ),
    values,
  )
  decoder.finish()

  const excessive = Buffer.concat(
    Array.from(
      { length: relayProtocolLimits.maximumQueuedFrames + 2 },
      (_, index) => encodeRelayFrame({ index }),
    ),
  )
  assert.throws(
    () => new RelayFrameDecoder().push(excessive),
    /receive queue exceeded/u,
  )
})

test('framing queue metrics track enqueue, dequeue, and send settlement without payload', async () => {
  class ControlledDuplex extends Duplex {
    writes = []

    _read() {}

    _write(chunk, _encoding, callback) {
      this.writes.push({ chunk: Buffer.from(chunk), callback })
    }

    settleNextWrite() {
      const write = this.writes.shift()
      assert.ok(write)
      write.callback()
      return write.chunk
    }
  }

  const stream = new ControlledDuplex()
  const observations = []
  const connection = new FramedRelayConnection(stream, {
    onQueueMetricsChanged(metrics) {
      observations.push(metrics)
    },
  })
  const message = {
    type: 'relay.error',
    protocolVersion: relayProtocolVersion,
    code: 'internal',
    message: 'Relay connection failed',
  }
  const wireBytes = encodeRelayFrame(message).length

  const sending = connection.send(message)
  assert.deepEqual(connection.queueMetrics, {
    queuedInboundFrames: 0,
    queuedInboundBytes: 0,
    pendingOutboundFrames: 1,
    pendingOutboundBytes: wireBytes,
  })
  assert.equal(stream.settleNextWrite().length, wireBytes)
  await sending
  assert.deepEqual(connection.queueMetrics, {
    queuedInboundFrames: 0,
    queuedInboundBytes: 0,
    pendingOutboundFrames: 0,
    pendingOutboundBytes: 0,
  })

  stream.push(
    Buffer.concat([encodeRelayFrame(message), encodeRelayFrame(message)]),
  )
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(connection.queueMetrics, {
    queuedInboundFrames: 2,
    queuedInboundBytes: wireBytes * 2,
    pendingOutboundFrames: 0,
    pendingOutboundBytes: 0,
  })
  assert.deepEqual(await connection.receive(RelayServerMessageSchema), message)
  assert.deepEqual(connection.queueMetrics, {
    queuedInboundFrames: 1,
    queuedInboundBytes: wireBytes,
    pendingOutboundFrames: 0,
    pendingOutboundBytes: 0,
  })
  assert.deepEqual(await connection.receive(RelayServerMessageSchema), message)
  assert.deepEqual(connection.queueMetrics, {
    queuedInboundFrames: 0,
    queuedInboundBytes: 0,
    pendingOutboundFrames: 0,
    pendingOutboundBytes: 0,
  })
  assert.equal(observations.length >= 6, true)
  assert.equal(JSON.stringify(observations).includes(message.message), false)
  connection.destroy()
})

test('100 encode/decode lifecycles return to an empty decoder state', () => {
  for (let index = 0; index < 100; index += 1) {
    const decoder = new RelayFrameDecoder()
    const value = {
      type: 'relay.error',
      protocolVersion: relayProtocolVersion,
      code: 'connection_failed',
      message: 'Relay connection failed',
    }
    assert.deepEqual(decoder.push(encodeRelayFrame(value)), [value])
    decoder.finish()
  }
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  RelayClientMessageSchema,
  RelayFrameDecoder,
  RelayPeerRoleSchema,
  RelayServerMessageSchema,
  RelayWireMessageSchema,
  encodeRelayFrame,
  fingerprintRelayPublicKeySpki,
  generateRelayApplicationIdentity,
  newRelayChallengeId,
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
    { type: 'prompt', protocolVersion: 1, input: 'do work' },
    { type: 'execute', protocolVersion: 1, prompt: 'do work' },
    { type: 'shell', protocolVersion: 1, command: 'whoami' },
    { type: 'provider.command', protocolVersion: 1, command: 'resume' },
    { type: 'provider.event', protocolVersion: 1, payload: {} },
    { type: 'tool.event', protocolVersion: 1, tool: 'Read' },
    { type: 'conversation.event', protocolVersion: 1, output: 'secret' },
    { type: 'filesystem.read', protocolVersion: 1, path: '/etc/passwd' },
    { type: 'filesystem.operation', protocolVersion: 1, operation: 'read' },
    { type: 'arbitrary_payload', protocolVersion: 1, bytes: 'AAAA' },
    { type: 'peers.list', protocolVersion: 1 },
    { type: 'peer.search', protocolVersion: 1, query: 'node' },
    {
      type: 'peer.goodbye',
      protocolVersion: 1,
      connectionEpoch: epoch,
      payload: { prompt: 'hidden' },
    },
    {
      type: 'rendezvous.subscribe',
      protocolVersion: 1,
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

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Duplex } from 'node:stream'
import test from 'node:test'

import {
  FramedMachineConnection,
  MachineErrorMessageSchema,
  MachineFrameDecoder,
  OpaquePairingAuthority,
  OpaquePairingInitiator,
  createMachineTlsIdentityFile,
  encodeMachineFrame,
  generateMachineTlsIdentity,
  newMachineTransportMachineId,
  newPairingAttemptId,
  pairingConfirmationTag,
  pairingServerIdentifier,
  readMachineTlsIdentityFile,
  receiveCompatibleMachineMessage,
  validateMachineTlsIdentity,
  verifyPairingConfirmationTag,
} from '../dist/index.js'

test('bounded framing handles fragmented and coalesced messages', () => {
  const decoder = new MachineFrameDecoder()
  const first = encodeMachineFrame({ type: 'first', value: '登录 Café 🚀' })
  const second = encodeMachineFrame({ type: 'second' })
  assert.deepEqual(decoder.push(first.subarray(0, 3)), [])
  assert.deepEqual(decoder.push(Buffer.concat([first.subarray(3), second])), [
    { type: 'first', value: '登录 Café 🚀' },
    { type: 'second' },
  ])
  decoder.finish()
  assert.throws(
    () => new MachineFrameDecoder().push(Buffer.from([0, 1, 0, 0])),
    /frame length/u,
  )
})

test('OPAQUE pairing authenticates the code without transmitting it', async () => {
  const code = '482731'
  const machineId = newMachineTransportMachineId()
  const serverIdentifier = pairingServerIdentifier(
    machineId,
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  )
  const authority = await OpaquePairingAuthority.create({
    attemptId: newPairingAttemptId(),
    expiresAt: new Date(Date.now() + 300_000),
    serverIdentifier,
    code,
  })
  const initiator = await OpaquePairingInitiator.start(code, serverIdentifier)
  const server = authority.startLogin(initiator.request)
  const client = initiator.finish(server.response)
  const serverKey = server.finish(client.request)
  assert.deepEqual(client.sessionKey, serverKey)
  assert.throws(() => server.finish(client.request), /already used/u)
  assert.equal(server.response.includes(code), false)
  assert.equal(initiator.request.includes(code), false)
  client.sessionKey.fill(0)
  serverKey.fill(0)
})

test('client receive distinguishes incompatible protocol from malformed input', async () => {
  const incompatibleStream = new ResponseDuplex()
  const incompatibleConnection = new FramedMachineConnection(incompatibleStream)
  const incompatible = receiveCompatibleMachineMessage(
    incompatibleConnection,
    MachineErrorMessageSchema,
  )
  incompatibleStream.respond({
    type: 'machine.error',
    protocolVersion: 2,
    code: 'protocol_incompatible',
    message: 'newer protocol',
  })
  await assert.rejects(
    incompatible,
    (error) => error.code === 'protocol_incompatible',
  )

  const malformedStream = new ResponseDuplex()
  const malformedConnection = new FramedMachineConnection(malformedStream)
  const malformed = receiveCompatibleMachineMessage(
    malformedConnection,
    MachineErrorMessageSchema,
  )
  malformedStream.respond({ protocolVersion: 1, type: 'unexpected' })
  await assert.rejects(malformed, (error) => error.code === 'malformed_message')
})

test('wrong, expired, consumed, and rate-limited pairing attempts fail closed', async () => {
  let now = 100
  const serverIdentifier = pairingServerIdentifier(
    newMachineTransportMachineId(),
    'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  )
  const authority = await OpaquePairingAuthority.create({
    attemptId: newPairingAttemptId(),
    expiresAt: new Date(Date.now() + 1_000),
    serverIdentifier,
    code: '123456',
    lifetimeMs: 20,
    maximumAttempts: 2,
    monotonicNow: () => now,
  })
  const wrong = await OpaquePairingInitiator.start('654321', serverIdentifier)
  const first = authority.startLogin(wrong.request)
  assert.throws(() => wrong.finish(first.response), /invalid|failed/u)
  const wrongAgain = await OpaquePairingInitiator.start(
    '654321',
    serverIdentifier,
  )
  authority.startLogin(wrongAgain.request)
  assert.throws(() => authority.startLogin(wrongAgain.request), /limit/u)

  const expiring = await OpaquePairingAuthority.create({
    attemptId: newPairingAttemptId(),
    expiresAt: new Date(Date.now() + 1_000),
    serverIdentifier,
    code: '123456',
    lifetimeMs: 20,
    monotonicNow: () => now,
  })
  now = 121
  assert.throws(() => expiring.startLogin('invalid'), /expired/u)

  now = 100
  const consumed = await OpaquePairingAuthority.create({
    attemptId: newPairingAttemptId(),
    expiresAt: new Date(Date.now() + 1_000),
    serverIdentifier,
    code: '123456',
    lifetimeMs: 20,
    monotonicNow: () => now,
  })
  consumed.consume()
  assert.throws(() => consumed.startLogin('invalid'), /disabled/u)
})

test('the final admitted pairing attempt may complete but no later login starts', async () => {
  const serverIdentifier = pairingServerIdentifier(
    newMachineTransportMachineId(),
    'GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG',
  )
  const authority = await OpaquePairingAuthority.create({
    attemptId: newPairingAttemptId(),
    expiresAt: new Date(Date.now() + 1_000),
    serverIdentifier,
    code: '112233',
    maximumAttempts: 1,
  })
  const initiator = await OpaquePairingInitiator.start(
    '112233',
    serverIdentifier,
  )
  const server = authority.startLogin(initiator.request)
  const client = initiator.finish(server.response)
  const serverKey = server.finish(client.request)
  assert.deepEqual(serverKey, client.sessionKey)
  authority.consume()
  assert.throws(() => authority.startLogin(initiator.request), /disabled/u)
  client.sessionKey.fill(0)
  serverKey.fill(0)
})

test('pairing confirmation is transcript and TLS-channel bound', () => {
  const sessionKey = Buffer.alloc(64, 7)
  const transcript = {
    protocolVersion: 1,
    attemptId: 'pairing_abcdef',
    machine: {
      machineId: 'machine_abcdef',
      nodeId: 'node_abcdef',
      displayName: 'Development Server',
      platform: 'Linux',
      architecture: 'x64',
    },
    controllerId: 'controller_abcdef',
    nodeFingerprint: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    controllerFingerprint: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    nodeNonce: 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
    controllerNonce: 'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
    tlsExporter: 'EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE',
  }
  const tag = pairingConfirmationTag(
    sessionKey,
    'controller-confirm',
    transcript,
  )
  verifyPairingConfirmationTag(
    sessionKey,
    'controller-confirm',
    transcript,
    tag,
  )
  assert.throws(
    () =>
      verifyPairingConfirmationTag(
        sessionKey,
        'controller-confirm',
        {
          ...transcript,
          tlsExporter: 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF',
        },
        tag,
      ),
    /confirmation/u,
  )
})

test('private identity files are exclusive, validated, and never regenerated on corruption', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-transport-'))
  const path = join(directory, 'controller.json')
  try {
    const created = await createMachineTlsIdentityFile(path)
    const loaded = await readMachineTlsIdentityFile(path)
    assert.equal(loaded.publicKeyFingerprint, created.publicKeyFingerprint)
    await assert.rejects(createMachineTlsIdentityFile(path), /already exists/u)
    await writeFile(path, '{"schemaVersion":1}', 'utf8')
    await assert.rejects(readMachineTlsIdentityFile(path))
    const raw = await readFile(path, 'utf8')
    assert.equal(raw, '{"schemaVersion":1}')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('TLS identity validation rejects a certificate/private-key mismatch', async () => {
  const first = await generateMachineTlsIdentity('CodeTether Node')
  const second = await generateMachineTlsIdentity('CodeTether Node')
  assert.throws(() =>
    validateMachineTlsIdentity({
      ...first,
      privateKeyPem: second.privateKeyPem,
    }),
  )
})

class ResponseDuplex extends Duplex {
  _read() {}

  _write(_chunk, _encoding, callback) {
    callback()
  }

  respond(value) {
    this.push(encodeMachineFrame(value))
  }
}

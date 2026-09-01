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
  MachineWireMessageSchema,
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
  RemoteCodexSession,
  RemoteProjectLocationPathSchema,
  RemoteCodexPromptSchema,
  RemoteProviderDescriptorSchema,
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

test('Project Location messages are purpose-specific, strict, and path-bounded', () => {
  const request = {
    type: 'project_location.validate',
    protocolVersion: 1,
    requestId: 'A'.repeat(43),
    expectedMachineId: 'machine_abcdef',
    expectedNodeId: 'node_abcdef',
    rootPath: '/home/user/项目 with spaces',
  }
  assert.equal(MachineWireMessageSchema.safeParse(request).success, true)
  assert.equal(
    MachineWireMessageSchema.safeParse({ ...request, list: true }).success,
    false,
  )
  assert.equal(
    MachineWireMessageSchema.safeParse({
      type: 'filesystem.read',
      protocolVersion: 1,
      path: '/etc/passwd',
    }).success,
    false,
  )
  assert.equal(
    RemoteProjectLocationPathSchema.safeParse(`/${'界'.repeat(1_400)}`).success,
    false,
  )
  assert.equal(
    RemoteProjectLocationPathSchema.safeParse('/safe\0path').success,
    false,
  )
})

test('Provider discovery messages are purpose-specific and presentation-safe', () => {
  const capabilities = {
    streaming: false,
    resume: false,
    interrupt: false,
    approvals: false,
    fileRead: false,
    fileEdit: false,
    shell: false,
    search: false,
    diff: false,
    toolEvents: false,
    modelSelection: false,
    reasoningControl: false,
  }
  const request = {
    type: 'providers.describe',
    protocolVersion: 1,
    requestId: 'P'.repeat(43),
    expectedMachineId: 'machine_abcdef',
    expectedNodeId: 'node_abcdef',
  }
  const descriptor = {
    provider: 'codex',
    displayName: 'Codex',
    availability: 'available',
    version: '0.149.1',
    capabilities,
  }
  assert.equal(MachineWireMessageSchema.safeParse(request).success, true)
  assert.equal(
    RemoteProviderDescriptorSchema.safeParse(descriptor).success,
    true,
  )
  assert.equal(
    RemoteProviderDescriptorSchema.safeParse({
      ...descriptor,
      capabilities: { ...capabilities, streaming: true },
    }).success,
    false,
  )
  assert.equal(
    RemoteProviderDescriptorSchema.safeParse({
      ...descriptor,
      capabilities: { ...capabilities, streaming: true, resume: true },
    }).success,
    true,
  )
  assert.equal(
    RemoteProviderDescriptorSchema.safeParse({
      ...descriptor,
      provider: 'claude-code',
      capabilities: { ...capabilities, streaming: true, resume: true },
    }).success,
    false,
  )
  assert.equal(
    RemoteProviderDescriptorSchema.safeParse({
      ...descriptor,
      executablePath: '/home/user/.local/bin/codex',
    }).success,
    false,
  )
  assert.equal(
    MachineWireMessageSchema.safeParse({
      ...request,
      executable: '/bin/sh',
      arguments: ['-c', 'id'],
    }).success,
    false,
  )
  assert.equal(
    MachineWireMessageSchema.safeParse({
      type: 'providers.described',
      protocolVersion: 1,
      requestId: request.requestId,
      machineId: request.expectedMachineId,
      nodeId: request.expectedNodeId,
      observedAt: new Date().toISOString(),
      providers: [
        descriptor,
        {
          ...descriptor,
          provider: 'claude-code',
          displayName: 'Claude Code',
          version: '2.1.251',
        },
      ],
    }).success,
    true,
  )
  assert.equal(
    MachineWireMessageSchema.safeParse({
      type: 'providers.described',
      protocolVersion: 1,
      requestId: request.requestId,
      machineId: request.expectedMachineId,
      nodeId: request.expectedNodeId,
      observedAt: new Date().toISOString(),
      providers: [descriptor, descriptor],
    }).success,
    false,
  )
})

test('remote Codex execution messages are correlated, bounded, and non-generic', () => {
  const session = {
    type: 'codex.session.open',
    protocolVersion: 1,
    requestId: 'S'.repeat(43),
    expectedMachineId: 'machine_abcdef',
    expectedNodeId: 'node_abcdef',
    conversationId: 'conv_abcdef',
    projectId: 'proj_abcdef',
    rootPath: '/home/user/project',
  }
  const turn = {
    type: 'codex.turn.start',
    protocolVersion: 1,
    actionId: 'act_abcdef',
    conversationId: 'conv_abcdef',
    turnId: 'turn_abcdef',
    providerThreadId: 'thread-native-1',
    prompt: 'Return a short marker.',
  }
  assert.equal(MachineWireMessageSchema.safeParse(session).success, true)
  assert.equal(MachineWireMessageSchema.safeParse(turn).success, true)
  for (const injected of [
    { executable: '/bin/sh' },
    { argv: ['sh', '-c', 'id'] },
    { environment: { TOKEN: 'secret' } },
    { cwd: '/tmp/attacker-controlled' },
    { method: 'process.execute' },
  ]) {
    assert.equal(
      MachineWireMessageSchema.safeParse({ ...session, ...injected }).success,
      false,
    )
  }
  assert.equal(
    MachineWireMessageSchema.safeParse({
      ...turn,
      prompt: 'x'.repeat(9 * 1024),
    }).success,
    false,
  )
  assert.equal(RemoteCodexPromptSchema.safeParse('safe\0prompt').success, false)
  assert.equal(
    MachineWireMessageSchema.safeParse({
      type: 'codex.turn.event',
      protocolVersion: 1,
      machineId: session.expectedMachineId,
      nodeId: session.expectedNodeId,
      actionId: turn.actionId,
      conversationId: turn.conversationId,
      turnId: turn.turnId,
      providerThreadId: turn.providerThreadId,
      providerTurnId: 'provider-turn-1',
      sequence: 1,
      event: { type: 'message.delta', text: 'streamed text' },
    }).success,
    true,
  )
  assert.equal(
    MachineWireMessageSchema.safeParse({
      type: 'codex.turn.event',
      protocolVersion: 1,
      machineId: session.expectedMachineId,
      nodeId: session.expectedNodeId,
      actionId: turn.actionId,
      conversationId: turn.conversationId,
      turnId: turn.turnId,
      providerThreadId: turn.providerThreadId,
      providerTurnId: 'provider-turn-1',
      sequence: 1,
      event: { type: 'tool.started', command: 'cat secret' },
    }).success,
    false,
  )
})

test('remote Codex session exposes a closed dedicated transport without probing the Node', async () => {
  const stream = new ResponseDuplex()
  const connection = new FramedMachineConnection(stream)
  const session = new RemoteCodexSession(
    connection,
    {
      machineId: 'machine_remote_liveness01',
      nodeId: 'node_remote_liveness01',
      displayName: 'Remote liveness fixture',
      platform: 'Linux',
      architecture: 'x64',
    },
    {
      type: 'codex.session.ready',
      protocolVersion: 1,
      requestId: 'L'.repeat(43),
      machineId: 'machine_remote_liveness01',
      nodeId: 'node_remote_liveness01',
      conversationId: 'conv_remote_liveness01',
      providerThreadId: 'native-thread-liveness',
      resumed: true,
      executionProfile: 'codex-text-v1',
    },
  )

  assert.equal(session.closed, false)
  stream.push(null)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(session.closed, true)
  await assert.rejects(
    session.startTurn({
      actionId: 'act_remote_liveness01',
      turnId: 'turn_remote_liveness01',
      prompt: 'This prompt must not be written to the closed connection.',
    }),
    (error) => error.code === 'provider_session_lost',
  )
  await session.close()
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

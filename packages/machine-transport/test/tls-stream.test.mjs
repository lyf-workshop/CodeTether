import assert from 'node:assert/strict'
import { constants } from 'node:crypto'
import { once } from 'node:events'
import { connect as connectTcp, createServer } from 'node:net'
import {
  connect as connectTls,
  createServer as createTlsServer,
} from 'node:tls'
import test from 'node:test'

import {
  acceptMachineTlsOverStream,
  ClaudeSessionOpenMessageSchema,
  CodexSessionOpenMessageSchema,
  CodexTurnStartMessageSchema,
  connectMachineTls,
  connectMachineTlsOverStream,
  connectTrustedRemoteMachineOverStream,
  exportMachineTlsBinding,
  FramedMachineConnection,
  generateMachineTlsIdentity,
  MachineHelloMessageSchema,
  machineProtocolVersion,
  machineTransportAlpn,
  machineTlsServerOptions,
  newControllerId,
  newMachineTransportMachineId,
  newNodeId,
  openRemoteClaudeSessionOverStream,
  openRemoteCodexSessionOverStream,
  requireFreshMachineTlsSession,
} from '../dist/index.js'

const providerInstallationId = 'pinst_streamfixture01'
const installationRevision = 'prev_streamfixture01'

test('Machine TLS authenticates both identities over existing Duplex streams', async () => {
  const node = await generateMachineTlsIdentity('CodeTether Node')
  const controller = await generateMachineTlsIdentity('CodeTether Controller')
  const pair = await createTcpDuplexPair()
  let client
  let server
  try {
    ;[client, server] = await Promise.all([
      connectMachineTlsOverStream({
        stream: pair.client,
        identity: controller,
        expectedPeerFingerprint: node.publicKeyFingerprint,
      }),
      acceptMachineTlsOverStream({
        stream: pair.accepted,
        identity: node,
        expectedPeerFingerprint: controller.publicKeyFingerprint,
      }),
    ])

    assert.equal(client.peerFingerprint, node.publicKeyFingerprint)
    assert.equal(server.peerFingerprint, controller.publicKeyFingerprint)
    assert.equal(client.socket.getProtocol(), 'TLSv1.3')
    assert.equal(server.socket.getProtocol(), 'TLSv1.3')
    assert.equal(client.socket.alpnProtocol, machineTransportAlpn)
    assert.equal(server.socket.alpnProtocol, machineTransportAlpn)
    assert.equal(client.socket.isSessionReused(), false)
    assert.equal(server.socket.isSessionReused(), false)
    assert.equal(
      exportMachineTlsBinding(client.socket),
      exportMachineTlsBinding(server.socket),
    )
    assert.match(client.socket.getCipher().standardName ?? '', /^TLS_/u)

    const received = once(server.socket, 'data')
    client.socket.write(Buffer.from('bounded-machine-frame'))
    const [data] = await received
    assert.equal(data.toString('utf8'), 'bounded-machine-frame')
  } finally {
    client?.socket.destroy()
    server?.socket.destroy()
    pair.destroy()
    await pair.closeServer()
  }
})

test('Machine TLS policy is TLS 1.3-only and requests no stateless tickets', async () => {
  const node = await generateMachineTlsIdentity('CodeTether Node')
  const options = machineTlsServerOptions(node)
  assert.equal(options.minVersion, 'TLSv1.3')
  assert.equal(options.maxVersion, 'TLSv1.3')
  assert.deepEqual(options.ALPNProtocols, [machineTransportAlpn])
  assert.equal(options.requestCert, true)
  assert.equal(options.rejectUnauthorized, false)
  assert.notEqual(options.secureOptions & constants.SSL_OP_NO_TICKET, 0)
})

test('fresh Machine TLS streams do not resume or reuse channel bindings', async () => {
  const node = await generateMachineTlsIdentity('CodeTether Node')
  const controller = await generateMachineTlsIdentity('CodeTether Controller')
  const bindings = []
  for (let index = 0; index < 2; index += 1) {
    const pair = await createTcpDuplexPair()
    let client
    let server
    try {
      ;[client, server] = await Promise.all([
        connectMachineTlsOverStream({
          stream: pair.client,
          identity: controller,
          expectedPeerFingerprint: node.publicKeyFingerprint,
        }),
        acceptMachineTlsOverStream({
          stream: pair.accepted,
          identity: node,
          expectedPeerFingerprint: controller.publicKeyFingerprint,
        }),
      ])
      assert.equal(client.socket.isSessionReused(), false)
      assert.equal(server.socket.isSessionReused(), false)
      bindings.push(exportMachineTlsBinding(client.socket))
    } finally {
      client?.socket.destroy()
      server?.socket.destroy()
      pair.destroy()
      await pair.closeServer()
    }
  }
  assert.notEqual(bindings[0], bindings[1])
})

test(
  'an actual TLS 1.3 session resumption attempt is rejected before Machine framing',
  { timeout: 10_000 },
  async () => {
    const node = await generateMachineTlsIdentity('CodeTether Node')
    const controller = await generateMachineTlsIdentity('CodeTether Controller')
    let acceptedFreshSessions = 0
    let resumedRejection
    const resumedRejected = new Promise((resolve) => {
      resumedRejection = resolve
    })
    const sockets = new Set()
    const server = createTlsServer(
      {
        ...machineTlsServerOptions(node),
        // The test deliberately permits a ticket so the rejection guard sees
        // a real resumed TLS 1.3 socket. Production requests no stateless one.
        secureOptions: 0,
      },
      (socket) => {
        sockets.add(socket)
        socket.once('close', () => sockets.delete(socket))
        try {
          requireFreshMachineTlsSession(socket)
          acceptedFreshSessions += 1
          socket.once('end', () => socket.end())
          socket.resume()
        } catch (error) {
          resumedRejection(error)
          setImmediate(() => socket.destroy())
        }
      },
    )
    await listen(server)
    const address = server.address()
    assert.ok(address !== null && typeof address !== 'string')
    const clientOptions = {
      host: '127.0.0.1',
      port: address.port,
      key: controller.privateKeyPem,
      cert: controller.certificatePem,
      rejectUnauthorized: false,
      minVersion: 'TLSv1.3',
      maxVersion: 'TLSv1.3',
      ALPNProtocols: [machineTransportAlpn],
    }
    let first
    let second
    try {
      first = connectTls(clientOptions)
      const sessionAvailable = once(first, 'session')
      await once(first, 'secureConnect')
      assert.equal(first.isSessionReused(), false)
      const [session] = await sessionAvailable
      assert.ok(Buffer.isBuffer(session) && session.length > 0)
      first.end()
      await once(first, 'close')

      second = connectTls({ ...clientOptions, session })
      await once(second, 'secureConnect')
      assert.equal(second.isSessionReused(), true)
      const rejection = await resumedRejected
      assert.equal(rejection?.code, 'authentication_failed')
      assert.equal(acceptedFreshSessions, 1)
    } finally {
      first?.destroy()
      second?.destroy()
      for (const socket of sockets) socket.destroy()
      await closeServer(server)
    }
  },
)

test('Machine TLS exporter refuses a socket outside the verified protocol', () => {
  let exported = false
  const incompatible = {
    destroyed: false,
    encrypted: true,
    alpnProtocol: 'not-codetether-machine',
    getProtocol: () => 'TLSv1.3',
    isSessionReused: () => false,
    exportKeyingMaterial() {
      exported = true
      return Buffer.alloc(32)
    },
  }
  assert.throws(
    () => exportMachineTlsBinding(incompatible),
    (error) => error?.code === 'authentication_failed',
  )
  assert.equal(exported, false)
})

test('Machine TLS exporter refuses a resumed TLS session', () => {
  let certificateRead = false
  const resumed = {
    destroyed: false,
    encrypted: true,
    alpnProtocol: machineTransportAlpn,
    getProtocol: () => 'TLSv1.3',
    isSessionReused: () => true,
    getPeerCertificate() {
      certificateRead = true
      return {}
    },
  }
  assert.throws(
    () => exportMachineTlsBinding(resumed),
    (error) => error?.code === 'authentication_failed',
  )
  assert.equal(certificateRead, false)
})

test('Machine TLS over an existing stream requires an exact peer pin', async () => {
  const controller = await generateMachineTlsIdentity('CodeTether Controller')
  const pair = await createTcpDuplexPair()
  try {
    await assert.rejects(
      connectMachineTlsOverStream({
        stream: pair.client,
        identity: controller,
      }),
      (error) => error?.code === 'identity_mismatch',
    )
    assert.equal(pair.client.destroyed, true)
  } finally {
    pair.destroy()
    await pair.closeServer()
  }
})

test('Machine TLS server over an existing stream requires an exact peer pin', async () => {
  const node = await generateMachineTlsIdentity('CodeTether Node')
  const pair = await createTcpDuplexPair()
  try {
    await assert.rejects(
      acceptMachineTlsOverStream({
        stream: pair.accepted,
        identity: node,
      }),
      (error) => error?.code === 'identity_mismatch',
    )
    assert.equal(pair.accepted.destroyed, true)
  } finally {
    pair.destroy()
    await pair.closeServer()
  }
})

test('Machine TLS over an existing stream rejects plaintext without fallback', async () => {
  const node = await generateMachineTlsIdentity('CodeTether Node')
  const controller = await generateMachineTlsIdentity('CodeTether Controller')
  const pair = await createTcpDuplexPair()
  const serverPromise = acceptMachineTlsOverStream({
    stream: pair.accepted,
    identity: node,
    expectedPeerFingerprint: controller.publicKeyFingerprint,
  })
  try {
    pair.client.end(Buffer.from('{"type":"machine.hello","prompt":"not-tls"}'))
    await assert.rejects(
      serverPromise,
      (error) => error?.code === 'connection_failed',
    )
  } finally {
    pair.destroy()
    await pair.closeServer()
  }
})

test('the direct Machine TLS client preserves the existing pinned connection contract', async () => {
  const node = await generateMachineTlsIdentity('CodeTether Node')
  const controller = await generateMachineTlsIdentity('CodeTether Controller')
  let accepted
  const acceptedPromise = new Promise((resolve) => {
    accepted = resolve
  })
  const server = createTlsServer(machineTlsServerOptions(node), (socket) =>
    accepted(socket),
  )
  await listen(server)
  const address = server.address()
  assert.notEqual(address, null)
  assert.equal(typeof address, 'object')
  let client
  let serverSocket
  try {
    client = await connectMachineTls({
      host: '127.0.0.1',
      port: address.port,
      identity: controller,
      expectedPeerFingerprint: node.publicKeyFingerprint,
    })
    serverSocket = await acceptedPromise
    assert.equal(client.peerFingerprint, node.publicKeyFingerprint)
    assert.equal(client.socket.getProtocol(), 'TLSv1.3')
    assert.equal(client.socket.alpnProtocol, machineTransportAlpn)
  } finally {
    client?.socket.destroy()
    serverSocket?.destroy()
    await closeServer(server)
  }
})

test('Machine TLS over a stream rejects a wrong Node identity pin', async () => {
  const node = await generateMachineTlsIdentity('CodeTether Node')
  const otherNode = await generateMachineTlsIdentity('CodeTether Node')
  const controller = await generateMachineTlsIdentity('CodeTether Controller')
  const pair = await createTcpDuplexPair()
  const serverPromise = acceptMachineTlsOverStream({
    stream: pair.accepted,
    identity: node,
    expectedPeerFingerprint: controller.publicKeyFingerprint,
  })
  const clientPromise = connectMachineTlsOverStream({
    stream: pair.client,
    identity: controller,
    expectedPeerFingerprint: otherNode.publicKeyFingerprint,
  })
  try {
    await assert.rejects(
      clientPromise,
      (error) => error?.code === 'identity_mismatch',
    )
    pair.destroy()
    const serverResult = await Promise.allSettled([serverPromise])
    if (serverResult[0].status === 'fulfilled') {
      serverResult[0].value.socket.destroy()
    }
  } finally {
    pair.destroy()
    await pair.closeServer()
  }
})

test('Machine TLS over a stream rejects a controller certificate with the wrong pin', async () => {
  const node = await generateMachineTlsIdentity('CodeTether Node')
  const controller = await generateMachineTlsIdentity('CodeTether Controller')
  const otherController = await generateMachineTlsIdentity(
    'CodeTether Controller',
  )
  const pair = await createTcpDuplexPair()
  const clientPromise = connectMachineTlsOverStream({
    stream: pair.client,
    identity: controller,
    expectedPeerFingerprint: node.publicKeyFingerprint,
  })
  const serverPromise = acceptMachineTlsOverStream({
    stream: pair.accepted,
    identity: node,
    expectedPeerFingerprint: otherController.publicKeyFingerprint,
  })
  try {
    await assert.rejects(
      serverPromise,
      (error) => error?.code === 'identity_mismatch',
    )
    const clientResult = await Promise.allSettled([clientPromise])
    if (clientResult[0].status === 'fulfilled') {
      clientResult[0].value.socket.destroy()
    }
  } finally {
    pair.destroy()
    await pair.closeServer()
  }
})

test('Machine TLS over a stream rejects an incompatible ALPN', async () => {
  const node = await generateMachineTlsIdentity('CodeTether Node')
  const controller = await generateMachineTlsIdentity('CodeTether Controller')
  const pair = await createTcpDuplexPair()
  const serverPromise = acceptMachineTlsOverStream({
    stream: pair.accepted,
    identity: node,
    expectedPeerFingerprint: controller.publicKeyFingerprint,
  })
  const incompatibleClient = connectTls({
    socket: pair.client,
    key: controller.privateKeyPem,
    cert: controller.certificatePem,
    rejectUnauthorized: false,
    minVersion: 'TLSv1.3',
    maxVersion: 'TLSv1.3',
    ALPNProtocols: ['not-codetether-machine'],
  })
  try {
    await assert.rejects(
      serverPromise,
      (error) =>
        error?.code === 'protocol_incompatible' ||
        error?.code === 'connection_failed',
    )
  } finally {
    incompatibleClient.destroy()
    pair.destroy()
    await pair.closeServer()
  }
})

test('Machine TLS over a stream rejects TLS 1.2 without downgrade', async () => {
  const node = await generateMachineTlsIdentity('CodeTether Node')
  const controller = await generateMachineTlsIdentity('CodeTether Controller')
  const pair = await createTcpDuplexPair()
  const serverPromise = acceptMachineTlsOverStream({
    stream: pair.accepted,
    identity: node,
    expectedPeerFingerprint: controller.publicKeyFingerprint,
  })
  const downgradedClient = connectTls({
    socket: pair.client,
    key: controller.privateKeyPem,
    cert: controller.certificatePem,
    rejectUnauthorized: false,
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.2',
    ALPNProtocols: [machineTransportAlpn],
  })
  downgradedClient.once('error', () => undefined)
  try {
    await assert.rejects(
      serverPromise,
      (error) => error?.code === 'connection_failed',
    )
  } finally {
    downgradedClient.destroy()
    pair.destroy()
    await pair.closeServer()
  }
})

test('destroying Machine TLS closes the wrapped peer stream', async () => {
  const node = await generateMachineTlsIdentity('CodeTether Node')
  const controller = await generateMachineTlsIdentity('CodeTether Controller')
  const pair = await createTcpDuplexPair()
  let client
  let server
  try {
    ;[client, server] = await Promise.all([
      connectMachineTlsOverStream({
        stream: pair.client,
        identity: controller,
        expectedPeerFingerprint: node.publicKeyFingerprint,
      }),
      acceptMachineTlsOverStream({
        stream: pair.accepted,
        identity: node,
        expectedPeerFingerprint: controller.publicKeyFingerprint,
      }),
    ])
    server.socket.once('error', () => undefined)
    const peerClosed = new Promise((resolve) =>
      server.socket.once('close', resolve),
    )
    client.socket.destroy()
    await peerClosed
    assert.equal(server.socket.destroyed, true)
  } finally {
    client?.socket.destroy()
    server?.socket.destroy()
    pair.destroy()
    await pair.closeServer()
  }
})

test('trusted Machine hello over a stream validates the durable Machine identity', async () => {
  const trust = await createTrustFixture()
  const pair = await createTcpDuplexPair()
  const wrongMachine = { ...trust.machine, nodeId: newNodeId() }
  const serverTask = acceptMachineHello(pair.accepted, trust, wrongMachine)
  try {
    await assert.rejects(
      connectTrustedRemoteMachineOverStream({
        peer: trust.peer,
        controller: trust.controller,
        stream: pair.client,
      }),
      (error) => error?.code === 'identity_mismatch',
    )
  } finally {
    await destroyServerConnection(serverTask)
    pair.destroy()
    await pair.closeServer()
  }
})

test('Codex session over a stream shares trusted hello and exact session-open validation', async () => {
  const trust = await createTrustFixture()
  const pair = await createTcpDuplexPair()
  const conversationId = 'conv_stream_codex'
  const projectId = 'proj_stream_codex'
  const providerThreadId = 'thread_stream_codex'
  const serverTask = (async () => {
    const connection = await acceptMachineHello(pair.accepted, trust)
    const open = await connection.receive(CodexSessionOpenMessageSchema)
    assert.equal(open.expectedMachineId, trust.machine.machineId)
    assert.equal(open.expectedNodeId, trust.machine.nodeId)
    assert.equal(open.conversationId, conversationId)
    assert.equal(open.projectId, projectId)
    assert.equal(open.rootPath, '/srv/stream-codex')
    await connection.send({
      type: 'codex.session.ready',
      protocolVersion: machineProtocolVersion,
      requestId: open.requestId,
      machineId: trust.machine.machineId,
      nodeId: trust.machine.nodeId,
      conversationId,
      providerInstallationId,
      installationRevision,
      providerThreadId,
      resumed: false,
      executionProfile: 'codex-text-v1',
    })
    return connection
  })()
  let session
  try {
    session = await openRemoteCodexSessionOverStream({
      peer: trust.peer,
      controller: trust.controller,
      stream: pair.client,
      conversationId,
      projectId,
      providerInstallationId,
      expectedInstallationRevision: installationRevision,
      rootPath: '/srv/stream-codex',
    })
    assert.equal(session.machine.machineId, trust.machine.machineId)
    assert.equal(session.conversationId, conversationId)
    assert.equal(session.providerThreadId, providerThreadId)
    assert.equal(session.resumed, false)
  } finally {
    pair.destroy()
    await destroyServerConnection(serverTask)
    await pair.closeServer()
  }
})

test('Claude session over a stream shares trusted hello and exact session-open validation', async () => {
  const trust = await createTrustFixture()
  const pair = await createTcpDuplexPair()
  const conversationId = 'conv_stream_claude'
  const projectId = 'proj_stream_claude'
  const providerSessionId = '11111111-1111-4111-8111-111111111111'
  const serverTask = (async () => {
    const connection = await acceptMachineHello(pair.accepted, trust)
    const open = await connection.receive(ClaudeSessionOpenMessageSchema)
    assert.equal(open.expectedMachineId, trust.machine.machineId)
    assert.equal(open.expectedNodeId, trust.machine.nodeId)
    assert.equal(open.conversationId, conversationId)
    assert.equal(open.projectId, projectId)
    assert.equal(open.rootPath, '/srv/stream-claude')
    assert.equal(open.effort, 'high')
    await connection.send({
      type: 'claude.session.ready',
      protocolVersion: machineProtocolVersion,
      requestId: open.requestId,
      machineId: trust.machine.machineId,
      nodeId: trust.machine.nodeId,
      conversationId,
      providerInstallationId,
      installationRevision,
      providerSessionId,
      resumed: false,
      effort: 'high',
      executionProfile: 'claude-restricted-read-search-v1',
    })
    return connection
  })()
  try {
    const session = await openRemoteClaudeSessionOverStream({
      peer: trust.peer,
      controller: trust.controller,
      stream: pair.client,
      conversationId,
      projectId,
      providerInstallationId,
      expectedInstallationRevision: installationRevision,
      rootPath: '/srv/stream-claude',
      effort: 'high',
    })
    assert.equal(session.machine.machineId, trust.machine.machineId)
    assert.equal(session.conversationId, conversationId)
    assert.equal(session.providerSessionId, providerSessionId)
    assert.equal(session.resumed, false)
    assert.equal(session.effort, 'high')
  } finally {
    pair.destroy()
    await destroyServerConnection(serverTask)
    await pair.closeServer()
  }
})

test('stream session-open loss remains authenticated and unsafe for endpoint retry', async () => {
  const trust = await createTrustFixture()
  const pair = await createTcpDuplexPair()
  const serverTask = (async () => {
    const connection = await acceptMachineHello(pair.accepted, trust)
    await connection.receive(CodexSessionOpenMessageSchema)
    connection.destroy()
  })()
  try {
    await assert.rejects(
      openRemoteCodexSessionOverStream({
        peer: trust.peer,
        controller: trust.controller,
        stream: pair.client,
        conversationId: 'conv_stream_uncertain',
        projectId: 'proj_stream_uncertain',
        providerInstallationId,
        expectedInstallationRevision: installationRevision,
        rootPath: '/srv/stream-uncertain',
      }),
      (error) =>
        error?.code === 'connection_failed' &&
        error?.peerAuthenticated === true,
    )
  } finally {
    await Promise.allSettled([serverTask])
    pair.destroy()
    await pair.closeServer()
  }
})

test('Turn-start loss over a stream preserves action correlation and ownership uncertainty', async () => {
  const trust = await createTrustFixture()
  const pair = await createTcpDuplexPair()
  const conversationId = 'conv_stream_turn'
  const providerThreadId = 'thread_stream_turn'
  const serverTask = (async () => {
    const connection = await acceptMachineHello(pair.accepted, trust)
    const open = await connection.receive(CodexSessionOpenMessageSchema)
    await connection.send({
      type: 'codex.session.ready',
      protocolVersion: machineProtocolVersion,
      requestId: open.requestId,
      machineId: trust.machine.machineId,
      nodeId: trust.machine.nodeId,
      conversationId,
      providerInstallationId,
      installationRevision,
      providerThreadId,
      resumed: false,
      executionProfile: 'codex-text-v1',
    })
    const start = await connection.receive(CodexTurnStartMessageSchema)
    assert.equal(start.actionId, 'act_stream_turn')
    assert.equal(start.turnId, 'turn_stream_turn')
    assert.equal(start.conversationId, conversationId)
    assert.equal(start.providerThreadId, providerThreadId)
    assert.equal(start.prompt, 'safe fixture prompt')
    connection.destroy()
  })()
  try {
    const session = await openRemoteCodexSessionOverStream({
      peer: trust.peer,
      controller: trust.controller,
      stream: pair.client,
      conversationId,
      projectId: 'proj_stream_turn',
      providerInstallationId,
      expectedInstallationRevision: installationRevision,
      rootPath: '/srv/stream-turn',
    })
    await assert.rejects(
      session.startTurn({
        actionId: 'act_stream_turn',
        turnId: 'turn_stream_turn',
        prompt: 'safe fixture prompt',
      }),
      (error) =>
        error?.code === 'remote_execution_lost' &&
        error?.peerAuthenticated === true &&
        error?.failureReason === 'execution_ownership_uncertain',
    )
  } finally {
    await Promise.allSettled([serverTask])
    pair.destroy()
    await pair.closeServer()
  }
})

async function createTcpDuplexPair() {
  let accept
  const acceptedPromise = new Promise((resolve) => {
    accept = resolve
  })
  const server = createServer((socket) => accept(socket))
  await listen(server)
  const address = server.address()
  assert.notEqual(address, null)
  assert.equal(typeof address, 'object')
  const client = connectTcp({ host: '127.0.0.1', port: address.port })
  const accepted = await acceptedPromise
  return {
    client,
    accepted,
    destroy() {
      client.destroy()
      accepted.destroy()
    },
    async closeServer() {
      await closeServer(server)
    },
  }
}

async function createTrustFixture() {
  const nodeIdentity = await generateMachineTlsIdentity('CodeTether Node')
  const controller = {
    controllerId: newControllerId(),
    tls: await generateMachineTlsIdentity('CodeTether Controller'),
  }
  const machine = {
    machineId: newMachineTransportMachineId(),
    nodeId: newNodeId(),
    displayName: 'Stream Node',
    platform: 'Linux',
    architecture: 'x64',
  }
  return {
    nodeIdentity,
    controller,
    machine,
    peer: {
      machine,
      endpoint: { host: 'direct-endpoint-is-not-used.invalid', port: 65535 },
      nodeFingerprint: nodeIdentity.publicKeyFingerprint,
      protocolVersion: machineProtocolVersion,
      controllerId: controller.controllerId,
    },
  }
}

async function acceptMachineHello(
  stream,
  trust,
  responseMachine = trust.machine,
) {
  const tls = await acceptMachineTlsOverStream({
    stream,
    identity: trust.nodeIdentity,
    expectedPeerFingerprint: trust.controller.tls.publicKeyFingerprint,
  })
  const connection = new FramedMachineConnection(tls.socket)
  const hello = await connection.receive(MachineHelloMessageSchema)
  assert.equal(hello.controllerId, trust.controller.controllerId)
  assert.equal(hello.expectedMachineId, trust.machine.machineId)
  await connection.send({
    type: 'machine.status',
    protocolVersion: machineProtocolVersion,
    machine: responseMachine,
    nonce: hello.nonce,
    observedAt: new Date().toISOString(),
  })
  return connection
}

async function destroyServerConnection(connectionPromise) {
  const [result] = await Promise.allSettled([connectionPromise])
  if (result.status === 'fulfilled') result.value.destroy()
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)))
  })
}

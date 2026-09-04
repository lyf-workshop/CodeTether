import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { connect as connectTcp, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Duplex } from 'node:stream'
import test from 'node:test'

import {
  connectTrustedRemoteMachine,
  connectTrustedRemoteMachineOverStream,
  generateMachineTlsIdentity,
  machineProtocolVersion,
  newControllerId,
} from '@codetether/machine-transport'

import { CodeTetherNodeService } from '../dist/node-service.js'
import { NodeStateStore } from '../dist/state-store.js'

test('trusted Relay Machine channel and direct listener share the exact Node dispatcher', async () => {
  const fixture = await createNodeFixture()
  let direct
  let relayed
  let pair
  try {
    direct = await connectTrustedRemoteMachine({
      peer: fixture.peer,
      controller: fixture.controller,
    })
    await direct.ping()

    pair = await createTcpDuplexPair()
    const accepted = fixture.service.acceptRelayMachineChannel({
      stream: pair.accepted,
      controllerFingerprint: fixture.controller.tls.publicKeyFingerprint,
    })
    relayed = await connectTrustedRemoteMachineOverStream({
      peer: fixture.peer,
      controller: fixture.controller,
      stream: pair.client,
    })
    await accepted
    assert.deepEqual(relayed.machine, fixture.state.machine)
    await relayed.ping()
    await direct.ping()
  } finally {
    direct?.close()
    relayed?.close()
    pair?.destroy()
    await pair?.closeServer()
    await fixture.close()
  }
})

test('Relay stream observes TLS wire records but no Machine application plaintext', async () => {
  const fixture = await createNodeFixture()
  const pair = await createTcpDuplexPair()
  const observed = new RecordingDuplex(pair.client)
  let relayed
  try {
    const accepted = fixture.service.acceptRelayMachineChannel({
      stream: pair.accepted,
      controllerFingerprint: fixture.controller.tls.publicKeyFingerprint,
    })
    relayed = await connectTrustedRemoteMachineOverStream({
      peer: fixture.peer,
      controller: fixture.controller,
      stream: observed,
    })
    await accepted
    await relayed.ping()

    const wireBytes = Buffer.concat([
      ...observed.outboundChunks,
      ...observed.inboundChunks,
    ])
    assert.ok(wireBytes.length > 0)
    for (const plaintext of [
      fixture.controller.controllerId,
      fixture.state.machine.machineId,
      fixture.state.machine.nodeId,
      'machine.hello',
      'machine.ping',
      'machine.pong',
    ]) {
      assert.equal(wireBytes.includes(Buffer.from(plaintext, 'utf8')), false)
    }
  } finally {
    relayed?.close()
    observed.destroy()
    pair.destroy()
    await pair.closeServer()
    await fixture.close()
  }
})

test('corrupted inner TLS application record fails closed before Machine dispatch', async () => {
  const fixture = await createNodeFixture()
  const pair = await createTcpDuplexPair()
  const observed = new RecordingDuplex(pair.client)
  let relayed
  try {
    const accepted = fixture.service.acceptRelayMachineChannel({
      stream: pair.accepted,
      controllerFingerprint: fixture.controller.tls.publicKeyFingerprint,
    })
    relayed = await connectTrustedRemoteMachineOverStream({
      peer: fixture.peer,
      controller: fixture.controller,
      stream: observed,
    })
    await accepted
    observed.corruptNextOutboundChunk()
    await assert.rejects(relayed.ping())
    assert.equal(observed.corruptedChunks, 1)
  } finally {
    relayed?.close()
    observed.destroy()
    pair.destroy()
    await pair.closeServer()
    await fixture.close()
  }
})

test('Relay Machine channel rejects an inner Controller certificate mismatch before Machine protocol', async () => {
  const fixture = await createNodeFixture()
  const wrongController = {
    controllerId: fixture.controller.controllerId,
    tls: await generateMachineTlsIdentity('CodeTether Controller'),
  }
  const pair = await createTcpDuplexPair()
  try {
    const accepted = fixture.service.acceptRelayMachineChannel({
      stream: pair.accepted,
      controllerFingerprint: fixture.controller.tls.publicKeyFingerprint,
    })
    await assert.rejects(
      connectTrustedRemoteMachineOverStream({
        peer: fixture.peer,
        controller: wrongController,
        stream: pair.client,
      }),
      (error) => error?.code === 'connection_failed',
    )
    await accepted
    assert.equal(fixture.state.trustedControllerCount, 1)
  } finally {
    pair.destroy()
    await pair.closeServer()
    await fixture.close()
  }
})

test('Relay admits four Provider sessions plus the independent heartbeat channel within explicit global bounds', async () => {
  const fixture = await createNodeFixture()
  const pairs = []
  const connections = []
  try {
    for (let index = 0; index < 5; index += 1) {
      const pair = await createTcpDuplexPair()
      pairs.push(pair)
      const accepted = fixture.service.acceptRelayMachineChannel({
        stream: pair.accepted,
        controllerFingerprint: fixture.controller.tls.publicKeyFingerprint,
      })
      const connection = await connectTrustedRemoteMachineOverStream({
        peer: fixture.peer,
        controller: fixture.controller,
        stream: pair.client,
      })
      await accepted
      connections.push(connection)
    }
    await Promise.all(connections.map(async (connection) => connection.ping()))
    assert.equal(connections.length, 5)
  } finally {
    for (const connection of connections) connection.close()
    for (const pair of pairs) pair.destroy()
    for (const pair of pairs) await pair.closeServer()
    await fixture.close()
  }
})

test('Machine unpair closes other active Relay Machine sessions without disabling direct listener ownership', async () => {
  const fixture = await createNodeFixture()
  const firstPair = await createTcpDuplexPair()
  const secondPair = await createTcpDuplexPair()
  let first
  let second
  try {
    const firstAccepted = fixture.service.acceptRelayMachineChannel({
      stream: firstPair.accepted,
      controllerFingerprint: fixture.controller.tls.publicKeyFingerprint,
    })
    first = await connectTrustedRemoteMachineOverStream({
      peer: fixture.peer,
      controller: fixture.controller,
      stream: firstPair.client,
    })
    await firstAccepted
    const secondAccepted = fixture.service.acceptRelayMachineChannel({
      stream: secondPair.accepted,
      controllerFingerprint: fixture.controller.tls.publicKeyFingerprint,
    })
    second = await connectTrustedRemoteMachineOverStream({
      peer: fixture.peer,
      controller: fixture.controller,
      stream: secondPair.client,
    })
    await secondAccepted
    await Promise.all([first.ping(), second.ping()])

    await first.revoke()
    assert.equal(fixture.state.trustedControllerCount, 0)
    await assert.rejects(second.ping())

    await assert.rejects(
      connectTrustedRemoteMachine({
        peer: fixture.peer,
        controller: fixture.controller,
      }),
      (error) =>
        error?.code === 'authentication_failed' ||
        error?.code === 'connection_failed',
    )
  } finally {
    first?.close()
    second?.close()
    firstPair.destroy()
    secondPair.destroy()
    await firstPair.closeServer()
    await secondPair.closeServer()
    await fixture.close()
  }
})

async function createNodeFixture() {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-node-relay-channel-'),
  )
  const state = await NodeStateStore.open({
    dataDirectory: directory,
    displayName: 'Relay Machine Node',
    platform: 'Linux',
    architecture: 'x64',
  })
  const controller = {
    controllerId: newControllerId(),
    tls: await generateMachineTlsIdentity('CodeTether Controller'),
  }
  await state.trustController({
    controllerId: controller.controllerId,
    publicKeyFingerprint: controller.tls.publicKeyFingerprint,
    pairedAt: new Date().toISOString(),
  })
  const service = new CodeTetherNodeService({
    state,
    bindAddress: '127.0.0.1',
    port: 0,
  })
  const endpoint = await service.listen()
  return {
    state,
    service,
    controller,
    peer: {
      machine: state.machine,
      endpoint: { host: '127.0.0.1', port: endpoint.port },
      nodeFingerprint: state.identity.publicKeyFingerprint,
      protocolVersion: machineProtocolVersion,
      controllerId: controller.controllerId,
    },
    async close() {
      await service.close().catch(() => undefined)
      await rm(directory, { recursive: true, force: true })
    },
  }
}

async function createTcpDuplexPair() {
  let accept
  const acceptedPromise = new Promise((resolve) => {
    accept = resolve
  })
  const server = createServer((socket) => accept(socket))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
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
      await new Promise((resolve, reject) => {
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        )
      })
    },
  }
}

class RecordingDuplex extends Duplex {
  outboundChunks = []
  inboundChunks = []
  corruptedChunks = 0
  corruptNext = false

  constructor(stream) {
    super({ allowHalfOpen: false })
    this.stream = stream
    stream.on('data', (chunk) => {
      const bytes = Buffer.from(chunk)
      this.inboundChunks.push(bytes)
      if (!this.push(bytes)) stream.pause()
    })
    stream.once('end', () => this.push(null))
    stream.once('error', (error) => this.destroy(error))
  }

  _read() {
    this.stream.resume()
  }

  _write(chunk, encoding, callback) {
    let bytes = Buffer.isBuffer(chunk)
      ? Buffer.from(chunk)
      : Buffer.from(chunk, encoding)
    if (this.corruptNext && bytes.length > 0) {
      this.corruptNext = false
      this.corruptedChunks += 1
      bytes = Buffer.from(bytes)
      bytes[bytes.length - 1] ^= 1
    }
    this.outboundChunks.push(bytes)
    this.stream.write(bytes, callback)
  }

  corruptNextOutboundChunk() {
    this.corruptNext = true
  }

  _final(callback) {
    this.stream.end(callback)
  }

  _destroy(error, callback) {
    this.stream.destroy()
    callback(error)
  }
}

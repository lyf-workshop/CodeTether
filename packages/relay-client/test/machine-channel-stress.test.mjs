import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

import {
  generateRelayApplicationIdentity,
  relayProtocolLimits,
} from '@codetether/relay-protocol'

import {
  RelayService,
  RelayStateStore,
  generateRelayPinnedTlsIdentity,
} from '../../../apps/relay/dist/index.js'
import { connectRelayControl } from '../dist/index.js'

const LOGICAL_EVENT_BYTES = 5

test('four Relay Machine channels preserve 50,000/100,000 logical events under bidirectional slow-reader pressure', async (t) => {
  const fixture = await startStressFixture()
  t.after(() => fixture.close())

  const channels = []
  for (let index = 0; index < 4; index += 1) {
    channels.push(await fixture.openChannelPair())
  }
  assert.equal(fixture.service.metrics().activeChannels, 4)

  const profiles = [
    { controllerToNode: 50_000, nodeToController: 2_048 },
    { controllerToNode: 2_048, nodeToController: 100_000 },
    { controllerToNode: 12_000, nodeToController: 12_000 },
    { controllerToNode: 2_048, nodeToController: 2_048 },
  ]
  const transfers = []
  for (
    let channelIndex = 0;
    channelIndex < channels.length;
    channelIndex += 1
  ) {
    const channel = channels[channelIndex]
    const profile = profiles[channelIndex]
    transfers.push(
      createTransfer({
        label: `controller-${channelIndex}-to-node`,
        sender: channel.controller,
        receiver: channel.node,
        logicalEventCount: profile.controllerToNode,
        streamTag: channelIndex * 2 + 1,
      }),
      createTransfer({
        label: `node-${channelIndex}-to-controller`,
        sender: channel.node,
        receiver: channel.controller,
        logicalEventCount: profile.nodeToController,
        streamTag: channelIndex * 2 + 2,
      }),
    )
  }

  // Start every direction as a burst but deliberately leave both Controller
  // and Node readers paused. Each of four channels may own at most one
  // outstanding frame in each direction, so pressure is capped at eight.
  for (const transfer of transfers) transfer.startWrite()
  await waitFor(() => fixture.service.metrics().pendingChannelDataFrames === 8)
  const pressured = fixture.service.metrics()
  assert.equal(pressured.activeChannels, 4)
  assert.equal(pressured.openingChannels, 0)
  assert.equal(pressured.pendingChannelDataFrames, 8)
  assert.equal(
    pressured.pendingChannelDataFrames <= pressured.activeChannels * 2,
    true,
  )
  assert.equal(
    pressured.pendingControlMessagesUpperBound,
    2 * relayProtocolLimits.maximumQueuedFrames,
  )

  let maximumObservedOutstandingFrames = pressured.pendingChannelDataFrames
  const metricsSampler = setInterval(() => {
    maximumObservedOutstandingFrames = Math.max(
      maximumObservedOutstandingFrames,
      fixture.service.metrics().pendingChannelDataFrames,
    )
  }, 1)
  t.after(() => clearInterval(metricsSampler))
  for (const transfer of transfers) transfer.startSlowRead()

  const probeLabels = new Set(['controller-3-to-node', 'node-3-to-controller'])
  const probesBeforeHeavy = await Promise.race([
    Promise.all(
      transfers
        .filter((transfer) => probeLabels.has(transfer.label))
        .map((transfer) => transfer.done),
    ).then(() => 'probes'),
    Promise.all(
      transfers
        .filter(
          (transfer) =>
            transfer.logicalEventCount === 50_000 ||
            transfer.logicalEventCount === 100_000,
        )
        .map((transfer) => transfer.done),
    ).then(() => 'heavy'),
  ])
  assert.equal(probesBeforeHeavy, 'probes')

  const results = await Promise.all(transfers.map((transfer) => transfer.done))
  clearInterval(metricsSampler)
  assert.equal(maximumObservedOutstandingFrames <= 8, true)
  for (const result of results) {
    assert.deepEqual(result.received, result.expected, result.label)
    assert.equal(
      result.maximumReadBytes <= relayProtocolLimits.maximumChannelDataBytes,
      true,
      `${result.label} exceeded the per-frame byte bound`,
    )
  }

  const totalExpectedBytes = transfers.reduce(
    (total, transfer) => total + transfer.expected.length,
    0,
  )
  const totalExpectedFrames = transfers.reduce(
    (total, transfer) =>
      total +
      Math.ceil(
        transfer.expected.length / relayProtocolLimits.maximumChannelDataBytes,
      ),
    0,
  )
  const drained = fixture.service.metrics()
  assert.equal(drained.activeChannels, 4)
  assert.equal(drained.pendingChannelDataFrames, 0)
  assert.equal(drained.channelDataBytesForwarded, totalExpectedBytes)
  assert.equal(drained.channelDataFramesForwarded, totalExpectedFrames)
  assert.equal(drained.channelBackpressureFailures, 0)
  assert.equal(drained.channelErrors, 0)

  const nodeTerminals = channels.map((channel) =>
    waitForStreamEnd(channel.node),
  )
  for (const channel of channels) channel.node.resume()
  for (const channel of channels) channel.controller.destroy()
  await Promise.all(nodeTerminals)
  await waitFor(() => {
    const metrics = fixture.service.metrics()
    return (
      metrics.activeChannels === 0 &&
      metrics.openingChannels === 0 &&
      metrics.pendingChannelDataFrames === 0
    )
  })
  assert.equal(
    channels.every((channel) => channel.node.readableEnded),
    true,
  )

  await Promise.all([
    fixture.controller.connection.close(),
    fixture.node.connection.close(),
  ])
  await waitFor(() => {
    const metrics = fixture.service.metrics()
    return (
      metrics.activeTlsConnections === 0 &&
      metrics.authenticatedConnections === 0 &&
      metrics.connectionRegistryEntries === 0
    )
  })
  const idle = fixture.service.metrics()
  assert.equal(idle.pendingControlMessagesUpperBound, 0)
  assert.equal(idle.pendingChannelDataFrames, 0)
})

function createTransfer(options) {
  const expected = createLogicalEvents(
    options.logicalEventCount,
    options.streamTag,
  )
  let writePromise
  let readPromise
  return {
    label: options.label,
    logicalEventCount: options.logicalEventCount,
    expected,
    startWrite() {
      assert.equal(writePromise, undefined)
      writePromise = writeBounded(options.sender, expected)
    },
    startSlowRead() {
      assert.notEqual(writePromise, undefined)
      assert.equal(readPromise, undefined)
      readPromise = readExactlySlow(options.receiver, expected.length, 1)
    },
    get done() {
      assert.notEqual(writePromise, undefined)
      assert.notEqual(readPromise, undefined)
      return Promise.all([writePromise, readPromise]).then(([, read]) => ({
        label: options.label,
        expected,
        received: read.bytes,
        maximumReadBytes: read.maximumReadBytes,
      }))
    },
  }
}

function createLogicalEvents(count, streamTag) {
  const bytes = Buffer.allocUnsafe(count * LOGICAL_EVENT_BYTES)
  for (let index = 0; index < count; index += 1) {
    const offset = index * LOGICAL_EVENT_BYTES
    bytes.writeUInt8(streamTag, offset)
    bytes.writeUInt32BE(index, offset + 1)
  }
  return bytes
}

async function startStressFixture() {
  const root = await mkdtemp(join(tmpdir(), 'codetether-relay-stress-'))
  const store = new RelayStateStore(join(root, 'state'))
  const tls = await generateRelayPinnedTlsIdentity(store.identity)
  const service = new RelayService({
    stateStore: store,
    tls,
    host: '127.0.0.1',
    port: 0,
    managementPort: null,
    heartbeatIntervalMs: 100,
    heartbeatTimeoutMs: 1_000,
    logger: { log() {} },
  })
  await service.start()

  const common = {
    endpoint: { host: '127.0.0.1', port: service.listeningAddress.port },
    tls: {
      mode: 'pinned_certificate',
      certificatePublicKeyFingerprint: service.relayFingerprint,
    },
    expectedRelayIdentityFingerprint: service.relayFingerprint,
    clientBuildIdentity: 'relay-machine-channel-stress',
  }
  const controllerIdentity = generateRelayApplicationIdentity()
  const nodeIdentity = generateRelayApplicationIdentity()
  const node = await connectRelayControl({
    ...common,
    identity: { role: 'node', ...nodeIdentity },
    enrollmentToken: store.createEnrollmentToken('node'),
    authorizedControllerFingerprint: controllerIdentity.publicKeyFingerprint,
  })
  const controller = await connectRelayControl({
    ...common,
    identity: { role: 'controller', ...controllerIdentity },
    enrollmentToken: store.createEnrollmentToken('controller'),
  })

  const incoming = []
  const waiters = []
  const removeHandler = node.connection.setMachineChannelHandler(
    async (offer) => {
      const channel = await offer.accept()
      channel.on('error', () => undefined)
      const waiter = waiters.shift()
      if (waiter === undefined) incoming.push(channel)
      else waiter(channel)
    },
  )
  let closed = false
  return {
    service,
    controller,
    node,
    async openChannelPair() {
      const nodeChannel = nextIncoming(incoming, waiters)
      const controllerChannel = await controller.connection.openMachineChannel(
        nodeIdentity.publicKeyFingerprint,
      )
      controllerChannel.on('error', () => undefined)
      return { controller: controllerChannel, node: await nodeChannel }
    },
    async close() {
      if (closed) return
      closed = true
      removeHandler()
      await controller.connection.close().catch(() => undefined)
      await node.connection.close().catch(() => undefined)
      await service.close().catch(() => undefined)
      await rm(root, { recursive: true, force: true })
    },
  }
}

function nextIncoming(incoming, waiters) {
  if (incoming.length > 0) return Promise.resolve(incoming.shift())
  return new Promise((resolve) => waiters.push(resolve))
}

function writeAsync(stream, bytes) {
  return new Promise((resolve, reject) => {
    stream.write(bytes, (error) => {
      if (error === null || error === undefined) resolve()
      else reject(error)
    })
  })
}

async function writeBounded(stream, bytes) {
  for (
    let offset = 0;
    offset < bytes.length;
    offset += relayProtocolLimits.maximumChannelDataBytes
  ) {
    await writeAsync(
      stream,
      bytes.subarray(
        offset,
        Math.min(
          bytes.length,
          offset + relayProtocolLimits.maximumChannelDataBytes,
        ),
      ),
    )
  }
}

async function readExactlySlow(stream, expectedBytes, delayMs) {
  const chunks = []
  let receivedBytes = 0
  let maximumReadBytes = 0
  while (receivedBytes < expectedBytes) {
    const chunk = stream.read()
    if (chunk === null) {
      await waitForReadable(stream)
      continue
    }
    assert.equal(
      receivedBytes + chunk.length <= expectedBytes,
      true,
      'Machine channel crossed a logical stream boundary',
    )
    chunks.push(chunk)
    receivedBytes += chunk.length
    maximumReadBytes = Math.max(maximumReadBytes, chunk.length)
    await delay(delayMs)
  }
  return {
    bytes: Buffer.concat(chunks, receivedBytes),
    maximumReadBytes,
  }
}

function waitForReadable(stream) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      stream.off('readable', onReadable)
      stream.off('error', onError)
      stream.off('end', onEnd)
      stream.off('close', onClose)
    }
    const onReadable = () => {
      cleanup()
      resolve()
    }
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    const onEnd = () => {
      cleanup()
      reject(new Error('Machine channel ended before the payload arrived'))
    }
    const onClose = () => {
      cleanup()
      reject(new Error('Machine channel closed before the payload arrived'))
    }
    stream.once('readable', onReadable)
    stream.once('error', onError)
    stream.once('end', onEnd)
    stream.once('close', onClose)
  })
}

function waitForStreamEnd(stream) {
  if (stream.readableEnded) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      stream.off('end', onEnd)
      stream.off('error', onError)
    }
    const onEnd = () => {
      cleanup()
      resolve()
    }
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    stream.once('end', onEnd)
    stream.once('error', onError)
  })
}

async function waitFor(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for state')
    await delay(5)
  }
}

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import {
  createConnection as connectTcp,
  createServer as createTcpServer,
} from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

import {
  generateMachineTlsIdentity,
  machineProtocolVersion,
  newControllerId,
  openRemoteClaudeSessionOverStream,
  openRemoteCodexSessionOverStream,
} from '@codetether/machine-transport'
import { connectRelayControl } from '@codetether/relay-client'
import { relayPublicKeySpkiFromCertificate } from '@codetether/relay-protocol'

import {
  RelayService,
  RelayStateStore,
  generateRelayPinnedTlsIdentity,
} from '../../relay/dist/index.js'
import { CodeTetherNodeService } from '../dist/node-service.js'
import {
  RemoteProviderDetector,
  isRemoteCodexExecutionVersion,
} from '../dist/provider-discovery.js'
import { RemoteClaudeRunnerPool } from '../dist/remote-claude-runner.js'
import { RemoteCodexRunnerPool } from '../dist/remote-codex-runner.js'
import { NodeStateStore } from '../dist/state-store.js'

test('four relayed Provider Conversations stay isolated and preserve exact native resume', async () => {
  const temporary = await mkdtemp(
    join(tmpdir(), 'codetether-7b-provider-relay-'),
  )
  const project = await createCanonicalProject(temporary)
  const codex = createCodexHarness()
  const claude = createClaudeHarness()
  const codexRunners = new RemoteCodexRunnerPool({
    codexHome: join(temporary, 'codex-home'),
    clientFactory: codex.factory,
  })
  const claudeRunners = new RemoteClaudeRunnerPool({
    runtimeFactory: claude.factory,
  })
  const nodeState = await NodeStateStore.open({
    dataDirectory: join(temporary, 'node-state'),
    displayName: 'Phase 7B Provider Relay Machine',
    platform: 'Linux',
    architecture: 'x64',
  })
  const controller = {
    controllerId: newControllerId(),
    tls: await generateMachineTlsIdentity('Phase 7B Relay Controller'),
  }
  await nodeState.trustController({
    controllerId: controller.controllerId,
    publicKeyFingerprint: controller.tls.publicKeyFingerprint,
    pairedAt: new Date().toISOString(),
  })
  const nodeService = new CodeTetherNodeService({
    state: nodeState,
    bindAddress: '127.0.0.1',
    port: 0,
    providerDetector: executionDetector(),
    remoteCodexRunners: codexRunners,
    remoteClaudeRunners: claudeRunners,
  })
  const relayStore = new RelayStateStore(join(temporary, 'relay-state'))
  const relay = new RelayService({
    stateStore: relayStore,
    tls: await generateRelayPinnedTlsIdentity(relayStore.identity),
    host: '127.0.0.1',
    port: 0,
    managementPort: null,
    heartbeatIntervalMs: 250,
    heartbeatTimeoutMs: 2_000,
    logger: { log() {} },
  })

  let controllerRelay
  let nodeRelay
  let removeNodeHandler
  const channels = new Set()
  const sessions = new Set()
  const offers = []
  try {
    await mkdir(join(temporary, 'codex-home'))
    await relay.start()
    const common = {
      endpoint: { host: '127.0.0.1', port: relay.listeningAddress.port },
      tls: {
        mode: 'pinned_certificate',
        certificatePublicKeyFingerprint: relay.relayFingerprint,
      },
      expectedRelayIdentityFingerprint: relay.relayFingerprint,
      clientBuildIdentity: 'phase7b-composed-provider-relay-test',
    }
    nodeRelay = await connectRelayControl({
      ...common,
      identity: machineRelayIdentity('node', nodeState.identity),
      enrollmentToken: relayStore.createEnrollmentToken('node'),
      authorizedControllerFingerprint: controller.tls.publicKeyFingerprint,
    })
    controllerRelay = await connectRelayControl({
      ...common,
      identity: machineRelayIdentity('controller', controller.tls),
      enrollmentToken: relayStore.createEnrollmentToken('controller'),
    })
    removeNodeHandler = nodeRelay.connection.setMachineChannelHandler(
      async (offer) => {
        offers.push(offer)
        assert.equal(
          offer.controllerFingerprint,
          controller.tls.publicKeyFingerprint,
        )
        const channel = await offer.accept()
        channel.on('error', () => undefined)
        channels.add(channel)
        await nodeService.acceptRelayMachineChannel({
          stream: channel,
          controllerFingerprint: offer.controllerFingerprint,
        })
      },
    )

    const peer = relayOnlyPeer(nodeState, controller.controllerId)
    const cases = [
      {
        key: 'codex-a',
        provider: 'codex',
        conversationId: 'conv_phase7b_relay_codex_a',
        actionId: 'act_phase7b_relay_codex_a_01',
        turnId: 'turn_phase7b_relay_codex_a_01',
        prompt: 'Public deterministic Codex Relay fixture A.',
      },
      {
        key: 'codex-b',
        provider: 'codex',
        conversationId: 'conv_phase7b_relay_codex_b',
        actionId: 'act_phase7b_relay_codex_b_01',
        turnId: 'turn_phase7b_relay_codex_b_01',
        prompt: 'Public deterministic Codex Relay fixture B.',
      },
      {
        key: 'claude-a',
        provider: 'claude-code',
        conversationId: 'conv_phase7b_relay_claude_a',
        actionId: 'act_phase7b_relay_claude_a_01',
        turnId: 'turn_phase7b_relay_claude_a_01',
        prompt: 'Public deterministic Claude Relay fixture A.',
      },
      {
        key: 'claude-b',
        provider: 'claude-code',
        conversationId: 'conv_phase7b_relay_claude_b',
        actionId: 'act_phase7b_relay_claude_b_01',
        turnId: 'turn_phase7b_relay_claude_b_01',
        prompt: 'Public deterministic Claude Relay fixture B.',
      },
    ]
    const opened = await Promise.all(
      cases.map(async (scenario) => ({
        ...scenario,
        session: await openProviderSession({
          connection: controllerRelay.connection,
          nodeState,
          controller,
          peer,
          provider: scenario.provider,
          project,
          conversationId: scenario.conversationId,
        }),
      })),
    )
    for (const scenario of opened) {
      sessions.add(scenario.session)
      assert.equal(scenario.session.conversationId, scenario.conversationId)
    }
    assert.equal(
      new Set(opened.map((scenario) => scenario.conversationId)).size,
      4,
    )

    assert.equal(
      opened.every((scenario) => !scenario.session.resumed),
      true,
    )
    assert.equal(
      opened
        .filter((scenario) => scenario.provider === 'claude-code')
        .every((scenario) => scenario.session.effort === 'high'),
      true,
    )
    assert.equal(offers.length, 4)
    assert.equal(relay.metrics().activeChannels, 4)
    assert.deepEqual(
      codex.factoryCalls.map((call) => call.cwd),
      [project, project],
    )
    assert.deepEqual(
      claude.factoryCalls.map((call) => call.cwd),
      [project, project],
    )
    assert.equal(
      new Set(
        opened
          .filter((scenario) => scenario.provider === 'codex')
          .map((scenario) => scenario.session.providerThreadId),
      ).size,
      2,
    )
    assert.equal(
      new Set(
        opened
          .filter((scenario) => scenario.provider === 'claude-code')
          .map((scenario) => scenario.session.providerSessionId),
      ).size,
      2,
    )

    const running = await Promise.all(
      opened.map(async (scenario) => {
        let turn
        try {
          turn = await scenario.session.startTurn({
            actionId: scenario.actionId,
            turnId: scenario.turnId,
            prompt: scenario.prompt,
          })
        } catch (error) {
          throw new Error(
            `Relayed Turn start failed for ${scenario.key}; metrics=${JSON.stringify(relay.metrics())}`,
            { cause: error },
          )
        }
        assert.equal(turn.actionId, scenario.actionId)
        assert.equal(turn.turnId, scenario.turnId)
        const iterator = turn.events()
        const first = await iterator.next()
        assert.equal(first.done, false)
        return { ...scenario, iterator, first: first.value.event }
      }),
    )
    assert.equal(codex.starts.length, 2)
    assert.equal(claude.starts.length, 2)

    for (let index = 0; index < 2; index += 1) {
      codex.release(index)
      claude.release(index)
    }
    const completed = await Promise.all(
      running.map(async (scenario) => ({
        ...scenario,
        events: await collectRemaining(scenario.iterator, scenario.first),
      })),
    )
    for (const scenario of completed) {
      const providerStart =
        scenario.provider === 'codex'
          ? codex.starts.find(
              (start) => start.threadId === scenario.session.providerThreadId,
            )
          : claude.starts.find(
              (start) => start.sessionId === scenario.session.providerSessionId,
            )
      assert.ok(providerStart)
      assert.equal(providerStart.prompt, scenario.prompt)
      const providerIndex = providerStart.index + 1
      const providerLabel = scenario.provider === 'codex' ? 'CODEX' : 'CLAUDE'
      assert.equal(
        scenario.events
          .filter((event) => event.type === 'message.delta')
          .map((event) => event.text)
          .join(''),
        `${providerLabel}-${providerIndex}-RELAY-${providerIndex}`,
      )
      if (scenario.provider === 'codex') {
        assert.deepEqual(
          scenario.events.map((event) => event.type),
          [
            'message.delta',
            'message.delta',
            'message.completed',
            'turn.completed',
          ],
        )
        assert.equal(
          scenario.events.some((event) => event.type.startsWith('tool.')),
          false,
        )
      } else {
        assert.equal(providerStart.effort, 'high')
        assert.deepEqual(
          scenario.events.map((event) => event.type),
          [
            'message.delta',
            'message.delta',
            'tool.started',
            'tool.output',
            'tool.completed',
            'tool.started',
            'tool.completed',
            'message.completed',
            'turn.completed',
          ],
        )
        assert.deepEqual(
          scenario.events
            .filter((event) => event.type === 'tool.started')
            .map((event) => [event.kind, event.name, event.itemId]),
          [
            ['read', 'Read', `tool_phase7b_read_${providerIndex}`],
            ['search', 'Search', `tool_phase7b_search_${providerIndex}`],
          ],
        )
      }
      assert.equal(scenario.events.at(-1)?.type, 'turn.completed')
    }

    const codexScenario = opened.find((scenario) => scenario.key === 'codex-a')
    const claudeScenario = opened.find(
      (scenario) => scenario.key === 'claude-a',
    )
    assert.ok(codexScenario)
    assert.ok(claudeScenario)
    const codexProviderThreadId = codexScenario.session.providerThreadId
    const claudeProviderSessionId = claudeScenario.session.providerSessionId
    await Promise.all(
      opened.map(async (scenario) => {
        try {
          await scenario.session.close()
        } catch (error) {
          throw new Error(
            `Relayed session close failed for ${scenario.key}; claudeRuntimeCloses=${JSON.stringify(claude.closeCalls)}; claudeRunners=${claudeRunners.activeCount}; codexRunners=${codexRunners.activeCount}; metrics=${JSON.stringify(relay.metrics())}`,
            { cause: error },
          )
        }
      }),
    )
    assert.equal(codexRunners.activeCount, 0)
    assert.equal(claudeRunners.activeCount, 0)
    assert.equal(claude.closeCalls.length, 2)
    for (const scenario of opened) sessions.delete(scenario.session)
    // Let each normal Machine TLS shutdown and its final Relay data/ACK/close
    // frames settle before proving that the same authenticated control peers
    // can own fresh channels. A delayed terminal frame must remain scoped to
    // its old channel rather than poison the shared Relay control connection.
    await delay(50)
    await waitFor(() => {
      const metrics = relay.metrics()
      return (
        metrics.activeChannels === 0 &&
        metrics.openingChannels === 0 &&
        metrics.pendingChannelDataFrames === 0 &&
        metrics.pendingChannelDataBytes === 0
      )
    })

    const [resumedCodex, resumedClaude] = await Promise.all([
      openProviderSession({
        connection: controllerRelay.connection,
        nodeState,
        controller,
        peer,
        provider: 'codex',
        project,
        conversationId: codexScenario.conversationId,
        providerIdentity: codexProviderThreadId,
      }),
      openProviderSession({
        connection: controllerRelay.connection,
        nodeState,
        controller,
        peer,
        provider: 'claude-code',
        project,
        conversationId: claudeScenario.conversationId,
        providerIdentity: claudeProviderSessionId,
      }),
    ])
    sessions.add(resumedCodex)
    sessions.add(resumedClaude)
    assert.equal(resumedCodex.resumed, true)
    assert.equal(resumedClaude.resumed, true)
    assert.equal(resumedCodex.providerThreadId, codexProviderThreadId)
    assert.equal(resumedClaude.providerSessionId, claudeProviderSessionId)
    assert.equal(codex.factoryCalls[2].resumeThreadId, codexProviderThreadId)
    assert.deepEqual(claude.factoryCalls[2], {
      cwd: project,
      providerSessionId: claudeProviderSessionId,
      resume: true,
    })
    assert.equal(offers.length, 6)
    assert.equal(peer.endpoint.port, 0)
    await Promise.all([resumedCodex.close(), resumedClaude.close()])
    sessions.delete(resumedCodex)
    sessions.delete(resumedClaude)
    await waitFor(() => {
      const metrics = relay.metrics()
      return (
        metrics.activeChannels === 0 &&
        metrics.openingChannels === 0 &&
        metrics.pendingChannelDataFrames === 0 &&
        metrics.pendingChannelDataBytes === 0
      )
    })
  } finally {
    for (const session of sessions) {
      await session.close().catch(() => undefined)
    }
    removeNodeHandler?.()
    for (const channel of channels) channel.destroy()
    await controllerRelay?.connection.close().catch(() => undefined)
    await nodeRelay?.connection.close().catch(() => undefined)
    await nodeService.close().catch(() => undefined)
    await relay.close().catch(() => undefined)
    await rm(temporary, { recursive: true, force: true })
  }
})

test('Relay loss after Node Provider ownership but before the start ACK remains uncertain without replay', async () => {
  const temporary = await mkdtemp(
    join(tmpdir(), 'codetether-7b-relay-ownership-ack-loss-'),
  )
  const project = await createCanonicalProject(temporary)
  const codex = createOwnershipAckLossCodexHarness()
  const claude = createClaudeHarness()
  const codexRunners = new RemoteCodexRunnerPool({
    codexHome: join(temporary, 'codex-home'),
    clientFactory: codex.factory,
  })
  const claudeRunners = new RemoteClaudeRunnerPool({
    runtimeFactory: claude.factory,
  })
  const nodeState = await NodeStateStore.open({
    dataDirectory: join(temporary, 'node-state'),
    displayName: 'Phase 7B ownership acknowledgement loss Machine',
    platform: 'Linux',
    architecture: 'x64',
  })
  const controller = {
    controllerId: newControllerId(),
    tls: await generateMachineTlsIdentity(
      'Phase 7B ownership acknowledgement loss Controller',
    ),
  }
  await nodeState.trustController({
    controllerId: controller.controllerId,
    publicKeyFingerprint: controller.tls.publicKeyFingerprint,
    pairedAt: new Date().toISOString(),
  })
  const nodeService = new CodeTetherNodeService({
    state: nodeState,
    bindAddress: '127.0.0.1',
    port: 0,
    providerDetector: executionDetector(),
    remoteCodexRunners: codexRunners,
    remoteClaudeRunners: claudeRunners,
  })
  const relayStore = new RelayStateStore(join(temporary, 'relay-state'))
  const relay = new RelayService({
    stateStore: relayStore,
    tls: await generateRelayPinnedTlsIdentity(relayStore.identity),
    host: '127.0.0.1',
    port: 0,
    managementPort: null,
    heartbeatIntervalMs: 10_000,
    heartbeatTimeoutMs: 20_000,
    logger: { log() {} },
  })

  let gate
  let controllerRelay
  let nodeRelay
  let removeNodeHandler
  let session
  const channels = new Set()
  try {
    await mkdir(join(temporary, 'codex-home'))
    await relay.start()
    gate = await startRelayDownstreamGate(relay.listeningAddress.port)
    const common = {
      tls: {
        mode: 'pinned_certificate',
        certificatePublicKeyFingerprint: relay.relayFingerprint,
      },
      expectedRelayIdentityFingerprint: relay.relayFingerprint,
      clientBuildIdentity: 'phase7b-ownership-ack-loss-test',
    }
    nodeRelay = await connectRelayControl({
      ...common,
      endpoint: { host: '127.0.0.1', port: relay.listeningAddress.port },
      identity: machineRelayIdentity('node', nodeState.identity),
      enrollmentToken: relayStore.createEnrollmentToken('node'),
      authorizedControllerFingerprint: controller.tls.publicKeyFingerprint,
    })
    controllerRelay = await connectRelayControl({
      ...common,
      endpoint: gate.endpoint,
      identity: machineRelayIdentity('controller', controller.tls),
      enrollmentToken: relayStore.createEnrollmentToken('controller'),
    })
    removeNodeHandler = nodeRelay.connection.setMachineChannelHandler(
      async (offer) => {
        assert.equal(
          offer.controllerFingerprint,
          controller.tls.publicKeyFingerprint,
        )
        const channel = await offer.accept()
        channel.on('error', () => undefined)
        channels.add(channel)
        await nodeService.acceptRelayMachineChannel({
          stream: channel,
          controllerFingerprint: offer.controllerFingerprint,
        })
      },
    )

    session = await openProviderSession({
      connection: controllerRelay.connection,
      nodeState,
      controller,
      peer: relayOnlyPeer(nodeState, controller.controllerId),
      provider: 'codex',
      project,
      conversationId: 'conv_phase7b_relay_ownership_ack_loss',
    })
    const startInput = {
      actionId: 'act_phase7b_relay_lost_ownership_ack_01',
      turnId: 'turn_phase7b_relay_lost_ownership_ack_01',
      prompt: 'Public deterministic ownership acknowledgement fixture.',
    }
    const started = session.startTurn(startInput)
    void started.catch(() => undefined)

    await codex.providerAccepted.promise
    gate.blockRelayToController()
    const bytesBeforeOwnershipAck = relay.metrics().nodeToRelayChannelBytes
    codex.allowOwnershipReturn.resolve()
    // This fixture emits no Provider event and the execution heartbeat cannot
    // start before the Controller receives codex.turn.started. Therefore the
    // first new Node-to-Relay channel bytes are the encrypted Machine ownership
    // acknowledgement, while the downstream gate proves it never reached the
    // Controller.
    await waitFor(
      () => relay.metrics().nodeToRelayChannelBytes > bytesBeforeOwnershipAck,
    )
    await waitFor(() => gate.droppedRelayToControllerBytes > 0)
    const channelOpenRequests = relay.metrics().channelOpenRequests
    assert.equal(channelOpenRequests, 1)
    assert.equal(channels.size, 1)

    await relay.close()
    await assert.rejects(
      started,
      (error) =>
        error?.code === 'remote_execution_lost' &&
        error?.peerAuthenticated === true &&
        error?.failureReason === 'execution_ownership_uncertain',
    )
    assert.equal(session.closed, true)
    await waitFor(() => codexRunners.activeCount === 0)
    await waitFor(() => codex.shutdowns === 1)
    await delay(100)

    assert.equal(codex.starts.length, 1)
    assert.deepEqual(codex.starts[0], {
      threadId: session.providerThreadId,
      prompt: startInput.prompt,
      providerTurnId: 'provider-turn-phase7b-ownership-ack-loss-1',
    })
    assert.equal(relay.metrics().channelOpenRequests, channelOpenRequests)
    assert.equal(relay.metrics().activeChannels, 0)
    assert.equal(relay.metrics().pendingChannelDataFrames, 0)
    assert.equal(relay.metrics().pendingChannelDataBytes, 0)
  } finally {
    codex.allowOwnershipReturn.resolve()
    await session?.close().catch(() => undefined)
    removeNodeHandler?.()
    for (const channel of channels) channel.destroy()
    await controllerRelay?.connection.close().catch(() => undefined)
    await nodeRelay?.connection.close().catch(() => undefined)
    await relay.close().catch(() => undefined)
    await nodeService.close().catch(() => undefined)
    await gate?.close().catch(() => undefined)
    await rm(temporary, { recursive: true, force: true })
  }
})

async function createCanonicalProject(temporary) {
  const project = join(temporary, 'project')
  await mkdir(project)
  return await realpath(project)
}

function executionDetector() {
  return new RemoteProviderDetector({
    platform: 'linux',
    claudeExecutionProbe: async () => ({
      available: true,
      version: '2.1.251',
    }),
    probes: [
      {
        provider: 'codex',
        displayName: 'Codex',
        executable: process.execPath,
        arguments: ['-e', "process.stdout.write('codex-cli 0.149.1')"],
        parseVersion: (output) => /^codex-cli (\S+)$/u.exec(output)?.[1],
        isSupportedVersion: isRemoteCodexExecutionVersion,
      },
      {
        provider: 'claude-code',
        displayName: 'Claude Code',
        executable: process.execPath,
        arguments: ['-e', "process.stdout.write('2.1.251 (Claude Code)')"],
        parseVersion: (output) => /^(\S+) \(Claude Code\)$/u.exec(output)?.[1],
        isSupportedVersion: (version) => version === '2.1.251',
      },
    ],
  })
}

async function openProviderSession(options) {
  let channel
  try {
    channel = await options.connection.openMachineChannel(
      options.nodeState.identity.publicKeyFingerprint,
    )
  } catch (error) {
    throw new Error(`Relay channel open failed for ${options.provider}`, {
      cause: error,
    })
  }
  channel.on('error', () => undefined)
  const base = {
    stream: channel,
    peer: options.peer,
    controller: options.controller,
    projectId: 'proj_phase7b_provider_relay',
    rootPath: options.project,
  }
  try {
    if (options.provider === 'codex') {
      return await openRemoteCodexSessionOverStream({
        ...base,
        conversationId: options.conversationId,
        ...(options.providerIdentity === undefined
          ? {}
          : { providerThreadId: options.providerIdentity }),
      })
    }
    return await openRemoteClaudeSessionOverStream({
      ...base,
      conversationId: options.conversationId,
      effort: 'high',
      ...(options.providerIdentity === undefined
        ? {}
        : {
            providerSessionId: options.providerIdentity,
            providerSessionMaterialized: true,
          }),
    })
  } catch (error) {
    throw new Error(`Machine session open failed for ${options.provider}`, {
      cause: error,
    })
  }
}

function relayOnlyPeer(state, controllerId) {
  return {
    machine: state.machine,
    endpoint: { host: '127.0.0.1', port: 0 },
    nodeFingerprint: state.identity.publicKeyFingerprint,
    protocolVersion: machineProtocolVersion,
    controllerId,
  }
}

function machineRelayIdentity(role, identity) {
  return {
    role,
    privateKeyPem: identity.privateKeyPem,
    publicKeySpki: relayPublicKeySpkiFromCertificate(identity.certificatePem),
    publicKeyFingerprint: identity.publicKeyFingerprint,
  }
}

function createCodexHarness() {
  const factoryCalls = []
  const starts = []
  const releases = []
  return {
    factoryCalls,
    starts,
    release(index) {
      releases[index].resolve()
    },
    factory: async (callbacks) => {
      const factoryIndex = factoryCalls.length
      const call = { cwd: undefined, resumeThreadId: undefined }
      factoryCalls.push(call)
      return {
        startRemoteTextThread: async ({ cwd }) => {
          call.cwd = cwd
          return {
            thread: {
              id: `provider-thread-phase7b-relay-${factoryIndex + 1}`,
              cwd,
            },
          }
        },
        resumeRemoteTextThread: async ({ threadId, cwd }) => {
          call.cwd = cwd
          call.resumeThreadId = threadId
          return { thread: { id: threadId, cwd } }
        },
        startRemoteTextTurn: async ({ threadId, prompt }) => {
          const index = starts.length
          const providerTurnId = `provider-turn-phase7b-codex-${index + 1}`
          const release = deferred()
          releases.push(release)
          starts.push({ index, threadId, prompt, providerTurnId })
          callbacks.onEvent(
            codexEvent('turn.started', threadId, providerTurnId),
          )
          queueMicrotask(() => {
            void (async () => {
              callbacks.onEvent(
                codexEvent('message.delta', threadId, providerTurnId, {
                  itemId: `message_phase7b_codex_${index + 1}`,
                  delta: `CODEX-${index + 1}-`,
                }),
              )
              await release.promise
              callbacks.onEvent(
                codexEvent('message.delta', threadId, providerTurnId, {
                  itemId: `message_phase7b_codex_${index + 1}`,
                  delta: `RELAY-${index + 1}`,
                }),
              )
              callbacks.onEvent(
                codexEvent('message.completed', threadId, providerTurnId, {
                  itemId: `message_phase7b_codex_${index + 1}`,
                  message: `CODEX-${index + 1}-RELAY-${index + 1}`,
                }),
              )
              callbacks.onEvent(
                codexEvent('turn.completed', threadId, providerTurnId),
              )
            })()
          })
          return { turn: { id: providerTurnId, status: 'inProgress' } }
        },
        waitForTurn: async () => ({}),
        shutdown: async () => undefined,
      }
    },
  }
}

function createOwnershipAckLossCodexHarness() {
  const starts = []
  const providerAccepted = deferred()
  const allowOwnershipReturn = deferred()
  let shutdowns = 0
  return {
    starts,
    providerAccepted,
    allowOwnershipReturn,
    get shutdowns() {
      return shutdowns
    },
    factory: async () => {
      const lifetime = deferred()
      return {
        startRemoteTextThread: async ({ cwd }) => ({
          thread: { id: 'provider-thread-phase7b-ownership-ack-loss', cwd },
        }),
        resumeRemoteTextThread: async ({ threadId, cwd }) => ({
          thread: { id: threadId, cwd },
        }),
        startRemoteTextTurn: async ({ threadId, prompt }) => {
          const providerTurnId = `provider-turn-phase7b-ownership-ack-loss-${starts.length + 1}`
          starts.push({ threadId, prompt, providerTurnId })
          providerAccepted.resolve()
          await allowOwnershipReturn.promise
          return { turn: { id: providerTurnId, status: 'inProgress' } }
        },
        waitForTurn: async () => await lifetime.promise,
        shutdown: async () => {
          shutdowns += 1
          lifetime.resolve()
        },
      }
    },
  }
}

function codexEvent(type, threadId, turnId, fields = {}) {
  return {
    type,
    provider: 'codex',
    timestamp: new Date().toISOString(),
    threadId,
    turnId,
    ...fields,
  }
}

function createClaudeHarness() {
  const factoryCalls = []
  const starts = []
  const releases = []
  const closeCalls = []
  return {
    factoryCalls,
    starts,
    closeCalls,
    release(index) {
      releases[index].resolve()
    },
    factory: async (options) => {
      const factoryIndex = factoryCalls.length
      factoryCalls.push({ ...options })
      let listener = () => undefined
      const runtime = {
        sessionId:
          options.providerSessionId ??
          `7b000000-0000-4000-8000-${String(factoryIndex + 1).padStart(12, '0')}`,
        cwd: options.cwd,
        subscribeEvents(next) {
          listener = next
          return () => {
            listener = () => undefined
          }
        },
        startTurn(turn) {
          const index = starts.length
          const release = deferred()
          const completion = deferred()
          releases.push(release)
          starts.push({ ...turn, index, sessionId: runtime.sessionId })
          const base = {
            provider: 'claude-code',
            timestamp: new Date().toISOString(),
            threadId: runtime.sessionId,
            turnId: turn.turnId,
          }
          queueMicrotask(() => {
            void (async () => {
              listener({
                type: 'conversation.started',
                provider: 'claude-code',
                timestamp: base.timestamp,
                threadId: runtime.sessionId,
                cwd: options.cwd,
              })
              listener({ type: 'turn.started', ...base })
              listener({
                type: 'message.delta',
                ...base,
                itemId: `message_phase7b_claude_${index + 1}`,
                delta: `CLAUDE-${index + 1}-`,
              })
              await release.promise
              listener({
                type: 'message.delta',
                ...base,
                itemId: `message_phase7b_claude_${index + 1}`,
                delta: `RELAY-${index + 1}`,
              })
              emitClaudeTool(listener, base, 'read', 'Read', index)
              emitClaudeTool(listener, base, 'search', 'Search', index)
              listener({
                type: 'message.completed',
                ...base,
                itemId: `message_phase7b_claude_${index + 1}`,
                message: `CLAUDE-${index + 1}-RELAY-${index + 1}`,
              })
              listener({ type: 'turn.completed', ...base })
              completion.resolve({
                sessionId: runtime.sessionId,
                turnId: turn.turnId,
                finalMessage: `CLAUDE-${index + 1}-RELAY-${index + 1}`,
              })
            })()
          })
          return completion.promise
        },
        async close() {
          closeCalls.push(runtime.sessionId)
        },
      }
      return runtime
    },
  }
}

function emitClaudeTool(listener, base, kind, name, index) {
  const itemId = `tool_phase7b_${kind}_${index + 1}`
  const command = `${name} deterministic fixture`
  listener({
    type: 'tool.started',
    ...base,
    itemId,
    kind,
    name,
    command,
    summary: command,
  })
  if (kind === 'read') {
    listener({
      type: 'tool.output',
      ...base,
      itemId,
      output: 'bounded deterministic fixture',
      stream: 'combined',
    })
  }
  listener({
    type: 'tool.completed',
    ...base,
    itemId,
    kind,
    name,
    command,
    success: true,
    summary: command,
  })
}

async function collectRemaining(iterator, first) {
  const events = [first]
  while (true) {
    const next = await iterator.next()
    if (next.done) return events
    events.push(next.value.event)
  }
}

async function startRelayDownstreamGate(targetPort) {
  const sockets = new Set()
  let relayToControllerBlocked = false
  let droppedRelayToControllerBytes = 0
  const server = createTcpServer((controllerSocket) => {
    const relaySocket = connectTcp({ host: '127.0.0.1', port: targetPort })
    sockets.add(controllerSocket)
    sockets.add(relaySocket)
    controllerSocket.pipe(relaySocket)
    relaySocket.on('data', (chunk) => {
      if (relayToControllerBlocked) {
        droppedRelayToControllerBytes += chunk.length
        return
      }
      if (!controllerSocket.write(chunk)) relaySocket.pause()
    })
    controllerSocket.on('drain', () => relaySocket.resume())
    controllerSocket.on('close', () => {
      sockets.delete(controllerSocket)
      relaySocket.destroy()
    })
    relaySocket.on('close', () => {
      sockets.delete(relaySocket)
      controllerSocket.destroy()
    })
    controllerSocket.on('error', () => relaySocket.destroy())
    relaySocket.on('error', () => controllerSocket.destroy())
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, resolve)
  })
  const address = server.address()
  assert.notEqual(address, null)
  assert.equal(typeof address, 'object')
  return {
    endpoint: { host: '127.0.0.1', port: address.port },
    blockRelayToController() {
      relayToControllerBlocked = true
    },
    get droppedRelayToControllerBytes() {
      return droppedRelayToControllerBytes
    },
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for state')
    await delay(5)
  }
}

function deferred() {
  let resolve
  const promise = new Promise((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

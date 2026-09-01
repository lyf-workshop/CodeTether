import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  MachineTransportError,
  deleteMachineTlsIdentityFile,
  generateMachineTlsIdentity,
} from '@codetether/machine-transport'

import {
  RemoteMachineRevocationPendingError,
  SecureRemoteMachineCoordinator,
} from '../dist/api/remote-machine-coordinator.js'
import { ConversationStore } from '../dist/persistence/index.js'

async function fixture(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-host-remote-'))
  const store = ConversationStore.open({
    databasePath: join(directory, 'codetether.sqlite3'),
  })
  const nodeIdentity = await generateMachineTlsIdentity('CodeTether Node')
  const machine = {
    machineId: 'machine_remote_fixture',
    nodeId: 'node_remote_fixture',
    displayName: 'Remote fixture',
    platform: 'Linux',
    architecture: 'x64',
  }
  let beginCalls = 0
  let connectCalls = 0
  let revokeCalls = 0
  let validateCalls = 0
  let discoveryCalls = 0
  let openCodexCalls = 0
  let openClaudeCalls = 0
  let activeDiscoveries = 0
  let maximumActiveDiscoveries = 0
  let activeValidations = 0
  let maximumActiveValidations = 0
  const attemptedEndpoints = []
  const connections = []
  const transport = {
    async beginPairing(input) {
      beginCalls += 1
      if (options.beginError !== undefined) throw options.beginError
      const trustCandidate = {
        machine,
        endpoint: input.endpoint,
        nodeFingerprint: nodeIdentity.publicKeyFingerprint,
        nodeCertificatePem: nodeIdentity.certificatePem,
        protocolVersion: 1,
        controllerId: input.controller.controllerId,
      }
      return {
        pairingAttemptId:
          options.pairingAttemptId ?? `pairing_fixture_${beginCalls}`,
        machine,
        endpoint: input.endpoint,
        expiresAt: new Date(Date.now() + 60_000),
        verificationCode: '123456',
        trustCandidate,
        async confirm() {
          if (options.confirmError !== undefined) throw options.confirmError
          return trustCandidate
        },
        async cancel() {},
      }
    },
    async connectTrusted(input) {
      connectCalls += 1
      attemptedEndpoints.push(input.peer.endpoint)
      if (options.connectError !== undefined) throw options.connectError
      if (options.connectHandler !== undefined) {
        await options.connectHandler(input)
      }
      assert.equal(
        input.peer.nodeFingerprint,
        nodeIdentity.publicKeyFingerprint,
      )
      assert.equal(
        input.controller.tls.publicKeyFingerprint,
        input.peer.controllerId === input.controller.controllerId
          ? input.controller.tls.publicKeyFingerprint
          : 'mismatch',
      )
      const connection = {
        async ping() {},
        async revoke() {
          revokeCalls += 1
          if (options.revokeError !== undefined) {
            if (options.connectErrorAfterRevoke !== undefined) {
              options.connectError = options.connectErrorAfterRevoke
            }
            throw options.revokeError
          }
        },
        async validateProjectLocation(rootPath) {
          validateCalls += 1
          activeValidations += 1
          maximumActiveValidations = Math.max(
            maximumActiveValidations,
            activeValidations,
          )
          try {
            if (options.validationError !== undefined) {
              throw options.validationError
            }
            if (options.validationHandler !== undefined) {
              return await options.validationHandler(rootPath)
            }
            return {
              canonicalPath: rootPath,
              basename: 'project',
              exists: true,
              directory: true,
            }
          } finally {
            activeValidations -= 1
          }
        },
        ...(options.discoveryEnabled === true
          ? {
              async discoverProviders(signal) {
                discoveryCalls += 1
                activeDiscoveries += 1
                maximumActiveDiscoveries = Math.max(
                  maximumActiveDiscoveries,
                  activeDiscoveries,
                )
                try {
                  if (options.discoveryError !== undefined) {
                    throw options.discoveryError
                  }
                  if (options.discoveryHandler !== undefined) {
                    return await options.discoveryHandler(signal)
                  }
                  return remoteProviderDiscovery()
                } finally {
                  activeDiscoveries -= 1
                }
              },
            }
          : {}),
        close() {},
      }
      connections.push(connection)
      return connection
    },
    ...(options.executionEnabled === true
      ? {
          async openCodexSession(input) {
            openCodexCalls += 1
            if (options.openCodexError !== undefined) {
              throw options.openCodexError
            }
            const providerThreadId =
              input.providerThreadId ?? 'thread_remote_fixture'
            return {
              machine,
              conversationId: input.conversationId,
              providerThreadId,
              resumed: input.providerThreadId !== undefined,
              executionProfile: 'codex-text-v1',
              async startTurn() {
                throw new Error(
                  'Turn execution is outside this coordinator test',
                )
              },
              async close() {},
            }
          },
        }
      : {}),
    ...(options.claudeExecutionEnabled === true
      ? {
          async openClaudeSession(input) {
            openClaudeCalls += 1
            if (options.openClaudeError !== undefined) {
              throw options.openClaudeError
            }
            const providerSessionId =
              input.providerSessionId ?? '123e4567-e89b-42d3-a456-426614174000'
            return {
              machine,
              conversationId: input.conversationId,
              providerSessionId,
              resumed:
                input.providerSessionId !== undefined &&
                input.providerSessionMaterialized === true,
              effort: input.effort,
              executionProfile: 'claude-restricted-read-search-v1',
              async startTurn() {
                throw new Error(
                  'Turn execution is outside this coordinator test',
                )
              },
              async close() {},
            }
          },
        }
      : {}),
  }
  return {
    directory,
    store,
    transport,
    machine,
    counts: {
      get begin() {
        return beginCalls
      },
      get connect() {
        return connectCalls
      },
      get revoke() {
        return revokeCalls
      },
      get validate() {
        return validateCalls
      },
      get maximumActiveValidations() {
        return maximumActiveValidations
      },
      get discovery() {
        return discoveryCalls
      },
      get openCodex() {
        return openCodexCalls
      },
      get openClaude() {
        return openClaudeCalls
      },
      get maximumActiveDiscoveries() {
        return maximumActiveDiscoveries
      },
      get activeDiscoveries() {
        return activeDiscoveries
      },
    },
    attemptedEndpoints,
    async close(coordinator) {
      await coordinator?.close().catch(() => undefined)
      store.close()
      await rm(directory, { recursive: true, force: true })
    },
  }
}

function remoteProviderDiscovery(
  executionEnabled = false,
  claudeExecutionEnabled = false,
) {
  const capabilities = {
    streaming: executionEnabled,
    resume: executionEnabled,
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
  return {
    providers: [
      {
        provider: 'codex',
        displayName: 'Codex',
        availability: 'available',
        version: '1.2.3',
        capabilities,
      },
      {
        provider: 'claude-code',
        displayName: 'Claude Code',
        availability: claudeExecutionEnabled ? 'available' : 'not_installed',
        capabilities: {
          ...Object.fromEntries(
            Object.keys(capabilities).map((capability) => [capability, false]),
          ),
          streaming: claudeExecutionEnabled,
          resume: claudeExecutionEnabled,
          fileRead: claudeExecutionEnabled,
          search: claudeExecutionEnabled,
          toolEvents: claudeExecutionEnabled,
          reasoningControl: claudeExecutionEnabled,
        },
        ...(claudeExecutionEnabled
          ? {
              reasoningLabel: '思考强度',
              reasoningOptions: [
                ['low', '低'],
                ['medium', '中'],
                ['high', '高'],
                ['xhigh', '超高'],
                ['max', '最大'],
              ].map(([id, label]) => ({ id, label })),
            }
          : {}),
      },
    ],
    observedAt: '2026-08-31T12:00:00.000Z',
  }
}

test('current Codex discovery survives authenticated Location validation and admits the exact session open', async () => {
  const f = await fixture({
    discoveryEnabled: true,
    executionEnabled: true,
    async discoveryHandler() {
      return remoteProviderDiscovery(true)
    },
  })
  let coordinator
  try {
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
      heartbeatIntervalMs: 1_000,
      reconnectMaximumDelayMs: 20,
    })
    const candidate = await coordinator.beginPairing({
      address: { host: '172.20.1.30', port: 4319 },
      pairingCode: '123456',
    })
    const confirmed = await coordinator.confirmPairing(
      candidate.pairingAttemptId,
      (staged) =>
        f.store.createRemoteMachineWithTrust(staged.machine, staged.trust),
    )
    await waitFor(() => f.counts.discovery >= 1, 'execution discovery')
    const initialMachine = f.store.getMachine(confirmed.machine.machineId)
    const initialTrust = f.store.getTrustedMachinePeer(
      confirmed.machine.machineId,
    )
    assert.ok(initialMachine)
    assert.ok(initialTrust)
    if (
      f.store.getRemoteProviderObservation(confirmed.machine.machineId) ===
      undefined
    ) {
      await coordinator.discoverProviders(initialMachine, initialTrust)
    }
    assert.equal(
      coordinator.providerExecutionAvailable(confirmed.machine.machineId),
      true,
      JSON.stringify({
        state: coordinator.connectionState(confirmed.machine.machineId),
        observation: f.store.getRemoteProviderObservation(
          confirmed.machine.machineId,
        ),
        opens: f.counts.openCodex,
      }),
    )
    const validationStates = []
    const unsubscribe = coordinator.subscribeStatus((_machineId, state) => {
      validationStates.push(state)
    })
    const machine = f.store.getMachine(confirmed.machine.machineId)
    const trust = f.store.getTrustedMachinePeer(confirmed.machine.machineId)
    assert.ok(machine)
    assert.ok(trust)
    const discoveryBeforeValidation = f.counts.discovery

    const validated = await coordinator.validateProjectLocation(
      machine,
      trust,
      '/srv/projects/workspace',
    )
    assert.equal(validated.canonicalPath, '/srv/projects/workspace')
    assert.ok(f.counts.discovery > discoveryBeforeValidation)
    assert.equal(
      coordinator.providerExecutionAvailable(machine.machineId),
      true,
    )
    assert.equal(validationStates.includes('connecting'), false)

    const session = await coordinator.openCodexSession(machine, trust, {
      conversationId: 'conv_remote_coordinator',
      projectId: 'proj_remote_coordinator',
      rootPath: validated.canonicalPath,
    })
    assert.equal(session.machineId, machine.machineId)
    assert.equal(session.conversationId, 'conv_remote_coordinator')
    assert.equal(session.providerThreadId, 'thread_remote_fixture')
    assert.equal(f.counts.openCodex, 1)
    await session.close()
    unsubscribe()
  } finally {
    await f.close(coordinator)
  }
})

test('current Claude discovery admits only the restricted effort-bound session and exact native resume', async () => {
  const f = await fixture({
    discoveryEnabled: true,
    claudeExecutionEnabled: true,
    async discoveryHandler() {
      return remoteProviderDiscovery(false, true)
    },
  })
  let coordinator
  try {
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
      heartbeatIntervalMs: 1_000,
      reconnectMaximumDelayMs: 20,
    })
    const candidate = await coordinator.beginPairing({
      address: { host: '172.20.1.31', port: 4319 },
      pairingCode: '123456',
    })
    const confirmed = await coordinator.confirmPairing(
      candidate.pairingAttemptId,
      (staged) =>
        f.store.createRemoteMachineWithTrust(staged.machine, staged.trust),
    )
    await waitFor(() => f.counts.discovery >= 1, 'Claude execution discovery')
    const machine = f.store.getMachine(confirmed.machine.machineId)
    const trust = f.store.getTrustedMachinePeer(confirmed.machine.machineId)
    assert.ok(machine)
    assert.ok(trust)
    if (
      f.store.getRemoteProviderObservation(confirmed.machine.machineId) ===
      undefined
    ) {
      await coordinator.discoverProviders(machine, trust)
    }

    assert.equal(
      coordinator.providerExecutionAvailable(machine.machineId, 'codex'),
      false,
    )
    assert.equal(
      coordinator.providerExecutionAvailable(machine.machineId, 'claude-code'),
      true,
    )
    assert.equal(
      coordinator.providerExecutionAvailable(machine.machineId),
      true,
    )

    await assert.rejects(
      coordinator.openCodexSession(machine, trust, {
        conversationId: 'conv_remote_codex_rejected',
        projectId: 'proj_remote_claude_coordinator',
        rootPath: '/srv/projects/workspace',
      }),
      (error) => error.code === 'remote_execution_unavailable',
    )
    assert.equal(f.counts.openCodex, 0)

    const created = await coordinator.openClaudeSession(machine, trust, {
      conversationId: 'conv_remote_claude_coordinator',
      projectId: 'proj_remote_claude_coordinator',
      rootPath: '/srv/projects/workspace',
      effort: 'high',
    })
    assert.equal(created.machineId, machine.machineId)
    assert.equal(created.conversationId, 'conv_remote_claude_coordinator')
    assert.equal(
      created.providerSessionId,
      '123e4567-e89b-42d3-a456-426614174000',
    )
    assert.equal(created.effort, 'high')
    await created.close()

    const resumed = await coordinator.openClaudeSession(machine, trust, {
      conversationId: 'conv_remote_claude_coordinator',
      projectId: 'proj_remote_claude_coordinator',
      rootPath: '/srv/projects/workspace',
      providerSessionId: created.providerSessionId,
      providerSessionMaterialized: true,
      effort: 'high',
    })
    assert.equal(resumed.providerSessionId, created.providerSessionId)
    assert.equal(f.counts.openClaude, 2)
    await resumed.close()

    await assert.rejects(
      coordinator.openClaudeSession(machine, trust, {
        conversationId: 'conv_remote_claude_coordinator',
        projectId: 'proj_remote_claude_coordinator',
        rootPath: '/srv/projects/workspace',
        providerSessionId: created.providerSessionId,
        effort: 'high',
      }),
      (error) => error.code === 'remote_policy_violation',
    )
    assert.equal(f.counts.openClaude, 2)
  } finally {
    await f.close(coordinator)
  }
})

test('serializes purpose-specific ProjectLocation validation and keeps pinned trust healthy on path errors', async () => {
  let releaseFirstValidation
  const firstValidationGate = new Promise((resolve) => {
    releaseFirstValidation = resolve
  })
  let gateFirstValidation = true
  const options = {
    async validationHandler(rootPath) {
      if (gateFirstValidation) {
        gateFirstValidation = false
        await firstValidationGate
      }
      return {
        canonicalPath: rootPath,
        basename: 'workspace',
        exists: true,
        directory: true,
      }
    },
  }
  const f = await fixture(options)
  let coordinator
  try {
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
      heartbeatIntervalMs: 1_000,
      reconnectMaximumDelayMs: 20,
    })
    const candidate = await coordinator.beginPairing({
      address: { host: '172.20.1.30', port: 4319 },
      pairingCode: '123456',
    })
    const confirmed = await coordinator.confirmPairing(
      candidate.pairingAttemptId,
      (staged) =>
        f.store.createRemoteMachineWithTrust(staged.machine, staged.trust),
    )
    f.store.activateTrustedMachinePeer(
      confirmed.machine.machineId,
      new Date().toISOString(),
    )
    await waitFor(
      () =>
        coordinator.connectionState(confirmed.machine.machineId) === 'online',
      'trusted worker connection',
    )
    const machine = f.store.getMachine(confirmed.machine.machineId)
    const trust = f.store.getTrustedMachinePeer(confirmed.machine.machineId)
    assert.ok(machine)
    assert.ok(trust)

    const first = coordinator.validateProjectLocation(
      machine,
      trust,
      '/srv/projects/workspace',
    )
    await waitFor(() => f.counts.validate === 1, 'first validation')
    const second = coordinator.validateProjectLocation(
      machine,
      trust,
      '/srv/projects/workspace-two',
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(f.counts.validate, 1)
    assert.equal(f.counts.maximumActiveValidations, 1)
    releaseFirstValidation()
    assert.equal((await first).canonicalPath, '/srv/projects/workspace')
    assert.equal((await second).canonicalPath, '/srv/projects/workspace-two')
    assert.equal(f.counts.validate, 2)
    assert.equal(f.counts.maximumActiveValidations, 1)

    options.validationError = new MachineTransportError(
      'project_location_missing',
      'controlled missing path',
      { peerAuthenticated: true },
    )
    await assert.rejects(
      coordinator.validateProjectLocation(
        machine,
        f.store.getTrustedMachinePeer(confirmed.machine.machineId),
        '/srv/projects/missing',
      ),
      (error) => error.code === 'project_location_missing',
    )
    assert.equal(
      f.store.getTrustedMachinePeer(confirmed.machine.machineId)?.trustState,
      'active',
    )
    assert.equal(
      coordinator.connectionState(confirmed.machine.machineId),
      'online',
    )
    assert.deepEqual(
      f.store
        .getTrustedMachinePeer(confirmed.machine.machineId)
        ?.endpoints.map((endpoint) => endpoint.address),
      [{ host: '172.20.1.30', port: 4319 }],
    )
  } finally {
    await f.close(coordinator)
  }
})

test('discovers remote Providers once per authenticated connection, deduplicates refresh, and preserves connectivity on discovery failure', async () => {
  let releaseDiscovery
  const gate = new Promise((resolve) => {
    releaseDiscovery = resolve
  })
  let holdFirst = true
  const options = {
    discoveryEnabled: true,
    async discoveryHandler() {
      if (holdFirst) {
        holdFirst = false
        await gate
      }
      return remoteProviderDiscovery()
    },
  }
  const f = await fixture(options)
  let coordinator
  try {
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
      heartbeatIntervalMs: 1_000,
      reconnectMaximumDelayMs: 20,
    })
    const candidate = await coordinator.beginPairing({
      address: { host: '172.20.1.30', port: 4319 },
      pairingCode: '123456',
    })
    const confirmed = await coordinator.confirmPairing(
      candidate.pairingAttemptId,
      (staged) =>
        f.store.createRemoteMachineWithTrust(staged.machine, staged.trust),
    )
    await waitFor(
      () =>
        coordinator.connectionState(confirmed.machine.machineId) === 'online',
      'trusted worker connection',
    )
    await waitFor(() => f.counts.discovery === 1, 'automatic discovery')
    const machine = f.store.getMachine(confirmed.machine.machineId)
    const trust = f.store.getTrustedMachinePeer(confirmed.machine.machineId)
    assert.ok(machine)
    assert.ok(trust)
    const first = coordinator.discoverProviders(machine, trust)
    const second = coordinator.discoverProviders(machine, trust)
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(f.counts.discovery, 1)
    releaseDiscovery()
    assert.deepEqual(await first, await second)
    assert.equal(f.counts.maximumActiveDiscoveries, 1)
    assert.deepEqual(
      f.store.getRemoteProviderObservation(machine.machineId),
      await first,
    )
    assert.equal(
      coordinator.providerDiscoveryCurrent(
        machine.machineId,
        (await first).observedAt,
      ),
      true,
    )

    options.discoveryError = new MachineTransportError(
      'connection_failed',
      'controlled discovery failure',
      { peerAuthenticated: true },
    )
    await assert.rejects(
      coordinator.discoverProviders(
        machine,
        f.store.getTrustedMachinePeer(machine.machineId),
      ),
      (error) => error.code === 'connection_failed',
    )
    assert.equal(coordinator.connectionState(machine.machineId), 'online')
    assert.deepEqual(
      f.store.getRemoteProviderObservation(machine.machineId),
      await first,
    )
  } finally {
    await f.close(coordinator)
  }
})

test('close aborts and awaits an in-flight remote Provider discovery', async () => {
  const options = {
    discoveryEnabled: true,
    discoveryHandler(signal) {
      return new Promise((resolve, reject) => {
        const onAbort = () => reject(signal.reason ?? new Error('aborted'))
        if (signal.aborted) {
          onAbort()
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
      })
    },
  }
  const f = await fixture(options)
  let coordinator
  try {
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
      heartbeatIntervalMs: 1_000,
      reconnectMaximumDelayMs: 20,
    })
    const candidate = await coordinator.beginPairing({
      address: { host: '172.20.1.30', port: 4319 },
      pairingCode: '123456',
    })
    await coordinator.confirmPairing(candidate.pairingAttemptId, (staged) =>
      f.store.createRemoteMachineWithTrust(staged.machine, staged.trust),
    )
    await waitFor(() => f.counts.discovery === 1, 'hanging discovery')
    await coordinator.close()
    assert.equal(f.counts.activeDiscoveries, 0)
  } finally {
    await f.close(coordinator)
  }
})

async function waitFor(predicate, label) {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() >= deadline)
      throw new Error(`Timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test('rejects public and loopback endpoints before transport, with explicit test-only loopback opt-in', async () => {
  const f = await fixture()
  let coordinator
  let loopbackCoordinator
  try {
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
    })
    await assert.rejects(
      coordinator.beginPairing({
        address: { host: '8.8.8.8', port: 4319 },
        pairingCode: '123456',
      }),
      /private LAN/u,
    )
    await assert.rejects(
      coordinator.beginPairing({
        address: { host: '127.0.0.1', port: 4319 },
        pairingCode: '123456',
      }),
      /private LAN/u,
    )
    assert.equal(f.counts.begin, 0)

    await coordinator.close()
    coordinator = undefined
    loopbackCoordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
      allowLoopbackForTests: true,
    })
    const candidate = await loopbackCoordinator.beginPairing({
      address: { host: '127.0.0.1', port: 4319 },
      pairingCode: '123456',
    })
    assert.equal(candidate.verificationCode, '123 456')
    assert.equal(f.counts.begin, 1)
    await loopbackCoordinator.cancelPairing(candidate.pairingAttemptId)
    assert.deepEqual(
      (await readdir(join(f.directory, 'machine-credentials'))).filter((name) =>
        name.endsWith('.json'),
      ),
      [],
    )
  } finally {
    await loopbackCoordinator?.close().catch(() => undefined)
    await f.close(coordinator)
  }
})

test('stages before confirmation, recovers pending trust, reconnects once after restart, and unpairs with revocation first', async () => {
  const confirmationLost = new MachineTransportError(
    'connection_failed',
    'acknowledgement lost',
  )
  const f = await fixture({ confirmError: confirmationLost })
  let coordinator
  try {
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
      heartbeatIntervalMs: 1_000,
      reconnectMaximumDelayMs: 20,
    })
    const candidate = await coordinator.beginPairing({
      address: { host: '192.168.50.10', port: 4319 },
      pairingCode: '123456',
    })
    await assert.rejects(
      coordinator.confirmPairing(candidate.pairingAttemptId, (staged) => {
        f.store.createRemoteMachineWithTrust(staged.machine, staged.trust)
      }),
      /connection/u,
    )
    assert.equal(
      f.store.getTrustedMachinePeer(f.machine.machineId)?.trustState,
      'pending',
    )
    await waitFor(
      () =>
        f.store.getTrustedMachinePeer(f.machine.machineId)?.trustState ===
          'active' &&
        coordinator.connectionState(f.machine.machineId) === 'online',
      'pending trust recovery',
    )
    assert.equal(
      f.store.listMachines().filter((entry) => entry.kind === 'remote').length,
      1,
    )

    await coordinator.close()
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
      heartbeatIntervalMs: 1_000,
      reconnectMaximumDelayMs: 20,
    })
    await waitFor(
      () => coordinator.connectionState(f.machine.machineId) === 'online',
      'restart reconnect',
    )
    assert.equal(
      f.store.listMachines().filter((entry) => entry.kind === 'remote').length,
      1,
    )

    const machine = f.store.getMachine(f.machine.machineId)
    const trust = f.store.markTrustedMachinePeerRevoking(
      f.machine.machineId,
      new Date().toISOString(),
    )
    const connectsBeforeUnpair = f.counts.connect
    await coordinator.unpair(machine, trust)
    assert.equal(f.counts.connect, connectsBeforeUnpair + 1)
    assert.equal(f.counts.revoke, 1)
    assert.equal(f.store.deleteRemoteMachine(f.machine.machineId), true)
    assert.equal(f.store.getMachine(f.machine.machineId), undefined)
  } finally {
    await f.close(coordinator)
  }
})

test('rejects a duplicate live pairing attempt without replacing the original', async () => {
  const f = await fixture({ pairingAttemptId: 'pairing_duplicate_fixture' })
  let coordinator
  try {
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
    })
    const first = await coordinator.beginPairing({
      address: { host: '10.1.2.3', port: 4319 },
      pairingCode: '123456',
    })
    await assert.rejects(
      coordinator.beginPairing({
        address: { host: '10.1.2.4', port: 4319 },
        pairingCode: '123456',
      }),
      /reused/u,
    )
    await coordinator.cancelPairing(first.pairingAttemptId)
    assert.equal(f.counts.begin, 2)
  } finally {
    await f.close(coordinator)
  }
})

test('maps disabled pairing mode to an expired pairing error', async () => {
  const f = await fixture({
    beginError: new MachineTransportError(
      'pairing_disabled',
      'pairing disabled',
    ),
  })
  let coordinator
  try {
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
    })
    await assert.rejects(
      coordinator.beginPairing({
        address: { host: '192.168.1.8', port: 4319 },
        pairingCode: '123456',
      }),
      (error) => error.code === 'pairing_code_expired',
    )
  } finally {
    await f.close(coordinator)
  }
})

test('wrong pinned identity becomes a terminal authentication state without reconnect storm', async () => {
  const good = await fixture()
  let coordinator
  try {
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: good.store,
      transport: good.transport,
      heartbeatIntervalMs: 1_000,
      reconnectMaximumDelayMs: 10,
    })
    const candidate = await coordinator.beginPairing({
      address: { host: '10.20.30.40', port: 4319 },
      pairingCode: '123456',
    })
    const confirmed = await coordinator.confirmPairing(
      candidate.pairingAttemptId,
      (staged) =>
        good.store.createRemoteMachineWithTrust(staged.machine, staged.trust),
    )
    good.store.activateTrustedMachinePeer(
      confirmed.machine.machineId,
      new Date().toISOString(),
    )
    await coordinator.close()

    let attempts = 0
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: good.store,
      transport: {
        ...good.transport,
        async connectTrusted() {
          attempts += 1
          throw new MachineTransportError('identity_mismatch', 'wrong identity')
        },
      },
      reconnectMaximumDelayMs: 10,
    })
    await waitFor(
      () =>
        coordinator.connectionState(good.machine.machineId) ===
        'authentication_failed',
      'terminal identity state',
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(attempts, 1)
    assert.equal(
      good.store.getTrustedMachinePeer(good.machine.machineId)?.trustState,
      'active',
    )
  } finally {
    await good.close(coordinator)
  }
})

test('recovery tries the preferred endpoint before an authenticated fallback and promotes that fallback', async () => {
  const options = {
    async connectHandler(input) {
      if (input.peer.endpoint.host === '172.20.1.21') {
        throw new MachineTransportError('connection_failed', 'preferred moved')
      }
    },
  }
  const f = await fixture(options)
  let coordinator
  try {
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
      heartbeatIntervalMs: 1_000,
      reconnectMaximumDelayMs: 20,
    })
    const candidate = await coordinator.beginPairing({
      address: { host: '172.20.1.20', port: 4319 },
      pairingCode: '123456',
    })
    const confirmed = await coordinator.confirmPairing(
      candidate.pairingAttemptId,
      (staged) =>
        f.store.createRemoteMachineWithTrust(staged.machine, staged.trust),
    )
    f.store.activateTrustedMachinePeer(
      confirmed.machine.machineId,
      new Date().toISOString(),
    )
    f.store.recordTrustedMachineAuthentication(
      confirmed.machine.machineId,
      { host: '172.20.1.21', port: 4319 },
      new Date().toISOString(),
      'manual',
    )
    await coordinator.close()
    coordinator = undefined
    f.attemptedEndpoints.length = 0

    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
      heartbeatIntervalMs: 1_000,
      reconnectMaximumDelayMs: 20,
    })
    await waitFor(
      () =>
        coordinator.connectionState(confirmed.machine.machineId) === 'online',
      'fallback connection',
    )
    assert.deepEqual(f.attemptedEndpoints.slice(0, 2), [
      { host: '172.20.1.21', port: 4319 },
      { host: '172.20.1.20', port: 4319 },
    ])
    const trust = f.store.getTrustedMachinePeer(confirmed.machine.machineId)
    assert.equal(trust?.endpoints[0]?.address.host, '172.20.1.20')
    assert.equal(trust?.endpoints[0]?.preferred, true)
    assert.ok(
      trust?.endpoints.find(
        (endpoint) => endpoint.address.host === '172.20.1.21',
      )?.lastFailureAt,
    )
  } finally {
    await f.close(coordinator)
  }
})

test('a mismatched stale fallback does not stop bounded recovery of a transient preferred endpoint', async () => {
  let recoveryMode = false
  let preferredAvailable = false
  const options = {
    async connectHandler(input) {
      if (!recoveryMode) return
      if (input.peer.endpoint.host === '172.20.1.21' && !preferredAvailable) {
        throw new MachineTransportError(
          'connection_failed',
          'preferred endpoint is temporarily unavailable',
        )
      }
      if (input.peer.endpoint.host === '172.20.1.20') {
        throw new MachineTransportError(
          'identity_mismatch',
          'stale endpoint belongs to another Node',
        )
      }
    },
  }
  const f = await fixture(options)
  let coordinator
  try {
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
      heartbeatIntervalMs: 1_000,
      reconnectMaximumDelayMs: 20,
    })
    const candidate = await coordinator.beginPairing({
      address: { host: '172.20.1.20', port: 4319 },
      pairingCode: '123456',
    })
    const confirmed = await coordinator.confirmPairing(
      candidate.pairingAttemptId,
      (staged) =>
        f.store.createRemoteMachineWithTrust(staged.machine, staged.trust),
    )
    f.store.activateTrustedMachinePeer(
      confirmed.machine.machineId,
      new Date().toISOString(),
    )
    f.store.recordTrustedMachineAuthentication(
      confirmed.machine.machineId,
      { host: '172.20.1.21', port: 4319 },
      new Date().toISOString(),
      'manual',
    )
    await coordinator.close()
    coordinator = undefined
    f.attemptedEndpoints.length = 0
    recoveryMode = true

    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
      heartbeatIntervalMs: 1_000,
      reconnectMaximumDelayMs: 20,
    })
    await waitFor(
      () =>
        coordinator.connectionState(confirmed.machine.machineId) ===
          'authentication_failed' && f.attemptedEndpoints.length >= 2,
      'mismatched stale fallback state',
    )
    preferredAvailable = true
    await waitFor(
      () =>
        coordinator.connectionState(confirmed.machine.machineId) === 'online',
      'preferred endpoint recovery',
    )

    assert.deepEqual(f.attemptedEndpoints.slice(0, 3), [
      { host: '172.20.1.21', port: 4319 },
      { host: '172.20.1.20', port: 4319 },
      { host: '172.20.1.21', port: 4319 },
    ])
    const trust = f.store.getTrustedMachinePeer(confirmed.machine.machineId)
    assert.equal(trust?.endpoints[0]?.address.host, '172.20.1.21')
    assert.equal(trust?.endpoints[0]?.preferred, true)
  } finally {
    await f.close(coordinator)
  }
})

test('a wrong identity at a manual candidate endpoint cannot poison durable endpoint history', async () => {
  const options = {
    async connectHandler(input) {
      if (input.peer.endpoint.host === '172.20.1.99') {
        throw new MachineTransportError('identity_mismatch', 'untrusted peer')
      }
    },
  }
  const f = await fixture(options)
  let coordinator
  try {
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
      heartbeatIntervalMs: 1_000,
      reconnectMaximumDelayMs: 20,
    })
    const candidate = await coordinator.beginPairing({
      address: { host: '172.20.1.22', port: 4319 },
      pairingCode: '123456',
    })
    const confirmed = await coordinator.confirmPairing(
      candidate.pairingAttemptId,
      (staged) =>
        f.store.createRemoteMachineWithTrust(staged.machine, staged.trust),
    )
    const trust = f.store.activateTrustedMachinePeer(
      confirmed.machine.machineId,
      new Date().toISOString(),
    )
    await assert.rejects(
      coordinator.updateAddress(confirmed.machine, trust, {
        host: '172.20.1.99',
        port: 4319,
      }),
      /identity/u,
    )
    const persisted = f.store.getTrustedMachinePeer(confirmed.machine.machineId)
    assert.deepEqual(
      persisted?.endpoints.map((endpoint) => endpoint.address),
      [{ host: '172.20.1.22', port: 4319 }],
    )
    assert.equal(persisted?.endpoints[0]?.preferred, true)
  } finally {
    await f.close(coordinator)
  }
})

test('startup deterministically finishes a durable revoking record', async () => {
  const f = await fixture()
  let coordinator
  try {
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
    })
    const candidate = await coordinator.beginPairing({
      address: { host: '172.20.1.5', port: 4319 },
      pairingCode: '123456',
    })
    const confirmed = await coordinator.confirmPairing(
      candidate.pairingAttemptId,
      (staged) =>
        f.store.createRemoteMachineWithTrust(staged.machine, staged.trust),
    )
    f.store.activateTrustedMachinePeer(
      confirmed.machine.machineId,
      new Date().toISOString(),
    )
    await coordinator.close()
    coordinator = undefined
    f.store.markTrustedMachinePeerRevoking(
      confirmed.machine.machineId,
      new Date().toISOString(),
    )

    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
    })
    await waitFor(
      () => f.store.getMachine(confirmed.machine.machineId) === undefined,
      'durable revocation recovery',
    )
    assert.ok(f.counts.revoke >= 1)
  } finally {
    await f.close(coordinator)
  }
})

test('an unauthenticated failure during revocation recovery never deletes durable trust', async () => {
  const options = {}
  const f = await fixture(options)
  let coordinator
  try {
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
      reconnectMaximumDelayMs: 10,
    })
    const candidate = await coordinator.beginPairing({
      address: { host: '172.20.1.6', port: 4319 },
      pairingCode: '123456',
    })
    const confirmed = await coordinator.confirmPairing(
      candidate.pairingAttemptId,
      (staged) =>
        f.store.createRemoteMachineWithTrust(staged.machine, staged.trust),
    )
    f.store.activateTrustedMachinePeer(
      confirmed.machine.machineId,
      new Date().toISOString(),
    )
    await coordinator.close()
    coordinator = undefined
    f.store.markTrustedMachinePeerRevoking(
      confirmed.machine.machineId,
      new Date().toISOString(),
    )

    options.connectError = new MachineTransportError(
      'authentication_failed',
      'the Node already committed the revocation',
    )
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
      reconnectMaximumDelayMs: 10,
    })
    await waitFor(() => f.counts.connect >= 2, 'bounded revocation retry')
    assert.ok(f.store.getMachine(confirmed.machine.machineId))
    assert.equal(
      f.store.getTrustedMachinePeer(confirmed.machine.machineId).trustState,
      'revoking',
    )
  } finally {
    await f.close(coordinator)
  }
})

test('a Node-B identity error after a lost acknowledgement cannot prove revocation', async () => {
  const options = {}
  const f = await fixture(options)
  let coordinator
  try {
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
      reconnectMaximumDelayMs: 10,
    })
    const candidate = await coordinator.beginPairing({
      address: { host: '172.20.1.8', port: 4319 },
      pairingCode: '123456',
    })
    const confirmed = await coordinator.confirmPairing(
      candidate.pairingAttemptId,
      (staged) =>
        f.store.createRemoteMachineWithTrust(staged.machine, staged.trust),
    )
    f.store.activateTrustedMachinePeer(
      confirmed.machine.machineId,
      new Date().toISOString(),
    )
    const trust = f.store.markTrustedMachinePeerRevoking(
      confirmed.machine.machineId,
      new Date().toISOString(),
    )
    options.revokeError = new MachineTransportError(
      'connection_failed',
      'revocation acknowledgement was lost',
    )
    options.connectErrorAfterRevoke = new MachineTransportError(
      'identity_mismatch',
      'a different Node answered the old endpoint',
    )

    await assert.rejects(
      coordinator.unpair(confirmed.machine, trust),
      (error) => error instanceof RemoteMachineRevocationPendingError,
    )
    await waitFor(() => f.counts.connect >= 2, 'live revocation retry')
    assert.ok(f.store.getMachine(confirmed.machine.machineId))
    assert.equal(
      f.store.getTrustedMachinePeer(confirmed.machine.machineId)?.trustState,
      'revoking',
    )
  } finally {
    await f.close(coordinator)
  }
})

test('a pinned peer authentication rejection after a lost revoke acknowledgement completes local cleanup', async () => {
  const options = {}
  const f = await fixture(options)
  let coordinator
  try {
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
      reconnectMaximumDelayMs: 10,
    })
    const candidate = await coordinator.beginPairing({
      address: { host: '172.20.1.9', port: 4319 },
      pairingCode: '123456',
    })
    const confirmed = await coordinator.confirmPairing(
      candidate.pairingAttemptId,
      (staged) =>
        f.store.createRemoteMachineWithTrust(staged.machine, staged.trust),
    )
    f.store.activateTrustedMachinePeer(
      confirmed.machine.machineId,
      new Date().toISOString(),
    )
    const trust = f.store.markTrustedMachinePeerRevoking(
      confirmed.machine.machineId,
      new Date().toISOString(),
    )
    options.revokeError = new MachineTransportError(
      'connection_failed',
      'revocation acknowledgement was lost',
    )
    options.connectErrorAfterRevoke = new MachineTransportError(
      'authentication_failed',
      'the pinned Node already removed controller trust',
      { peerAuthenticated: true },
    )

    await assert.rejects(
      coordinator.unpair(confirmed.machine, trust),
      (error) => error instanceof RemoteMachineRevocationPendingError,
    )
    await waitFor(
      () => f.store.getMachine(confirmed.machine.machineId) === undefined,
      'authenticated lost-ack cleanup',
    )
    assert.equal(
      f.store.getTrustedMachinePeer(confirmed.machine.machineId),
      undefined,
    )
  } finally {
    await f.close(coordinator)
  }
})

test('credential deletion failure keeps revocation durable until bounded cleanup succeeds', async () => {
  const f = await fixture()
  let coordinator
  let blockCredentialDeletion = true
  try {
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
      reconnectMaximumDelayMs: 10,
      deleteCredentialFile: async (path) => {
        if (blockCredentialDeletion) {
          const error = new Error('controlled credential unlink failure')
          error.code = 'EACCES'
          throw error
        }
        await deleteMachineTlsIdentityFile(path)
      },
    })
    const candidate = await coordinator.beginPairing({
      address: { host: '172.20.1.7', port: 4319 },
      pairingCode: '123456',
    })
    const confirmed = await coordinator.confirmPairing(
      candidate.pairingAttemptId,
      (staged) =>
        f.store.createRemoteMachineWithTrust(staged.machine, staged.trust),
    )
    f.store.activateTrustedMachinePeer(
      confirmed.machine.machineId,
      new Date().toISOString(),
    )
    const trust = f.store.markTrustedMachinePeerRevoking(
      confirmed.machine.machineId,
      new Date().toISOString(),
    )
    const removed = new Promise((resolve) =>
      coordinator.subscribeRemoval((machineId) => resolve(machineId)),
    )

    await assert.rejects(
      coordinator.unpair(confirmed.machine, trust),
      (error) => error instanceof RemoteMachineRevocationPendingError,
    )
    assert.equal(
      f.store.getTrustedMachinePeer(confirmed.machine.machineId)?.trustState,
      'revoking',
    )
    assert.ok(f.store.getMachine(confirmed.machine.machineId))

    blockCredentialDeletion = false
    assert.equal(await removed, confirmed.machine.machineId)
    assert.equal(f.store.getMachine(confirmed.machine.machineId), undefined)
    assert.equal(
      f.store.getTrustedMachinePeer(confirmed.machine.machineId),
      undefined,
    )
  } finally {
    await f.close(coordinator)
  }
})

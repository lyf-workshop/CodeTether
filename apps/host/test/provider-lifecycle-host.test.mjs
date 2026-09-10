import assert from 'node:assert/strict'
import {
  chmod,
  mkdir,
  mkdtemp as makeTemporaryDirectory,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { canonicalFailure } from '@codetether/agent-core'
import { ClaudeCodeOwnedProcessCleanupError } from '@codetether/adapter-claude'
import { CodexOwnedProcessCleanupError } from '@codetether/adapter-codex'

import { HostEventPublisher } from '../dist/api/host-event-publisher.js'
import {
  LocalProviderLifecycleCoordinator,
  observeLocalProviderCandidates,
  prioritizeLocalProviderInstallations,
} from '../dist/api/local-provider-lifecycle-coordinator.js'
import {
  HostService,
  HostServiceError,
  newEpoch,
} from '../dist/api/host-service.js'
import { MachineProviderRuntimeResolver } from '../dist/api/machine-provider-runtime-resolver.js'
import { composeLocalHostLifecycleClose } from '../dist/api/local-codex-host.js'
import { ProviderRegistry } from '../dist/api/provider-registry.js'
import { WorkspacePolicy } from '../dist/api/workspace-policy.js'
import { ConversationStore } from '../dist/persistence/index.js'
import { normalizeTrustedProjectRoot } from '../dist/project-path.js'

const observedAt = '2026-10-06T12:00:00.000Z'
const changedAt = '2026-10-06T12:01:00.000Z'
const installationAId = 'pinst_phase8b_host_installation_A'
const installationBId = 'pinst_phase8b_host_installation_B'
const revisionA1 = 'prev_phase8b_host_revision_A_0001'
const revisionA2 = 'prev_phase8b_host_revision_A_0002'
const revisionB = 'prev_phase8b_host_revision_B_0001'
const remoteMachineId = 'machine_phase8bhostremotefresh01'
const remoteInstallationId = 'pinst_phase8b_host_remote_installation_A'
const remoteRevision = 'prev_phase8b_host_remote_revision_A_0001'

async function mkdtemp(prefix) {
  return await realpath(await makeTemporaryDirectory(prefix))
}

test('normal local Host close awaits lifecycle cleanup and preserves its exact barrier', async () => {
  const cleanupFailure = new CodexOwnedProcessCleanupError()
  const inFlightLifecycleCleanup = deferred()
  const order = []
  let hostCloseCalls = 0
  let lifecycleCloseCalls = 0
  const close = composeLocalHostLifecycleClose(
    {
      close: async () => {
        hostCloseCalls += 1
        order.push('host')
      },
    },
    {
      close: async () => {
        lifecycleCloseCalls += 1
        order.push('lifecycle')
        await inFlightLifecycleCleanup.promise
        throw cleanupFailure
      },
    },
  )

  const firstClose = close()
  const secondClose = close()
  await waitFor(() => lifecycleCloseCalls === 1, 'lifecycle close')
  assert.deepEqual(order, ['host', 'lifecycle'])
  assert.equal(hostCloseCalls, 1)
  inFlightLifecycleCleanup.resolve()

  const results = await Promise.allSettled([firstClose, secondClose])
  assert.deepEqual(
    results.map((result) => result.status),
    ['rejected', 'rejected'],
  )
  for (const result of results) {
    assert.equal(result.reason, cleanupFailure)
  }
  assert.equal(hostCloseCalls, 1)
  assert.equal(lifecycleCloseCalls, 1)
})

test('Host close surfaces session-scan cleanup uncertainty discovered during cancellation', async (t) => {
  const scanStarted = deferred()
  const cleanupFailure = new CodexOwnedProcessCleanupError()
  const discovery = {
    provider: 'codex',
    discover: async ({ signal }) => {
      scanStarted.resolve()
      await new Promise((_, reject) => {
        const aborted = () => reject(cleanupFailure)
        if (signal.aborted) aborted()
        else signal.addEventListener('abort', aborted, { once: true })
      })
    },
    validateCandidate: async () => undefined,
  }
  const fixture = await createFixture(t, { discovery })
  const scanning = fixture.service.discoverProviderSessions(
    fixture.projectId,
    fixture.machineId,
    { provider: 'codex', limit: 50, rescan: true },
  )
  const scanRejected = assert.rejects(
    scanning,
    (error) =>
      error instanceof HostServiceError &&
      error.failure?.reason === 'execution_ownership_uncertain',
  )
  await scanStarted.promise

  const closeRejected = assert.rejects(
    fixture.service.close(),
    (error) =>
      error instanceof HostServiceError &&
      error.failure?.reason === 'execution_ownership_uncertain',
  )
  await Promise.all([scanRejected, closeRejected])
})

test('local lifecycle permanently latches unverified Codex and Claude probe cleanup', async (t) => {
  for (const [provider, CleanupError] of [
    ['codex', CodexOwnedProcessCleanupError],
    ['claude-code', ClaudeCodeOwnedProcessCleanupError],
  ]) {
    await t.test(provider, async () => {
      const directory = await mkdtemp(
        join(tmpdir(), `codetether-phase8b-local-${provider}-cleanup-`),
      )
      const databasePath = join(directory, 'codetether.sqlite3')
      const executable = join(directory, `test-owned-${provider}`)
      await writeFile(executable, 'test-owned-provider-fixture', 'utf8')
      await chmod(executable, 0o755)
      const persistence = ConversationStore.open({ databasePath })
      const machine = persistence.listMachines()[0]
      assert.ok(machine)
      const cleanupFailure = new CleanupError()
      let exposeCandidate = false
      let coordinator
      const codexCandidate = {
        launcherPath: executable,
        executable,
        fileIdentity: 'test-owned-codex-cleanup',
        launcherKind: 'native',
        installMethod: 'manual',
      }
      const claudeCandidate = {
        launcherPath: executable,
        launcher: {
          kind: 'native',
          launcherPath: executable,
          executable,
          prefixArguments: [],
          sourcePath: executable,
        },
        fileIdentity: 'test-owned-claude-cleanup',
        launcherKind: 'native',
        installMethod: 'manual',
      }
      try {
        coordinator = await LocalProviderLifecycleCoordinator.create({
          machineId: machine.machineId,
          persistence,
          hostVersion: 'phase8b-local-cleanup-barrier-test',
          environment: { PATH: '' },
          platform: process.platform,
          discoverCodex: async () => ({
            installations:
              exposeCandidate && provider === 'codex' ? [codexCandidate] : [],
            pathsInspected: exposeCandidate && provider === 'codex' ? 1 : 0,
            truncated: false,
          }),
          discoverClaude: async () => ({
            installations:
              exposeCandidate && provider === 'claude-code'
                ? [claudeCandidate]
                : [],
            pathsInspected:
              exposeCandidate && provider === 'claude-code' ? 1 : 0,
            truncated: false,
          }),
          observeCodex: async () => {
            throw cleanupFailure
          },
          observeClaude: async () => {
            throw cleanupFailure
          },
        })
        exposeCandidate = true
        await assert.rejects(
          coordinator.refresh(provider),
          (error) => error === cleanupFailure,
        )
        const blockedState = coordinator.state(provider)
        assert.ok(blockedState)
        assert.equal(blockedState.runtime.available, false)
        assert.equal(
          blockedState.runtime.descriptor.executionHealth.failure.reason,
          'execution_ownership_uncertain',
        )
        assert.throws(
          () => coordinator.refresh(provider),
          (error) => error === cleanupFailure,
        )
        await assert.rejects(
          coordinator.prepareRefresh(provider),
          (error) => error === cleanupFailure,
        )
        const otherProvider = provider === 'codex' ? 'claude-code' : 'codex'
        const otherState = await coordinator.refresh(otherProvider)
        assert.equal(otherState.runtime.provider, otherProvider)
        await assert.rejects(
          coordinator.close(),
          (error) => error === cleanupFailure,
        )
      } finally {
        await coordinator?.close().catch(() => undefined)
        persistence.close()
        await rm(directory, { recursive: true, force: true, maxRetries: 5 })
      }
    })
  }
})

test('local lifecycle startup isolates one Provider cleanup barrier and preserves the other Provider state', async (t) => {
  for (const [provider, CleanupError] of [
    ['codex', CodexOwnedProcessCleanupError],
    ['claude-code', ClaudeCodeOwnedProcessCleanupError],
  ]) {
    await t.test(provider, async () => {
      const directory = await mkdtemp(
        join(tmpdir(), `codetether-local-startup-isolation-${provider}-`),
      )
      const databasePath = join(directory, 'codetether.sqlite3')
      const executable = join(directory, `test-owned-${provider}`)
      await writeFile(executable, 'test-owned-provider-fixture', 'utf8')
      await chmod(executable, 0o755)
      const persistence = ConversationStore.open({ databasePath })
      const machine = persistence.listMachines()[0]
      const cleanupFailure = new CleanupError()
      const codexCandidate = {
        launcherPath: executable,
        executable,
        fileIdentity: 'test-owned-codex-startup-cleanup',
        launcherKind: 'native',
        installMethod: 'manual',
      }
      const claudeCandidate = {
        launcherPath: executable,
        launcher: {
          kind: 'native',
          launcherPath: executable,
          executable,
          prefixArguments: [],
          sourcePath: executable,
        },
        fileIdentity: 'test-owned-claude-startup-cleanup',
        launcherKind: 'native',
        installMethod: 'manual',
      }
      let coordinator
      try {
        coordinator = await LocalProviderLifecycleCoordinator.create({
          machineId: machine.machineId,
          persistence,
          hostVersion: 'phase8c-local-startup-isolation-test',
          environment: { PATH: '' },
          platform: process.platform,
          discoverCodex: async () => ({
            installations: provider === 'codex' ? [codexCandidate] : [],
            pathsInspected: provider === 'codex' ? 1 : 0,
            truncated: false,
          }),
          discoverClaude: async () => ({
            installations: provider === 'claude-code' ? [claudeCandidate] : [],
            pathsInspected: provider === 'claude-code' ? 1 : 0,
            truncated: false,
          }),
          observeCodex: async () => {
            throw cleanupFailure
          },
          observeClaude: async () => {
            throw cleanupFailure
          },
        })
        assert.equal(coordinator.states().length, 2)
        assert.equal(coordinator.state(provider).runtime.available, false)
        assert.equal(
          coordinator.state(provider).runtime.descriptor.executionHealth.failure
            .reason,
          'execution_ownership_uncertain',
        )
        const otherProvider = provider === 'codex' ? 'claude-code' : 'codex'
        assert.equal(
          coordinator.state(otherProvider).runtime.provider,
          otherProvider,
        )
        assert.throws(
          () => coordinator.refresh(provider),
          (error) => error === cleanupFailure,
        )
        await coordinator.refresh(otherProvider)
      } finally {
        await coordinator?.close().catch(() => undefined)
        persistence.close()
        await rm(directory, { recursive: true, force: true, maxRetries: 5 })
      }
    })
  }
})

test('Host startup retains a local lifecycle ownership barrier in eligibility and public health', async (t) => {
  const failure = canonicalFailure('execution_ownership_uncertain', observedAt)
  const fixture = await createFixture(t, {
    executionHealth: {
      state: 'unavailable',
      freshness: 'current',
      observedAt,
      failure,
    },
  })

  const bootstrap = fixture.service.bootstrap()
  assert.equal(bootstrap.capabilities.codex, false)
  const provider = bootstrap.providers.find(
    (candidate) => candidate.provider === 'codex',
  )
  assert.ok(provider)
  assert.deepEqual(provider.executionHealth?.failure, failure)

  await assert.rejects(
    fixture.service.createConversation({
      actionId: 'act_phase8c_startup_cleanup_barrier',
      projectId: fixture.projectId,
      machineId: fixture.machineId,
      provider: 'codex',
    }),
    (error) =>
      error instanceof HostServiceError &&
      error.failure?.reason === 'execution_ownership_uncertain',
  )
  assert.equal(fixture.runtime.startConversationCalls.length, 0)
  assert.deepEqual(fixture.persistence.listConversations(), [])
})

test('Host selection ignores candidate ordering and keeps runtime compatibility separate from backend readiness', async (t) => {
  const discovery = new CountingDiscovery()
  const fixture = await createFixture(t, {
    compatibilityState: 'limited',
    discoverySupported: false,
    backendReadiness: 'unavailable',
    discovery,
    reversePublicInstallationOrder: true,
  })

  const machine = await fixture.service.getMachine(fixture.machineId)
  const lifecycle = machine.providerLifecycles[0]
  assert.ok(lifecycle)
  assert.equal(lifecycle.selectedInstallationId, installationAId)
  assert.equal(lifecycle.installations[0].installationId, installationBId)
  const selected = lifecycle.installations.find(
    ({ installationId }) => installationId === installationAId,
  )
  assert.ok(selected)
  assert.equal(selected.compatibility.state, 'limited')
  assert.equal(selected.compatibility.runtimeReadiness, 'limited')
  assert.equal(selected.backend.readiness, 'unavailable')

  const unavailableDiscovery = await fixture.service.discoverProviderSessions(
    fixture.projectId,
    fixture.machineId,
    { provider: 'codex', limit: 50, rescan: true },
  )
  assert.equal(unavailableDiscovery.candidates.length, 0)
  assert.equal(unavailableDiscovery.providers[0].status, 'unsupported')
  assert.equal(
    unavailableDiscovery.providers[0].failureReason,
    'provider_session_format_unsupported',
  )
  assert.equal(discovery.discoverCalls, 0)

  const created = await fixture.service.createConversation({
    actionId: 'act_phase8b_selected_installation_create',
    projectId: fixture.projectId,
    machineId: fixture.machineId,
    provider: 'codex',
  })
  const durable = fixture.persistence.getConversation(
    created.data.conversation.conversationId,
  )
  assert.equal(durable.providerInstallationId, installationAId)
  assert.equal(fixture.runtime.startConversationCalls.length, 1)
  assert.equal(fixture.runtime.installation.installationId, installationAId)
  assert.equal(
    JSON.stringify(created.data.conversation).includes(installationAId),
    false,
  )
})

test('Doctor composes exact selected lifecycle truth without paths or backend secrets', async (t) => {
  const fixture = await createFixture(t)
  const global = await fixture.service.getDoctor()
  assert.equal(global.doctor.overall, 'needs_attention')
  assert.equal(global.doctor.project, undefined)
  const response = await fixture.service.getDoctor(fixture.projectId)
  const codex = response.doctor.providers.find(
    ({ provider }) => provider === 'codex',
  )
  assert.ok(codex)
  assert.equal(response.doctor.overall, 'ready')
  assert.equal(codex.state, 'ready')
  assert.equal(codex.installed, true)
  assert.equal(codex.selected, true)
  assert.equal(codex.alternateInstallations, 1)
  assert.equal(codex.launcherKind, 'symlink')
  assert.equal(codex.installMethod, 'npm')
  assert.equal(codex.compatibility, 'verified')
  assert.equal(codex.runtimeReadiness, 'ready')
  assert.equal(codex.backend.mode, 'custom_gateway')
  assert.equal(codex.backend.readiness, 'ready')
  assert.equal(codex.sessionDiscovery, 'supported')
  const serialized = JSON.stringify(response)
  assert.equal(serialized.includes(fixture.directory), false)
  assert.equal(serialized.includes('hasApiKey'), false)
  assert.equal(serialized.includes('gateway.example.test'), false)
})

test('Doctor keeps runtime compatibility separate from unavailable backend readiness', async (t) => {
  const fixture = await createFixture(t, { backendReadiness: 'unavailable' })
  const response = await fixture.service.getDoctor(fixture.projectId)
  const codex = response.doctor.providers.find(
    ({ provider }) => provider === 'codex',
  )
  assert.ok(codex)
  assert.equal(codex.compatibility, 'verified')
  assert.equal(codex.runtimeReadiness, 'ready')
  assert.equal(codex.backend.state, 'unavailable')
  assert.equal(codex.backend.readiness, 'unavailable')
  assert.equal(codex.state, 'unavailable')
  assert.equal(response.doctor.overall, 'needs_attention')
})

test('Doctor does not report a Provider Ready while current execution health is fatally unavailable', async (t) => {
  const failure = canonicalFailure('provider_crashed', observedAt)
  const fixture = await createFixture(t, {
    executionHealth: {
      state: 'degraded',
      freshness: 'current',
      observedAt,
      failure,
    },
  })
  const response = await fixture.service.getDoctor(fixture.projectId)
  const codex = response.doctor.providers.find(
    ({ provider }) => provider === 'codex',
  )
  assert.ok(codex)
  assert.equal(codex.compatibility, 'verified')
  assert.equal(codex.runtimeReadiness, 'ready')
  assert.equal(codex.backend.state, 'ready')
  assert.equal(codex.executionHealth.state, 'degraded')
  assert.equal(codex.executionHealth.freshness, 'current')
  assert.equal(codex.failure.reason, 'provider_crashed')
  assert.equal(codex.state, 'unavailable')
  assert.equal(response.doctor.overall, 'needs_attention')
})

test('Doctor retains last-known Provider execution failures as advisory history', async (t) => {
  const failure = canonicalFailure('provider_crashed', observedAt)
  const fixture = await createFixture(t, {
    executionHealth: {
      state: 'degraded',
      freshness: 'last_known',
      observedAt,
      failure,
    },
  })
  const response = await fixture.service.getDoctor(fixture.projectId)
  const codex = response.doctor.providers.find(
    ({ provider }) => provider === 'codex',
  )
  assert.ok(codex)
  assert.equal(codex.executionHealth.freshness, 'last_known')
  assert.equal(codex.failure.reason, 'provider_crashed')
  assert.equal(codex.state, 'ready')
  assert.equal(response.doctor.overall, 'ready')
})

test('Doctor reports a current nonfatal Provider health degradation without changing compatibility or backend truth', async (t) => {
  const failure = canonicalFailure('rate_limited', observedAt)
  const fixture = await createFixture(t, {
    executionHealth: {
      state: 'degraded',
      freshness: 'current',
      observedAt,
      failure,
    },
  })
  const response = await fixture.service.getDoctor(fixture.projectId)
  const codex = response.doctor.providers.find(
    ({ provider }) => provider === 'codex',
  )
  assert.ok(codex)
  assert.equal(codex.compatibility, 'verified')
  assert.equal(codex.runtimeReadiness, 'ready')
  assert.equal(codex.backend.state, 'ready')
  assert.equal(codex.executionHealth.state, 'degraded')
  assert.equal(codex.failure.reason, 'rate_limited')
  assert.equal(codex.state, 'limited')
  assert.equal(response.doctor.overall, 'limited')
})

test('Doctor requires actual durable local Host state before reporting Ready', async (t) => {
  const fixture = await createNonDurableDoctorFixture(t)
  const response = await fixture.service.getDoctor(fixture.projectId)
  const codex = response.doctor.providers.find(
    ({ provider }) => provider === 'codex',
  )
  assert.ok(codex)
  assert.equal(codex.state, 'ready')
  assert.equal(response.doctor.project.state, 'ready')
  assert.equal(response.doctor.thisComputer.state, 'unavailable')
  assert.equal(response.doctor.overall, 'unavailable')
})

test('Doctor overall readiness requires a Provider on the same ready Project Machine', async (t) => {
  const fixture = await createRemoteUninitializedFixture(t)
  const online = await fixture.service.getDoctor(fixture.projectId, true)
  assert.equal(online.doctor.overall, 'limited')
  assert.equal(online.doctor.remoteComputers[0].state, 'limited')

  fixture.coordinator.online = false
  const offline = await fixture.service.getDoctor(fixture.projectId)
  assert.equal(offline.doctor.remoteComputers[0].state, 'offline')
  const staleRemoteCodex = offline.doctor.remoteComputers[0].providers.find(
    ({ provider }) => provider === 'codex',
  )
  assert.ok(staleRemoteCodex)
  assert.equal(staleRemoteCodex.backend.freshness, 'last_known')
  assert.equal(staleRemoteCodex.backend.readiness, 'ready')
  assert.equal(staleRemoteCodex.backend.state, 'unknown')
  assert.equal(offline.doctor.overall, 'unknown')
})

test('Host rejects lifecycle observations for a stale runtime revision', async () => {
  const runtime = new TrackingRuntime(installationAId, revisionA2)
  const current = publicLifecycle({ revision: revisionA2 })
  const registry = new ProviderRegistry([runtime], [current])
  try {
    assert.throws(
      () => registry.setLifecycle(publicLifecycle({ revision: revisionA1 })),
      /lifecycle does not match its runtime installation/u,
    )
    assert.equal(
      selectedInstallation(registry.lifecycle('codex')).revision,
      revisionA2,
    )
  } finally {
    await registry.close()
  }
})

test('local lifecycle ordering retains selected and current observations ahead of stale missing history', () => {
  const installation = (installationId) => ({ durable: { installationId } })
  const current = [
    installation('pinst_phase8b_current_selected'),
    installation('pinst_phase8b_current_alternate'),
  ]
  const stale = Array.from({ length: 10 }, (_, index) =>
    installation(`pinst_phase8b_stale_${String(index).padStart(2, '0')}`),
  )

  const bounded = prioritizeLocalProviderInstallations(
    current,
    stale,
    current[0].durable.installationId,
  ).slice(0, 8)

  assert.equal(
    bounded[0].durable.installationId,
    'pinst_phase8b_current_selected',
  )
  assert.equal(
    bounded[1].durable.installationId,
    'pinst_phase8b_current_alternate',
  )
  assert.equal(
    bounded.some(
      ({ durable }) =>
        durable.installationId === current[0].durable.installationId,
    ),
    true,
  )
})

test('local truncated discovery retains an omitted selection as last-known until re-observed', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-phase8b-local-truncated-'),
  )
  const databasePath = join(directory, 'codetether.sqlite3')
  const selectedPath = join(directory, 'claude-selected')
  const alternatePath = join(directory, 'claude-alternate')
  await writeFile(selectedPath, 'selected-revision', 'utf8')
  await writeFile(alternatePath, 'alternate-revision', 'utf8')
  const persistence = ConversationStore.open({ databasePath })
  const machine = persistence.listMachines()[0]
  assert.ok(machine)
  const candidate = (launcherPath, fileIdentity) => ({
    launcherPath,
    launcher: {
      kind: 'native',
      launcherPath,
      executable: launcherPath,
      prefixArguments: [],
      sourcePath: launcherPath,
    },
    fileIdentity,
    launcherKind: 'native',
    installMethod: 'manual',
  })
  const selectedCandidate = candidate(selectedPath, 'local-selected')
  const alternateCandidate = candidate(alternatePath, 'local-alternate')
  const supported = {
    observed: 'supported',
    enabled: true,
    effective: true,
  }
  let visible = [selectedCandidate, alternateCandidate]
  let truncated = false
  let now = new Date(observedAt)
  const coordinator = await LocalProviderLifecycleCoordinator.create({
    machineId: machine.machineId,
    persistence,
    hostVersion: 'phase8b-local-truncation-test',
    environment: { PATH: '' },
    now: () => now,
    discoverCodex: async () => ({
      installations: [],
      pathsInspected: 0,
      truncated: false,
    }),
    discoverClaude: async () => ({
      installations: visible,
      pathsInspected: visible.length,
      truncated,
    }),
    observeClaude: async (options) => ({
      installation: options.installation,
      version: '2.1.263',
      privateRevision: await options.fingerprint(),
      compatibility: {
        state: 'verified',
        runtimeReadiness: 'ready',
        contractVersion: 1,
        capabilities: {
          execution: supported,
          streaming: supported,
          nativeResume: supported,
          nativeSessionDiscovery: supported,
          fileRead: supported,
          search: supported,
          toolEvents: supported,
          reasoningControl: supported,
        },
      },
      backend: {
        mode: 'custom_gateway',
        source: 'process_environment',
        hasBaseUrl: true,
        hasApiKey: false,
        hasAuthToken: true,
        hasOAuthToken: false,
        bedrockConfigured: false,
        vertexConfigured: false,
        configurationValid: true,
        privateConfigurationRevision: 'local-truncated-backend',
        readiness: 'unknown',
      },
      runtimeEnvironment: () => ({ PATH: '' }),
    }),
  })
  t.after(async () => {
    await coordinator.close().catch(() => undefined)
    persistence.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 5 })
  })

  const initial = coordinator.state('claude-code')
  assert.ok(initial)
  const initialSelected = selectedInstallation(initial.lifecycle)
  const selectedId = initialSelected.installationId

  visible = [alternateCandidate]
  truncated = true
  now = new Date(changedAt)
  const incomplete = await coordinator.refresh('claude-code')
  assert.equal(incomplete.lifecycle.selectedInstallationId, selectedId)
  assert.equal(incomplete.runtime.available, false)
  const retained = selectedInstallation(incomplete.lifecycle)
  assert.equal(retained.availability, 'available')
  assert.equal(retained.lastObservedAt, initialSelected.lastObservedAt)
  assert.equal(retained.compatibility.freshness, 'last_known')
  assert.equal(retained.backend.freshness, 'last_known')
  const durableRetained = selectedInstallation(
    persistence.getProviderLifecycle(machine.machineId, 'claude-code'),
  )
  assert.equal(durableRetained.installationId, selectedId)
  assert.equal(durableRetained.compatibility.freshness, 'last_known')

  visible = [alternateCandidate, selectedCandidate]
  truncated = false
  now = new Date('2026-10-06T12:02:00.000Z')
  const returned = await coordinator.refresh('claude-code')
  assert.equal(returned.lifecycle.selectedInstallationId, selectedId)
  assert.equal(
    selectedInstallation(returned.lifecycle).availability,
    'available',
  )
  assert.equal(
    selectedInstallation(returned.lifecycle).compatibility.freshness,
    'current',
  )
})

test('local first selection skips an earlier incompatible installation and remains stable', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-phase8b-local-first-eligible-'),
  )
  const databasePath = join(directory, 'codetether.sqlite3')
  const incompatiblePath = join(directory, 'claude-incompatible')
  const compatiblePath = join(directory, 'claude-compatible')
  await writeFile(incompatiblePath, 'incompatible-revision', 'utf8')
  await writeFile(compatiblePath, 'compatible-revision', 'utf8')
  const persistence = ConversationStore.open({ databasePath })
  const machine = persistence.listMachines()[0]
  assert.ok(machine)
  const candidate = (launcherPath, fileIdentity) => ({
    launcherPath,
    launcher: {
      kind: 'native',
      launcherPath,
      executable: launcherPath,
      prefixArguments: [],
      sourcePath: launcherPath,
    },
    fileIdentity,
    launcherKind: 'native',
    installMethod: 'manual',
  })
  const incompatibleCandidate = candidate(
    incompatiblePath,
    'local-incompatible-first',
  )
  const compatibleCandidate = candidate(
    compatiblePath,
    'local-compatible-second',
  )
  let firstCandidateCompatible = false
  let now = new Date(observedAt)
  const coordinator = await LocalProviderLifecycleCoordinator.create({
    machineId: machine.machineId,
    persistence,
    hostVersion: 'phase8b-local-first-eligible-test',
    environment: { PATH: '' },
    now: () => now,
    discoverCodex: async () => ({
      installations: [],
      pathsInspected: 0,
      truncated: false,
    }),
    discoverClaude: async () => ({
      installations: [incompatibleCandidate, compatibleCandidate],
      pathsInspected: 2,
      truncated: false,
    }),
    observeClaude: async (options) => {
      const compatible =
        options.installation.fileIdentity ===
          compatibleCandidate.fileIdentity || firstCandidateCompatible
      const capability = {
        observed: compatible ? 'supported' : 'unsupported',
        enabled: true,
        effective: compatible,
      }
      return {
        installation: options.installation,
        version: compatible
          ? options.installation.fileIdentity ===
            compatibleCandidate.fileIdentity
            ? '2.1.263-good'
            : '2.1.263-now-good'
          : '2.1.263-bad',
        privateRevision: await options.fingerprint(),
        compatibility: {
          state: compatible ? 'verified' : 'incompatible',
          runtimeReadiness: compatible ? 'ready' : 'blocked',
          contractVersion: 1,
          ...(compatible ? {} : { failureCode: 'provider_protocol_error' }),
          capabilities: {
            execution: capability,
            streaming: capability,
            nativeResume: capability,
            nativeSessionDiscovery: capability,
            fileRead: capability,
            search: capability,
            toolEvents: capability,
            reasoningControl: capability,
          },
        },
        backend: {
          mode: 'custom_gateway',
          source: 'process_environment',
          hasBaseUrl: true,
          hasApiKey: false,
          hasAuthToken: true,
          hasOAuthToken: false,
          bedrockConfigured: false,
          vertexConfigured: false,
          configurationValid: true,
          privateConfigurationRevision: 'local-first-eligible-backend',
          readiness: 'unknown',
        },
        runtimeEnvironment: () => ({ PATH: '' }),
      }
    },
  })
  t.after(async () => {
    await coordinator.close().catch(() => undefined)
    persistence.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 5 })
  })

  const initial = coordinator.state('claude-code')
  assert.ok(initial)
  const selected = selectedInstallation(initial.lifecycle)
  assert.equal(selected.version, '2.1.263-good')
  const selectedId = selected.installationId

  firstCandidateCompatible = true
  now = new Date(changedAt)
  const refreshed = await coordinator.refresh('claude-code')
  assert.equal(refreshed.lifecycle.selectedInstallationId, selectedId)
  assert.equal(
    selectedInstallation(refreshed.lifecycle).version,
    '2.1.263-good',
  )
})

test('a missing absolute Codex executable remains authoritative over a compatible alternate', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-phase8b-local-explicit-missing-'),
  )
  const databasePath = join(directory, 'codetether.sqlite3')
  const missingConfiguredPath = join(directory, 'configured', 'missing-codex')
  const alternatePath = join(directory, 'path', 'codex')
  await mkdir(join(directory, 'path'), { recursive: true })
  await writeFile(alternatePath, 'compatible-alternate', 'utf8')
  const persistence = ConversationStore.open({ databasePath })
  const machine = persistence.listMachines()[0]
  assert.ok(machine)
  const alternate = {
    launcherPath: alternatePath,
    executable: alternatePath,
    fileIdentity: 'test-owned-compatible-path-alternate',
    launcherKind: 'native',
    installMethod: 'manual',
  }
  const supported = {
    observed: 'supported',
    enabled: true,
    effective: true,
  }
  const policyDisabled = {
    observed: 'supported',
    enabled: false,
    effective: false,
  }
  let observationCalls = 0
  const coordinator = await LocalProviderLifecycleCoordinator.create({
    machineId: machine.machineId,
    persistence,
    hostVersion: 'phase8b-local-explicit-missing-test',
    codexExecutable: missingConfiguredPath,
    environment: { PATH: '' },
    now: () => new Date(observedAt),
    discoverCodex: async () => ({
      installations: [alternate],
      pathsInspected: 2,
      truncated: false,
    }),
    discoverClaude: async () => ({
      installations: [],
      pathsInspected: 0,
      truncated: false,
    }),
    observeCodex: async (options) => {
      observationCalls += 1
      return {
        installation: options.installation,
        version: '0.149.1',
        privateRevision: await options.fingerprint(),
        compatibility: {
          state: 'verified',
          runtimeReadiness: 'ready',
          contractVersion: 1,
          capabilities: {
            execution: supported,
            streaming: supported,
            nativeResume: supported,
            nativeSessionDiscovery: supported,
            fileRead: policyDisabled,
            search: policyDisabled,
            toolEvents: policyDisabled,
            reasoningControl: policyDisabled,
          },
        },
        backend: {
          mode: 'first_party',
          source: 'provider_settings',
          hasBaseUrl: false,
          hasApiKey: false,
          hasAuthToken: false,
          hasOAuthToken: true,
          bedrockConfigured: false,
          vertexConfigured: false,
          configurationValid: true,
          privateConfigurationRevision: 'explicit-missing-codex-backend',
          readiness: 'unknown',
        },
        runtimeEnvironment: () => ({ PATH: '' }),
      }
    },
  })
  t.after(async () => {
    await coordinator.close().catch(() => undefined)
    persistence.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 5 })
  })

  const state = coordinator.state('codex')
  assert.ok(state)
  assert.equal(observationCalls, 1)
  assert.equal(state.lifecycle.selectedInstallationId, undefined)
  assert.equal(state.lifecycle.installations.length, 1)
  assert.equal(state.lifecycle.installations[0].selected, false)
  assert.equal(state.lifecycle.installations[0].availability, 'available')
  assert.equal(state.runtime.available, false)
  const durable = persistence.getProviderLifecycle(machine.machineId, 'codex')
  assert.ok(durable)
  assert.equal(durable.selectedInstallationId, undefined)
  assert.equal(durable.installations[0].selected, false)
})

test('local lifecycle isolates one broken installation without swallowing coordinator abort', async () => {
  const controller = new AbortController()
  const observed = await observeLocalProviderCandidates(
    ['broken-codex', 'healthy-codex'],
    async (candidate) => {
      if (candidate === 'broken-codex') {
        throw new Error('synthetic test-owned observation failure')
      }
      return `${candidate}-observation`
    },
    controller.signal,
  )

  assert.deepEqual(observed, [
    {
      candidate: 'healthy-codex',
      observation: 'healthy-codex-observation',
    },
  ])

  const shutdown = new Error('synthetic lifecycle shutdown')
  controller.abort(shutdown)
  await assert.rejects(
    observeLocalProviderCandidates(
      ['candidate'],
      async () => {
        throw shutdown
      },
      controller.signal,
    ),
    (error) => error === shutdown,
  )
})

test('local startup isolates a provider-wide probe failure and preserves the healthy provider lifecycle', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-phase8b-local-provider-isolation-'),
  )
  const databasePath = join(directory, 'codetether.sqlite3')
  const claudeExecutable = join(directory, 'test-owned-claude')
  await writeFile(claudeExecutable, 'test-owned-claude-fixture', 'utf8')
  const persistence = ConversationStore.open({ databasePath })
  const machine = persistence.listMachines()[0]
  assert.ok(machine)
  const fixture = {
    directory,
    machineId: machine.machineId,
    persistence,
  }
  recordLifecycle(fixture)
  const claudeInstallation = {
    launcherPath: claudeExecutable,
    launcher: {
      kind: 'native',
      launcherPath: claudeExecutable,
      executable: claudeExecutable,
      prefixArguments: [],
      sourcePath: claudeExecutable,
    },
    fileIdentity: 'test-owned-healthy-claude',
    launcherKind: 'native',
    installMethod: 'manual',
  }
  const supported = {
    observed: 'supported',
    enabled: true,
    effective: true,
  }
  const coordinator = await LocalProviderLifecycleCoordinator.create({
    machineId: machine.machineId,
    persistence,
    hostVersion: 'phase8b-provider-failure-isolation-test',
    environment: { PATH: '' },
    platform: process.platform,
    now: () => new Date(changedAt),
    discoverCodex: async () => {
      throw new Error('test-owned provider-wide Codex discovery failure')
    },
    discoverClaude: async () => ({
      installations: [claudeInstallation],
      pathsInspected: 1,
      truncated: false,
    }),
    observeClaude: async (options) => ({
      installation: options.installation,
      version: '2.1.263',
      privateRevision: await options.fingerprint(),
      compatibility: {
        state: 'verified',
        runtimeReadiness: 'ready',
        contractVersion: 1,
        capabilities: {
          execution: supported,
          streaming: supported,
          nativeResume: supported,
          nativeSessionDiscovery: supported,
          fileRead: supported,
          search: supported,
          toolEvents: supported,
          reasoningControl: supported,
        },
      },
      backend: {
        mode: 'custom_gateway',
        source: 'process_environment',
        hasBaseUrl: true,
        hasApiKey: false,
        hasAuthToken: true,
        hasOAuthToken: false,
        bedrockConfigured: false,
        vertexConfigured: false,
        configurationValid: true,
        sanitizedOrigin: 'gateway.example.test',
        privateConfigurationRevision: 'b'.repeat(64),
        readiness: 'unknown',
      },
      runtimeEnvironment: () => ({ PATH: '' }),
    }),
  })
  t.after(async () => {
    await coordinator.close().catch(() => undefined)
    persistence.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 5 })
  })

  const failedCodex = coordinator.state('codex')
  assert.ok(failedCodex)
  assert.equal(failedCodex.runtime.available, false)
  const failedSelected = selectedInstallation(failedCodex.lifecycle)
  assert.equal(failedSelected.availability, 'unavailable')
  assert.equal(failedSelected.compatibility.state, 'unavailable')
  assert.equal(
    failedSelected.compatibility.failure.reason,
    'provider_start_failed',
  )
  assert.equal(
    selectedInstallation(
      persistence.getProviderLifecycle(machine.machineId, 'codex'),
    ).availability,
    'unavailable',
  )

  const healthyClaude = coordinator.state('claude-code')
  assert.ok(healthyClaude)
  assert.notEqual(healthyClaude.runtime.available, false)
  const healthySelected = selectedInstallation(healthyClaude.lifecycle)
  assert.equal(healthySelected.availability, 'available')
  assert.equal(healthySelected.compatibility.state, 'verified')
  assert.equal(
    selectedInstallation(
      persistence.getProviderLifecycle(machine.machineId, 'claude-code'),
    ).compatibility.state,
    'verified',
  )
})

test('discarded coordinator preparation neither replaces its cached runtime nor publishes its observation', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-phase8b-local-stage-'),
  )
  const databasePath = join(directory, 'codetether.sqlite3')
  const executable = join(directory, 'test-owned-codex.exe')
  await writeFile(executable, '#!/bin/sh\nexit 1\n', 'utf8')
  await chmod(executable, 0o755)
  const persistence = ConversationStore.open({ databasePath })
  const machine = persistence.listMachines()[0]
  assert.ok(machine)
  let now = observedAt
  const candidate = {
    launcherPath: executable,
    executable,
    fileIdentity: 'test-owned-staged-codex',
    launcherKind: 'native',
    installMethod: 'manual',
  }
  const supported = {
    observed: 'supported',
    enabled: true,
    effective: true,
  }
  const coordinator = await LocalProviderLifecycleCoordinator.create({
    machineId: machine.machineId,
    persistence,
    hostVersion: 'phase8b-staged-refresh-test',
    codexExecutable: executable,
    environment: { PATH: '' },
    platform: process.platform,
    now: () => new Date(now),
    discoverCodex: async () => ({
      installations: [candidate],
      pathsInspected: 1,
      truncated: false,
    }),
    observeCodex: async (options) => ({
      installation: options.installation,
      version: '0.149.1',
      privateRevision: await options.fingerprint(),
      compatibility: {
        state: 'verified',
        runtimeReadiness: 'ready',
        contractVersion: 1,
        capabilities: {
          execution: supported,
          streaming: supported,
          nativeResume: supported,
          nativeSessionDiscovery: supported,
          fileRead: supported,
          search: supported,
          toolEvents: supported,
          reasoningControl: supported,
        },
      },
      backend: {
        mode: 'first_party',
        source: 'provider_settings',
        hasBaseUrl: false,
        hasApiKey: false,
        hasAuthToken: false,
        hasOAuthToken: true,
        bedrockConfigured: false,
        vertexConfigured: false,
        configurationValid: true,
        privateConfigurationRevision: 'staged-codex-backend',
        readiness: 'unknown',
      },
      runtimeEnvironment: () => ({ PATH: '' }),
    }),
  })
  t.after(async () => {
    await coordinator.close().catch(() => undefined)
    persistence.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 5 })
  })
  const accepted = coordinator.state('codex')
  assert.ok(accepted)
  const acceptedObservedAt = selectedInstallation(
    persistence.getProviderLifecycle(machine.machineId, 'codex'),
  ).lastObservedAt

  await writeFile(executable, '#!/bin/sh\nexit 2\n', 'utf8')
  const superseded = await coordinator.prepareRefresh('codex')
  assert.throws(superseded.commit, /Provider lifecycle refresh was superseded/u)
  await superseded.discard()
  assert.equal(coordinator.state('codex'), accepted)
  assert.equal(
    selectedInstallation(
      persistence.getProviderLifecycle(machine.machineId, 'codex'),
    ).lastObservedAt,
    acceptedObservedAt,
  )

  now = changedAt
  const staged = await coordinator.prepareRefresh('codex')
  assert.notEqual(staged.runtime, accepted.runtime)
  assert.equal(coordinator.state('codex'), accepted)
  assert.equal(
    selectedInstallation(
      persistence.getProviderLifecycle(machine.machineId, 'codex'),
    ).lastObservedAt,
    acceptedObservedAt,
  )

  await staged.discard()
  assert.equal(coordinator.state('codex'), accepted)
  assert.equal(
    selectedInstallation(
      persistence.getProviderLifecycle(machine.machineId, 'codex'),
    ).lastObservedAt,
    acceptedObservedAt,
  )
  assert.throws(staged.commit, /Discarded Provider lifecycle refresh/u)
})

test('a missing selected installation never falls back to an available alternate or queues a Prompt', async (t) => {
  const fixture = await createFixture(t, {
    seedLegacyConversation: true,
    selectedUnavailable: true,
  })

  const detail = fixture.service.getConversation(fixture.legacyConversationId)
  assert.equal(detail.conversation.conversationId, fixture.legacyConversationId)
  const machine = await fixture.service.getMachine(fixture.machineId)
  const lifecycle = machine.providerLifecycles[0]
  assert.equal(lifecycle.selectedInstallationId, installationAId)
  assert.equal(
    selectedInstallation(lifecycle).compatibility.state,
    'unavailable',
  )
  const alternate = lifecycle.installations.find(
    ({ installationId }) => installationId === installationBId,
  )
  assert.equal(alternate.availability, 'available')

  await assert.rejects(
    fixture.service.startTurn(fixture.legacyConversationId, {
      actionId: 'act_phase8b_missing_selected_turn',
      input: { type: 'text', text: 'Do not defer or replay this Prompt.' },
    }),
    (error) =>
      error instanceof HostServiceError &&
      error.code === 'provider_unavailable',
  )
  await assert.rejects(
    fixture.service.createConversation({
      actionId: 'act_phase8b_missing_selected_create',
      projectId: fixture.projectId,
      machineId: fixture.machineId,
      provider: 'codex',
    }),
    (error) =>
      error instanceof HostServiceError &&
      error.code === 'provider_unavailable',
  )
  assert.equal(fixture.runtime.startConversationCalls.length, 0)
  assert.equal(fixture.runtime.resumeConversationCalls.length, 0)
  assert.equal(fixture.runtime.startTurnCalls.length, 0)
  assert.equal(
    fixture.persistence.getTurnForStartAction(
      'act_phase8b_missing_selected_turn',
    ),
    undefined,
  )
  assert.equal(fixture.persistence.listConversations().length, 1)
})

test('a successful later Turn restores backend readiness without rewriting the historical failed Turn', async (t) => {
  const failedAt = '2026-10-06T12:02:00.000Z'
  const recoveredAt = '2026-10-06T12:03:00.000Z'
  let now = observedAt
  const fixture = await createFixture(t, {
    backendReadiness: 'unavailable',
    now: () => new Date(now),
  })
  const created = await fixture.service.createConversation({
    actionId: 'act_phase8b_backend_recovery_create',
    projectId: fixture.projectId,
    machineId: fixture.machineId,
    provider: 'codex',
  })
  const conversationId = created.data.conversation.conversationId

  const failedTurn = await fixture.service.startTurn(conversationId, {
    actionId: 'act_phase8b_backend_recovery_failed',
    input: { type: 'text', text: 'Observe one isolated backend failure.' },
  })
  const failure = canonicalFailure('provider_service_unavailable', failedAt)
  now = failedAt
  fixture.runtime.emit({
    provider: 'codex',
    type: 'turn.failed',
    threadId: 'private-new-session-1',
    turnId: 'private-turn-1',
    timestamp: failedAt,
    error: {
      message: 'Private fixture backend diagnostic',
      failure,
    },
  })

  const failedBackend =
    fixture.persistence.getProviderInstallation(installationAId).backend
  assert.equal(failedBackend.readiness, 'unavailable')
  assert.equal(failedBackend.failure.reason, 'provider_service_unavailable')
  const historicalFailure = fixture.persistence.getTurn(
    failedTurn.data.turn.turnId,
  ).snapshot.turn.error
  assert.equal(historicalFailure.failure.reason, 'provider_service_unavailable')

  now = recoveredAt
  const recoveredTurn = await fixture.service.startTurn(conversationId, {
    actionId: 'act_phase8b_backend_recovery_success',
    input: { type: 'text', text: 'Explicitly try again after recovery.' },
  })
  fixture.runtime.emit({
    provider: 'codex',
    type: 'turn.completed',
    threadId: 'private-new-session-1',
    turnId: 'private-turn-2',
    timestamp: recoveredAt,
    finalMessage: 'Recovered',
  })

  const recoveredInstallation =
    fixture.persistence.getProviderInstallation(installationAId)
  assert.equal(recoveredInstallation.backend.readiness, 'ready')
  assert.equal(recoveredInstallation.backend.failure, undefined)
  assert.equal(
    selectedInstallation(
      (await fixture.service.getMachine(fixture.machineId))
        .providerLifecycles[0],
    ).backend.readiness,
    'ready',
  )
  assert.equal(
    fixture.persistence.getTurn(recoveredTurn.data.turn.turnId).status,
    'completed',
  )
  assert.deepEqual(
    fixture.persistence.getTurn(failedTurn.data.turn.turnId).snapshot.turn
      .error,
    historicalFailure,
  )
  assert.throws(
    () =>
      fixture.persistence.recordProviderBackendObservation(
        installationAId,
        revisionA2,
        backendObservation('ready', recoveredAt),
      ),
    /stale installation revision/u,
  )

  const authenticationAt = '2026-10-06T12:04:00.000Z'
  now = authenticationAt
  await fixture.service.startTurn(conversationId, {
    actionId: 'act_phase8b_backend_auth_required',
    input: { type: 'text', text: 'Observe authentication readiness.' },
  })
  fixture.runtime.emit({
    provider: 'codex',
    type: 'turn.failed',
    threadId: 'private-new-session-1',
    turnId: 'private-turn-3',
    timestamp: authenticationAt,
    error: {
      message: 'Private fixture authentication diagnostic',
      failure: canonicalFailure('authentication_invalid', authenticationAt),
    },
  })
  assert.equal(
    fixture.persistence.getProviderInstallation(installationAId).backend
      .readiness,
    'authentication_required',
  )

  const misconfiguredAt = '2026-10-06T12:05:00.000Z'
  now = misconfiguredAt
  await fixture.service.startTurn(conversationId, {
    actionId: 'act_phase8b_backend_misconfigured',
    input: { type: 'text', text: 'Observe configuration readiness.' },
  })
  fixture.runtime.emit({
    provider: 'codex',
    type: 'turn.failed',
    threadId: 'private-new-session-1',
    turnId: 'private-turn-4',
    timestamp: misconfiguredAt,
    error: {
      message: 'Private fixture configuration diagnostic',
      failure: canonicalFailure('provider_misconfigured', misconfiguredAt),
    },
  })
  const misconfigured =
    fixture.persistence.getProviderInstallation(installationAId).backend
  assert.equal(misconfigured.readiness, 'misconfigured')
  assert.equal(misconfigured.failure.reason, 'provider_misconfigured')
  assert.equal(misconfigured.observedAt, misconfiguredAt)
})

test('Host refresh presents an unchanged unchecked backend as last-known without changing runtime compatibility', async (t) => {
  let fixture
  fixture = await createFixture(t, {
    refreshLocalProviderLifecycle: async (provider) => {
      assert.equal(provider, 'codex')
      return {
        runtime: fixture.runtime,
        lifecycle: recordLifecycle(fixture, {
          timestamp: changedAt,
          backendReadiness: 'unknown',
        }),
      }
    },
  })

  const response = await fixture.service.refreshMachineProviders(
    fixture.machineId,
    { actionId: 'act_phase8b_backend_metadata_refresh' },
  )
  const selected = selectedInstallation(response.data.providerLifecycles[0])
  assert.equal(selected.compatibility.state, 'verified')
  assert.equal(selected.compatibility.freshness, 'current')
  assert.equal(selected.compatibility.observedAt, changedAt)
  assert.equal(selected.backend.readiness, 'ready')
  assert.equal(selected.backend.freshness, 'last_known')
  assert.equal(selected.backend.observedAt, observedAt)
  assert.equal(fixture.runtime.startTurnCalls.length, 0)
  assert.deepEqual(fixture.persistence.listConversations(), [])
})

test('native-resume loss blocks an adopted binding before Turn durability but permits a fresh current session', async (t) => {
  const fixture = await createFixture(t, {
    seedNativeBoundConversation: true,
    compatibilityState: 'limited',
    nativeResumeSupported: false,
  })
  const adoptedDetail = fixture.service.getConversation(
    fixture.nativeBoundConversationId,
  )
  assert.equal(adoptedDetail.providerSessionRequiresResume, true)
  assert.equal(
    adoptedDetail.providerLifecycle.compatibility.capabilities.nativeResume
      .effective,
    false,
  )
  const machine = await fixture.service.getMachine(fixture.machineId)
  const codex = machine.providers.find(({ provider }) => provider === 'codex')
  assert.ok(codex)
  assert.equal(codex.capabilities.streaming, true)
  assert.equal(codex.capabilities.resume, false)

  await assert.rejects(
    fixture.service.startTurn(fixture.nativeBoundConversationId, {
      actionId: 'act_phase8b_native_resume_blocked',
      input: { type: 'text', text: 'This Prompt must not cross the boundary.' },
    }),
    (error) =>
      error instanceof HostServiceError &&
      error.code === 'provider_unavailable',
  )
  assert.equal(
    fixture.persistence.getTurnForStartAction(
      'act_phase8b_native_resume_blocked',
    ),
    undefined,
  )
  assert.equal(fixture.runtime.resumeConversationCalls.length, 0)
  assert.equal(fixture.runtime.startTurnCalls.length, 0)

  const fresh = await fixture.service.createConversation({
    actionId: 'act_phase8b_native_resume_fresh_create',
    projectId: fixture.projectId,
    machineId: fixture.machineId,
    provider: 'codex',
  })
  const freshId = fresh.data.conversation.conversationId
  assert.equal(
    fixture.service.getConversation(freshId).providerSessionRequiresResume,
    false,
  )
  await fixture.service.startTurn(freshId, {
    actionId: 'act_phase8b_native_resume_fresh_turn',
    input: { type: 'text', text: 'A fresh Provider session may execute.' },
  })
  assert.equal(fixture.runtime.startConversationCalls.length, 1)
  assert.equal(fixture.runtime.resumeConversationCalls.length, 0)
  assert.equal(fixture.runtime.startTurnCalls.length, 1)
})

test('native-resume loss permits a genuinely uninitialized remote Conversation to materialize its first session', async (t) => {
  const fixture = await createRemoteUninitializedFixture(t)
  const created = await fixture.service.createConversation({
    actionId: 'act_phase8b_remote_uninitialized_create',
    projectId: fixture.projectId,
    machineId: remoteMachineId,
    provider: 'codex',
  })
  const conversationId = created.data.conversation.conversationId
  const durableBeforeTurn = fixture.persistence.getConversation(conversationId)
  assert.ok(durableBeforeTurn)
  assert.equal(durableBeforeTurn.providerThreadId, undefined)
  assert.equal(durableBeforeTurn.providerSessionMaterialized, false)
  assert.equal(durableBeforeTurn.providerInstallationId, remoteInstallationId)

  const detail = fixture.service.getConversation(conversationId)
  assert.equal(detail.providerSessionRequiresResume, false)
  assert.equal(
    detail.providerLifecycle.compatibility.capabilities.nativeResume.effective,
    false,
  )
  assert.equal(fixture.coordinator.openCodexCalls.length, 0)

  const started = await fixture.service.startTurn(conversationId, {
    actionId: 'act_phase8b_remote_uninitialized_turn',
    input: { type: 'text', text: 'Materialize exactly one fresh Session.' },
  })
  assert.equal(started.status, 'accepted')
  assert.equal(fixture.coordinator.openCodexCalls.length, 1)
  assert.equal(
    fixture.coordinator.openCodexCalls[0].providerInstallationId,
    remoteInstallationId,
  )
  assert.equal(
    fixture.coordinator.openCodexCalls[0].expectedInstallationRevision,
    remoteRevision,
  )
  assert.equal(
    Object.hasOwn(fixture.coordinator.openCodexCalls[0], 'providerThreadId'),
    false,
  )
  assert.equal(fixture.coordinator.remoteTurnCalls.length, 1)
  await waitFor(
    () =>
      fixture.persistence.getTurn(started.data.turn.turnId)?.status ===
      'completed',
    'fresh remote Turn completion',
  )
  assert.equal(
    fixture.persistence.getTurnForStartAction(
      'act_phase8b_remote_uninitialized_turn',
    )?.turnId,
    started.data.turn.turnId,
  )
  assert.equal(
    fixture.service.getConversation(conversationId)
      .providerSessionRequiresResume,
    false,
  )
})

test('an offline remote Machine presents persisted backend readiness as last-known with its original timestamp', async (t) => {
  const fixture = await createRemoteUninitializedFixture(t)
  const current = await fixture.service.getMachine(remoteMachineId)
  const currentBackend = selectedInstallation(
    current.providerLifecycles[0],
  ).backend
  assert.equal(current.machine.connectionState, 'online')
  assert.equal(currentBackend.readiness, 'ready')
  assert.equal(currentBackend.freshness, 'current')
  assert.equal(currentBackend.observedAt, observedAt)

  fixture.coordinator.online = false
  const offline = await fixture.service.getMachine(remoteMachineId)
  const lastKnownBackend = selectedInstallation(
    offline.providerLifecycles[0],
  ).backend
  assert.equal(offline.machine.connectionState, 'offline')
  assert.equal(lastKnownBackend.readiness, 'ready')
  assert.equal(lastKnownBackend.freshness, 'last_known')
  assert.equal(lastKnownBackend.observedAt, observedAt)
  assert.equal(
    fixture.persistence.getProviderInstallation(remoteInstallationId).backend
      .freshness,
    'current',
  )
})

test('newer remote Provider discovery cannot admit a stale lifecycle revision or create Turn ownership', async (t) => {
  const fixture = await createRemoteUninitializedFixture(t)
  const created = await fixture.service.createConversation({
    actionId: 'act_phase8b_remote_stale_lifecycle_create',
    projectId: fixture.projectId,
    machineId: remoteMachineId,
    provider: 'codex',
  })
  const conversationId = created.data.conversation.conversationId

  fixture.persistence.recordRemoteProviderObservation({
    machineId: remoteMachineId,
    providers: remoteProviderDescriptors(),
    observedAt: changedAt,
  })
  fixture.coordinator.providerObservedAt = changedAt

  const machine = await fixture.service.getMachine(remoteMachineId)
  assert.equal(machine.machine.connectionState, 'online')
  assert.equal(machine.providerDiscovery.state, 'current')
  const selected = selectedInstallation(machine.providerLifecycles[0])
  assert.equal(selected.lastObservedAt, observedAt)
  assert.equal(selected.compatibility.freshness, 'last_known')

  await assert.rejects(
    fixture.service.startTurn(conversationId, {
      actionId: 'act_phase8b_remote_stale_lifecycle_turn',
      input: {
        type: 'text',
        text: 'This Prompt must not cross a stale lifecycle boundary.',
      },
    }),
    (error) =>
      error instanceof HostServiceError &&
      error.code === 'provider_unavailable',
  )
  assert.equal(
    fixture.persistence.getTurnForStartAction(
      'act_phase8b_remote_stale_lifecycle_turn',
    ),
    undefined,
  )
  assert.equal(fixture.coordinator.openCodexCalls.length, 0)
  assert.equal(fixture.coordinator.remoteTurnCalls.length, 0)
  const durable = fixture.persistence.getConversation(conversationId)
  assert.equal(durable.providerThreadId, undefined)
  assert.equal(durable.providerSessionMaterialized, false)

  fixture.coordinator.online = false
  const history = fixture.service.getConversation(conversationId)
  assert.equal(history.conversation.conversationId, conversationId)
  assert.equal(history.providerLifecycle.compatibility.freshness, 'last_known')
})

test('in-place revision replacement preserves installation identity, binds legacy and new Conversations, and never replays an active Turn', async (t) => {
  const replacement = new TrackingRuntime(installationAId, revisionA2)
  let refreshCalls = 0
  let fixture
  fixture = await createFixture(t, {
    seedLegacyConversation: true,
    refreshLocalProviderLifecycle: async (provider) => {
      assert.equal(provider, 'codex')
      refreshCalls += 1
      const lifecycle = recordLifecycle(fixture, {
        revision: revisionA2,
        timestamp: changedAt,
      })
      return { runtime: replacement, lifecycle }
    },
  })

  assert.equal(
    fixture.persistence.getConversation(fixture.legacyConversationId)
      .providerInstallationId,
    undefined,
  )
  const started = await fixture.service.startTurn(
    fixture.legacyConversationId,
    {
      actionId: 'act_phase8b_legacy_revision_turn',
      input: { type: 'text', text: 'Continue once on the updated runtime.' },
    },
  )
  assert.equal(refreshCalls, 1)
  assert.equal(fixture.runtime.closeCalls, 1)
  assert.equal(replacement.resumeConversationCalls.length, 1)
  assert.equal(replacement.startTurnCalls.length, 1)
  assert.equal(
    fixture.persistence.getConversation(fixture.legacyConversationId)
      .providerInstallationId,
    installationAId,
  )
  assert.equal(
    fixture.persistence.getProviderInstallation(installationAId).revision,
    revisionA2,
  )

  const duplicate = await fixture.service.startTurn(
    fixture.legacyConversationId,
    {
      actionId: 'act_phase8b_legacy_revision_turn',
      input: { type: 'text', text: 'Continue once on the updated runtime.' },
    },
  )
  assert.deepEqual(duplicate, started)
  assert.equal(replacement.startTurnCalls.length, 1)

  await fixture.service.refreshMachineProviders(fixture.machineId, {
    actionId: 'act_phase8b_active_turn_refresh',
  })
  assert.equal(refreshCalls, 1)
  assert.equal(replacement.closeCalls, 0)

  const created = await fixture.service.createConversation({
    actionId: 'act_phase8b_post_revision_create',
    projectId: fixture.projectId,
    machineId: fixture.machineId,
    provider: 'codex',
  })
  assert.equal(
    fixture.persistence.getConversation(
      created.data.conversation.conversationId,
    ).providerInstallationId,
    installationAId,
  )
  assert.equal(replacement.startConversationCalls.length, 1)
  assert.equal(refreshCalls, 1)
})

test('failed local runtime handoff discards the staged replacement and preserves accepted lifecycle truth', async (t) => {
  const firstReplacement = new TrackingRuntime(installationAId, revisionA2)
  const secondReplacement = new TrackingRuntime(installationAId, revisionA2)
  const closeFailure = new Error('test-owned exact runtime cleanup failed')
  let refreshCalls = 0
  let commitCalls = 0
  let discardCalls = 0
  let fixture
  fixture = await createFixture(t, {
    refreshLocalProviderLifecycle: async (provider) => {
      assert.equal(provider, 'codex')
      refreshCalls += 1
      const replacement =
        refreshCalls === 1 ? firstReplacement : secondReplacement
      const lifecycle = publicLifecycle({ revision: revisionA2 })
      let finalized = false
      return {
        runtime: replacement,
        lifecycle,
        commit: () => {
          assert.equal(finalized, false)
          finalized = true
          commitCalls += 1
          return recordLifecycle(fixture, {
            revision: revisionA2,
            timestamp: changedAt,
          })
        },
        discard: async () => {
          if (finalized) return
          finalized = true
          discardCalls += 1
          await replacement.close()
        },
      }
    },
  })
  fixture.runtime.closeError = closeFailure

  await assert.rejects(
    fixture.service.refreshMachineProviders(fixture.machineId, {
      actionId: 'act_phase8b_failed_local_handoff_01',
    }),
    (error) => error === closeFailure,
  )
  assert.equal(commitCalls, 0)
  assert.equal(discardCalls, 1)
  assert.equal(firstReplacement.closeCalls, 1)
  assert.equal(
    selectedInstallation(
      (await fixture.service.getMachine(fixture.machineId))
        .providerLifecycles[0],
    ).revision,
    revisionA1,
  )
  assert.equal(
    fixture.persistence.getProviderInstallation(installationAId).revision,
    revisionA1,
  )

  fixture.runtime.closeError = undefined
  await fixture.service.refreshMachineProviders(fixture.machineId, {
    actionId: 'act_phase8b_failed_local_handoff_02',
  })
  assert.equal(refreshCalls, 2)
  assert.equal(commitCalls, 1)
  assert.equal(discardCalls, 1)
  assert.equal(firstReplacement.startConversationCalls.length, 0)
  assert.equal(secondReplacement.closeCalls, 0)
  assert.equal(
    selectedInstallation(
      (await fixture.service.getMachine(fixture.machineId))
        .providerLifecycles[0],
    ).revision,
    revisionA2,
  )
})

for (const failurePoint of ['replacement assertion', 'lifecycle commit']) {
  test(`${failurePoint} preserves staged cleanup uncertainty ahead of the original handoff error`, async (t) => {
    const cleanupFailure = new CodexOwnedProcessCleanupError()
    const originalFailure = new Error(`test-owned ${failurePoint} failure`)
    const replacement = new TrackingRuntime(installationAId, revisionA2)
    let discardCalls = 0
    let fixture
    fixture = await createFixture(t, {
      refreshLocalProviderLifecycle: async (provider) => {
        assert.equal(provider, 'codex')
        const lifecycle = publicLifecycle({
          revision:
            failurePoint === 'replacement assertion' ? revisionB : revisionA2,
        })
        return {
          runtime: replacement,
          lifecycle,
          commit: () => {
            if (failurePoint === 'lifecycle commit') throw originalFailure
            return lifecycle
          },
          discard: async () => {
            discardCalls += 1
            throw cleanupFailure
          },
        }
      },
    })

    await assert.rejects(
      fixture.service.refreshMachineProviders(fixture.machineId, {
        actionId: `act_phase8c_${failurePoint.replace(' ', '_')}_cleanup`,
      }),
      (error) =>
        error instanceof HostServiceError &&
        error.failure?.reason === 'execution_ownership_uncertain',
    )
    assert.equal(discardCalls, 1)
    assert.equal(replacement.startConversationCalls.length, 0)
    assert.equal(replacement.startTurnCalls.length, 0)
  })
}

test('aggregated teardown retains its nested canonical ownership barrier ahead of unrelated failures', async (t) => {
  const retainedFailure = canonicalFailure(
    'execution_ownership_uncertain',
    changedAt,
  )
  const cleanupFailure = new HostServiceError(
    'provider_unavailable',
    'test-owned cleanup barrier',
    503,
    undefined,
    retainedFailure,
  )
  const replacement = new TrackingRuntime(installationAId, revisionA2)
  let fixture
  fixture = await createFixture(t, {
    refreshLocalProviderLifecycle: async () => ({
      runtime: replacement,
      lifecycle: publicLifecycle({ revision: revisionB }),
      discard: async () => {
        throw new AggregateError(
          [new Error('test-owned unrelated teardown failure'), cleanupFailure],
          'test-owned aggregated teardown failure',
        )
      },
    }),
  })

  await assert.rejects(
    fixture.service.refreshMachineProviders(fixture.machineId, {
      actionId: 'act_phase8c_aggregated_cleanup_barrier',
    }),
    (error) =>
      error instanceof HostServiceError &&
      error.failure?.reason === 'execution_ownership_uncertain' &&
      error.failure.occurredAt === changedAt,
  )
  const machine = await fixture.service.getMachine(fixture.machineId)
  const provider = machine.providers.find(
    (candidate) => candidate.provider === 'codex',
  )
  assert.ok(provider)
  assert.deepEqual(provider.executionHealth?.failure, retainedFailure)
  assert.equal(replacement.startConversationCalls.length, 0)
  assert.equal(replacement.startTurnCalls.length, 0)
})

test('concurrent local lifecycle refreshes coalesce and create no Conversation, Turn, or Provider execution ownership', async (t) => {
  const gate = deferred()
  const replacement = new TrackingRuntime(installationAId, revisionA2)
  let refreshCalls = 0
  let fixture
  fixture = await createFixture(t, {
    refreshLocalProviderLifecycle: async (provider) => {
      assert.equal(provider, 'codex')
      refreshCalls += 1
      await gate.promise
      const lifecycle = recordLifecycle(fixture, {
        revision: revisionA2,
        timestamp: changedAt,
      })
      return { runtime: replacement, lifecycle }
    },
  })

  const first = fixture.service.refreshMachineProviders(fixture.machineId, {
    actionId: 'act_phase8b_refresh_coalesce_01',
  })
  const second = fixture.service.refreshMachineProviders(fixture.machineId, {
    actionId: 'act_phase8b_refresh_coalesce_02',
  })
  await waitFor(() => refreshCalls === 1, 'coalesced lifecycle refresh')
  gate.resolve()
  const [firstResult, secondResult] = await Promise.all([first, second])

  assert.equal(refreshCalls, 1)
  assert.equal(fixture.runtime.closeCalls, 1)
  assert.equal(
    selectedInstallation(firstResult.data.providerLifecycles[0]).revision,
    revisionA2,
  )
  assert.equal(
    selectedInstallation(secondResult.data.providerLifecycles[0]).revision,
    revisionA2,
  )
  assert.deepEqual(fixture.persistence.listConversations(), [])
  assert.deepEqual(fixture.service.snapshot().conversations, [])
  for (const runtime of [fixture.runtime, replacement]) {
    assert.equal(runtime.startConversationCalls.length, 0)
    assert.equal(runtime.resumeConversationCalls.length, 0)
    assert.equal(runtime.startTurnCalls.length, 0)
  }
})

test('local Conversation creation holds Provider handoff ownership through native session binding', async (t) => {
  const nativeStartGate = deferred()
  const replacement = new TrackingRuntime(installationAId, revisionA2)
  let refreshCalls = 0
  let fixture
  fixture = await createFixture(t, {
    refreshLocalProviderLifecycle: async (provider) => {
      assert.equal(provider, 'codex')
      refreshCalls += 1
      if (refreshCalls === 1) {
        return {
          runtime: fixture.runtime,
          lifecycle: recordLifecycle(fixture),
        }
      }
      return {
        runtime: replacement,
        lifecycle: recordLifecycle(fixture, {
          revision: revisionA2,
          timestamp: changedAt,
        }),
      }
    },
  })
  fixture.runtime.startConversationGate = nativeStartGate.promise

  const creating = fixture.service.createConversation({
    actionId: 'act_phase8c_local_create_handoff',
    projectId: fixture.projectId,
    machineId: fixture.machineId,
    provider: 'codex',
  })
  await waitFor(
    () => fixture.runtime.startConversationCalls.length === 1,
    'native Conversation creation',
  )
  const refreshing = fixture.service.refreshMachineProviders(
    fixture.machineId,
    { actionId: 'act_phase8c_local_create_handoff_refresh' },
  )
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(refreshCalls, 1)
  assert.equal(fixture.runtime.closeCalls, 0)
  nativeStartGate.resolve()
  const [created] = await Promise.all([creating, refreshing])

  assert.equal(created.status, 'completed')
  assert.equal(refreshCalls, 2)
  assert.equal(fixture.runtime.closeCalls, 1)
  assert.equal(replacement.startConversationCalls.length, 0)
  assert.equal(replacement.startTurnCalls.length, 0)
  assert.equal(fixture.persistence.listConversations().length, 1)
})

test('local Turn admission blocks a changed-runtime refresh until starting ownership is visible', async (t) => {
  const hydrationCleanupGate = deferred()
  const replacement = new TrackingRuntime(installationAId, revisionA2)
  let refreshCalls = 0
  let fixture
  fixture = await createFixture(t, {
    seedLegacyConversation: true,
    seedHydrationContention: true,
    maxConversations: 1,
    refreshLocalProviderLifecycle: async (provider) => {
      assert.equal(provider, 'codex')
      refreshCalls += 1
      return {
        runtime: refreshCalls === 1 ? fixture.runtime : replacement,
        lifecycle: recordLifecycle(fixture, {
          revision: refreshCalls === 1 ? revisionA1 : revisionA2,
          timestamp: refreshCalls === 1 ? observedAt : changedAt,
        }),
      }
    },
  })
  fixture.runtime.disposeConversationGate = hydrationCleanupGate.promise

  const starting = fixture.service.startTurn(fixture.legacyConversationId, {
    actionId: 'act_phase8c_local_turn_handoff',
    input: { type: 'text', text: 'Admit this exact local Turn once.' },
  })
  await waitFor(
    () => fixture.runtime.disposeConversationCalls.length === 1,
    'hydration cleanup handoff',
  )
  const refreshing = fixture.service.refreshMachineProviders(
    fixture.machineId,
    { actionId: 'act_phase8c_local_turn_handoff_refresh' },
  )
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(refreshCalls, 1)
  assert.equal(fixture.runtime.closeCalls, 0)
  hydrationCleanupGate.resolve()
  const [started] = await Promise.all([starting, refreshing])

  assert.equal(started.status, 'accepted')
  assert.equal(refreshCalls, 1)
  assert.equal(fixture.runtime.closeCalls, 0)
  assert.equal(fixture.runtime.resumeConversationCalls.length, 1)
  assert.equal(fixture.runtime.startTurnCalls.length, 1)
  assert.equal(replacement.resumeConversationCalls.length, 0)
  assert.equal(replacement.startTurnCalls.length, 0)
})

test('local session scan cleanup uncertainty wins before concurrent Turn admission sends a Prompt', async (t) => {
  const scanStarted = deferred()
  const releaseScanCleanup = deferred()
  const cleanupFailure = new CodexOwnedProcessCleanupError()
  const discovery = {
    provider: 'codex',
    discover: async () => {
      scanStarted.resolve()
      await releaseScanCleanup.promise
      throw cleanupFailure
    },
    validateCandidate: async () => undefined,
  }
  const fixture = await createFixture(t, {
    seedLegacyConversation: true,
    discovery,
  })

  const scanning = fixture.service.discoverProviderSessions(
    fixture.projectId,
    fixture.machineId,
    { provider: 'codex', limit: 50, rescan: true },
  )
  const scanRejected = assert.rejects(
    scanning,
    (error) =>
      error instanceof HostServiceError &&
      error.failure?.reason === 'execution_ownership_uncertain',
  )
  await scanStarted.promise

  const actionId = 'act_phase8c_scan_cleanup_before_turn'
  const starting = fixture.service.startTurn(fixture.legacyConversationId, {
    actionId,
    input: {
      type: 'text',
      text: 'This Prompt must remain unsent behind uncertain scan cleanup.',
    },
  })
  const startRejected = assert.rejects(
    starting,
    (error) =>
      error instanceof HostServiceError &&
      error.failure?.reason === 'execution_ownership_uncertain',
  )
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(fixture.runtime.resumeConversationCalls.length, 0)
  assert.equal(fixture.runtime.startConversationCalls.length, 0)
  assert.equal(fixture.runtime.startTurnCalls.length, 0)
  releaseScanCleanup.resolve()
  await Promise.all([scanRejected, startRejected])

  assert.equal(fixture.runtime.resumeConversationCalls.length, 0)
  assert.equal(fixture.runtime.startConversationCalls.length, 0)
  assert.equal(fixture.runtime.startTurnCalls.length, 0)
  assert.equal(fixture.persistence.getTurnForStartAction(actionId), undefined)
})

test('local session scan rechecks refreshed compatibility and drops the replaced discovery adapter', async (t) => {
  const refreshEntered = deferred()
  const releaseRefresh = deferred()
  const staleDiscovery = {
    provider: 'codex',
    discoverCalls: 0,
    async discover() {
      this.discoverCalls += 1
      throw new Error('A replaced discovery adapter must not be invoked')
    },
    async validateCandidate() {
      throw new Error('A replaced discovery adapter must not validate')
    },
  }
  const replacement = new TrackingRuntime(installationAId, revisionA2)
  let fixture
  fixture = await createFixture(t, {
    discovery: staleDiscovery,
    refreshLocalProviderLifecycle: async (provider) => {
      assert.equal(provider, 'codex')
      refreshEntered.resolve()
      await releaseRefresh.promise
      return {
        runtime: replacement,
        lifecycle: recordLifecycle(fixture, {
          revision: revisionA2,
          timestamp: changedAt,
          discoverySupported: false,
        }),
      }
    },
  })

  const refreshing = fixture.service.refreshMachineProviders(
    fixture.machineId,
    { actionId: 'act_phase8c_refresh_removes_stale_discovery' },
  )
  await refreshEntered.promise
  const scanning = fixture.service.discoverProviderSessions(
    fixture.projectId,
    fixture.machineId,
    { provider: 'codex', limit: 50, rescan: true },
  )
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(staleDiscovery.discoverCalls, 0)

  releaseRefresh.resolve()
  const [, discovered] = await Promise.all([refreshing, scanning])
  assert.equal(discovered.candidates.length, 0)
  assert.equal(discovered.providers[0].status, 'unsupported')
  assert.equal(
    discovered.providers[0].failureReason,
    'provider_session_format_unsupported',
  )
  assert.equal(staleDiscovery.discoverCalls, 0)
})

test('local session candidate rechecks selected installation after waiting behind lifecycle refresh', async (t) => {
  const refreshEntered = deferred()
  const releaseRefresh = deferred()
  let validateCalls = 0
  const discovery = {
    provider: 'codex',
    async discover({ projectRoot }) {
      return {
        provider: 'codex',
        status: 'supported',
        resumeStatus: 'supported',
        candidates: [
          {
            provider: 'codex',
            nativeSessionId: 'private-stale-installation-session',
            revision: 'native-stale-installation-revision',
            workingDirectory: projectRoot,
            title: 'Stale installation candidate',
            resumeStatus: 'supported',
            historicalTranscript: 'unavailable',
          },
        ],
        metrics: {
          filesInspected: 1,
          candidatesParsed: 1,
          candidatesMatched: 1,
          corruptEntriesSkipped: 0,
          elapsedMs: 1,
          truncated: false,
        },
      }
    },
    async validateCandidate() {
      validateCalls += 1
      throw new Error('A stale installation candidate must not be validated')
    },
  }
  const replacement = new TrackingRuntime(installationAId, revisionA2)
  let fixture
  fixture = await createFixture(t, {
    discovery,
    refreshLocalProviderLifecycle: async () => {
      refreshEntered.resolve()
      await releaseRefresh.promise
      return {
        runtime: replacement,
        lifecycle: recordLifecycle(fixture, {
          revision: revisionA2,
          timestamp: changedAt,
          discoverySupported: false,
        }),
      }
    },
  })
  const discovered = await fixture.service.discoverProviderSessions(
    fixture.projectId,
    fixture.machineId,
    { provider: 'codex', limit: 50, rescan: true },
  )
  assert.equal(discovered.candidates.length, 1)

  const refreshing = fixture.service.refreshMachineProviders(
    fixture.machineId,
    { actionId: 'act_phase8c_refresh_before_candidate_validation' },
  )
  await refreshEntered.promise
  const adopting = fixture.service.adoptProviderSession(
    fixture.projectId,
    fixture.machineId,
    {
      actionId: 'act_phase8c_stale_candidate_after_refresh',
      discoveryCandidateId: discovered.candidates[0].discoveryCandidateId,
    },
  )
  const adoptRejected = assert.rejects(
    adopting,
    (error) =>
      error instanceof HostServiceError &&
      error.code === 'provider_session_candidate_expired',
  )
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(validateCalls, 0)

  releaseRefresh.resolve()
  await Promise.all([refreshing, adoptRejected])
  assert.equal(validateCalls, 0)
  assert.equal(fixture.persistence.listConversations().length, 0)
})

test('queued local scan snapshots candidates with the supported replacement installation revision', async (t) => {
  const refreshEntered = deferred()
  const releaseRefresh = deferred()
  const staleDiscovery = {
    provider: 'codex',
    discoverCalls: 0,
    async discover() {
      this.discoverCalls += 1
      throw new Error('The replaced discovery adapter must not run')
    },
    async validateCandidate() {
      throw new Error('The replaced discovery adapter must not validate')
    },
  }
  const nativeSessionId = 'private-supported-replacement-session'
  const nativeRevision = 'native-supported-replacement-revision'
  const replacementDiscovery = {
    provider: 'codex',
    discoverCalls: 0,
    validateCalls: 0,
    async discover({ projectRoot }) {
      this.discoverCalls += 1
      return {
        provider: 'codex',
        status: 'supported',
        resumeStatus: 'supported',
        candidates: [
          {
            provider: 'codex',
            nativeSessionId,
            revision: nativeRevision,
            workingDirectory: projectRoot,
            title: 'Supported replacement candidate',
            resumeStatus: 'supported',
            historicalTranscript: 'unavailable',
          },
        ],
        metrics: {
          filesInspected: 1,
          candidatesParsed: 1,
          candidatesMatched: 1,
          corruptEntriesSkipped: 0,
          elapsedMs: 1,
          truncated: false,
        },
      }
    },
    async validateCandidate({ projectRoot }) {
      this.validateCalls += 1
      return {
        provider: 'codex',
        nativeSessionId,
        revision: nativeRevision,
        workingDirectory: projectRoot,
        title: 'Supported replacement candidate',
        resumeStatus: 'supported',
        historicalTranscript: 'unavailable',
      }
    },
  }
  const replacement = new TrackingRuntime(installationAId, revisionA2)
  let fixture
  fixture = await createFixture(t, {
    discovery: staleDiscovery,
    refreshLocalProviderLifecycle: async () => {
      refreshEntered.resolve()
      await releaseRefresh.promise
      return {
        runtime: replacement,
        lifecycle: recordLifecycle(fixture, {
          revision: revisionA2,
          timestamp: changedAt,
          discoverySupported: true,
        }),
        sessionDiscovery: replacementDiscovery,
      }
    },
  })

  const refreshing = fixture.service.refreshMachineProviders(
    fixture.machineId,
    { actionId: 'act_phase8c_refresh_before_supported_scan' },
  )
  await refreshEntered.promise
  const scanning = fixture.service.discoverProviderSessions(
    fixture.projectId,
    fixture.machineId,
    { provider: 'codex', limit: 50, rescan: true },
  )
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(staleDiscovery.discoverCalls, 0)

  releaseRefresh.resolve()
  const [, discovered] = await Promise.all([refreshing, scanning])
  assert.equal(discovered.candidates.length, 1)
  assert.equal(replacementDiscovery.discoverCalls, 1)
  assert.equal(staleDiscovery.discoverCalls, 0)

  const adopted = await fixture.service.adoptProviderSession(
    fixture.projectId,
    fixture.machineId,
    {
      actionId: 'act_phase8c_adopt_supported_replacement_scan',
      discoveryCandidateId: discovered.candidates[0].discoveryCandidateId,
    },
  )
  assert.equal(adopted.status, 'completed')
  assert.equal(replacementDiscovery.validateCalls, 1)
  const durable = fixture.persistence.getConversation(
    adopted.data.conversation.conversationId,
  )
  assert.equal(durable.providerInstallationId, installationAId)
  assert.equal(replacement.startConversationCalls.length, 0)
  assert.equal(replacement.startTurnCalls.length, 0)
})

test('an active old installation runtime stays pinned until exact-session cleanup, then one new revision resumes it', async () => {
  const localMachineId = 'machine_phase8b_runtime_owner_local01'
  const machineId = 'machine_phase8b_runtime_owner_remote01'
  const localProviders = new ProviderRegistry([])
  const created = []
  const resolver = new MachineProviderRuntimeResolver({
    localMachineId,
    localProviders,
    createRemoteProvider: (_machineId, provider, installation) => {
      assert.equal(provider, 'codex')
      assert.ok(installation)
      const runtime = new InstallationOwnedRuntime(installation)
      created.push(runtime)
      return runtime
    },
  })
  try {
    const oldRuntime = resolver.get(machineId, 'codex', {
      installationId: installationAId,
      installationRevision: revisionA1,
    })
    assert.ok(oldRuntime)
    await oldRuntime.resumeConversation({
      providerThreadId: 'private-revision-owned-session',
    })
    oldRuntime.active = true

    const newRuntime = resolver.get(machineId, 'codex', {
      installationId: installationAId,
      installationRevision: revisionA2,
    })
    assert.ok(newRuntime)
    assert.notEqual(newRuntime, oldRuntime)
    assert.equal(
      resolver.existingSession(
        machineId,
        'codex',
        installationAId,
        'private-revision-owned-session',
      ),
      oldRuntime,
    )
    assert.equal(
      await resolver.retireObsoleteIdle(machineId, 'codex', {
        installationId: installationAId,
        installationRevision: revisionA2,
      }),
      0,
    )
    assert.equal(await resolver.retireIfIdle(oldRuntime), false)
    assert.equal(oldRuntime.closeCalls, 0)
    assert.equal(newRuntime.resumeConversationCalls.length, 0)

    oldRuntime.active = false
    await oldRuntime.disposeConversation({
      providerThreadId: 'private-revision-owned-session',
    })
    assert.equal(await resolver.retireIfIdle(oldRuntime), true)
    assert.equal(oldRuntime.closeCalls, 1)
    assert.equal(
      resolver.existingSession(
        machineId,
        'codex',
        installationAId,
        'private-revision-owned-session',
      ),
      undefined,
    )

    await newRuntime.resumeConversation({
      providerThreadId: 'private-revision-owned-session',
    })
    assert.equal(newRuntime.resumeConversationCalls.length, 1)
    assert.equal(
      resolver.existingSession(
        machineId,
        'codex',
        installationAId,
        'private-revision-owned-session',
      ),
      newRuntime,
    )
    assert.equal(created.length, 2)
  } finally {
    await resolver.close()
    await localProviders.close()
  }
})

test('repeated installation revisions retire idle cached runtimes without touching another installation', async () => {
  const localMachineId = 'machine_phase8b_revision_churn_local01'
  const machineId = 'machine_phase8b_revision_churn_remote01'
  const localProviders = new ProviderRegistry([])
  const created = []
  const resolver = new MachineProviderRuntimeResolver({
    localMachineId,
    localProviders,
    createRemoteProvider: (_machineId, _provider, installation) => {
      assert.ok(installation)
      const runtime = new InstallationOwnedRuntime(installation)
      created.push(runtime)
      return runtime
    },
  })
  try {
    const alternate = resolver.get(machineId, 'codex', {
      installationId: installationBId,
      installationRevision: revisionB,
    })
    assert.ok(alternate)
    let currentRevision = revisionA1
    let current = resolver.get(machineId, 'codex', {
      installationId: installationAId,
      installationRevision: currentRevision,
    })
    assert.ok(current)
    for (const nextRevision of [
      revisionA2,
      'prev_phase8b_host_revision_A_0003',
    ]) {
      assert.equal(
        await resolver.retireObsoleteIdle(machineId, 'codex', {
          installationId: installationAId,
          installationRevision: nextRevision,
        }),
        1,
      )
      assert.equal(current.closeCalls, 1)
      current = resolver.get(machineId, 'codex', {
        installationId: installationAId,
        installationRevision: nextRevision,
      })
      assert.ok(current)
      currentRevision = nextRevision
    }
    assert.equal(current.installation.installationRevision, currentRevision)
    assert.equal(alternate.closeCalls, 0)
    assert.deepEqual(
      resolver.remoteRuntimes().map(([, runtime]) => runtime.installation),
      [
        { installationId: installationBId, installationRevision: revisionB },
        {
          installationId: installationAId,
          installationRevision: currentRevision,
        },
      ],
    )
  } finally {
    await resolver.close()
    await localProviders.close()
  }
})

test('a pending old-revision session cleanup remains the exact owner until completion', async () => {
  const localMachineId = 'machine_phase8b_cleanup_owner_local01'
  const machineId = 'machine_phase8b_cleanup_owner_remote01'
  const localProviders = new ProviderRegistry([])
  const resolver = new MachineProviderRuntimeResolver({
    localMachineId,
    localProviders,
    createRemoteProvider: (_machineId, _provider, installation) =>
      new InstallationOwnedRuntime(installation),
  })
  try {
    const providerThreadId = 'private-pending-cleanup-session'
    const oldRuntime = resolver.get(machineId, 'codex', {
      installationId: installationAId,
      installationRevision: revisionA1,
    })
    assert.ok(oldRuntime)
    await oldRuntime.resumeConversation({ providerThreadId })
    const cleanup = deferred()
    oldRuntime.beginCleanup(providerThreadId, cleanup.promise)

    assert.equal(oldRuntime.hasConversationSession(providerThreadId), false)
    assert.equal(
      resolver.existingSession(
        machineId,
        'codex',
        installationAId,
        providerThreadId,
      ),
      oldRuntime,
    )
    assert.equal(
      await resolver.retireObsoleteIdle(machineId, 'codex', {
        installationId: installationAId,
        installationRevision: revisionA2,
      }),
      0,
    )

    let released = false
    const release = oldRuntime
      .disposeConversation({ providerThreadId })
      .then(() => {
        released = true
      })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(released, false)
    cleanup.resolve()
    await release
    assert.equal(await resolver.retireIfIdle(oldRuntime), true)
    assert.equal(oldRuntime.closeCalls, 1)
  } finally {
    await resolver.close()
    await localProviders.close()
  }
})

async function createFixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-phase8b-host-'))
  const workspace = join(directory, 'workspace')
  const databasePath = join(directory, 'codetether.sqlite3')
  await mkdir(workspace, { recursive: true })
  const persistence = ConversationStore.open({ databasePath })
  const machine = persistence.listMachines()[0]
  assert.ok(machine)
  const fixture = {
    directory,
    workspace,
    persistence,
    machineId: machine.machineId,
  }
  const storedLifecycle = recordLifecycle(fixture, {
    compatibilityState: options.compatibilityState,
    discoverySupported: options.discoverySupported,
    nativeResumeSupported: options.nativeResumeSupported,
    backendReadiness: options.backendReadiness,
    selectedUnavailable: options.selectedUnavailable,
  })
  const runtime = new TrackingRuntime(installationAId, revisionA1)
  if (options.executionHealth !== undefined) {
    runtime.descriptor = {
      ...runtime.descriptor,
      executionHealth: options.executionHealth,
    }
  }
  fixture.runtime = runtime

  if (options.seedLegacyConversation === true) {
    const root = normalizeTrustedProjectRoot(workspace)
    fixture.projectId = 'proj_phase8b_host_legacy'
    fixture.legacyConversationId = 'conv_phase8b_host_legacy'
    persistence.createProject({
      projectId: fixture.projectId,
      name: 'Lifecycle host fixture',
      locations: [
        {
          projectId: fixture.projectId,
          machineId: fixture.machineId,
          rootPath: root.rootPath,
          rootPathKey: root.rootPathKey,
          createdAt: observedAt,
          updatedAt: observedAt,
        },
      ],
      createdAt: observedAt,
      updatedAt: observedAt,
    })
    persistence.createConversation({
      conversationId: fixture.legacyConversationId,
      projectId: fixture.projectId,
      machineId: fixture.machineId,
      title: 'Pre-8B Conversation',
      titleSource: 'generated',
      provider: 'codex',
      origin: 'codetether',
      providerThreadId: 'private-provider-thread-pre8b',
      providerSessionMaterialized: true,
      cwd: root.rootPath,
      status: 'idle',
      createdAt: observedAt,
      updatedAt: observedAt,
      lastActivityAt: observedAt,
    })
    if (options.seedHydrationContention === true) {
      fixture.hydrationBlockerConversationId =
        'conv_phase8c_host_hydration_blocker'
      persistence.createConversation({
        conversationId: fixture.hydrationBlockerConversationId,
        projectId: fixture.projectId,
        machineId: fixture.machineId,
        title: 'Hydration capacity blocker',
        titleSource: 'generated',
        provider: 'codex',
        origin: 'codetether',
        providerThreadId: 'private-provider-thread-hydration-blocker',
        providerSessionMaterialized: true,
        cwd: root.rootPath,
        status: 'idle',
        createdAt: changedAt,
        updatedAt: changedAt,
        lastActivityAt: changedAt,
      })
    }
  }

  if (options.seedNativeBoundConversation === true) {
    const root = normalizeTrustedProjectRoot(workspace)
    fixture.projectId = 'proj_phase8b_host_adopted'
    fixture.nativeBoundConversationId = 'conv_phase8b_host_adopted'
    persistence.createProject({
      projectId: fixture.projectId,
      name: 'Lifecycle adopted fixture',
      locations: [
        {
          projectId: fixture.projectId,
          machineId: fixture.machineId,
          rootPath: root.rootPath,
          rootPathKey: root.rootPathKey,
          createdAt: observedAt,
          updatedAt: observedAt,
        },
      ],
      createdAt: observedAt,
      updatedAt: observedAt,
    })
    persistence.createOrGetAdoptedConversation({
      conversationId: fixture.nativeBoundConversationId,
      projectId: fixture.projectId,
      machineId: fixture.machineId,
      title: 'Adopted pre-8B Conversation',
      titleSource: 'generated',
      provider: 'codex',
      providerInstallationId: installationAId,
      providerThreadId: 'private-adopted-native-session-phase8b',
      cwd: root.rootPath,
      status: 'idle',
      createdAt: observedAt,
      updatedAt: observedAt,
      lastActivityAt: observedAt,
    })
  }

  const publicInitialLifecycle =
    options.reversePublicInstallationOrder === true
      ? {
          ...storedLifecycle,
          installations: [...storedLifecycle.installations].reverse(),
        }
      : storedLifecycle
  const service = new HostService({
    runtime,
    persistence,
    providerLifecycles: [publicInitialLifecycle],
    ...(options.discovery === undefined
      ? {}
      : { providerSessionDiscoveries: [options.discovery] }),
    ...(options.refreshLocalProviderLifecycle === undefined
      ? {}
      : {
          refreshLocalProviderLifecycle: options.refreshLocalProviderLifecycle,
        }),
    workspacePolicy: await WorkspacePolicy.create([workspace]),
    publisher: new HostEventPublisher({ epoch: newEpoch() }),
    hostVersion: 'phase8b-host-test',
    ...(options.maxConversations === undefined
      ? {}
      : { maxConversations: options.maxConversations }),
    now: options.now ?? (() => new Date(observedAt)),
  })
  fixture.service = service
  await service.registerInitialProjectRoots([workspace])
  const project = (await service.listProjects()).projects[0]
  assert.ok(project)
  fixture.projectId = project.projectId
  t.after(async () => {
    await service.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true, maxRetries: 5 })
  })
  return fixture
}

async function createNonDurableDoctorFixture(t) {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-phase8c-doctor-nondurable-'),
  )
  const workspace = join(directory, 'workspace')
  await mkdir(workspace, { recursive: true })
  const runtime = new TrackingRuntime(installationAId, revisionA1)
  const service = new HostService({
    runtime,
    providerLifecycles: [publicLifecycle({ revision: revisionA1 })],
    workspacePolicy: await WorkspacePolicy.create([workspace]),
    publisher: new HostEventPublisher({ epoch: newEpoch() }),
    hostVersion: 'phase8c-doctor-nondurable-test',
    now: () => new Date(observedAt),
  })
  await service.registerInitialProjectRoots([workspace])
  const project = (await service.listProjects()).projects[0]
  assert.ok(project)
  t.after(async () => {
    await service.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true, maxRetries: 5 })
  })
  return { service, projectId: project.projectId }
}

async function createRemoteUninitializedFixture(t) {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-phase8b-host-remote-'),
  )
  const workspace = join(directory, 'workspace')
  const databasePath = join(directory, 'codetether.sqlite3')
  await mkdir(workspace, { recursive: true })
  const persistence = ConversationStore.open({ databasePath })
  const localMachine = persistence.listMachines()[0]
  assert.ok(localMachine)
  const localRoot = normalizeTrustedProjectRoot(workspace)
  const projectId = 'proj_phase8b_host_remote_fresh'
  const remoteRoot = '/srv/codetether-phase8b-host-remote-fresh'
  persistence.createProject({
    projectId,
    name: 'Remote lifecycle fresh Session fixture',
    locations: [
      {
        projectId,
        machineId: localMachine.machineId,
        rootPath: localRoot.rootPath,
        rootPathKey: localRoot.rootPathKey,
        createdAt: observedAt,
        updatedAt: observedAt,
      },
    ],
    createdAt: observedAt,
    updatedAt: observedAt,
  })
  persistence.createRemoteMachineWithTrust(
    {
      machineId: remoteMachineId,
      displayName: 'Phase 8B remote fresh Session fixture',
      kind: 'remote',
      platform: 'Linux',
      architecture: 'x64',
      createdAt: observedAt,
    },
    {
      machineId: remoteMachineId,
      nodeIdentity: 'node_identity_phase8b_host_remote_fresh01',
      peerPublicKeySpki: new Uint8Array(64).fill(8),
      peerKeyFingerprint: 'n'.repeat(43),
      controllerCredentialRef: 'controller-phase8b-host-remote-fresh.json',
      controllerKeyFingerprint: 'c'.repeat(43),
      trustState: 'pending',
      protocolVersion: 1,
      address: { host: '192.0.2.88', port: 43_217 },
      pairedAt: observedAt,
      updatedAt: observedAt,
    },
  )
  persistence.activateTrustedMachinePeer(remoteMachineId, observedAt)
  persistence.createProjectLocation({
    projectId,
    machineId: remoteMachineId,
    rootPath: remoteRoot,
    rootPathKey: remoteRoot,
    createdAt: observedAt,
    updatedAt: observedAt,
  })
  persistence.recordRemoteProviderObservation({
    machineId: remoteMachineId,
    providers: remoteProviderDescriptors(),
    observedAt,
  })
  persistence.recordProviderLifecycle({
    machineId: remoteMachineId,
    provider: 'codex',
    observedAt,
    selectedInstallationId: remoteInstallationId,
    installations: [
      {
        installationId: remoteInstallationId,
        machineId: remoteMachineId,
        provider: 'codex',
        locatorKey: 'test-owned-remote-codex-A',
        selected: true,
        version: '0.149.1',
        launcherKind: 'symlink',
        installMethod: 'npm',
        availability: 'available',
        revision: remoteRevision,
        firstObservedAt: observedAt,
        lastObservedAt: observedAt,
        compatibility: compatibilityObservation(
          'limited',
          true,
          observedAt,
          false,
        ),
        backend: backendObservation('ready', observedAt),
      },
    ],
  })

  const coordinator = new RemoteFreshSessionCoordinator(remoteRoot)
  const runtime = new TrackingRuntime(installationAId, revisionA1)
  const service = new HostService({
    runtime,
    persistence,
    remoteMachineCoordinator: coordinator,
    workspacePolicy: await WorkspacePolicy.create([workspace]),
    publisher: new HostEventPublisher({ epoch: newEpoch() }),
    hostVersion: 'phase8b-host-remote-test',
    now: () => new Date(observedAt),
    persistenceFlushMs: 0,
  })
  t.after(async () => {
    await service.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true, maxRetries: 5 })
  })
  return { service, persistence, coordinator, projectId }
}

function recordLifecycle(
  fixture,
  {
    revision = revisionA1,
    timestamp = observedAt,
    compatibilityState = 'verified',
    discoverySupported = true,
    nativeResumeSupported = true,
    backendReadiness = 'ready',
    selectedUnavailable = false,
  } = {},
) {
  return fixture.persistence.recordProviderLifecycle({
    machineId: fixture.machineId,
    provider: 'codex',
    observedAt: timestamp,
    selectedInstallationId: installationAId,
    installations: [
      durableInstallation(fixture, {
        installationId: installationAId,
        revision,
        selected: true,
        timestamp,
        compatibilityState,
        discoverySupported,
        nativeResumeSupported,
        backendReadiness,
        availability: selectedUnavailable ? 'unavailable' : 'available',
      }),
      durableInstallation(fixture, {
        installationId: installationBId,
        revision: revisionB,
        selected: false,
        timestamp,
      }),
    ],
  })
}

function durableInstallation(
  fixture,
  {
    installationId,
    revision,
    selected,
    timestamp,
    compatibilityState = 'verified',
    discoverySupported = true,
    nativeResumeSupported = true,
    backendReadiness = 'ready',
    availability = 'available',
  },
) {
  const suffix = installationId === installationAId ? 'A' : 'B'
  const backend = backendObservation(backendReadiness, timestamp)
  return {
    installationId,
    machineId: fixture.machineId,
    provider: 'codex',
    locatorKey: `test-owned-codex-${suffix}`,
    launcherPath: join(fixture.directory, 'providers', suffix, 'codex'),
    resolvedExecutablePath: join(
      fixture.directory,
      'providers',
      suffix,
      'resolved-codex',
    ),
    selected,
    version: revision === revisionA2 ? '0.150.0' : '0.149.1',
    launcherKind: 'symlink',
    installMethod: 'npm',
    availability,
    revision,
    firstObservedAt: observedAt,
    lastObservedAt: timestamp,
    compatibility: compatibilityObservation(
      availability === 'unavailable' ? 'unavailable' : compatibilityState,
      discoverySupported,
      timestamp,
      nativeResumeSupported,
    ),
    backend,
  }
}

function publicLifecycle({ revision }) {
  const installation = {
    installationId: installationAId,
    provider: 'codex',
    selected: true,
    version: revision === revisionA2 ? '0.150.0' : '0.149.1',
    launcherKind: 'symlink',
    installMethod: 'npm',
    availability: 'available',
    revision,
    firstObservedAt: observedAt,
    lastObservedAt: revision === revisionA2 ? changedAt : observedAt,
    compatibility: compatibilityObservation(
      'verified',
      true,
      revision === revisionA2 ? changedAt : observedAt,
    ),
    backend: backendObservation(
      'ready',
      revision === revisionA2 ? changedAt : observedAt,
    ),
  }
  return {
    provider: 'codex',
    selectedInstallationId: installationAId,
    installations: [installation],
  }
}

function compatibilityObservation(
  state,
  discoverySupported,
  timestamp,
  nativeResumeSupported = true,
) {
  const executionAvailable =
    state === 'verified' ||
    state === 'compatible_unverified' ||
    state === 'limited'
  const observed =
    state === 'unavailable'
      ? 'unavailable'
      : executionAvailable
        ? 'supported'
        : 'unsupported'
  const supported = {
    observed,
    enabled: executionAvailable,
    effective: executionAvailable,
  }
  const discovery = discoverySupported
    ? supported
    : { observed: 'unsupported', enabled: true, effective: false }
  const nativeResume = nativeResumeSupported
    ? supported
    : { observed: 'unsupported', enabled: true, effective: false }
  return {
    state,
    runtimeReadiness:
      state === 'limited'
        ? 'limited'
        : state === 'incompatible'
          ? 'blocked'
          : state === 'unavailable'
            ? 'unavailable'
            : 'ready',
    freshness: 'current',
    contractVersion: 1,
    observedAt: timestamp,
    capabilities: {
      execution: supported,
      streaming: supported,
      nativeResume,
      nativeSessionDiscovery: discovery,
      fileRead: supported,
      search: supported,
      toolEvents: supported,
      reasoningControl: supported,
    },
  }
}

function backendObservation(readiness, timestamp) {
  return {
    mode: 'custom_gateway',
    readiness,
    freshness: 'current',
    configurationRevision: 'pbcfg_phase8b_host_backend_0001',
    configuration: {
      source: 'process_environment',
      hasBaseUrl: true,
      hasApiKey: true,
      hasAuthToken: false,
      hasOAuthToken: false,
      bedrockConfigured: false,
      vertexConfigured: false,
    },
    sanitizedOrigin: 'gateway.example.test',
    observedAt: timestamp,
    ...(readiness === 'unavailable'
      ? {
          failure: canonicalFailure('provider_service_unavailable', timestamp),
        }
      : {}),
  }
}

function selectedInstallation(lifecycle) {
  assert.ok(lifecycle)
  const selected = lifecycle.installations.find(
    ({ installationId }) => installationId === lifecycle.selectedInstallationId,
  )
  assert.ok(selected)
  return selected
}

class CountingDiscovery {
  provider = 'codex'
  discoverCalls = 0

  async discover() {
    this.discoverCalls += 1
    throw new Error(
      'A disabled discovery capability must not invoke its adapter',
    )
  }

  async validateCandidate() {
    throw new Error(
      'A disabled discovery capability must not validate candidates',
    )
  }
}

class TrackingRuntime {
  provider = 'codex'
  descriptor = {
    provider: 'codex',
    displayName: 'Codex',
    availability: 'available',
    capabilities: {
      streaming: true,
      resume: true,
      interrupt: true,
      approvals: true,
      fileRead: true,
      fileEdit: true,
      shell: true,
      search: true,
      diff: true,
      toolEvents: true,
      modelSelection: true,
      reasoningControl: true,
    },
  }
  startConversationCalls = []
  resumeConversationCalls = []
  startTurnCalls = []
  disposeConversationCalls = []
  closeCalls = 0
  closeError = undefined
  startConversationGate = undefined
  disposeConversationGate = undefined
  #conversationSequence = 0
  #eventListeners = new Set()

  constructor(installationId, installationRevision) {
    this.installation = { installationId, installationRevision }
  }

  subscribeEvents(listener) {
    this.#eventListeners.add(listener)
    return () => this.#eventListeners.delete(listener)
  }

  subscribeFailures() {
    return () => undefined
  }

  subscribeApprovals() {
    return () => undefined
  }

  async startConversation(options) {
    this.startConversationCalls.push(options)
    await this.startConversationGate
    this.#conversationSequence += 1
    return {
      providerThreadId: `private-new-session-${String(this.#conversationSequence)}`,
    }
  }

  async resumeConversation(options) {
    this.resumeConversationCalls.push(options)
    return { providerThreadId: options.providerThreadId }
  }

  async startTurn(options) {
    this.startTurnCalls.push(options)
    return {
      providerTurnId: `private-turn-${String(this.startTurnCalls.length)}`,
    }
  }

  async interruptTurn() {}

  async disposeConversation(options) {
    this.disposeConversationCalls.push(options)
    await this.disposeConversationGate
  }

  emit(event) {
    for (const listener of this.#eventListeners) listener(event)
  }

  async close() {
    this.closeCalls += 1
    if (this.closeError !== undefined) throw this.closeError
    this.#eventListeners.clear()
  }
}

class InstallationOwnedRuntime {
  provider = 'codex'
  descriptor = {
    provider: 'codex',
    displayName: 'Codex',
    availability: 'available',
    capabilities: {
      streaming: true,
      resume: true,
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
    },
  }
  sessions = new Set()
  resumeConversationCalls = []
  closeCalls = 0
  active = false
  cleanups = new Map()

  constructor(installation) {
    this.installation = installation
  }

  subscribeEvents() {
    return () => undefined
  }

  subscribeFailures() {
    return () => undefined
  }

  subscribeApprovals() {
    return () => undefined
  }

  async startConversation() {
    throw new Error('not used')
  }

  async resumeConversation(options) {
    this.resumeConversationCalls.push(options)
    this.sessions.add(options.providerThreadId)
    return { providerThreadId: options.providerThreadId }
  }

  async startTurn() {
    throw new Error('not used')
  }

  async interruptTurn() {}

  hasConversationSession(providerThreadId) {
    return this.sessions.has(providerThreadId)
  }

  ownsConversationSession(providerThreadId) {
    return (
      this.sessions.has(providerThreadId) || this.cleanups.has(providerThreadId)
    )
  }

  beginCleanup(providerThreadId, cleanup) {
    this.sessions.delete(providerThreadId)
    this.cleanups.set(providerThreadId, cleanup)
    void cleanup.then(
      () => this.cleanups.delete(providerThreadId),
      () => undefined,
    )
  }

  async disposeConversation({ providerThreadId }) {
    this.sessions.delete(providerThreadId)
    await this.cleanups.get(providerThreadId)
  }

  canRetireInstallation() {
    return !this.active && this.sessions.size === 0 && this.cleanups.size === 0
  }

  async close() {
    this.closeCalls += 1
    this.sessions.clear()
  }
}

class RemoteFreshSessionCoordinator {
  openCodexCalls = []
  remoteTurnCalls = []
  online = true
  providerObservedAt = observedAt
  #remoteRoot

  constructor(remoteRoot) {
    this.#remoteRoot = remoteRoot
  }

  connectionState(machineId) {
    return machineId === remoteMachineId && this.online ? 'online' : 'offline'
  }

  connectionDetails(machineId) {
    if (machineId !== remoteMachineId) return undefined
    return {
      state: this.online ? 'online' : 'offline',
      directState: this.online ? 'online' : 'offline',
      ...(this.online
        ? {
            executionTransport: 'direct',
            currentEndpoint: { host: '192.0.2.88', port: 43_217 },
          }
        : {}),
      lastAttemptAt: observedAt,
      lastSuccessfulAt: observedAt,
    }
  }

  providerExecutionAvailable(machineId, provider) {
    return this.online && machineId === remoteMachineId && provider === 'codex'
  }

  providerDiscoveryCurrent(machineId, candidateObservedAt) {
    return (
      this.online &&
      machineId === remoteMachineId &&
      candidateObservedAt === this.providerObservedAt
    )
  }

  async validateProjectLocation(machine, trust, path) {
    assert.equal(machine.machineId, remoteMachineId)
    assert.equal(trust.machineId, remoteMachineId)
    assert.equal(path, this.#remoteRoot)
    return {
      canonicalPath: path,
      basename: 'codetether-phase8b-host-remote-fresh',
      exists: true,
      directory: true,
    }
  }

  async openCodexSession(machine, trust, input) {
    assert.equal(machine.machineId, remoteMachineId)
    assert.equal(trust.machineId, remoteMachineId)
    this.openCodexCalls.push(input)
    let closed = false
    return {
      machineId: remoteMachineId,
      conversationId: input.conversationId,
      providerThreadId: 'private-phase8b-host-fresh-remote-session',
      get closed() {
        return closed
      },
      startTurn: async (turn) => {
        this.remoteTurnCalls.push(turn)
        return {
          async *events() {
            yield { type: 'message.delta', text: 'fresh', sequence: 1 }
            yield { type: 'message.completed', sequence: 2 }
            yield { type: 'turn.completed', sequence: 3 }
          },
        }
      },
      async close() {
        closed = true
      },
    }
  }

  async close() {}
}

function remoteProviderDescriptors() {
  const unavailableCapabilities = {
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
  return [
    {
      provider: 'codex',
      displayName: 'Codex',
      availability: 'available',
      version: '0.149.1',
      capabilities: {
        ...unavailableCapabilities,
        streaming: true,
        resume: false,
      },
    },
    {
      provider: 'claude-code',
      displayName: 'Claude Code',
      availability: 'not_installed',
      capabilities: unavailableCapabilities,
    },
  ]
}

function deferred() {
  let resolve
  const promise = new Promise((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

async function waitFor(predicate, label, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline)
      throw new Error(`Timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

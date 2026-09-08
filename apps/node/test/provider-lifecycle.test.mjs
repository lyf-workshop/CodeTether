import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import test from 'node:test'

import { ClaudeCodeOwnedProcessCleanupError } from '@codetether/adapter-claude'
import { CodexOwnedProcessCleanupError } from '@codetether/adapter-codex'
import {
  ProvidersDescribedMessageSchema,
  RemoteProviderDescriptorSchema,
  machineTransportLimits,
} from '@codetether/machine-transport'

import { NodeProviderLifecycleCoordinator } from '../dist/provider-lifecycle.js'

const machineId = 'machine_provider_lifecycle_fixture'

test('multiple Claude installations are deduplicated and the durable selection survives PATH order and coordinator restart', async (t) => {
  const directory = await fixtureDirectory(t, 'selection')
  const claudeAPath = await executableFixture(
    directory,
    'claude-a',
    'revision-a',
  )
  const claudeBPath = await executableFixture(
    directory,
    'claude-b',
    'revision-b',
  )
  const claudeA = claudeCandidate(claudeAPath, 'file:claude-a')
  const duplicateClaudeA = claudeCandidate(
    join(directory, 'alias', 'claude-a'),
    'file:claude-a',
    claudeAPath,
  )
  const claudeB = claudeCandidate(claudeBPath, 'file:claude-b')
  let observed = []

  const first = new NodeProviderLifecycleCoordinator({
    machineId,
    dataDirectory: directory,
    platform: process.platform,
    environment: {
      PATH: [dirname(claudeAPath), dirname(claudeBPath)].join(delimiter),
    },
    discoverClaude: async () => discovery([claudeA, duplicateClaudeA, claudeB]),
    observeClaude: async (options) => {
      observed.push(options.installation.launcherPath)
      return claudeObservation(options, {
        version:
          options.installation.fileIdentity === 'file:claude-a'
            ? '2.1.263'
            : '2.1.251',
      })
    },
  })
  t.after(async () => first.close())

  const initial = await first.refreshProvider('claude-code')
  assert.equal(initial.descriptor.installations.length, 2)
  assert.deepEqual(observed, [claudeA.launcherPath, claudeB.launcherPath])
  assert.equal(
    initial.descriptor.installations.filter(({ selected }) => selected).length,
    1,
  )
  assert.equal(initial.descriptor.version, '2.1.263')
  const selectedId = initial.descriptor.selectedInstallationId
  const selectedRevision = initial.selected.installationRevision
  assert.match(selectedId, /^pinst_/u)
  assert.match(selectedRevision, /^prev_/u)
  await first.close()

  observed = []
  const restarted = new NodeProviderLifecycleCoordinator({
    machineId,
    dataDirectory: directory,
    platform: process.platform,
    environment: {
      PATH: [dirname(claudeBPath), dirname(claudeAPath)].join(delimiter),
    },
    discoverClaude: async () => discovery([claudeB, claudeA, duplicateClaudeA]),
    observeClaude: async (options) => {
      observed.push(options.installation.launcherPath)
      return claudeObservation(options, {
        version:
          options.installation.fileIdentity === 'file:claude-a'
            ? '2.1.263'
            : '2.1.251',
      })
    },
  })
  t.after(async () => restarted.close())

  const afterRestart = await restarted.refreshProvider('claude-code')
  assert.equal(afterRestart.descriptor.installations.length, 2)
  assert.equal(afterRestart.descriptor.selectedInstallationId, selectedId)
  assert.equal(afterRestart.selected.installationId, selectedId)
  assert.equal(
    afterRestart.selected.observation.installation.launcherPath,
    claudeAPath,
  )
  assert.equal(afterRestart.descriptor.version, '2.1.263')
  assert.deepEqual(observed, [claudeB.launcherPath, claudeA.launcherPath])

  const resolved = await restarted.resolveSelected(
    'claude-code',
    selectedId,
    selectedRevision,
  )
  assert.equal(resolved.provider, 'claude-code')
  assert.equal(resolved.launcher.executable, claudeAPath)
  assert.equal(resolved.installationId, selectedId)
  assert.equal(resolved.installationRevision, selectedRevision)
  assert.equal(
    JSON.stringify(afterRestart.descriptor).includes(directory),
    false,
    'public lifecycle descriptors must not expose Machine-local paths',
  )
})

test('an in-place executable change retains installation identity, changes revision, and rejects the stale expected revision', async (t) => {
  const directory = await fixtureDirectory(t, 'revision')
  const executable = await executableFixture(directory, 'codex', 'revision-a')
  const candidate = codexCandidate(executable, 'file:codex')
  let observationCount = 0
  const coordinator = new NodeProviderLifecycleCoordinator({
    machineId,
    dataDirectory: directory,
    platform: process.platform,
    discoverCodex: async () => discovery([candidate]),
    observeCodex: async (options) => {
      observationCount += 1
      return codexObservation(options)
    },
  })
  t.after(async () => coordinator.close())

  const revisionA = await coordinator.refreshProvider('codex')
  const installationId = revisionA.selected.installationId
  const oldRevision = revisionA.selected.installationRevision
  await writeFile(executable, 'revision-b-with-different-content')

  await assert.rejects(
    coordinator.resolveSelected('codex', installationId, oldRevision),
    (error) => {
      assert.equal(error?.code, 'provider_unavailable')
      assert.match(error.message, /changed and requires revalidation/u)
      return true
    },
  )

  const revisionB = await coordinator.refreshProvider('codex')
  assert.equal(revisionB.selected.installationId, installationId)
  assert.notEqual(revisionB.selected.installationRevision, oldRevision)
  assert.equal(revisionB.descriptor.selectedInstallationId, installationId)
  assert.equal(observationCount, 2)
  await assert.rejects(
    coordinator.resolveSelected('codex', installationId, oldRevision),
    (error) => error?.code === 'provider_unavailable',
  )
  const resolved = await coordinator.resolveSelected(
    'codex',
    installationId,
    revisionB.selected.installationRevision,
  )
  assert.equal(resolved.executable, executable)
})

test('100 and 1,000 concurrent refresh triggers coalesce to one bounded scan each', async (t) => {
  const directory = await fixtureDirectory(t, 'coalescing')
  const executable = await executableFixture(directory, 'codex', 'revision')
  const candidate = codexCandidate(executable, 'file:codex')
  let scans = 0
  let observations = 0
  let gate = deferred()
  const coordinator = new NodeProviderLifecycleCoordinator({
    machineId,
    dataDirectory: directory,
    platform: process.platform,
    discoverCodex: async () => {
      scans += 1
      const currentGate = gate
      await currentGate.promise
      return discovery([candidate])
    },
    observeCodex: async (options) => {
      observations += 1
      return codexObservation(options)
    },
  })
  t.after(async () => coordinator.close())

  const firstBatch = Array.from({ length: 100 }, () =>
    coordinator.refreshProvider('codex'),
  )
  assert.equal(new Set(firstBatch).size, 1)
  gate.resolve()
  const firstResults = await Promise.all(firstBatch)
  assert.equal(scans, 1)
  assert.equal(observations, 1)
  assert.equal(
    new Set(
      firstResults.map(({ descriptor }) => descriptor.selectedInstallationId),
    ).size,
    1,
  )

  gate = deferred()
  const secondBatch = Array.from({ length: 1_000 }, () =>
    coordinator.refreshProvider('codex'),
  )
  assert.equal(new Set(secondBatch).size, 1)
  gate.resolve()
  await Promise.all(secondBatch)
  assert.equal(scans, 2)
  assert.equal(observations, 2)
})

test('one broken installation is isolated and does not hide another valid installation', async (t) => {
  const directory = await fixtureDirectory(t, 'isolation')
  const brokenPath = await executableFixture(
    directory,
    'claude-broken',
    'broken',
  )
  const healthyPath = await executableFixture(
    directory,
    'claude-healthy',
    'healthy',
  )
  const broken = claudeCandidate(brokenPath, 'file:broken')
  const healthy = claudeCandidate(healthyPath, 'file:healthy')
  const observed = []
  const coordinator = new NodeProviderLifecycleCoordinator({
    machineId,
    dataDirectory: directory,
    platform: process.platform,
    discoverClaude: async () => discovery([broken, healthy]),
    observeClaude: async (options) => {
      observed.push(options.installation.fileIdentity)
      if (options.installation.fileIdentity === 'file:broken') {
        throw new Error('synthetic bounded probe failure')
      }
      return claudeObservation(options, { version: '2.1.263' })
    },
  })
  t.after(async () => coordinator.close())

  const result = await coordinator.refreshProvider('claude-code')
  assert.deepEqual(observed, ['file:broken', 'file:healthy'])
  assert.equal(result.descriptor.installations.length, 1)
  assert.equal(result.descriptor.installations[0].selected, true)
  assert.equal(result.descriptor.installations[0].version, '2.1.263')
  assert.equal(
    result.selected.observation.installation.launcherPath,
    healthyPath,
  )
})

test('a whole-Provider probe failure preserves the other Provider result without masking durable-state corruption', async (t) => {
  const directory = await fixtureDirectory(t, 'provider-isolation')
  const claudePath = await executableFixture(directory, 'claude', 'healthy')
  const coordinator = new NodeProviderLifecycleCoordinator({
    machineId,
    dataDirectory: directory,
    platform: process.platform,
    discoverCodex: async () => {
      throw new Error('synthetic Codex enumeration failure')
    },
    discoverClaude: async () =>
      discovery([claudeCandidate(claudePath, 'file:healthy-claude')]),
    observeClaude: async (options) =>
      claudeObservation(options, { version: '2.1.263' }),
  })
  t.after(async () => coordinator.close())

  const result = await coordinator.describe()
  const codex = result.providers.find(({ provider }) => provider === 'codex')
  const claude = result.providers.find(
    ({ provider }) => provider === 'claude-code',
  )
  assert.ok(codex)
  assert.ok(claude)
  RemoteProviderDescriptorSchema.parse(codex)
  RemoteProviderDescriptorSchema.parse(claude)
  assert.equal(codex.availability, 'unavailable')
  assert.equal(codex.executionFailureReason, 'provider_start_failed')
  assert.equal(codex.installations, undefined)
  assert.equal(claude.availability, 'available')
  assert.equal(claude.installations.length, 1)

  const selected = await coordinator.resolveSelected(
    'claude-code',
    claude.selectedInstallationId,
    claude.installations[0].revision,
  )
  assert.equal(selected.launcher.executable, claudePath)

  const corruptDirectory = await fixtureDirectory(t, 'state-corruption')
  await writeFile(join(corruptDirectory, 'provider-installations.json'), '{')
  const corrupt = new NodeProviderLifecycleCoordinator({
    machineId,
    dataDirectory: corruptDirectory,
    discoverCodex: async () => discovery([]),
    discoverClaude: async () => discovery([]),
  })
  t.after(async () => corrupt.close().catch(() => undefined))
  await assert.rejects(corrupt.describe(), SyntaxError)
})

test('cold multi-install lifecycle work has one creation-time deadline and a fresh retry generation', async (t) => {
  const directory = await fixtureDirectory(t, 'cold-deadline')
  const candidates = []
  for (
    let index = 0;
    index < machineTransportLimits.maximumProviderInstallationsPerProvider;
    index += 1
  ) {
    const executable = await executableFixture(
      directory,
      `codex-deadline-${String(index)}`,
      `revision-${String(index)}`,
    )
    candidates.push(codexCandidate(executable, `file:deadline-${index}`))
  }
  let slow = true
  let observedAbort = false
  let observationCalls = 0
  const coordinator = new NodeProviderLifecycleCoordinator({
    machineId: 'machine_provider_lifecycle_deadline',
    dataDirectory: directory,
    platform: process.platform,
    lifecycleWorkTimeoutMs: 40,
    discoverCodex: async () => discovery(candidates),
    observeCodex: async (options) => {
      observationCalls += 1
      if (slow) {
        await new Promise((_, reject) => {
          const abort = () => {
            observedAbort = true
            reject(options.signal.reason)
          }
          if (options.signal.aborted) abort()
          else options.signal.addEventListener('abort', abort, { once: true })
        })
      }
      return await codexObservation(options)
    },
  })
  t.after(async () => coordinator.close())

  await assert.rejects(
    coordinator.refreshProvider('codex'),
    (error) =>
      error?.code === 'provider_start_failed' &&
      error?.failureReason === 'provider_start_failed',
  )
  assert.equal(observedAbort, true)
  assert.equal(observationCalls, 1)

  slow = false
  const recovered = await coordinator.refreshProvider('codex')
  assert.equal(
    recovered.descriptor.installations.length,
    machineTransportLimits.maximumProviderInstallationsPerProvider,
  )
  assert.equal(
    observationCalls,
    machineTransportLimits.maximumProviderInstallationsPerProvider + 1,
  )
})

test('Claude cleanup failure wins a lifecycle deadline and permanently blocks direct replacement', async (t) => {
  const directory = await fixtureDirectory(t, 'cleanup-deadline')
  const executable = await executableFixture(
    directory,
    'claude-cleanup-deadline',
    'revision',
  )
  const candidate = claudeCandidate(executable, 'file:claude-cleanup-deadline')
  const cleanupFailure = new ClaudeCodeOwnedProcessCleanupError()
  let observedAbort = false
  const coordinator = new NodeProviderLifecycleCoordinator({
    machineId: 'machine_provider_lifecycle_cleanup_deadline',
    dataDirectory: directory,
    platform: process.platform,
    lifecycleWorkTimeoutMs: 20,
    discoverClaude: async () => discovery([candidate]),
    observeClaude: async (options) => {
      return await new Promise((_, reject) => {
        const onAbort = () => {
          observedAbort = true
          reject(cleanupFailure)
        }
        if (options.signal.aborted) onAbort()
        else options.signal.addEventListener('abort', onAbort, { once: true })
      })
    },
  })
  t.after(async () => coordinator.close().catch(() => undefined))

  await assert.rejects(
    coordinator.refreshProvider('claude-code'),
    (error) => error === cleanupFailure,
  )
  assert.equal(observedAbort, true)
  assert.throws(
    () => coordinator.refreshProvider('claude-code'),
    (error) => error === cleanupFailure,
  )
  await assert.rejects(
    coordinator.resolveSelected(
      'claude-code',
      'pinst_cleanup_failure_fixture',
      'prev_cleanup_failure_fixture',
    ),
    (error) => error === cleanupFailure,
  )
  await assert.rejects(coordinator.close(), (error) => error === cleanupFailure)
  await assert.rejects(coordinator.close(), (error) => error === cleanupFailure)
})

test('per-installation Claude cleanup failure is not isolated and permanently blocks direct refresh', async (t) => {
  const directory = await fixtureDirectory(t, 'cleanup-direct')
  const executable = await executableFixture(
    directory,
    'claude-cleanup-direct',
    'revision',
  )
  const cleanupFailure = new ClaudeCodeOwnedProcessCleanupError()
  const coordinator = new NodeProviderLifecycleCoordinator({
    machineId: 'machine_provider_lifecycle_cleanup_direct',
    dataDirectory: directory,
    platform: process.platform,
    discoverClaude: async () =>
      discovery([claudeCandidate(executable, 'file:claude-cleanup-direct')]),
    observeClaude: async () => {
      throw cleanupFailure
    },
  })
  t.after(async () => coordinator.close().catch(() => undefined))

  await assert.rejects(
    coordinator.refreshProvider('claude-code'),
    (error) => error === cleanupFailure,
  )
  assert.throws(
    () => coordinator.refreshProvider('claude-code'),
    (error) => error === cleanupFailure,
  )
  await assert.rejects(coordinator.close(), (error) => error === cleanupFailure)
})

test('Codex cleanup failure wins a lifecycle deadline and permanently blocks direct replacement', async (t) => {
  const directory = await fixtureDirectory(t, 'codex-cleanup-deadline')
  const executable = await executableFixture(
    directory,
    'codex-cleanup-deadline',
    'revision',
  )
  const candidate = codexCandidate(executable, 'file:codex-cleanup-deadline')
  const cleanupFailure = new CodexOwnedProcessCleanupError()
  const coordinator = new NodeProviderLifecycleCoordinator({
    machineId: 'machine_provider_lifecycle_codex_cleanup_deadline',
    dataDirectory: directory,
    platform: process.platform,
    lifecycleWorkTimeoutMs: 20,
    discoverCodex: async () => discovery([candidate]),
    observeCodex: async (options) => {
      return await new Promise((_, reject) => {
        const onAbort = () => reject(cleanupFailure)
        if (options.signal.aborted) onAbort()
        else options.signal.addEventListener('abort', onAbort, { once: true })
      })
    },
  })
  t.after(async () => coordinator.close().catch(() => undefined))

  await assert.rejects(
    coordinator.refreshProvider('codex'),
    (error) => error === cleanupFailure,
  )
  assert.throws(
    () => coordinator.refreshProvider('codex'),
    (error) => error === cleanupFailure,
  )
  await assert.rejects(coordinator.close(), (error) => error === cleanupFailure)
})

for (const [affectedProvider, CleanupError] of [
  ['codex', CodexOwnedProcessCleanupError],
  ['claude-code', ClaudeCodeOwnedProcessCleanupError],
]) {
  test(`${affectedProvider} cleanup uncertainty remains Provider-scoped across repeated descriptions and exact selection`, async (t) => {
    const directory = await fixtureDirectory(
      t,
      `${affectedProvider}-cleanup-isolation`,
    )
    const codexPath = await executableFixture(
      directory,
      'codex-isolated',
      'codex-revision',
    )
    const claudePath = await executableFixture(
      directory,
      'claude-isolated',
      'claude-revision',
    )
    const cleanupFailure = new CleanupError()
    const observationCounts = { codex: 0, 'claude-code': 0 }
    const coordinator = new NodeProviderLifecycleCoordinator({
      machineId: `machine_provider_isolation_${affectedProvider.replace('-', '_')}`,
      dataDirectory: directory,
      platform: process.platform,
      discoverCodex: async () =>
        discovery([codexCandidate(codexPath, 'file:codex-isolated')]),
      discoverClaude: async () =>
        discovery([claudeCandidate(claudePath, 'file:claude-isolated')]),
      observeCodex: async (options) => {
        observationCounts.codex += 1
        if (affectedProvider === 'codex') throw cleanupFailure
        return codexObservation(options)
      },
      observeClaude: async (options) => {
        observationCounts['claude-code'] += 1
        if (affectedProvider === 'claude-code') throw cleanupFailure
        return claudeObservation(options, { version: '2.1.263' })
      },
    })
    t.after(async () => coordinator.close().catch(() => undefined))

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const described = await coordinator.describe()
      const affected = described.providers.find(
        ({ provider }) => provider === affectedProvider,
      )
      const healthy = described.providers.find(
        ({ provider }) => provider !== affectedProvider,
      )
      assert.equal(affected.availability, 'unavailable')
      assert.equal(affected.executionFailureReason, 'provider_start_failed')
      assert.equal(healthy.availability, 'available')
    }

    const healthyProvider =
      affectedProvider === 'codex' ? 'claude-code' : 'codex'
    assert.equal(observationCounts[affectedProvider], 1)
    assert.equal(observationCounts[healthyProvider], 2)
    assert.throws(
      () => coordinator.refreshProvider(affectedProvider),
      (error) => error === cleanupFailure,
    )
    await assert.rejects(
      coordinator.resolveSelected(
        affectedProvider,
        'pinst_cleanup_barrier_selected_fixture',
        'prev_cleanup_barrier_selected_fixture',
      ),
      (error) => error === cleanupFailure,
    )

    const healthy = await coordinator.refreshProvider(healthyProvider)
    const selected = healthy.descriptor.installations.find(
      ({ selected }) => selected,
    )
    const resolved = await coordinator.resolveSelected(
      healthyProvider,
      healthy.descriptor.selectedInstallationId,
      selected.revision,
    )
    assert.equal(resolved.provider, healthyProvider)
    await assert.rejects(
      coordinator.close(),
      (error) => error === cleanupFailure,
    )
  })
}

test('simultaneous Provider deadlines never downgrade exact cleanup uncertainty to a sibling probe timeout', async (t) => {
  const directory = await fixtureDirectory(t, 'cleanup-deadline-precedence')
  const codexPath = await executableFixture(
    directory,
    'codex-cleanup-precedence',
    'codex-revision',
  )
  const claudePath = await executableFixture(
    directory,
    'claude-cleanup-precedence',
    'claude-revision',
  )
  const cleanupFailure = new CodexOwnedProcessCleanupError()
  const waitForAbort = (signal, failure) =>
    new Promise((_, reject) => {
      const onAbort = () => reject(failure)
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    })
  const coordinator = new NodeProviderLifecycleCoordinator({
    machineId: 'machine_provider_deadline_precedence',
    dataDirectory: directory,
    platform: process.platform,
    lifecycleWorkTimeoutMs: 20,
    discoverCodex: async () =>
      discovery([codexCandidate(codexPath, 'file:codex-cleanup-precedence')]),
    discoverClaude: async () =>
      discovery([
        claudeCandidate(claudePath, 'file:claude-cleanup-precedence'),
      ]),
    observeCodex: async ({ signal }) =>
      await waitForAbort(signal, cleanupFailure),
    observeClaude: async ({ signal }) =>
      await waitForAbort(signal, new DOMException('deadline', 'AbortError')),
  })
  t.after(async () => coordinator.close().catch(() => undefined))

  const described = await coordinator.describe()
  const codex = described.providers.find(({ provider }) => provider === 'codex')
  const claude = described.providers.find(
    ({ provider }) => provider === 'claude-code',
  )
  assert.equal(codex.executionFailureReason, 'provider_start_failed')
  assert.equal(claude.executionFailureReason, 'provider_start_failed')
})

test('a shared request abort surfaces exact cleanup uncertainty ahead of a sibling abort', async (t) => {
  const directory = await fixtureDirectory(t, 'shared-abort-cleanup-precedence')
  const codexPath = await executableFixture(
    directory,
    'codex-shared-abort',
    'codex-revision',
  )
  const claudePath = await executableFixture(
    directory,
    'claude-shared-abort',
    'claude-revision',
  )
  const cleanupFailure = new CodexOwnedProcessCleanupError()
  const codexStarted = deferred()
  const waitForAbort = (signal, failure) =>
    new Promise((_, reject) => {
      const onAbort = () => reject(failure)
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    })
  const coordinator = new NodeProviderLifecycleCoordinator({
    machineId: 'machine_provider_shared_abort_precedence',
    dataDirectory: directory,
    platform: process.platform,
    lifecycleWorkTimeoutMs: 5_000,
    discoverCodex: async () =>
      discovery([codexCandidate(codexPath, 'file:codex-shared-abort')]),
    discoverClaude: async () =>
      discovery([claudeCandidate(claudePath, 'file:claude-shared-abort')]),
    observeCodex: async ({ signal }) => {
      codexStarted.resolve()
      return await waitForAbort(signal, cleanupFailure)
    },
    observeClaude: async ({ signal }) =>
      await waitForAbort(
        signal,
        new DOMException('request closed', 'AbortError'),
      ),
  })
  t.after(async () => coordinator.close().catch(() => undefined))
  const abort = new AbortController()
  const describing = coordinator.describe(abort.signal)
  await codexStarted.promise
  abort.abort(new DOMException('deadline', 'AbortError'))

  await assert.rejects(describing, (error) => error === cleanupFailure)
  assert.throws(
    () => coordinator.refreshProvider('codex'),
    (error) => error === cleanupFailure,
  )
})

test('many lifecycle candidates remain inside the frozen Machine frame bound without dropping either selected installation', async (t) => {
  const directory = await fixtureDirectory(t, 'wire-bound')
  const codexCandidates = []
  const claudeCandidates = []
  for (
    let index = 0;
    index < machineTransportLimits.maximumProviderInstallationsPerProvider;
    index += 1
  ) {
    const codexPath = await executableFixture(
      directory,
      `codex-${String(index)}`,
      `codex-revision-${String(index)}`,
    )
    const claudePath = await executableFixture(
      directory,
      `claude-${String(index)}`,
      `claude-revision-${String(index)}`,
    )
    codexCandidates.push(codexCandidate(codexPath, `file:codex-${index}`))
    claudeCandidates.push(claudeCandidate(claudePath, `file:claude-${index}`))
  }
  const coordinator = new NodeProviderLifecycleCoordinator({
    machineId: 'machine_provider_lifecycle_wire_bound',
    dataDirectory: directory,
    platform: process.platform,
    discoverCodex: async () => discovery(codexCandidates),
    discoverClaude: async () => discovery(claudeCandidates),
    observeCodex: codexObservation,
    observeClaude: async (options) =>
      claudeObservation(options, { version: '2.1.263' }),
  })
  t.after(async () => coordinator.close())

  const [unboundedCodex, unboundedClaude] = await Promise.all([
    coordinator.refreshProvider('codex'),
    coordinator.refreshProvider('claude-code'),
  ])
  assert.ok(
    Buffer.byteLength(
      JSON.stringify({
        providers: [unboundedCodex.descriptor, unboundedClaude.descriptor],
        observedAt: '2026-09-06T00:00:00.000Z',
      }),
      'utf8',
    ) > machineTransportLimits.maximumFrameBytes,
    'the fixture must exercise aggregate response truncation',
  )

  const boundedDiscovery = await coordinator.describe()
  const response = {
    type: 'providers.described',
    protocolVersion: 1,
    requestId: 'r'.repeat(43),
    machineId: 'machine_provider_lifecycle_wire_bound',
    nodeId: 'node_provider_lifecycle_wire_bound',
    observedAt: boundedDiscovery.observedAt,
    providers: boundedDiscovery.providers,
  }
  ProvidersDescribedMessageSchema.parse(response)
  assert.ok(
    Buffer.byteLength(JSON.stringify(response), 'utf8') <=
      machineTransportLimits.maximumFrameBytes,
  )
  for (const provider of boundedDiscovery.providers) {
    assert.ok(provider.installations.length >= 2)
    assert.equal(
      provider.installations.some(
        ({ installationId, selected }) =>
          selected && installationId === provider.selectedInstallationId,
      ),
      true,
    )
  }
})

async function fixtureDirectory(t, name) {
  const directory = await mkdtemp(
    join(tmpdir(), `codetether-provider-lifecycle-${name}-`),
  )
  t.after(async () => rm(directory, { recursive: true, force: true }))
  return directory
}

async function executableFixture(directory, name, contents) {
  const path = join(directory, name)
  await writeFile(path, contents)
  return path
}

function discovery(installations) {
  return {
    installations,
    pathsInspected: installations.length,
    truncated: false,
  }
}

function codexCandidate(executable, fileIdentity) {
  return {
    launcherPath: executable,
    executable,
    fileIdentity,
    launcherKind: 'native',
    installMethod: 'manual',
  }
}

function claudeCandidate(
  launcherPath,
  fileIdentity,
  executable = launcherPath,
) {
  return {
    launcherPath,
    launcher: {
      kind: 'native',
      launcherPath,
      executable,
      prefixArguments: [],
      sourcePath: executable,
    },
    fileIdentity,
    launcherKind: 'native',
    installMethod: 'manual',
  }
}

async function codexObservation(options) {
  return {
    installation: options.installation,
    version: '0.149.1',
    privateRevision: await options.fingerprint(),
    compatibility: compatibility('verified'),
    backend: backend(
      'first_party',
      `codex:${options.installation.fileIdentity}`,
    ),
    runtimeEnvironment: () => ({ ...options.environment }),
  }
}

async function claudeObservation(options, { version }) {
  return {
    installation: options.installation,
    version,
    privateRevision: await options.fingerprint(),
    compatibility: compatibility('verified'),
    backend: backend(
      'custom_gateway',
      `claude:${options.installation.fileIdentity}`,
    ),
    runtimeEnvironment: () => ({ ...options.environment }),
  }
}

function compatibility(state) {
  const capability = () => ({
    observed: 'supported',
    enabled: true,
    effective: true,
  })
  return {
    state,
    runtimeReadiness: 'ready',
    contractVersion: 1,
    capabilities: {
      execution: capability(),
      streaming: capability(),
      nativeResume: capability(),
      nativeSessionDiscovery: capability(),
      fileRead: capability(),
      search: capability(),
      toolEvents: capability(),
      reasoningControl: capability(),
    },
  }
}

function backend(mode, privateConfigurationRevision) {
  return {
    mode,
    source: 'process_environment',
    hasBaseUrl: mode === 'custom_gateway',
    hasApiKey: false,
    hasAuthToken: mode === 'custom_gateway',
    hasOAuthToken: false,
    bedrockConfigured: false,
    vertexConfigured: false,
    configurationValid: true,
    readiness: 'unknown',
    privateConfigurationRevision,
  }
}

function deferred() {
  let resolve
  const promise = new Promise((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

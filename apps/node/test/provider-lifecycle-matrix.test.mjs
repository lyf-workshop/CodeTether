import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { RemoteProviderDescriptorSchema } from '@codetether/machine-transport'

import { NodeProviderLifecycleCoordinator } from '../dist/provider-lifecycle.js'

test('selected Provider removal is a schema-valid current observation, never an alternate fallback, and return restores the same selection', async (t) => {
  const directory = await fixtureDirectory(t, 'removal-return')
  const selectedPath = await executableFixture(directory, 'codex-a', 'A')
  const alternatePath = await executableFixture(directory, 'codex-b', 'B')
  const selected = codexCandidate(selectedPath, 'file:codex-a')
  const alternate = codexCandidate(alternatePath, 'file:codex-b')
  let visible = [selected, alternate]
  let now = new Date('2026-09-06T12:00:00.000Z')
  const coordinator = new NodeProviderLifecycleCoordinator({
    machineId: 'machine_provider_lifecycle_removal',
    dataDirectory: directory,
    now: () => now,
    discoverCodex: async () => discovery(visible),
    observeCodex: codexObservation,
  })
  t.after(async () => coordinator.close())

  const initial = await coordinator.refreshProvider('codex')
  const selectedId = initial.selected.installationId
  const selectedRevision = initial.selected.installationRevision
  assert.equal(
    initial.selected.observation.installation.executable,
    selectedPath,
  )

  now = new Date('2026-09-06T12:01:00.000Z')
  visible = [alternate]
  const removed = await coordinator.refreshProvider('codex')
  RemoteProviderDescriptorSchema.parse(removed.descriptor)
  assert.equal(removed.descriptor.selectedInstallationId, selectedId)
  assert.equal(removed.selected, undefined)
  assert.equal(removed.descriptor.availability, 'unavailable')
  assert.equal(removed.descriptor.installations[0].installationId, selectedId)
  assert.equal(removed.descriptor.installations[0].selected, true)
  assert.equal(
    removed.descriptor.installations[0].compatibility.freshness,
    'current',
  )
  assert.equal(
    removed.descriptor.installations[0].compatibility.observedAt,
    now.toISOString(),
  )
  assert.equal(
    removed.descriptor.installations.find(
      ({ installationId }) => installationId !== selectedId,
    ).selected,
    false,
  )
  await assert.rejects(
    coordinator.selected('codex', selectedId, selectedRevision),
    (error) => error?.code === 'provider_unavailable',
  )

  now = new Date('2026-09-06T12:02:00.000Z')
  visible = [alternate, selected]
  const returned = await coordinator.refreshProvider('codex')
  RemoteProviderDescriptorSchema.parse(returned.descriptor)
  assert.equal(returned.descriptor.selectedInstallationId, selectedId)
  assert.equal(returned.selected.installationId, selectedId)
  assert.equal(returned.selected.installationRevision, selectedRevision)
  assert.equal(
    returned.selected.observation.installation.executable,
    selectedPath,
  )

  now = new Date('2026-09-06T12:03:00.000Z')
  visible = [selected]
  const alternateRemoved = await coordinator.refreshProvider('codex')
  const removedAlternate = alternateRemoved.descriptor.installations.find(
    ({ installationId }) => installationId !== selectedId,
  )
  assert.ok(removedAlternate)
  assert.equal(removedAlternate.selected, false)
  assert.equal(removedAlternate.availability, 'unavailable')
  assert.equal(removedAlternate.compatibility.state, 'unavailable')
  assert.equal(removedAlternate.compatibility.freshness, 'current')
})

test('capability-compatible malformed version output does not become execution authority', async (t) => {
  const directory = await fixtureDirectory(t, 'unknown-version-selection')
  const executable = await executableFixture(directory, 'codex', 'revision')
  const candidate = codexCandidate(executable, 'file:codex-unknown-version')
  const coordinator = new NodeProviderLifecycleCoordinator({
    machineId: 'machine_provider_lifecycle_unknown_version',
    dataDirectory: directory,
    discoverCodex: async () => discovery([candidate]),
    observeCodex: async (options) => ({
      installation: options.installation,
      privateRevision: await options.fingerprint(),
      compatibility: compatibility('compatible_unverified'),
      backend: backend('first_party', 'codex:unknown-version'),
      runtimeEnvironment: () => ({ ...options.environment }),
    }),
  })
  t.after(async () => coordinator.close())

  const observed = await coordinator.refreshProvider('codex')
  assert.equal(observed.selected.descriptor.version, undefined)
  assert.equal(observed.descriptor.availability, 'available')
  const selected = await coordinator.selected(
    'codex',
    observed.selected.installationId,
    observed.selected.installationRevision,
  )
  assert.equal(selected.version, undefined)
  assert.equal(selected.executable, executable)
})

test('first selection skips an earlier incompatible installation and then remains durable', async (t) => {
  const directory = await fixtureDirectory(t, 'first-eligible-selection')
  const incompatiblePath = await executableFixture(
    directory,
    'codex-incompatible',
    'incompatible-revision',
  )
  const compatiblePath = await executableFixture(
    directory,
    'codex-compatible',
    'compatible-revision',
  )
  const incompatibleCandidate = codexCandidate(
    incompatiblePath,
    'file:codex-incompatible-first',
  )
  const compatibleCandidate = codexCandidate(
    compatiblePath,
    'file:codex-compatible-second',
  )
  let firstCandidateCompatible = false
  const coordinator = new NodeProviderLifecycleCoordinator({
    machineId: 'machine_provider_lifecycle_first_eligible',
    dataDirectory: directory,
    discoverCodex: async () =>
      discovery([incompatibleCandidate, compatibleCandidate]),
    observeCodex: async (options) => {
      const observed = await codexObservation(options)
      if (
        options.installation.fileIdentity !==
          incompatibleCandidate.fileIdentity ||
        firstCandidateCompatible
      ) {
        return observed
      }
      const unsupported = {
        observed: 'unsupported',
        enabled: true,
        effective: false,
      }
      return {
        ...observed,
        compatibility: {
          state: 'incompatible',
          runtimeReadiness: 'blocked',
          contractVersion: 1,
          failureCode: 'provider_protocol_error',
          capabilities: {
            execution: unsupported,
            streaming: unsupported,
            nativeResume: unsupported,
            nativeSessionDiscovery: unsupported,
            fileRead: unsupported,
            search: unsupported,
            toolEvents: unsupported,
            reasoningControl: unsupported,
          },
        },
      }
    },
  })
  t.after(async () => coordinator.close())

  const initial = await coordinator.refreshProvider('codex')
  assert.equal(
    initial.selected.observation.installation.executable,
    compatiblePath,
  )
  const selectedId = initial.selected.installationId

  firstCandidateCompatible = true
  const refreshed = await coordinator.refreshProvider('codex')
  assert.equal(refreshed.descriptor.selectedInstallationId, selectedId)
  assert.equal(refreshed.selected.installationId, selectedId)
  assert.equal(
    refreshed.selected.observation.installation.executable,
    compatiblePath,
  )
})

test('an unknown newer Claude revision remains selectable when the frozen execution contract passes', async (t) => {
  const directory = await fixtureDirectory(t, 'claude-newer-selection')
  const executable = await executableFixture(directory, 'claude', 'revision')
  const candidate = claudeCandidate(executable, 'file:claude-newer-version')
  const coordinator = new NodeProviderLifecycleCoordinator({
    machineId: 'machine_provider_lifecycle_claude_newer',
    dataDirectory: directory,
    discoverClaude: async () => discovery([candidate]),
    observeClaude: async (options) => ({
      installation: options.installation,
      version: '99.0.0',
      privateRevision: await options.fingerprint(),
      compatibility: {
        ...compatibility('limited'),
        runtimeReadiness: 'limited',
        capabilities: {
          ...compatibility('limited').capabilities,
          nativeSessionDiscovery: {
            observed: 'unsupported',
            enabled: true,
            effective: false,
          },
        },
      },
      backend: backend('custom_gateway', 'claude:newer-version'),
      runtimeEnvironment: () => ({ ...options.environment }),
    }),
  })
  t.after(async () => coordinator.close())

  const observed = await coordinator.refreshProvider('claude-code')
  assert.equal(observed.descriptor.availability, 'available')
  assert.equal(observed.descriptor.version, '99.0.0')
  assert.equal(observed.descriptor.capabilities.toolEvents, true)
  const selected = await coordinator.selected(
    'claude-code',
    observed.selected.installationId,
    observed.selected.installationRevision,
  )
  assert.equal(selected.version, '99.0.0')
  assert.equal(selected.launcher.executable, executable)
})

test('bounded installation discovery reports truncation without changing the selected installation', async (t) => {
  const directory = await fixtureDirectory(t, 'truncated-scan')
  const selectedExecutable = await executableFixture(
    directory,
    'claude-selected',
    'selected-revision',
  )
  const alternateExecutable = await executableFixture(
    directory,
    'claude-alternate',
    'alternate-revision',
  )
  const selectedCandidate = claudeCandidate(
    selectedExecutable,
    'file:claude-truncated-selected',
  )
  const alternateCandidate = claudeCandidate(
    alternateExecutable,
    'file:claude-truncated-alternate',
  )
  let visible = [selectedCandidate, alternateCandidate]
  let truncated = false
  let now = new Date('2026-09-06T13:00:00.000Z')
  const coordinator = new NodeProviderLifecycleCoordinator({
    machineId: 'machine_provider_lifecycle_truncated_scan',
    dataDirectory: directory,
    now: () => now,
    discoverClaude: async () => ({
      ...discovery(visible),
      truncated,
    }),
    observeClaude: claudeObservation,
  })
  t.after(async () => coordinator.close())

  const initial = await coordinator.refreshProvider('claude-code')
  const selectedId = initial.selected.installationId
  const selectedRevision = initial.selected.installationRevision

  now = new Date('2026-09-06T13:01:00.000Z')
  visible = [alternateCandidate]
  truncated = true
  const observed = await coordinator.refreshProvider('claude-code')
  RemoteProviderDescriptorSchema.parse(observed.descriptor)
  assert.equal(observed.descriptor.installationsTruncated, true)
  assert.equal(observed.descriptor.selectedInstallationId, selectedId)
  assert.equal(observed.selected, undefined)
  assert.equal(observed.descriptor.availability, 'unavailable')
  const retainedSelected = observed.descriptor.installations.find(
    ({ installationId }) => installationId === selectedId,
  )
  assert.ok(retainedSelected)
  assert.equal(retainedSelected.selected, true)
  assert.equal(retainedSelected.availability, 'available')
  assert.equal(retainedSelected.revision, selectedRevision)
  assert.equal(
    retainedSelected.lastObservedAt,
    initial.selected.descriptor.lastObservedAt,
  )
  assert.equal(retainedSelected.compatibility.freshness, 'last_known')
  assert.equal(retainedSelected.backend.freshness, 'last_known')

  now = new Date('2026-09-06T13:02:00.000Z')
  visible = [alternateCandidate, selectedCandidate]
  truncated = false
  const returned = await coordinator.refreshProvider('claude-code')
  RemoteProviderDescriptorSchema.parse(returned.descriptor)
  assert.equal(returned.descriptor.installationsTruncated, undefined)
  assert.equal(returned.descriptor.selectedInstallationId, selectedId)
  assert.equal(returned.selected.installationId, selectedId)
  assert.equal(returned.selected.installationRevision, selectedRevision)
  assert.equal(returned.descriptor.availability, 'available')
})

test('a binary change during probing is discarded and only the stable revision is published', async (t) => {
  const directory = await fixtureDirectory(t, 'stale-probe')
  const executable = await executableFixture(directory, 'codex', 'A')
  const candidate = codexCandidate(executable, 'file:codex')
  let observations = 0
  const privateRevisions = []
  const coordinator = new NodeProviderLifecycleCoordinator({
    machineId: 'machine_provider_lifecycle_stale_probe',
    dataDirectory: directory,
    discoverCodex: async () => discovery([candidate]),
    observeCodex: async (options) => {
      observations += 1
      const observation = await codexObservation(options)
      privateRevisions.push(observation.privateRevision)
      if (observations === 1) await writeFile(executable, 'B')
      return observation
    },
  })
  t.after(async () => coordinator.close())

  const result = await coordinator.refreshProvider('codex')
  assert.equal(observations, 2)
  assert.notEqual(privateRevisions[0], privateRevisions[1])
  assert.equal(result.descriptor.installations.length, 1)
  assert.equal(result.selected.observation.privateRevision, privateRevisions[1])
  const resolved = await coordinator.resolveSelected(
    'codex',
    result.selected.installationId,
    result.selected.installationRevision,
  )
  assert.equal(resolved.executable, executable)
})

test('identical Provider artifacts on different Machines have independent installation, revision, and backend identities', async (t) => {
  const directoryA = await fixtureDirectory(t, 'machine-a')
  const directoryB = await fixtureDirectory(t, 'machine-b')
  const executable = await executableFixture(directoryA, 'claude', 'same')
  const candidate = claudeCandidate(executable, 'file:same-claude')
  const first = coordinatorForClaude(
    'machine_provider_lifecycle_scope_a',
    directoryA,
    candidate,
  )
  const second = coordinatorForClaude(
    'machine_provider_lifecycle_scope_b',
    directoryB,
    candidate,
  )
  t.after(async () => Promise.all([first.close(), second.close()]))

  const [left, right] = await Promise.all([
    first.refreshProvider('claude-code'),
    second.refreshProvider('claude-code'),
  ])
  assert.notEqual(left.selected.installationId, right.selected.installationId)
  assert.notEqual(
    left.selected.installationRevision,
    right.selected.installationRevision,
  )
  assert.notEqual(
    left.descriptor.backend.configurationRevision,
    right.descriptor.backend.configurationRevision,
  )
})

test('public Provider capabilities preserve optional lifecycle granularity instead of inheriting execution readiness', async (t) => {
  const directory = await fixtureDirectory(t, 'capability-projection')
  const executable = await executableFixture(directory, 'claude', 'same')
  const candidate = claudeCandidate(executable, 'file:granular-claude')
  const capability = (effective) => ({
    observed: effective ? 'supported' : 'unsupported',
    enabled: true,
    effective,
  })
  const coordinator = new NodeProviderLifecycleCoordinator({
    machineId: 'machine_provider_lifecycle_capabilities',
    dataDirectory: directory,
    discoverClaude: async () => discovery([candidate]),
    observeClaude: async (options) => ({
      installation: options.installation,
      version: '2.1.263',
      privateRevision: await options.fingerprint(),
      compatibility: {
        state: 'limited',
        runtimeReadiness: 'limited',
        contractVersion: 1,
        capabilities: {
          execution: capability(true),
          streaming: capability(true),
          nativeResume: capability(false),
          nativeSessionDiscovery: capability(false),
          fileRead: capability(true),
          search: capability(true),
          toolEvents: capability(true),
          reasoningControl: capability(false),
        },
      },
      backend: backend('custom_gateway', 'claude:granular'),
      runtimeEnvironment: () => ({ ...options.environment }),
    }),
  })
  t.after(async () => coordinator.close())

  const result = await coordinator.refreshProvider('claude-code')
  RemoteProviderDescriptorSchema.parse(result.descriptor)
  assert.equal(result.descriptor.availability, 'available')
  assert.deepEqual(result.descriptor.capabilities, {
    streaming: true,
    resume: false,
    interrupt: false,
    approvals: false,
    fileRead: true,
    fileEdit: false,
    shell: false,
    search: true,
    diff: false,
    toolEvents: true,
    modelSelection: false,
    reasoningControl: false,
  })
  assert.equal(result.descriptor.reasoningLabel, undefined)
  assert.equal(result.descriptor.reasoningOptions, undefined)
  const selected = await coordinator.selected(
    'claude-code',
    result.selected.installationId,
    result.selected.installationRevision,
  )
  assert.equal(selected.installationId, result.selected.installationId)
})

async function fixtureDirectory(t, name) {
  const directory = await mkdtemp(
    join(tmpdir(), `codetether-provider-lifecycle-matrix-${name}-`),
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

function claudeCandidate(executable, fileIdentity) {
  return {
    launcherPath: executable,
    launcher: {
      kind: 'native',
      launcherPath: executable,
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
  return observation(
    options,
    '0.149.1',
    'first_party',
    `codex:${options.installation.fileIdentity}`,
  )
}

async function claudeObservation(options) {
  return observation(
    options,
    '2.1.263',
    'custom_gateway',
    `claude:${options.installation.fileIdentity}`,
  )
}

async function observation(
  options,
  version,
  backendMode,
  privateConfigurationRevision,
) {
  return {
    installation: options.installation,
    version,
    privateRevision: await options.fingerprint(),
    compatibility: compatibility(),
    backend: backend(backendMode, privateConfigurationRevision),
    runtimeEnvironment: () => ({ ...options.environment }),
  }
}

function compatibility() {
  const capability = () => ({
    observed: 'supported',
    enabled: true,
    effective: true,
  })
  return {
    state: 'verified',
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

function coordinatorForClaude(machineId, dataDirectory, candidate) {
  return new NodeProviderLifecycleCoordinator({
    machineId,
    dataDirectory,
    discoverClaude: async () => discovery([candidate]),
    observeClaude: claudeObservation,
  })
}

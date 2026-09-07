import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import { canonicalFailure } from '@codetether/agent-core'

import {
  ConversationStore,
  currentSchemaVersion,
  restoreDurableConversations,
} from '../dist/persistence/index.js'
import { normalizeTrustedProjectRoot } from '../dist/project-path.js'

const firstObservedAt = '2026-10-05T12:00:00.000Z'
const laterObservedAt = '2026-10-05T12:01:00.000Z'
const latestObservedAt = '2026-10-05T12:02:00.000Z'
const configurationChangedAt = '2026-10-05T12:03:00.000Z'

test('migration 016 preserves v15 Conversations and adds an empty lifecycle graph without probing', async (t) => {
  const fixture = await createFixture(t)
  const seed = ConversationStore.open({ databasePath: fixture.databasePath })
  seed.createConversation(
    conversation(fixture, 'conv_lifecycle_migration', {
      providerThreadId: 'private-native-session-migration',
      providerSessionMaterialized: true,
    }),
  )
  seed.close()

  const downgrade = new DatabaseSync(fixture.databasePath)
  downgrade.exec('PRAGMA foreign_keys = OFF')
  downgrade.exec(`
    DROP TABLE conversation_provider_installation_bindings;
    DROP TABLE provider_backend_observations;
    DROP TABLE provider_installation_compatibility;
    DROP TABLE machine_provider_installation_selections;
    DROP TABLE provider_installations;
    DROP INDEX idx_conversations_provider_installation_identity;
    DELETE FROM schema_migrations WHERE version = 16;
  `)
  downgrade.exec('PRAGMA foreign_keys = ON')
  assert.deepEqual(downgrade.prepare('PRAGMA foreign_key_check').all(), [])
  downgrade.close()

  const migrated = ConversationStore.open({
    databasePath: fixture.databasePath,
  })
  assert.equal(currentSchemaVersion, 16)
  assert.equal(migrated.schemaVersion, 16)
  const preserved = migrated.getConversation('conv_lifecycle_migration')
  assert.ok(preserved)
  assert.equal(preserved.providerThreadId, 'private-native-session-migration')
  assert.equal(preserved.providerInstallationId, undefined)
  assert.deepEqual(migrated.listProviderLifecycles(fixture.machineId), [])
  migrated.close()
})

test('records bounded private installations and presentation-safe lifecycle observations across reopen', async (t) => {
  const fixture = await createFixture(t)
  const store = ConversationStore.open({ databasePath: fixture.databasePath })
  const observation = lifecycleObservation(fixture)
  const lifecycle = store.recordProviderLifecycle(observation)

  assert.equal(lifecycle.provider, 'claude-code')
  assert.equal(lifecycle.selectedInstallationId, installationAId)
  assert.deepEqual(
    lifecycle.installations.map(({ installationId, selected }) => ({
      installationId,
      selected,
    })),
    [
      { installationId: installationAId, selected: true },
      { installationId: installationBId, selected: false },
    ],
  )
  assert.equal(JSON.stringify(lifecycle).includes(fixture.directory), false)

  const privateInstallation = store.getProviderInstallation(installationAId)
  assert.ok(privateInstallation)
  assert.equal(privateInstallation.machineId, fixture.machineId)
  assert.equal(privateInstallation.locatorKey, 'claude-owner-launcher')
  assert.equal(privateInstallation.launcherPath, fixture.claudeLauncher)
  assert.equal(
    privateInstallation.resolvedExecutablePath,
    fixture.claudeResolved,
  )
  assert.equal(privateInstallation.compatibility.state, 'verified')
  assert.equal(privateInstallation.backend.mode, 'custom_gateway')
  assert.equal(privateInstallation.backend.readiness, 'ready')
  store.close()

  const reopened = ConversationStore.open({
    databasePath: fixture.databasePath,
  })
  assert.deepEqual(reopened.listProviderLifecycles(fixture.machineId), [
    lifecycle,
  ])
  assert.deepEqual(
    reopened.getProviderLifecycle(fixture.machineId, 'claude-code'),
    lifecycle,
  )
  reopened.close()

  const inspect = new DatabaseSync(fixture.databasePath)
  assert.deepEqual(inspect.prepare('PRAGMA foreign_key_check').all(), [])
  assert.equal(tableCount(inspect, 'provider_installations'), 2)
  assert.equal(tableCount(inspect, 'provider_installation_compatibility'), 2)
  assert.equal(tableCount(inspect, 'provider_backend_observations'), 2)
  inspect.close()
})

test('complete lifecycle scans tombstone omitted alternatives while truncated scans retain last-known truth', async (t) => {
  const fixture = await createFixture(t)
  const store = ConversationStore.open({ databasePath: fixture.databasePath })
  store.recordProviderLifecycle(lifecycleObservation(fixture))

  const truncated = store.recordProviderLifecycle({
    machineId: fixture.machineId,
    provider: 'claude-code',
    observedAt: laterObservedAt,
    selectedInstallationId: installationAId,
    installationsTruncated: true,
    installations: [
      installationA(fixture, { lastObservedAt: laterObservedAt }),
    ],
  })
  const retainedAlternate = truncated.installations.find(
    ({ installationId }) => installationId === installationBId,
  )
  assert.ok(retainedAlternate)
  assert.equal(retainedAlternate.availability, 'available')
  assert.equal(retainedAlternate.lastObservedAt, firstObservedAt)
  assert.equal(retainedAlternate.compatibility.freshness, 'last_known')
  assert.equal(retainedAlternate.backend.freshness, 'last_known')

  const complete = store.recordProviderLifecycle({
    machineId: fixture.machineId,
    provider: 'claude-code',
    observedAt: latestObservedAt,
    selectedInstallationId: installationAId,
    installations: [
      installationA(fixture, { lastObservedAt: latestObservedAt }),
    ],
  })
  const removedAlternate = complete.installations.find(
    ({ installationId }) => installationId === installationBId,
  )
  assert.ok(removedAlternate)
  assert.equal(removedAlternate.availability, 'unavailable')
  assert.equal(removedAlternate.lastObservedAt, latestObservedAt)
  assert.equal(removedAlternate.compatibility.state, 'unavailable')
  assert.equal(removedAlternate.compatibility.freshness, 'current')
  assert.equal(removedAlternate.backend.freshness, 'last_known')
  store.close()
})

test('a truncated empty snapshot preserves the durable selection as last-known', async (t) => {
  const fixture = await createFixture(t)
  const store = ConversationStore.open({ databasePath: fixture.databasePath })
  store.recordProviderLifecycle(lifecycleObservation(fixture))

  const truncated = store.recordProviderLifecycle({
    machineId: fixture.machineId,
    provider: 'claude-code',
    observedAt: laterObservedAt,
    installationsTruncated: true,
    installations: [],
  })
  assert.equal(truncated.selectedInstallationId, installationAId)
  const selected = truncated.installations.find(
    ({ installationId }) => installationId === installationAId,
  )
  assert.ok(selected)
  assert.equal(selected.selected, true)
  assert.equal(selected.availability, 'available')
  assert.equal(selected.lastObservedAt, firstObservedAt)
  assert.equal(selected.compatibility.freshness, 'last_known')
  assert.equal(selected.backend.freshness, 'last_known')
  store.close()
})

test('a known executable revision can retain truthful not-observed runtime and backend states', async (t) => {
  const fixture = await createFixture(t)
  const store = ConversationStore.open({ databasePath: fixture.databasePath })
  const unknownCapability = (enabled) => ({
    observed: 'unknown',
    enabled,
    effective: false,
  })
  const installation = installationA(fixture, {
    compatibility: {
      state: 'unavailable',
      runtimeReadiness: 'unavailable',
      freshness: 'not_observed',
      contractVersion: 1,
      capabilities: {
        execution: unknownCapability(true),
        streaming: unknownCapability(true),
        nativeResume: unknownCapability(true),
        nativeSessionDiscovery: unknownCapability(true),
        fileRead: unknownCapability(true),
        search: unknownCapability(true),
        toolEvents: unknownCapability(true),
        reasoningControl: unknownCapability(true),
      },
    },
    backend: {
      mode: 'unknown',
      readiness: 'unknown',
      freshness: 'not_observed',
      configuration: {
        source: 'unknown',
        hasBaseUrl: false,
        hasApiKey: false,
        hasAuthToken: false,
        hasOAuthToken: false,
        bedrockConfigured: false,
        vertexConfigured: false,
      },
    },
  })

  const lifecycle = store.recordProviderLifecycle({
    machineId: fixture.machineId,
    provider: 'claude-code',
    observedAt: firstObservedAt,
    selectedInstallationId: installationAId,
    installations: [installation],
  })

  assert.equal(lifecycle.installations[0].revision, revisionA1)
  assert.equal(
    lifecycle.installations[0].compatibility.freshness,
    'not_observed',
  )
  assert.equal(lifecycle.installations[0].backend.freshness, 'not_observed')
  store.close()
})

test('revision changes invalidate stale compatibility and backend cache while retaining logical installation identity', async (t) => {
  const fixture = await createFixture(t)
  const store = ConversationStore.open({ databasePath: fixture.databasePath })
  store.recordProviderLifecycle(lifecycleObservation(fixture))

  const simultaneousReplacement = store.recordProviderLifecycle({
    machineId: fixture.machineId,
    provider: 'claude-code',
    observedAt: firstObservedAt,
    selectedInstallationId: installationAId,
    installations: [
      installationA(fixture, {
        version: '2.1.264',
        revision: revisionA2,
        compatibility: undefined,
        backend: undefined,
      }),
    ],
  })
  assert.equal(simultaneousReplacement.installations[0].revision, revisionA1)

  const updatedInstallation = installationA(fixture, {
    version: '2.1.264',
    revision: revisionA2,
    lastObservedAt: laterObservedAt,
    compatibility: undefined,
    backend: undefined,
  })
  const updated = store.recordProviderLifecycle({
    machineId: fixture.machineId,
    provider: 'claude-code',
    observedAt: laterObservedAt,
    selectedInstallationId: installationAId,
    installations: [updatedInstallation],
  })
  assert.equal(updated.installations[0].installationId, installationAId)
  assert.equal(updated.installations[0].revision, revisionA2)
  assert.equal(updated.installations[0].version, '2.1.264')
  assert.equal(updated.installations[0].compatibility, undefined)
  assert.equal(updated.installations[0].backend, undefined)

  const revalidated = store.recordProviderLifecycle({
    machineId: fixture.machineId,
    provider: 'claude-code',
    observedAt: latestObservedAt,
    selectedInstallationId: installationAId,
    installations: [
      installationA(fixture, {
        version: '2.1.264',
        revision: revisionA2,
        lastObservedAt: latestObservedAt,
        compatibility: compatibility('compatible_unverified'),
        backend: customGatewayBackend(),
      }),
    ],
  })
  assert.equal(
    revalidated.installations[0].compatibility.state,
    'compatible_unverified',
  )

  const staleObservation = lifecycleObservation(fixture)
  const stale = store.recordProviderLifecycle({
    ...staleObservation,
    installations: [
      ...staleObservation.installations,
      installationB(fixture, {
        installationId: staleInstallationId,
        locatorKey: 'claude-stale-launcher',
        launcherPath: normalizeTrustedProjectRoot(
          join(fixture.directory, 'stale', 'bin', 'claude'),
        ).rootPath,
        resolvedExecutablePath: normalizeTrustedProjectRoot(
          join(fixture.directory, 'stale', 'lib', 'cli.js'),
        ).rootPath,
        revision: 'prev_claude_stale_revision_0001',
      }),
    ],
  })
  assert.equal(stale.installations[0].revision, revisionA2)
  assert.equal(
    stale.installations[0].compatibility.state,
    'compatible_unverified',
  )
  assert.equal(store.getProviderInstallation(staleInstallationId), undefined)
  store.close()
})

test('an explicit no-selection snapshot retains a timestamped tombstone against stale probe completion', async (t) => {
  const fixture = await createFixture(t)
  const store = ConversationStore.open({ databasePath: fixture.databasePath })
  store.recordProviderLifecycle(lifecycleObservation(fixture))
  store.recordProviderLifecycle({
    machineId: fixture.machineId,
    provider: 'claude-code',
    observedAt: laterObservedAt,
    installations: [
      installationA(fixture, {
        selected: false,
        lastObservedAt: laterObservedAt,
      }),
    ],
  })
  store.recordProviderLifecycle(lifecycleObservation(fixture))

  const lifecycle = store.getProviderLifecycle(fixture.machineId, 'claude-code')
  assert.ok(lifecycle)
  assert.equal(lifecycle.selectedInstallationId, undefined)
  assert.ok(
    lifecycle.installations.every(
      (installation) => installation.selected === false,
    ),
  )
  store.close()
})

test('backend readiness updates are revision-guarded and cannot regress to an older observation', async (t) => {
  const fixture = await createFixture(t)
  const store = ConversationStore.open({ databasePath: fixture.databasePath })
  store.recordProviderLifecycle(lifecycleObservation(fixture))
  const unavailable = store.recordProviderBackendObservation(
    installationAId,
    revisionA1,
    {
      ...customGatewayBackend(),
      readiness: 'unavailable',
      observedAt: latestObservedAt,
      failure: canonicalFailure(
        'provider_service_unavailable',
        latestObservedAt,
      ),
    },
  )
  assert.equal(unavailable.backend.readiness, 'unavailable')

  const retained = store.recordProviderBackendObservation(
    installationAId,
    revisionA1,
    customGatewayBackend(),
  )
  assert.equal(retained.backend.readiness, 'unavailable')
  assert.equal(retained.backend.observedAt, latestObservedAt)
  assert.throws(
    () =>
      store.recordProviderBackendObservation(
        installationAId,
        revisionA2,
        customGatewayBackend(),
      ),
    /stale installation revision/u,
  )
  store.close()
})

test('metadata refresh retains explicit backend readiness as last-known until configuration changes', async (t) => {
  const fixture = await createFixture(t)
  const store = ConversationStore.open({ databasePath: fixture.databasePath })
  store.recordProviderLifecycle(lifecycleObservation(fixture))
  store.recordProviderBackendObservation(installationAId, revisionA1, {
    ...customGatewayBackend(),
    readiness: 'unavailable',
    observedAt: laterObservedAt,
    failure: canonicalFailure('provider_service_unavailable', laterObservedAt),
  })

  const metadataOnly = store.recordProviderLifecycle({
    machineId: fixture.machineId,
    provider: 'claude-code',
    observedAt: latestObservedAt,
    selectedInstallationId: installationAId,
    installations: [
      installationA(fixture, {
        lastObservedAt: latestObservedAt,
        compatibility: {
          ...compatibility('verified'),
          observedAt: latestObservedAt,
        },
        backend: {
          ...customGatewayBackend(),
          readiness: 'unknown',
          observedAt: latestObservedAt,
        },
      }),
    ],
  })
  const retained = metadataOnly.installations[0].backend
  assert.equal(retained.readiness, 'unavailable')
  assert.equal(retained.freshness, 'last_known')
  assert.equal(retained.observedAt, laterObservedAt)
  assert.equal(retained.failure.reason, 'provider_service_unavailable')
  assert.equal(metadataOnly.installations[0].compatibility.freshness, 'current')
  assert.equal(
    metadataOnly.installations[0].compatibility.observedAt,
    latestObservedAt,
  )

  const changedConfiguration = store.recordProviderLifecycle({
    machineId: fixture.machineId,
    provider: 'claude-code',
    observedAt: configurationChangedAt,
    selectedInstallationId: installationAId,
    installations: [
      installationA(fixture, {
        lastObservedAt: configurationChangedAt,
        backend: {
          ...customGatewayBackend(),
          readiness: 'unknown',
          configurationRevision: 'pbcfg_claude_owner0002',
          observedAt: configurationChangedAt,
        },
      }),
    ],
  })
  const invalidated = changedConfiguration.installations[0].backend
  assert.equal(invalidated.readiness, 'unknown')
  assert.equal(invalidated.freshness, 'current')
  assert.equal(invalidated.observedAt, configurationChangedAt)
  assert.equal(invalidated.failure, undefined)

  store.close()
})

test('backend persistence rejects value-bearing credential fields and stores only safe metadata', async (t) => {
  const fixture = await createFixture(t)
  const store = ConversationStore.open({ databasePath: fixture.databasePath })
  const secret = 'phase8b-test-secret-must-not-persist'
  const observation = lifecycleObservation(fixture)
  observation.installations[0].backend.configuration.authToken = secret
  assert.throws(
    () => store.recordProviderLifecycle(observation),
    /unrecognized key|Unrecognized key/u,
  )
  store.recordProviderLifecycle(lifecycleObservation(fixture))
  store.close()

  const inspect = new DatabaseSync(fixture.databasePath)
  const serialized = JSON.stringify(
    inspect.prepare('SELECT * FROM provider_backend_observations').all(),
  )
  assert.equal(serialized.includes(secret), false)
  assert.equal(serialized.includes('authToken'), false)
  inspect.close()
})

test('Conversation installation binding is atomic, durable, immutable, and independent from later Machine selection', async (t) => {
  const fixture = await createFixture(t)
  const store = ConversationStore.open({ databasePath: fixture.databasePath })
  store.recordProviderLifecycle(lifecycleObservation(fixture))

  store.runInTransaction(() => {
    store.createConversation(
      conversation(fixture, 'conv_lifecycle_bound', {
        providerInstallationId: installationAId,
      }),
    )
  })
  assert.equal(
    store.getConversation('conv_lifecycle_bound').providerInstallationId,
    installationAId,
  )

  store.recordProviderLifecycle({
    ...lifecycleObservation(fixture),
    observedAt: laterObservedAt,
    selectedInstallationId: installationBId,
    installations: [
      installationA(fixture, {
        selected: false,
        lastObservedAt: laterObservedAt,
      }),
      installationB(fixture, {
        selected: true,
        lastObservedAt: laterObservedAt,
      }),
    ],
  })
  assert.equal(
    store.getProviderLifecycle(fixture.machineId, 'claude-code')
      .selectedInstallationId,
    installationBId,
  )
  store.recordProviderLifecycle(lifecycleObservation(fixture))
  assert.equal(
    store.getProviderLifecycle(fixture.machineId, 'claude-code')
      .selectedInstallationId,
    installationBId,
  )
  const bound = store.getConversation('conv_lifecycle_bound')
  assert.equal(bound.providerInstallationId, installationAId)
  assert.throws(
    () =>
      store.updateConversation({
        ...bound,
        providerInstallationId: installationBId,
      }),
    /execution binding is immutable/u,
  )
  assert.throws(
    () =>
      store.updateConversation({
        ...bound,
        providerInstallationId: undefined,
      }),
    /execution binding is immutable/u,
  )

  store.createConversation(
    conversation(fixture, 'conv_lifecycle_legacy_unbound'),
  )
  assert.equal(
    store.bindLegacyConversationInstallation(
      'conv_lifecycle_legacy_unbound',
      installationAId,
    ).providerInstallationId,
    installationAId,
  )
  assert.equal(
    store.bindLegacyConversationInstallation(
      'conv_lifecycle_legacy_unbound',
      installationAId,
    ).providerInstallationId,
    installationAId,
  )
  assert.throws(
    () =>
      store.bindLegacyConversationInstallation(
        'conv_lifecycle_legacy_unbound',
        installationBId,
      ),
    /immutable/u,
  )

  assert.throws(
    () =>
      store.createConversation(
        conversation(fixture, 'conv_lifecycle_wrong_provider', {
          provider: 'codex',
          providerInstallationId: installationAId,
        }),
      ),
    /FOREIGN KEY constraint failed/u,
  )
  assert.equal(
    store.getConversation('conv_lifecycle_wrong_provider'),
    undefined,
  )
  store.close()

  const reopened = ConversationStore.open({
    databasePath: fixture.databasePath,
  })
  assert.equal(
    reopened.getConversation('conv_lifecycle_bound').providerInstallationId,
    installationAId,
  )
  assert.equal(
    reopened.getConversation('conv_lifecycle_legacy_unbound')
      .providerInstallationId,
    installationAId,
  )
  reopened.close()
})

test('durable installation alternatives are bounded while selected and Conversation-bound installations survive restart', async (t) => {
  const fixture = await createFixture(t)
  const store = ConversationStore.open({ databasePath: fixture.databasePath })

  store.recordProviderLifecycle({
    machineId: fixture.machineId,
    provider: 'claude-code',
    observedAt: firstObservedAt,
    selectedInstallationId: installationAId,
    installations: [installationA(fixture), installationB(fixture)],
  })
  store.createConversation(
    conversation(fixture, 'conv_lifecycle_retained_binding', {
      providerInstallationId: installationBId,
    }),
  )

  for (let index = 0; index < 40; index += 1) {
    const timestamp = new Date(
      Date.parse(laterObservedAt) + index * 1_000,
    ).toISOString()
    store.recordProviderLifecycle({
      machineId: fixture.machineId,
      provider: 'claude-code',
      observedAt: timestamp,
      selectedInstallationId: installationAId,
      installations: [
        installationA(fixture),
        historicalClaudeInstallation(fixture, index, timestamp),
      ],
    })
  }

  const lifecycle = store.getProviderLifecycle(fixture.machineId, 'claude-code')
  assert.ok(lifecycle)
  assert.equal(lifecycle.installations.length, 8)
  assert.equal(lifecycle.selectedInstallationId, installationAId)
  assert.ok(store.getProviderInstallation(installationAId))
  assert.ok(store.getProviderInstallation(installationBId))
  assert.equal(
    store.getConversation('conv_lifecycle_retained_binding')
      .providerInstallationId,
    installationBId,
  )
  assert.equal(
    store.getProviderInstallation('pinst_fixture_historical_00'),
    undefined,
  )
  assert.ok(store.getProviderInstallation('pinst_fixture_historical_39'))

  const inspect = new DatabaseSync(fixture.databasePath)
  assert.equal(tableCount(inspect, 'provider_installations'), 10)
  assert.equal(tableCount(inspect, 'provider_installation_compatibility'), 10)
  assert.equal(tableCount(inspect, 'provider_backend_observations'), 10)
  assert.deepEqual(inspect.prepare('PRAGMA foreign_key_check').all(), [])
  inspect.close()
  store.close()

  const reopened = ConversationStore.open({
    databasePath: fixture.databasePath,
  })
  assert.equal(
    reopened.getProviderLifecycle(fixture.machineId, 'claude-code')
      .selectedInstallationId,
    installationAId,
  )
  assert.ok(reopened.getProviderInstallation(installationAId))
  assert.ok(reopened.getProviderInstallation(installationBId))
  assert.equal(
    reopened.getConversation('conv_lifecycle_retained_binding')
      .providerInstallationId,
    installationBId,
  )
  reopened.close()
})

test('adopted native-session binding and Provider installation binding persist atomically without exposing either identity publicly', async (t) => {
  const fixture = await createFixture(t)
  const store = ConversationStore.open({ databasePath: fixture.databasePath })
  store.recordProviderLifecycle(lifecycleObservation(fixture))
  const adopted = store.createOrGetAdoptedConversation(
    conversation(fixture, 'conv_lifecycle_adopted', {
      providerThreadId: 'private-native-session-lifecycle',
      providerInstallationId: installationAId,
    }),
  )
  assert.equal(adopted.created, true)
  assert.equal(adopted.conversation.origin, 'adopted_native')
  assert.equal(adopted.conversation.providerInstallationId, installationAId)

  const duplicate = store.createOrGetAdoptedConversation(
    conversation(fixture, 'conv_lifecycle_adopted_duplicate', {
      providerThreadId: 'private-native-session-lifecycle',
      providerInstallationId: installationAId,
    }),
  )
  assert.equal(duplicate.created, false)
  assert.equal(
    duplicate.conversation.conversationId,
    adopted.conversation.conversationId,
  )
  const [restored] = restoreDurableConversations(store, {
    maxConversations: 8,
    maxTurns: 8,
    maxEntries: 32,
    now: latestObservedAt,
  })
  assert.ok(restored)
  assert.equal(restored.providerInstallationId, installationAId)
  assert.equal(restored.providerThreadId, 'private-native-session-lifecycle')
  assert.equal(
    JSON.stringify(store.listProjectConversations(fixture.projectId)).includes(
      installationAId,
    ),
    false,
  )
  assert.equal(
    JSON.stringify(store.listProjectConversations(fixture.projectId)).includes(
      'private-native-session-lifecycle',
    ),
    false,
  )
  store.close()
})

async function createFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-phase8b-store-'))
  const workspace = join(directory, 'workspace')
  const databasePath = join(directory, 'codetether.sqlite3')
  await mkdir(workspace, { recursive: true })
  const store = ConversationStore.open({ databasePath })
  const machine = store.listMachines()[0]
  assert.ok(machine)
  const root = normalizeTrustedProjectRoot(workspace)
  const fixture = {
    directory,
    workspace,
    databasePath,
    machineId: machine.machineId,
    projectId: 'proj_lifecycle01',
    claudeLauncher: normalizeTrustedProjectRoot(
      join(directory, 'provider', 'bin', 'claude'),
    ).rootPath,
    claudeResolved: normalizeTrustedProjectRoot(
      join(directory, 'provider', 'versions', '2.1.263', 'claude'),
    ).rootPath,
  }
  store.createProject({
    projectId: fixture.projectId,
    name: 'Lifecycle fixture',
    locations: [
      {
        projectId: fixture.projectId,
        machineId: fixture.machineId,
        rootPath: root.rootPath,
        rootPathKey: root.rootPathKey,
        createdAt: firstObservedAt,
        updatedAt: firstObservedAt,
      },
    ],
    createdAt: firstObservedAt,
    updatedAt: firstObservedAt,
  })
  store.close()
  t.after(async () => {
    await rm(directory, { recursive: true, force: true, maxRetries: 5 })
  })
  return fixture
}

function lifecycleObservation(fixture) {
  return {
    machineId: fixture.machineId,
    provider: 'claude-code',
    observedAt: firstObservedAt,
    selectedInstallationId: installationAId,
    installations: [installationA(fixture), installationB(fixture)],
  }
}

const installationAId = 'pinst_claude_owner0001'
const installationBId = 'pinst_claude_alternate0001'
const staleInstallationId = 'pinst_claude_stale0001'
const revisionA1 = 'prev_claude_owner_revision0001'
const revisionA2 = 'prev_claude_owner_revision0002'

function installationA(fixture, overrides = {}) {
  return installation(fixture, {
    installationId: installationAId,
    locatorKey: 'claude-owner-launcher',
    launcherPath: fixture.claudeLauncher,
    resolvedExecutablePath: fixture.claudeResolved,
    selected: true,
    version: '2.1.263',
    revision: revisionA1,
    ...overrides,
  })
}

function installationB(fixture, overrides = {}) {
  return installation(fixture, {
    installationId: installationBId,
    locatorKey: 'claude-isolated-launcher',
    launcherPath: normalizeTrustedProjectRoot(
      join(fixture.directory, 'isolated', 'bin', 'claude'),
    ).rootPath,
    resolvedExecutablePath: normalizeTrustedProjectRoot(
      join(fixture.directory, 'isolated', 'lib', 'cli.js'),
    ).rootPath,
    selected: false,
    version: '2.1.251',
    revision: 'prev_claude_alternate0001',
    ...overrides,
  })
}

function installation(fixture, values) {
  return {
    machineId: fixture.machineId,
    provider: 'claude-code',
    launcherKind: 'symlink',
    installMethod: 'native_installer',
    availability: 'available',
    firstObservedAt,
    lastObservedAt: firstObservedAt,
    compatibility: compatibility('verified'),
    backend: customGatewayBackend(),
    ...values,
  }
}

function compatibility(state) {
  const supported = (enabled = true) => ({
    observed: 'supported',
    enabled,
    effective: enabled,
  })
  return {
    state,
    runtimeReadiness: 'ready',
    freshness: 'current',
    contractVersion: 1,
    observedAt:
      state === 'compatible_unverified' ? latestObservedAt : firstObservedAt,
    capabilities: {
      execution: supported(),
      streaming: supported(),
      nativeResume: supported(),
      nativeSessionDiscovery: supported(),
      fileRead: supported(),
      search: supported(),
      toolEvents: supported(),
      reasoningControl: supported(),
    },
  }
}

function customGatewayBackend() {
  return {
    mode: 'custom_gateway',
    readiness: 'ready',
    freshness: 'current',
    configurationRevision: 'pbcfg_claude_owner0001',
    configuration: {
      source: 'process_environment',
      hasBaseUrl: true,
      hasApiKey: false,
      hasAuthToken: true,
      hasOAuthToken: false,
      bedrockConfigured: false,
      vertexConfigured: false,
    },
    sanitizedOrigin: 'gateway.example.test',
    observedAt: firstObservedAt,
  }
}

function conversation(fixture, conversationId, overrides = {}) {
  return {
    conversationId,
    projectId: fixture.projectId,
    machineId: fixture.machineId,
    title: 'Provider lifecycle fixture',
    provider: 'claude-code',
    cwd: fixture.workspace,
    status: 'idle',
    createdAt: firstObservedAt,
    updatedAt: firstObservedAt,
    lastActivityAt: firstObservedAt,
    ...overrides,
  }
}

function historicalClaudeInstallation(fixture, index, observedAt) {
  const suffix = String(index).padStart(2, '0')
  return installation(fixture, {
    installationId: `pinst_fixture_historical_${suffix}`,
    locatorKey: `fixture-historical-${suffix}`,
    launcherPath: normalizeTrustedProjectRoot(
      join(fixture.directory, 'historical', suffix, 'bin', 'claude'),
    ).rootPath,
    resolvedExecutablePath: normalizeTrustedProjectRoot(
      join(fixture.directory, 'historical', suffix, 'lib', 'cli.js'),
    ).rootPath,
    selected: false,
    version: `2.1.${String(300 + index)}`,
    revision: `prev_fixture_historical_revision_${suffix}`,
    firstObservedAt: observedAt,
    lastObservedAt: observedAt,
    compatibility: {
      ...compatibility('compatible_unverified'),
      observedAt,
    },
    backend: {
      ...customGatewayBackend(),
      observedAt,
    },
  })
}

function tableCount(database, table) {
  return database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count
}

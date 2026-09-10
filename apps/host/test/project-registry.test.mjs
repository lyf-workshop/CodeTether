import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync as makeTemporaryDirectorySync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  ProjectRegistry,
  ProjectRegistryError,
} from '../dist/api/project-registry.js'
import { WorkspacePolicy } from '../dist/api/workspace-policy.js'
import { ConversationStore } from '../dist/persistence/index.js'
import { normalizeTrustedProjectRoot } from '../dist/project-path.js'

const timestamp = '2026-08-31T12:00:00.000Z'
const later = '2026-08-31T12:01:00.000Z'

function mkdtempSync(prefix) {
  return realpathSync(makeTemporaryDirectorySync(prefix))
}

test('ProjectRegistry projects retain all locations while Machine projections contain only that Machine location', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'codetether-project-registry-'))
  const databasePath = join(directory, 'codetether.sqlite3')
  const localRoot = join(directory, 'local project')
  mkdirSync(localRoot)
  let store

  try {
    store = ConversationStore.open({ databasePath })
    const [localMachine] = store.listMachines()
    assert.ok(localMachine)
    const remote = remoteCandidate('machine_projectregistryremote01')
    store.createRemoteMachineWithTrust(remote.machine, remote.trust)
    store.activateTrustedMachinePeer(remote.machine.machineId, later)

    const normalized = normalizeTrustedProjectRoot(localRoot)
    store.createProject({
      projectId: 'proj_projectregistry01',
      name: 'Project Registry',
      locations: [
        {
          projectId: 'proj_projectregistry01',
          machineId: localMachine.machineId,
          rootPath: normalized.rootPath,
          rootPathKey: normalized.rootPathKey,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    const registry = new ProjectRegistry({
      workspacePolicy: {
        authorizeProjectRoot: async (path) => path,
        authorizeProjectWorkspace: async (_root, cwd) => cwd,
        inspectProjectRoot: async () => 'available',
      },
      persistence: store,
      now: () => later,
      localMachineId: localMachine.machineId,
      machineAvailability: () => 'available',
      writeDurable: (operation) => operation(),
      hasRuntimeConversations: () => false,
    })

    const remotePath = String.raw`C:\Work\Project Registry 中文`
    const registered = await registry.registerRemoteLocation(
      'proj_projectregistry01',
      remote.machine.machineId,
      remotePath,
    )
    assert.equal(registered.created, true)

    const fullProject = await registry.get('proj_projectregistry01')
    assert.deepEqual(
      fullProject.locations.map((location) => location.machineId),
      [localMachine.machineId, remote.machine.machineId].sort(),
    )

    const [localProjection] = await registry.listForMachine(
      localMachine.machineId,
    )
    assert.deepEqual(
      localProjection.locations.map((location) => location.machineId),
      [localMachine.machineId],
    )

    const [remoteProjection] = await registry.listForMachine(
      remote.machine.machineId,
    )
    assert.deepEqual(remoteProjection.locations, [
      {
        projectId: 'proj_projectregistry01',
        machineId: remote.machine.machineId,
        rootPath: remotePath,
        availability: 'available',
        createdAt: later,
        updatedAt: later,
      },
    ])

    const repeated = await registry.registerRemoteLocation(
      'proj_projectregistry01',
      remote.machine.machineId,
      remotePath,
    )
    assert.equal(repeated.created, false)
    assert.equal((await registry.list())[0].locations.length, 2)
    await assert.rejects(
      registry.authorizeConversation(
        'proj_projectregistry01',
        remote.machine.machineId,
      ),
      (error) =>
        error instanceof ProjectRegistryError && error.code === 'unavailable',
    )

    const removed = await registry.removeLocation(
      'proj_projectregistry01',
      remote.machine.machineId,
    )
    assert.deepEqual(
      removed.locations.map((location) => location.machineId),
      [localMachine.machineId],
    )
    assert.deepEqual(
      await registry.listForMachine(remote.machine.machineId),
      [],
    )
    assert.equal(
      store.getProjectLocation(
        'proj_projectregistry01',
        remote.machine.machineId,
      ),
      undefined,
    )
    assert.ok(store.getMachine(remote.machine.machineId))
    assert.equal(
      store.getTrustedMachinePeer(remote.machine.machineId).trustState,
      'active',
    )
    await assert.rejects(
      registry.removeLocation(
        'proj_projectregistry01',
        remote.machine.machineId,
      ),
      (error) =>
        error instanceof ProjectRegistryError &&
        error.code === 'location_not_found',
    )
    await assert.rejects(
      registry.removeLocation('proj_projectregistry01', localMachine.machineId),
      (error) =>
        error instanceof ProjectRegistryError &&
        error.code === 'local_location_required',
    )
  } finally {
    store?.close()
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    })
  }
})

test('ProjectRegistry creates and reuses a remote-only Project by canonical Machine location', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'codetether-remote-project-'))
  const databasePath = join(directory, 'codetether.sqlite3')
  let store

  try {
    store = ConversationStore.open({ databasePath })
    const [localMachine] = store.listMachines()
    assert.ok(localMachine)
    const remote = remoteCandidate('machine_remoteonlyproject01')
    store.createRemoteMachineWithTrust(remote.machine, remote.trust)
    store.activateTrustedMachinePeer(remote.machine.machineId, later)
    const registry = new ProjectRegistry({
      workspacePolicy: await WorkspacePolicy.create(),
      persistence: store,
      now: () => later,
      localMachineId: localMachine.machineId,
      machineAvailability: () => 'available',
      writeDurable: (operation) => operation(),
      hasRuntimeConversations: () => false,
    })
    const canonicalPath = String.raw`C:\Work\Remote only`

    const created = await registry.createRemote(
      remote.machine.machineId,
      canonicalPath,
      'Remote only',
    )
    assert.equal(created.created, true)
    assert.equal(created.project.name, 'Remote only')
    assert.deepEqual(created.project.locations, [
      {
        projectId: created.project.projectId,
        machineId: remote.machine.machineId,
        rootPath: canonicalPath,
        availability: 'available',
        createdAt: later,
        updatedAt: later,
      },
    ])

    const repeated = await registry.createRemote(
      remote.machine.machineId,
      canonicalPath,
      'Ignored replacement name',
    )
    assert.equal(repeated.created, false)
    assert.equal(repeated.project.projectId, created.project.projectId)
    assert.equal(repeated.project.name, 'Remote only')
    assert.equal((await registry.list()).length, 1)
    assert.ok(
      store.getProjectLocation(
        created.project.projectId,
        remote.machine.machineId,
      ),
    )
    await assert.rejects(
      registry.createRemote(localMachine.machineId, canonicalPath),
      (error) =>
        error instanceof ProjectRegistryError &&
        error.code === 'location_conflict',
    )
    await assert.rejects(
      registry.removeLocation(
        created.project.projectId,
        remote.machine.machineId,
      ),
      (error) =>
        error instanceof ProjectRegistryError &&
        error.code === 'local_location_required',
    )
  } finally {
    store?.close()
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    })
  }
})

test('legacy cwd resolution selects the deepest matching local Project Location', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'codetether-project-nesting-'))
  const databasePath = join(directory, 'codetether.sqlite3')
  const outerRoot = join(directory, 'workspace')
  const innerRoot = join(outerRoot, 'nested')
  const conversationRoot = join(innerRoot, 'conversation')
  mkdirSync(conversationRoot, { recursive: true })
  let store

  try {
    store = ConversationStore.open({ databasePath })
    const [localMachine] = store.listMachines()
    assert.ok(localMachine)
    const registry = new ProjectRegistry({
      workspacePolicy: await WorkspacePolicy.create(),
      persistence: store,
      now: () => later,
      localMachineId: localMachine.machineId,
      writeDurable: (operation) => operation(),
      hasRuntimeConversations: () => false,
    })

    const outer = await registry.create(outerRoot, 'Outer')
    const inner = await registry.create(innerRoot, 'Inner')
    const resolved = await registry.resolveLegacyConversation(
      conversationRoot,
      localMachine.machineId,
    )

    assert.notEqual(outer.project.projectId, inner.project.projectId)
    assert.equal(resolved.project.projectId, inner.project.projectId)
    assert.equal(
      resolved.cwd,
      normalizeTrustedProjectRoot(conversationRoot).rootPath,
    )
  } finally {
    store?.close()
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    })
  }
})

function remoteCandidate(machineId) {
  return {
    machine: {
      machineId,
      displayName: 'Remote Project Registry',
      kind: 'remote',
      platform: 'Windows',
      architecture: 'x64',
      createdAt: timestamp,
    },
    trust: {
      machineId,
      nodeIdentity: 'node_identity_projectregistry01',
      peerPublicKeySpki: new Uint8Array(64).fill(112),
      peerKeyFingerprint: 'p'.repeat(43),
      controllerCredentialRef: 'credential-projectregistry01',
      controllerKeyFingerprint: 'c'.repeat(43),
      trustState: 'pending',
      protocolVersion: 1,
      address: { host: '192.0.2.70', port: 43_218 },
      pairedAt: timestamp,
      updatedAt: timestamp,
    },
  }
}

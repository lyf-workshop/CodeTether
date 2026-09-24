import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { ConversationStore } from '../dist/persistence/index.js'
import { normalizeTrustedProjectRoot } from '../dist/project-path.js'

const baseTime = Date.parse('2026-09-25T12:00:00.000Z')

test('Supervisor Project directory is Machine-scoped, complete, and stably paginated', () => {
  withFixture(({ store, localMachineId, remoteMachineId, projectIds }) => {
    const observed = []
    let cursor
    do {
      const page = store.listSupervisorProjects(localMachineId, {
        limit: 5,
        ...(cursor === undefined ? {} : { cursor }),
      })
      observed.push(...page.projects)
      assert.equal(page.hasMore, page.nextCursor !== undefined)
      cursor = page.nextCursor
    } while (cursor !== undefined)

    assert.equal(observed.length, projectIds.length)
    assert.equal(
      new Set(observed.map((project) => project.projectId)).size,
      projectIds.length,
    )
    assert.deepEqual(
      observed.map((project) => project.projectId),
      [projectIds[1], projectIds[0], ...projectIds.slice(2).reverse()],
    )
    assert.ok(observed.every((project) => project.machineId === localMachineId))
    assert.ok(observed.every((project) => !('rootPath' in project)))

    const shared = store.getSupervisorProject(remoteMachineId, projectIds[0])
    assert.equal(shared?.projectId, projectIds[0])
    assert.equal(shared?.machineId, remoteMachineId)
    assert.equal(
      store.getSupervisorProject(remoteMachineId, projectIds[1]),
      undefined,
    )

    const first = store.listSupervisorProjects(localMachineId, { limit: 2 })
    assert.ok(first.nextCursor)
    assert.throws(
      () =>
        store.listSupervisorProjects(remoteMachineId, {
          limit: 2,
          cursor: first.nextCursor,
        }),
      /invalid_request/,
    )
  })
})

test('Supervisor Conversation directory preserves bindings, provenance, and stable pagination', () => {
  withFixture(({ store, localMachineId, remoteMachineId, projectIds }) => {
    const projectId = projectIds[0]
    const observed = []
    let cursor
    do {
      const page = store.listSupervisorConversations(
        localMachineId,
        projectId,
        {
          limit: 13,
          ...(cursor === undefined ? {} : { cursor }),
        },
      )
      observed.push(...page.conversations)
      assert.equal(page.hasMore, page.nextCursor !== undefined)
      cursor = page.nextCursor
    } while (cursor !== undefined)

    assert.equal(observed.length, 61)
    assert.equal(
      new Set(observed.map((conversation) => conversation.conversationId)).size,
      61,
    )
    assert.equal(observed[0].conversationId, conversationId('local', 60))
    assert.equal(observed[30].conversationId, conversationId('local', 30))
    assert.equal(observed.at(-1).conversationId, conversationId('local', 0))
    assert.ok(
      observed.every(
        (conversation) =>
          conversation.projectId === projectId &&
          conversation.machineId === localMachineId &&
          !('providerThreadId' in conversation) &&
          !('cwd' in conversation),
      ),
    )
    assert.equal(
      observed.some((conversation) => conversation.provider === 'codex'),
      true,
    )
    assert.equal(
      observed.some((conversation) => conversation.provider === 'claude-code'),
      true,
    )
    assert.equal(
      observed.some((conversation) => conversation.origin === 'adopted_native'),
      true,
    )
    assert.equal(
      observed.some((conversation) => conversation.origin === 'codetether'),
      true,
    )
    assert.equal(
      observed.find((conversation) => conversation.origin === 'adopted_native')
        ?.resumability,
      'resumable',
    )

    const remote = store.listSupervisorConversations(
      remoteMachineId,
      projectId,
      { limit: 10 },
    )
    assert.deepEqual(
      remote.conversations.map((conversation) => conversation.conversationId),
      [conversationId('remote', 0)],
    )
    assert.equal(
      store.getSupervisorConversation(
        remoteMachineId,
        projectId,
        conversationId('local', 0),
      ),
      undefined,
    )
    assert.equal(
      store.getSupervisorConversation(
        localMachineId,
        projectIds[1],
        conversationId('local', 0),
      ),
      undefined,
    )
  })
})

function withFixture(run) {
  const directory = mkdtempSync(
    join(tmpdir(), 'codetether-supervisor-directory-'),
  )
  const store = ConversationStore.open({
    databasePath: join(directory, 'codetether.sqlite3'),
  })
  try {
    const localMachineId = store.listMachines()[0].machineId
    const remoteMachineId = 'machine_supervisordirectoryremote01'
    const remote = remoteCandidate(remoteMachineId)
    store.createRemoteMachineWithTrust(remote.machine, remote.trust)
    store.activateTrustedMachinePeer(remoteMachineId, timestamp(1))

    const projectIds = Array.from(
      { length: 14 },
      (_, index) => `proj_supervisor_${String(index).padStart(4, '0')}`,
    )
    for (const [index, projectId] of projectIds.entries()) {
      const localRoot = normalizedRoot(directory, `local-${String(index)}`)
      const locations = [
        location(projectId, localMachineId, localRoot, timestamp(index + 2)),
      ]
      if (index === 0) {
        const remoteRoot = normalizedRoot(directory, 'remote-shared')
        locations.push(
          location(
            projectId,
            remoteMachineId,
            remoteRoot,
            timestamp(index + 2),
          ),
        )
      }
      store.createProject({
        projectId,
        name: `Project ${String(index)}`,
        locations,
        createdAt: timestamp(index + 2),
        updatedAt: timestamp(index + 2),
      })
    }

    const primaryProject = projectIds[0]
    const primaryRoot = normalizedRoot(directory, 'local-0').rootPath
    for (let index = 0; index < 61; index += 1) {
      store.createConversation(
        conversation(
          conversationId('local', index),
          primaryProject,
          localMachineId,
          primaryRoot,
          index,
          {
            provider: index % 2 === 0 ? 'codex' : 'claude-code',
            ...(index === 17
              ? {
                  origin: 'adopted_native',
                  providerThreadId: 'native-adopted-thread',
                  providerSessionMaterialized: true,
                }
              : {}),
          },
        ),
      )
    }
    store.createConversation(
      conversation(
        conversationId('remote', 0),
        primaryProject,
        remoteMachineId,
        normalizedRoot(directory, 'remote-shared').rootPath,
        100,
      ),
    )
    store.createConversation(
      conversation(
        'conv_supervisor_other_project_0001',
        projectIds[1],
        localMachineId,
        normalizedRoot(directory, 'local-1').rootPath,
        101,
      ),
    )

    run({ store, localMachineId, remoteMachineId, projectIds })
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

function normalizedRoot(directory, suffix) {
  return normalizeTrustedProjectRoot(join(directory, suffix))
}

function location(projectId, machineId, root, at) {
  return {
    projectId,
    machineId,
    rootPath: root.rootPath,
    rootPathKey: root.rootPathKey,
    createdAt: at,
    updatedAt: at,
  }
}

function conversation(id, projectId, machineId, cwd, index, overrides = {}) {
  const at = timestamp(200 + index)
  return {
    conversationId: id,
    projectId,
    machineId,
    title: `Conversation ${String(index)}`,
    titleSource: 'generated',
    provider: 'codex',
    cwd,
    status: 'completed',
    createdAt: at,
    updatedAt: at,
    lastActivityAt: at,
    ...overrides,
  }
}

function conversationId(machine, index) {
  return `conv_supervisor_${machine}_${String(index).padStart(4, '0')}`
}

function timestamp(offset) {
  return new Date(baseTime + offset * 1_000).toISOString()
}

function remoteCandidate(machineId) {
  return {
    machine: {
      machineId,
      displayName: 'Remote Directory Machine',
      kind: 'remote',
      platform: 'Linux',
      architecture: 'arm64',
      createdAt: timestamp(0),
    },
    trust: {
      machineId,
      nodeIdentity: 'node_identity_supervisordirectory01',
      peerPublicKeySpki: new Uint8Array(64).fill(91),
      peerKeyFingerprint: 'p'.repeat(43),
      controllerCredentialRef: 'credential-supervisordirectory01',
      controllerKeyFingerprint: 'c'.repeat(43),
      trustState: 'pending',
      protocolVersion: 1,
      address: { host: '192.0.2.90', port: 43_218 },
      pairedAt: timestamp(0),
      updatedAt: timestamp(0),
    },
  }
}

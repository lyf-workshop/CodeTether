import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import test from 'node:test'

import { HostEventPublisher } from '../dist/api/host-event-publisher.js'
import { HostService } from '../dist/api/host-service.js'
import {
  startLocalCodexHost,
  startLocalCodexHostWithRuntime,
} from '../dist/api/local-codex-host.js'
import { LocalHttpServer } from '../dist/api/local-http-server.js'
import { WorkspacePolicy } from '../dist/api/workspace-policy.js'
import { ConversationStore } from '../dist/persistence/index.js'

const epoch = '11111111-1111-4111-8111-111111111111'
const wrongEpoch = '22222222-2222-4222-8222-222222222222'

test('closes an already-launched Runtime when Host assembly fails', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'codetether-assembly-test-'))
  const runtime = new FakeAgentRuntime()
  try {
    const workspacePolicy = await WorkspacePolicy.create([workspace])
    await assert.rejects(
      startLocalCodexHostWithRuntime(
        {
          allowedWorkspaceRoots: [workspace],
          allowedOrigins: ['http://localhost:5173'],
          hostVersion: '0.0.0-test',
          maxClients: 0,
        },
        runtime,
        workspacePolicy,
      ),
      /maxClients must be a positive integer/,
    )
    assert.equal(runtime.closeCalls, 1)
  } finally {
    await rm(workspace, { force: true, recursive: true })
  }
})

test('local Host assembly generates a new epoch and restores its API snapshot from SQLite', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-http-restart-'))
  const workspace = join(directory, 'workspace')
  const databasePath = join(directory, 'data', 'codetether.sqlite3')
  await import('node:fs/promises').then(({ mkdir }) =>
    mkdir(workspace, { recursive: true }),
  )
  const options = {
    allowedWorkspaceRoots: [workspace],
    allowedOrigins: ['http://localhost:5173'],
    hostVersion: '0.0.0-test',
    port: 0,
  }
  let first
  let second
  try {
    const firstRuntime = new FakeAgentRuntime()
    first = await startLocalCodexHostWithRuntime(
      options,
      firstRuntime,
      await WorkspacePolicy.create([workspace]),
      ConversationStore.open({ databasePath }),
    )
    const projects = await getJson(first.baseUrl, '/api/v1/projects')
    const projectId = projects.body.projects[0].projectId
    const created = await postJson(first.baseUrl, '/api/v1/conversations', {
      actionId: 'act_http_restart_create',
      provider: 'codex',
      projectId,
    })
    const conversationId = created.body.data.conversation.conversationId
    const started = await postJson(
      first.baseUrl,
      `/api/v1/conversations/${conversationId}/turns`,
      {
        actionId: 'act_http_restart_turn',
        input: { type: 'text', text: 'Persist through local Host assembly' },
      },
    )
    firstRuntime.emit({
      type: 'message.completed',
      provider: 'codex',
      threadId: 'provider-thread-1',
      turnId: 'provider-turn-1',
      itemId: 'provider-message-1',
      message: 'Durable API response',
      timestamp: '2026-08-26T08:00:01.000Z',
    })
    firstRuntime.emit({
      type: 'turn.completed',
      provider: 'codex',
      threadId: 'provider-thread-1',
      turnId: 'provider-turn-1',
      finalMessage: 'Durable API response',
      timestamp: '2026-08-26T08:00:02.000Z',
    })
    const before = await getJson(first.baseUrl, '/api/v1/snapshot')
    assert.equal(before.status, 200)
    assert.equal(before.body.conversations[0].conversationId, conversationId)
    assert.equal(
      before.body.conversationRuntimes[0].turns[0].turnId,
      started.body.data.turn.turnId,
    )
    const firstEpoch = first.epoch
    await first.close()
    first = undefined

    const secondRuntime = new FakeAgentRuntime()
    second = await startLocalCodexHostWithRuntime(
      options,
      secondRuntime,
      await WorkspacePolicy.create([workspace]),
      ConversationStore.open({ databasePath }),
    )
    assert.notEqual(second.epoch, firstEpoch)
    const after = await getJson(second.baseUrl, '/api/v1/snapshot')
    assert.equal(after.status, 200)
    assert.equal(after.body.epoch, second.epoch)
    assert.equal(after.body.conversations[0].conversationId, conversationId)
    assert.equal(after.body.conversations[0].projectId, projectId)
    assert.equal(
      after.body.conversationRuntimes[0].messages[0].text,
      'Durable API response',
    )
    assert.equal(secondRuntime.resumeConversationCalls.length, 0)
  } finally {
    await first?.close().catch(() => undefined)
    await second?.close().catch(() => undefined)
    await rm(directory, {
      force: true,
      recursive: true,
      maxRetries: 10,
      retryDelay: 100,
    })
  }
})

test('starts a read-only durable API when the Codex executable is unavailable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-read-only-host-'))
  const workspace = join(directory, 'workspace')
  const databasePath = join(directory, 'data', 'codetether.sqlite3')
  await mkdir(workspace, { recursive: true })
  const options = {
    allowedWorkspaceRoots: [workspace],
    allowedOrigins: ['http://localhost:5173'],
    hostVersion: '0.0.0-test',
    port: 0,
    databasePath,
  }
  let seeded
  let readOnly
  try {
    seeded = await startLocalCodexHostWithRuntime(
      options,
      new FakeAgentRuntime(),
      await WorkspacePolicy.create([workspace]),
      ConversationStore.open({ databasePath }),
    )
    const projects = await getJson(seeded.baseUrl, '/api/v1/projects')
    const created = await postJson(seeded.baseUrl, '/api/v1/conversations', {
      actionId: 'act_readonly_seed01',
      provider: 'codex',
      projectId: projects.body.projects[0].projectId,
    })
    const conversationId = created.body.data.conversation.conversationId
    await seeded.close()
    seeded = undefined

    readOnly = await startLocalCodexHost({
      ...options,
      executable: join(directory, 'missing-codex-executable'),
    })
    const bootstrap = await getJson(readOnly.baseUrl, '/api/v1/bootstrap')
    assert.equal(bootstrap.status, 200)
    assert.equal(bootstrap.body.capabilities.codex, false)
    assert.equal(bootstrap.body.capabilities.resume, false)

    const detail = await getJson(
      readOnly.baseUrl,
      `/api/v1/conversations/${conversationId}`,
    )
    assert.equal(detail.status, 200)
    assert.equal(detail.body.conversation.conversationId, conversationId)

    const mutation = await postJson(
      readOnly.baseUrl,
      `/api/v1/conversations/${conversationId}/turns`,
      {
        actionId: 'act_readonly_turn001',
        input: { type: 'text', text: 'This must fail closed.' },
      },
    )
    assert.equal(mutation.status, 503)
    assert.equal(mutation.body.code, 'runtime_unavailable')
  } finally {
    await seeded?.close().catch(() => undefined)
    await readOnly?.close().catch(() => undefined)
    await rm(directory, { force: true, recursive: true })
  }
})

test('restores durable Project authorization and fails safely while its root is unavailable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-project-restart-'))
  const workspace = join(directory, 'workspace')
  const movedWorkspace = join(directory, 'workspace-moved')
  const databasePath = join(directory, 'data', 'codetether.sqlite3')
  await mkdir(workspace)
  const options = {
    allowedWorkspaceRoots: [workspace],
    allowedOrigins: [],
    hostVersion: '0.0.0-test',
    port: 0,
  }
  let first
  let second
  let workspaceMoved = false
  try {
    first = await startLocalCodexHostWithRuntime(
      options,
      new FakeAgentRuntime(),
      await WorkspacePolicy.create([workspace]),
      ConversationStore.open({ databasePath }),
    )
    const firstClient = await getJson(first.baseUrl, '/api/v1/projects')
    const projectId = firstClient.body.projects[0].projectId
    const created = await postJson(first.baseUrl, '/api/v1/conversations', {
      actionId: 'act_project_restart_create',
      provider: 'codex',
      projectId,
    })
    const conversationId = created.body.data.conversation.conversationId
    await first.close()
    first = undefined

    await rename(workspace, movedWorkspace)
    workspaceMoved = true
    const secondRuntime = new FakeAgentRuntime()
    second = await startLocalCodexHostWithRuntime(
      { ...options, allowedWorkspaceRoots: [] },
      secondRuntime,
      await WorkspacePolicy.create([]),
      ConversationStore.open({ databasePath }),
    )

    const unavailable = await getJson(second.baseUrl, '/api/v1/projects')
    assert.equal(unavailable.body.projects[0].projectId, projectId)
    assert.equal(unavailable.body.projects[0].availability, 'unavailable')
    const history = await getJson(second.baseUrl, '/api/v1/snapshot')
    assert.equal(history.body.conversations[0].conversationId, conversationId)
    assert.equal(history.body.conversations[0].projectId, projectId)

    const blocked = await postJson(
      second.baseUrl,
      `/api/v1/conversations/${conversationId}/turns`,
      {
        actionId: 'act_project_restart_blocked',
        input: { type: 'text', text: 'Do not run while unavailable.' },
      },
    )
    assert.equal(blocked.status, 409)
    assert.equal(blocked.body.code, 'project_unavailable')
    assert.equal(secondRuntime.resumeConversationCalls.length, 0)
    assert.equal(secondRuntime.startTurnCalls.length, 0)

    await rename(movedWorkspace, workspace)
    workspaceMoved = false
    const restored = await getJson(second.baseUrl, '/api/v1/projects')
    assert.equal(restored.body.projects[0].availability, 'available')
    const resumed = await postJson(
      second.baseUrl,
      `/api/v1/conversations/${conversationId}/turns`,
      {
        actionId: 'act_project_restart_resumed',
        input: { type: 'text', text: 'Resume the durable Project.' },
      },
    )
    assert.equal(resumed.status, 202)
    assert.deepEqual(secondRuntime.resumeConversationCalls, [
      { providerThreadId: 'provider-thread-1', cwd: workspace },
    ])
    assert.equal(secondRuntime.startTurnCalls.length, 1)
  } finally {
    await first?.close().catch(() => undefined)
    await second?.close().catch(() => undefined)
    if (workspaceMoved) {
      await rename(movedWorkspace, workspace).catch(() => undefined)
    }
    await rm(directory, { force: true, recursive: true })
  }
})

test('serves bootstrap, snapshot, and idempotent mutations with a fake runtime', async () => {
  const harness = await createHarness()
  try {
    const bootstrap = await getJson(harness.baseUrl, '/api/v1/bootstrap')
    assert.equal(bootstrap.status, 200)
    assert.deepEqual(bootstrap.body, {
      protocolVersion: 1,
      hostVersion: '0.0.0-test',
      epoch,
      capabilities: {
        codex: true,
        approvals: true,
        interrupt: true,
        resume: false,
        diff: true,
        streaming: true,
      },
    })

    const emptySnapshot = await getJson(harness.baseUrl, '/api/v1/snapshot')
    assert.equal(emptySnapshot.status, 200)
    assert.deepEqual(emptySnapshot.body, {
      protocolVersion: 1,
      epoch,
      currentSeq: 0,
      conversations: [],
      activeTurns: [],
      pendingApprovals: [],
      conversationRuntimes: [],
    })

    const createBody = {
      actionId: 'act_create01',
      provider: 'codex',
      cwd: harness.workspace,
      model: 'gpt-5',
      reasoning: 'high',
    }
    const created = await postJson(
      harness.baseUrl,
      '/api/v1/conversations',
      createBody,
    )
    assert.equal(created.status, 201)
    assert.equal(created.body.status, 'completed')
    assert.equal(created.body.data.conversation.provider, 'codex')
    assert.equal(created.body.data.conversation.cwd, harness.workspace)
    assert.equal(harness.runtime.startConversationCalls.length, 1)
    assert.equal(harness.publisher.currentSeq, 1)

    const duplicate = await postJson(
      harness.baseUrl,
      '/api/v1/conversations',
      createBody,
    )
    assert.equal(duplicate.status, 201)
    assert.deepEqual(duplicate.body, created.body)
    assert.equal(harness.runtime.startConversationCalls.length, 1)
    assert.equal(harness.publisher.currentSeq, 1)

    const conflictingDuplicate = await postJson(
      harness.baseUrl,
      '/api/v1/conversations',
      { ...createBody, model: 'gpt-5-different' },
    )
    assert.equal(conflictingDuplicate.status, 409)
    assert.equal(conflictingDuplicate.body.code, 'conflict')
    assert.equal(conflictingDuplicate.body.actionId, createBody.actionId)
    assert.equal(harness.runtime.startConversationCalls.length, 1)

    const badConversation = await postJson(
      harness.baseUrl,
      '/api/v1/conversations/conv_missing01/turns',
      {
        actionId: 'act_badconv01',
        input: { type: 'text', text: 'This must not reach the runtime.' },
      },
    )
    assert.equal(badConversation.status, 404)
    assert.equal(badConversation.body.code, 'not_found')
    assert.equal(harness.runtime.startTurnCalls.length, 0)

    const conversationId = created.body.data.conversation.conversationId
    const started = await postJson(
      harness.baseUrl,
      `/api/v1/conversations/${conversationId}/turns`,
      {
        actionId: 'act_start001',
        input: { type: 'text', text: '  preserve whitespace  ' },
      },
    )
    assert.equal(started.status, 202)
    assert.equal(started.body.status, 'accepted')
    assert.equal(harness.runtime.startTurnCalls.length, 1)
    assert.equal(
      harness.runtime.startTurnCalls[0].input,
      '  preserve whitespace  ',
    )

    const snapshot = await getJson(harness.baseUrl, '/api/v1/snapshot')
    assert.equal(snapshot.status, 200)
    assert.equal(snapshot.body.currentSeq, 2)
    assert.equal(snapshot.body.conversations.length, 1)
    assert.equal(snapshot.body.activeTurns.length, 1)
    assert.equal(
      snapshot.body.activeTurns[0].turnId,
      started.body.data.turn.turnId,
    )
  } finally {
    await harness.close()
  }
})

test('serves durable Project identity and creates Conversations by projectId', async () => {
  const harness = await createHarness()
  const nested = join(harness.workspace, 'nested-project')
  await mkdir(nested)
  try {
    const initial = await getJson(harness.baseUrl, '/api/v1/projects')
    assert.equal(initial.status, 200)
    assert.equal(initial.body.projects.length, 1)
    const rootProject = initial.body.projects[0]
    assert.equal(rootProject.availability, 'available')

    const created = await postJson(harness.baseUrl, '/api/v1/projects', {
      actionId: 'act_project_create01',
      path: nested,
    })
    assert.equal(created.status, 201)
    assert.equal(created.body.data.created, true)
    assert.equal(created.body.data.project.name, 'nested-project')
    assert.match(created.body.data.project.projectId, /^proj_/u)

    const duplicate = await postJson(harness.baseUrl, '/api/v1/projects', {
      actionId: 'act_project_create02',
      path: `${nested}${sep}`,
      name: 'Ignored duplicate name',
    })
    assert.equal(duplicate.status, 200)
    assert.equal(duplicate.body.data.created, false)
    assert.equal(
      duplicate.body.data.project.projectId,
      created.body.data.project.projectId,
    )

    const fetched = await getJson(
      harness.baseUrl,
      `/api/v1/projects/${created.body.data.project.projectId}`,
    )
    assert.equal(fetched.status, 200)
    assert.deepEqual(fetched.body.project, created.body.data.project)

    const conversation = await postJson(
      harness.baseUrl,
      '/api/v1/conversations',
      {
        actionId: 'act_project_conversation01',
        provider: 'codex',
        projectId: rootProject.projectId,
      },
    )
    assert.equal(conversation.status, 201)
    assert.equal(
      conversation.body.data.conversation.projectId,
      rootProject.projectId,
    )
    assert.equal(conversation.body.data.conversation.cwd, rootProject.rootPath)

    const conflict = await deleteJson(
      harness.baseUrl,
      `/api/v1/projects/${rootProject.projectId}`,
      { actionId: 'act_project_delete01' },
    )
    assert.equal(conflict.status, 409)
    assert.equal(conflict.body.code, 'project_has_conversations')

    const deleted = await deleteJson(
      harness.baseUrl,
      `/api/v1/projects/${created.body.data.project.projectId}`,
      { actionId: 'act_project_delete02' },
    )
    assert.equal(deleted.status, 200)
    assert.equal(
      deleted.body.data.projectId,
      created.body.data.project.projectId,
    )
    await access(nested)
  } finally {
    await harness.close()
  }
})

test('serves a strict Project-scoped durable Conversation index', async () => {
  const harness = await createHarness({ persistence: true })
  const movedWorkspace = `${harness.workspace}-moved`
  let workspaceMoved = false
  try {
    const projects = await getJson(harness.baseUrl, '/api/v1/projects')
    const projectId = projects.body.projects[0].projectId
    const created = await postJson(harness.baseUrl, '/api/v1/conversations', {
      actionId: 'act_index_create01',
      provider: 'codex',
      projectId,
    })
    const conversationId = created.body.data.conversation.conversationId

    const listed = await getJson(
      harness.baseUrl,
      `/api/v1/projects/${projectId}/conversations`,
    )
    assert.equal(listed.status, 200)
    assert.equal(listed.body.protocolVersion, 1)
    assert.equal(listed.body.conversations.length, 1)
    assert.equal(listed.body.conversations[0].conversationId, conversationId)
    assert.equal(listed.body.conversations[0].projectId, projectId)
    assert.equal(listed.body.conversations[0].title, '新会话')
    assert.equal('cwd' in listed.body.conversations[0], false)
    assert.equal('providerThreadId' in listed.body.conversations[0], false)

    const filtered = await getJson(
      harness.baseUrl,
      `/api/v1/projects/${projectId}/conversations?provider=codex&status=idle&limit=1`,
    )
    assert.equal(filtered.status, 200)
    assert.equal(filtered.body.conversations.length, 1)

    const excluded = await getJson(
      harness.baseUrl,
      `/api/v1/projects/${projectId}/conversations?status=failed`,
    )
    assert.equal(excluded.status, 200)
    assert.deepEqual(excluded.body.conversations, [])

    await rename(harness.workspace, movedWorkspace)
    workspaceMoved = true
    const unavailableHistory = await getJson(
      harness.baseUrl,
      `/api/v1/projects/${projectId}/conversations`,
    )
    assert.equal(unavailableHistory.status, 200)
    assert.equal(unavailableHistory.body.conversations.length, 1)

    for (const query of [
      'unknown=value',
      'limit=1&limit=2',
      'limit=0',
      'limit=101',
      'provider=claude',
      'status=active',
    ]) {
      const rejected = await getJson(
        harness.baseUrl,
        `/api/v1/projects/${projectId}/conversations?${query}`,
      )
      assert.equal(rejected.status, 400, query)
      assert.equal(rejected.body.code, 'invalid_request', query)
    }

    const unknownProject = await getJson(
      harness.baseUrl,
      '/api/v1/projects/proj_unknown01/conversations',
    )
    assert.equal(unknownProject.status, 404)
    assert.equal(unknownProject.body.code, 'not_found')

    const queryOnAnotherEndpoint = await getJson(
      harness.baseUrl,
      '/api/v1/projects?limit=1',
    )
    assert.equal(queryOnAnotherEndpoint.status, 400)
    assert.equal(queryOnAnotherEndpoint.body.code, 'invalid_request')
  } finally {
    if (workspaceMoved) await rename(movedWorkspace, harness.workspace)
    await harness.close()
  }
})

test('serves one durable Conversation detail without exposing Provider state', async () => {
  const harness = await createHarness({ persistence: true })
  try {
    const projects = await getJson(harness.baseUrl, '/api/v1/projects')
    const projectId = projects.body.projects[0].projectId
    const created = await postJson(harness.baseUrl, '/api/v1/conversations', {
      actionId: 'act_detail_create01',
      provider: 'codex',
      projectId,
    })
    const conversationId = created.body.data.conversation.conversationId
    await postJson(
      harness.baseUrl,
      `/api/v1/conversations/${conversationId}/turns`,
      {
        actionId: 'act_detail_turn001',
        input: { type: 'text', text: 'Remember durable detail history' },
      },
    )
    const eventBase = {
      provider: 'codex',
      threadId: 'provider-thread-1',
      turnId: 'provider-turn-1',
      timestamp: '2026-08-27T08:00:01.000Z',
    }
    harness.runtime.emit({
      ...eventBase,
      type: 'message.completed',
      itemId: 'provider-message-detail',
      message: 'Durable response',
    })
    harness.runtime.emit({
      ...eventBase,
      type: 'turn.completed',
      finalMessage: 'Durable response',
    })

    const detail = await getJson(
      harness.baseUrl,
      `/api/v1/conversations/${conversationId}`,
    )
    assert.equal(detail.status, 200)
    assert.equal(detail.body.conversation.conversationId, conversationId)
    assert.equal(detail.body.conversation.projectId, projectId)
    assert.equal(detail.body.runtime.turns.length, 1)
    assert.equal(
      detail.body.runtime.turns[0].input.text,
      'Remember durable detail history',
    )
    assert.equal(detail.body.runtime.messages[0].text, 'Durable response')
    assert.deepEqual(detail.body.history, {
      hasOlderHistory: false,
      retainedTurnCount: 1,
      totalTurnCount: 1,
    })
    assert.equal(JSON.stringify(detail.body).includes('provider-thread'), false)
    assert.equal(JSON.stringify(detail.body).includes('providerTurnId'), false)
    assert.equal(Object.hasOwn(detail.body.conversation, 'cwd'), false)

    harness.runtime.fail(new Error('Codex stopped after history was durable'))
    const whileUnavailable = await getJson(
      harness.baseUrl,
      `/api/v1/conversations/${conversationId}`,
    )
    assert.equal(whileUnavailable.status, 200)
    assert.equal(
      whileUnavailable.body.runtime.messages[0].text,
      'Durable response',
    )

    const unknown = await getJson(
      harness.baseUrl,
      '/api/v1/conversations/conv_missing_detail',
    )
    assert.equal(unknown.status, 404)
    assert.equal(unknown.body.code, 'not_found')

    const badQuery = await getJson(
      harness.baseUrl,
      `/api/v1/conversations/${conversationId}?hydrate=true`,
    )
    assert.equal(badQuery.status, 400)
    assert.equal(badQuery.body.code, 'invalid_request')
  } finally {
    await harness.close()
  }
})

test('requires durable persistence for the Conversation index', async () => {
  const harness = await createHarness()
  try {
    const projects = await getJson(harness.baseUrl, '/api/v1/projects')
    const projectId = projects.body.projects[0].projectId
    const response = await getJson(
      harness.baseUrl,
      `/api/v1/projects/${projectId}/conversations`,
    )
    assert.equal(response.status, 503)
    assert.equal(response.body.code, 'runtime_unavailable')
  } finally {
    await harness.close()
  }
})

test('rejects invalid Project paths and unknown Project identities safely', async () => {
  const harness = await createHarness()
  try {
    const missing = await postJson(harness.baseUrl, '/api/v1/projects', {
      actionId: 'act_project_missing01',
      path: join(harness.workspace, 'missing'),
    })
    assert.equal(missing.status, 422)
    assert.equal(missing.body.code, 'invalid_request')

    const unknown = await getJson(
      harness.baseUrl,
      '/api/v1/projects/proj_unknown01',
    )
    assert.equal(unknown.status, 404)
    assert.equal(unknown.body.code, 'not_found')

    const invalidConversation = await postJson(
      harness.baseUrl,
      '/api/v1/conversations',
      {
        actionId: 'act_project_invalidconv01',
        provider: 'codex',
        projectId: 'proj_unknown01',
      },
    )
    assert.equal(invalidConversation.status, 404)
    assert.equal(invalidConversation.body.code, 'not_found')
  } finally {
    await harness.close()
  }
})

test('replays SSE, targets a wrong-epoch reset, and isolates live clients', async () => {
  const harness = await createHarness()
  const clients = []
  try {
    const created = await postJson(harness.baseUrl, '/api/v1/conversations', {
      actionId: 'act_create02',
      provider: 'codex',
      cwd: harness.workspace,
    })
    const conversationId = created.body.data.conversation.conversationId
    assert.equal(harness.publisher.currentSeq, 1)

    const first = await openSse(harness.baseUrl)
    const second = await openSse(harness.baseUrl)
    clients.push(first, second)
    const firstLive = first.nextEvent()
    const secondLive = second.nextEvent()

    const started = await postJson(
      harness.baseUrl,
      `/api/v1/conversations/${conversationId}/turns`,
      {
        actionId: 'act_start002',
        input: { type: 'text', text: 'Stream this Turn.' },
      },
    )
    assert.equal(started.status, 202)

    const [firstEvent, secondEvent] = await Promise.all([firstLive, secondLive])
    assert.equal(firstEvent.event, 'turn.started')
    assert.equal(firstEvent.id, `${epoch}:2`)
    assert.deepEqual(firstEvent, secondEvent)

    const replay = await openSse(harness.baseUrl, `${epoch}:1`)
    clients.push(replay)
    const replayed = await replay.nextEvent()
    assert.equal(replayed.id, `${epoch}:2`)
    assert.equal(replayed.event, 'turn.started')
    assert.equal(replayed.data.turnId, started.body.data.turn.turnId)

    const wrongEpochClient = await openSse(harness.baseUrl, `${wrongEpoch}:1`)
    clients.push(wrongEpochClient)
    const reset = await wrongEpochClient.nextEvent()
    assert.equal(reset.id, `${epoch}:2`)
    assert.equal(reset.event, 'stream.reset')
    assert.equal(reset.data.conversationId, null)
    assert.equal(reset.data.payload.reason, 'epoch_mismatch')
    assert.equal(harness.publisher.currentSeq, 2)

    const firstUnaffected = first.nextEvent()
    const secondUnaffected = second.nextEvent()
    const live = harness.publisher.publish(messageEvent('after reset'))
    const [firstAfterReset, secondAfterReset] = await Promise.all([
      firstUnaffected,
      secondUnaffected,
    ])
    assert.equal(firstAfterReset.event, 'message.delta')
    assert.equal(firstAfterReset.id, live.eventId)
    assert.deepEqual(firstAfterReset, secondAfterReset)

    const replayAfterReset = await openSse(harness.baseUrl, `${epoch}:2`)
    clients.push(replayAfterReset)
    const replayedAfterReset = await replayAfterReset.nextEvent()
    assert.equal(replayedAfterReset.event, 'message.delta')
    assert.equal(replayedAfterReset.id, live.eventId)
  } finally {
    await Promise.all(clients.map(async (client) => await client.close()))
    await harness.close()
  }
})

test('uses snapshot sequence zero as a race-free initial replay cursor', async () => {
  const harness = await createHarness()
  let client
  try {
    const snapshot = await getJson(harness.baseUrl, '/api/v1/snapshot')
    assert.equal(snapshot.body.currentSeq, 0)

    client = await openSse(
      harness.baseUrl,
      `${snapshot.body.epoch}:${String(snapshot.body.currentSeq)}`,
    )
    const nextEvent = client.nextEvent()
    await postJson(harness.baseUrl, '/api/v1/conversations', {
      actionId: 'act_seqzero01',
      provider: 'codex',
      cwd: harness.workspace,
    })

    const event = await nextEvent
    assert.equal(event.id, `${epoch}:1`)
    assert.equal(event.event, 'conversation.started')
  } finally {
    await client?.close()
    await harness.close()
  }
})

test('streams more than the live queue limit directly from replay history', async () => {
  const harness = await createHarness()
  let client
  try {
    for (let index = 1; index <= 301; index += 1) {
      harness.publisher.publish(messageEvent(`replay-${String(index)}`))
    }

    client = await openSse(harness.baseUrl, `${epoch}:1`)
    for (let expectedSeq = 2; expectedSeq <= 301; expectedSeq += 1) {
      const event = await client.nextEvent()
      assert.equal(event.id, `${epoch}:${String(expectedSeq)}`)
      assert.equal(event.event, 'message.delta')
      assert.equal(event.data.payload.delta, `replay-${String(expectedSeq)}`)
    }
  } finally {
    await client?.close()
    await harness.close()
  }
})

test('allows only configured origins and never emits wildcard CORS', async () => {
  const harness = await createHarness()
  try {
    const allowedOrigin = 'http://localhost:5173'
    const allowed = await fetch(`${harness.baseUrl}/api/v1/bootstrap`, {
      headers: { Origin: allowedOrigin },
    })
    assert.equal(allowed.status, 200)
    assert.equal(
      allowed.headers.get('access-control-allow-origin'),
      allowedOrigin,
    )
    assert.notEqual(allowed.headers.get('access-control-allow-origin'), '*')
    assert.equal(allowed.headers.get('vary'), 'Origin')
    await allowed.body?.cancel()

    const preflight = await fetch(`${harness.baseUrl}/api/v1/events`, {
      method: 'OPTIONS',
      headers: { Origin: allowedOrigin },
    })
    assert.equal(preflight.status, 204)
    assert.equal(
      preflight.headers.get('access-control-allow-origin'),
      allowedOrigin,
    )
    assert.equal(
      preflight.headers.get('access-control-allow-methods'),
      'GET, POST, DELETE, OPTIONS',
    )

    const denied = await getJson(harness.baseUrl, '/api/v1/bootstrap', {
      Origin: 'http://untrusted.example',
    })
    assert.equal(denied.status, 403)
    assert.equal(denied.body.code, 'invalid_request')
    assert.equal(denied.headers.get('access-control-allow-origin'), null)

    const withoutOrigin = await getJson(harness.baseUrl, '/api/v1/bootstrap')
    assert.equal(withoutOrigin.status, 200)
    assert.equal(withoutOrigin.headers.get('access-control-allow-origin'), null)
  } finally {
    await harness.close()
  }
})

test('requires the exact loopback Host authority on every request', async () => {
  const harness = await createHarness()
  try {
    const wrongHost = await rawHttpJson(
      harness.baseUrl,
      '/api/v1/bootstrap',
      'untrusted.example',
    )
    assert.equal(wrongHost.status, 403)
    assert.equal(wrongHost.body.code, 'invalid_request')

    const authority = new URL(harness.baseUrl).host
    const absoluteForm = await rawHttpJson(
      harness.baseUrl,
      'http://untrusted.example/api/v1/bootstrap',
      authority,
    )
    assert.equal(absoluteForm.status, 400)
    assert.equal(absoluteForm.body.code, 'invalid_request')

    const accepted = await rawHttpJson(
      harness.baseUrl,
      '/api/v1/bootstrap',
      authority,
    )
    assert.equal(accepted.status, 200)
    assert.equal(accepted.body.protocolVersion, 1)
  } finally {
    await harness.close()
  }
})

test('rejects invalid JSON and request bodies above the configured limit', async () => {
  const harness = await createHarness({ bodyLimitBytes: 128 })
  try {
    const invalidJson = await requestJson(
      harness.baseUrl,
      '/api/v1/conversations',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"actionId":',
      },
    )
    assert.equal(invalidJson.status, 400)
    assert.equal(invalidJson.body.code, 'invalid_request')
    assert.match(invalidJson.body.message, /valid JSON/u)

    const oversized = await requestJson(
      harness.baseUrl,
      '/api/v1/conversations',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ padding: 'x'.repeat(256) }),
      },
    )
    assert.equal(oversized.status, 413)
    assert.equal(oversized.body.code, 'invalid_request')
    assert.match(oversized.body.message, /configured limit/u)
    assert.equal(harness.runtime.startConversationCalls.length, 0)
  } finally {
    await harness.close()
  }
})

test('resolves a bound approval and interrupts a bound active turn', async () => {
  const harness = await createHarness()
  try {
    const created = await postJson(harness.baseUrl, '/api/v1/conversations', {
      actionId: 'act_create03',
      provider: 'codex',
      cwd: harness.workspace,
    })
    const conversationId = created.body.data.conversation.conversationId
    const started = await postJson(
      harness.baseUrl,
      `/api/v1/conversations/${conversationId}/turns`,
      {
        actionId: 'act_start003',
        input: { type: 'text', text: 'Request a safe approval.' },
      },
    )
    const turnId = started.body.data.turn.turnId
    const decisions = []
    const providerApproval = {
      providerRequestId: 'provider-request-1',
      providerApprovalId: 'provider-approval-1',
      providerThreadId: 'provider-thread-1',
      providerTurnId: 'provider-turn-1',
      providerItemId: 'provider-item-1',
      kind: 'command',
      summary: 'Run the focused test suite',
      respond: (decision) => decisions.push(decision),
    }
    harness.runtime.emitApprovalRequest(providerApproval)

    const pending = await getJson(harness.baseUrl, '/api/v1/snapshot')
    assert.equal(pending.status, 200)
    assert.equal(pending.body.pendingApprovals.length, 1)
    const approval = pending.body.pendingApprovals[0]
    assert.equal(approval.conversationId, conversationId)
    assert.equal(approval.turnId, turnId)
    assert.equal(approval.status, 'pending')

    const resolved = await postJson(
      harness.baseUrl,
      `/api/v1/approvals/${approval.approvalId}/resolve`,
      { actionId: 'act_resolve01', decision: 'accept' },
    )
    assert.equal(resolved.status, 202)
    assert.equal(resolved.body.status, 'accepted')
    assert.equal(resolved.body.data.approval.approvalId, approval.approvalId)
    assert.deepEqual(decisions, ['accept'])

    harness.runtime.emitApprovalResolution({
      ...providerApproval,
      decision: 'accept',
    })
    const afterResolution = await getJson(harness.baseUrl, '/api/v1/snapshot')
    assert.equal(afterResolution.body.pendingApprovals.length, 0)

    const interrupted = await postJson(
      harness.baseUrl,
      `/api/v1/conversations/${conversationId}/turns/${turnId}/interrupt`,
      { actionId: 'act_interrupt01' },
    )
    assert.equal(interrupted.status, 202)
    assert.equal(interrupted.body.status, 'accepted')
    assert.equal(interrupted.body.data.turn.turnId, turnId)
    assert.deepEqual(harness.runtime.interruptTurnCalls, [
      {
        providerThreadId: 'provider-thread-1',
        providerTurnId: 'provider-turn-1',
      },
    ])
  } finally {
    await harness.close()
  }
})

test('returns a safe 400 response for invalid percent encoding in a route', async () => {
  const harness = await createHarness()
  try {
    const response = await postJson(
      harness.baseUrl,
      '/api/v1/conversations/%ZZ/turns',
      {
        actionId: 'act_badroute1',
        input: { type: 'text', text: 'This must not reach the runtime.' },
      },
    )
    assert.equal(response.status, 400)
    assert.equal(response.body.code, 'invalid_request')
    assert.match(response.body.message, /percent encoding/u)
    assert.equal(harness.runtime.startTurnCalls.length, 0)
  } finally {
    await harness.close()
  }
})

test('rejects an SSE client above the configured connection limit', async () => {
  const harness = await createHarness({ maxClients: 1 })
  let client
  try {
    client = await openSse(harness.baseUrl)
    const rejected = await getJson(harness.baseUrl, '/api/v1/events')
    assert.equal(rejected.status, 503)
    assert.equal(rejected.body.code, 'runtime_unavailable')
    assert.match(rejected.body.message, /connection limit/u)
  } finally {
    await client?.close()
    await harness.close()
  }
})

test('releases an SSE slot when reconnect setup fails before headers', async () => {
  const harness = await createHarness({ maxClients: 1 })
  let client
  try {
    harness.service.createStreamReset = () => {
      throw new Error('Injected reconnect setup failure')
    }
    const failed = await requestJson(harness.baseUrl, '/api/v1/events', {
      headers: { 'Last-Event-ID': `${wrongEpoch}:1` },
    })
    assert.equal(failed.status, 500)
    assert.equal(failed.body.code, 'internal')

    client = await openSse(harness.baseUrl)
  } finally {
    await client?.close()
    await harness.close()
  }
})

test('returns safe runtime_unavailable responses after a fatal runtime signal', async () => {
  const harness = await createHarness()
  try {
    harness.runtime.fail(
      new Error('provider secret token=must-not-cross-http-boundary'),
    )
    const response = await postJson(harness.baseUrl, '/api/v1/conversations', {
      actionId: 'act_runtimefatal01',
      provider: 'codex',
      cwd: harness.workspace,
    })

    assert.equal(response.status, 503)
    assert.equal(response.body.code, 'runtime_unavailable')
    assert.equal(
      JSON.stringify(response.body).includes('must-not-cross-http-boundary'),
      false,
    )
    const bootstrap = await getJson(harness.baseUrl, '/api/v1/bootstrap')
    assert.equal(bootstrap.body.capabilities.codex, false)
    assert.equal(bootstrap.body.capabilities.streaming, true)
  } finally {
    await harness.close()
  }
})

class FakeAgentRuntime {
  provider = 'codex'
  startConversationCalls = []
  resumeConversationCalls = []
  startTurnCalls = []
  interruptTurnCalls = []
  closeCalls = 0
  #eventListeners = new Set()
  #approvalListeners = new Set()
  #failureListeners = new Set()

  subscribeEvents(listener) {
    this.#eventListeners.add(listener)
    return () => this.#eventListeners.delete(listener)
  }

  subscribeFailures(listener) {
    this.#failureListeners.add(listener)
    return () => this.#failureListeners.delete(listener)
  }

  subscribeApprovals(onRequest, onResolved) {
    const subscription = { onRequest, onResolved }
    this.#approvalListeners.add(subscription)
    return () => this.#approvalListeners.delete(subscription)
  }

  emitApprovalRequest(request) {
    for (const subscription of this.#approvalListeners) {
      subscription.onRequest(request)
    }
  }

  emitApprovalResolution(resolution) {
    for (const subscription of this.#approvalListeners) {
      subscription.onResolved(resolution)
    }
  }

  emit(event) {
    for (const listener of this.#eventListeners) listener(event)
  }

  fail(error) {
    for (const listener of this.#failureListeners) listener(error)
  }

  async startConversation(options) {
    this.startConversationCalls.push(options)
    return {
      providerThreadId: `provider-thread-${String(this.startConversationCalls.length)}`,
      ...(options.model === undefined ? {} : { model: options.model }),
    }
  }

  async resumeConversation(options) {
    this.resumeConversationCalls.push(options)
    return {
      providerThreadId: options.providerThreadId,
    }
  }

  async startTurn(options) {
    this.startTurnCalls.push(options)
    return {
      providerTurnId: `provider-turn-${String(this.startTurnCalls.length)}`,
    }
  }

  async interruptTurn(options) {
    this.interruptTurnCalls.push(options)
  }

  async close() {
    this.closeCalls += 1
    this.#eventListeners.clear()
    this.#approvalListeners.clear()
    this.#failureListeners.clear()
  }
}

async function createHarness(options = {}) {
  const workspace = await mkdtemp(join(tmpdir(), 'codetether-http-test-'))
  const dataDirectory =
    options.persistence === true
      ? await mkdtemp(join(tmpdir(), 'codetether-http-data-'))
      : undefined
  const runtime = new FakeAgentRuntime()
  const workspacePolicy = await WorkspacePolicy.create([workspace])
  const publisher = new HostEventPublisher({ epoch })
  const service = new HostService({
    runtime,
    workspacePolicy,
    publisher,
    hostVersion: '0.0.0-test',
    now: () => new Date('2026-08-26T08:00:00.000Z'),
    ...(dataDirectory === undefined
      ? {}
      : {
          persistence: ConversationStore.open({
            databasePath: join(dataDirectory, 'codetether.sqlite3'),
          }),
        }),
  })
  await service.registerInitialProjectRoots([workspace])
  const server = new LocalHttpServer({
    service,
    allowedOrigins: options.allowedOrigins ?? ['http://localhost:5173'],
    heartbeatMs: 60_000,
    ...(options.bodyLimitBytes === undefined
      ? {}
      : { bodyLimitBytes: options.bodyLimitBytes }),
    ...(options.maxClients === undefined
      ? {}
      : { maxClients: options.maxClients }),
  })
  const baseUrl = await server.start(0)
  let closed = false
  return {
    baseUrl,
    publisher,
    runtime,
    service,
    workspace,
    close: async () => {
      if (closed) return
      closed = true
      await server.close()
      await rm(workspace, { force: true, recursive: true })
      if (dataDirectory !== undefined) {
        await rm(dataDirectory, { force: true, recursive: true })
      }
    },
  }
}

async function getJson(baseUrl, path, headers = {}) {
  return await requestJson(baseUrl, path, { headers })
}

async function postJson(baseUrl, path, body) {
  return await requestJson(baseUrl, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function deleteJson(baseUrl, path, body) {
  return await requestJson(baseUrl, path, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function requestJson(baseUrl, path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, init)
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json(),
  }
}

async function rawHttpJson(baseUrl, path, host) {
  const target = new URL(baseUrl)
  return await new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path,
        method: 'GET',
        headers: { Host: host },
      },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        response.on('end', () => {
          try {
            resolve({
              status: response.statusCode,
              body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
            })
          } catch (error) {
            reject(error)
          }
        })
      },
    )
    request.on('error', reject)
    request.end()
  })
}

async function openSse(baseUrl, lastEventId) {
  const controller = new AbortController()
  const response = await fetch(`${baseUrl}/api/v1/events`, {
    headers: lastEventId === undefined ? {} : { 'Last-Event-ID': lastEventId },
    signal: controller.signal,
  })
  assert.equal(response.status, 200)
  assert.match(
    response.headers.get('content-type') ?? '',
    /text\/event-stream/u,
  )
  assert.notEqual(response.body, null)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const nextFrame = async () => {
    while (true) {
      const boundary = buffer.indexOf('\n\n')
      if (boundary >= 0) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        return frame
      }
      const result = await withTimeout(reader.read(), 3_000)
      if (result.done)
        throw new Error('SSE stream ended before an event arrived')
      buffer += decoder
        .decode(result.value, { stream: true })
        .replaceAll('\r', '')
    }
  }

  return {
    nextEvent: async () => {
      while (true) {
        const frame = await nextFrame()
        if (frame.startsWith(':')) continue
        const lines = frame.split('\n')
        const id = field(lines, 'id')
        const event = field(lines, 'event')
        const data = lines
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice('data:'.length).trimStart())
          .join('\n')
        return { id, event, data: JSON.parse(data) }
      }
    },
    close: async () => {
      controller.abort()
      await reader.cancel().catch(() => undefined)
    },
  }
}

function field(lines, name) {
  const prefix = `${name}:`
  const line = lines.find((candidate) => candidate.startsWith(prefix))
  if (line === undefined) throw new Error(`SSE frame is missing ${name}`)
  return line.slice(prefix.length).trimStart()
}

function messageEvent(delta) {
  return {
    conversationId: 'conv_demo01',
    turnId: 'turn_demo01',
    itemId: 'item_demo01',
    timestamp: '2026-08-26T08:00:00.000Z',
    type: 'message.delta',
    payload: { delta },
  }
}

async function withTimeout(promise, timeoutMs) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Timed out waiting for SSE data')),
          timeoutMs,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

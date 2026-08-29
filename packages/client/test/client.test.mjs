import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CodeTetherClient,
  CodeTetherIncompatibleProtocolError,
  CodeTetherProtocolError,
  CodeTetherResponseError,
} from '../dist/index.js'

const epoch = '1e7e3ce2-4ab2-4e80-a61d-9a6a345a7200'
const timestamp = '2026-08-26T07:00:00.000Z'
const conversationId = 'conv_demo01'
const projectId = 'proj_demo01'
const turnId = 'turn_demo01'
const approvalId = 'approval_demo01'
const attentionId = 'attn_demo01'

const capabilities = {
  codex: true,
  approvals: true,
  interrupt: true,
  resume: true,
  diff: true,
  streaming: true,
}

const conversation = {
  conversationId,
  projectId,
  provider: 'codex',
  cwd: 'C:\\workspace',
  status: 'idle',
  createdAt: timestamp,
  updatedAt: timestamp,
}

const project = {
  projectId,
  name: 'Demo',
  rootPath: 'C:\\workspace',
  availability: 'available',
  createdAt: timestamp,
  updatedAt: timestamp,
}

const conversationSummary = {
  conversationId,
  projectId,
  title: 'Inspect the workspace',
  titleSource: 'generated',
  provider: 'codex',
  model: 'gpt-5',
  reasoning: 'high',
  status: 'completed',
  createdAt: timestamp,
  updatedAt: timestamp,
  lastActivityAt: timestamp,
}

const turn = {
  turnId,
  conversationId,
  status: 'running',
  startedAt: timestamp,
}

const approval = {
  approvalId,
  conversationId,
  turnId,
  kind: 'command',
  summary: 'Run tests',
  status: 'resolved',
  decision: 'accept',
  requestedAt: timestamp,
  resolvedAt: timestamp,
}

const completedTurn = {
  turnId,
  conversationId,
  status: 'completed',
  input: {
    type: 'text',
    text: 'Inspect the workspace.',
    timestamp,
  },
  startedAt: timestamp,
  completedAt: timestamp,
}

const conversationDetail = {
  protocolVersion: 1,
  conversation: conversationSummary,
  runtime: {
    conversationId,
    turns: [completedTurn],
    messages: [],
    tools: [],
    changes: [],
    terminal: { text: '', truncated: false },
    history: {
      evictedTurns: 0,
      evictedMessages: 0,
      evictedTools: 0,
      evictedChanges: 0,
      truncated: false,
    },
  },
  history: {
    hasOlderHistory: false,
    retainedTurnCount: 1,
    totalTurnCount: 1,
  },
  pendingApprovals: [],
  approvalHistory: [],
}

const openAttention = {
  attentionId,
  projectId,
  conversationId,
  turnId,
  type: 'completed_review',
  status: 'open',
  createdAt: timestamp,
  updatedAt: timestamp,
  payload: { conversationTitle: 'Inspect the workspace' },
}

const resolvedAttention = {
  ...openAttention,
  status: 'resolved',
  resolvedAt: timestamp,
}

const attentionSummary = {
  totalOpen: 1,
  approvalOpen: 0,
  completedReviewOpen: 1,
  failedOpen: 0,
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  })
}

function eventResponse(events) {
  return new Response(
    events
      .map(
        (event) =>
          `id: ${event.eventId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      )
      .join(''),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
}

test('uses the Protocol v1 HTTP routes and validates every success response', async () => {
  const calls = []
  const responses = [
    { protocolVersion: 1, hostVersion: '0.0.0', epoch, capabilities },
    {
      protocolVersion: 1,
      epoch,
      currentSeq: 0,
      conversations: [],
      activeTurns: [],
      pendingApprovals: [],
    },
    {
      protocolVersion: 1,
      actionId: 'act_create1',
      status: 'completed',
      data: { conversation },
    },
    {
      protocolVersion: 1,
      actionId: 'act_start01',
      status: 'accepted',
      data: { turn },
    },
    {
      protocolVersion: 1,
      actionId: 'act_stop001',
      status: 'completed',
      data: {
        turn: { ...turn, status: 'interrupted', completedAt: timestamp },
      },
    },
    {
      protocolVersion: 1,
      actionId: 'act_allow01',
      status: 'completed',
      data: { approval },
    },
  ]
  const fetch = async (input, init) => {
    calls.push({ url: String(input), init })
    return jsonResponse(responses.shift())
  }
  const client = new CodeTetherClient({
    baseUrl: 'http://127.0.0.1:4711/',
    fetch,
  })

  await client.bootstrap()
  await client.snapshot()
  await client.createConversation({
    actionId: 'act_create1',
    provider: 'codex',
    cwd: 'C:\\workspace',
  })
  await client.startTurn(conversationId, {
    actionId: 'act_start01',
    input: { type: 'text', text: 'Inspect the workspace.' },
  })
  await client.interruptTurn(conversationId, turnId, {
    actionId: 'act_stop001',
  })
  await client.resolveApproval(approvalId, {
    actionId: 'act_allow01',
    decision: 'accept',
  })

  assert.deepEqual(
    calls.map(({ url, init }) => [new URL(url).pathname, init.method]),
    [
      ['/api/v1/bootstrap', 'GET'],
      ['/api/v1/snapshot', 'GET'],
      ['/api/v1/conversations', 'POST'],
      [`/api/v1/conversations/${conversationId}/turns`, 'POST'],
      [
        `/api/v1/conversations/${conversationId}/turns/${turnId}/interrupt`,
        'POST',
      ],
      [`/api/v1/approvals/${approvalId}/resolve`, 'POST'],
    ],
  )
  assert.deepEqual(JSON.parse(calls[3].init.body), {
    actionId: 'act_start01',
    input: { type: 'text', text: 'Inspect the workspace.' },
  })
  assert.deepEqual(JSON.parse(calls[4].init.body), {
    actionId: 'act_stop001',
  })
  assert.deepEqual(JSON.parse(calls[5].init.body), {
    actionId: 'act_allow01',
    decision: 'accept',
  })
})

test('uses Project routes, validates route identity, and sends project-based Conversation requests', async () => {
  const calls = []
  const responses = [
    { protocolVersion: 1, projects: [project] },
    { protocolVersion: 1, project },
    {
      protocolVersion: 1,
      actionId: 'act_project1',
      status: 'completed',
      data: { project, created: true },
    },
    {
      protocolVersion: 1,
      actionId: 'act_delete01',
      status: 'completed',
      data: { projectId },
    },
    {
      protocolVersion: 1,
      actionId: 'act_create2',
      status: 'completed',
      data: { conversation },
    },
  ]
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async (input, init) => {
      calls.push({ url: String(input), init })
      return jsonResponse(responses.shift())
    },
  })

  await client.listProjects()
  await client.getProject(projectId)
  await client.createProject({
    actionId: 'act_project1',
    name: 'Demo',
    path: 'C:\\workspace',
  })
  await client.deleteProject(projectId, { actionId: 'act_delete01' })
  await client.createConversation({
    actionId: 'act_create2',
    provider: 'codex',
    projectId,
  })

  assert.deepEqual(
    calls.map(({ url, init }) => [new URL(url).pathname, init.method]),
    [
      ['/api/v1/projects', 'GET'],
      [`/api/v1/projects/${projectId}`, 'GET'],
      ['/api/v1/projects', 'POST'],
      [`/api/v1/projects/${projectId}`, 'DELETE'],
      ['/api/v1/conversations', 'POST'],
    ],
  )
  assert.deepEqual(JSON.parse(calls[2].init.body), {
    actionId: 'act_project1',
    name: 'Demo',
    path: 'C:\\workspace',
  })
  assert.deepEqual(JSON.parse(calls[3].init.body), {
    actionId: 'act_delete01',
  })
  assert.deepEqual(JSON.parse(calls[4].init.body), {
    actionId: 'act_create2',
    provider: 'codex',
    projectId,
  })
})

test('rejects Project responses whose route identity does not match', async () => {
  const wrongProject = { ...project, projectId: 'proj_other01' }
  const getClient = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async () =>
      jsonResponse({ protocolVersion: 1, project: wrongProject }),
  })
  await assert.rejects(getClient.getProject(projectId), CodeTetherProtocolError)

  const deleteClient = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async () =>
      jsonResponse({
        protocolVersion: 1,
        actionId: 'act_delete01',
        status: 'completed',
        data: { projectId: wrongProject.projectId },
      }),
  })
  await assert.rejects(
    deleteClient.deleteProject(projectId, { actionId: 'act_delete01' }),
    CodeTetherProtocolError,
  )
})

test('lists bounded Project Conversations with typed filters', async () => {
  const calls = []
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async (input, init) => {
      calls.push({ url: String(input), init })
      return jsonResponse({
        protocolVersion: 1,
        conversations: [conversationSummary],
      })
    },
  })

  const response = await client.listProjectConversations(projectId, {
    provider: 'codex',
    status: 'completed',
    archived: 'all',
    limit: 25,
  })

  assert.deepEqual(response.conversations, [conversationSummary])
  assert.equal(calls.length, 1)
  const request = new URL(calls[0].url)
  assert.equal(request.pathname, `/api/v1/projects/${projectId}/conversations`)
  assert.deepEqual(Object.fromEntries(request.searchParams), {
    limit: '25',
    provider: 'codex',
    status: 'completed',
    archived: 'all',
  })
  assert.equal(calls[0].init.method, 'GET')
})

test('uses the default Conversation list bound and rejects invalid options', async () => {
  let requestedUrl
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async (input) => {
      requestedUrl = String(input)
      return jsonResponse({ protocolVersion: 1, conversations: [] })
    },
  })

  await client.listProjectConversations(projectId)
  assert.equal(new URL(requestedUrl).searchParams.get('limit'), '50')
  assert.equal(new URL(requestedUrl).searchParams.get('archived'), 'false')
  await assert.rejects(
    client.listProjectConversations(projectId, { limit: 101 }),
    CodeTetherProtocolError,
  )
  await assert.rejects(
    client.listProjectConversations(projectId, { archived: 'invalid' }),
    CodeTetherProtocolError,
  )
})

test('encodes strict archive filters and validates the returned partition', async () => {
  const calls = []
  const archivedSummary = { ...conversationSummary, archivedAt: timestamp }
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async (input) => {
      calls.push(String(input))
      return jsonResponse({
        protocolVersion: 1,
        conversations: [archivedSummary],
      })
    },
  })

  assert.deepEqual(
    (await client.listProjectConversations(projectId, { archived: true }))
      .conversations,
    [archivedSummary],
  )
  assert.equal(new URL(calls[0]).searchParams.get('archived'), 'true')

  await assert.rejects(
    client.listProjectConversations(projectId, { archived: false }),
    CodeTetherProtocolError,
  )
})

test('rejects a Project Conversation list containing another Project', async () => {
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async () =>
      jsonResponse({
        protocolVersion: 1,
        conversations: [{ ...conversationSummary, projectId: 'proj_other01' }],
      }),
  })

  await assert.rejects(
    client.listProjectConversations(projectId),
    CodeTetherProtocolError,
  )
})

test('searches durable Project Conversations with normalized typed filters', async () => {
  const calls = []
  const controller = new AbortController()
  const cursor = 'csc_abcdefghijklmnop'
  const nextCursor = 'csc_qrstuvwxyzABCDEF'
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async (input, init) => {
      calls.push({ url: String(input), init })
      return jsonResponse({
        protocolVersion: 1,
        results: [
          {
            conversation: conversationSummary,
            matchedField: 'user_input',
            matchPreview: '…Windows login reconnect…',
            matchedTurnId: turnId,
          },
        ],
        hasMore: true,
        nextCursor,
      })
    },
  })

  const response = await client.searchProjectConversations(projectId, {
    query: '  Re\u0301connect  ',
    archive: 'all',
    provider: 'codex',
    status: 'completed',
    limit: 25,
    cursor,
    signal: controller.signal,
  })

  assert.equal(response.nextCursor, nextCursor)
  assert.equal(calls.length, 1)
  const request = new URL(calls[0].url)
  assert.equal(
    request.pathname,
    `/api/v1/projects/${projectId}/conversations/search`,
  )
  assert.deepEqual(Object.fromEntries(request.searchParams), {
    q: 'Réconnect',
    archive: 'all',
    limit: '25',
    provider: 'codex',
    status: 'completed',
    cursor,
  })
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[0].init.signal, controller.signal)
})

test('uses safe Conversation search defaults and rejects malformed options', async () => {
  let requestedUrl
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async (input) => {
      requestedUrl = String(input)
      return jsonResponse({
        protocolVersion: 1,
        results: [],
        hasMore: false,
      })
    },
  })

  await client.searchProjectConversations(projectId, { query: '登录' })
  assert.deepEqual(Object.fromEntries(new URL(requestedUrl).searchParams), {
    q: '登录',
    archive: 'active',
    limit: '25',
  })

  for (const options of [
    { query: '' },
    { query: 'ok', archive: 'false' },
    { query: 'ok', provider: 'claude' },
    { query: 'ok', status: 'archived' },
    { query: 'ok', limit: 101 },
    { query: 'ok', cursor: 'invalid' },
  ]) {
    await assert.rejects(
      client.searchProjectConversations(projectId, options),
      CodeTetherProtocolError,
    )
  }
})

test('validates Conversation search identity, filters, and cursor progress', async () => {
  const cursor = 'csc_abcdefghijklmnop'
  const cases = [
    {
      response: {
        ...conversationSummary,
        projectId: 'proj_other01',
      },
      options: { query: 'workspace' },
    },
    {
      response: { ...conversationSummary, archivedAt: timestamp },
      options: { query: 'workspace', archive: 'active' },
    },
    {
      response: { ...conversationSummary, status: 'failed' },
      options: { query: 'workspace', status: 'completed' },
    },
  ]

  for (const testCase of cases) {
    const client = new CodeTetherClient({
      baseUrl: 'http://host.test',
      fetch: async () =>
        jsonResponse({
          protocolVersion: 1,
          results: [{ conversation: testCase.response, matchedField: 'title' }],
          hasMore: false,
        }),
    })
    await assert.rejects(
      client.searchProjectConversations(projectId, testCase.options),
      CodeTetherProtocolError,
    )
  }

  const cursorClient = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async () =>
      jsonResponse({
        protocolVersion: 1,
        results: [],
        hasMore: true,
        nextCursor: cursor,
      }),
  })
  await assert.rejects(
    cursorClient.searchProjectConversations(projectId, {
      query: 'workspace',
      cursor,
    }),
    CodeTetherProtocolError,
  )
})

test('uses typed Conversation organization mutations and forwards AbortSignal', async () => {
  const calls = []
  const controller = new AbortController()
  const operations = [
    {
      actionId: 'act_rename01',
      call: (client) =>
        client.renameConversation(
          conversationId,
          { actionId: 'act_rename01', title: '  Re\u0301sume\t work  ' },
          { signal: controller.signal },
        ),
      method: 'PATCH',
      suffix: '',
      summary: {
        ...conversationSummary,
        title: 'Résume work',
        titleSource: 'manual',
      },
      body: { actionId: 'act_rename01', title: 'Résume work' },
    },
    {
      actionId: 'act_pin0001',
      call: (client) =>
        client.pinConversation(conversationId, { actionId: 'act_pin0001' }),
      method: 'POST',
      suffix: '/pin',
      summary: { ...conversationSummary, pinnedAt: timestamp },
      body: { actionId: 'act_pin0001' },
    },
    {
      actionId: 'act_unpin01',
      call: (client) =>
        client.unpinConversation(conversationId, {
          actionId: 'act_unpin01',
        }),
      method: 'POST',
      suffix: '/unpin',
      summary: conversationSummary,
      body: { actionId: 'act_unpin01' },
    },
    {
      actionId: 'act_archive1',
      call: (client) =>
        client.archiveConversation(conversationId, {
          actionId: 'act_archive1',
        }),
      method: 'POST',
      suffix: '/archive',
      summary: { ...conversationSummary, archivedAt: timestamp },
      body: { actionId: 'act_archive1' },
    },
    {
      actionId: 'act_unarch01',
      call: (client) =>
        client.unarchiveConversation(conversationId, {
          actionId: 'act_unarch01',
        }),
      method: 'POST',
      suffix: '/unarchive',
      summary: conversationSummary,
      body: { actionId: 'act_unarch01' },
    },
  ]
  const responses = operations.map((operation) => ({
    protocolVersion: 1,
    actionId: operation.actionId,
    status: 'completed',
    data: { conversation: operation.summary },
  }))
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async (input, init) => {
      calls.push({ url: String(input), init })
      return jsonResponse(responses.shift())
    },
  })

  for (const operation of operations) await operation.call(client)

  assert.deepEqual(
    calls.map(({ url, init }) => ({
      method: init.method,
      path: new URL(url).pathname,
      body: JSON.parse(init.body),
    })),
    operations.map((operation) => ({
      method: operation.method,
      path: `/api/v1/conversations/${conversationId}${operation.suffix}`,
      body: operation.body,
    })),
  )
  assert.equal(calls[0].init.signal, controller.signal)
})

test('rejects Conversation organization responses for another identity', async () => {
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async () =>
      jsonResponse({
        protocolVersion: 1,
        actionId: 'act_rename01',
        status: 'completed',
        data: {
          conversation: {
            ...conversationSummary,
            conversationId: 'conv_other01',
            titleSource: 'manual',
          },
        },
      }),
  })

  await assert.rejects(
    client.renameConversation(conversationId, {
      actionId: 'act_rename01',
      title: 'Manual title',
    }),
    CodeTetherProtocolError,
  )
})

test('lists Attention with bounded filters and forwards AbortSignal', async () => {
  const calls = []
  const controller = new AbortController()
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async (input, init) => {
      calls.push({ url: String(input), init })
      return jsonResponse({
        protocolVersion: 1,
        items: [openAttention],
        summary: attentionSummary,
      })
    },
  })

  const response = await client.listAttention({
    projectId,
    type: 'completed_review',
    status: 'open',
    limit: 25,
    signal: controller.signal,
  })

  assert.deepEqual(response.items, [openAttention])
  const request = new URL(calls[0].url)
  assert.equal(request.pathname, '/api/v1/attention')
  assert.deepEqual(Object.fromEntries(request.searchParams), {
    status: 'open',
    limit: '25',
    projectId,
    type: 'completed_review',
  })
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[0].init.signal, controller.signal)
})

test('uses default Attention filters and rejects invalid or cross-Project data', async () => {
  let requestedUrl
  const defaultClient = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async (input) => {
      requestedUrl = String(input)
      return jsonResponse({
        protocolVersion: 1,
        items: [],
        summary: {
          totalOpen: 0,
          approvalOpen: 0,
          completedReviewOpen: 0,
          failedOpen: 0,
        },
      })
    },
  })
  await defaultClient.listAttention()
  assert.deepEqual(Object.fromEntries(new URL(requestedUrl).searchParams), {
    status: 'open',
    limit: '50',
  })
  await assert.rejects(
    defaultClient.listAttention({ limit: 101 }),
    CodeTetherProtocolError,
  )

  const crossProjectClient = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async () =>
      jsonResponse({
        protocolVersion: 1,
        items: [{ ...openAttention, projectId: 'proj_other01' }],
        summary: attentionSummary,
      }),
  })
  await assert.rejects(
    crossProjectClient.listAttention({ projectId }),
    CodeTetherProtocolError,
  )
})

test('resolves non-Approval Attention with route identity and idempotency', async () => {
  const calls = []
  const controller = new AbortController()
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async (input, init) => {
      calls.push({ url: String(input), init })
      return jsonResponse({
        protocolVersion: 1,
        actionId: 'act_review01',
        status: 'completed',
        data: { attention: resolvedAttention },
      })
    },
  })

  const response = await client.resolveAttention(attentionId, 'act_review01', {
    signal: controller.signal,
  })

  assert.deepEqual(response.data.attention, resolvedAttention)
  assert.equal(
    new URL(calls[0].url).pathname,
    `/api/v1/attention/${attentionId}/resolve`,
  )
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.signal, controller.signal)
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    actionId: 'act_review01',
  })
})

test('rejects mismatched or Approval responses from generic Attention resolution', async () => {
  const mismatchClient = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async () =>
      jsonResponse({
        protocolVersion: 1,
        actionId: 'act_review01',
        status: 'completed',
        data: {
          attention: {
            ...resolvedAttention,
            attentionId: 'attn_other01',
          },
        },
      }),
  })
  await assert.rejects(
    mismatchClient.resolveAttention(attentionId, 'act_review01'),
    CodeTetherProtocolError,
  )

  const approvalClient = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async () =>
      jsonResponse({
        protocolVersion: 1,
        actionId: 'act_review01',
        status: 'completed',
        data: {
          attention: {
            ...resolvedAttention,
            type: 'approval',
            payload: {
              approvalId,
              kind: 'command',
              actionTitle: '运行命令',
              decision: 'accept',
            },
          },
        },
      }),
  })
  await assert.rejects(
    approvalClient.resolveAttention(attentionId, 'act_review01'),
    CodeTetherProtocolError,
  )
})

test('gets one durable Conversation detail and forwards AbortSignal', async () => {
  const calls = []
  const controller = new AbortController()
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async (input, init) => {
      calls.push({ url: String(input), init })
      return jsonResponse(conversationDetail)
    },
  })

  const response = await client.getConversation(conversationId, {
    signal: controller.signal,
  })

  assert.deepEqual(response, conversationDetail)
  assert.equal(calls.length, 1)
  assert.equal(
    new URL(calls[0].url).pathname,
    `/api/v1/conversations/${conversationId}`,
  )
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[0].init.signal, controller.signal)
})

test('rejects a durable Conversation detail for another route identity', async () => {
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async () =>
      jsonResponse({
        ...conversationDetail,
        conversation: {
          ...conversationDetail.conversation,
          conversationId: 'conv_other01',
        },
        runtime: {
          ...conversationDetail.runtime,
          conversationId: 'conv_other01',
          turns: conversationDetail.runtime.turns.map((entry) => ({
            ...entry,
            conversationId: 'conv_other01',
          })),
        },
      }),
  })

  await assert.rejects(
    client.getConversation(conversationId),
    CodeTetherProtocolError,
  )
})

test('strictly rejects private fields in durable Conversation detail', async () => {
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async () =>
      jsonResponse({ ...conversationDetail, providerThreadId: 'private' }),
  })

  await assert.rejects(
    client.getConversation(conversationId),
    CodeTetherProtocolError,
  )
})

test('validates safe HTTP errors and surfaces a typed response error', async () => {
  const envelope = {
    protocolVersion: 1,
    actionId: 'act_create1',
    code: 'conflict',
    message: 'Action already exists',
  }
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async () => jsonResponse(envelope, { status: 409 }),
  })

  await assert.rejects(
    client.createConversation({
      actionId: 'act_create1',
      provider: 'codex',
      cwd: 'C:\\workspace',
    }),
    (error) =>
      error instanceof CodeTetherResponseError &&
      error.status === 409 &&
      error.envelope.code === 'conflict',
  )
})

test('surfaces an incompatible bootstrap protocol version distinctly', async () => {
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async () =>
      jsonResponse({
        protocolVersion: 2,
        hostVersion: '2.0.0',
        epoch,
        capabilities,
      }),
  })

  await assert.rejects(
    client.bootstrap(),
    (error) =>
      error instanceof CodeTetherIncompatibleProtocolError &&
      error.expectedVersion === 1 &&
      error.receivedVersion === 2,
  )
})

test('invokes Fetch with the global receiver required by browsers', async () => {
  let receivedGlobalThis = false
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: function () {
      receivedGlobalThis = this === globalThis
      return Promise.resolve(
        jsonResponse({
          protocolVersion: 1,
          hostVersion: '0.0.0',
          epoch,
          capabilities,
        }),
      )
    },
  })

  await client.bootstrap()

  assert.equal(receivedGlobalThis, true)
})

test('rejects mutation responses and errors with another actionId', async () => {
  const successClient = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async () =>
      jsonResponse({
        protocolVersion: 1,
        actionId: 'act_other001',
        status: 'completed',
        data: { conversation },
      }),
  })
  await assert.rejects(
    successClient.createConversation({
      actionId: 'act_create1',
      provider: 'codex',
      cwd: 'C:\\workspace',
    }),
    CodeTetherProtocolError,
  )

  const errorClient = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async () =>
      jsonResponse(
        {
          protocolVersion: 1,
          actionId: 'act_other001',
          code: 'conflict',
          message: 'Conflict',
        },
        { status: 409 },
      ),
  })
  await assert.rejects(
    errorClient.createConversation({
      actionId: 'act_create1',
      provider: 'codex',
      cwd: 'C:\\workspace',
    }),
    CodeTetherProtocolError,
  )
})

test('preserves mutation errors that predate actionId validation', async () => {
  const responses = [
    {
      status: 413,
      body: {
        protocolVersion: 1,
        code: 'invalid_request',
        message: 'Request body exceeds the configured limit',
      },
    },
    {
      status: 422,
      body: {
        protocolVersion: 1,
        code: 'invalid_request',
        message: 'Request body does not match Protocol v1',
      },
    },
  ]
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async () => {
      const response = responses.shift()
      assert.ok(response)
      return jsonResponse(response.body, { status: response.status })
    },
  })

  for (const [actionId, expectedStatus] of [
    ['act_limit001', 413],
    ['act_schema01', 422],
  ]) {
    await assert.rejects(
      client.startTurn(conversationId, {
        actionId,
        input: { type: 'text', text: 'Inspect.' },
      }),
      (error) => {
        assert.ok(error instanceof CodeTetherResponseError)
        assert.equal(error.status, expectedStatus)
        assert.equal(error.envelope.code, 'invalid_request')
        assert.equal(error.envelope.actionId, undefined)
        return true
      },
    )
  }
})

test('rejects mutation records that do not match route identity', async () => {
  const responses = [
    {
      protocolVersion: 1,
      actionId: 'act_start01',
      status: 'accepted',
      data: { turn: { ...turn, conversationId: 'conv_other01' } },
    },
    {
      protocolVersion: 1,
      actionId: 'act_stop001',
      status: 'completed',
      data: {
        turn: {
          ...turn,
          turnId: 'turn_other01',
          status: 'interrupted',
          completedAt: timestamp,
        },
      },
    },
    {
      protocolVersion: 1,
      actionId: 'act_allow01',
      status: 'completed',
      data: { approval: { ...approval, approvalId: 'approval_other01' } },
    },
  ]
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async () => jsonResponse(responses.shift()),
  })

  await assert.rejects(
    client.startTurn(conversationId, {
      actionId: 'act_start01',
      input: { type: 'text', text: 'Inspect.' },
    }),
    CodeTetherProtocolError,
  )
  await assert.rejects(
    client.interruptTurn(conversationId, turnId, {
      actionId: 'act_stop001',
    }),
    CodeTetherProtocolError,
  )
  await assert.rejects(
    client.resolveApproval(approvalId, {
      actionId: 'act_allow01',
      decision: 'accept',
    }),
    CodeTetherProtocolError,
  )
})

test('rejects invalid success and error JSON using protocol validation', async () => {
  const invalidSuccess = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async () => jsonResponse({ protocolVersion: 1 }),
  })
  await assert.rejects(invalidSuccess.bootstrap(), CodeTetherProtocolError)

  const invalidError = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async () => jsonResponse({ stack: 'private' }, { status: 500 }),
  })
  await assert.rejects(invalidError.snapshot(), CodeTetherProtocolError)
})

test('bounds HTTP JSON response bodies before parsing', async () => {
  const client = new CodeTetherClient({
    baseUrl: 'http://127.0.0.1:4010',
    maxResponseBytes: 32,
    fetch: async () =>
      new Response('x'.repeat(64), {
        headers: { 'Content-Type': 'application/json' },
      }),
  })

  await assert.rejects(
    client.snapshot(),
    (error) =>
      error instanceof CodeTetherProtocolError &&
      /inbound body limit/u.test(error.message),
  )
})

test('streams validated events and forwards Last-Event-ID', async () => {
  const events = [
    {
      protocolVersion: 1,
      epoch,
      seq: 1,
      eventId: `${epoch}:1`,
      conversationId,
      turnId,
      itemId: 'item_demo01',
      timestamp,
      type: 'message.delta',
      payload: { delta: '运行中' },
    },
    {
      protocolVersion: 1,
      epoch,
      seq: 2,
      eventId: `${epoch}:2`,
      conversationId,
      turnId,
      itemId: 'item_demo01',
      timestamp,
      type: 'message.delta',
      payload: { delta: '继续' },
    },
  ]
  const bytes = new TextEncoder().encode(
    events
      .map(
        (event) =>
          `id: ${event.eventId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      )
      .join(''),
  )
  let requestInit
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async (_input, init) => {
      requestInit = init
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.slice(0, 19))
            controller.enqueue(bytes.slice(19))
            controller.close()
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } },
      )
    },
  })

  const stream = await client.connectEvents({ lastEventId: `${epoch}:0` })
  const received = []
  for await (const event of stream) received.push(event)

  assert.equal(
    new Headers(requestInit.headers).get('Last-Event-ID'),
    `${epoch}:0`,
  )
  assert.deepEqual(
    received.map((event) => event.type),
    ['message.delta', 'message.delta'],
  )
  assert.equal(stream.lastEventId, `${epoch}:2`)
})

test('rejects event gaps, duplicates, and cross-epoch ordinary events', async () => {
  const event = (eventEpoch, seq, delta) => ({
    protocolVersion: 1,
    epoch: eventEpoch,
    seq,
    eventId: `${eventEpoch}:${seq}`,
    conversationId,
    turnId,
    itemId: 'item_demo01',
    timestamp,
    type: 'message.delta',
    payload: { delta },
  })
  const otherEpoch = '2e7e3ce2-4ab2-4e80-a61d-9a6a345a7200'
  const cases = [
    [event(epoch, 2, 'gap')],
    [event(epoch, 1, 'first'), event(epoch, 1, 'duplicate')],
    [event(otherEpoch, 1, 'wrong epoch')],
  ]

  for (const events of cases) {
    const client = new CodeTetherClient({
      baseUrl: 'http://host.test',
      fetch: async () => eventResponse(events),
    })
    const stream = await client.connectEvents({ lastEventId: `${epoch}:0` })
    await assert.rejects(async () => {
      for await (const received of stream) {
        assert.equal(received.seq, 1)
      }
    }, CodeTetherProtocolError)
  }
})

test('accepts an initial stream.reset as the reconnect recovery boundary', async () => {
  const resetEpoch = '2e7e3ce2-4ab2-4e80-a61d-9a6a345a7200'
  const reset = {
    protocolVersion: 1,
    epoch: resetEpoch,
    seq: 0,
    eventId: `${resetEpoch}:0`,
    conversationId: null,
    timestamp,
    type: 'stream.reset',
    payload: { reason: 'epoch_mismatch' },
  }
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async () => eventResponse([reset]),
  })
  const stream = await client.connectEvents({ lastEventId: `${epoch}:7` })
  const received = []
  for await (const event of stream) received.push(event)
  assert.deepEqual(received, [reset])
  assert.equal(stream.lastEventId, reset.eventId)
})

test('rejects stream.reset after ordinary live events', async () => {
  const events = [
    {
      protocolVersion: 1,
      epoch,
      seq: 1,
      eventId: `${epoch}:1`,
      conversationId,
      turnId,
      itemId: 'item_demo01',
      timestamp,
      type: 'message.delta',
      payload: { delta: 'live' },
    },
    {
      protocolVersion: 1,
      epoch,
      seq: 2,
      eventId: `${epoch}:2`,
      conversationId: null,
      timestamp,
      type: 'stream.reset',
      payload: { reason: 'history_evicted' },
    },
  ]
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async () => eventResponse(events),
  })
  const stream = await client.connectEvents({ lastEventId: `${epoch}:0` })
  const iterator = stream[Symbol.asyncIterator]()

  assert.equal((await iterator.next()).value.type, 'message.delta')
  await assert.rejects(iterator.next(), CodeTetherProtocolError)
})

test('event stream validates data and SSE id', async () => {
  const invalidEvent = {
    protocolVersion: 1,
    epoch,
    seq: 1,
    eventId: `${epoch}:1`,
    conversationId: null,
    timestamp,
    type: 'stream.reset',
    payload: { reason: 'history_evicted' },
  }
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async () => {
      return new Response(
        `id: ${epoch}:2\nevent: ${invalidEvent.type}\ndata: ${JSON.stringify(invalidEvent)}\n\n`,
        { headers: { 'Content-Type': 'text/event-stream' } },
      )
    },
  })

  const stream = await client.connectEvents()
  await assert.rejects(async () => {
    for await (const event of stream) {
      assert.fail(`Unexpected event delivery: ${event.type}`)
    }
  }, CodeTetherProtocolError)
  await stream.close()
})

test('bounds an incomplete SSE frame and cancels the stream', async () => {
  let cancelled = false
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${'x'.repeat(128)}`))
    },
    cancel() {
      cancelled = true
    },
  })
  const client = new CodeTetherClient({
    baseUrl: 'http://127.0.0.1:4010',
    maxEventFrameBytes: 64,
    fetch: async () =>
      new Response(body, {
        headers: { 'Content-Type': 'text/event-stream' },
      }),
  })
  const stream = await client.connectEvents()

  await assert.rejects(
    stream[Symbol.asyncIterator]().next(),
    (error) =>
      error instanceof CodeTetherProtocolError &&
      /inbound frame limit/u.test(error.message),
  )
  assert.equal(cancelled, true)
})

test('normalizes an SSE frame limit reached during decoder EOF flush', async () => {
  const prefix = new TextEncoder().encode('data:')
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.from([...prefix, 0xf0, 0x9f, 0x92]))
      controller.close()
    },
  })
  const client = new CodeTetherClient({
    baseUrl: 'http://127.0.0.1:4010',
    maxEventFrameBytes: 7,
    fetch: async () =>
      new Response(body, {
        headers: { 'Content-Type': 'text/event-stream' },
      }),
  })
  const stream = await client.connectEvents()

  await assert.rejects(
    stream[Symbol.asyncIterator]().next(),
    (error) =>
      error instanceof CodeTetherProtocolError &&
      /inbound frame limit/u.test(error.message),
  )
})

test('event stream requires the SSE event name to match the envelope type', async () => {
  const event = {
    protocolVersion: 1,
    epoch,
    seq: 1,
    eventId: `${epoch}:1`,
    conversationId: null,
    timestamp,
    type: 'stream.reset',
    payload: { reason: 'history_evicted' },
  }
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async () =>
      new Response(
        `id: ${event.eventId}\nevent: turn.completed\ndata: ${JSON.stringify(event)}\n\n`,
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
  })

  const stream = await client.connectEvents()
  await assert.rejects(async () => {
    for await (const received of stream) {
      assert.fail(`Unexpected event delivery: ${received.type}`)
    }
  }, CodeTetherProtocolError)
})

test('event stream rejects JSON that does not match the event schema', async () => {
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async () =>
      new Response(
        `id: ${epoch}:1\nevent: stream.reset\ndata: {"protocolVersion":1}\n\n`,
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
  })

  const stream = await client.connectEvents()
  await assert.rejects(async () => {
    for await (const event of stream) {
      assert.fail(`Unexpected event delivery: ${event.type}`)
    }
  }, CodeTetherProtocolError)
})

test('event stream supports explicit close', async () => {
  let fetchSignal
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async (_input, init) => {
      fetchSignal = init.signal
      return new Response(new ReadableStream(), {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    },
  })

  const stream = await client.connectEvents()
  const iterator = stream[Symbol.asyncIterator]()
  const pending = iterator.next()
  await stream.close()
  assert.equal(fetchSignal.aborted, true)
  assert.deepEqual(await pending, { done: true, value: undefined })
})

test('AsyncIterator return aborts before first read and during a pending read', async () => {
  for (const startRead of [false, true]) {
    let fetchSignal
    const client = new CodeTetherClient({
      baseUrl: 'http://host.test',
      fetch: async (_input, init) => {
        fetchSignal = init.signal
        return new Response(new ReadableStream(), {
          headers: { 'Content-Type': 'text/event-stream' },
        })
      },
    })
    const stream = await client.connectEvents()
    const iterator = stream[Symbol.asyncIterator]()
    const pending = startRead ? iterator.next() : undefined
    assert.deepEqual(await iterator.return(), { done: true, value: undefined })
    assert.equal(fetchSignal.aborted, true)
    if (pending !== undefined) {
      assert.deepEqual(await pending, { done: true, value: undefined })
    }
  }
})

test('external AbortSignal is linked to the event request', async () => {
  const external = new AbortController()
  let fetchSignal
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async (_input, init) => {
      fetchSignal = init.signal
      return new Response(new ReadableStream(), {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    },
  })

  const stream = await client.connectEvents({ signal: external.signal })
  external.abort('test complete')
  assert.equal(fetchSignal.aborted, true)
  assert.equal(fetchSignal.reason, 'test complete')
  await stream.close()
})

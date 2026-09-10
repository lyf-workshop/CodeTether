import assert from 'node:assert/strict'
import test from 'node:test'

import { CodeTetherClient, CodeTetherProtocolError } from '../dist/index.js'

const timestamp = '2026-09-05T08:00:00.000Z'
const projectId = 'proj_sessions01'
const machineId = 'machine_sessions01'
const candidateId = 'candidate_sessions00000001'

test('reads one bounded native transcript page with opaque cursor and cancellation', async () => {
  const calls = []
  const controller = new AbortController()
  const transcriptConversationId = 'conv_native_transcript_client'
  const cursor = 'transcript_1234567890abcdef'
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async (input, init) => {
      calls.push({ url: String(input), init })
      return jsonResponse({
        protocolVersion: 1,
        conversationId: transcriptConversationId,
        provider: 'codex',
        status: 'available',
        entries: [
          {
            id: 'native_12345678901234567890',
            conversationId: transcriptConversationId,
            source: 'native_provider',
            provider: 'codex',
            role: 'assistant',
            kind: 'message',
            content: 'Historical answer',
            occurredAt: timestamp,
            nativeSequence: 7,
            historical: true,
            readOnly: true,
          },
        ],
        complete: true,
        metrics: {
          bytesRead: 17,
          recordsScanned: 1,
          entriesReturned: 1,
          elapsedMs: 1,
          truncated: false,
        },
      })
    },
  })

  const page = await client.readNativeTranscript(transcriptConversationId, {
    cursor,
    limit: 25,
    signal: controller.signal,
  })
  assert.equal(page.entries[0].content, 'Historical answer')
  const url = new URL(calls[0].url)
  assert.equal(
    url.pathname,
    `/api/v1/conversations/${transcriptConversationId}/native-transcript`,
  )
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    limit: '25',
    cursor,
  })
  assert.equal(calls[0].init.method, 'GET')
  assert.strictEqual(calls[0].init.signal, controller.signal)
})

test('rejects a native transcript response for another Conversation', async () => {
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async () =>
      jsonResponse({
        protocolVersion: 1,
        conversationId: 'conv_native_transcript_other',
        provider: 'codex',
        status: 'empty',
        entries: [],
        complete: true,
        metrics: {
          bytesRead: 0,
          recordsScanned: 0,
          entriesReturned: 0,
          elapsedMs: 0,
          truncated: false,
        },
      }),
  })
  await assert.rejects(
    client.readNativeTranscript('conv_native_transcript_requested'),
    CodeTetherProtocolError,
  )
})

test('discovers bounded Provider sessions for one exact ProjectLocation', async () => {
  const calls = []
  const controller = new AbortController()
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async (input, init) => {
      calls.push({ url: String(input), init })
      return jsonResponse({
        protocolVersion: 1,
        candidates: [
          {
            discoveryCandidateId: candidateId,
            provider: 'claude-code',
            machineId,
            title: 'Existing Claude conversation',
            lastActiveAt: timestamp,
            resumeStatus: 'supported',
            historicalTranscript: 'unavailable',
            alreadyAdopted: false,
          },
        ],
        providers: [
          {
            provider: 'claude-code',
            status: 'supported',
            resumeStatus: 'supported',
            providerVersion: '2.1.0',
            candidateCount: 1,
            corruptEntriesSkipped: 0,
          },
        ],
        nextCursor: 'page_two',
      })
    },
  })

  const response = await client.discoverProviderSessions(projectId, machineId, {
    provider: 'claude-code',
    limit: 25,
    rescan: true,
    signal: controller.signal,
  })

  assert.equal(response.candidates[0].title, 'Existing Claude conversation')
  assert.equal(calls.length, 1)
  const url = new URL(calls[0].url)
  assert.equal(
    url.pathname,
    `/api/v1/projects/${projectId}/locations/${machineId}/provider-sessions`,
  )
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    limit: '25',
    provider: 'claude-code',
    rescan: 'true',
  })
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[0].init.signal, controller.signal)
})

test('omits the false rescan flag and forwards an opaque cursor', async () => {
  let requestedUrl
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async (input) => {
      requestedUrl = new URL(String(input))
      return jsonResponse({
        protocolVersion: 1,
        candidates: [],
        providers: [
          {
            provider: 'codex',
            status: 'supported',
            resumeStatus: 'supported',
            candidateCount: 0,
            corruptEntriesSkipped: 0,
          },
        ],
      })
    },
  })

  await client.discoverProviderSessions(projectId, machineId, {
    provider: 'codex',
    cursor: 'page_two',
    rescan: false,
  })

  assert.equal(requestedUrl.searchParams.get('cursor'), 'page_two')
  assert.equal(requestedUrl.searchParams.has('rescan'), false)
})

test('adopts through one atomic request and validates returned binding', async () => {
  const calls = []
  const conversation = {
    conversationId: 'conv_adopted01',
    projectId,
    machineId,
    provider: 'codex',
    cwd: '/test/project',
    status: 'idle',
    origin: 'adopted_native',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async (input, init) => {
      calls.push({ url: String(input), init })
      return jsonResponse({
        protocolVersion: 1,
        actionId: 'act_adopt0001',
        status: 'completed',
        data: { conversation, disposition: 'adopted' },
      })
    },
  })

  const response = await client.adoptProviderSession(projectId, machineId, {
    actionId: 'act_adopt0001',
    discoveryCandidateId: candidateId,
  })

  assert.equal(response.data.conversation.origin, 'adopted_native')
  assert.equal(calls.length, 1)
  assert.equal(
    new URL(calls[0].url).pathname,
    `/api/v1/projects/${projectId}/locations/${machineId}/provider-sessions`,
  )
  assert.equal(calls[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    actionId: 'act_adopt0001',
    discoveryCandidateId: candidateId,
  })
})

test('rejects cross-Machine discovery and cross-Project adoption responses', async () => {
  const discoveryClient = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async () =>
      jsonResponse({
        protocolVersion: 1,
        candidates: [
          {
            discoveryCandidateId: candidateId,
            provider: 'codex',
            machineId: 'machine_other01',
            title: 'Wrong Machine',
            resumeStatus: 'supported',
            historicalTranscript: 'unavailable',
            alreadyAdopted: false,
          },
        ],
        providers: [
          {
            provider: 'codex',
            status: 'supported',
            resumeStatus: 'supported',
            candidateCount: 1,
            corruptEntriesSkipped: 0,
          },
        ],
      }),
  })
  await assert.rejects(
    discoveryClient.discoverProviderSessions(projectId, machineId),
    CodeTetherProtocolError,
  )

  const adoptionClient = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async () =>
      jsonResponse({
        protocolVersion: 1,
        actionId: 'act_adopt0001',
        status: 'completed',
        data: {
          conversation: {
            conversationId: 'conv_adopted01',
            projectId: 'proj_other01',
            machineId,
            provider: 'codex',
            cwd: '/test/project',
            status: 'idle',
            origin: 'adopted_native',
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          disposition: 'adopted',
        },
      }),
  })
  await assert.rejects(
    adoptionClient.adoptProviderSession(projectId, machineId, {
      actionId: 'act_adopt0001',
      discoveryCandidateId: candidateId,
    }),
    CodeTetherProtocolError,
  )
})

test('rejects a raw Provider session identity at the public discovery boundary', async () => {
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async () =>
      jsonResponse({
        protocolVersion: 1,
        candidates: [
          {
            discoveryCandidateId: candidateId,
            provider: 'codex',
            machineId,
            title: 'Safe public title',
            resumeStatus: 'supported',
            historicalTranscript: 'unavailable',
            alreadyAdopted: false,
            nativeSessionId: 'must-never-cross-the-public-boundary',
          },
        ],
        providers: [
          {
            provider: 'codex',
            status: 'supported',
            resumeStatus: 'supported',
            candidateCount: 1,
            corruptEntriesSkipped: 0,
          },
        ],
      }),
  })

  await assert.rejects(
    client.discoverProviderSessions(projectId, machineId),
    CodeTetherProtocolError,
  )
})

test('rejects unbounded queries and raw-looking invalid candidate references before fetch', async () => {
  let fetchCalls = 0
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async () => {
      fetchCalls += 1
      throw new Error('fetch must not be called')
    },
  })

  await assert.rejects(
    client.discoverProviderSessions(projectId, machineId, { limit: 101 }),
    CodeTetherProtocolError,
  )
  await assert.rejects(
    client.adoptProviderSession(projectId, machineId, {
      actionId: 'act_adopt0001',
      discoveryCandidateId: 'native-provider-session-id',
    }),
    CodeTetherProtocolError,
  )
  assert.equal(fetchCalls, 0)
})

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

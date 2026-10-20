import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const remoteRuntimePath = new URL(
  '../src/runtime/account/remote-supervisor.ts',
  import.meta.url,
)

test('remote directory uses the authenticated Supervisor session and bounded cursors', async () => {
  const runtime = await readFile(remoteRuntimePath, 'utf8')
  assert.match(runtime, /readRemoteProjects/u)
  assert.match(runtime, /readRemoteProject/u)
  assert.match(runtime, /readRemoteConversations/u)
  assert.match(runtime, /readRemoteConversation/u)
  assert.match(runtime, /remote-supervisor\/sessions/u)
  assert.match(runtime, /new URLSearchParams\(\{ limit:/u)
  assert.doesNotMatch(runtime, /providerThreadId/u)
  assert.match(runtime, /readRemoteConversationHistory/u)
  assert.match(runtime, /readRemoteConversationLive/u)
  assert.match(runtime, /reconnectRemoteSupervisor/u)
  assert.match(runtime, /const reconnects = new Map/u)
})

test('remote Supervisor mutations retain explicit fixed create and start control actions', async () => {
  const runtime = await readFile(remoteRuntimePath, 'utf8')
  assert.match(runtime, /export async function startRemoteConversationTurn\(/u)
  assert.match(runtime, /export async function createRemoteConversation\(/u)
  assert.match(runtime, /control: 'read' \| 'control'/u)
  assert.doesNotMatch(runtime, /VITE_CODETETHER_VALIDATE_REMOTE/u)
})

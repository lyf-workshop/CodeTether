import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const remoteRuntimePath = new URL(
  '../src/runtime/account/remote-supervisor.ts',
  import.meta.url,
)
const remotePagePath = new URL(
  '../src/components/hosts/remote-host-page.tsx',
  import.meta.url,
)
const hostDirectoryPath = new URL(
  '../src/components/hosts/host-directory-page.tsx',
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

test('remote Host UI exposes Project and Conversation metadata without write actions', async () => {
  const [page, directory] = await Promise.all([
    readFile(remotePagePath, 'utf8'),
    readFile(hostDirectoryPath, 'utf8'),
  ])
  assert.match(page, /title="Projects"/u)
  assert.match(page, /title="Conversations"/u)
  assert.match(page, /Load more Projects/u)
  assert.match(page, /Load more Conversations/u)
  assert.match(page, /Remote read-only Conversation/u)
  assert.match(page, /Load earlier/u)
  assert.match(page, /Observing the active Turn/u)
  assert.match(page, /await reconnectRemoteSupervisor/u)
  assert.match(page, /cursor = refreshed\.liveCursor/u)
  assert.match(page, /VITE_CODETETHER_VALIDATE_REMOTE_CONVERSATION_ID/u)
  assert.match(page, /void history\.fetchNextPage/u)
  assert.doesNotMatch(
    page,
    /sendMessage|startProvider|resumeConversation|createConversation/u,
  )
  assert.match(page, /VITE_CODETETHER_VALIDATE_REMOTE_DIRECTORY_HOST_ID/u)
  assert.match(directory, /VITE_CODETETHER_VALIDATE_REMOTE_DIRECTORY_HOST_ID/u)
  assert.match(directory, /validationHostId !== host\.hostId/u)
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  countLocalActiveConversations,
  updateNotesText,
} from '../.tmp/test-dist/runtime/native/desktop-update-model.js'
import { createNativeCapabilities } from '../.tmp/test-dist/runtime/native/native-capabilities.js'

test('update preflight counts only running and waiting local conversations', () => {
  const conversations = [
    { machineId: 'machine_local', status: 'running' },
    { machineId: 'machine_local', status: 'waiting' },
    { machineId: 'machine_local', status: 'completed' },
    { machineId: 'machine_remote', status: 'running' },
  ]
  assert.equal(countLocalActiveConversations(conversations, 'machine_local'), 2)
  assert.equal(
    countLocalActiveConversations(conversations, undefined),
    undefined,
  )
  assert.equal(
    countLocalActiveConversations(undefined, 'machine_local'),
    undefined,
  )
  assert.equal(countLocalActiveConversations([], 'machine_local'), 0)
})

test('release notes remain bounded plain text', () => {
  const markdownAndHtml =
    '<script>alert(1)</script> [install](https://example.test)'
  assert.equal(updateNotesText(markdownAndHtml), markdownAndHtml)
  assert.equal(updateNotesText('x'.repeat(2_001))?.length, 2_000)
  assert.equal(Array.from(updateNotesText('🙂'.repeat(2_001))).length, 2_000)
})

test('Desktop updater invokes only fixed commands and sends a progress Channel', async () => {
  const calls = []
  const listeners = new Map()
  class FakeChannel {
    onmessage = () => undefined
  }
  const snapshot = {
    status: 'available',
    currentVersion: '0.1.0-alpha.3',
    availableVersion: '0.1.0-alpha.4',
    notes: 'safe notes',
  }
  const capabilities = createNativeCapabilities({
    tauriAvailable: true,
    loadTauriCore: async () => ({
      Channel: FakeChannel,
      invoke: async (command, args) => {
        calls.push({ command, args })
        if (command === 'update_download') {
          args.channel.onmessage({
            downloadedBytes: 12,
            totalBytes: 24,
            progressPercent: 50,
          })
        }
        return snapshot
      },
    }),
    loadTauriEvent: async () => ({
      listen: async (event, listener) => {
        listeners.set(event, listener)
        return () => listeners.delete(event)
      },
    }),
  })
  const updater = capabilities.desktopUpdater
  const progress = []
  const states = []
  assert.equal(updater.available, true)
  assert.deepEqual(await updater.state(), snapshot)
  assert.deepEqual(await updater.check(), snapshot)
  assert.deepEqual(
    await updater.download((chunk) => progress.push(chunk)),
    snapshot,
  )
  assert.deepEqual(await updater.install(), snapshot)
  const unlisten = await updater.subscribe((state) => states.push(state))
  listeners.get('codetether://update-state')({ payload: snapshot })
  unlisten()
  assert.deepEqual(
    calls.map((call) => call.command),
    ['update_state', 'update_check', 'update_download', 'update_install'],
  )
  assert.equal(calls[0].args, undefined)
  assert.equal(calls[1].args, undefined)
  assert.deepEqual(Object.keys(calls[2].args), ['channel'])
  assert.ok(calls[2].args.channel instanceof FakeChannel)
  assert.equal(calls[3].args, undefined)
  assert.deepEqual(progress, [
    { downloadedBytes: 12, totalBytes: 24, progressPercent: 50 },
  ])
  assert.deepEqual(states, [snapshot])
  assert.equal(listeners.has('codetether://update-state'), false)
})

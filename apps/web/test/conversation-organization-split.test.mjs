import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { loadWebComponent } from './fixtures/render-ui.mjs'

const prefix = 'components/conversations/'
test('organization controls retain their public entry and connect bounded settings, archive and shared modules', async () => {
  const names = [
    'conversation-organization-controls.tsx',
    'conversation-settings-dialog.tsx',
    'archive-conversation-dialog.tsx',
    'conversation-organization-shared.ts',
  ]
  const [entry, settings, archive, shared] = await Promise.all(
    names.map((name) =>
      readFile(new URL('../src/' + prefix + name, import.meta.url), 'utf8'),
    ),
  )
  for (const [index, source] of [entry, settings, archive, shared].entries())
    assert.ok(source.split('\n').length <= 400, names[index])
  assert.match(entry, /export function ConversationOrganizationMenu/u)
  assert.match(entry, /export function ConversationRestoreButton/u)
  assert.match(
    entry,
    /import \{ ConversationSettingsDialog \} from '.\/conversation-settings-dialog'/u,
  )
  assert.match(
    entry,
    /import \{ ArchiveConversationDialog \} from '.\/archive-conversation-dialog'/u,
  )
  assert.match(entry, /<ConversationSettingsDialog/u)
  assert.match(entry, /<ArchiveConversationDialog/u)
  assert.match(settings, /operationPendingRef\.current/u)
  assert.match(settings, /detail\.data\.conversation\.machineId/u)
  assert.match(archive, /archivedRef\.current/u)
  assert.doesNotMatch(
    [entry, settings, archive, shared].join('\n'),
    /startTurn|createConversation|setQueryData|actionId:|createActionId/u,
  )
})

test('extracted archive guard preserves running and waiting refusal without treating other statuses as busy', () => {
  const { conversationArchiveBlockedReason } = loadWebComponent(
    prefix + 'conversation-organization-shared.ts',
  )
  assert.equal(
    conversationArchiveBlockedReason({ status: 'running' }),
    '运行中的会话暂时不能归档。',
  )
  assert.equal(
    conversationArchiveBlockedReason({ status: 'waiting' }),
    '当前会话仍在等待你的确认。',
  )
  for (const status of ['idle', 'completed', 'failed'])
    assert.equal(conversationArchiveBlockedReason({ status }), undefined)
})

test('extracted trigger focus recovery still waits for the frame and never focuses a detached trigger', () => {
  const { restoreTriggerFocus } = loadWebComponent(
    prefix + 'conversation-organization-shared.ts',
  )
  const original = Object.getOwnPropertyDescriptor(
    globalThis,
    'requestAnimationFrame',
  )
  let frame
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: (callback) => {
      frame = callback
      return 1
    },
  })
  let focused = 0
  const target = {
    isConnected: true,
    focus: () => {
      focused += 1
    },
  }
  try {
    restoreTriggerFocus(target)
    assert.equal(focused, 0)
    target.isConnected = false
    frame()
    assert.equal(focused, 0)
    target.isConnected = true
    restoreTriggerFocus(target)
    frame()
    assert.equal(focused, 1)
    restoreTriggerFocus(null)
    frame()
    assert.equal(focused, 1)
  } finally {
    if (original === undefined) delete globalThis.requestAnimationFrame
    else Object.defineProperty(globalThis, 'requestAnimationFrame', original)
  }
})

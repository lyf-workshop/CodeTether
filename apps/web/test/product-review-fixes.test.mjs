import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createConversationInspectorState,
  openConversationInspectorTab,
  selectConversationInspectorTab,
  setConversationInspectorOpen,
} from '../.tmp/test-dist/components/conversation/conversation-inspector-state.js'
import { createProjectOptionPresentation } from '../.tmp/test-dist/components/conversations/new-conversation-presentation.js'

test('view changes opens the Inspector and selects its Changes tab', () => {
  const initial = createConversationInspectorState('overview', false)
  const viewingChanges = openConversationInspectorTab(initial, 'changes', true)

  assert.deepEqual(viewingChanges, { open: true, tab: 'changes' })
  assert.deepEqual(setConversationInspectorOpen(viewingChanges, false), {
    open: false,
    tab: 'changes',
  })
  assert.deepEqual(selectConversationInspectorTab(viewingChanges, 'terminal'), {
    open: true,
    tab: 'terminal',
  })
  assert.deepEqual(openConversationInspectorTab(initial, 'changes', false), {
    open: false,
    tab: 'changes',
  })
})

test('global Project choices disambiguate identical names with canonical paths', () => {
  const first = createProjectOptionPresentation({
    name: 'api',
    rootPath: 'C:\\workspaces\\alpha\\api',
  })
  const second = createProjectOptionPresentation({
    name: 'api',
    rootPath: 'D:\\workspaces\\beta\\api',
  })

  assert.equal(first.name, second.name)
  assert.notEqual(first.textValue, second.textValue)
  assert.equal(first.textValue, 'api — C:\\workspaces\\alpha\\api')
  assert.equal(second.textValue, 'api — D:\\workspaces\\beta\\api')
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadWebComponent } from './fixtures/render-ui.mjs'

import {
  createConversationInspectorState,
  openConversationInspectorTab,
  selectConversationInspectorTab,
  setConversationInspectorOpen,
} from '../.tmp/test-dist/components/conversation/conversation-inspector-state.js'

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
  const { NewConversationFields } = loadWebComponent(
    'components/conversations/new-conversation-fields.tsx',
  )
  const render = (rootPath) =>
    renderToStaticMarkup(
      createElement(NewConversationFields, {
        project: {
          key: rootPath,
          project: { name: 'api' },
          location: { rootPath },
          machine: { kind: 'local', displayName: '这台电脑' },
        },
        groups: [],
        fixed: true,
        loading: false,
        busy: false,
        providerOptions: [],
        defaultReasoning: '__provider_default__',
        formId: 'canonical-path',
        onProjectChange() {},
        onProviderChange() {},
        onReasoningChange() {},
      }),
    )
  const first = render('C:\\workspaces\\alpha\\api')
  const second = render('D:\\workspaces\\beta\\api')
  assert.match(first, /title="api"/u)
  assert.match(second, /title="api"/u)
  assert.ok(first.includes('C:\\workspaces\\alpha\\api'))
  assert.ok(second.includes('D:\\workspaces\\beta\\api'))
  assert.notEqual(first, second)
})

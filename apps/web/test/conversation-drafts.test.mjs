import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadWebComponent } from './fixtures/render-ui.mjs'

const { createConversationDraftStore, conversationDrafts } = loadWebComponent(
  'components/conversation/conversation-drafts.ts',
)
const { Composer } = loadWebComponent('components/conversation/composer.tsx')

test('conversation drafts save after the debounce and reload only from their exact localStorage key', async () => {
  const data = new Map()
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  }
  const first = createConversationDraftStore(() => storage, 5)
  first.write('conv_draft01', '尚未发送\n第二行')
  first.write('conv_draft02', '另一个会话')
  assert.equal(first.read('conv_draft01'), '尚未发送\n第二行')
  assert.equal(first.read('conv_draft02'), '另一个会话')
  assert.equal(data.size, 0)
  await new Promise((resolve) => setTimeout(resolve, 15))
  assert.equal(data.get('composer-draft-conv_draft01'), '尚未发送\n第二行')
  assert.equal(data.get('composer-draft-conv_draft02'), '另一个会话')
  const reloaded = createConversationDraftStore(() => storage)
  assert.equal(reloaded.read('conv_draft01'), '尚未发送\n第二行')
  assert.equal(reloaded.read('conv_absent01'), '')
  assert.equal(data.size, 2)
  first.clear('conv_draft01')
  assert.equal(first.read('conv_draft01'), '')
  assert.equal(
    createConversationDraftStore(() => storage).read('conv_draft01'),
    '',
  )
  assert.equal(first.read('conv_draft02'), '另一个会话')
})

test('optional or throwing localStorage never loses an in-memory draft or blocks clearing', () => {
  const storage = {
    getItem() {
      throw new Error('disabled')
    },
    setItem() {
      throw new Error('quota')
    },
    removeItem() {
      throw new Error('disabled')
    },
  }
  for (const getStorage of [
    () => undefined,
    () => storage,
    () => {
      throw new Error('denied')
    },
  ]) {
    const drafts = createConversationDraftStore(getStorage)
    assert.equal(drafts.read('conv_private01'), '')
    drafts.write('conv_private01', '仅当前页面可用')
    assert.equal(drafts.read('conv_private01'), '仅当前页面可用')
    drafts.clear('conv_private01')
    assert.equal(drafts.read('conv_private01'), '')
  }
})

test('clearing an empty draft removes storage rather than retaining prompt text', () => {
  const data = new Map()
  const drafts = createConversationDraftStore(() => ({
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  }))
  drafts.write('conv_empty01', '文字')
  drafts.write('conv_empty01', '')
  assert.equal(drafts.read('conv_empty01'), '')
  assert.equal(data.size, 0)
})

test('real Composer restores only its conversation draft and never displays an archived draft', () => {
  const capabilities = {
    canCompose: true,
    supportsInterrupt: false,
    canInterrupt: false,
  }
  const controller = {
    state: 'idle',
    async submit() {
      return false
    },
  }
  conversationDrafts.write('conv_render01', '会话一 & 未发送')
  conversationDrafts.write('conv_render02', '会话二')
  try {
    const render = (conversationId, archived = false) =>
      renderToStaticMarkup(
        h(Composer, { conversationId, archived, capabilities, controller }),
      )
    assert.match(render('conv_render01'), /会话一 &amp; 未发送/u)
    assert.doesNotMatch(render('conv_render01'), /会话二/u)
    assert.match(render('conv_render02'), /会话二/u)
    assert.doesNotMatch(render('conv_render01', true), /会话一/u)
  } finally {
    conversationDrafts.clear('conv_render01')
    conversationDrafts.clear('conv_render02')
  }
})

test('Composer requires a real controller, persists edits, and clears only accepted or archived drafts', async () => {
  const [composer, workspace, drafts] = await Promise.all([
    source('composer.tsx'),
    source('conversation-workspace.tsx'),
    source('conversation-drafts.ts'),
  ])
  assert.match(composer, /controller: ComposerController/u)
  assert.doesNotMatch(composer, /controller\?|发送消息（演示）/u)
  assert.match(
    workspace,
    /key=\{`\$\{viewModel\.id\}:\$\{archived \? 'archived' : 'active'\}`\}/u,
  )
  assert.match(workspace, /conversationId=\{viewModel\.id\}/u)
  assert.match(composer, /conversationDrafts\.write\(conversationId,/u)
  assert.match(composer, /if \(archived\)/u)
  assert.match(composer, /conversationDrafts\.clear\(conversationId\)/u)
  assert.match(
    composer,
    /draftAfterSubmit\(current, submittedValue, accepted\)/u,
  )
  assert.match(drafts, /composer-draft-/u)
  assert.match(drafts, /localStorage/u)
  assert.match(drafts, /setTimeout/u)
  assert.doesNotMatch(drafts, /sessionStorage|setInterval|fetch\(/u)
})

test('a later draft replaces the pending save, and clearing cancels it', async () => {
  const data = new Map()
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  }
  const drafts = createConversationDraftStore(() => storage, 5)
  drafts.write('conv_debounce01', 'first')
  drafts.write('conv_debounce01', 'latest')
  drafts.write('conv_cleared01', 'discard')
  drafts.clear('conv_cleared01')
  await new Promise((resolve) => setTimeout(resolve, 15))
  assert.equal(data.get('composer-draft-conv_debounce01'), 'latest')
  assert.equal(data.has('composer-draft-conv_cleared01'), false)
  drafts.clear('conv_debounce01')
})

test('external storage changes refresh a settled draft without replacing a pending local edit', async () => {
  const data = new Map()
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  }
  const drafts = createConversationDraftStore(() => storage, 5)
  const key = 'composer-draft-conv_shared01'
  drafts.write('conv_shared01', 'local first')
  await new Promise((resolve) => setTimeout(resolve, 15))
  data.set(key, 'another window')
  assert.equal(drafts.read('conv_shared01'), 'another window')
  drafts.write('conv_shared01', 'local pending')
  data.set(key, 'new external edit')
  assert.equal(drafts.read('conv_shared01'), 'local pending')
  await new Promise((resolve) => setTimeout(resolve, 15))
  assert.equal(data.get(key), 'local pending')
  data.delete(key)
  assert.equal(drafts.read('conv_shared01'), '')
})

test('failed writes and removals retain the local draft over stale storage', async () => {
  const data = new Map([['composer-draft-conv_denied01', 'old value']])
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem() {
      throw new Error('quota')
    },
    removeItem() {
      throw new Error('denied')
    },
  }
  const drafts = createConversationDraftStore(() => storage, 5)
  assert.equal(drafts.read('conv_denied01'), 'old value')
  drafts.write('conv_denied01', 'new unsaved value')
  await new Promise((resolve) => setTimeout(resolve, 15))
  assert.equal(drafts.read('conv_denied01'), 'new unsaved value')
  drafts.clear('conv_denied01')
  assert.equal(drafts.read('conv_denied01'), '')
})

test('submit focus recovery is editor-originated and abandons intent when another control or window gets focus', async () => {
  const composer = await source('composer.tsx')
  assert.match(composer, /document\.activeElement === editorRef\.current/u)
  assert.match(composer, /addEventListener\('focusin'/u)
  assert.match(composer, /addEventListener\('blur'/u)
  assert.match(composer, /document\.hasFocus\(\)/u)
  assert.match(composer, /document\.activeElement !== document\.body/u)
  assert.match(composer, /removeEventListener\('focusin'/u)
  assert.match(composer, /removeEventListener\('blur'/u)
  assert.match(composer, /submitActive\.current/u)
})

function source(name) {
  return readFile(
    new URL('../src/components/conversation/' + name, import.meta.url),
    'utf8',
  )
}

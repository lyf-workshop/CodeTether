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

test('conversation drafts survive remount and reload only within their exact sessionStorage key', () => {
  const data = new Map()
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  }
  const first = createConversationDraftStore(() => storage)
  first.write('conv_draft01', '尚未发送\n第二行')
  first.write('conv_draft02', '另一个会话')
  assert.equal(first.read('conv_draft01'), '尚未发送\n第二行')
  assert.equal(first.read('conv_draft02'), '另一个会话')
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

test('optional or throwing sessionStorage never loses an in-memory draft or blocks clearing', () => {
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

test('Composer requires a real controller, persists edits, clears only accepted or archived drafts and never uses localStorage', async () => {
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
  assert.match(drafts, /sessionStorage/u)
  assert.doesNotMatch(drafts, /localStorage|setInterval|fetch\(/u)
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

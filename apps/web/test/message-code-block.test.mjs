import assert from 'node:assert/strict'
import test from 'node:test'

import { createDom, h } from './fixtures/dom.mjs'
import { loadUiComponent, loadWebComponent } from './fixtures/render-ui.mjs'

const { CodeBlock } = loadUiComponent('components/product/code-block.tsx')
const { DiffCard } = loadUiComponent('components/product/diff-card.tsx')
const { MessageMarkdown } = loadWebComponent(
  'components/conversation/message-markdown.tsx',
)
const { highlightMessageCode, messageCodeLanguage, messageCodeLanguageLabel } =
  loadWebComponent('components/conversation/message-code-highlight.ts')

test('long code keeps the first ten and last five numbered lines and remembers explicitly expanded blocks', async (t) => {
  const dom = await createDom()
  t.after(() => dom.close())
  const sourceLines = Array.from({ length: 31 }, (_, i) => '  line ' + (i + 1))
  const code = sourceLines.join('\n')
  const view = h(CodeBlock, {
    code,
    appearance: 'message',
    language: 'TypeScript',
    expansionKey: 'test-agent-message:0',
  })
  const renderedLines = () =>
    Array.from(dom.container.querySelectorAll('[data-code-line]'), (node) =>
      Number(node.dataset.codeLine),
    )
  const control = () => dom.container.querySelector('button[aria-expanded]')
  const clipboardWrites = []
  Object.defineProperty(dom.window.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text) => {
        clipboardWrites.push(text)
      },
    },
  })

  await dom.render(
    h(CodeBlock, {
      appearance: 'message',
      code: sourceLines.slice(0, 30).join('\n'),
    }),
  )
  assert.equal(renderedLines().length, 30)
  assert.equal(control(), null)

  await dom.render(view)
  assert.deepEqual(
    renderedLines(),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 27, 28, 29, 30, 31],
  )
  assert.equal(control().textContent, '展开 16 行')
  assert.equal(control().getAttribute('aria-expanded'), 'false')
  await dom.perform(() =>
    dom.container.querySelector('button[aria-label="复制代码"]').click(),
  )
  assert.deepEqual(clipboardWrites, [code])

  await dom.perform(() => {
    control().focus()
    control().click()
  })
  assert.equal(control().getAttribute('aria-expanded'), 'true')
  assert.equal(dom.window.document.activeElement, control())
  assert.equal(renderedLines().length, 31)

  await dom.render(null)
  await dom.render(view)
  assert.equal(control().getAttribute('aria-expanded'), 'true')
  assert.equal(renderedLines().length, 31)
  await dom.perform(() => control().click())
  assert.equal(renderedLines().length, 15)
})

test('each supported lazy grammar produces styled text tokens while keeping source and line breaks', async () => {
  const fixtures = [
    ['js', 'JavaScript', 'const count = 2\n'],
    ['src/example.ts', 'TypeScript', 'const sample: number = 2\n'],
    ['script.py', 'Python', 'def greet(name):\n    return "你好"\n'],
    ['example.rs', 'Rust', 'fn main() {\n    let count = 2;\n}'],
    ['go', 'Go', 'package main\n\nvar total = 2'],
    ['index.html', 'HTML', '<img src="https://example.invalid/image.png">'],
    ['css', 'CSS', '.root { color: red; }'],
    ['settings.json', 'JSON', '{"enabled": true, "count": 2}'],
    ['sh', 'Shell', 'echo "sample"'],
    ['sql', 'SQL', 'SELECT 2 FROM items;'],
  ]

  await Promise.all(
    fixtures.map(async ([fence, label, code]) => {
      const language = messageCodeLanguage(fence)
      assert.equal(messageCodeLanguageLabel(language), label)
      const lines = await highlightMessageCode(code, language)
      assert.equal(
        lines.map((line) => line.map(({ text }) => text).join('')).join('\n'),
        code,
      )
      assert.ok(
        lines.flat().some(({ tone }) => tone !== undefined),
        fence,
      )
    }),
  )
  assert.equal(messageCodeLanguage('path/to/unregistered.md'), undefined)
  assert.equal(messageCodeLanguage('__proto__'), undefined)
})

test('HTML fences are rendered as labeled inert code spans even after the grammar loads', async (t) => {
  const dom = await createDom()
  t.after(() => dom.close())
  const fence = '\x60\x60\x60'
  const snippet =
    '<img src="https://example.invalid/body.png"><script>let test = true</script>'
  await dom.render(
    h(
      MessageMarkdown,
      { messageId: 'test-html' },
      fence + 'html\n' + snippet + '\n' + fence,
    ),
  )
  await dom.until(
    () => dom.container.querySelector('.text-message-code-keyword') !== null,
  )
  assert.ok(dom.container.querySelector('[data-language="HTML"]'))
  assert.equal(dom.container.querySelector('img, script'), null)
  assert.equal(
    dom.container.querySelector('[data-code-line] > span:last-child')
      .textContent,
    snippet,
  )
})

test('diff code preserves exact indentation in a monospaced scrolling block with full row tints', async (t) => {
  const dom = await createDom()
  t.after(() => dom.close())
  await dom.render(
    h(DiffCard, {
      fileName: 'src/test.ts',
      lines: [
        { kind: 'deletion', content: '\t  const n = 0', oldLineNumber: 1 },
        { kind: 'addition', content: '    const n = 2', newLineNumber: 1 },
      ],
    }),
  )
  const pre = dom.container.querySelector('pre')
  assert.ok(pre.classList.contains('font-mono'))
  assert.ok(pre.classList.contains('overflow-x-auto'))
  assert.ok(pre.classList.contains('whitespace-pre'))
  const addition = pre.querySelector('[data-kind="addition"]')
  const deletion = pre.querySelector('[data-kind="deletion"]')
  assert.ok(addition.classList.contains('bg-success-muted'))
  assert.ok(deletion.classList.contains('bg-danger-muted'))
  assert.equal(addition.lastElementChild.textContent, '    const n = 2')
  assert.equal(deletion.lastElementChild.textContent, '\t  const n = 0')
})

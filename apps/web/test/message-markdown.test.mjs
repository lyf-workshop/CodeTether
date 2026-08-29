import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

import {
  parseMessageMarkdown,
  parseMessageMarkdownInline,
  safeMessageLink,
} from '../.tmp/test-dist/components/conversation/message-markdown-model.js'
import { presentProjectPaths } from '../.tmp/test-dist/components/conversation/message-presentation.js'

test('parses the supported Agent Markdown blocks without interpreting HTML', () => {
  const blocks = parseMessageMarkdown(`# 结果

完成了 **两项** 工作，并保留 \`pnpm test\`。

- 第一项
- 第二项

3. 第三项
4. 第四项

\`\`\`ts
const ready = true
\`\`\`

<script>alert('never')</script>`)

  assert.deepEqual(
    blocks.map((block) => block.kind),
    ['heading', 'paragraph', 'list', 'list', 'code-block', 'paragraph'],
  )
  assert.equal(blocks[2].ordered, false)
  assert.equal(blocks[3].ordered, true)
  assert.equal(blocks[3].start, 3)
  assert.equal(blocks[4].language, 'ts')
  assert.equal(blocks[4].value, 'const ready = true')
  assert.equal(blocks[5].children[0].value, "<script>alert('never')</script>")
})

test('allows only explicit safe link protocols and leaves image syntax inert', () => {
  assert.equal(
    safeMessageLink('https://example.com/a'),
    'https://example.com/a',
  )
  assert.equal(
    safeMessageLink('mailto:hello@example.com'),
    'mailto:hello@example.com',
  )
  assert.equal(safeMessageLink('javascript:alert(1)'), undefined)
  assert.equal(safeMessageLink('data:text/html,hello'), undefined)
  assert.equal(safeMessageLink('/relative'), undefined)

  const safe = parseMessageMarkdownInline(
    '[文档](https://example.com) [危险](javascript:alert(1)) ![远程图](https://example.com/a.png)',
  )
  assert.equal(
    safe.some((token) => token.kind === 'link'),
    true,
  )
  assert.equal(safe.filter((token) => token.kind === 'link').length, 1)
  assert.match(
    safe.map((token) => ('value' in token ? token.value : '')).join(''),
    /危险.*远程图/u,
  )
})

test('keeps balanced parentheses inside safe Markdown link destinations', () => {
  const href = 'https://en.wikipedia.org/wiki/Foo_(bar)'
  const tokens = parseMessageMarkdownInline(`[wiki](${href})`)

  assert.deepEqual(tokens, [
    {
      kind: 'link',
      href,
      children: [{ kind: 'text', value: 'wiki' }],
    },
  ])

  const unsafe = parseMessageMarkdownInline(
    '[danger](javascript:alert(confirm(1)))',
  )
  assert.equal(
    unsafe.some((token) => token.kind === 'link'),
    false,
  )
})

test('path presentation never rewrites a safe Markdown link destination', async () => {
  const href = 'https://example.com/C:/Users/A/project/src/app.ts'
  const blocks = parseMessageMarkdown(`[docs](${href})`)
  const link = blocks[0].children.find((token) => token.kind === 'link')
  assert.equal(link?.href, href)

  const component = await readFile(
    resolve(
      import.meta.dirname,
      '../src/components/conversation/message-markdown.tsx',
    ),
    'utf8',
  )
  assert.match(component, /parseMessageMarkdown\(children\)/u)
  assert.doesNotMatch(component, /presentProjectPaths\(children/u)
  assert.match(component, /href=\{token\.href\}/u)
})

test('shortens only reliably project-contained paths for display', () => {
  const root = 'C:\\Users\\开发者\\My Projects\\CodeTether'
  const source = [
    '`C:\\Users\\开发者\\My Projects\\CodeTether\\src\\app.ts`',
    'C:\\Users\\开发者\\My Projects\\CodeTether\\test\\app.test.ts。',
    'C:\\Users\\开发者\\My Projects\\CodeTether-other\\secret.txt',
  ].join('\n')

  const presented = presentProjectPaths(source, root)

  assert.match(presented, /`src\/app\.ts`/u)
  assert.match(presented, /test\/app\.test\.ts。/u)
  assert.match(presented, /CodeTether-other\\secret\.txt/u)
  assert.equal(source.includes('C:\\Users\\开发者'), true)
})

test('retains ambiguous or escaping paths instead of presenting them as contained', () => {
  const root = 'C:\\workspace\\alpha'
  const escaping = 'C:\\workspace\\alpha\\..\\secret.txt'
  const ambiguousWithSpaces = 'C:\\workspace\\alpha\\folder name\\file.ts'

  assert.equal(presentProjectPaths(escaping, root), escaping)
  assert.equal(
    presentProjectPaths(ambiguousWithSpaces, root),
    ambiguousWithSpaces,
  )
  assert.equal(presentProjectPaths(escaping, undefined), escaping)
})

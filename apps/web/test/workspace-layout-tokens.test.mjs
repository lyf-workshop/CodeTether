import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadUiComponent } from './fixtures/render-ui.mjs'

const styles = async () =>
  Promise.all([
    readFile(
      new URL('../../../packages/ui/src/styles/globals.css', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL(
        '../src/components/app-shell/workspace-responsive.css',
        import.meta.url,
      ),
      'utf8',
    ),
  ])

test('palette and phone geometry have one central named owner without changed dimensions', async () => {
  const [tokens, responsive] = await styles()
  for (const [name, value] of [
    ['--layout-command-palette-width', '40rem'],
    ['--layout-command-list-max-height', '26.25rem'],
    ['--layout-mobile-navigation-height', '4rem'],
    ['--layout-mobile-dialog-max-height', '92dvh'],
  ]) {
    assert.ok(tokens.includes(name + ': ' + value + ';'), name)
    assert.equal((tokens.match(new RegExp(name + ':', 'gu')) ?? []).length, 1)
    if (name !== '--layout-command-list-max-height')
      assert.ok(responsive.includes('var(' + name + ')'), name + ' consumer')
    assert.ok(
      !responsive.includes(name + ':'),
      name + ' must not be locally redefined',
    )
  }
  for (const reference of [
    '--s1',
    '--s2',
    '--s3',
    '--s4',
    '--s6',
    '--s8',
    '--s12',
  ])
    assert.ok(responsive.includes('var(' + reference + ')'), reference)
  assert.match(responsive, /--layout-topbar-height: var\(--s12\)/u)
  assert.match(responsive, /width: var\(--s8\);\s*height: var\(--s8\)/u)
  assert.match(responsive, /workspace-global-search/u)
  assert.match(responsive, /@media \(width <= 37\.5rem\)/u)
  const declarations = responsive
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/@media[^{]+/gu, '')
    .replaceAll('0px', '')
  assert.doesNotMatch(declarations, /\b\d+(?:\.\d+)?(?:rem|px|dvh)\b/u)
  assert.doesNotMatch(responsive, /!important/u)
})

test('existing permanent spacing tokens preserve all prior baseline dimensions', async () => {
  const [tokens, responsive] = await styles()
  const values = new Map(
    [...tokens.matchAll(/(--[\w-]+):\s*([^;{}]+);/gu)].map((match) => [
      match[1],
      match[2].trim(),
    ]),
  )
  for (const [name, px] of [
    ['--s1', 4],
    ['--s2', 8],
    ['--s3', 12],
    ['--s4', 16],
    ['--s6', 24],
    ['--s8', 32],
    ['--s12', 48],
  ])
    assert.equal(values.get(name), px + 'px')
  assert.match(responsive, /calc\(var\(--s1\) \* 1\.5\)/u)
  assert.match(responsive, /calc\(var\(--s1\) \* 2\.5 \+ env/u)
  // Check actual Tailwind compilation in memory; no dev server/build output.
  const { compile } = createRequire(
    new URL('../../../packages/ui/package.json', import.meta.url),
  )('tailwindcss')
  const input =
    tokens.replace(/^@(?:import|source)[^;]+;\s*/gmu, '') + '\n' + responsive
  const output = (await compile(input)).build([])
  for (const name of [
    '--s12',
    '--layout-command-palette-width',
    '--layout-command-list-max-height',
    '--layout-mobile-navigation-height',
    '--layout-mobile-dialog-max-height',
  ])
    assert.ok(
      output.includes(name + ':'),
      name + ' remains defined after compilation',
    )
})

test('settings uses approved desktop and tablet columns and only phone tabs', async () => {
  const [tokens] = await styles()
  const settings = await readFile(
    new URL('../src/components/settings/settings-page.tsx', import.meta.url),
    'utf8',
  )
  for (const [name, value] of [
    ['--layout-settings-width', '960px'],
    ['--layout-settings-navigation-width', '208px'],
    ['--layout-settings-navigation-compact-width', '180px'],
  ]) {
    assert.ok(tokens.includes(name + ': ' + value + ';'), name)
    assert.ok(
      settings.includes('var(' + name + ')') ||
        settings.includes('(' + name + ')'),
      name + ' consumer',
    )
  }
  assert.match(settings, /gap-\[var\(--s10\)\]/u)
  assert.match(settings, /compact-workspace:gap-6/u)
  assert.match(settings, /phone:grid-cols-1/u)
  assert.match(settings, /phone:hidden/u)
  assert.match(settings, /above-phone:hidden/u)
  assert.doesNotMatch(settings, /11rem|min-\[1001px\]|max-w-\(--page-w\)/u)
})

test('real CommandList render consumes the same central maximum-height contract', async () => {
  const { CommandList } = loadUiComponent('components/command-list.tsx')
  const html = renderToStaticMarkup(
    h(CommandList, {
      groups: [
        {
          id: 'devices',
          label: '设备',
          items: [{ id: 'device:local', label: '这台电脑' }],
        },
      ],
      query: '',
      onQueryChange() {},
      onHighlightChange() {},
      onSelect() {},
    }),
  )
  assert.match(html, /max-h-\[var\(--layout-command-list-max-height\)\]/u)
  assert.match(html, /role="combobox"/u)
  assert.match(html, /role="option"/u)
  assert.match(html, /这台电脑/u)
})

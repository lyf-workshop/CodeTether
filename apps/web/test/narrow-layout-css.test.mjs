import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import tailwindcss from '@tailwindcss/vite'
import { JSDOM } from 'jsdom'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'vite'
import { loadUiComponent } from './fixtures/render-ui.mjs'

// Use Vite's existing CSS parser and the production stylesheet/Tailwind plugin.
// No application code executes, no assets are written and .env files are disabled.
const { parse } = createRequire(import.meta.resolve('vite'))('postcss')
for (const cssMinify of [false, true]) {
  const mode = cssMinify ? 'minified CSS' : 'readable CSS'
  const result = await build({
    root: fileURLToPath(new URL('../', import.meta.url)),
    configFile: false,
    envDir: false,
    plugins: [tailwindcss()],
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      cssMinify,
      rollupOptions: {
        input: fileURLToPath(new URL('../src/styles.css', import.meta.url)),
      },
    },
  })
  const outputs = Array.isArray(result) ? result : [result]
  const assets = outputs
    .flatMap((output) => output.output)
    .filter(
      (asset) => asset.type === 'asset' && asset.fileName.endsWith('.css'),
    )
  assert.ok(assets.length > 0, 'the real CSS build must emit a stylesheet')
  const styles = assets.map((asset) => parse(String(asset.source)))

  test(
    mode +
      ' leaves narrow AttentionRow placement to layered Tailwind rather than conflicting slot rules',
    () => {
      const conflictingRules = []
      for (const stylesheet of styles)
        stylesheet.walkRules((rule) => {
          if (/attention-(?:body|time|actions)/u.test(rule.selector))
            conflictingRules.push(rule.toString())
        })
      assert.deepEqual(
        conflictingRules,
        [],
        'old unlayered attention slot rules must not override narrow utility placement (especially actions grid-column:3)',
      )
    },
  )

  test(
    mode +
      ' places narrow AttentionRow time and actions below the body through 600px',
    () => {
      const { AttentionRow } = loadUiComponent('components/attention-row.tsx')
      const dom = new JSDOM(
        renderToStaticMarkup(
          h(AttentionRow, {
            mark: '提醒',
            title: '需要批准',
            description: '等待你的确认',
            context: '测试设备 · 测试项目',
            time: '刚刚',
            actions: h('button', null, '允许一次'),
          }),
        ),
      )
      try {
        for (const [slot, property, value] of [
          ['attention-time', 'grid-column-start', '2'],
          ['attention-time', 'grid-row-start', '2'],
          ['attention-actions', 'grid-column-start', '2'],
          ['attention-actions', 'grid-row-start', '3'],
          ['attention-actions', 'justify-content', 'flex-start'],
        ]) {
          const element = dom.window.document.querySelector(
            '[data-slot="' + slot + '"]',
          )
          assert.ok(element)
          const rules = [...element.classList].flatMap((className) =>
            findRules((selector) => selector === '.' + className),
          )
          assert.ok(
            rules.some(
              (rule) =>
                withinNarrowMedia(rule) &&
                rule.nodes.some(
                  (node) =>
                    node.type === 'decl' &&
                    node.prop === property &&
                    node.value === value,
                ),
            ),
            slot + ' must emit ' + property + ': ' + value + ' through 600px',
          )
        }
      } finally {
        dom.window.close()
      }
    },
  )

  test(
    mode +
      ' clears phone sheet transform, individual translation and scale while retaining bottom anchoring',
    () => {
      for (const selector of [
        '.ct-add-project-dialog',
        '.ct-new-conversation-dialog',
      ]) {
        const rules = findRules((candidate) => candidate === selector).filter(
          withinNarrowMedia,
        )
        assert.ok(
          rules.length > 0,
          selector + ' must have built phone overrides',
        )
        for (const [property, value] of [
          ['top', 'auto'],
          ['bottom', '0'],
          ['left', '0'],
          ['width', '100%'],
          ['transform', 'none'],
          ['translate', 'none'],
          ['scale', 'none'],
        ]) {
          const rule = rules.find((candidate) =>
            candidate.nodes.some(
              (node) =>
                node.type === 'decl' &&
                node.prop === property &&
                node.value === value,
            ),
          )
          assert.ok(rule, selector + ' must emit ' + property + ': ' + value)
          assert.equal(
            withinLayer(rule),
            false,
            'phone sheet resets must outrank layered open/closed state utilities',
          )
          if (property === 'translate' || property === 'scale')
            assert.ok(
              withinSupports(rule, property),
              'keep the supported individual reset separate from transform optimization',
            )
        }
      }
    },
  )

  test(
    mode +
      ' retains desktop centering and both open/closed scale states beneath the phone reset',
    () => {
      assert.ok(
        findRules((selector) => selector === '.-translate-x-1/2').some((rule) =>
          rule.nodes.some(
            (node) => node.type === 'decl' && node.prop === 'translate',
          ),
        ),
        'desktop centering remains an individual translate, not removed to hide the regression',
      )
      for (const state of ['open', 'closed'])
        assert.ok(
          findRules(
            (selector) =>
              selector.includes('scale-') &&
              (selector.endsWith('[data-state="' + state + '"]') ||
                selector.endsWith('[data-state=' + state + ']')),
          ).some(
            (rule) =>
              withinLayer(rule) &&
              rule.nodes.some(
                (node) => node.type === 'decl' && node.prop === 'scale',
              ),
          ),
          state +
            ' state still uses a layered scale that the phone reset must beat',
        )
    },
  )

  function findRules(matches) {
    const result = []
    for (const stylesheet of styles)
      stylesheet.walkRules((rule) => {
        if (
          rule.selectors.some((selector) =>
            matches(selector.replace(/\\(.)/gu, '$1')),
          )
        )
          result.push(rule)
      })
    return result
  }
}

function withinNarrowMedia(rule) {
  for (let parent = rule.parent; parent !== undefined; parent = parent.parent)
    if (
      parent.type === 'atrule' &&
      parent.name === 'media' &&
      /^(?:\(max-width:\s*(?:600px|37\.5rem)\)|\(width\s*<=\s*(?:600px|37\.5rem)\))$/u.test(
        parent.params,
      )
    )
      return true
  return false
}

function withinLayer(rule) {
  for (let parent = rule.parent; parent !== undefined; parent = parent.parent)
    if (parent.type === 'atrule' && parent.name === 'layer') return true
  return false
}

function withinSupports(rule, property) {
  for (let parent = rule.parent; parent !== undefined; parent = parent.parent)
    if (
      parent.type === 'atrule' &&
      parent.name === 'supports' &&
      parent.params.replace(/\s/gu, '') === '(' + property + ':none)'
    )
      return true
  return false
}

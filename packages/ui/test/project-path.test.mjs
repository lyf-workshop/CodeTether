import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProjectPath } from '../dist/components/product/project-path.js'
import {
  fitProjectPathToWidth,
  projectPathParts,
} from '../dist/components/product/project-path-parts.js'

const monospaceWidth = (value) => Array.from(value).length * 8

test('Windows and POSIX paths keep their distinguishing final folder', () => {
  assert.deepEqual(projectPathParts('D:\\Projects\\Software\\weather-cli'), {
    prefix: 'D:\\Projects\\Software',
    tail: '\\weather-cli',
  })
  assert.deepEqual(projectPathParts('/Users/lin/work/payments-api'), {
    prefix: '/Users/lin/work',
    tail: '/payments-api',
  })
})

test('short paths and paths without a parent remain intact', () => {
  assert.deepEqual(projectPathParts('C:\\x'), {
    prefix: 'C:',
    tail: '\\x',
  })
  assert.deepEqual(projectPathParts('README.md'), {
    prefix: '',
    tail: 'README.md',
  })
})

test('a long final folder remains whole before width fitting', () => {
  assert.deepEqual(projectPathParts('/work/very-long-distinguishing-tail'), {
    prefix: '/work',
    tail: '/very-long-distinguishing-tail',
  })
})

test('visible path cuts at character boundaries and keeps the final folder', () => {
  const windowsPath = 'E:\\Projects\\Software\\read-only-preflight'
  const windowsDisplay = fitProjectPathToWidth(
    windowsPath,
    30 * 8,
    monospaceWidth,
  )
  assert.equal(windowsDisplay, 'E:\\Projec…\\read-only-preflight')
  assert.equal(monospaceWidth(windowsDisplay), 30 * 8)
  assert.doesNotMatch(windowsDisplay, /…\s+[\\/]/u)

  const posixDisplay = fitProjectPathToWidth(
    '/Users/lin/work/payments-api',
    20 * 8,
    monospaceWidth,
  )
  assert.equal(posixDisplay, '/Users…/payments-api')
  assert.equal(monospaceWidth(posixDisplay), 20 * 8)
})

test('long scratch folders keep their beginning before any parent characters', () => {
  const tablet =
    'D:\\Projects\\Software\\agenthub-archive\\t1a-tablet-tb375fc-scratch-20261107'
  const vivo =
    'D:\\Projects\\Software\\agenthub-archive\\t1a-vivo-x60-scratch-20261106-e2945b18'

  assert.equal(
    fitProjectPathToWidth(tablet, 40 * 8, monospaceWidth),
    'D:\\…\\t1a-tablet-tb375fc-scratch-20261107',
  )
  assert.equal(
    fitProjectPathToWidth(tablet, 32 * 8, monospaceWidth),
    '…tablet-tb375fc-scratch-20261107',
  )
  assert.equal(
    fitProjectPathToWidth(vivo, 43 * 8, monospaceWidth),
    'D:\\…\\t1a-vivo-x60-scratch-20261106-e2945b18',
  )
  for (const path of [tablet, vivo]) {
    for (const columns of [32, 39, 40, 43]) {
      const shown = fitProjectPathToWidth(path, columns * 8, monospaceWidth)
      assert.ok(monospaceWidth(shown) <= columns * 8)
      assert.ok((shown.match(/…/gu) ?? []).length <= 1)
      assert.doesNotMatch(shown, /…[\\/]…/u)
    }
  }
})

test('short paths and a tail wider than the row retain visible source text', () => {
  assert.equal(fitProjectPathToWidth('C:\\x', 12 * 8, monospaceWidth), 'C:\\x')
  assert.equal(
    fitProjectPathToWidth('README.md', 12 * 8, monospaceWidth),
    'README.md',
  )
  const narrow = fitProjectPathToWidth(
    '/work/very-long-distinguishing-tail',
    8 * 8,
    monospaceWidth,
  )
  assert.match(narrow, /^….*tail$/u)
  assert.ok(monospaceWidth(narrow) <= 8 * 8)
})

test('POSIX and UNC roots remain when their complete folder fits', () => {
  assert.equal(
    fitProjectPathToWidth(
      '/Users/lin/work/payments-api',
      18 * 8,
      monospaceWidth,
    ),
    '/Use…/payments-api',
  )
  assert.equal(
    fitProjectPathToWidth('\\\\server\\share\\folder', 22 * 8, monospaceWidth),
    '\\\\server\\share\\folder',
  )
})

test('the full path remains available on hover and to screen readers', () => {
  const path = 'D:\\Projects\\Software\\weather-cli'
  const markup = renderToStaticMarkup(h(ProjectPath, { path }))
  assert.match(markup, /title="D:\\Projects\\Software\\weather-cli"/u)
  assert.match(markup, /class="sr-only">D:\\Projects\\Software\\weather-cli/u)
  assert.match(markup, /aria-hidden="true"/u)
  assert.match(markup, /data-slot="project-path"/u)
  assert.match(markup, /D:\\Projects\\Software\\weather-cli<\/span>/u)
})

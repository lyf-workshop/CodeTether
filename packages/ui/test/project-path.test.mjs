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

test('a final folder longer than its available budget keeps its suffix', () => {
  assert.deepEqual(
    projectPathParts('/work/very-long-distinguishing-tail', 12),
    {
      prefix: '/work',
      tail: '/…shing-tail',
    },
  )
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
  assert.match(narrow, /^\/….*tail$/u)
  assert.ok(monospaceWidth(narrow) <= 8 * 8)
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

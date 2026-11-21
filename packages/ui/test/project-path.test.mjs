import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProjectPath } from '../dist/components/product/project-path.js'
import { projectPathParts } from '../dist/components/product/project-path-parts.js'

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

test('the full path remains available on hover and to screen readers', () => {
  const path = 'D:\\Projects\\Software\\weather-cli'
  const markup = renderToStaticMarkup(h(ProjectPath, { path }))
  assert.match(markup, /title="D:\\Projects\\Software\\weather-cli"/u)
  assert.match(markup, /class="sr-only">D:\\Projects\\Software\\weather-cli/u)
  assert.match(markup, /aria-hidden="true"/u)
  assert.match(markup, /-ml-0\.5/u)
  assert.match(markup, /class="shrink-0">\\weather-cli<\/span>/u)
})

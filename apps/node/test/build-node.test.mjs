import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createNodeBuildId,
  createSeaConfiguration,
  nodeArtifactName,
} from '../scripts/build-node.mjs'

test('Node artifact and build identity are deterministic and dirty-aware', () => {
  assert.equal(createNodeBuildId('0858fc77605263df', false), 'git-0858fc776052')
  assert.equal(
    createNodeBuildId('0858fc77605263df', true),
    'git-0858fc776052-dirty',
  )
  assert.equal(
    nodeArtifactName('win32', 'x64'),
    'codetether-node-win32-x64.exe',
  )
  assert.equal(
    nodeArtifactName('linux', 'arm64'),
    'codetether-node-linux-arm64',
  )
})

test('SEA configuration uses direct module build without runtime flags', () => {
  assert.deepEqual(createSeaConfiguration('/tmp/codetether-node'), {
    main: 'codetether-node.mjs',
    mainFormat: 'module',
    output: '/tmp/codetether-node',
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    execArgvExtension: 'none',
  })
})

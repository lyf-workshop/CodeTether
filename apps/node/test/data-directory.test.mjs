import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveNodeDataDirectory } from '../dist/data-directory.js'

test('platform state paths are deterministic and retain legacy identity', () => {
  const absent = () => false
  assert.equal(
    resolveNodeDataDirectory({
      platform: 'win32',
      home: 'C:\\Users\\Test 项目',
      exists: absent,
    }),
    'C:\\Users\\Test 项目\\.codetether-node',
  )
  assert.equal(
    resolveNodeDataDirectory({
      platform: 'darwin',
      home: '/Users/Test 项目',
      exists: absent,
    }),
    '/Users/Test 项目/Library/Application Support/CodeTether/Node/state',
  )
  assert.equal(
    resolveNodeDataDirectory({
      platform: 'linux',
      home: '/home/test',
      exists: absent,
    }),
    '/home/test/.local/share/codetether-node/state',
  )
  assert.equal(
    resolveNodeDataDirectory({
      platform: 'linux',
      home: '/home/test',
      exists: (path) => path.endsWith('.codetether-node'),
    }),
    '/home/test/.codetether-node',
  )
  assert.throws(
    () =>
      resolveNodeDataDirectory({
        platform: 'linux',
        home: '/home/test',
        exists: () => true,
      }),
    /Multiple/u,
  )
  assert.throws(() =>
    resolveNodeDataDirectory({
      platform: 'darwin',
      home: 'relative',
      exists: absent,
    }),
  )
})

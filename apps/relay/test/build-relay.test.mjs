import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createRelayBuildId,
  createSeaConfiguration,
  relayArtifactName,
} from '../scripts/build-relay.mjs'

test('Relay SEA identity and artifact names are deterministic and dirty-aware', () => {
  assert.equal(
    createRelayBuildId('cb2c412def819283\n', false),
    'git-cb2c412def81',
  )
  assert.equal(
    createRelayBuildId('cb2c412def819283\n', true),
    'git-cb2c412def81-dirty',
  )
  assert.equal(relayArtifactName('linux', 'x64'), 'codetether-relay-linux-x64')
  assert.equal(
    relayArtifactName('win32', 'x64'),
    'codetether-relay-win32-x64.exe',
  )
  assert.throws(() => relayArtifactName('../linux', 'x64'), /invalid/u)
})

test('Relay SEA config uses the official direct module build contract', () => {
  assert.deepEqual(createSeaConfiguration('/tmp/codetether-relay-linux-x64'), {
    main: 'codetether-relay.mjs',
    mainFormat: 'module',
    output: '/tmp/codetether-relay-linux-x64',
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    execArgvExtension: 'none',
  })
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  nodePairingStep,
  nodePairingCommands,
  nodePairingSearch,
} from '../.tmp/test-dist/components/machines/node-pairing-model.js'

test('URL step 3 or 4 cannot manufacture a candidate or completed pairing', () => {
  assert.equal(nodePairingStep(4, false, false), 2)
  assert.equal(nodePairingStep(3, false, false), 2)
  assert.equal(nodePairingStep(1, true, false), 3)
  assert.equal(nodePairingStep(1, false, true), 4)
})
test('route search accepts only presentation steps and never forwards code, target, identity', () => {
  assert.deepEqual(
    nodePairingSearch({
      step: '3',
      code: '123456',
      target: 'private',
      machineId: 'machine_fake',
    }),
    { step: 3 },
  )
  assert.deepEqual(nodePairingSearch({ step: 'anything' }), { step: 1 })
})
test('Linux instructions use installed binary and exact service state, not shell configuration', () => {
  const commands = nodePairingCommands('linux')
  assert.match(
    commands.pair,
    /--pair --data-dir "\$HOME\/\.local\/share\/codetether-node\/state"/u,
  )
  assert.match(commands.stop, /codetether-node" service stop$/u)
  assert.match(commands.start, /codetether-node" service start$/u)
  assert.doesNotMatch(
    Object.values(commands).join('\n'),
    /sudo|\.bashrc|\.zshrc|curl|rm /u,
  )
})
test('macOS command quotes space-containing installed path and never claims Windows Node support', () => {
  const commands = nodePairingCommands('macos')
  assert.match(
    commands.pair,
    /^"\$HOME\/Library\/Application Support\/CodeTether\/Node\/bin\/codetether-node" --pair/u,
  )
  assert.match(
    commands.pair,
    /--data-dir "\$HOME\/Library\/Application Support\/CodeTether\/Node\/state"$/u,
  )
  assert.doesNotMatch(commands.pair, /--bind 0\.0\.0\.0/u)
})

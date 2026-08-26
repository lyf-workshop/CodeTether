import assert from 'node:assert/strict'
import test from 'node:test'

import { JsonRpcLineDecoder } from '../dist/index.js'

test('frames partial and multiple newline-delimited messages', () => {
  const decoder = new JsonRpcLineDecoder()

  assert.deepEqual(decoder.push('{"id":1'), [])
  assert.deepEqual(
    decoder.push(',"result":{}}\r\n\n{"method":"first"}\n{"method"'),
    ['{"id":1,"result":{}}', '{"method":"first"}'],
  )
  assert.deepEqual(decoder.push(':"second"}'), [])
  assert.deepEqual(decoder.end(), ['{"method":"second"}'])
})

test('preserves a UTF-8 code point split across chunks', () => {
  const decoder = new JsonRpcLineDecoder()
  const line = '{"delta":"你好，Codex"}\n'
  const encoded = Buffer.from(line, 'utf8')
  const firstCharacter = Buffer.from('你', 'utf8')
  const characterOffset = encoded.indexOf(firstCharacter)

  assert.notEqual(characterOffset, -1)
  assert.deepEqual(decoder.push(encoded.subarray(0, characterOffset + 1)), [])
  assert.deepEqual(decoder.push(encoded.subarray(characterOffset + 1)), [
    '{"delta":"你好，Codex"}',
  ])
  assert.deepEqual(decoder.end(), [])
})

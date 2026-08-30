import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ClaudeCodeProtocolError,
  ClaudeJsonLineDecoder,
  ClaudeJsonLineTooLongError,
  parseClaudeJsonLine,
} from '../dist/index.js'

test('frames chunked UTF-8 JSONL and ignores blank lines', () => {
  const decoder = new ClaudeJsonLineDecoder()
  const input = Buffer.from('{"text":"你好"}\r\n\n{"done":true}\n', 'utf8')
  const split = input.indexOf(Buffer.from('你')) + 1

  assert.deepEqual(decoder.push(input.subarray(0, split)), [])
  assert.deepEqual(decoder.push(input.subarray(split)), [
    '{"text":"你好"}',
    '{"done":true}',
  ])
  assert.deepEqual(decoder.end(), [])
})

test('bounds provider JSONL lines', () => {
  const decoder = new ClaudeJsonLineDecoder(4)
  assert.throws(
    () => decoder.push('abcde\n'),
    (error) => {
      assert.ok(error instanceof ClaudeJsonLineTooLongError)
      assert.equal(error.maxLineBytes, 4)
      assert.equal(error.observedLineBytes, 5)
      return true
    },
  )
})

test('malformed input becomes a safe protocol error without raw content', () => {
  assert.throws(
    () => parseClaudeJsonLine('{private malformed payload'),
    (error) => {
      assert.ok(error instanceof ClaudeCodeProtocolError)
      assert.equal(error.code, 'provider_start_failed')
      assert.doesNotMatch(error.message, /private|payload/)
      return true
    },
  )
})

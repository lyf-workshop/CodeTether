import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_CONVERSATION_TITLE,
  generateConversationTitle,
  MAX_CONVERSATION_TITLE_GRAPHEMES,
} from '../dist/conversation-title.js'

test('generates one deterministic title from normalized opening text', () => {
  assert.equal(
    generateConversationTitle(
      '  请帮我实现   WebSocket 自动重连，并处理网络切换后的恢复逻辑。  ',
    ),
    '实现 WebSocket 自动重连',
  )
  assert.equal(
    generateConversationTitle('Inspect the workspace. Then summarize it.'),
    'Inspect the workspace',
  )
  assert.equal(generateConversationTitle('  \n\t '), DEFAULT_CONVERSATION_TITLE)
})

test('normalizes Unicode and truncates by grapheme without splitting clusters', () => {
  assert.equal(generateConversationTitle('Cafe\u0301 setup'), 'Café setup')

  const family = '👨‍👩‍👧‍👦'
  const title = generateConversationTitle(family.repeat(60))
  const graphemes = [
    ...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(title),
  ]
  assert.ok(graphemes.length <= MAX_CONVERSATION_TITLE_GRAPHEMES)
  assert.ok(title.length <= 240)
  assert.equal(graphemes.at(-1).segment, '…')
  assert.equal(graphemes.at(-2).segment, family)
})

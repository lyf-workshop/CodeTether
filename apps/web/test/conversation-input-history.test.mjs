import assert from 'node:assert/strict'
import test from 'node:test'
import { loadWebComponent } from './fixtures/render-ui.mjs'

const { previousUserInput } = loadWebComponent(
  'components/conversation/conversation-input-history.ts',
)

test('Ctrl+Up history uses the latest user Turn input, never an agent reply', () => {
  assert.equal(
    previousUserInput({
      blocks: [
        {
          kind: 'message',
          message: { author: 'user', body: 'first' },
        },
        {
          kind: 'agent-run',
          message: { author: 'agent', body: 'answer' },
        },
        {
          kind: 'message',
          message: { author: 'user', body: 'latest' },
        },
      ],
    }),
    'latest',
  )
})

test('imported native history is available when no CodeTether Turn exists', () => {
  assert.equal(
    previousUserInput({
      blocks: [],
      nativeHistory: {
        entries: [
          { role: 'user', kind: 'message', content: 'native prompt' },
          { role: 'assistant', kind: 'message', content: 'native response' },
        ],
      },
    }),
    'native prompt',
  )
  assert.equal(previousUserInput({ blocks: [] }), undefined)
})

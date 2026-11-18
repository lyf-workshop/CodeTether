import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CodexEventNormalizer } from '../../../packages/adapter-codex/dist/index.js'
import { executionFailurePresentation } from '../.tmp/test-dist/failures/failure-presentation.js'
import { loadWebComponent } from './fixtures/render-ui.mjs'

const { ConversationFailureCard } = loadWebComponent(
  'components/conversation/conversation-failure-card.tsx',
)

test('the exact App Server model rejection exposes a model-control action without replay', () => {
  const result = new CodexEventNormalizer().normalize(
    {
      method: 'turn/completed',
      params: {
        threadId: 'thread-fixture',
        turn: {
          id: 'turn-fixture',
          status: 'failed',
          error: {
            codexErrorInfo: 'other',
            message: JSON.stringify({
              type: 'error',
              status: 400,
              error: {
                type: 'invalid_request_error',
                code: 'model_not_found',
                message: 'private upstream details',
              },
            }),
          },
        },
      },
    },
    '2026-11-18T12:00:00.000Z',
  )
  const failure = executionFailurePresentation(result.events[0].error)
  assert.equal(failure.modelUnavailable, true)
  assert.equal(failure.canStartNewTurn, false)
  const html = renderToStaticMarkup(
    h(ConversationFailureCard, {
      failure,
      turnId: 'turn-fixture',
      onOpenModelControl() {},
    }),
  )
  assert.match(html, /选择可用模型/u)
  assert.doesNotMatch(html, /private upstream details|明确重试为新轮次/u)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { CodeTetherResponseError } from '@codetether/client'
import * as reactQuery from '@tanstack/react-query'
import { createDom, h } from './fixtures/dom.mjs'
import { loadWebComponent } from './fixtures/render-ui.mjs'

const conversationId = 'conv_b3a_send'
const occurredAt = '2026-11-18T01:00:00.000Z'
const input = '请检查项目中的测试'
const failure = {
  reason: 'provider_start_failed',
  retryability: 'retry_now',
  userAction: 'retry',
  occurredAt,
}

function responseError(value) {
  return new CodeTetherResponseError(503, {
    code: 'provider_start_failed',
    message: 'Safe public failure',
    failure: value,
  })
}

async function fixture(t, history = []) {
  const client = new reactQuery.QueryClient()
  const dom = await createDom()
  t.after(async () => {
    await dom.close()
    client.clear()
  })
  const { Composer } = loadWebComponent('components/conversation/composer.tsx')
  const { ConversationTimeline } = loadWebComponent(
    'components/conversation/conversation-timeline.tsx',
  )
  const { LiveConversationActions } = loadWebComponent(
    'runtime/host/live-conversation-actions.ts',
  )
  const starts = []
  let nextAction = 0
  const actions = new LiveConversationActions(
    {
      startTurn(id, request) {
        const start = { id, request, ...Promise.withResolvers() }
        starts.push(start)
        return start.promise
      },
    },
    () => `act_b3a_${++nextAction}`,
  )
  const runtime = {
    startTurn: actions.startTurn.bind(actions),
    startNewTurn: actions.startNewTurn.bind(actions),
  }
  const { useLiveConversationControls } = loadWebComponent(
    'components/conversation/use-live-conversation-controls.ts',
    new Map([
      ['@tanstack/react-query', reactQuery],
      [
        '../../runtime/host/host-runtime-hooks.js',
        {
          useHostRuntime: () => runtime,
          useHostConnectionState: () => 'connected',
        },
      ],
    ]),
  )
  const formId = 'b3a-send'
  function Conversation({ turns, composerKey }) {
    const messages = turns.map((turn) => ({
      id: `message-${turn.id}`,
      author: 'user',
      body: input,
      turnId: turn.id,
    }))
    const currentTurn = turns.at(-1)
    const capabilities = {
      canCompose: currentTurn?.status !== 'running',
      supportsApprovals: false,
      supportsInterrupt: false,
      canInterrupt: false,
    }
    const controls = useLiveConversationControls(
      {
        id: conversationId,
        provider: 'codex',
        turns,
        messages,
        currentTurn,
        pendingApprovals: [],
      },
      capabilities,
      undefined,
    )
    return h(
      'div',
      null,
      h(ConversationTimeline, {
        agent: 'codex',
        timeline: {
          dayLabel: '今天',
          blocks: messages.map((message) => ({
            id: message.id,
            kind: 'message',
            turnId: message.turnId,
            message: { ...message, time: '19:00' },
          })),
        },
        changes: { files: [] },
        pendingApprovals: [],
        optimisticSend: controls.composer.optimisticSend,
        composerFormId: formId,
        canRetrySend:
          capabilities.canCompose && controls.composer.state === 'idle',
      }),
      h(Composer, {
        key: composerKey,
        conversationId,
        formId,
        capabilities,
        controller: controls.composer,
      }),
    )
  }
  const { container } = dom
  const editor = () => container.querySelector('textarea')
  const send = () => container.querySelector('button[aria-label="发送消息"]')
  const retry = () => container.querySelector('button[data-retry-action]')
  const row = (state) => container.querySelector(`[data-send-state="${state}"]`)
  const userRows = () =>
    container.querySelectorAll('article[aria-label^="你在 "]')
  const project = (turns, composerKey = 'initial') =>
    dom.render(
      h(
        reactQuery.QueryClientProvider,
        { client },
        h(Conversation, { turns, composerKey }),
      ),
    )
  await project(history)
  await dom.input(editor(), input)
  await dom.perform(() => send().click())
  await dom.until(() => row('sending') !== null)
  return { ...dom, starts, editor, send, retry, row, userRows, project }
}

test('optimistic row is immediate, pairs with a projected failure, and explicit retry submits a fresh action', async (t) => {
  const historical = { id: 'turn_older', status: 'completed' }
  const view = await fixture(t, [historical])
  assert.equal(view.starts.length, 1)
  assert.equal(view.userRows().length, 2)
  assert.equal(view.editor().value, '')
  assert.equal(view.editor().readOnly, true)
  assert.equal(view.send().disabled, true)
  assert.doesNotMatch(view.container.textContent, /正在发送消息/u)

  const failed = {
    id: 'turn_failed',
    status: 'failed',
    error: { failure },
  }
  await view.project([historical, failed])
  assert.equal(view.userRows().length, 2)
  await view.perform(() => view.starts[0].reject(responseError(failure)))
  await view.until(() => view.retry() !== null)
  assert.equal(view.userRows().length, 2)
  assert.match(view.row('failed').textContent, /未发送/u)
  assert.match(view.container.textContent, /CodeTether 未能安全启动/u)
  assert.equal(view.editor().value, input)
  assert.equal(view.starts.length, 1)

  await view.perform(() => view.retry().click())
  await view.until(() => view.starts.length === 2)
  assert.notEqual(
    view.starts[1].request.actionId,
    view.starts[0].request.actionId,
  )
  assert.equal(view.starts[1].request.input.text, input)
  await view.until(() => view.row('sending') !== null)
  const accepted = { id: 'turn_accepted', status: 'running' }
  await view.project([historical, failed, accepted])
  assert.equal(view.userRows().length, 3)
  await view.perform(() =>
    view.starts[1].resolve({ data: { turn: { turnId: accepted.id } } }),
  )
  await view.until(
    () => view.row('sending') === null && view.editor().value === '',
  )
  assert.equal(view.userRows().length, 3)
})

test('accepted optimistic send stays visible until the exact canonical Turn arrives', async (t) => {
  const view = await fixture(t)
  const initialEditor = view.editor()
  await view.project([], 'reopened')
  assert.notEqual(view.editor(), initialEditor)
  await view.perform(() =>
    view.starts[0].resolve({ data: { turn: { turnId: 'turn_exact' } } }),
  )
  await view.until(
    () =>
      view.row('sending') === null &&
      view.userRows().length === 1 &&
      view.editor().value === '',
  )
  assert.equal(view.editor().readOnly, true)
  const other = { id: 'turn_other', status: 'completed' }
  await view.project([other], 'reopened')
  assert.equal(view.userRows().length, 2)
  await view.project(
    [other, { id: 'turn_exact', status: 'completed' }],
    'reopened',
  )
  assert.equal(view.userRows().length, 2)
  await view.until(() => !view.editor().readOnly)
  assert.equal(view.editor().value, '')
  assert.equal(view.retry(), null)
})

test('uncertain start keeps the draft without an inline or implicit retry', async (t) => {
  const view = await fixture(t)
  await view.perform(() =>
    view.starts[0].reject(
      responseError({
        ...failure,
        reason: 'execution_ownership_uncertain',
        retryability: 'not_retryable',
        userAction: 'view_details',
      }),
    ),
  )
  await view.until(() => view.row('uncertain') !== null)
  assert.equal(view.retry(), null)
  assert.equal(view.editor().value, input)
  assert.equal(view.editor().readOnly, false)
  assert.equal(view.send().disabled, true)
  assert.equal(view.starts.length, 1)
})

test('retrying after clearing the draft restores the prompt if admission fails again', async (t) => {
  const view = await fixture(t)
  await view.perform(() => view.starts[0].reject(responseError(failure)))
  await view.until(() => view.retry() !== null)
  await view.input(view.editor(), '')
  assert.equal(view.editor().value, '')
  await view.perform(() => view.retry().click())
  await view.until(() => view.row('sending') !== null)
  assert.notEqual(
    view.starts[1].request.actionId,
    view.starts[0].request.actionId,
  )
  await view.perform(() => view.starts[1].reject(responseError(failure)))
  await view.until(() => view.retry() !== null)
  assert.equal(view.editor().value, input)
  assert.equal(view.userRows().length, 1)
})

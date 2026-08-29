import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

import {
  createTimelineAnchorRequestKey,
  timelineContainsTurn,
} from '../.tmp/test-dist/components/conversation/conversation-timeline-behavior.js'

const webSource = resolve(import.meta.dirname, '../src')

test('Conversation search accepts only a public Turn identity', async () => {
  const router = await sourceOf('router.tsx')

  assert.match(router, /TurnIdSchema\.safeParse\(search\.turn\)/u)
  assert.match(router, /turn\.success \? \{ turn: turn\.data \} : \{\}/u)
  assert.match(
    router,
    /remountDeps: \(\{ params \}\) => params\.conversationId/u,
  )
})

test('Inbox review and failed navigation preserve the Attention Turn anchor', async () => {
  const [page, item, actions] = await Promise.all([
    sourceOf('components/inbox/inbox-page.tsx'),
    sourceOf('components/inbox/inbox-item.tsx'),
    sourceOf('components/inbox/inbox-actions.ts'),
  ])

  assert.match(
    page,
    /search: turnId === undefined \? \{\} : \{ turn: turnId \}/u,
  )
  assert.match(
    item,
    /item\.turnId === undefined \? \{\} : \{ turn: item\.turnId \}/u,
  )
  assert.match(actions, /await navigate\(item\.conversationId, item\.turnId\)/u)
})

test('Notification click keeps the optional public Turn identity end to end', async () => {
  const [model, adapter, main] = await Promise.all([
    sourceOf('runtime/notifications/desktop-notification-model.ts'),
    sourceOf('runtime/native/native-capabilities.ts'),
    sourceOf('main.tsx'),
  ])

  assert.match(model, /readonly turnId\?: TurnId/u)
  assert.match(adapter, /TurnIdSchema\.parse\(record\.turnId\)/u)
  assert.match(
    main,
    /intent\.turnId === undefined \? \{\} : \{ turn: intent\.turnId \}/u,
  )
  assert.match(
    main,
    /hash: `notification-\$\{notificationNavigationSequence\}`/u,
  )
})

test('Timeline exposes focusable Turn and Diff anchors without changing durable data', async () => {
  const [timeline, inspector] = await Promise.all([
    sourceOf('components/conversation/conversation-timeline.tsx'),
    sourceOf('components/conversation/inspector-panel.tsx'),
  ])

  assert.match(timeline, /data-turn-anchor/u)
  assert.match(timeline, /data-change-anchor/u)
  assert.match(
    timeline,
    /data-change-anchor=\{change\.id\}[\s\S]*?role="group"[\s\S]*?aria-label=\{`变更详情：/u,
  )
  assert.match(
    timeline,
    /'data-turn-anchor': block\.turnId,[\s\S]*?role: 'group',[\s\S]*?'aria-label': `会话轮次：/u,
  )
  assert.match(timeline, /target\.focus\(\{ preventScroll: true \}\)/u)
  assert.match(timeline, /该轮次不在当前保留的历史中/u)
  assert.match(timeline, /targetChangeRequestKey/u)
  assert.match(
    inspector,
    /selectedChangeId === change\.id \? 'location' : undefined/u,
  )
  assert.doesNotMatch(
    inspector,
    /aria-pressed=\{selectedChangeId === change\.id\}/u,
  )
  assert.match(inspector, /onChangeSelect\?\.\(change\.id\)/u)
})

test('repeat Turn and Diff navigation creates a fresh focus request', () => {
  const turn = createTimelineAnchorRequestKey('turn_123456', 'history-a')
  assert.equal(turn, 'history-a:turn_123456')
  assert.notEqual(
    turn,
    createTimelineAnchorRequestKey('turn_123456', 'history-b'),
  )

  const firstChange = createTimelineAnchorRequestKey('change-1', 1)
  const repeatedChange = createTimelineAnchorRequestKey('change-1', 2)
  assert.notEqual(firstChange, repeatedChange)
})

test('missing retained Turn targets are detected without loading older history', () => {
  const blocks = [{ turnId: 'turn_123456' }, { turnId: 'turn_654321' }]
  assert.equal(timelineContainsTurn(blocks, 'turn_123456'), true)
  assert.equal(timelineContainsTurn(blocks, 'turn_older001'), false)
  assert.equal(timelineContainsTurn(blocks, undefined), true)
})

async function sourceOf(relativePath) {
  return await readFile(resolve(webSource, relativePath), 'utf8')
}

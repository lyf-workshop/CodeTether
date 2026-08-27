import assert from 'node:assert/strict'
import test from 'node:test'

import {
  decideTimelineScroll,
  getApprovalFocusTarget,
} from '../.tmp/test-dist/components/conversation/conversation-timeline-behavior.js'

test('Approval appearance preserves an upper reading position', () => {
  const decision = decideTimelineScroll({
    followsLatest: false,
    update: 'approval',
    waiting: true,
    viewport: viewport(240, 600, 1800),
  })

  assert.deepEqual(decision, {
    followsLatest: false,
    showJumpToLatest: true,
  })
})

test('Approval appearance and resolution keep a bottom reader anchored', () => {
  for (const waiting of [true, false]) {
    assert.deepEqual(
      decideTimelineScroll({
        followsLatest: true,
        update: 'approval',
        waiting,
        viewport: viewport(900, 600, 1620),
      }),
      {
        followsLatest: true,
        showJumpToLatest: false,
        scrollTop: 1620,
      },
    )
  }
})

test('Dock resize re-anchors only a reader who was following the bottom', () => {
  assert.equal(
    decideTimelineScroll({
      followsLatest: true,
      update: 'viewport-resize',
      waiting: true,
      viewport: viewport(900, 420, 1500),
    }).scrollTop,
    1500,
  )
  assert.deepEqual(
    decideTimelineScroll({
      followsLatest: false,
      update: 'viewport-resize',
      waiting: false,
      viewport: viewport(240, 700, 1500),
    }),
    { followsLatest: false, showJumpToLatest: true },
  )
})

test('waiting deltas preserve an upper reader and keep a bottom reader anchored', () => {
  assert.deepEqual(
    decideTimelineScroll({
      followsLatest: false,
      update: 'content',
      waiting: true,
      viewport: viewport(240, 500, 1000),
    }),
    { followsLatest: false, showJumpToLatest: true },
  )
  assert.equal(
    decideTimelineScroll({
      followsLatest: true,
      update: 'content',
      waiting: true,
      viewport: viewport(480, 500, 1000),
    }).scrollTop,
    1000,
  )
})

test('ordinary streaming follows the bottom only while still anchored', () => {
  assert.equal(
    decideTimelineScroll({
      followsLatest: true,
      update: 'content',
      waiting: false,
      viewport: viewport(500, 500, 1080),
    }).scrollTop,
    1080,
  )
  assert.equal(
    decideTimelineScroll({
      followsLatest: false,
      update: 'content',
      waiting: false,
      viewport: viewport(200, 500, 1080),
    }).scrollTop,
    undefined,
  )
})

test('first Approval takes focus only when Composer was active', () => {
  const base = {
    previousApprovalIds: [],
    nextApprovalIds: ['approval_1'],
    composerEditable: false,
  }
  assert.deepEqual(
    getApprovalFocusTarget({ ...base, active: { kind: 'composer' } }),
    { kind: 'approval', approvalId: 'approval_1' },
  )
  assert.equal(
    getApprovalFocusTarget({ ...base, active: { kind: 'other' } }),
    undefined,
  )
  assert.equal(
    getApprovalFocusTarget({
      ...base,
      previousApprovalIds: ['approval_existing'],
      active: { kind: 'composer' },
    }),
    undefined,
  )
})

test('resolved Approval focus advances only from its originating control', () => {
  const transition = {
    previousApprovalIds: ['approval_1', 'approval_2', 'approval_3'],
    nextApprovalIds: ['approval_1', 'approval_3'],
    active: { kind: 'approval', approvalId: 'approval_2' },
    composerEditable: false,
  }
  assert.deepEqual(
    getApprovalFocusTarget({
      ...transition,
      resolutionOriginApprovalId: 'approval_2',
    }),
    { kind: 'approval', approvalId: 'approval_3' },
  )
  assert.equal(getApprovalFocusTarget(transition), undefined)
  assert.equal(
    getApprovalFocusTarget({
      ...transition,
      active: { kind: 'other' },
      resolutionOriginApprovalId: 'approval_2',
    }),
    undefined,
  )
})

test('last Approval returns focus to an editable Composer or Timeline', () => {
  const transition = {
    previousApprovalIds: ['approval_1'],
    nextApprovalIds: [],
    active: { kind: 'approval', approvalId: 'approval_1' },
    resolutionOriginApprovalId: 'approval_1',
  }
  assert.deepEqual(
    getApprovalFocusTarget({ ...transition, composerEditable: true }),
    { kind: 'composer' },
  )
  assert.deepEqual(
    getApprovalFocusTarget({ ...transition, composerEditable: false }),
    { kind: 'timeline' },
  )
})

function viewport(scrollTop, clientHeight, scrollHeight) {
  return { scrollTop, clientHeight, scrollHeight }
}

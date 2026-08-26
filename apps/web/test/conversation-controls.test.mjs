import assert from 'node:assert/strict'
import test from 'node:test'

import {
  deriveComposerControlState,
  deriveLiveControlAvailability,
  draftAfterSubmit,
  isComposerEditableState,
  isNearTimelineBottom,
  shouldSubmitComposerKey,
} from '../.tmp/test-dist/components/conversation/conversation-controls.js'

const capabilities = {
  codex: true,
  approvals: true,
  interrupt: true,
  resume: true,
  diff: true,
  streaming: true,
}

test('Enter submits while Shift+Enter and IME composition remain text input', () => {
  assert.equal(
    shouldSubmitComposerKey({
      key: 'Enter',
      shiftKey: false,
      isComposing: false,
    }),
    true,
  )
  assert.equal(
    shouldSubmitComposerKey({
      key: 'Enter',
      shiftKey: true,
      isComposing: false,
    }),
    false,
  )
  assert.equal(
    shouldSubmitComposerKey({
      key: 'Enter',
      shiftKey: false,
      isComposing: true,
    }),
    false,
  )
  assert.equal(
    shouldSubmitComposerKey({
      key: 'Enter',
      shiftKey: false,
      isComposing: false,
      keyCode: 229,
    }),
    false,
  )
  assert.equal(
    shouldSubmitComposerKey({
      key: 'a',
      shiftKey: false,
      isComposing: false,
    }),
    false,
  )
})

test('draft clears only after an accepted matching submission', () => {
  assert.equal(draftAfterSubmit('hello', 'hello', true), '')
  assert.equal(draftAfterSubmit('hello', 'hello', false), 'hello')
  assert.equal(draftAfterSubmit('edited', 'hello', true), 'edited')
})

test('capabilities, connection and active Turn jointly gate controls', () => {
  assert.deepEqual(
    deriveLiveControlAvailability('connected', capabilities, 'completed'),
    {
      canCompose: true,
      canInterrupt: false,
      canStop: false,
      canResolveApproval: true,
    },
  )
  assert.deepEqual(
    deriveLiveControlAvailability('connected', capabilities, 'running'),
    {
      canCompose: false,
      canInterrupt: true,
      canStop: false,
      canResolveApproval: true,
    },
  )
  assert.deepEqual(
    deriveLiveControlAvailability('reconnecting', capabilities, 'running'),
    {
      canCompose: false,
      canInterrupt: false,
      canStop: false,
      canResolveApproval: false,
    },
  )
  assert.equal(
    deriveLiveControlAvailability(
      'connected',
      { ...capabilities, interrupt: false },
      'running',
    ).canInterrupt,
    false,
  )
})

test('HTTP awaiting, active, approval and interrupted states remain distinct', () => {
  assert.equal(
    deriveComposerControlState('connected', 'awaiting-event', undefined, 0),
    'submitting',
  )
  assert.equal(
    deriveComposerControlState('connected', 'idle', 'running', 0),
    'running',
  )
  assert.equal(
    deriveComposerControlState('connected', 'idle', 'running', 2),
    'waiting',
  )
  assert.equal(
    deriveComposerControlState('connected', 'idle', 'interrupted', 0),
    'interrupted',
  )
  assert.equal(
    deriveComposerControlState('unavailable', 'idle', 'completed', 0),
    'unavailable',
  )
})

test('an interrupted Turn re-enables Composer editing', () => {
  assert.equal(isComposerEditableState('idle'), true)
  assert.equal(isComposerEditableState('interrupted'), true)
  assert.equal(isComposerEditableState('submitting'), false)
  assert.equal(isComposerEditableState('running'), false)
  assert.equal(isComposerEditableState('waiting'), false)
  assert.equal(isComposerEditableState('unavailable'), false)
})

test('timeline follows only while its viewport remains near the bottom', () => {
  assert.equal(isNearTimelineBottom(452, 500, 1000), true)
  assert.equal(isNearTimelineBottom(400, 500, 1000), false)
  assert.equal(isNearTimelineBottom(0, 500, 400), true)
})

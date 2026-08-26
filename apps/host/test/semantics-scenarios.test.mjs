import assert from 'node:assert/strict'
import test from 'node:test'

import { requireBoundCommandApprovalResolution } from '../dist/semantics-scenarios.js'

const identity = {
  threadId: 'thread-1',
  turnId: 'turn-1',
  itemId: 'command-1',
  approvalId: 'approval-1',
}

function resolution(overrides = {}) {
  return {
    method: 'item/commandExecution/requestApproval',
    requestId: 7,
    identity,
    paramsShape: ['approvalId', 'itemId', 'threadId', 'turnId'],
    decision: 'allow',
    response: { result: { decision: 'accept' } },
    ...overrides,
  }
}

test('approval evidence binds request, item, decision, and response to the turn', () => {
  const evidence = resolution()

  assert.equal(
    requireBoundCommandApprovalResolution([evidence], {
      threadId: 'thread-1',
      turnId: 'turn-1',
    }),
    evidence,
  )
})

test('approval evidence is required for the current thread and turn', () => {
  assert.throws(
    () =>
      requireBoundCommandApprovalResolution([], {
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
    /observed no command approval bound/,
  )
  assert.throws(
    () =>
      requireBoundCommandApprovalResolution(
        [resolution({ identity: { ...identity, turnId: 'turn-other' } })],
        { threadId: 'thread-1', turnId: 'turn-1' },
      ),
    /observed no command approval bound/,
  )
})

test('approval evidence requires item identity and matching modern wire decision', () => {
  assert.throws(
    () =>
      requireBoundCommandApprovalResolution(
        [resolution({ identity: { ...identity, itemId: null } })],
        { threadId: 'thread-1', turnId: 'turn-1' },
      ),
    /no bound command item identity/,
  )
  assert.throws(
    () =>
      requireBoundCommandApprovalResolution(
        [resolution({ response: { result: { decision: 'decline' } } })],
        { threadId: 'thread-1', turnId: 'turn-1' },
      ),
    /unexpected wire decision/,
  )
})

test('approval evidence preserves request identity when no provider approval id exists', () => {
  const withoutProviderApprovalId = resolution({
    identity: { ...identity, approvalId: '7' },
    paramsShape: ['itemId', 'threadId', 'turnId'],
  })
  assert.equal(
    requireBoundCommandApprovalResolution([withoutProviderApprovalId], {
      threadId: 'thread-1',
      turnId: 'turn-1',
    }),
    withoutProviderApprovalId,
  )
  assert.throws(
    () =>
      requireBoundCommandApprovalResolution(
        [
          resolution({
            identity: { ...identity, approvalId: 'wrong-request' },
            paramsShape: ['itemId', 'threadId', 'turnId'],
          }),
        ],
        { threadId: 'thread-1', turnId: 'turn-1' },
      ),
    /did not preserve JSON-RPC request identity/,
  )
})

test('legacy command denial recognizes the provider wire shape', () => {
  const evidence = resolution({
    method: 'execCommandApproval',
    decision: 'deny',
    response: {
      result: { decision: { denied: { rejection: 'Denied by user' } } },
    },
  })

  assert.equal(
    requireBoundCommandApprovalResolution([evidence], {
      threadId: 'thread-1',
      turnId: 'turn-1',
    }),
    evidence,
  )
})

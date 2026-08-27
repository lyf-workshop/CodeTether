import assert from 'node:assert/strict'
import test from 'node:test'

import { CodeTetherResponseError } from '@codetether/client'

import {
  AttentionActions,
  attentionErrorMessage,
} from '../.tmp/test-dist/runtime/host/attention-actions.js'
import { HostEpochChangedError } from '../.tmp/test-dist/runtime/host/live-conversation-actions.js'

const firstEpoch = '11111111-1111-4111-8111-111111111111'
const secondEpoch = '22222222-2222-4222-8222-222222222222'

test('same-Item double submit shares one action while different Items resolve in parallel', async () => {
  const first = createDeferred()
  const second = createDeferred()
  const calls = []
  const client = {
    resolveAttention(attentionId, actionId) {
      calls.push({ attentionId, actionId })
      return attentionId === 'attn_review001' ? first.promise : second.promise
    },
  }
  const actions = new AttentionActions(client, idFactory())
  actions.adoptHostEpoch(firstEpoch)

  const firstAttempt = actions.resolveAttention('attn_review001')
  const duplicate = actions.resolveAttention('attn_review001')
  const parallel = actions.resolveAttention('attn_failed001')

  assert.strictEqual(duplicate, firstAttempt)
  assert.equal(calls.length, 2)
  assert.deepEqual(calls, [
    {
      attentionId: 'attn_review001',
      actionId: 'act_attention_001',
    },
    {
      attentionId: 'attn_failed001',
      actionId: 'act_attention_002',
    },
  ])

  first.resolve(resolvedResponse(calls[0].actionId, calls[0].attentionId))
  second.resolve(resolvedResponse(calls[1].actionId, calls[1].attentionId))
  await Promise.all([firstAttempt, duplicate, parallel])
})

test('an ambiguous same-epoch retry reuses its actionId', async () => {
  const calls = []
  const client = {
    async resolveAttention(attentionId, actionId) {
      calls.push({ attentionId, actionId })
      if (calls.length === 1) throw new TypeError('response lost')
      return resolvedResponse(actionId, attentionId)
    },
  }
  const actions = new AttentionActions(client, idFactory())
  actions.adoptHostEpoch(firstEpoch)

  await assert.rejects(actions.resolveAttention('attn_review001'), TypeError)
  await actions.resolveAttention('attn_review001')

  assert.equal(calls.length, 2)
  assert.equal(calls[0].actionId, calls[1].actionId)
})

test('a definitive Host error consumes the actionId before an explicit retry', async () => {
  const calls = []
  const client = {
    async resolveAttention(attentionId, actionId) {
      calls.push({ attentionId, actionId })
      if (calls.length === 1) {
        throw responseError(actionId, 'conflict', 'private Host diagnostics')
      }
      return resolvedResponse(actionId, attentionId)
    },
  }
  const actions = new AttentionActions(client, idFactory())
  actions.adoptHostEpoch(firstEpoch)

  await assert.rejects(
    actions.resolveAttention('attn_review001'),
    CodeTetherResponseError,
  )
  await actions.resolveAttention('attn_review001')

  assert.equal(calls.length, 2)
  assert.notEqual(calls[0].actionId, calls[1].actionId)
  assert.equal(
    attentionErrorMessage(
      responseError(calls[0].actionId, 'conflict', 'private Host diagnostics'),
    ).includes('private'),
    false,
  )
})

test('a new Host epoch rejects pending work and starts a fresh action identity', async () => {
  const pending = createDeferred()
  const calls = []
  const client = {
    resolveAttention(attentionId, actionId) {
      calls.push({ attentionId, actionId })
      return calls.length === 1
        ? pending.promise
        : Promise.resolve(resolvedResponse(actionId, attentionId))
    },
  }
  const actions = new AttentionActions(client, idFactory())
  actions.adoptHostEpoch(firstEpoch)

  const firstAttempt = actions.resolveAttention('attn_review001')
  actions.adoptHostEpoch(secondEpoch)

  await assert.rejects(
    firstAttempt,
    (error) => error instanceof HostEpochChangedError,
  )
  await actions.resolveAttention('attn_review001')

  assert.equal(calls.length, 2)
  assert.notEqual(calls[0].actionId, calls[1].actionId)
  pending.resolve(resolvedResponse(calls[0].actionId, calls[0].attentionId))
})

function resolvedResponse(actionId, attentionId) {
  const timestamp = '2026-08-27T12:00:00.000Z'
  return {
    protocolVersion: 1,
    actionId,
    status: 'completed',
    data: {
      attention: {
        attentionId,
        projectId: 'proj_attention01',
        conversationId: 'conv_attention01',
        turnId: 'turn_attention01',
        type: 'completed_review',
        status: 'resolved',
        createdAt: timestamp,
        updatedAt: timestamp,
        resolvedAt: timestamp,
        payload: { conversationTitle: 'Review the completed work' },
      },
    },
  }
}

function responseError(actionId, code, message) {
  return new CodeTetherResponseError(409, {
    protocolVersion: 1,
    actionId,
    code,
    message,
  })
}

function idFactory() {
  let index = 0
  return () => `act_attention_${String(++index).padStart(3, '0')}`
}

function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

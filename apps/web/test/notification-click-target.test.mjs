import assert from 'node:assert/strict'
import test from 'node:test'
import { QueryClient } from '@tanstack/react-query'
import { loadWebComponent } from './fixtures/render-ui.mjs'

const { resolveNotificationClickTarget } = loadWebComponent(
  'runtime/notifications/attention-notification-metadata.ts',
)
const attentionId = 'attn_link_target01'
const target = Object.freeze({
  attentionId,
  projectId: 'proj_link_target01',
  conversationId: 'conv_link_target01',
  turnId: 'turn_link_target01',
})

function fixture(read) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const calls = []
  const runtime = new Proxy(
    {
      listAttention: async (options) => {
        calls.push({ status: options.status, limit: options.limit })
        assert.ok(options.signal instanceof AbortSignal)
        return await read(options)
      },
    },
    {
      get(object, property) {
        assert.equal(
          property,
          'listAttention',
          'Only the cold list may be read',
        )
        return object[property]
      },
    },
  )
  const controller = new AbortController()
  return {
    calls,
    controller,
    queryClient,
    resolve: (id = attentionId) =>
      resolveNotificationClickTarget(
        queryClient,
        runtime,
        id,
        controller.signal,
      ),
  }
}

test('the exact ID is resolved from each supported status, without mutating any item', async () => {
  for (const matchingStatus of ['open', 'resolved', 'expired']) {
    const original = Object.freeze({
      ...target,
      status: matchingStatus,
      payload: Object.freeze({ conversationTitle: 'Not a navigation field' }),
    })
    const found = Object.freeze({ items: Object.freeze([original]) })
    const empty = Object.freeze({ items: Object.freeze([]) })
    const fx = fixture(async ({ status }) =>
      status === matchingStatus ? found : empty,
    )
    try {
      assert.deepEqual(await fx.resolve(), target)
      assert.deepEqual(
        fx.calls,
        ['open', 'resolved', 'expired']
          .slice(0, ['open', 'resolved', 'expired'].indexOf(matchingStatus) + 1)
          .map((status) => ({ status, limit: 100 })),
      )
      assert.equal(original.status, matchingStatus)
      assert.strictEqual(found.items[0], original)
      assert.deepEqual(
        Object.keys(await fx.resolve()).sort(),
        Object.keys(target).sort(),
      )
    } finally {
      fx.queryClient.clear()
    }
  }
})

test('a missing ID reads at most three bounded lists and cannot invent a target', async () => {
  const fx = fixture(async ({ status }) => ({
    items: Array.from({ length: 100 }, (_, index) => ({
      ...target,
      attentionId: `attn_other_${status}_${index}`,
      status,
    })),
  }))
  try {
    assert.equal(await fx.resolve(), undefined)
    assert.deepEqual(fx.calls, [
      { status: 'open', limit: 100 },
      { status: 'resolved', limit: 100 },
      { status: 'expired', limit: 100 },
    ])
  } finally {
    fx.queryClient.clear()
  }
})

test('a click after restart does not reuse a stale link index', async () => {
  const fx = fixture(async () => ({ items: [target] }))
  fx.queryClient.setQueryData(
    ['host', 'attention', 'notification-link', 'open'],
    { items: [] },
    { updatedAt: 1 },
  )
  try {
    assert.deepEqual(await fx.resolve(), target)
    assert.deepEqual(fx.calls, [{ status: 'open', limit: 100 }])
  } finally {
    fx.queryClient.clear()
  }
})

test('invalid IDs and an already aborted lookup never read the Host', async () => {
  const fx = fixture(() =>
    assert.fail('Invalid or aborted lookup must not read'),
  )
  try {
    for (const id of [
      'attn_x',
      'ATTN_target01',
      'attn_bad%20id',
      'attn_' + 'x'.repeat(97),
    ]) {
      await assert.rejects(fx.resolve(id))
    }
    fx.controller.abort()
    assert.equal(await fx.resolve(), undefined)
    assert.deepEqual(fx.calls, [])
  } finally {
    fx.queryClient.clear()
  }
})

test('an abort during a read never reads the next status or returns stale navigation', async () => {
  let complete
  const pending = new Promise((resolve) => {
    complete = resolve
  })
  let observedSignal
  const fx = fixture(async ({ signal }) => {
    observedSignal = signal
    return await pending
  })
  try {
    const request = fx.resolve()
    await Promise.resolve()
    fx.controller.abort()
    assert.equal(observedSignal.aborted, true)
    complete({ items: [target] })
    assert.equal(await request, undefined)
    assert.deepEqual(fx.calls, [{ status: 'open', limit: 100 }])
  } finally {
    fx.queryClient.clear()
  }
})

test('a failed metadata read is not retried and never falls through to another state', async () => {
  const fx = fixture(async () => {
    throw new Error('Host unavailable')
  })
  try {
    await assert.rejects(fx.resolve(), /Host unavailable/u)
    assert.deepEqual(fx.calls, [{ status: 'open', limit: 100 }])
  } finally {
    fx.queryClient.clear()
  }
})

test('duplicate exact IDs fail closed, and a no-turn Attention does not invent a turn', async () => {
  const duplicate = fixture(async () => ({ items: [target, target] }))
  try {
    assert.equal(await duplicate.resolve(), undefined)
    assert.equal(duplicate.calls.length, 1)
  } finally {
    duplicate.queryClient.clear()
  }
  const noTurn = { ...target }
  delete noTurn.turnId
  const fx = fixture(async () => ({ items: [noTurn] }))
  try {
    assert.deepEqual(await fx.resolve(), noTurn)
    assert.equal('turnId' in (await fx.resolve()), false)
  } finally {
    fx.queryClient.clear()
  }
})

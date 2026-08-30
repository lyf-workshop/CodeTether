import assert from 'node:assert/strict'
import test from 'node:test'

import { onlineManager } from '@tanstack/react-query'

import { createHostQueryClient } from '../.tmp/test-dist/runtime/host/host-query-client.js'

test('loopback Host queries and mutations do not pause with internet offline', async (t) => {
  const queryClient = createHostQueryClient()
  t.after(() => {
    queryClient.clear()
    onlineManager.setOnline(true)
  })
  onlineManager.setOnline(false)

  let queryCalls = 0
  const query = queryClient.fetchQuery({
    queryKey: ['host', 'offline-loopback'],
    queryFn: async () => {
      queryCalls += 1
      return 'local durable state'
    },
  })
  let mutationCalls = 0
  const mutation = queryClient.getMutationCache().build(queryClient, {
    mutationFn: async () => {
      mutationCalls += 1
      return 'local mutation accepted'
    },
  })

  assert.equal(await query, 'local durable state')
  assert.equal(await mutation.execute(), 'local mutation accepted')
  assert.equal(queryCalls, 1)
  assert.equal(mutationCalls, 1)

  onlineManager.setOnline(true)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(queryCalls, 1)
  assert.equal(mutationCalls, 1)
})

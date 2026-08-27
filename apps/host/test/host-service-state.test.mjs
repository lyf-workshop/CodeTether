import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_PROVIDER_ITEMS_PER_TURN,
  ProviderItemCapacityError,
  publicItemId,
} from '../dist/api/host-service-state.js'

test('bounds provider Item identities for one active Turn', () => {
  const turn = { providerItems: new Map() }
  let first
  for (let index = 0; index < MAX_PROVIDER_ITEMS_PER_TURN; index += 1) {
    const item = publicItemId(turn, `provider-item-${String(index)}`)
    if (index === 0) first = item
  }

  assert.equal(turn.providerItems.size, MAX_PROVIDER_ITEMS_PER_TURN)
  assert.equal(publicItemId(turn, 'provider-item-0'), first)
  assert.throws(
    () => publicItemId(turn, 'provider-item-overflow'),
    (error) => {
      assert.ok(error instanceof ProviderItemCapacityError)
      assert.equal(error.maxItems, MAX_PROVIDER_ITEMS_PER_TURN)
      return true
    },
  )
})

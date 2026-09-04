import assert from 'node:assert/strict'
import test from 'node:test'

import {
  RelayMachineConnectivitySchema,
  RemoteMachineConnectionSchema,
} from '../dist/index.js'

const endpoint = {
  host: 'relay.example.com',
  port: 443,
  transportSecurity: 'public_ca',
}
const directEndpoint = { host: 'node.lan', port: 4317 }
const relayIdentityFingerprint = 'R'.repeat(43)

test('remote Machine connection keeps direct truth separate from effective execution transport', () => {
  assert.deepEqual(
    RemoteMachineConnectionSchema.parse({
      state: 'online',
      directState: 'offline',
      executionTransport: 'relay',
    }),
    {
      state: 'online',
      directState: 'offline',
      executionTransport: 'relay',
    },
  )
  assert.deepEqual(
    RemoteMachineConnectionSchema.parse({
      state: 'online',
      directState: 'online',
      executionTransport: 'direct',
      currentEndpoint: directEndpoint,
    }),
    {
      state: 'online',
      directState: 'online',
      executionTransport: 'direct',
      currentEndpoint: directEndpoint,
    },
  )
  assert.deepEqual(
    RemoteMachineConnectionSchema.parse({
      state: 'offline',
      directState: 'offline',
      executionTransport: 'unavailable',
    }),
    {
      state: 'offline',
      directState: 'offline',
      executionTransport: 'unavailable',
    },
  )
})

test('remote Machine execution transport contradictions and untrusted fields fail closed', () => {
  for (const connection of [
    {
      state: 'offline',
      directState: 'offline',
      executionTransport: 'relay',
    },
    {
      state: 'online',
      directState: 'offline',
      executionTransport: 'unavailable',
    },
    {
      state: 'online',
      directState: 'online',
      executionTransport: 'direct',
    },
    {
      state: 'online',
      directState: 'offline',
      executionTransport: 'automatic',
    },
    {
      state: 'online',
      directState: 'offline',
      executionTransport: 'relay',
      targetHost: '127.0.0.1',
    },
  ]) {
    assert.equal(
      RemoteMachineConnectionSchema.safeParse(connection).success,
      false,
    )
  }
})

test('Relay presence alone never claims Internet execution eligibility', () => {
  const connectedPresence = {
    state: 'connected',
    enrollment: 'enrolled',
    nodePresence: 'online',
    internetExecutionEnabled: false,
    endpoint,
    relayIdentityFingerprint,
  }
  assert.deepEqual(
    RelayMachineConnectivitySchema.parse(connectedPresence),
    connectedPresence,
  )
  assert.equal(
    RelayMachineConnectivitySchema.safeParse({
      ...connectedPresence,
      internetExecutionEnabled: true,
    }).success,
    true,
  )

  for (const blocked of [
    { state: 'offline', enrollment: 'enrolled', nodePresence: 'offline' },
    {
      state: 'connected',
      enrollment: 'enrolled',
      nodePresence: 'offline',
    },
    {
      state: 'enrollment_required',
      enrollment: 'required',
      nodePresence: 'not_observed',
    },
  ]) {
    assert.equal(
      RelayMachineConnectivitySchema.safeParse({
        ...blocked,
        internetExecutionEnabled: true,
        endpoint,
        relayIdentityFingerprint,
      }).success,
      false,
    )
  }
})

test('Relay execution eligibility remains bounded and accepts only Relay-sourced diagnostics', () => {
  const base = {
    state: 'offline',
    enrollment: 'enrolled',
    nodePresence: 'offline',
    internetExecutionEnabled: false,
    endpoint,
    relayIdentityFingerprint,
  }
  assert.equal(
    RelayMachineConnectivitySchema.safeParse({
      ...base,
      failure: relayFailure('relay_peer_offline'),
    }).success,
    true,
  )
  assert.equal(
    RelayMachineConnectivitySchema.safeParse({
      ...base,
      failure: { ...relayFailure('relay_peer_offline'), source: 'transport' },
    }).success,
    false,
  )
  assert.equal(
    RelayMachineConnectivitySchema.safeParse({
      ...base,
      rawSocketError: 'ECONNRESET <script>steal()</script>',
    }).success,
    false,
  )
})

function relayFailure(reason) {
  return {
    category: 'transport',
    reason,
    retryability: 'retry_later',
    userAction: 'wait',
    source: 'relay',
    occurredAt: '2026-09-03T12:00:00.000Z',
    technicalCode: reason,
  }
}

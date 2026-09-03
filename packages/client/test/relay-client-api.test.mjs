import assert from 'node:assert/strict'
import test from 'node:test'

import { CodeTetherClient, CodeTetherProtocolError } from '../dist/index.js'

const machineId = 'machine_relayclient01'
const relayIdentityFingerprint = 'r'.repeat(43)
const enrollmentToken = `relay_enroll_${'t'.repeat(43)}`

test('typed Client routes Relay control mutations only through Host', async () => {
  const calls = []
  const operations = [
    {
      method: 'PUT',
      suffix: '',
      actionId: 'act_relayconfigure01',
      request: {
        actionId: 'act_relayconfigure01',
        endpoint: {
          host: '39.104.94.53',
          port: 443,
          transportSecurity: 'pinned_identity',
        },
        relayIdentityFingerprint,
        displayLabel: 'Owner Relay',
      },
      call: (client, signal) =>
        client.configureMachineRelay(
          machineId,
          {
            actionId: 'act_relayconfigure01',
            endpoint: {
              host: '39.104.94.53',
              port: 443,
              transportSecurity: 'pinned_identity',
            },
            relayIdentityFingerprint,
            displayLabel: 'Owner Relay',
          },
          { signal },
        ),
      relay: relayStatus('enrollment_required', 'required'),
    },
    {
      method: 'POST',
      suffix: '/enroll',
      actionId: 'act_relayenroll01',
      request: {
        actionId: 'act_relayenroll01',
        enrollmentToken,
      },
      call: (client, signal) =>
        client.enrollMachineRelay(
          machineId,
          { actionId: 'act_relayenroll01', enrollmentToken },
          { signal },
        ),
      relay: relayStatus('connected', 'enrolled'),
    },
    {
      method: 'POST',
      suffix: '/retry',
      actionId: 'act_relayretry01',
      request: { actionId: 'act_relayretry01' },
      call: (client, signal) =>
        client.retryMachineRelay(
          machineId,
          { actionId: 'act_relayretry01' },
          { signal },
        ),
      relay: relayStatus('reconnecting', 'enrolled'),
    },
    {
      method: 'POST',
      suffix: '/disconnect',
      actionId: 'act_relaydisconnect01',
      request: { actionId: 'act_relaydisconnect01' },
      call: (client, signal) =>
        client.disconnectMachineRelay(
          machineId,
          { actionId: 'act_relaydisconnect01' },
          { signal },
        ),
      relay: relayStatus('offline', 'enrolled'),
    },
    {
      method: 'DELETE',
      suffix: '',
      actionId: 'act_relayremove01',
      request: { actionId: 'act_relayremove01' },
      call: (client, signal) =>
        client.removeMachineRelay(
          machineId,
          { actionId: 'act_relayremove01' },
          { signal },
        ),
      relay: {
        state: 'not_configured',
        enrollment: 'not_configured',
        nodePresence: 'not_observed',
        internetExecutionEnabled: false,
      },
    },
  ]
  const responses = operations.map((operation) => ({
    protocolVersion: 1,
    actionId: operation.actionId,
    status: operation.suffix === '/retry' ? 'accepted' : 'completed',
    data: { machineId, relay: operation.relay },
  }))
  const controller = new AbortController()
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async (input, init) => {
      calls.push({ url: String(input), init })
      return jsonResponse(responses.shift())
    },
  })

  for (const operation of operations) {
    await operation.call(client, controller.signal)
  }

  assert.deepEqual(
    calls.map(({ url, init }) => ({
      url: new URL(url),
      method: init.method,
      body: JSON.parse(init.body),
      signal: init.signal,
    })),
    operations.map((operation) => ({
      url: new URL(
        `/api/v1/machines/${machineId}/relay${operation.suffix}`,
        'http://host.test',
      ),
      method: operation.method,
      body: operation.request,
      signal: controller.signal,
    })),
  )
})

test('typed Client rejects Relay mutation identity confusion and arbitrary inputs', async () => {
  const client = new CodeTetherClient({
    baseUrl: 'http://host.test',
    fetch: async () =>
      jsonResponse({
        protocolVersion: 1,
        actionId: 'act_relayretry01',
        status: 'accepted',
        data: {
          machineId: 'machine_otherrelay01',
          relay: relayStatus('reconnecting', 'enrolled'),
        },
      }),
  })

  await assert.rejects(
    client.retryMachineRelay(machineId, {
      actionId: 'act_relayretry01',
    }),
    CodeTetherProtocolError,
  )
  await assert.rejects(
    client.configureMachineRelay(machineId, {
      actionId: 'act_relayconfigure02',
      endpoint: {
        host: '39.104.94.53',
        port: 443,
        transportSecurity: 'pinned_identity',
      },
      relayIdentityFingerprint,
      prompt: 'forbidden',
    }),
    CodeTetherProtocolError,
  )
})

function relayStatus(state, enrollment) {
  return {
    state,
    enrollment,
    nodePresence: state === 'connected' ? 'online' : 'not_observed',
    internetExecutionEnabled: false,
    endpoint: {
      host: '39.104.94.53',
      port: 443,
      transportSecurity: 'pinned_identity',
    },
    relayIdentityFingerprint,
    displayLabel: 'Owner Relay',
  }
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

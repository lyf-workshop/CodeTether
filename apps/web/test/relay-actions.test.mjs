import assert from 'node:assert/strict'
import test from 'node:test'

import { QueryClient } from '@tanstack/react-query'

import {
  RelayActions,
  RelayMutationBusyError,
  relayErrorMessage,
} from '../.tmp/test-dist/runtime/host/relay-actions.js'
import { machineQueryKeys } from '../.tmp/test-dist/runtime/host/machine-query.js'

const machineId = 'machine_remote01'
const fingerprint = 'A'.repeat(43)
const enrollmentToken = `relay_enroll_${'B'.repeat(43)}`

test('Relay actions use typed Host mutations and update only durable Machine read caches', async () => {
  const calls = []
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData(machineQueryKeys.detail(machineId), machineDetail())
  queryClient.setQueryData(['host', 'conversations'], ['preserved'])
  const actions = new RelayActions(
    relayClient(calls),
    queryClient,
    actionIdFactory(),
  )

  await actions.configure(machineId, {
    endpoint: {
      host: 'relay.example.com',
      port: 443,
      transportSecurity: 'public_ca',
    },
    relayIdentityFingerprint: fingerprint,
    displayLabel: 'Owner Relay',
  })
  assert.equal(
    queryClient.getQueryData(machineQueryKeys.detail(machineId)).relay.state,
    'enrollment_required',
  )

  await actions.enroll(machineId, enrollmentToken)
  assert.equal(
    queryClient.getQueryData(machineQueryKeys.detail(machineId)).relay.state,
    'connected',
  )
  assert.doesNotMatch(
    JSON.stringify(queryClient.getQueryCache().getAll()),
    /relay_enroll_/u,
  )
  assert.deepEqual(queryClient.getQueryData(['host', 'conversations']), [
    'preserved',
  ])

  await actions.disconnect(machineId)
  await actions.retry(machineId)
  await actions.remove(machineId)

  assert.deepEqual(
    calls.map((call) => call.operation),
    ['configure', 'enroll', 'disconnect', 'retry', 'remove'],
  )
  assert.deepEqual(
    calls.map((call) => call.request.actionId),
    ['act_relay01', 'act_relay02', 'act_relay03', 'act_relay04', 'act_relay05'],
  )
  assert.equal(
    queryClient.getQueryData(machineQueryKeys.detail(machineId)).relay.state,
    'not_configured',
  )
})

test('Relay mutation ownership deduplicates matching actions and rejects conflicting actions', async () => {
  const pending = Promise.withResolvers()
  let retries = 0
  const actions = new RelayActions(
    {
      retryMachineRelay() {
        retries += 1
        return pending.promise
      },
    },
    new QueryClient(),
    actionIdFactory(),
  )

  const first = actions.retry(machineId)
  const duplicate = actions.retry(machineId)
  assert.equal(first, duplicate)
  assert.equal(retries, 1)
  await assert.rejects(actions.disconnect(machineId), RelayMutationBusyError)

  pending.resolve(response('act_relay01', connectedRelay()))
  await first
})

test('Relay errors map only bounded canonical error codes to controlled product copy', () => {
  assert.equal(
    relayErrorMessage(new Error('ECONNRESET Authorization: secret')),
    'Internet Relay 暂时无法连接。局域网直连不受影响。',
  )
  assert.doesNotMatch(
    relayErrorMessage(new Error('ECONNRESET Authorization: secret')),
    /ECONNRESET|Authorization|secret/u,
  )
})

function relayClient(calls) {
  return {
    async configureMachineRelay(receivedMachineId, request) {
      calls.push({ operation: 'configure', receivedMachineId, request })
      return response(request.actionId, requiredRelay())
    },
    async enrollMachineRelay(receivedMachineId, request) {
      calls.push({ operation: 'enroll', receivedMachineId, request })
      return response(request.actionId, connectedRelay())
    },
    async retryMachineRelay(receivedMachineId, request) {
      calls.push({ operation: 'retry', receivedMachineId, request })
      return response(request.actionId, connectedRelay())
    },
    async disconnectMachineRelay(receivedMachineId, request) {
      calls.push({ operation: 'disconnect', receivedMachineId, request })
      return response(request.actionId, {
        ...connectedRelay(),
        state: 'offline',
        nodePresence: 'not_observed',
      })
    },
    async removeMachineRelay(receivedMachineId, request) {
      calls.push({ operation: 'remove', receivedMachineId, request })
      return response(request.actionId, {
        state: 'not_configured',
        enrollment: 'not_configured',
        nodePresence: 'not_observed',
        internetExecutionEnabled: false,
      })
    },
  }
}

function response(actionId, relay) {
  return {
    protocolVersion: 1,
    actionId,
    status: 'completed',
    data: { machineId, relay },
  }
}

function requiredRelay() {
  return {
    ...relayBase(),
    state: 'enrollment_required',
    enrollment: 'required',
  }
}

function connectedRelay() {
  return {
    ...relayBase(),
    state: 'connected',
    enrollment: 'enrolled',
    nodePresence: 'online',
  }
}

function relayBase() {
  return {
    endpoint: {
      host: 'relay.example.com',
      port: 443,
      transportSecurity: 'public_ca',
    },
    relayIdentityFingerprint: fingerprint,
    displayLabel: 'Owner Relay',
    nodePresence: 'not_observed',
    internetExecutionEnabled: false,
  }
}

function machineDetail() {
  return {
    protocolVersion: 1,
    machine: { machineId, kind: 'remote' },
    providers: [],
    projects: [],
    conversations: [],
  }
}

function actionIdFactory() {
  let sequence = 0
  return () => `act_relay0${(sequence += 1)}`
}

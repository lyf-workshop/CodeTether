import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ConfigureMachineRelayRequestSchema,
  EnrollMachineRelayRequestSchema,
  GetMachineResponseSchema,
  RelayEnrollmentTokenSchema,
  RelayMachineConnectivitySchema,
} from '../dist/index.js'

const endpoint = {
  host: '39.104.94.53',
  port: 443,
  transportSecurity: 'pinned_identity',
}
const relayIdentityFingerprint = 'r'.repeat(43)

test('Relay product status is bounded, provider-neutral, and never execution-capable', () => {
  assert.deepEqual(
    RelayMachineConnectivitySchema.parse({
      state: 'connected',
      enrollment: 'enrolled',
      nodePresence: 'online',
      internetExecutionEnabled: false,
      endpoint,
      relayIdentityFingerprint,
      displayLabel: 'Owner Relay',
      lastConnectedAt: '2026-09-03T12:00:00.000Z',
    }),
    {
      state: 'connected',
      enrollment: 'enrolled',
      nodePresence: 'online',
      internetExecutionEnabled: false,
      endpoint,
      relayIdentityFingerprint,
      displayLabel: 'Owner Relay',
      lastConnectedAt: '2026-09-03T12:00:00.000Z',
    },
  )
  assert.equal(
    RelayMachineConnectivitySchema.safeParse({
      state: 'connected',
      enrollment: 'enrolled',
      nodePresence: 'online',
      internetExecutionEnabled: true,
      endpoint,
      relayIdentityFingerprint,
    }).success,
    false,
  )
  assert.equal(
    RelayMachineConnectivitySchema.safeParse({
      state: 'offline',
      enrollment: 'required',
      nodePresence: 'offline',
      internetExecutionEnabled: false,
      endpoint,
      relayIdentityFingerprint,
      failure: canonicalRelayFailure('relay_unreachable'),
    }).success,
    true,
  )
})

test('Relay configuration and one-time enrollment inputs reject extra payload fields', () => {
  const configuration = {
    actionId: 'act_relayconfigure01',
    endpoint,
    relayIdentityFingerprint,
    displayLabel: 'Owner Relay',
  }
  assert.equal(
    ConfigureMachineRelayRequestSchema.safeParse(configuration).success,
    true,
  )
  for (const forbidden of [
    ['prompt', 'do work'],
    ['providerCommand', 'codex'],
    ['conversationEvent', {}],
    ['toolEvent', {}],
    ['filesystemOperation', {}],
    ['shellCommand', 'whoami'],
    ['payload', Buffer.from('opaque')],
  ]) {
    assert.equal(
      ConfigureMachineRelayRequestSchema.safeParse({
        ...configuration,
        [forbidden[0]]: forbidden[1],
      }).success,
      false,
      `configuration must reject ${forbidden[0]}`,
    )
  }

  const token = `relay_enroll_${'t'.repeat(43)}`
  assert.equal(RelayEnrollmentTokenSchema.safeParse(token).success, true)
  assert.equal(
    EnrollMachineRelayRequestSchema.safeParse({
      actionId: 'act_relayenroll01',
      enrollmentToken: token,
    }).success,
    true,
  )
  assert.equal(RelayEnrollmentTokenSchema.safeParse(`${token}x`).success, false)
  assert.equal(
    EnrollMachineRelayRequestSchema.safeParse({
      actionId: 'act_relayenroll01',
      enrollmentToken: token,
      arbitraryPayload: 'forbidden',
    }).success,
    false,
  )
})

test('Machine detail exposes Relay control state only for remote Machines', () => {
  const local = machineFixture('local')
  assert.equal(
    GetMachineResponseSchema.safeParse({
      protocolVersion: 1,
      machine: local,
      providers: [],
      projects: [],
      conversations: [],
      relay: {
        state: 'not_configured',
        enrollment: 'not_configured',
        nodePresence: 'not_observed',
        internetExecutionEnabled: false,
      },
    }).success,
    false,
  )

  const remote = machineFixture('remote')
  assert.equal(
    GetMachineResponseSchema.safeParse({
      protocolVersion: 1,
      machine: remote,
      providers: [],
      projects: [],
      conversations: [],
      connection: { state: 'offline' },
      providerDiscovery: { state: 'not_observed' },
      relay: {
        state: 'not_configured',
        enrollment: 'not_configured',
        nodePresence: 'not_observed',
        internetExecutionEnabled: false,
      },
    }).success,
    true,
  )
})

function canonicalRelayFailure(reason) {
  const profiles = {
    relay_unreachable: {
      category: 'transport',
      retryability: 'retry_later',
      userAction: 'wait',
    },
  }
  return {
    ...profiles[reason],
    reason,
    source: 'relay',
    occurredAt: '2026-09-03T12:00:00.000Z',
    technicalCode: reason,
  }
}

function machineFixture(kind) {
  return {
    machineId: `machine_relay${kind}01`,
    displayName: `${kind} fixture`,
    kind,
    platform: kind === 'local' ? 'Windows' : 'Linux',
    architecture: 'x64',
    availability: kind === 'local' ? 'available' : 'unavailable',
    connectionState: kind === 'local' ? 'local' : 'offline',
    trustState: kind === 'local' ? 'local' : 'trusted',
    isLocal: kind === 'local',
    createdAt: '2026-09-03T12:00:00.000Z',
    capabilities: {
      projectAccess: true,
      providerExecution: kind === 'local',
      backgroundRuntime: true,
      nativeFolderPicker: kind === 'local',
      notifications: kind === 'local',
    },
  }
}

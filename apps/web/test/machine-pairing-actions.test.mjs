import assert from 'node:assert/strict'
import test from 'node:test'

import { CodeTetherResponseError } from '@codetether/client'
import { QueryClient } from '@tanstack/react-query'

import {
  MachineActions,
  MachineMutationBusyError,
  machineErrorMessage,
  normalizePairingCodeInput,
  parseRemoteMachineAddressInput,
} from '../.tmp/test-dist/runtime/host/machine-actions.js'
import { machineQueryKeys } from '../.tmp/test-dist/runtime/host/machine-query.js'

const timestamp = '2026-08-30T12:00:00.000Z'
const pairingAttemptId = 'pairing_attempt01'

test('pairing input accepts bounded host/port forms and normalizes only the visual code field', () => {
  assert.deepEqual(parseRemoteMachineAddressInput('node.lan:4318'), {
    host: 'node.lan',
    port: 4318,
  })
  assert.deepEqual(parseRemoteMachineAddressInput('192.168.1.42:65535'), {
    host: '192.168.1.42',
    port: 65_535,
  })
  assert.deepEqual(parseRemoteMachineAddressInput('[fd00::1]:4318'), {
    host: 'fd00::1',
    port: 4318,
  })
  assert.equal(
    parseRemoteMachineAddressInput('https://node.lan:4318'),
    undefined,
  )
  assert.equal(parseRemoteMachineAddressInput('node.lan'), undefined)
  assert.equal(parseRemoteMachineAddressInput('node.lan:0'), undefined)
  assert.equal(parseRemoteMachineAddressInput('fe80::1:4318'), undefined)
  assert.equal(parseRemoteMachineAddressInput('[fe80::1]:4318'), undefined)
  assert.equal(parseRemoteMachineAddressInput('[fd00::1:4318'), undefined)

  assert.equal(normalizePairingCodeInput('４８２ ７３１'), '482731')
  assert.equal(normalizePairingCodeInput('482-731-999'), '482731')
})

test('Machine actions keep pairing preview ephemeral and accept only Host-confirmed Machine truth', async () => {
  const calls = []
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData(machineQueryKeys.list, [localMachine()])
  const actions = new MachineActions(
    mutationClient(calls),
    queryClient,
    actionIdFactory(),
  )

  const begin = await actions.beginRemoteMachinePairing(
    { host: 'node.lan', port: 4318 },
    '482731',
  )
  assert.equal(begin.data.candidate.pairingAttemptId, pairingAttemptId)
  assert.deepEqual(calls[0], {
    operation: 'begin',
    request: {
      actionId: 'act_machine01',
      address: { host: 'node.lan', port: 4318 },
      pairingCode: '482731',
    },
  })
  assert.doesNotMatch(
    JSON.stringify(queryClient.getQueryCache().getAll()),
    /482731|pairing_attempt01/u,
  )

  await actions.confirmRemoteMachinePairing(pairingAttemptId)
  assert.deepEqual(
    queryClient
      .getQueryData(machineQueryKeys.list)
      .map((machine) => machine.machineId),
    ['machine_local01', 'machine_remote01'],
  )

  await actions.retryMachineConnection('machine_remote01')
  await actions.updateMachineConnectionAddress('machine_remote01', {
    host: '192.168.1.43',
    port: 4318,
  })
  await actions.unpairMachine('machine_remote01')
  assert.deepEqual(
    queryClient
      .getQueryData(machineQueryKeys.list)
      .map((machine) => machine.machineId),
    ['machine_local01'],
  )
  assert.deepEqual(
    calls.map((call) => call.operation),
    ['begin', 'confirm', 'retry', 'update-address', 'unpair'],
  )
})

test('connection retry dedupes per Machine and excludes a concurrent address mutation', async () => {
  const pending = Promise.withResolvers()
  let calls = 0
  const actions = new MachineActions(
    {
      retryMachineConnection() {
        calls += 1
        return pending.promise
      },
      updateMachineConnectionAddress() {
        assert.fail('address mutation must not race the active retry')
      },
    },
    new QueryClient(),
    () => 'act_machine01',
  )

  const first = actions.retryMachineConnection('machine_remote01')
  const duplicate = actions.retryMachineConnection('machine_remote01')
  assert.equal(first, duplicate)
  assert.equal(calls, 1)
  await assert.rejects(
    actions.updateMachineConnectionAddress('machine_remote01', {
      host: 'node-new.lan',
      port: 4318,
    }),
    MachineMutationBusyError,
  )
  pending.resolve(connectionResponse('act_machine01'))
  await first
})

test('address candidates remain out of Machine caches until authenticated success', async () => {
  const pending = Promise.withResolvers()
  const queryClient = new QueryClient()
  queryClient.setQueryData(machineQueryKeys.list, [remoteMachine()])
  const actions = new MachineActions(
    {
      updateMachineConnectionAddress(_machineId, request) {
        assert.deepEqual(request.address, {
          host: 'node-new.lan',
          port: 4318,
        })
        return pending.promise
      },
    },
    queryClient,
    () => 'act_machine01',
  )

  const update = actions.updateMachineConnectionAddress('machine_remote01', {
    host: 'node-new.lan',
    port: 4318,
  })
  assert.doesNotMatch(
    JSON.stringify(queryClient.getQueryData(machineQueryKeys.list)),
    /node-new\.lan/u,
  )
  pending.resolve(
    connectionResponse('act_machine01', {
      host: 'node-new.lan',
      port: 4318,
    }),
  )
  await update
  assert.equal(
    queryClient.getQueryData(machineQueryKeys.list)[0].connectionState,
    'online',
  )
})

test('duplicate pairing submission shares one request while different input fails closed', async () => {
  const pending = Promise.withResolvers()
  let calls = 0
  const actions = new MachineActions(
    {
      beginRemoteMachinePairing() {
        calls += 1
        return pending.promise
      },
    },
    new QueryClient(),
    () => 'act_machine01',
  )

  const first = actions.beginRemoteMachinePairing(
    { host: 'node.lan', port: 4318 },
    '482731',
  )
  const duplicate = actions.beginRemoteMachinePairing(
    { host: 'node.lan', port: 4318 },
    '482731',
  )
  assert.equal(first, duplicate)
  assert.equal(calls, 1)
  await assert.rejects(
    actions.beginRemoteMachinePairing(
      { host: 'other.lan', port: 4318 },
      '482731',
    ),
    MachineMutationBusyError,
  )
  pending.resolve(beginResponse())
  await first
})

test('Machine errors expose stable actionable copy instead of transport diagnostics', () => {
  const error = (code) =>
    new CodeTetherResponseError(400, {
      protocolVersion: 1,
      code,
      message: 'private transport diagnostic',
    })

  assert.equal(
    machineErrorMessage(error('machine_pairing_code_invalid'), 'begin'),
    '配对码无效，请检查远程节点显示的六码。',
  )
  assert.equal(
    machineErrorMessage(error('machine_pairing_code_expired'), 'confirm'),
    '配对码已过期，请在远程节点重新开启配对。',
  )
  assert.equal(
    machineErrorMessage(error('machine_authentication_failed'), 'confirm'),
    '无法验证这台机器的身份。',
  )
  assert.equal(
    machineErrorMessage(error('machine_identity_mismatch'), 'update-address'),
    '该地址指向另一台机器；CodeTether 已拒绝连接，原信任关系未更改。',
  )
  assert.equal(
    machineErrorMessage(error('machine_protocol_incompatible'), 'begin'),
    '远程节点版本不兼容，请更新 CodeTether Node。',
  )
  assert.doesNotMatch(
    machineErrorMessage(error('machine_connection_failed'), 'confirm'),
    /private transport diagnostic/u,
  )
})

function mutationClient(calls) {
  return {
    async beginRemoteMachinePairing(request) {
      calls.push({ operation: 'begin', request })
      return beginResponse(request.actionId)
    },
    async confirmRemoteMachinePairing(attempt, request) {
      calls.push({ operation: 'confirm', attempt, request })
      return {
        protocolVersion: 1,
        actionId: request.actionId,
        status: 'completed',
        data: { machine: remoteMachine() },
      }
    },
    async cancelRemoteMachinePairing(attempt, request) {
      calls.push({ operation: 'cancel', attempt, request })
      return {
        protocolVersion: 1,
        actionId: request.actionId,
        status: 'completed',
        data: { pairingAttemptId: attempt },
      }
    },
    async unpairMachine(machineId, request) {
      calls.push({ operation: 'unpair', machineId, request })
      return {
        protocolVersion: 1,
        actionId: request.actionId,
        status: 'completed',
        data: { machineId },
      }
    },
    async retryMachineConnection(machineId, request) {
      calls.push({ operation: 'retry', machineId, request })
      return connectionResponse(request.actionId)
    },
    async updateMachineConnectionAddress(machineId, request) {
      calls.push({ operation: 'update-address', machineId, request })
      return connectionResponse(request.actionId, request.address)
    },
  }
}

function connectionResponse(
  actionId = 'act_machine01',
  currentEndpoint = { host: 'node.lan', port: 4318 },
) {
  return {
    protocolVersion: 1,
    actionId,
    status: 'completed',
    data: {
      machine: remoteMachine(),
      connection: {
        state: 'online',
        currentEndpoint,
        lastSuccessfulAt: timestamp,
        lastAttemptAt: timestamp,
      },
    },
  }
}

function beginResponse(actionId = 'act_machine01') {
  return {
    protocolVersion: 1,
    actionId,
    status: 'completed',
    data: {
      candidate: {
        pairingAttemptId,
        machineId: 'machine_remote01',
        displayName: '开发服务器',
        platform: 'linux',
        architecture: 'x86_64',
        address: { host: 'node.lan', port: 4318 },
        protocolVersion: 1,
        expiresAt: timestamp,
        verificationCode: '182 503',
      },
    },
  }
}

function localMachine() {
  return {
    machineId: 'machine_local01',
    displayName: '本地电脑',
    kind: 'local',
    platform: 'windows',
    architecture: 'x86_64',
    availability: 'available',
    connectionState: 'local',
    trustState: 'local',
    isLocal: true,
    createdAt: timestamp,
    lastSeenAt: timestamp,
    capabilities: machineCapabilities(true),
  }
}

function remoteMachine() {
  return {
    machineId: 'machine_remote01',
    displayName: '开发服务器',
    kind: 'remote',
    platform: 'linux',
    architecture: 'x86_64',
    availability: 'available',
    connectionState: 'online',
    trustState: 'trusted',
    isLocal: false,
    createdAt: timestamp,
    lastSeenAt: timestamp,
    capabilities: machineCapabilities(false),
  }
}

function machineCapabilities(enabled) {
  return {
    projectAccess: enabled,
    providerExecution: enabled,
    backgroundRuntime: enabled,
    nativeFolderPicker: enabled,
    notifications: enabled,
  }
}

function actionIdFactory() {
  let sequence = 0
  return () => `act_machine0${(sequence += 1)}`
}

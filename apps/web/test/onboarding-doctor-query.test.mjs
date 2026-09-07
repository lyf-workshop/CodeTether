import assert from 'node:assert/strict'
import test from 'node:test'

import { QueryClient } from '@tanstack/react-query'

import {
  OnboardingActions,
  onboardingQueryKeys,
  onboardingQueryOptions,
} from '../.tmp/test-dist/runtime/host/onboarding-query.js'
import {
  doctorQueryKeys,
  doctorQueryOptions,
} from '../.tmp/test-dist/runtime/host/doctor-query.js'

const observedAt = '2026-09-07T12:00:00.000Z'

test('onboarding progress query is a bounded explicit read and forwards cancellation', async () => {
  const calls = []
  const progress = onboardingProgress('provider_check', 2)
  const client = {
    async getOnboarding(options) {
      calls.push(options)
      return { protocolVersion: 1, onboarding: progress }
    },
  }
  const queryClient = createQueryClient()

  const result = await queryClient.fetchQuery(onboardingQueryOptions(client))

  assert.strictEqual(result, progress)
  assert.deepEqual(onboardingQueryKeys.progress, [
    'host',
    'onboarding',
    'progress',
  ])
  assert.equal(calls.length, 1)
  assert.ok(calls[0].signal instanceof AbortSignal)
})

test('duplicate onboarding transitions share one action and update only authoritative Host progress', async () => {
  const pending = Promise.withResolvers()
  const calls = []
  const queryClient = createQueryClient()
  const actions = new OnboardingActions(
    {
      updateOnboarding(request, options) {
        calls.push({ request, options })
        return pending.promise
      },
    },
    queryClient,
    actionIdFactory(),
  )
  const transition = {
    kind: 'project_selected',
    projectId: 'proj_onboarding01',
    machineId: 'machine_onboarding01',
  }

  const first = actions.update(2, transition)
  const duplicate = actions.update(2, structuredClone(transition))

  assert.strictEqual(first, duplicate)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].request, {
    actionId: 'act_onboarding01',
    expectedRevision: 2,
    transition,
  })

  const next = onboardingProgress('previous_conversations', 3, {
    projectId: transition.projectId,
    machineId: transition.machineId,
  })
  pending.resolve({
    protocolVersion: 1,
    actionId: 'act_onboarding01',
    status: 'completed',
    data: { onboarding: next, changed: true },
  })
  const response = await first

  assert.strictEqual(response.data.onboarding, next)
  assert.strictEqual(
    queryClient.getQueryData(onboardingQueryKeys.progress),
    next,
  )
})

test('a settled onboarding transition releases its coalescing slot for an explicit later action', async () => {
  const calls = []
  const actions = new OnboardingActions(
    {
      async updateOnboarding(request) {
        calls.push(request)
        return {
          protocolVersion: 1,
          actionId: request.actionId,
          status: 'completed',
          data: {
            onboarding: onboardingProgress('computer_check', calls.length + 1),
            changed: true,
          },
        }
      },
    },
    createQueryClient(),
    actionIdFactory(),
  )

  await actions.update(1, { kind: 'continue' })
  await actions.update(2, { kind: 'continue' })

  assert.deepEqual(
    calls.map(({ actionId, expectedRevision }) => [actionId, expectedRevision]),
    [
      ['act_onboarding01', 1],
      ['act_onboarding02', 2],
    ],
  )
})

test('Doctor queries isolate global and Project context and forward cancellation', async () => {
  const calls = []
  const report = doctorReport()
  const client = {
    async getDoctor(options) {
      calls.push(options)
      return { protocolVersion: 1, doctor: report }
    },
  }
  const queryClient = createQueryClient()

  const global = await queryClient.fetchQuery(doctorQueryOptions(client))
  const project = await queryClient.fetchQuery(
    doctorQueryOptions(client, 'proj_onboarding01'),
  )

  assert.strictEqual(global, report)
  assert.strictEqual(project, report)
  assert.deepEqual(doctorQueryKeys.report(), [
    'host',
    'doctor',
    'report',
    'global',
  ])
  assert.deepEqual(doctorQueryKeys.report('proj_onboarding01'), [
    'host',
    'doctor',
    'report',
    'proj_onboarding01',
  ])
  assert.equal(calls.length, 2)
  assert.deepEqual(Object.keys(calls[0]), ['signal'])
  assert.ok(calls[0].signal instanceof AbortSignal)
  assert.equal(calls[1].projectId, 'proj_onboarding01')
  assert.ok(calls[1].signal instanceof AbortSignal)
})

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
}

function actionIdFactory() {
  let next = 0
  return () => `act_onboarding${String(++next).padStart(2, '0')}`
}

function onboardingProgress(step, revision, context = {}) {
  return {
    flowVersion: 1,
    step,
    revision,
    ...context,
    startedAt: observedAt,
    updatedAt: observedAt,
  }
}

function doctorReport() {
  return {
    generatedAt: observedAt,
    overall: 'ready',
    thisComputer: {
      machineId: 'machine_onboarding01',
      displayName: 'This computer',
      platform: 'windows',
      architecture: 'x64',
      state: 'ready',
    },
    providers: [],
    remoteComputers: [],
  }
}

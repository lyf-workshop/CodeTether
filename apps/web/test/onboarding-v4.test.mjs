import assert from 'node:assert/strict'
import test from 'node:test'
import { QueryClient } from '@tanstack/react-query'
import { onboardingPresentationSource } from './fixtures/onboarding-source.mjs'

import {
  continueOnboardingChecks,
  createOnboardingTransitionGate,
  onboardingProjectChoices,
  onboardingScreenIndex,
  onboardingScreens,
} from '../.tmp/test-dist/components/onboarding/onboarding-presentation.js'
import {
  OnboardingActions,
  onboardingQueryKeys,
} from '../.tmp/test-dist/runtime/host/onboarding-query.js'

test('six visual screens preserve all seven durable step identities', () => {
  assert.equal(onboardingScreens.length, 6)
  assert.deepEqual(
    [
      'welcome',
      'computer_check',
      'provider_check',
      'project_setup',
      'previous_conversations',
      'remote_setup',
      'ready',
    ].map(onboardingScreenIndex),
    [0, 1, 1, 2, 3, 4, 5],
  )
})

test('the merged check screen commits in order using the returned durable revision', async () => {
  const first = progress('computer_check', 4)
  const intermediate = progress('provider_check', 7)
  const final = progress('project_setup', 9)
  const calls = []
  const result = await continueOnboardingChecks(
    first,
    async (current, transition) => {
      calls.push([current, transition])
      return calls.length === 1 ? intermediate : final
    },
  )
  assert.deepEqual(calls, [
    [first, { kind: 'continue' }],
    [intermediate, { kind: 'continue' }],
  ])
  assert.strictEqual(result, final)
})

test('reopening the second check commits once; an absent or unexpected response never guesses the next step', async () => {
  for (const initial of [
    progress('provider_check', 5),
    progress('welcome', 0),
  ]) {
    let calls = 0
    await continueOnboardingChecks(initial, async () => {
      calls += 1
      return progress('project_setup', 10)
    })
    assert.equal(calls, 1)
  }
  for (const next of [
    undefined,
    progress('ready', 10),
    progress('project_setup', 10),
  ]) {
    let calls = 0
    assert.strictEqual(
      await continueOnboardingChecks(
        progress('computer_check', 1),
        async () => {
          calls += 1
          return next
        },
      ),
      next,
    )
    assert.equal(calls, 1)
  }
})

test('a failed second continue leaves the first Host-owned provider_check progress intact', async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const first = progress('computer_check', 3)
  const intermediate = progress('provider_check', 4)
  const requests = []
  const actions = new OnboardingActions(
    {
      async updateOnboarding(request) {
        requests.push(request)
        if (requests.length === 2) throw new Error('second_continue_refused')
        return {
          protocolVersion: 1,
          actionId: request.actionId,
          status: 'completed',
          data: { onboarding: intermediate, changed: true },
        }
      },
    },
    queryClient,
    (() => {
      let id = 0
      return () => 'act_onboarding_v4_' + ++id
    })(),
  )
  await assert.rejects(
    continueOnboardingChecks(
      first,
      async (current, transition) =>
        (await actions.update(current.revision, transition)).data.onboarding,
    ),
    /second_continue_refused/u,
  )
  assert.deepEqual(
    requests.map((request) => request.expectedRevision),
    [3, 4],
  )
  assert.notEqual(requests[0].actionId, requests[1].actionId)
  assert.strictEqual(
    queryClient.getQueryData(onboardingQueryKeys.progress),
    intermediate,
  )
  queryClient.clear()
})

test('transition gate claims synchronously, rejects duplicate UI work and releases after success or rejection', async () => {
  const gate = createOnboardingTransitionGate()
  const pending = Promise.withResolvers()
  let calls = 0
  const first = gate.run(async () => {
    calls += 1
    return await pending.promise
  })
  assert.equal(gate.isPending(), true)
  const duplicates = Array.from({ length: 1_000 }, () =>
    gate.run(async () => {
      calls += 1
    }),
  )
  assert.deepEqual(await Promise.all(duplicates), Array(1_000).fill(undefined))
  assert.equal(calls, 1)
  pending.resolve('saved')
  assert.equal(await first, 'saved')
  assert.equal(gate.isPending(), false)
  await assert.rejects(
    gate.run(() => {
      throw new Error('sync_failure')
    }),
    /sync_failure/u,
  )
  assert.equal(gate.isPending(), false)
  assert.equal(
    await gate.run(async () => 'next explicit action'),
    'next explicit action',
  )
})

test('the synchronous gate stays held between both durable check commits', async () => {
  const gate = createOnboardingTransitionGate()
  const firstResponse = Promise.withResolvers()
  const secondResponse = Promise.withResolvers()
  const calls = []
  const flight = gate.run(() =>
    continueOnboardingChecks(progress('computer_check', 2), async (current) => {
      calls.push(current.revision)
      return calls.length === 1
        ? await firstResponse.promise
        : await secondResponse.promise
    }),
  )
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(calls, [2])
  firstResponse.resolve(progress('provider_check', 3))
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(calls, [2, 3])
  assert.equal(gate.isPending(), true)
  assert.equal(
    await gate.run(async () =>
      assert.fail('duplicate Continue during second commit'),
    ),
    undefined,
  )
  secondResponse.resolve(progress('project_setup', 4))
  assert.equal((await flight).step, 'project_setup')
  assert.equal(gate.isPending(), false)
})

test('legacy project choices flatten exact immutable device locations without fallback or mutation', () => {
  const local = machine('machine_local', 'local', 'local')
  const remote = machine('machine_remote', 'remote', 'offline')
  const unknown = {
    machineId: 'machine_missing',
    rootPath: '/unknown',
    availability: 'available',
  }
  const project = {
    projectId: 'proj_legacy',
    name: 'Legacy',
    locations: [
      {
        machineId: remote.machineId,
        rootPath: '/remote',
        availability: 'available',
      },
      {
        machineId: local.machineId,
        rootPath: 'D:/local',
        availability: 'available',
      },
      unknown,
    ],
  }
  const machines = [remote, local]
  const choices = onboardingProjectChoices([project], machines)
  assert.deepEqual(machines, [remote, local])
  assert.deepEqual(
    choices.map((choice) => [
      choice.machine.machineId,
      choice.location.rootPath,
      choice.state.available,
    ]),
    [
      [local.machineId, 'D:/local', true],
      [remote.machineId, '/remote', false],
    ],
  )
  assert.deepEqual(
    choices.map((choice) => choice.key),
    ['proj_legacy:machine_local', 'proj_legacy:machine_remote'],
  )
  assert.deepEqual(onboardingProjectChoices([project], []), [])
  assert.equal(project.locations[0].machineId, remote.machineId)
})

test('onboarding source preserves exact Ready gates, explicit-only probes and error recovery', async () => {
  const source = onboardingPresentationSource()
  assert.match(source, /createOnboardingTransitionGate/u)
  assert.match(source, /transitionGateRef\.current\.run/u)
  assert.match(source, /continueOnboardingChecks\(progress, commit\)/u)
  assert.match(source, /onError:[\s\S]*onboardingQuery\.refetch/u)
  assert.match(source, /transitionSequencePending/u)
  assert.match(source, /void checkSelectedContext\(onboarding, false\)/u)
  assert.match(
    source,
    /props\.contextCheckCurrent[\s\S]*!props\.contextCheckFailed[\s\S]*isDoctorExecutionContextReady/u,
  )
  assert.match(
    source,
    /const selectedLocal =\s*onboarding\.machineId === doctor\.thisComputer\.machineId/u,
  )
  assert.match(source, /所选设备的状态尚未取得/u)
  assert.match(source, /fixedMachineId=\{machine\.machineId\}/u)
  assert.match(source, /deferPreviousConversations/u)
  assert.match(source, /NodeSetupInstructions platform=\{platform\}/u)
  assert.doesNotMatch(
    source,
    /AddProjectLocationDialog|localLocation \?\?|legacyProjectLocation|startTurn|startNewTurn/u,
  )
  assert.doesNotMatch(
    source,
    /style=\{|!important|enrollLocalHost|enableLocalHostIdentity/u,
  )
})

function progress(step, revision) {
  return { step, revision, updatedAt: '2026-09-07T00:00:00.000Z' }
}
function machine(machineId, kind, connectionState) {
  return {
    machineId,
    kind,
    connectionState,
    availability: 'available',
    capabilities: { projectAccess: true, providerExecution: true },
  }
}

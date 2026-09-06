import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { canonicalFailure } from '@codetether/agent-core'

import { HostEventPublisher } from '../dist/api/host-event-publisher.js'
import {
  HostService,
  HostServiceError,
  newEpoch,
} from '../dist/api/host-service.js'
import { WorkspacePolicy } from '../dist/api/workspace-policy.js'
import { ConversationStore } from '../dist/persistence/index.js'

const timestamp = '2026-10-02T12:00:00.000Z'

test('discovery exposes bounded opaque metadata and adoption starts no Provider', async (t) => {
  const fixture = await createFixture(t, {
    candidates: [
      nativeCandidate('native-private-one', 'revision-private-one', {
        title: 'Existing Codex work',
        lastActiveAt: '2026-10-02T11:00:00.000Z',
      }),
      nativeCandidate('native-private-two', 'revision-private-two', {
        title: 'Earlier Codex work',
        lastActiveAt: '2026-10-01T11:00:00.000Z',
      }),
    ],
  })

  const first = await fixture.service.discoverProviderSessions(
    fixture.projectId,
    fixture.machineId,
    { limit: 1, rescan: false },
  )
  assert.equal(first.candidates.length, 1)
  assert.equal(first.candidates[0].title, 'Existing Codex work')
  assert.equal(first.candidates[0].alreadyAdopted, false)
  assert.ok(first.nextCursor)
  assert.equal(first.providers.length, 2)
  assert.deepEqual(
    first.providers.map(({ provider, status }) => ({ provider, status })),
    [
      { provider: 'codex', status: 'supported' },
      { provider: 'claude-code', status: 'unsupported' },
    ],
  )

  const publicJson = JSON.stringify(first)
  assert.equal(publicJson.includes('native-private'), false)
  assert.equal(publicJson.includes('revision-private'), false)
  assert.equal(publicJson.includes(fixture.workspace), false)

  const second = await fixture.service.discoverProviderSessions(
    fixture.projectId,
    fixture.machineId,
    { limit: 1, cursor: first.nextCursor, rescan: false },
  )
  assert.equal(second.candidates.length, 1)
  assert.equal(second.candidates[0].title, 'Earlier Codex work')
  assert.equal(second.nextCursor, undefined)

  const adopted = await fixture.service.adoptProviderSession(
    fixture.projectId,
    fixture.machineId,
    {
      actionId: 'act_phase8a_adopt_opaque_candidate',
      discoveryCandidateId: first.candidates[0].discoveryCandidateId,
    },
  )
  assert.equal(adopted.data.disposition, 'adopted')
  assert.equal(adopted.data.conversation.origin, 'adopted_native')
  assert.equal(adopted.data.conversation.provider, 'codex')
  assert.equal(adopted.data.conversation.machineId, fixture.machineId)
  assert.equal(adopted.data.conversation.projectId, fixture.projectId)
  assert.equal(fixture.runtime.startConversationCalls, 0)
  assert.equal(fixture.runtime.resumeConversationCalls, 0)
  assert.equal(fixture.runtime.startTurnCalls, 0)

  const again = await fixture.service.adoptProviderSession(
    fixture.projectId,
    fixture.machineId,
    {
      actionId: 'act_phase8a_adopt_opaque_candidate_again',
      discoveryCandidateId: first.candidates[0].discoveryCandidateId,
    },
  )
  assert.equal(again.data.disposition, 'already_adopted')
  assert.equal(
    again.data.conversation.conversationId,
    adopted.data.conversation.conversationId,
  )

  const rescanned = await fixture.service.discoverProviderSessions(
    fixture.projectId,
    fixture.machineId,
    { provider: 'codex', limit: 50, rescan: true },
  )
  const existing = rescanned.candidates.find(
    (candidate) => candidate.title === 'Existing Codex work',
  )
  assert.ok(existing)
  assert.equal(existing.alreadyAdopted, true)
  assert.equal(
    existing.conversationId,
    adopted.data.conversation.conversationId,
  )
  assert.equal(JSON.stringify(rescanned).includes('native-private'), false)
})

test('adoption binding conflict stays a 409 and leaves durability healthy', async (t) => {
  const nativeSessionId = 'native-private-binding-conflict'
  const fixture = await createFixture(t, {
    candidates: [
      nativeCandidate(nativeSessionId, 'revision-private-binding-conflict'),
    ],
  })
  const conflictingCwd = join(fixture.workspace, 'already-bound-elsewhere')
  await mkdir(conflictingCwd, { recursive: true })
  const existing = fixture.persistence.createOrGetAdoptedConversation({
    conversationId: 'conv_phase8a_binding_conflict',
    projectId: fixture.projectId,
    machineId: fixture.machineId,
    title: 'Existing conflicting binding',
    titleSource: 'generated',
    provider: 'codex',
    providerThreadId: nativeSessionId,
    cwd: conflictingCwd,
    status: 'idle',
    createdAt: timestamp,
    updatedAt: timestamp,
    lastActivityAt: timestamp,
  })
  assert.equal(existing.created, true)

  const discovered = await fixture.service.discoverProviderSessions(
    fixture.projectId,
    fixture.machineId,
    { provider: 'codex', limit: 50, rescan: true },
  )
  const candidate = discovered.candidates[0]
  assert.ok(candidate)

  await assert.rejects(
    fixture.service.adoptProviderSession(fixture.projectId, fixture.machineId, {
      actionId: 'act_phase8a_binding_conflict',
      discoveryCandidateId: candidate.discoveryCandidateId,
    }),
    (error) =>
      error instanceof HostServiceError &&
      error.code === 'conflict' &&
      error.httpStatus === 409,
  )

  const renamed = await fixture.service.renameConversation(
    existing.conversation.conversationId,
    {
      actionId: 'act_phase8a_binding_conflict_health',
      title: 'Durability remains healthy',
    },
  )
  assert.equal(renamed.data.conversation.title, 'Durability remains healthy')
  assert.equal(
    fixture.persistence.getConversation(existing.conversation.conversationId)
      ?.title,
    'Durability remains healthy',
  )
  assert.equal(fixture.runtime.startConversationCalls, 0)
  assert.equal(fixture.runtime.resumeConversationCalls, 0)
  assert.equal(fixture.runtime.startTurnCalls, 0)
})

test('local discovery remains available while current Provider resume readiness is unavailable', async (t) => {
  const fixture = await createFixture(t, {
    candidates: [
      nativeCandidate(
        'native-runtime-unavailable',
        'revision-runtime-unavailable',
      ),
    ],
    runtimeDescriptor: unavailableResumeDescriptor('codex'),
  })

  const result = await fixture.service.discoverProviderSessions(
    fixture.projectId,
    fixture.machineId,
    { provider: 'codex', limit: 50, rescan: true },
  )
  assert.equal(result.providers[0].status, 'supported')
  assert.equal(result.providers[0].resumeStatus, 'unavailable')
  assert.equal(result.candidates.length, 1)
  assert.equal(result.candidates[0].resumeStatus, 'unavailable')
  assert.equal(fixture.runtime.startConversationCalls, 0)
  assert.equal(fixture.runtime.resumeConversationCalls, 0)
  assert.equal(fixture.runtime.startTurnCalls, 0)

  await assert.rejects(
    fixture.service.adoptProviderSession(fixture.projectId, fixture.machineId, {
      actionId: 'act_phase8a_unavailable_resume_adopt',
      discoveryCandidateId: result.candidates[0].discoveryCandidateId,
    }),
    (error) =>
      error instanceof HostServiceError &&
      error.code === 'provider_unavailable',
  )
  assert.equal(fixture.service.snapshot().conversations.length, 0)
})

test('candidate removal or revision change expires adoption atomically', async (t) => {
  const fixture = await createFixture(t, {
    candidates: [nativeCandidate('native-racy-session', 'revision-before')],
  })
  const discovered = await fixture.service.discoverProviderSessions(
    fixture.projectId,
    fixture.machineId,
    { provider: 'codex', limit: 50, rescan: false },
  )
  const candidate = discovered.candidates[0]
  assert.ok(candidate)

  fixture.discovery.validated = undefined
  await assert.rejects(
    fixture.service.adoptProviderSession(fixture.projectId, fixture.machineId, {
      actionId: 'act_phase8a_disappeared_candidate',
      discoveryCandidateId: candidate.discoveryCandidateId,
    }),
    (error) =>
      error instanceof HostServiceError &&
      error.code === 'provider_session_candidate_expired',
  )
  assert.equal(fixture.service.snapshot().conversations.length, 0)

  fixture.discovery.validated = nativeCandidate(
    'native-racy-session',
    'revision-after',
  )
  await assert.rejects(
    fixture.service.adoptProviderSession(fixture.projectId, fixture.machineId, {
      actionId: 'act_phase8a_changed_candidate',
      discoveryCandidateId: candidate.discoveryCandidateId,
    }),
    (error) =>
      error instanceof HostServiceError &&
      error.code === 'provider_session_candidate_expired',
  )
  assert.equal(fixture.service.snapshot().conversations.length, 0)
  assert.equal(fixture.runtime.startConversationCalls, 0)
})

test('malformed adoption revalidation expires safely without poisoning durability', async (t) => {
  const native = nativeCandidate(
    'native-malformed-revalidation',
    'revision-malformed-revalidation',
  )
  const fixture = await createFixture(t, { candidates: [native] })
  const durableControl = fixture.persistence.createOrGetAdoptedConversation({
    conversationId: 'conv_phase8a_revalidation_health',
    projectId: fixture.projectId,
    machineId: fixture.machineId,
    title: 'Durability control',
    titleSource: 'generated',
    provider: 'codex',
    providerThreadId: 'native-revalidation-health-control',
    cwd: fixture.projectRoot,
    status: 'idle',
    createdAt: timestamp,
    updatedAt: timestamp,
    lastActivityAt: timestamp,
  })
  const discovered = await fixture.service.discoverProviderSessions(
    fixture.projectId,
    fixture.machineId,
    { provider: 'codex', limit: 50, rescan: false },
  )
  const candidate = discovered.candidates[0]
  assert.ok(candidate)
  fixture.discovery.validated = {
    ...native,
    title: ' '.repeat(241),
  }

  await assert.rejects(
    fixture.service.adoptProviderSession(fixture.projectId, fixture.machineId, {
      actionId: 'act_phase8a_malformed_revalidation',
      discoveryCandidateId: candidate.discoveryCandidateId,
    }),
    (error) =>
      error instanceof HostServiceError &&
      error.code === 'provider_session_candidate_expired',
  )
  const renamed = await fixture.service.renameConversation(
    durableControl.conversation.conversationId,
    {
      actionId: 'act_phase8a_revalidation_health_check',
      title: 'Durability remains healthy after malformed metadata',
    },
  )
  assert.equal(
    renamed.data.conversation.title,
    'Durability remains healthy after malformed metadata',
  )
  assert.equal(fixture.runtime.startConversationCalls, 0)
  assert.equal(fixture.runtime.resumeConversationCalls, 0)
  assert.equal(fixture.runtime.startTurnCalls, 0)
})

test('identical concurrent scans coalesce and partial Provider failure remains isolated', async (t) => {
  const gate = deferred()
  const fixture = await createFixture(t, {
    candidates: [nativeCandidate('native-coalesced', 'revision-coalesced')],
    discoveryGate: gate.promise,
    claudeStatus: 'unavailable',
  })

  const first = fixture.service.discoverProviderSessions(
    fixture.projectId,
    fixture.machineId,
    { limit: 50, rescan: false },
  )
  const second = fixture.service.discoverProviderSessions(
    fixture.projectId,
    fixture.machineId,
    { limit: 50, rescan: false },
  )
  for (
    let attempt = 0;
    attempt < 50 && fixture.discovery.discoverCalls === 0;
    attempt += 1
  ) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  const callsBeforeRelease = fixture.discovery.discoverCalls
  gate.resolve()
  assert.equal(callsBeforeRelease, 1)

  const [firstResult, secondResult] = await Promise.all([first, second])
  assert.equal(firstResult.candidates.length, 1)
  assert.equal(secondResult.candidates.length, 1)
  assert.equal(fixture.discovery.discoverCalls, 1)
  assert.deepEqual(
    firstResult.providers.map(({ provider, status }) => ({ provider, status })),
    [
      { provider: 'codex', status: 'supported' },
      { provider: 'claude-code', status: 'unavailable' },
    ],
  )
})

test('coalesced scans keep independent caller cancellation and release the shared worker', async (t) => {
  const gate = deferred()
  const fixture = await createFixture(t, {
    candidates: [nativeCandidate('native-cancel-safe', 'revision-cancel-safe')],
    discoveryGate: gate.promise,
  })
  const firstAbort = new AbortController()
  const secondAbort = new AbortController()
  const first = fixture.service.discoverProviderSessions(
    fixture.projectId,
    fixture.machineId,
    { provider: 'codex', limit: 50, rescan: false },
    firstAbort.signal,
  )
  const second = fixture.service.discoverProviderSessions(
    fixture.projectId,
    fixture.machineId,
    { provider: 'codex', limit: 50, rescan: false },
    secondAbort.signal,
  )
  for (
    let attempt = 0;
    attempt < 50 && fixture.discovery.discoverCalls === 0;
    attempt += 1
  ) {
    await new Promise((resolve) => setImmediate(resolve))
  }

  firstAbort.abort()
  await assert.rejects(first, (error) => error?.name === 'AbortError')
  assert.equal(fixture.discovery.abortCount, 0)
  gate.resolve()
  const result = await second
  assert.equal(result.candidates.length, 1)
  assert.equal(fixture.discovery.discoverCalls, 1)
  assert.equal(fixture.discovery.abortCount, 0)
})

test('last-waiter cancellation cleans up before one fresh identical scan starts', async (t) => {
  const firstAbortObserved = deferred()
  const firstCleanup = deferred()
  let discoverCalls = 0
  let activeWorkers = 0
  let maximumActiveWorkers = 0
  const fixture = await createFixture(t, {
    candidates: [],
    discoveryImplementation: async (request) => {
      discoverCalls += 1
      const generation = discoverCalls
      activeWorkers += 1
      maximumActiveWorkers = Math.max(maximumActiveWorkers, activeWorkers)
      try {
        if (generation === 1) {
          if (!request.signal.aborted) {
            await new Promise((resolve) =>
              request.signal.addEventListener('abort', resolve, { once: true }),
            )
          }
          firstAbortObserved.resolve()
          await firstCleanup.promise
          request.signal.throwIfAborted()
        }
        return {
          provider: 'codex',
          status: 'supported',
          resumeStatus: 'supported',
          candidates: [
            {
              ...nativeCandidate(
                'native-after-last-waiter-abort',
                'revision-after-last-waiter-abort',
              ),
              workingDirectory: request.projectRoot,
            },
          ],
          metrics: discoveryMetrics(1),
        }
      } finally {
        activeWorkers -= 1
      }
    },
  })
  const cancelled = new AbortController()
  const first = fixture.service.discoverProviderSessions(
    fixture.projectId,
    fixture.machineId,
    { provider: 'codex', limit: 50, rescan: false },
    cancelled.signal,
  )
  await waitFor(() => discoverCalls === 1, 'first Provider session scan')

  cancelled.abort()
  await assert.rejects(first, (error) => error?.name === 'AbortError')
  await firstAbortObserved.promise
  const fresh = fixture.service.discoverProviderSessions(
    fixture.projectId,
    fixture.machineId,
    { provider: 'codex', limit: 50, rescan: false },
  )
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(discoverCalls, 1)
  assert.equal(activeWorkers, 1)

  firstCleanup.resolve()
  const result = await fresh
  assert.equal(result.candidates.length, 1)
  assert.equal(discoverCalls, 2)
  assert.equal(maximumActiveWorkers, 1)
  assert.equal(activeWorkers, 0)
})

test('distinct concurrent Project scans respect the admission cap and release capacity after cleanup', async (t) => {
  const gates = new Map()
  let activeWorkers = 0
  let maximumActiveWorkers = 0
  const fixture = await createFixture(t, {
    candidates: [],
    maxConcurrentScans: 2,
    discoveryImplementation: async (request) => {
      const gate = deferred()
      gates.set(request.projectRoot, gate)
      activeWorkers += 1
      maximumActiveWorkers = Math.max(maximumActiveWorkers, activeWorkers)
      try {
        await gate.promise
        const suffix = String(gates.size)
        return {
          provider: 'codex',
          status: 'supported',
          resumeStatus: 'supported',
          candidates: [
            {
              ...nativeCandidate(
                `native-scan-cap-${suffix}`,
                `revision_scan_cap_${suffix}`,
              ),
              workingDirectory: request.projectRoot,
            },
          ],
          metrics: discoveryMetrics(1),
        }
      } finally {
        activeWorkers -= 1
      }
    },
  })
  const projectBPath = join(fixture.workspace, 'project-b')
  const projectCPath = join(fixture.workspace, 'project-c')
  await Promise.all([
    mkdir(projectBPath, { recursive: true }),
    mkdir(projectCPath, { recursive: true }),
  ])
  const projectB = (
    await fixture.service.createProject({
      actionId: 'act_phase8a_scan_cap_project_b',
      path: projectBPath,
    })
  ).data.project
  const projectC = (
    await fixture.service.createProject({
      actionId: 'act_phase8a_scan_cap_project_c',
      path: projectCPath,
    })
  ).data.project
  const projectBRoot = projectB.locations[0].rootPath
  const projectCRoot = projectC.locations[0].rootPath
  const providersBeforeSaturation = (
    await fixture.service.getMachine(fixture.machineId)
  ).providers

  const scanA = fixture.service.discoverProviderSessions(
    fixture.projectId,
    fixture.machineId,
    { provider: 'codex', limit: 50, rescan: false },
  )
  const coalescedA = fixture.service.discoverProviderSessions(
    fixture.projectId,
    fixture.machineId,
    { provider: 'codex', limit: 50, rescan: false },
  )
  const scanB = fixture.service.discoverProviderSessions(
    projectB.projectId,
    fixture.machineId,
    { provider: 'codex', limit: 50, rescan: false },
  )
  await waitFor(
    () => fixture.discovery.discoverCalls === 2,
    'two admitted distinct Project scans',
  )
  assert.equal(gates.has(fixture.projectRoot), true)
  assert.equal(gates.has(projectBRoot), true)
  assert.equal(activeWorkers, 2)

  const saturated = await fixture.service.discoverProviderSessions(
    projectC.projectId,
    fixture.machineId,
    { provider: 'codex', limit: 50, rescan: false },
  )
  assert.equal(saturated.candidates.length, 0)
  assert.deepEqual(saturated.providers[0], {
    provider: 'codex',
    status: 'unavailable',
    resumeStatus: 'unavailable',
    candidateCount: 0,
    corruptEntriesSkipped: 0,
    failureReason: 'provider_session_discovery_unavailable',
  })
  assert.equal(fixture.discovery.discoverCalls, 2)
  assert.equal(gates.has(projectCRoot), false)
  assert.equal(fixture.runtime.startConversationCalls, 0)
  assert.equal(fixture.runtime.resumeConversationCalls, 0)
  assert.equal(fixture.runtime.startTurnCalls, 0)
  assert.deepEqual(
    (await fixture.service.getMachine(fixture.machineId)).providers,
    providersBeforeSaturation,
  )

  gates.get(fixture.projectRoot).resolve()
  const [resultA, coalescedResultA] = await Promise.all([scanA, coalescedA])
  assert.equal(resultA.candidates.length, 1)
  assert.equal(coalescedResultA.candidates.length, 1)
  assert.equal(activeWorkers, 1)

  const retryC = fixture.service.discoverProviderSessions(
    projectC.projectId,
    fixture.machineId,
    { provider: 'codex', limit: 50, rescan: true },
  )
  await waitFor(
    () => fixture.discovery.discoverCalls === 3,
    'Project scan admitted after capacity cleanup',
  )
  assert.equal(gates.has(projectCRoot), true)
  assert.equal(activeWorkers, 2)
  gates.get(projectBRoot).resolve()
  gates.get(projectCRoot).resolve()
  const [resultB, resultC] = await Promise.all([scanB, retryC])
  assert.equal(resultB.candidates.length, 1)
  assert.equal(resultC.candidates.length, 1)
  assert.equal(maximumActiveWorkers, 2)
  assert.equal(activeWorkers, 0)
  assert.equal(fixture.discovery.discoverCalls, 3)
})

test('an advancing local cursor chain is bounded by one aggregate scan deadline', async (t) => {
  let calls = 0
  let aborted = 0
  const fixture = await createFixture(t, {
    candidates: [],
    discoveryTimeoutMs: 25,
    discoveryImplementation: async (request) => {
      calls += 1
      if (calls === 1) {
        return {
          provider: 'codex',
          status: 'supported',
          resumeStatus: 'supported',
          candidates: [
            {
              ...nativeCandidate('native-deadline', 'revision-deadline'),
              workingDirectory: request.projectRoot,
            },
          ],
          nextCursor: 'cursor_deadline_1',
          metrics: discoveryMetrics(1),
        }
      }
      return await new Promise((resolve, reject) => {
        const cancel = () => {
          aborted += 1
          const error = new Error('Deadline reached')
          error.name = 'AbortError'
          reject(error)
        }
        request.signal.addEventListener('abort', cancel, { once: true })
      })
    },
  })
  const startedAt = performance.now()
  const result = await fixture.service.discoverProviderSessions(
    fixture.projectId,
    fixture.machineId,
    { provider: 'codex', limit: 50, rescan: false },
  )
  assert.ok(performance.now() - startedAt < 500)
  assert.equal(result.candidates.length, 1)
  assert.equal(calls, 2)
  assert.equal(aborted, 1)
})

test('local discovery saturates aggregate safe metrics across pages', async (t) => {
  const fixture = await createFixture(t, {
    candidates: [],
    discoveryImplementation: async (request) => {
      const firstPage = request.cursor === undefined
      return {
        provider: 'codex',
        status: 'supported',
        resumeStatus: 'supported',
        candidates: [
          {
            ...nativeCandidate(
              firstPage ? 'native-metrics-page-one' : 'native-metrics-page-two',
              firstPage ? 'revision-metrics-one' : 'revision-metrics-two',
            ),
            workingDirectory: request.projectRoot,
          },
        ],
        ...(firstPage ? { nextCursor: 'cursor_metrics_page_two' } : {}),
        metrics: {
          filesInspected: Number.MAX_SAFE_INTEGER,
          candidatesParsed: Number.MAX_SAFE_INTEGER,
          candidatesMatched: Number.MAX_SAFE_INTEGER,
          corruptEntriesSkipped: Number.MAX_SAFE_INTEGER,
          elapsedMs: Number.MAX_SAFE_INTEGER,
          truncated: false,
        },
      }
    },
  })
  const result = await fixture.service.discoverProviderSessions(
    fixture.projectId,
    fixture.machineId,
    { provider: 'codex', limit: 50, rescan: false },
  )

  assert.equal(result.candidates.length, 2)
  assert.equal(
    result.providers[0].corruptEntriesSkipped,
    Number.MAX_SAFE_INTEGER,
  )
})

test('a malformed adapter cannot cross Provider or ProjectLocation boundaries', async (t) => {
  const fixture = await createFixture(t, {
    candidates: [],
    discoveryImplementation: async (request) => ({
      provider: 'codex',
      status: 'supported',
      resumeStatus: 'supported',
      candidates: [
        {
          ...nativeCandidate(
            'native-cross-provider',
            'revision-cross-provider',
          ),
          provider: 'claude-code',
          workingDirectory: request.projectRoot,
        },
      ],
      metrics: discoveryMetrics(1),
    }),
  })
  const result = await fixture.service.discoverProviderSessions(
    fixture.projectId,
    fixture.machineId,
    { provider: 'codex', limit: 50, rescan: false },
  )
  assert.equal(result.candidates.length, 0)
  assert.deepEqual(result.providers[0], {
    provider: 'codex',
    status: 'unavailable',
    resumeStatus: 'unavailable',
    candidateCount: 0,
    corruptEntriesSkipped: 0,
    failureReason: 'provider_session_format_unsupported',
  })
})

test('local discovery rejects malformed private candidate metadata', async (t) => {
  const fixture = await createFixture(t, {
    candidates: [],
    discoveryImplementation: async (request) => ({
      provider: 'codex',
      status: 'supported',
      resumeStatus: 'supported',
      candidates: [
        {
          ...nativeCandidate('native-malformed', 'revision-malformed'),
          workingDirectory: request.projectRoot,
          lastActiveAt: 'not-a-timestamp',
        },
      ],
      metrics: discoveryMetrics(1),
    }),
  })
  const result = await fixture.service.discoverProviderSessions(
    fixture.projectId,
    fixture.machineId,
    { provider: 'codex', limit: 50, rescan: false },
  )

  assertUnsupportedFormat(result)
})

test('local discovery rejects an adapter page larger than its requested bound', async (t) => {
  const fixture = await createFixture(t, {
    candidates: [],
    discoveryImplementation: async (request) => ({
      provider: 'codex',
      status: 'supported',
      resumeStatus: 'supported',
      candidates: Array.from({ length: request.limit + 1 }, (_, index) => ({
        ...nativeCandidate(`native-oversized-${index}`, `revision-${index}`),
        workingDirectory: request.projectRoot,
      })),
      metrics: discoveryMetrics(request.limit + 1),
    }),
  })
  const result = await fixture.service.discoverProviderSessions(
    fixture.projectId,
    fixture.machineId,
    { provider: 'codex', limit: 50, rescan: false },
  )

  assertUnsupportedFormat(result)
})

test('unavailable local discovery cannot expose native candidates', async (t) => {
  const fixture = await createFixture(t, {
    candidates: [],
    discoveryImplementation: async (request) => ({
      provider: 'codex',
      status: 'unavailable',
      resumeStatus: 'unavailable',
      candidates: [
        {
          ...nativeCandidate('native-unavailable', 'revision-unavailable'),
          workingDirectory: request.projectRoot,
        },
      ],
      failureReason: 'provider_session_store_unreadable',
      metrics: discoveryMetrics(1),
    }),
  })
  const result = await fixture.service.discoverProviderSessions(
    fixture.projectId,
    fixture.machineId,
    { provider: 'codex', limit: 50, rescan: false },
  )

  assertUnsupportedFormat(result)
})

async function createFixture(t, options) {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-phase8a-host-'))
  const workspace = join(directory, 'workspace')
  const databasePath = join(directory, 'codetether.sqlite3')
  await mkdir(workspace, { recursive: true })
  const persistence = ConversationStore.open({ databasePath })
  const runtime = new NoExecutionRuntime(options.runtimeDescriptor)
  const discovery = new FakeDiscovery('codex', options.candidates, {
    gate: options.discoveryGate,
    implementation: options.discoveryImplementation,
  })
  const claudeDiscovery = new FakeDiscovery('claude-code', [], {
    status: options.claudeStatus ?? 'unsupported',
  })
  const service = new HostService({
    runtime,
    persistence,
    providerSessionDiscoveries: [discovery, claudeDiscovery],
    workspacePolicy: await WorkspacePolicy.create([workspace]),
    publisher: new HostEventPublisher({ epoch: newEpoch() }),
    hostVersion: 'phase8a-test',
    now: () => new Date(timestamp),
    providerSessionDiscoveryTimeoutMs: options.discoveryTimeoutMs,
    maxConcurrentProviderSessionScans: options.maxConcurrentScans,
  })
  await service.registerInitialProjectRoots([workspace])
  const projectSummary = (await service.listProjects()).projects[0]
  const machine = service.listMachines().machines[0]
  assert.ok(projectSummary)
  assert.ok(machine)
  const project = (await service.getProject(projectSummary.projectId)).project
  discovery.projectRoot = project.locations[0].rootPath
  claudeDiscovery.projectRoot = project.locations[0].rootPath
  discovery.validated = options.candidates[0]
  t.after(async () => {
    await service.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true, maxRetries: 5 })
  })
  return {
    workspace,
    service,
    runtime,
    discovery,
    projectId: project.projectId,
    projectRoot: project.locations[0].rootPath,
    machineId: machine.machineId,
    persistence,
  }
}

function nativeCandidate(nativeSessionId, revision, overrides = {}) {
  return {
    provider: 'codex',
    nativeSessionId,
    revision,
    workingDirectory: '',
    title: 'Existing Provider conversation',
    createdAt: '2026-10-01T10:00:00.000Z',
    lastActiveAt: '2026-10-01T11:00:00.000Z',
    providerVersion: 'phase8a-test',
    resumeStatus: 'supported',
    historicalTranscript: 'unavailable',
    ...overrides,
  }
}

class FakeDiscovery {
  discoverCalls = 0
  abortCount = 0
  validated = undefined
  projectRoot = ''

  constructor(provider, candidates, options = {}) {
    this.provider = provider
    this.candidates = candidates
    this.status = options.status ?? 'supported'
    this.gate = options.gate
    this.implementation = options.implementation
  }

  async discover(request) {
    this.discoverCalls += 1
    await waitWithAbort(this.gate, request.signal, () => {
      this.abortCount += 1
    })
    if (this.implementation !== undefined) {
      return await this.implementation(request)
    }
    const candidates = this.candidates.map((candidate) => ({
      ...candidate,
      provider: this.provider,
      workingDirectory: request.projectRoot,
    }))
    return {
      provider: this.provider,
      status: this.status,
      resumeStatus: this.status,
      candidates: this.status === 'supported' ? candidates : [],
      ...(this.status === 'supported'
        ? {}
        : {
            failureReason:
              this.status === 'unsupported'
                ? 'provider_session_discovery_unavailable'
                : 'provider_session_store_unreadable',
          }),
      metrics: discoveryMetrics(candidates.length),
    }
  }

  async validateCandidate(request) {
    if (this.validated === undefined) return undefined
    return {
      ...this.validated,
      provider: this.provider,
      workingDirectory: request.projectRoot,
    }
  }
}

function discoveryMetrics(count) {
  return {
    filesInspected: count,
    candidatesParsed: count,
    candidatesMatched: count,
    corruptEntriesSkipped: 0,
    elapsedMs: 1,
    truncated: false,
  }
}

function assertUnsupportedFormat(result) {
  assert.equal(result.candidates.length, 0)
  assert.deepEqual(result.providers[0], {
    provider: 'codex',
    status: 'unavailable',
    resumeStatus: 'unavailable',
    candidateCount: 0,
    corruptEntriesSkipped: 0,
    failureReason: 'provider_session_format_unsupported',
  })
}

class NoExecutionRuntime {
  provider = 'codex'
  startConversationCalls = 0
  resumeConversationCalls = 0
  startTurnCalls = 0

  constructor(descriptor) {
    if (descriptor !== undefined) this.descriptor = descriptor
  }

  subscribeEvents() {
    return () => undefined
  }

  subscribeFailures() {
    return () => undefined
  }

  subscribeApprovals() {
    return () => undefined
  }

  async startConversation() {
    this.startConversationCalls += 1
    throw new Error('Discovery/adoption must not create a Provider session')
  }

  async resumeConversation() {
    this.resumeConversationCalls += 1
    throw new Error('Discovery/adoption must not resume a Provider session')
  }

  async startTurn() {
    this.startTurnCalls += 1
    throw new Error('Discovery/adoption must not start a Provider Turn')
  }

  async interruptTurn() {}
  async close() {}
}

function unavailableResumeDescriptor(provider) {
  return {
    provider,
    displayName: provider === 'codex' ? 'Codex' : 'Claude Code',
    availability: 'available',
    capabilities: {
      streaming: true,
      resume: true,
      interrupt: false,
      approvals: false,
      fileRead: false,
      fileEdit: false,
      shell: false,
      search: false,
      diff: false,
      toolEvents: false,
      modelSelection: false,
      reasoningControl: false,
    },
    executionHealth: {
      state: 'unavailable',
      freshness: 'current',
      observedAt: timestamp,
      failure: canonicalFailure('provider_service_unavailable', timestamp),
    },
  }
}

function deferred() {
  let resolve
  const promise = new Promise((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

async function waitFor(predicate, label, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${label}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

async function waitWithAbort(promise, signal, onAbort) {
  if (promise === undefined) return
  signal?.throwIfAborted()
  await new Promise((resolve, reject) => {
    let settled = false
    const finish = (action) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      action()
    }
    const abort = () => {
      onAbort()
      const error = new Error('Fixture scan cancelled')
      error.name = 'AbortError'
      finish(() => reject(error))
    }
    signal?.addEventListener('abort', abort, { once: true })
    void promise.then(
      () => finish(resolve),
      (error) => finish(() => reject(error)),
    )
  })
}

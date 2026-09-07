import assert from 'node:assert/strict'
import test from 'node:test'

import { canonicalFailure } from '@codetether/agent-core'

import {
  DoctorReportSchema,
  GetDoctorQuerySchema,
  GetDoctorResponseSchema,
  GetOnboardingResponseSchema,
  OnboardingProgressSchema,
  OnboardingTransitionSchema,
  UpdateOnboardingRequestSchema,
  UpdateOnboardingResponseSchema,
  onboardingWireLimits,
} from '../dist/index.js'

const observedAt = '2026-09-07T12:00:00.000Z'
const laterAt = '2026-09-07T12:01:00.000Z'

test('onboarding persists flow progress without duplicating product readiness authority', () => {
  const progress = onboardingProgress()
  assert.deepEqual(OnboardingProgressSchema.parse(progress), progress)
  assert.deepEqual(
    GetOnboardingResponseSchema.parse({
      protocolVersion: 1,
      onboarding: progress,
    }).onboarding,
    progress,
  )

  for (const forbiddenField of [
    'providerReadiness',
    'backendReadiness',
    'machineConnectionState',
    'providerInstallationId',
    'projectPath',
  ]) {
    assert.equal(
      OnboardingProgressSchema.safeParse({
        ...progress,
        [forbiddenField]: 'copied-authority',
      }).success,
      false,
      forbiddenField,
    )
  }
})

test('onboarding progress requires coherent Project context, time ordering, and completion', () => {
  const progress = onboardingProgress()
  assert.equal(
    OnboardingProgressSchema.safeParse({
      ...progress,
      machineId: undefined,
    }).success,
    false,
  )
  assert.equal(
    OnboardingProgressSchema.safeParse({
      ...progress,
      projectId: undefined,
    }).success,
    false,
  )
  assert.equal(
    OnboardingProgressSchema.safeParse({
      ...progress,
      updatedAt: '2026-09-07T11:59:59.000Z',
    }).success,
    false,
  )
  assert.equal(
    OnboardingProgressSchema.safeParse({
      ...progress,
      completedAt: undefined,
    }).success,
    false,
  )
  assert.equal(
    OnboardingProgressSchema.safeParse({
      ...progress,
      revision: 0,
    }).success,
    false,
  )

  const resumable = {
    ...progress,
    step: 'project_setup',
    projectId: undefined,
    machineId: undefined,
    completedAt: undefined,
  }
  assert.deepEqual(OnboardingProgressSchema.parse(resumable), resumable)
})

test('onboarding transitions and responses are strict, revision-guarded, and action-addressed', () => {
  const transitions = [
    { kind: 'continue' },
    { kind: 'project_reselect' },
    {
      kind: 'project_selected',
      projectId: 'proj_onboarding01',
      machineId: 'machine_onboarding01',
    },
    { kind: 'previous_conversations_finished', disposition: 'reviewed' },
    { kind: 'previous_conversations_finished', disposition: 'skipped' },
    { kind: 'remote_setup_finished', disposition: 'configured' },
    { kind: 'remote_setup_finished', disposition: 'skipped' },
    { kind: 'reopen' },
  ]
  for (const transition of transitions) {
    assert.deepEqual(OnboardingTransitionSchema.parse(transition), transition)
  }

  const request = {
    actionId: 'act_onboarding01',
    expectedRevision: 4,
    transition: transitions[1],
  }
  assert.deepEqual(UpdateOnboardingRequestSchema.parse(request), request)
  assert.equal(
    UpdateOnboardingRequestSchema.safeParse({
      ...request,
      expectedRevision: 0,
    }).success,
    false,
  )
  assert.equal(
    UpdateOnboardingRequestSchema.safeParse({
      ...request,
      transition: { ...request.transition, path: 'C:\\secret-project' },
    }).success,
    false,
  )

  const response = {
    protocolVersion: 1,
    actionId: request.actionId,
    status: 'completed',
    data: { onboarding: onboardingProgress(), changed: true },
  }
  assert.deepEqual(UpdateOnboardingResponseSchema.parse(response), response)
})

test('Doctor accepts runtime-compatible plus backend-unavailable as independent component truth', () => {
  const report = doctorReport()
  assert.deepEqual(DoctorReportSchema.parse(report), report)
  assert.deepEqual(
    GetDoctorResponseSchema.parse({ protocolVersion: 1, doctor: report })
      .doctor,
    report,
  )

  const claude = report.providers.find(
    ({ provider }) => provider === 'claude-code',
  )
  assert.equal(claude.compatibility, 'verified')
  assert.equal(claude.runtimeReadiness, 'ready')
  assert.equal(claude.backend.mode, 'custom_gateway')
  assert.equal(claude.backend.readiness, 'unavailable')
  assert.equal(report.overall, 'ready')
})

test('Doctor is bounded, Machine-scoped, and rejects duplicate identities', () => {
  const report = doctorReport()
  assert.equal(
    DoctorReportSchema.safeParse({
      ...report,
      providers: [report.providers[0]],
    }).success,
    false,
  )
  assert.equal(
    DoctorReportSchema.safeParse({
      ...report,
      providers: [report.providers[0], report.providers[0]],
    }).success,
    false,
  )
  assert.equal(
    DoctorReportSchema.safeParse({
      ...report,
      providers: [
        {
          ...report.providers[0],
          alternateInstallations: 8,
        },
        report.providers[1],
      ],
    }).success,
    false,
  )

  const remote = remoteComputer('machine_remote01')
  assert.equal(
    DoctorReportSchema.safeParse({
      ...report,
      remoteComputers: [
        {
          ...remote,
          relay: { ...remote.relay, internetExecutionEnabled: true },
        },
      ],
    }).success,
    false,
  )
  assert.equal(
    DoctorReportSchema.safeParse({
      ...report,
      remoteComputers: [remote, remote],
    }).success,
    false,
  )
  assert.equal(
    DoctorReportSchema.safeParse({
      ...report,
      remoteComputers: [
        { ...remote, machineId: report.thisComputer.machineId },
      ],
    }).success,
    false,
  )

  const boundedRemotes = Array.from(
    { length: onboardingWireLimits.remoteComputers },
    (_, index) =>
      remoteComputer(`machine_remote_${String(index).padStart(2, '0')}`),
  )
  assert.equal(
    DoctorReportSchema.safeParse({
      ...report,
      remoteComputers: boundedRemotes,
    }).success,
    true,
  )
  assert.equal(
    DoctorReportSchema.safeParse({
      ...report,
      remoteComputers: [
        ...boundedRemotes,
        remoteComputer('machine_remote_overflow'),
      ],
    }).success,
    false,
  )
})

test('Doctor public records reject credential, path, native-session, and raw-error fields', () => {
  const report = doctorReport()
  const claudeIndex = report.providers.findIndex(
    ({ provider }) => provider === 'claude-code',
  )
  const forbiddenProviderFields = {
    executablePath: 'C:\\Users\\owner\\claude.exe',
    nativeSessionId: 'private-native-session',
    apiKey: 'phase8c-secret-sentinel',
    stderr: 'raw provider failure',
  }

  for (const [field, value] of Object.entries(forbiddenProviderFields)) {
    const providers = structuredClone(report.providers)
    providers[claudeIndex][field] = value
    assert.equal(
      DoctorReportSchema.safeParse({ ...report, providers }).success,
      false,
      field,
    )
  }

  const providers = structuredClone(report.providers)
  providers[claudeIndex].backend.authorization =
    'Bearer phase8c-secret-sentinel'
  assert.equal(
    DoctorReportSchema.safeParse({ ...report, providers }).success,
    false,
  )
})

test('Doctor rejects stale or cross-layer false Ready projections', () => {
  const report = doctorReport()
  const staleProviders = structuredClone(report.providers)
  staleProviders[0].backend.freshness = 'last_known'
  assert.equal(
    DoctorReportSchema.safeParse({ ...report, providers: staleProviders })
      .success,
    false,
  )

  const missingProviders = structuredClone(report.providers)
  missingProviders[0].installed = false
  assert.equal(
    DoctorReportSchema.safeParse({ ...report, providers: missingProviders })
      .success,
    false,
  )

  assert.equal(
    DoctorReportSchema.safeParse({
      ...report,
      project: { ...report.project, locations: [] },
    }).success,
    false,
  )
  assert.equal(
    DoctorReportSchema.safeParse({ ...report, project: undefined }).success,
    false,
  )

  const remote = remoteComputer('machine_remote01')
  assert.equal(
    DoctorReportSchema.safeParse({
      ...report,
      remoteComputers: [
        {
          ...remote,
          state: 'ready',
          connectionState: 'offline',
        },
      ],
    }).success,
    false,
  )
})

test('Doctor Ready requires healthy durable state for this computer', () => {
  const report = doctorReport()
  assert.equal(
    DoctorReportSchema.safeParse({
      ...report,
      thisComputer: { ...report.thisComputer, state: 'unavailable' },
    }).success,
    false,
  )
  assert.equal(
    DoctorReportSchema.safeParse({
      ...report,
      overall: 'unavailable',
      thisComputer: { ...report.thisComputer, state: 'unavailable' },
    }).success,
    true,
  )
})

test('Doctor Provider readiness rejects fatal current execution health but preserves last-known history', () => {
  const report = doctorReport()
  const fatal = canonicalFailure('provider_crashed', observedAt)
  const currentProviders = structuredClone(report.providers)
  currentProviders[0].executionHealth = {
    state: 'degraded',
    freshness: 'current',
    observedAt,
    failure: fatal,
  }
  currentProviders[0].failure = fatal

  assert.equal(
    DoctorReportSchema.safeParse({
      ...report,
      providers: currentProviders,
    }).success,
    false,
  )

  currentProviders[0].state = 'unavailable'
  assert.equal(
    DoctorReportSchema.safeParse({
      ...report,
      overall: 'needs_attention',
      providers: currentProviders,
    }).success,
    true,
  )

  const lastKnownProviders = structuredClone(report.providers)
  lastKnownProviders[0].executionHealth = {
    state: 'degraded',
    freshness: 'last_known',
    observedAt,
    failure: fatal,
  }
  lastKnownProviders[0].failure = fatal
  assert.equal(
    DoctorReportSchema.safeParse({
      ...report,
      providers: lastKnownProviders,
    }).success,
    true,
  )

  const degraded = canonicalFailure('rate_limited', observedAt)
  const degradedProviders = structuredClone(report.providers)
  degradedProviders[0].state = 'limited'
  degradedProviders[0].executionHealth = {
    state: 'degraded',
    freshness: 'current',
    observedAt,
    failure: degraded,
  }
  degradedProviders[0].failure = degraded
  assert.equal(
    DoctorReportSchema.safeParse({
      ...report,
      overall: 'limited',
      providers: degradedProviders,
    }).success,
    true,
  )
})

test('Doctor query accepts only an optional opaque Project identity and explicit factual check', () => {
  assert.deepEqual(GetDoctorQuerySchema.parse({}), {})
  assert.deepEqual(
    GetDoctorQuerySchema.parse({ projectId: 'proj_onboarding01' }),
    { projectId: 'proj_onboarding01' },
  )
  assert.deepEqual(
    GetDoctorQuerySchema.parse({
      projectId: 'proj_onboarding01',
      check: 'true',
    }),
    { projectId: 'proj_onboarding01', check: 'true' },
  )
  assert.equal(
    GetDoctorQuerySchema.safeParse({ check: 'false' }).success,
    false,
  )
  assert.equal(
    GetDoctorQuerySchema.safeParse({ projectPath: 'C:\\secret-project' })
      .success,
    false,
  )
})

function onboardingProgress() {
  return {
    flowVersion: 1,
    step: 'ready',
    revision: 5,
    projectId: 'proj_onboarding01',
    machineId: 'machine_onboarding01',
    previousConversationsDisposition: 'reviewed',
    remoteSetupDisposition: 'skipped',
    startedAt: observedAt,
    updatedAt: laterAt,
    completedAt: laterAt,
  }
}

function doctorReport() {
  return {
    generatedAt: laterAt,
    overall: 'ready',
    thisComputer: {
      machineId: 'machine_onboarding01',
      displayName: 'This computer',
      platform: 'windows',
      architecture: 'x64',
      state: 'ready',
    },
    providers: [
      providerStatus('codex', {
        compatibility: 'compatible_unverified',
        backendMode: 'first_party',
        backendReadiness: 'ready',
        backendState: 'ready',
        version: '0.152.0',
      }),
      providerStatus('claude-code', {
        compatibility: 'verified',
        backendMode: 'custom_gateway',
        backendReadiness: 'unavailable',
        backendState: 'unavailable',
        version: '2.1.263',
      }),
    ],
    project: {
      projectId: 'proj_onboarding01',
      name: 'Isolated project',
      state: 'ready',
      locations: [
        {
          machineId: 'machine_onboarding01',
          machineName: 'This computer',
          machineKind: 'local',
          state: 'ready',
        },
      ],
    },
    remoteComputers: [],
  }
}

function providerStatus(
  provider,
  { compatibility, backendMode, backendReadiness, backendState, version },
) {
  return {
    provider,
    state: backendReadiness === 'ready' ? 'ready' : 'needs_attention',
    installed: true,
    selected: true,
    alternateInstallations: provider === 'claude-code' ? 3 : 0,
    version,
    launcherKind: 'native',
    installMethod: 'unknown',
    compatibility,
    runtimeReadiness: 'ready',
    freshness: 'current',
    observedAt,
    backend: {
      state: backendState,
      mode: backendMode,
      readiness: backendReadiness,
      freshness: 'current',
      observedAt,
    },
    sessionDiscovery: 'supported',
  }
}

function remoteComputer(machineId) {
  return {
    machineId,
    displayName: 'Test computer',
    platform: 'linux',
    architecture: 'x64',
    state: 'offline',
    trust: 'trusted',
    connectionState: 'offline',
    executionTransport: 'unavailable',
    providerFreshness: 'last_known',
    observedAt,
    providers: [],
    relay: {
      state: 'offline',
      connectionState: 'offline',
      enrollment: 'enrolled',
      nodePresence: 'offline',
      internetExecutionEnabled: false,
    },
  }
}

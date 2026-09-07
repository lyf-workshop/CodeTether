import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  backendReadinessLabel,
  doctorOverallPresentation,
  isDoctorExecutionContextReady,
  isProviderUsable,
  localOnboardingBlockerText,
  onboardingStepIndex,
  providerCompatibilityLabel,
  providerInstallationGuidance,
  providerRepairText,
  providerVersionLabel,
  remoteComputerRepairText,
  remoteOnboardingBlockerText,
} from '../.tmp/test-dist/components/onboarding/onboarding-model.js'

test('onboarding uses one ordered durable flow vocabulary', () => {
  assert.equal(onboardingStepIndex('welcome'), 0)
  assert.equal(onboardingStepIndex('provider_check'), 2)
  assert.equal(onboardingStepIndex('ready'), 6)
})

test('ready and limited execution remain usable only with a ready backend', () => {
  assert.equal(isProviderUsable(provider({ state: 'ready' })), true)
  assert.equal(
    isProviderUsable(
      provider({ state: 'limited', runtimeReadiness: 'limited' }),
    ),
    true,
  )
  assert.equal(
    isProviderUsable(
      provider({
        state: 'ready',
        backend: backend({ readiness: 'unavailable', state: 'unavailable' }),
      }),
    ),
    false,
  )
  assert.equal(
    isProviderUsable(
      provider({
        state: 'needs_attention',
        compatibility: 'incompatible',
        runtimeReadiness: 'blocked',
      }),
    ),
    false,
  )
})

test('Ready is derived from the exact selected Machine and ProjectLocation', () => {
  const doctor = {
    generatedAt: '2026-09-07T00:00:00.000Z',
    overall: 'ready',
    thisComputer: {
      machineId: 'machine_local',
      displayName: 'This computer',
      platform: 'win32',
      architecture: 'x64',
      state: 'ready',
    },
    providers: [provider({ provider: 'codex' })],
    project: {
      projectId: 'proj_context',
      name: 'Project',
      state: 'ready',
      locations: [
        {
          machineId: 'machine_local',
          machineName: 'This computer',
          machineKind: 'local',
          state: 'ready',
        },
        {
          machineId: 'machine_remote',
          machineName: 'Office computer',
          machineKind: 'remote',
          state: 'offline',
        },
      ],
    },
    remoteComputers: [
      {
        machineId: 'machine_remote',
        displayName: 'Office computer',
        platform: 'linux',
        architecture: 'x64',
        state: 'offline',
        trust: 'trusted',
        connectionState: 'offline',
        providerFreshness: 'last_known',
        providers: [provider({ provider: 'claude-code' })],
        relay: {
          state: 'offline',
          connectionState: 'disconnected',
          enrollment: 'enrolled',
          nodePresence: 'offline',
          internetExecutionEnabled: false,
        },
      },
    ],
  }

  assert.equal(
    isDoctorExecutionContextReady(doctor, 'proj_context', 'machine_local'),
    true,
  )
  assert.equal(
    isDoctorExecutionContextReady(doctor, 'proj_context', 'machine_remote'),
    false,
    'a different ready Location must not make the selected offline Machine ready',
  )

  const onlineRemote = {
    ...doctor,
    project: {
      ...doctor.project,
      locations: doctor.project.locations.map((location) =>
        location.machineId === 'machine_remote'
          ? { ...location, state: 'ready' }
          : location,
      ),
    },
    remoteComputers: [
      {
        ...doctor.remoteComputers[0],
        state: 'needs_attention',
        connectionState: 'online',
        providerFreshness: 'current',
        providers: [
          provider({
            provider: 'claude-code',
            state: 'unavailable',
            backend: backend({
              readiness: 'unavailable',
              state: 'unavailable',
            }),
          }),
        ],
      },
    ],
  }
  assert.equal(
    isDoctorExecutionContextReady(
      onlineRemote,
      'proj_context',
      'machine_remote',
    ),
    false,
  )
  assert.match(
    remoteOnboardingBlockerText(
      onlineRemote.remoteComputers[0],
      'ready',
      false,
    ),
    /项目文件夹可用.*AI 服务当前不可用.*无需重新选择项目或重新配对/u,
  )

  const changedLocalContext = {
    ...doctor,
    project: {
      ...doctor.project,
      locations: doctor.project.locations.map((location) =>
        location.machineId === 'machine_local'
          ? { ...location, state: 'unavailable' }
          : location,
      ),
    },
  }
  assert.equal(
    isDoctorExecutionContextReady(
      changedLocalContext,
      'proj_context',
      'machine_local',
    ),
    false,
    'a folder that changed after selection must not retain a stale Ready claim',
  )
  assert.match(
    localOnboardingBlockerText(changedLocalContext, 'unavailable', false),
    /项目文件夹当前不可用/u,
  )
})

test('new compatible versions use calm compatibility copy', () => {
  assert.equal(
    providerCompatibilityLabel(
      provider({ compatibility: 'compatible_unverified' }),
    ),
    '兼容 — 检测到新版本',
  )
})

test('offline unobserved Provider facts never fabricate a missing installation', () => {
  const unobserved = provider({
    state: 'offline',
    installed: false,
    selected: false,
    version: undefined,
    compatibility: undefined,
    runtimeReadiness: undefined,
    freshness: 'not_observed',
    observedAt: undefined,
    backend: undefined,
    sessionDiscovery: 'unknown',
  })
  assert.equal(providerVersionLabel(unobserved), '尚未检查')
  assert.equal(providerCompatibilityLabel(unobserved), '尚未检查')
  assert.match(providerRepairText(unobserved), /状态尚未检查/u)
  assert.doesNotMatch(providerRepairText(unobserved), /安装后/u)

  const lastKnownMissing = {
    ...unobserved,
    freshness: 'last_known',
    observedAt: '2026-09-07T00:00:00.000Z',
  }
  assert.equal(providerVersionLabel(lastKnownMissing), '上次检查：未安装')
  assert.equal(providerCompatibilityLabel(lastKnownMissing), '上次检查：未安装')
  assert.match(providerRepairText(lastKnownMissing), /上次检查.*不代表当前/u)
})

test('Doctor overall copy diagnoses the responsible layer without blaming every failure on a Project', () => {
  const base = {
    generatedAt: '2026-09-07T00:00:00.000Z',
    overall: 'needs_attention',
    thisComputer: {
      machineId: 'machine_local',
      displayName: 'This computer',
      platform: 'win32',
      architecture: 'x64',
      state: 'ready',
    },
    providers: [
      provider({
        state: 'needs_attention',
        backend: backend({
          state: 'needs_attention',
          readiness: 'authentication_required',
        }),
      }),
    ],
    remoteComputers: [],
  }

  assert.match(doctorOverallPresentation(base).title, /AI 工具或服务/u)
  assert.doesNotMatch(doctorOverallPresentation(base).title, /项目/u)
  assert.match(
    doctorOverallPresentation({ ...base, overall: 'unknown' }).title,
    /尚未完全检查/u,
  )
  assert.match(
    doctorOverallPresentation({
      ...base,
      overall: 'unavailable',
      thisComputer: { ...base.thisComputer, state: 'unavailable' },
    }).detail,
    /应用服务当前不可用/u,
  )
  assert.match(
    doctorOverallPresentation({
      ...base,
      project: {
        projectId: 'proj_context',
        name: 'Project',
        state: 'unavailable',
        locations: [],
      },
    }).title,
    /当前项目需要处理/u,
  )
})

test('authentication guidance follows the effective backend mode', () => {
  const firstParty = provider({
    backend: backend({
      mode: 'first_party',
      readiness: 'authentication_required',
      state: 'needs_attention',
    }),
  })
  const gateway = provider({
    backend: backend({
      mode: 'custom_gateway',
      readiness: 'authentication_required',
      state: 'needs_attention',
    }),
  })

  assert.equal(backendReadinessLabel(firstParty.backend), '需要登录')
  assert.equal(backendReadinessLabel(gateway.backend), '需要检查配置')
  assert.match(providerRepairText(firstParty), /官方登录流程/u)
  assert.match(providerRepairText(gateway), /无需登录第一方服务/u)
})

test('current execution health produces canonical targeted Doctor guidance', () => {
  const cases = [
    ['usage_limit_reached', '配额', '等待配额恢复'],
    ['rate_limited', '请求频率', '稍后'],
    ['provider_service_unavailable', '无法接受执行请求', '稍后'],
    ['provider_crashed', '意外退出', '确认执行环境'],
  ]
  for (const [reason, cause, guidance] of cases) {
    const result = providerRepairText(
      provider({
        state: reason === 'provider_crashed' ? 'unavailable' : 'limited',
        executionHealth: {
          state: reason === 'provider_crashed' ? 'unavailable' : 'degraded',
          freshness: 'current',
          failure: canonicalFailure(reason),
        },
      }),
    )
    assert.match(result, new RegExp(cause, 'u'))
    assert.match(result, new RegExp(guidance, 'u'))
    assert.doesNotMatch(result, /重新安装/u)
  }

  assert.equal(
    providerRepairText(
      provider({
        executionHealth: {
          state: 'unavailable',
          freshness: 'last_known',
          failure: canonicalFailure('provider_crashed'),
        },
      }),
    ),
    'CodeTether 会在新执行前再次验证当前状态。',
  )
})

test('missing providers point only to verified official guidance', () => {
  assert.equal(
    providerInstallationGuidance.codex.href,
    'https://developers.openai.com/codex/cli',
  )
  assert.equal(
    providerInstallationGuidance['claude-code'].href,
    'https://docs.anthropic.com/en/docs/claude-code/getting-started',
  )
})

test('setup and Doctor compose existing bounded operations without inference or install commands', () => {
  const setup = source('../src/components/onboarding/onboarding-page.tsx')
  const doctor = source('../src/components/doctor/doctor-page.tsx')
  const combined = `${setup}\n${doctor}`

  assert.match(setup, /AddProjectDialog/u)
  assert.match(setup, /PreviousConversationsStep/u)
  assert.match(setup, /AddRemoteMachineDialog/u)
  assert.match(setup, /AddProjectLocationDialog/u)
  assert.match(setup, /createNewProject/u)
  assert.match(setup, /const selectedLocation =\s*localLocation \?\?/u)
  assert.match(setup, /machine\.connectionState === 'online'/u)
  assert.match(setup, /使用另一台电脑上的项目/u)
  assert.match(setup, /presentation="ordinary"/u)
  assert.match(doctor, /refreshMachinesBounded/u)
  assert.match(doctor, /refreshMachineProviders/u)
  assert.match(setup, /runtime\.refreshMachineProviders\(machineId\)/u)
  assert.match(setup, /remoteOnboardingBlockerText/u)
  assert.match(setup, /localOnboardingBlockerText/u)
  assert.match(setup, /onboarding\?\.step !== 'ready'/u)
  assert.match(setup, /runtime\.getDoctor\(\{[\s\S]*check: true/u)
  assert.match(
    setup,
    /executionPathReady\s*=\s*props\.contextCheckCurrent\s*&&\s*!props\.contextCheckFailed\s*&&/u,
  )
  assert.match(setup, /providerRefreshFailed/u)
  assert.match(setup, /currentlyConfirmedMissing/u)
  assert.match(setup, /providerVersionLabel\(provider\)/u)
  assert.doesNotMatch(
    setup,
    /\{!provider\.installed \? \([\s\S]*?<ProviderGuidanceLink/u,
  )
  assert.match(setup, /不会把旧状态当作新的结果/u)
  assert.match(doctor, /check: true/u)
  assert.match(doctor, /部分电脑暂时无法完成检查/u)
  assert.match(combined, /aria-live="polite"/u)
  assert.match(combined, /<details/u)
  assert.doesNotMatch(combined, /startTurn|startNewTurn/u)
  assert.doesNotMatch(
    combined,
    /npm\s+install|brew\s+(?:install|upgrade)|claude\s+update/u,
  )
})

test('routing and settings expose setup and permanent Doctor access', () => {
  const router = source('../src/router.tsx')
  const shell = source('../src/components/app-shell/app-shell.tsx')
  const startup = source('../src/components/onboarding/startup-gate.tsx')
  const setup = source('../src/components/onboarding/onboarding-page.tsx')
  const settings = source(
    '../src/components/settings/desktop-notification-settings.tsx',
  )

  assert.match(router, /path: '\/setup'/u)
  assert.match(router, /path: '\/doctor'/u)
  assert.match(router, /component: StartupGate/u)
  assert.match(startup, /data\.step === 'ready'/u)
  assert.doesNotMatch(
    startup,
    /data\.step === 'ready'\s*\|\|\s*onboardingQuery\.data\.completedAt/u,
  )
  assert.match(startup, /runtime\.retry\(\)/u)
  assert.match(startup, /startupGateRecoveryDelay/u)
  assert.match(startup, /window\.setTimeout/u)
  assert.doesNotMatch(startup, /setInterval/u)
  assert.match(shell, /onHelp=/u)
  assert.match(shell, /to: '\/doctor'/u)
  assert.match(settings, /kind: 'reopen'/u)
  assert.match(settings, /to="\/doctor"/u)
  assert.match(setup, /isDoctorExecutionContextReady/u)
  assert.match(setup, /onError:[\s\S]*onboardingQuery\.refetch/u)
  assert.match(setup, /onboardingContentReady/u)
  assert.match(setup, /\[onboardingContentReady, onboardingStep\]/u)
})

test('legacy admission pressure copy is narrowed for refresh without changing pairing copy', () => {
  const machineActions = source('../src/runtime/host/machine-actions.ts')
  assert.match(
    machineActions,
    /case 'machine_pairing_rate_limited':[\s\S]*operation === 'refresh-providers'[\s\S]*暂时忙碌/u,
  )
  assert.match(machineActions, /配对尝试过多/u)
})

test('remote Doctor recovery copy preserves distinct secure connection states', () => {
  assert.match(remoteComputerRepairText('connecting'), /建立安全连接/u)
  assert.match(remoteComputerRepairText('offline'), /无需重新配对/u)
  assert.match(remoteComputerRepairText('recovery_required'), /更新连接地址/u)
  assert.match(
    remoteComputerRepairText('authentication_failed'),
    /无法验证.*已信任身份/u,
  )
  assert.match(
    remoteComputerRepairText('authentication_failed'),
    /不会自动接受/u,
  )
  assert.match(remoteComputerRepairText('incompatible'), /远程组件.*不兼容/u)
  assert.equal(remoteComputerRepairText('online'), undefined)
})

test('remote Doctor cards show connection-specific recovery and bounded Provider layers', () => {
  const doctor = source('../src/components/doctor/doctor-page.tsx')

  assert.match(
    doctor,
    /machineConnectionStateLabel\(machine\.connectionState\)/u,
  )
  assert.match(doctor, /remoteComputerRepairText\(machine\.connectionState\)/u)
  assert.match(doctor, /providerCompatibilityLabel\(provider\)/u)
  assert.match(doctor, /providerVersionLabel\(provider\)/u)
  assert.match(doctor, /currentlyConfirmedMissing/u)
  assert.match(doctor, /backendModeLabel\(provider\.backend\)/u)
  assert.match(doctor, /backendReadinessLabel\(provider\.backend\)/u)
  assert.match(doctor, /sessionDiscoveryLabel\(provider\.sessionDiscovery\)/u)
  assert.match(doctor, /doctorOverallPresentation\(doctor\)/u)
  assert.match(doctor, /restoreCheckFocusRef\.current = true/u)
  assert.match(
    doctor,
    /!restoreCheckFocusRef\.current[\s\S]*restoreCheckFocusRef\.current = false[\s\S]*checkButtonRef\.current\?\.focus\(\)/u,
  )
  assert.doesNotMatch(
    doctor,
    /requestAnimationFrame\(\(\) => checkButtonRef\.current\?\.focus\(\)\)/u,
  )
  assert.match(
    doctor,
    /provider\.state !== 'ready'[\s\S]*providerRepairText\(provider\)/u,
  )
  assert.match(doctor, /远程项目文件夹尚未完成当前检查/u)
  assert.match(doctor, /项目所在电脑当前离线/u)
  assert.doesNotMatch(
    doctor,
    /machine\.connectionState === 'online' \? '已连接' : '当前离线'/u,
  )
})

function provider(overrides = {}) {
  return {
    provider: 'claude-code',
    state: 'ready',
    installed: true,
    selected: true,
    alternateInstallations: 0,
    version: '2.1.263',
    compatibility: 'verified',
    runtimeReadiness: 'ready',
    freshness: 'current',
    sessionDiscovery: 'supported',
    backend: backend(),
    ...overrides,
  }
}

function backend(overrides = {}) {
  return {
    state: 'ready',
    mode: 'custom_gateway',
    readiness: 'ready',
    freshness: 'current',
    ...overrides,
  }
}

function canonicalFailure(reason) {
  const profiles = {
    usage_limit_reached: ['quota', 'retry_later', 'wait', 'provider'],
    rate_limited: ['quota', 'retry_later', 'wait', 'provider'],
    provider_service_unavailable: [
      'provider',
      'retry_later',
      'wait',
      'provider',
    ],
    provider_crashed: ['provider', 'retry_now', 'retry', 'provider'],
  }
  const [category, retryability, userAction, source] = profiles[reason]
  return {
    category,
    reason,
    retryability,
    userAction,
    source,
    occurredAt: '2026-09-07T00:00:00.000Z',
    technicalCode: reason,
  }
}

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

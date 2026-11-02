import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DoctorProviderStatusSchema } from '@codetether/protocol'
import { loadWebComponent } from './fixtures/render-ui.mjs'

const model = loadWebComponent('components/onboarding/onboarding-model.ts')
const { OnboardingProviderCheck, OnboardingProviderCard } = loadWebComponent(
  'components/onboarding/onboarding-provider-check.tsx',
)
const { OnboardingReadyStep } = loadWebComponent(
  'components/onboarding/onboarding-ready-step.tsx',
)
const timestamp = '2026-10-19T12:00:00.000Z'

test('installed compatible tools with unknown services show three separate facts and Continue without proving execution ready', () => {
  const providers = [
    provider({
      provider: 'codex',
      version: '0.162.1',
      compatibility: 'compatible_unverified',
    }),
    provider(),
  ]
  const html = panel(providers)
  assert.equal(
    (html.match(/data-provider-fact="installation"/gu) ?? []).length,
    2,
  )
  assert.equal((html.match(/data-provider-fact="runtime"/gu) ?? []).length, 2)
  assert.equal((html.match(/data-provider-fact="service"/gu) ?? []).length, 2)
  for (const label of [
    '已安装',
    '运行环境',
    '可用',
    '兼容',
    'AI 服务',
    '尚未验证',
    '继续设置',
  ])
    assert.ok(html.includes(label))
  assert.match(html, /开始首次对话时验证 AI 服务/u)
  assert.match(html, /兼容的新版本，尚未完整验证/u)
  assert.match(html, /设置过程不会发送消息或消耗模型额度/u)
  assert.match(
    html,
    /<dl class="grid grid-cols-1 gap-3 text-sm above-phone:grid-cols-3"/u,
  )
  assert.doesNotMatch(
    html,
    /暂不设置 AI 工具|不能运行|一切就绪|查看官方登录指南/u,
  )
  assert.ok(providers.every((item) => model.isProviderUsable(item) === false))
})

test('one installed usable tool suffices for Continue while the missing tool retains its own official installation guide', () => {
  const html = panel([provider({ provider: 'codex' }), missing()])
  assert.match(html, /继续设置/u)
  assert.match(html, /查看 Claude Code 官方安装指南/u)
  assert.doesNotMatch(html, /查看 Codex 官方安装指南|暂不设置 AI 工具/u)
})

test('both truly missing tools keep explicit missing facts, official guides, recheck and an enabled skip route', () => {
  const html = panel([missing({ provider: 'codex' }), missing()])
  assert.match(html, /未安装/u)
  assert.match(html, /查看 Codex 官方安装指南/u)
  assert.match(html, /查看 Claude Code 官方安装指南/u)
  assert.match(html, /重新检查/u)
  assert.match(html, /暂不设置 AI 工具/u)
  assert.doesNotMatch(html, /<button[^>]*disabled=""/u)
})

for (const [name, overrides, expected] of [
  [
    'official authentication',
    {
      state: 'needs_attention',
      backend: backend({
        mode: 'first_party',
        readiness: 'authentication_required',
        state: 'needs_attention',
      }),
    },
    /需要登录/u,
  ],
  [
    'custom service authentication',
    {
      state: 'needs_attention',
      backend: backend({
        readiness: 'authentication_required',
        state: 'needs_attention',
      }),
    },
    /需要检查配置/u,
  ],
  [
    'custom service misconfiguration',
    {
      state: 'needs_attention',
      backend: backend({
        readiness: 'misconfigured',
        state: 'needs_attention',
      }),
    },
    /需要检查配置/u,
  ],
  [
    'known service unavailability',
    {
      state: 'unavailable',
      backend: backend({ readiness: 'unavailable', state: 'unavailable' }),
    },
    /暂时不可用/u,
  ],
  [
    'incompatible runtime',
    {
      state: 'needs_attention',
      compatibility: 'incompatible',
      runtimeReadiness: 'blocked',
    },
    /需要更新 CodeTether/u,
  ],
]) {
  test(
    'known ' + name + ' is not hidden behind the unknown-service explanation',
    () => {
      const item = provider(overrides)
      const html = renderToStaticMarkup(
        h(OnboardingProviderCard, { provider: item }),
      )
      assert.match(html, expected)
      assert.doesNotMatch(html, /开始首次对话时验证 AI 服务/u)
      assert.equal(model.onboardingProviderServiceUnverified(item), false)
      if (item.backend?.mode !== 'first_party')
        assert.doesNotMatch(html, /查看官方登录指南/u)
      else assert.match(html, /查看官方登录指南/u)
    },
  )
}

test('custom gateway unknown does not require official login, switching, reinstall or a test message', () => {
  const html = panel([provider()])
  assert.match(html, /自定义 AI 服务/u)
  assert.match(html, /尚未验证/u)
  assert.match(html, /无需为了完成设置专门发送测试消息/u)
  assert.doesNotMatch(
    html,
    /查看官方登录指南|查看 Claude Code 官方安装指南|请.*切换/u,
  )
})

test('unobserved and last-known facts never fabricate a current missing installation or current executable service', () => {
  const lastKnown = provider({
    freshness: 'last_known',
    state: 'unknown',
    backend: backend({ freshness: 'last_known' }),
  })
  const unobserved = provider({
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
  for (const item of [lastKnown, unobserved]) {
    const html = renderToStaticMarkup(
      h(OnboardingProviderCard, { provider: item }),
    )
    assert.equal(model.onboardingProviderServiceUnverified(item), false)
    assert.doesNotMatch(
      html,
      /查看 Claude Code 官方安装指南|开始首次对话时验证 AI 服务/u,
    )
    assert.match(html, item === lastKnown ? /上次检查/u : /尚未检查/u)
  }
})

test('translated discovery and install metadata never expose raw unknown or supported values', () => {
  for (const sessionDiscovery of [
    'supported',
    'unsupported',
    'unavailable',
    'unknown',
  ]) {
    const html = renderToStaticMarkup(
      h(OnboardingProviderCard, {
        provider: provider({ sessionDiscovery, installMethod: 'unknown' }),
      }),
    )
    assert.doesNotMatch(
      html,
      /<dd[^>]*>(?:unknown|supported|unsupported|unavailable)<\/dd>/u,
    )
  }
})

test('unknown service completion stays non-ready and opens existing context without requiring a test message', () => {
  const doctor = report([provider()])
  const html = renderToStaticMarkup(
    h(OnboardingReadyStep, {
      doctor,
      onboarding: {
        step: 'ready',
        machineId: doctor.thisComputer.machineId,
        projectId: 'proj_setup01',
      },
      busy: false,
      contextCheckCurrent: true,
      contextCheckFailed: false,
      onStart() {},
      onCheckSelectedContext() {},
    }),
  )
  assert.match(html, /CodeTether 设置完成/u)
  assert.match(html, /尚未验证/u)
  assert.match(html, /打开 CodeTether/u)
  assert.doesNotMatch(
    html,
    /一切就绪|data-execution-ready="true"|AI 工具就绪后才能/u,
  )
  assert.equal(
    model.isDoctorExecutionContextReady(
      doctor,
      'proj_setup01',
      doctor.thisComputer.machineId,
    ),
    false,
  )
})

for (const [name, overrides, mutate] of [
  ['failed exact context check', { contextCheckFailed: true }, () => {}],
  [
    'missing selected location',
    {},
    (doctor) => {
      doctor.project.locations = []
    },
  ],
  [
    'different requested device',
    {
      onboarding: {
        step: 'ready',
        machineId: 'machine_other01',
        projectId: 'proj_setup01',
      },
    },
    () => {},
  ],
]) {
  test('unknown service presentation cannot mask ' + name, () => {
    const doctor = report([provider()])
    mutate(doctor)
    const html = renderToStaticMarkup(
      h(OnboardingReadyStep, {
        doctor,
        onboarding: {
          step: 'ready',
          machineId: doctor.thisComputer.machineId,
          projectId: 'proj_setup01',
        },
        busy: false,
        contextCheckCurrent: true,
        contextCheckFailed: false,
        onStart() {},
        onCheckSelectedContext() {},
        ...overrides,
      }),
    )
    assert.doesNotMatch(
      html,
      /项目和运行环境已检查|开始首次对话时验证 AI 服务|一切就绪|data-execution-ready="true"/u,
    )
    if (overrides.contextCheckFailed)
      assert.match(html, /当前检查暂时未能完成/u)
    if (name === 'different requested device')
      assert.match(html, /不会改用其他设备/u)
  })
}

test('split views remain presentation-only while page owns Query, durable transitions and bounded checks', async () => {
  const names = [
    'onboarding-page.tsx',
    'onboarding-step-view.tsx',
    'onboarding-provider-check.tsx',
    'onboarding-project-step.tsx',
    'onboarding-remote-step.tsx',
    'onboarding-ready-step.tsx',
    'onboarding-step-feedback.tsx',
  ]
  const sources = await Promise.all(
    names.map((name) =>
      readFile(
        new URL('../src/components/onboarding/' + name, import.meta.url),
        'utf8',
      ),
    ),
  )
  assert.ok(sources[0].split('\n').length < 550)
  assert.match(sources[0], /<OnboardingStepView/u)
  assert.match(sources[0], /continueOnboardingChecks\(progress, commit\)/u)
  assert.match(sources[0], /runtime\.refreshMachineProviders/u)
  for (let index = 1; index < sources.length; index += 1) {
    assert.ok(sources[index].split('\n').length <= 400, names[index])
    assert.doesNotMatch(
      sources[index],
      /useQuery|useMutation|useHostRuntime|fetch\(|startTurn|startNewTurn|setInterval/u,
    )
  }
  for (const name of [
    'OnboardingProviderCheck',
    'OnboardingProjectStep',
    'OnboardingRemoteStep',
    'OnboardingReadyStep',
  ])
    assert.ok(sources[1].includes('<' + name))
})

function panel(providers) {
  return renderToStaticMarkup(
    h(OnboardingProviderCheck, {
      doctor: report(providers),
      busy: false,
      providerRefreshFailed: false,
      onContinue() {},
      onProviderRefresh() {},
    }),
  )
}
function provider(overrides = {}) {
  return DoctorProviderStatusSchema.parse({
    provider: 'claude-code',
    state: 'unknown',
    installed: true,
    selected: true,
    alternateInstallations: 0,
    version: '2.1.251',
    compatibility: 'verified',
    runtimeReadiness: 'ready',
    freshness: 'current',
    observedAt: timestamp,
    sessionDiscovery: 'supported',
    backend: backend(),
    ...overrides,
  })
}
function backend(overrides = {}) {
  return {
    state: 'unknown',
    mode: 'custom_gateway',
    readiness: 'unknown',
    freshness: 'current',
    observedAt: timestamp,
    ...overrides,
  }
}
function missing(overrides = {}) {
  return provider({
    installed: false,
    selected: false,
    version: undefined,
    compatibility: undefined,
    runtimeReadiness: undefined,
    state: 'needs_attention',
    sessionDiscovery: 'unknown',
    backend: undefined,
    ...overrides,
  })
}
function report(providers) {
  return {
    thisComputer: {
      machineId: 'machine_setup01',
      displayName: '这台电脑',
      platform: 'win32',
      architecture: 'x64',
      state: 'ready',
    },
    providers,
    remoteComputers: [],
    project: {
      projectId: 'proj_setup01',
      name: '测试项目',
      state: 'unknown',
      locations: [
        {
          machineId: 'machine_setup01',
          machineName: '这台电脑',
          machineKind: 'local',
          state: 'ready',
        },
      ],
    },
  }
}

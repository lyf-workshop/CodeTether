import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  machineProviderSummary,
  providerSummary,
} from '../.tmp/test-dist/provider/provider-presentation.js'
import { newConversationProviderEligibility } from '../.tmp/test-dist/components/conversations/new-conversation-provider-selection.js'
import { conversationCreationProviderOptions } from '../.tmp/test-dist/components/conversations/new-conversation-selection.js'
import { loadWebComponent } from './fixtures/render-ui.mjs'

const { MachineProviderBadge, ProviderSummaryBadge } = loadWebComponent(
  'provider/provider-summary-badge.tsx',
)

const time = '2026-11-19T12:00:00Z'
const descriptor = {
  provider: 'codex',
  displayName: 'Codex',
  availability: 'available',
}
function lifecycle(compatibility, readiness = 'ready', mode = 'first_party') {
  return {
    provider: 'codex',
    selectedInstallationId: 'installation_1',
    installations: [
      {
        installationId: 'installation_1',
        selected: true,
        availability: 'available',
        compatibility: {
          state: compatibility,
          freshness: 'current',
          observedAt: time,
        },
        backend: { mode, readiness, freshness: 'current', observedAt: time },
      },
    ],
  }
}
for (const [name, availability, group, health, label, variant] of [
  [
    'available',
    'available',
    lifecycle('verified'),
    undefined,
    '可用',
    'success',
  ],
  [
    'limited compatibility',
    'available',
    lifecycle('limited'),
    undefined,
    '可用，部分功能受限',
    'warning',
  ],
  [
    'degraded health',
    'available',
    lifecycle('verified'),
    { state: 'degraded', freshness: 'current' },
    '可用，部分功能受限',
    'warning',
  ],
  [
    'authentication',
    'available',
    lifecycle('verified', 'authentication_required'),
    undefined,
    '未登录',
    'warning',
  ],
  [
    'unsupported version',
    'unsupported_version',
    undefined,
    undefined,
    '需要更新此 AI 工具',
    'warning',
  ],
  [
    'incompatible also reported as unsupported',
    'unsupported_version',
    lifecycle('incompatible'),
    undefined,
    '需要更新 CodeTether',
    'warning',
  ],
  ['missing', 'not_installed', undefined, undefined, '未安装', 'secondary'],
  [
    'misconfigured',
    'misconfigured',
    undefined,
    undefined,
    '暂时不可用',
    'danger',
  ],
  [
    'current unavailable health takes priority over limited compatibility',
    'available',
    lifecycle('limited'),
    { state: 'unavailable', freshness: 'current' },
    '暂时不可用',
    'danger',
  ],
  [
    'explicit unknown service',
    'available',
    lifecycle('verified', 'unknown'),
    undefined,
    '已安装，待确认',
    'secondary',
  ],
  [
    'gateway authentication needs configuration',
    'available',
    lifecycle('verified', 'authentication_required', 'custom_gateway'),
    undefined,
    '暂时不可用',
    'danger',
  ],
]) {
  test('Machine/provider summary: ' + name, () => {
    const summary = machineProviderSummary(
      {
        providers: [{ ...descriptor, availability, executionHealth: health }],
        providerLifecycles: group ? [group] : [],
      },
      'codex',
    )
    assert.deepEqual(summary.status, { label, variant })
  })
}

test('last-known execution failure and degradation stay dated secondary context', () => {
  for (const [state, copy] of [
    ['unavailable', '上次运行失败'],
    ['degraded', '上次运行受限'],
  ]) {
    const summary = providerSummary(
      {
        ...descriptor,
        executionHealth: {
          state,
          freshness: 'last_known',
          observedAt: '2026-10-22T12:00:00Z',
          failure: {
            reason: 'provider_service_unavailable',
            userAction: 'retry',
          },
        },
      },
      lifecycle('verified'),
    )
    assert.deepEqual(summary.status, { label: '可用', variant: 'success' })
    assert.equal(summary.advisory, undefined)
    assert.match(summary.executionHistoryLabel, new RegExp(copy, 'u'))
    assert.match(summary.executionHistoryLabel, /10月22日/u)
    const markup = renderToStaticMarkup(h(ProviderSummaryBadge, { summary }))
    assert.match(markup, /可用/u)
    assert.match(markup, /上次运行/u)
    assert.doesNotMatch(markup, /danger/u)
  }
})

test('shared badge placements keep row badges right aligned and inline notes after supporting copy', () => {
  const summary = providerSummary({
    ...descriptor,
    executionHealth: {
      state: 'unavailable',
      freshness: 'last_known',
      observedAt: '2026-10-22T12:00:00Z',
    },
  })
  const row = renderToStaticMarkup(h(ProviderSummaryBadge, { summary }))
  assert.match(row, /justify-self-end/u)
  assert.match(row, /items-end/u)
  assert.match(row, /上次运行失败 · 10月22日/u)

  const inline = renderToStaticMarkup(
    h(
      'span',
      { className: 'flex flex-wrap' },
      'Claude Code',
      h(ProviderSummaryBadge, {
        summary,
        placement: 'inline',
        supportingContent: h(
          'span',
          { id: 'capability', className: 'basis-full' },
          '可以读取和搜索文件',
        ),
      }),
    ),
  )
  assert.match(inline, /Claude Code<[^>]+data-slot="badge"/u)
  assert.ok(inline.indexOf('id="capability"') < inline.indexOf('上次运行失败'))
  assert.match(inline, /basis-full text-left text-xs/u)
  assert.doesNotMatch(inline, /justify-self-end/u)
})

test('current execution failure remains a red summary', () => {
  const summary = providerSummary(
    {
      ...descriptor,
      executionHealth: {
        state: 'unavailable',
        freshness: 'current',
        observedAt: time,
        failure: {
          reason: 'provider_service_unavailable',
          userAction: 'retry',
        },
      },
    },
    lifecycle('verified'),
  )
  assert.deepEqual(summary.status, {
    label: '暂时不可用',
    variant: 'danger',
  })
  assert.equal(summary.executionHistoryLabel, undefined)
})

test('local startup checking is one neutral shared summary across machine surfaces', () => {
  const pending = {
    ...descriptor,
    availability: 'unavailable',
    executionHealth: { state: 'unknown', freshness: 'current' },
  }
  const detail = {
    machine: { kind: 'local', connectionState: 'local' },
    providers: [pending],
    providerLifecycles: [{ provider: 'codex', installations: [] }],
  }
  const summary = machineProviderSummary(detail, 'codex')
  assert.equal(summary.checking, true)
  assert.deepEqual(summary.status, {
    label: '正在检查…',
    variant: 'secondary',
  })
  assert.equal(summary.advisory, undefined)
  assert.deepEqual(
    machineProviderSummary(
      {
        providers: detail.providers,
        providerLifecycles: detail.providerLifecycles,
      },
      'codex',
      'local',
    ).status,
    summary.status,
  )
  const badge = renderToStaticMarkup(
    h(MachineProviderBadge, { read: { data: detail }, provider: 'codex' }),
  )
  assert.match(badge, /正在检查…/u)
  assert.match(badge, /data-variant="secondary"/u)
  assert.doesNotMatch(badge, /data-variant="danger"/u)

  const remote = machineProviderSummary(
    { ...detail, machine: { kind: 'remote', connectionState: 'online' } },
    'codex',
  )
  assert.equal(remote.checking, undefined)
  assert.notEqual(remote.status?.label, '正在检查…')
})

test('current compatibility or execution failure excludes the local checking state', () => {
  const pending = {
    ...descriptor,
    availability: 'unavailable',
    executionHealth: { state: 'unknown', freshness: 'last_known' },
  }
  assert.equal(
    providerSummary(pending, lifecycle('verified'), undefined, 'local')
      .checking,
    undefined,
  )
  const oldCompatibility = lifecycle('verified')
  oldCompatibility.installations[0].compatibility.freshness = 'last_known'
  const currentFailure = providerSummary(
    {
      ...pending,
      executionHealth: { state: 'unavailable', freshness: 'current' },
    },
    oldCompatibility,
    undefined,
    'local',
  )
  assert.equal(currentFailure.checking, undefined)
  assert.deepEqual(currentFailure.status, {
    label: '暂时不可用',
    variant: 'danger',
  })
})

test('last-known version and login failures cannot override current tool facts', () => {
  for (const failure of [
    { reason: 'provider_unsupported_version', userAction: 'update_provider' },
    {
      reason: 'provider_authentication_required',
      userAction: 'login_on_machine',
    },
  ]) {
    const summary = providerSummary(
      {
        ...descriptor,
        executionHealth: {
          state: 'unavailable',
          freshness: 'last_known',
          observedAt: '2026-10-22T12:00:00Z',
          failure,
        },
      },
      lifecycle('verified'),
    )
    assert.deepEqual(summary.status, { label: '可用', variant: 'success' })
    assert.match(summary.executionHistoryLabel, /上次运行失败 · 10月22日/u)
  }
})

test('a nonconnected computer has neutral tool rows with or without installation evidence', () => {
  const states = [
    'connecting',
    'offline',
    'recovery_required',
    'authentication_failed',
    'incompatible',
  ]
  for (const connectionState of states) {
    const known = {
      machine: { connectionState },
      providers: [
        {
          ...descriptor,
          availability: 'unavailable',
          executionHealth: { state: 'unknown', freshness: 'last_known' },
        },
      ],
      providerLifecycles: [lifecycle('verified')],
      providerDiscovery: { state: 'last_known', observedAt: time },
    }
    const knownSummary = machineProviderSummary(known, 'codex')
    assert.deepEqual(knownSummary.status, {
      label: '已安装，待确认',
      variant: 'secondary',
    })
    const knownMarkup = renderToStaticMarkup(
      h(MachineProviderBadge, { read: { data: known }, provider: 'codex' }),
    )
    assert.match(knownMarkup, /data-variant="secondary"/u)
    assert.doesNotMatch(knownMarkup, /data-variant="danger"/u)

    const unknown = { ...known, providerLifecycles: [] }
    const unknownSummary = machineProviderSummary(unknown, 'codex')
    assert.equal(unknownSummary.status, undefined)
    assert.equal(unknownSummary.freshnessLabel, '电脑未连接')
    const markup = renderToStaticMarkup(
      h(MachineProviderBadge, { read: { data: unknown }, provider: 'codex' }),
    )
    assert.match(markup, /电脑未连接/u)
    assert.doesNotMatch(markup, /data-slot="badge"/u)
  }
  const noDataMarkup = renderToStaticMarkup(
    h(MachineProviderBadge, {
      provider: 'codex',
      connectionState: 'offline',
    }),
  )
  assert.match(noDataMarkup, /电脑未连接/u)
  assert.doesNotMatch(noDataMarkup, /data-slot="badge"/u)
})

test('computer card summary uses the latest list connection state over cached detail', () => {
  const cachedDetail = {
    machine: { connectionState: 'online' },
    providers: [{ ...descriptor, availability: 'unavailable' }],
    providerLifecycles: [lifecycle('verified')],
  }
  const summary = machineProviderSummary(cachedDetail, 'codex', 'offline')
  assert.equal(summary.status.variant, 'secondary')
  assert.match(
    renderToStaticMarkup(
      h(MachineProviderBadge, {
        read: { data: cachedDetail },
        provider: 'codex',
        connectionState: 'offline',
      }),
    ),
    /data-variant="secondary"/u,
  )
})

test('New Conversation renders neutral tool context for a fixed offline computer', () => {
  const [option] = conversationCreationProviderOptions(
    [
      {
        ...descriptor,
        availability: 'unavailable',
        available: false,
        version: '1.0',
        capabilities: { streaming: true, resume: true },
      },
    ],
    undefined,
    { state: 'last_known', observedAt: time },
    'offline',
  )
  assert.equal(option.eligibility.eligible, false)
  assert.equal(option.eligibility.summary.status.variant, 'secondary')
  assert.match(
    renderToStaticMarkup(
      h(ProviderSummaryBadge, { summary: option.eligibility.summary }),
    ),
    /data-variant="secondary"/u,
  )
})

test('check freshness is secondary to the summary; a never-discovered provider gets no status', () => {
  for (const state of ['current', 'last_known']) {
    const summary = providerSummary(descriptor, undefined, {
      state,
      observedAt: time,
    })
    assert.equal(summary.status.label, '可用')
    assert.match(summary.freshnessLabel, /上次检查/u)
  }
  assert.equal(providerSummary(descriptor).freshnessLabel, '尚未检查')
  assert.deepEqual(providerSummary(undefined), { freshnessLabel: '尚未检查' })
  assert.deepEqual(
    providerSummary(descriptor, undefined, { state: 'not_observed' }),
    { freshnessLabel: '尚未检查' },
  )
})

test('New Conversation advises only on current health and never gates an installed tool on health', () => {
  const available = {
    ...descriptor,
    available: true,
    capabilities: { streaming: true, resume: true },
  }
  for (const freshness of ['current', 'last_known']) {
    const healthy = newConversationProviderEligibility({
      ...available,
      executionHealth: { state: 'healthy', freshness, observedAt: time },
    })
    assert.equal(healthy.executionAdvisory, undefined)
    for (const state of ['degraded', 'unavailable']) {
      const result = newConversationProviderEligibility({
        ...available,
        executionHealth: {
          state,
          freshness,
          observedAt: time,
          failure: { reason: 'usage_limit_reached', userAction: 'wait' },
        },
      })
      assert.equal(result.eligible, true)
      if (freshness === 'current') {
        assert.match(
          result.executionAdvisory,
          /^(?:Codex 可用，部分功能受限|Codex 暂时不可用)，请等待额度恢复。$/u,
        )
      } else {
        assert.equal(result.executionAdvisory, undefined)
        assert.equal(result.summary.status.label, '可用')
        assert.match(result.summary.executionHistoryLabel, /11月19日/u)
      }
    }
  }
})

test('an unobserved compatibility sentinel cannot report a failed check; latest timestamp also includes the installation', () => {
  const group = lifecycle('unavailable')
  group.installations[0].compatibility = {
    state: 'unavailable',
    freshness: 'not_observed',
  }
  group.installations[0].lastObservedAt = '2026-11-20T12:00:00Z'
  const summary = providerSummary(
    {
      ...descriptor,
      executionHealth: {
        state: 'healthy',
        freshness: 'last_known',
        observedAt: time,
      },
    },
    group,
  )
  assert.equal(summary.status.label, '已安装，待确认')
  assert.equal(summary.advisory, undefined)
  assert.match(summary.freshnessLabel, /11\/20/u)
})

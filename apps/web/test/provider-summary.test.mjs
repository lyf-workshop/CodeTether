import assert from 'node:assert/strict'
import test from 'node:test'
import {
  machineProviderSummary,
  providerSummary,
} from '../.tmp/test-dist/provider/provider-presentation.js'
import { newConversationProviderEligibility } from '../.tmp/test-dist/components/conversations/new-conversation-provider-selection.js'

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
    'unavailable health takes priority over limited compatibility',
    'available',
    lifecycle('limited'),
    { state: 'unavailable', freshness: 'last_known' },
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

test('New Conversation only advises about a problem and never changes eligibility based on health', () => {
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
      assert.match(
        result.executionAdvisory,
        /^(?:Codex 可用，部分功能受限|Codex 暂时不可用)，请等待额度恢复。$/u,
      )
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

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canStartNewTurnAfterFailure,
  executionFailurePresentation,
} from '../.tmp/test-dist/failures/failure-presentation.js'

const timestamp = '2026-09-02T20:00:00.000Z'

const profiles = {
  provider_crashed: {
    category: 'provider',
    retryability: 'unknown',
    userAction: 'view_details',
    source: 'provider',
  },
  provider_start_failed: {
    category: 'provider',
    retryability: 'retry_now',
    userAction: 'retry',
    source: 'provider',
  },
  execution_lost: {
    category: 'runtime',
    retryability: 'not_retryable',
    userAction: 'view_details',
    source: 'runtime',
  },
  execution_ownership_uncertain: {
    category: 'runtime',
    retryability: 'not_retryable',
    userAction: 'view_details',
    source: 'runtime',
  },
  transport_lost: {
    category: 'transport',
    retryability: 'not_retryable',
    userAction: 'view_details',
    source: 'transport',
  },
  login_required: {
    category: 'authentication',
    retryability: 'retry_after_user_action',
    userAction: 'login_on_machine',
    source: 'provider',
  },
  provider_not_installed: {
    category: 'provider',
    retryability: 'retry_after_user_action',
    userAction: 'reinstall_provider',
    source: 'provider',
  },
  provider_unsupported_version: {
    category: 'provider',
    retryability: 'retry_after_user_action',
    userAction: 'update_provider',
    source: 'provider',
  },
  machine_offline: {
    category: 'machine',
    retryability: 'retry_later',
    userAction: 'reconnect_machine',
    source: 'machine',
  },
  reconnecting: {
    category: 'transport',
    retryability: 'retry_later',
    userAction: 'wait',
    source: 'transport',
  },
  usage_limit_reached: {
    category: 'quota',
    retryability: 'retry_later',
    userAction: 'wait',
    source: 'provider',
  },
  rate_limited: {
    category: 'quota',
    retryability: 'retry_later',
    userAction: 'wait',
    source: 'provider',
  },
  execution_capacity_reached: {
    category: 'runtime',
    retryability: 'retry_later',
    userAction: 'reduce_active_work',
    source: 'runtime',
  },
  project_location_unavailable: {
    category: 'project',
    retryability: 'retry_after_user_action',
    userAction: 'open_project',
    source: 'project',
  },
  unknown_failure: {
    category: 'generic',
    retryability: 'unknown',
    userAction: 'view_details',
    source: 'runtime',
  },
}

test('canonical failure cards cover required user-facing categories without parsing messages', () => {
  const cases = [
    ['login_required', '需要登录智能体'],
    ['usage_limit_reached', '已达到使用限额'],
    ['rate_limited', '请求过于频繁'],
    ['provider_not_installed', '未安装智能体'],
    ['provider_unsupported_version', '智能体版本不受支持'],
    ['machine_offline', '执行机器离线'],
    ['reconnecting', '正在重新连接'],
    ['execution_capacity_reached', '执行容量已满'],
    ['project_location_unavailable', '项目位置不可用'],
    ['provider_crashed', '智能体意外退出'],
    ['execution_ownership_uncertain', '执行归属无法确认'],
    ['unknown_failure', '执行失败'],
  ]

  for (const [reason, title] of cases) {
    const failure = canonicalFailure(reason)
    const presentation = executionFailurePresentation({
      code: 'provider_error',
      message: 'RAW provider stderr must never classify or render',
      details: { stderr: 'secret raw diagnostic' },
      failure,
    })
    assert.equal(presentation.title, title)
    assert.doesNotMatch(JSON.stringify(presentation), /RAW|stderr|secret/u)
  }
})

test('canonical actions expose only the matching safe navigation target', () => {
  const machineCases = [
    'login_required',
    'provider_not_installed',
    'provider_unsupported_version',
    'machine_offline',
  ]
  for (const reason of machineCases) {
    assert.equal(
      executionFailurePresentation({
        code: 'provider_error',
        message: 'not product copy',
        failure: canonicalFailure(reason),
      }).navigation,
      'machine',
    )
  }
  assert.equal(
    executionFailurePresentation({
      code: 'project_unavailable',
      message: 'not product copy',
      failure: canonicalFailure('project_location_unavailable'),
    }).navigation,
    'project',
  )
  for (const reason of [
    'usage_limit_reached',
    'rate_limited',
    'reconnecting',
    'execution_capacity_reached',
    'execution_ownership_uncertain',
    'unknown_failure',
  ]) {
    assert.equal(
      executionFailurePresentation({
        code: 'provider_error',
        message: 'not product copy',
        failure: canonicalFailure(reason),
      }).navigation,
      undefined,
    )
  }
})

test('validated Provider and Machine labels contextualize generic product copy', () => {
  const provider = executionFailurePresentation(
    {
      code: 'provider_error',
      message: 'not product copy',
      failure: canonicalFailure('login_required'),
    },
    { providerDisplayName: 'Claude Code', machineDisplayName: 'Linux VM' },
  )
  assert.match(provider.title, /Claude Code/u)
  assert.match(provider.cause, /Linux VM/u)
  assert.doesNotMatch(provider.title, /智能体/u)

  const machine = executionFailurePresentation(
    {
      code: 'machine_unreachable',
      message: 'not product copy',
      failure: canonicalFailure('machine_offline'),
    },
    { providerDisplayName: 'Codex', machineDisplayName: 'Build Node' },
  )
  assert.equal(machine.title, 'Build Node 离线')
})

test('only an explicitly retryable safe failure can create a deliberate new Turn', () => {
  assert.equal(
    canStartNewTurnAfterFailure(canonicalFailure('provider_start_failed')),
    true,
  )
  assert.equal(
    canStartNewTurnAfterFailure(canonicalFailure('provider_crashed')),
    false,
  )

  for (const reason of [
    'execution_lost',
    'execution_ownership_uncertain',
    'transport_lost',
  ]) {
    const failure = canonicalFailure(reason)
    const presentation = executionFailurePresentation({
      code: 'runtime_unavailable',
      message: 'safe envelope message',
      failure,
    })
    assert.equal(canStartNewTurnAfterFailure(failure), false)
    assert.equal(presentation.canStartNewTurn, false)
    assert.match(presentation.historyNote, /未自动重新发送/u)
  }
})

test('technical details contain only CodeTether-owned bounded fields', () => {
  const presentation = executionFailurePresentation({
    code: 'provider_error',
    message: 'raw provider payload',
    details: { command: 'do not expose' },
    failure: canonicalFailure('provider_crashed'),
  })

  assert.deepEqual(presentation.technicalDetails, [
    { label: '主机错误代码', value: 'provider_error' },
    { label: '故障代码', value: 'provider_crashed' },
    { label: '来源', value: '智能体' },
    { label: '发生时间', value: timestamp },
  ])
})

test('legacy errors use structured Host codes and never expose message text', () => {
  const presentation = executionFailurePresentation({
    code: 'provider_not_installed',
    message: 'provider executable at private path',
  })

  assert.equal(presentation.title, '未安装智能体')
  assert.equal(presentation.canStartNewTurn, false)
  assert.doesNotMatch(JSON.stringify(presentation), /private path/u)
})

test('broad historical Provider errors stay generic without inventing remote causes', () => {
  const unavailable = executionFailurePresentation({
    code: 'provider_unavailable',
    message: 'legacy local Claude failure with private diagnostic',
  })
  const missingSession = executionFailurePresentation({
    code: 'provider_conversation_unavailable',
    message: 'legacy private session identity',
  })
  const generic = executionFailurePresentation({
    code: 'provider_error',
    message: 'another ignored legacy diagnostic',
  })

  assert.equal(unavailable.title, generic.title)
  assert.notEqual(missingSession.title, unavailable.title)
  assert.doesNotMatch(
    JSON.stringify({ unavailable, missingSession }),
    /private|remote Machine/u,
  )
})

test('broad historical Machine connection errors stay generic', () => {
  const broadConnection = executionFailurePresentation({
    code: 'machine_connection_failed',
    message: 'legacy coordinator failure with private diagnostic',
  })
  const knownOffline = executionFailurePresentation({
    code: 'machine_unreachable',
    message: 'known unreachable Machine',
  })
  const generic = executionFailurePresentation({
    code: 'internal',
    message: 'another ignored legacy diagnostic',
  })

  assert.equal(broadConnection.title, generic.title)
  assert.notEqual(knownOffline.title, broadConnection.title)
  assert.doesNotMatch(JSON.stringify(broadConnection), /private|offline/u)
})

function canonicalFailure(reason) {
  const profile = profiles[reason]
  if (profile === undefined) throw new Error(`Missing test profile: ${reason}`)
  return {
    ...profile,
    reason,
    occurredAt: timestamp,
    technicalCode: reason,
  }
}

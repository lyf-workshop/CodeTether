import { useState } from 'react'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useRouter,
} from '@tanstack/react-router'

import {
  CanonicalFailureSchema,
  MachineIdSchema,
  ProjectIdSchema,
  type CanonicalFailure,
  type HostError,
  type HostErrorCode,
  type ProviderExecutionHealth,
} from '@codetether/protocol'
import { Badge, Button } from '@codetether/ui'

import { ConversationFailureCard } from '../components/conversation/conversation-failure-card'
import type { FailedTurnRetryController } from '../components/conversation/conversation-controls'
import {
  executionFailurePresentation,
  type FailurePresentationContext,
} from '../failures/failure-presentation'
import { providerExecutionHealthPresentation } from '../provider/provider-presentation'

type FixtureFailureReason =
  | 'usage_limit_reached'
  | 'rate_limited'
  | 'login_required'
  | 'provider_not_installed'
  | 'provider_unsupported_version'
  | 'provider_start_failed'
  | 'provider_crashed'
  | 'machine_offline'
  | 'reconnecting'
  | 'project_location_unavailable'
  | 'execution_capacity_reached'
  | 'execution_ownership_uncertain'
  | 'unknown_failure'

interface Scenario {
  readonly id: string
  readonly label: string
  readonly reason: FixtureFailureReason
  readonly hostCode: HostErrorCode
  readonly providerName: string
}

type FailureProfile = Pick<
  CanonicalFailure,
  'category' | 'retryability' | 'userAction' | 'source'
>

const observedAt = '2026-09-02T20:00:00.000Z'
const machineId = MachineIdSchema.parse('machine_phase6d_ui')
const projectId = ProjectIdSchema.parse('proj_phase6d_ui')
const rawProviderMarker = 'DO_NOT_RENDER_PHASE6D_RAW_PROVIDER_ERROR'

const failureProfiles = {
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
  project_location_unavailable: {
    category: 'project',
    retryability: 'retry_after_user_action',
    userAction: 'open_project',
    source: 'project',
  },
  execution_capacity_reached: {
    category: 'runtime',
    retryability: 'retry_later',
    userAction: 'reduce_active_work',
    source: 'runtime',
  },
  execution_ownership_uncertain: {
    category: 'runtime',
    retryability: 'not_retryable',
    userAction: 'view_details',
    source: 'runtime',
  },
  unknown_failure: {
    category: 'generic',
    retryability: 'unknown',
    userAction: 'view_details',
    source: 'runtime',
  },
} as const satisfies Record<FixtureFailureReason, FailureProfile>

const scenarios = [
  {
    id: 'quota',
    label: '使用限额',
    reason: 'usage_limit_reached',
    hostCode: 'provider_error',
    providerName: 'Codex',
  },
  {
    id: 'rate-limit',
    label: '频率限制',
    reason: 'rate_limited',
    hostCode: 'provider_error',
    providerName: 'Claude Code',
  },
  {
    id: 'login',
    label: '需要登录',
    reason: 'login_required',
    hostCode: 'provider_error',
    providerName: 'Claude Code',
  },
  {
    id: 'not-installed',
    label: '未安装',
    reason: 'provider_not_installed',
    hostCode: 'provider_not_installed',
    providerName: 'Codex',
  },
  {
    id: 'unsupported',
    label: '版本不受支持',
    reason: 'provider_unsupported_version',
    hostCode: 'provider_version_unsupported',
    providerName: 'Claude Code',
  },
  {
    id: 'crash',
    label: '进程崩溃',
    reason: 'provider_crashed',
    hostCode: 'provider_unavailable',
    providerName: 'Codex',
  },
  {
    id: 'startup',
    label: 'Provider startup failure',
    reason: 'provider_start_failed',
    hostCode: 'provider_start_failed',
    providerName: 'Codex',
  },
  {
    id: 'machine-offline',
    label: '机器离线',
    reason: 'machine_offline',
    hostCode: 'machine_unreachable',
    providerName: 'Codex',
  },
  {
    id: 'reconnecting',
    label: '正在重连',
    reason: 'reconnecting',
    hostCode: 'machine_connection_failed',
    providerName: 'Claude Code',
  },
  {
    id: 'project-location',
    label: '项目位置不可用',
    reason: 'project_location_unavailable',
    hostCode: 'project_unavailable',
    providerName: 'Codex',
  },
  {
    id: 'capacity',
    label: '运行容量已满',
    reason: 'execution_capacity_reached',
    hostCode: 'runtime_unavailable',
    providerName: 'Claude Code',
  },
  {
    id: 'ownership',
    label: '执行归属不确定',
    reason: 'execution_ownership_uncertain',
    hostCode: 'provider_unavailable',
    providerName: 'Codex',
  },
  {
    id: 'unknown',
    label: '未知故障',
    reason: 'unknown_failure',
    hostCode: 'runtime_unavailable',
    providerName: 'Claude Code',
  },
] as const satisfies readonly Scenario[]

function canonicalFailure(reason: FixtureFailureReason): CanonicalFailure {
  const profile = failureProfiles[reason]
  if (profile === undefined) {
    throw new Error(`Phase 6D fixture has no profile for ${reason}`)
  }
  return CanonicalFailureSchema.parse({
    ...profile,
    reason,
    occurredAt: observedAt,
    technicalCode: reason,
  })
}

function scenarioError(scenario: Scenario): HostError {
  return {
    code: scenario.hostCode,
    message: rawProviderMarker,
    failure: canonicalFailure(scenario.reason),
  }
}

function FailureDiagnosticsShowcase() {
  const [scenarioId, setScenarioId] = useState<string>(scenarios[0].id)
  const [newTurnCount, setNewTurnCount] = useState(0)
  const [healthRecovered, setHealthRecovered] = useState(false)
  const scenario =
    scenarios.find((candidate) => candidate.id === scenarioId) ?? scenarios[0]
  const context: FailurePresentationContext = {
    providerDisplayName: scenario.providerName,
    machineDisplayName:
      'Ubuntu Server with a deliberately long presentation-safe display name',
  }
  const failure = {
    ...executionFailurePresentation(scenarioError(scenario), context),
    ...(scenario.reason === 'provider_start_failed'
      ? { retryInput: 'Public deterministic retry fixture' }
      : {}),
  }
  const retryController: FailedTurnRetryController = {
    enabled: true,
    async execute() {
      setNewTurnCount((value) => value + 1)
    },
  }
  const healthFailure = canonicalFailure('usage_limit_reached')
  const executionHealth: ProviderExecutionHealth = healthRecovered
    ? {
        state: 'healthy',
        freshness: 'current',
        observedAt: '2026-09-02T20:05:00.000Z',
      }
    : {
        state: 'degraded',
        freshness: 'current',
        observedAt,
        failure: healthFailure,
      }
  const health = providerExecutionHealthPresentation(executionHealth, 'Codex')

  return (
    <main className="min-h-screen overflow-x-hidden bg-background px-4 py-6 text-text-primary sm:px-6 lg:px-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        <header>
          <p className="text-xs font-medium tracking-wide text-primary uppercase">
            Phase 6D · development-only rendered matrix
          </p>
          <h1 className="mt-2 text-page font-semibold">
            故障诊断与恢复 UX 验证
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-text-secondary">
            此页面复用正式故障呈现、失败卡片和执行健康映射。原始 Provider
            文本不会进入页面或恢复策略。
          </p>
        </header>

        <section
          aria-labelledby="scenario-heading"
          className="min-w-0 rounded-lg border border-border bg-surface/65 p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 id="scenario-heading" className="text-section font-semibold">
                选择故障场景
              </h2>
              <p className="mt-1 text-xs text-text-muted">
                当前：{scenario.label} · {scenario.reason}
              </p>
            </div>
            <Badge variant="info">AUTOMATED fixture</Badge>
          </div>
          <div
            role="group"
            aria-label="故障场景"
            className="mt-4 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
          >
            {scenarios.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                aria-pressed={candidate.id === scenario.id}
                className="min-w-0 rounded-sm border border-border bg-surface-muted px-3 py-2 text-left text-xs text-text-secondary outline-none transition-colors hover:border-border-strong hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring/60 aria-pressed:border-primary/60 aria-pressed:bg-primary-muted aria-pressed:text-primary motion-reduce:transition-none"
                onClick={() => {
                  setScenarioId(candidate.id)
                  setNewTurnCount(0)
                }}
              >
                <span className="block truncate">{candidate.label}</span>
              </button>
            ))}
          </div>

          <ConversationFailureCard
            failure={failure}
            machineId={machineId}
            projectId={projectId}
            retryController={retryController}
            turnId="turn_phase6d_failed"
          />

          <output
            aria-live="polite"
            className="mt-3 block min-h-5 text-xs text-success"
          >
            {newTurnCount > 0
              ? `已通过明确操作创建新的逻辑轮次与 actionId（次数 ${newTurnCount}）；旧失败轮次保持不变。`
              : '尚未创建新轮次；CodeTether 不会自动重放。'}
          </output>
        </section>

        <section
          aria-labelledby="health-heading"
          className="min-w-0 rounded-lg border border-border bg-surface/65 p-4 sm:p-5"
        >
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="health-heading" className="text-section font-semibold">
                安装状态与执行健康
              </h2>
              <p className="mt-1 text-xs text-text-muted">
                历史 quota 失败保持不变；这里只更新最近的当前健康观察。
                执行健康是建议性状态，不会单独锁死一次新的明确请求。
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setHealthRecovered(true)}
            >
              模拟下一次明确执行成功
            </Button>
          </div>
          <dl className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
            <div className="min-w-0 rounded-sm bg-surface-muted/55 p-3">
              <dt className="text-xs text-text-muted">Codex 安装</dt>
              <dd className="mt-1 text-sm font-medium">可用 · 0.149.1</dd>
            </div>
            <div className="min-w-0 rounded-sm bg-surface-muted/55 p-3">
              <dt className="text-xs text-text-muted">执行健康</dt>
              <dd className="mt-1 text-sm font-medium">
                {health.freshnessLabel} · {health.stateLabel}
              </dd>
              <dd className="mt-1 break-words text-xs leading-relaxed text-text-secondary">
                {health.description}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-text-muted">
            历史失败：usage_limit_reached · 2026-09-02 20:00 UTC（不重写）
          </p>
        </section>
      </div>
    </main>
  )
}

function NavigationConfirmation({ target }: { readonly target: string }) {
  const router = useRouter()

  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-text-primary">
      <section className="w-full max-w-lg rounded-lg border border-border bg-surface p-6 text-center">
        <Badge variant="success">Navigation verified</Badge>
        <h1 className="mt-3 text-page font-semibold">已打开{target}详情</h1>
        <p className="mt-2 text-sm text-text-secondary">
          此开发验证路由使用应用内导航返回 Phase 6D 故障矩阵。
        </p>
        <Button
          type="button"
          size="sm"
          className="mt-4"
          onClick={() => router.history.back()}
        >
          返回故障矩阵
        </Button>
      </section>
    </main>
  )
}

const fixtureRootRoute = createRootRoute({ component: Outlet })
const fixtureShowcaseRoute = createRoute({
  getParentRoute: () => fixtureRootRoute,
  path: '/__phase6d',
  component: FailureDiagnosticsShowcase,
})
const fixtureMachineRoute = createRoute({
  getParentRoute: () => fixtureRootRoute,
  path: '/machines/$machineId',
  component: () => <NavigationConfirmation target="机器" />,
})
const fixtureProjectRoute = createRoute({
  getParentRoute: () => fixtureRootRoute,
  path: '/projects/$projectId',
  component: () => <NavigationConfirmation target="项目" />,
})

const fixtureRouter = createRouter({
  routeTree: fixtureRootRoute.addChildren([
    fixtureShowcaseRoute,
    fixtureMachineRoute,
    fixtureProjectRoute,
  ]),
  history: createMemoryHistory({ initialEntries: ['/__phase6d'] }),
})

export function FailureDiagnosticsShowcaseApp() {
  return <RouterProvider router={fixtureRouter} />
}

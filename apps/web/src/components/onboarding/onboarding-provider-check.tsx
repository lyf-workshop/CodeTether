import { ArrowRight, RefreshCw } from 'lucide-react'
import type { DoctorProviderStatus } from '@codetether/protocol'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@codetether/ui'
import type { SetupStepProps } from './onboarding-step-props'
import { StatusRow } from './onboarding-step-feedback'
import { OnboardingStepHeading as StepHeading } from './onboarding-step-layout'
import { ProviderGuidanceLink } from './provider-guidance-link'
import {
  backendModeLabel,
  isProviderUsable,
  lifecycleObservationLabel,
  providerInstallationGuidance,
  providerVersionLabel,
  onboardingProviderServiceUnverified,
  onboardingProviderInstallationLabel,
  onboardingProviderRuntimeLabel,
  onboardingProviderServiceLabel,
  onboardingProviderGuidance,
  onboardingSessionDiscoveryLabel,
  onboardingInstallMethodLabel,
  onboardingUnverifiedServiceGuidance,
} from './onboarding-model'

export function OnboardingProviderCheck(props: SetupStepProps) {
  const { doctor } = props
  const readyCount = doctor.providers.filter(isProviderUsable).length
  const serviceUnverified = doctor.providers.some(
    onboardingProviderServiceUnverified,
  )
  return (
    <div>
      <StepHeading
        title="检查 AI 工具"
        description="CodeTether 使用已经选择的安装，不会在设置过程中自动安装、更新或切换工具。"
      />
      <div className="mt-5">
        <StatusRow
          label={doctor.thisComputer.displayName}
          detail={`${doctor.thisComputer.platform} · ${doctor.thisComputer.architecture}`}
          state={doctor.thisComputer.state}
        />
      </div>
      <div className="mt-7 space-y-3">
        {doctor.providers.map((provider) => (
          <OnboardingProviderCard key={provider.provider} provider={provider} />
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={props.busy}
          onClick={props.onProviderRefresh}
        >
          <RefreshCw aria-hidden="true" />
          重新检查
        </Button>
        <Button
          type="button"
          disabled={props.busy || doctor.thisComputer.state !== 'ready'}
          onClick={props.onContinue}
        >
          {readyCount > 0 || serviceUnverified
            ? '继续设置'
            : '暂不设置 AI 工具'}
          <ArrowRight aria-hidden="true" />
        </Button>
      </div>
      {serviceUnverified ? (
        <p role="status" className="mt-3 text-sm text-text-secondary">
          {onboardingUnverifiedServiceGuidance}
        </p>
      ) : readyCount === 0 ? (
        <p role="status" className="mt-3 text-sm text-warning-text">
          你可以完成应用设置，但在至少一个 AI 工具就绪前不能运行。
        </p>
      ) : null}
      {props.providerRefreshFailed ? (
        <p role="alert" className="mt-3 text-sm text-warning-text">
          这次检查暂时未能完成。下面保留已有状态及其检查时间，不会把旧状态当作新的结果。
        </p>
      ) : null}
    </div>
  )
}

export function OnboardingProviderCard({
  provider,
}: {
  readonly provider: DoctorProviderStatus
}) {
  const guidance = providerInstallationGuidance[provider.provider]
  const currentlyConfirmedMissing =
    provider.freshness === 'current' && !provider.installed
  const currentFirstPartyAuthRequired =
    provider.backend?.freshness === 'current' &&
    provider.backend.readiness === 'authentication_required' &&
    provider.backend.mode === 'first_party'
  return (
    <Card className="bg-surface-muted">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{guidance.label}</CardTitle>
            <p className="mt-1 text-xs text-text-muted">
              {providerVersionLabel(provider)} ·{' '}
              {lifecycleObservationLabel(
                provider.freshness,
                provider.observedAt,
              )}
            </p>
          </div>
          <Badge
            aria-label={`${guidance.label} 安装状态`}
            variant={
              provider.freshness !== 'current'
                ? 'secondary'
                : provider.installed && provider.selected
                  ? 'success'
                  : 'warning'
            }
          >
            {onboardingProviderInstallationLabel(provider)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-1 gap-3 text-sm above-phone:grid-cols-3">
          <div data-provider-fact="installation">
            <dt className="text-xs text-text-muted">安装</dt>
            <dd className="mt-0.5 text-text-primary">
              {onboardingProviderInstallationLabel(provider)}
            </dd>
          </div>
          <div data-provider-fact="runtime">
            <dt className="text-xs text-text-muted">运行环境</dt>
            <dd className="mt-0.5 text-text-primary">
              {onboardingProviderRuntimeLabel(provider)}
            </dd>
          </div>
          <div data-provider-fact="service">
            <dt className="text-xs text-text-muted">AI 服务</dt>
            <dd className="mt-0.5 text-text-secondary">
              {provider.backend === undefined
                ? 'AI 服务'
                : backendModeLabel(provider.backend)}
              ：{onboardingProviderServiceLabel(provider)}
              <span className="mt-0.5 block text-xs text-text-muted">
                {lifecycleObservationLabel(
                  provider.backend?.freshness ?? 'not_observed',
                  provider.backend?.observedAt,
                )}
              </span>
            </dd>
          </div>
        </dl>
        <p className="text-xs leading-relaxed text-text-muted">
          {onboardingProviderGuidance(provider)}
        </p>
        {currentlyConfirmedMissing ? (
          <ProviderGuidanceLink provider={provider.provider}>
            {guidance.action}
          </ProviderGuidanceLink>
        ) : null}
        {currentFirstPartyAuthRequired ? (
          <ProviderGuidanceLink provider={provider.provider}>
            查看官方登录指南
          </ProviderGuidanceLink>
        ) : null}
        <details className="rounded-sm border border-border px-3 py-2 text-xs text-text-muted">
          <summary className="cursor-pointer font-medium text-text-secondary">
            技术详情
          </summary>
          <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
            <dt>选择</dt>
            <dd>{provider.selected ? '已选择' : '未选择'}</dd>
            <dt>其他安装</dt>
            <dd>{provider.alternateInstallations}</dd>
            {provider.installMethod !== undefined ? (
              <>
                <dt>安装方式</dt>
                <dd>{onboardingInstallMethodLabel(provider.installMethod)}</dd>
              </>
            ) : null}
            <dt>状态来源</dt>
            <dd>
              {provider.freshness === 'current'
                ? '当前'
                : provider.freshness === 'last_known'
                  ? '上次检查'
                  : '尚未观察'}
            </dd>
            <dt>以前的会话</dt>
            <dd>
              {onboardingSessionDiscoveryLabel(provider.sessionDiscovery)}
            </dd>
            {provider.failure !== undefined ? (
              <>
                <dt>诊断代码</dt>
                <dd className="break-all font-mono">
                  {provider.failure.reason}
                </dd>
              </>
            ) : null}
          </dl>
        </details>
      </CardContent>
    </Card>
  )
}

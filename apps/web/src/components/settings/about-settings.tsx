import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { RefreshCw } from 'lucide-react'

import { Button, Notice, SettingsRow } from '@codetether/ui'
import {
  useHostConnectionState,
  useHostRuntime,
} from '../../runtime/host/host-runtime-hooks'
import { onboardingQueryOptions } from '../../runtime/host/onboarding-query'
import type { DesktopUpdateSnapshot } from '../../runtime/native/native-capabilities'
import { DoctorPage } from '../doctor'
import { DesktopUpdateSettings } from './desktop-update-settings'

export function AboutSettings({
  updateSnapshot,
  updateReadFailed = false,
  refreshUpdateState = () => undefined,
}: {
  updateSnapshot?: DesktopUpdateSnapshot
  updateReadFailed?: boolean
  refreshUpdateState?: () => void
}) {
  const runtime = useHostRuntime()
  const connectionState = useHostConnectionState()
  const navigate = useNavigate()
  const onboardingQuery = useQuery({
    ...onboardingQueryOptions(runtime),
    enabled: connectionState === 'connected',
  })
  const reopenMutation = useMutation({
    mutationFn: async () => {
      const progress = onboardingQuery.data
      if (progress !== undefined && progress.step === 'ready') {
        await runtime.updateOnboarding(progress.revision, { kind: 'reopen' })
      }
    },
    onSuccess: async () => await navigate({ to: '/onboarding' }),
  })
  return (
    <>
      <h2 className="mb-5 text-xl font-semibold">关于与检查</h2>
      <div className="mb-6 overflow-hidden rounded-lg border border-border bg-surface">
        <DesktopUpdateSettings
          snapshot={updateSnapshot}
          readFailed={updateReadFailed}
          refresh={refreshUpdateState}
        />
        <SettingsRow
          title="重新运行设置"
          description="需要重新检查本机配置或添加项目时，可以重新打开引导。"
          control={
            <Button
              variant="secondary"
              size="sm"
              disabled={
                reopenMutation.isPending ||
                connectionState !== 'connected' ||
                onboardingQuery.data === undefined
              }
              onClick={() => reopenMutation.mutate()}
            >
              <RefreshCw aria-hidden="true" />
              重新运行设置
            </Button>
          }
        />
        <SettingsRow
          title="安装选择与登录说明"
          description="在设备详情中查看真实的 AI 工具安装、运行时、后端和执行健康；安装选择仍需明确确认，不会自动切换。"
          control={
            <Button asChild variant="secondary" size="sm">
              <Link to="/devices">查看设备</Link>
            </Button>
          }
        />
      </div>
      {reopenMutation.isError ? (
        <div className="mb-4">
          <Notice tone="err" title="暂时无法重新打开设置">
            已有配置没有改变，请恢复连接后重试。
          </Notice>
        </div>
      ) : null}
      <DoctorPage embedded />
    </>
  )
}

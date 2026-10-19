import { Notice, SettingsRow, StatusTag } from '@codetether/ui'
import { Link } from '@tanstack/react-router'
import { nativeCapabilities } from '../../runtime/native/native-capabilities'

export function BackgroundSettings({
  available = nativeCapabilities.backgroundRuntime.available,
}: {
  available?: boolean
}) {
  return (
    <>
      <h2 className="mb-5 text-xl font-semibold">后台运行</h2>
      {available ? (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <SettingsRow
            title="关闭窗口后继续运行"
            description="关闭窗口后，CodeTether 仍在后台运行，正在进行的工作、审批和通知不会中断。"
            control={<StatusTag tone="off">始终开启</StatusTag>}
          />
          <SettingsRow
            title="打开或退出"
            description="从桌面版的后台图标选择“打开 CodeTether”恢复窗口，选择“退出 CodeTether”结束应用和正在进行的工作。"
          />
          <SettingsRow
            title="开机自动启动"
            description="目前还不支持，需要时请手动打开 CodeTether。"
            control={
              <Link
                to="/roadmap"
                className="text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                查看后续规划
              </Link>
            }
          />
        </div>
      ) : (
        <Notice title="浏览器没有桌面后台运行能力">
          浏览器不会显示系统托盘控制。请保持页面打开；需要后台运行和系统通知时使用
          CodeTether 桌面版。
        </Notice>
      )}
    </>
  )
}

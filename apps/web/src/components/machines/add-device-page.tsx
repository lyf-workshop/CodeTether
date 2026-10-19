import { ArrowRight, Monitor, Server, ShieldCheck } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Button, Notice } from '@codetether/ui'

export function AddDevicePage() {
  return (
    <main className="mx-auto w-full min-w-0 max-w-(--page-narrow-w) space-y-6 px-4 py-6 sm:px-8">
      <header>
        <h1 className="text-page font-semibold">添加设备</h1>
        <p className="mt-2 text-base text-text-secondary">
          连接另一台设备，在它的项目文件夹中使用 AI 工具。
        </p>
      </header>
      <section className="rounded-xl border border-border bg-surface p-6">
        <div className="flex min-w-0 items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-surface-inset">
            <Server aria-hidden="true" className="size-6" />
          </span>
          <div className="min-w-0">
            <h2 className="text-xl font-semibold">配对运行 Node 的设备</h2>
            <p className="mt-2 text-md text-text-secondary">
              Linux x64 / ARM64、macOS ARM64。设备上需要先安装 CodeTether
              Node，不需要账号。
            </p>
            <p className="mt-3 flex items-start gap-2 text-sm text-text-muted">
              <ShieldCheck
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0"
              />
              一次性配对码与两端验证码确认；信任只属于你确认的设备。
            </p>
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <Button asChild>
            <Link to="/add/node" search={{ step: 1 }}>
              开始配对
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </section>
      <section className="rounded-xl border border-border bg-surface p-6 text-text-secondary">
        <div className="flex items-start gap-4">
          <Monitor
            aria-hidden="true"
            className="mt-1 size-6 shrink-0 text-text-muted"
          />
          <div>
            <h2 className="text-lg font-semibold text-text-primary">
              其他桌面电脑
            </h2>
            <p className="mt-2 text-md">
              Windows
              暂时不能作为配对设备。同一账号下其他桌面电脑的接入方式尚未纳入此导航。
            </p>
            <Button asChild variant="link" className="mt-3 px-0">
              <Link to="/roadmap">查看后续规划</Link>
            </Button>
          </div>
        </div>
      </section>
      <Notice tone="info">
        这台电脑已经在“设备”中，无需再次添加。配对不会复制文件、安装 AI
        工具或自动执行会话。
      </Notice>
      <Button asChild variant="secondary">
        <Link to="/devices">返回设备</Link>
      </Button>
    </main>
  )
}

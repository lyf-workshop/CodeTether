import type { ReactNode } from 'react'
import {
  Check,
  FolderOpen,
  Inbox,
  Monitor,
  Search,
  Server,
  SquarePen,
} from 'lucide-react'
import { CodeTetherMark } from '@codetether/ui'
import { onboardingScreens } from './onboarding-presentation'

export function OnboardingProgress({ current }: { readonly current: number }) {
  return (
    <nav aria-label="设置进度" className="ct-onboarding-progress">
      <ol>
        {onboardingScreens.map((step, index) => (
          <li
            key={step.id}
            aria-current={index === current ? 'step' : undefined}
            data-complete={index <= current || undefined}
          >
            <span aria-hidden="true" className="ct-onboarding-progress-line" />
            <span className="sr-only">
              {step.label}
              {index < current
                ? '，已完成'
                : index === current
                  ? '，当前步骤'
                  : '，未开始'}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  )
}

function Feature({
  icon,
  title,
  description,
}: {
  readonly icon: ReactNode
  readonly title: string
  readonly description: string
}) {
  return (
    <div className="ct-onboarding-feature" data-slot="onboarding-feature">
      <span className="ct-onboarding-feature-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="font-semibold text-text-primary">{title}</p>
        <p className="mt-1 text-md text-text-secondary">{description}</p>
      </div>
    </div>
  )
}

export function OnboardingStepHeading({
  title,
  description,
}: {
  readonly title: string
  readonly description: string
}) {
  return (
    <div>
      <h2 className="ct-onboarding-title">{title}</h2>
      <p className="ct-onboarding-lead">{description}</p>
    </div>
  )
}

export function OnboardingWelcome({
  children,
}: {
  readonly children: ReactNode
}) {
  return (
    <section data-slot="onboarding-welcome">
      <CodeTetherMark className="ct-onboarding-brand" />
      <h2 className="ct-onboarding-title ct-onboarding-emblem-title">
        你的 AI 编程助手，
        <br />
        在你的每台设备上都能接着用
      </h2>
      <p className="ct-onboarding-lead">
        CodeTether 把 Codex 和 Claude Code
        的会话集中到一个地方，按设备和项目整理，每个项目里以前的会话也能接着用。
      </p>
      <div className="ct-onboarding-features">
        <Feature
          icon={<Monitor />}
          title="在这台电脑上工作"
          description="用 Codex 或 Claude Code 处理你的项目。"
        />
        <Feature
          icon={<Server />}
          title="你的所有设备在一处"
          description="这台电脑和配对的设备各自列出自己的项目和会话。"
        />
        <Feature
          icon={<Inbox />}
          title="需要你的时候提醒你"
          description="需要批准的命令、完成和失败都集中在“待处理”。"
        />
      </div>
      <p className="mt-3 text-xs text-text-muted">
        CodeTether 不会自动安装、更新或切换你的 AI 工具。
      </p>
      <div className="ct-onboarding-footer">
        <p className="text-xs text-text-muted">在这台电脑上使用不需要账号</p>
        {children}
      </div>
    </section>
  )
}

export function OnboardingCompletion({
  ready,
  description,
  action,
  children,
}: {
  readonly ready: boolean
  readonly description: string
  readonly action?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <section data-slot="onboarding-completion">
      <span
        aria-hidden="true"
        data-execution-ready={ready || undefined}
        className="ct-onboarding-completion-icon"
      >
        <Check />
      </span>
      <h2 className="ct-onboarding-title ct-onboarding-emblem-title">
        {ready ? '一切就绪' : 'CodeTether 设置完成'}
      </h2>
      <p className="ct-onboarding-lead">{description}</p>
      <div className="ct-onboarding-readiness">{children}</div>
      <div className="ct-onboarding-features">
        <Feature
          icon={<FolderOpen />}
          title="设备 › 项目 › 会话"
          description="侧栏按设备列出项目，每个项目就是那台设备上的一个文件夹，会话在项目下面。"
        />
        <Feature
          icon={<SquarePen />}
          title="新建会话"
          description="按 Ctrl N，选择项目和 AI 工具。"
        />
        <Feature
          icon={<Search />}
          title="快速跳转"
          description="按 Ctrl K 搜索已加载的会话标题、项目和设备。"
        />
      </div>
      {action === undefined ? null : (
        <div className="ct-onboarding-footer">{action}</div>
      )}
    </section>
  )
}

import { useState, useSyncExternalStore } from 'react'
import {
  AgentBadge,
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Notice,
  SearchInput,
  SectionState,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusBadge,
  StatusTag,
  Textarea,
  executionStatuses,
} from '@codetether/ui'

import {
  getThemeController,
  type ThemePreference,
} from '../runtime/theme/theme-preference'
import { ShowcaseGroup, ShowcaseSection } from './showcase-section'

const colors = [
  { label: '画布', className: 'bg-background' },
  { label: '侧栏', className: 'bg-navigation' },
  { label: '表面', className: 'bg-surface' },
  { label: '凹陷', className: 'bg-surface-inset' },
  { label: '选中', className: 'bg-surface-selected' },
  { label: '墨色', className: 'bg-ink' },
  { label: '强调', className: 'bg-primary' },
  { label: '成功', className: 'bg-success' },
  { label: '警告', className: 'bg-warning' },
  { label: '错误', className: 'bg-danger' },
] as const

const themes: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
]

/** Development-only visual catalog. It never calls Host or provider APIs. */
export function ComponentShowcase() {
  const themeController = getThemeController()
  const preference = useSyncExternalStore(
    themeController.subscribe,
    themeController.getPreference,
  )
  const [scope, setScope] = useState('active')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [choice, setChoice] = useState('codex')

  return (
    <main className="h-dvh min-w-0 overflow-x-hidden overflow-y-auto bg-background px-4 py-6 text-text-primary sm:px-8">
      <div className="mx-auto flex w-full max-w-(--page-w) flex-col gap-6">
        <header className="flex min-w-0 flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-text-secondary">CodeTether · 开发预览</p>
            <h1 className="mt-2 text-page font-semibold">视觉规范与基础组件</h1>
            <p className="mt-2 max-w-prose text-md text-text-secondary">
              v4 基础组件展示。所有内容均为界面示例，不连接设备或运行 AI 工具。
            </p>
          </div>
          <SegmentedControl
            aria-label="主题"
            value={preference}
            onValueChange={(value) =>
              themeController.setPreference(value as ThemePreference)
            }
          >
            {themes.map((theme) => (
              <SegmentedControlItem key={theme.value} value={theme.value}>
                {theme.label}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </header>

        <ShowcaseSection
          id="foundations"
          title="基础规范"
          description="暖灰表面、系统字体与统一强调色。主按钮使用墨色。"
        >
          <div className="grid min-w-0 gap-6 md:grid-cols-2">
            <ShowcaseGroup title="颜色">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {colors.map((color) => (
                  <div
                    key={color.label}
                    className="min-w-0 rounded-sm border border-border p-2"
                  >
                    <div
                      aria-hidden="true"
                      className={`h-8 rounded-xs border border-border ${color.className}`}
                    />
                    <p className="mt-2 text-sm text-text-secondary">
                      {color.label}
                    </p>
                  </div>
                ))}
              </div>
            </ShowcaseGroup>
            <ShowcaseGroup title="文字与间距">
              <div className="space-y-3">
                <p className="text-page font-semibold">设备与项目</p>
                <p className="text-section font-semibold">
                  清晰、安静的工作空间
                </p>
                <p className="text-base">正文使用系统字体，便于长时间阅读。</p>
                <p className="text-sm text-text-secondary">
                  次级信息 · 设备、项目与会话上下文
                </p>
                <p className="text-xs text-text-muted">
                  间距：4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48
                </p>
              </div>
            </ShowcaseGroup>
          </div>
        </ShowcaseSection>

        <ShowcaseSection
          id="controls"
          title="按钮与输入"
          description="保留键盘操作、焦点提示与禁用状态。"
        >
          <div className="grid min-w-0 gap-6 md:grid-cols-2">
            <ShowcaseGroup title="按钮">
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => setDialogOpen(true)}>新建会话</Button>
                <Button variant="secondary" onClick={() => setDialogOpen(true)}>
                  添加项目
                </Button>
                <Button variant="ghost" onClick={() => setDialogOpen(true)}>
                  查看说明
                </Button>
                <Button variant="danger" onClick={() => setDialogOpen(true)}>
                  移除项目
                </Button>
                <Button disabled>暂时不可用</Button>
                <Button size="sm" onClick={() => setDialogOpen(true)}>
                  小按钮
                </Button>
                <Button size="lg" onClick={() => setDialogOpen(true)}>
                  大按钮
                </Button>
              </div>
              <div className="mt-4">
                <SegmentedControl
                  aria-label="会话范围"
                  value={scope}
                  onValueChange={setScope}
                >
                  <SegmentedControlItem value="active">
                    会话
                  </SegmentedControlItem>
                  <SegmentedControlItem value="archived">
                    已归档
                  </SegmentedControlItem>
                  <SegmentedControlItem value="unavailable" disabled>
                    不可用
                  </SegmentedControlItem>
                </SegmentedControl>
                <p className="mt-2 text-sm text-text-secondary">
                  当前范围：{scope === 'active' ? '会话' : '已归档'}
                </p>
              </div>
            </ShowcaseGroup>
            <ShowcaseGroup title="输入框">
              <div className="space-y-3">
                <label
                  htmlFor="showcase-name"
                  className="block text-md font-medium"
                >
                  项目名称
                </label>
                <Input id="showcase-name" placeholder="输入项目名称" />
                <SearchInput
                  aria-label="搜索项目内的会话"
                  placeholder="搜索项目内的会话"
                />
                <Textarea
                  aria-label="消息示例"
                  placeholder="描述你希望完成的工作"
                />
              </div>
            </ShowcaseGroup>
          </div>
        </ShowcaseSection>

        <ShowcaseSection
          id="statuses"
          title="状态与 AI 工具"
          description="运行中使用蓝色圆点；等待批准与失败保持独立。"
        >
          <div className="grid min-w-0 gap-6 md:grid-cols-2">
            <ShowcaseGroup title="会话状态">
              <div className="flex flex-wrap gap-4">
                {executionStatuses.map((status) => (
                  <StatusBadge key={status} status={status} />
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-4">
                <StatusTag tone="ok">在线</StatusTag>
                <StatusTag tone="off">离线</StatusTag>
                <StatusTag tone="warn">需要更新地址</StatusTag>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge variant="success">项目已添加</Badge>
                <Badge variant="warning">设备离线</Badge>
                <Badge variant="danger">无法访问</Badge>
              </div>
            </ShowcaseGroup>
            <ShowcaseGroup title="AI 工具标识">
              <div className="flex flex-wrap items-center gap-4">
                {(['sm', 'md', 'lg'] as const).map((size) => (
                  <AgentBadge key={size} agent="codex" size={size} />
                ))}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-4">
                {(['sm', 'md', 'lg'] as const).map((size) => (
                  <AgentBadge key={size} agent="claude" size={size} />
                ))}
              </div>
            </ShowcaseGroup>
          </div>
        </ShowcaseSection>

        <ShowcaseSection
          id="feedback"
          title="提示与局部状态"
          description="加载、空内容和错误分别呈现，未知值不显示为零。"
        >
          <div className="space-y-3">
            <Notice tone="info" title="通过 Relay 连接">
              设备与项目的权限保持不变。
            </Notice>
            <Notice tone="warn" title="设备离线">
              恢复连接后可以继续操作，已有会话仍然可读。
            </Notice>
            <Notice
              tone="err"
              title="暂时无法加载"
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setDialogOpen(true)}
                >
                  查看说明
                </Button>
              }
            >
              请检查设备连接后重试。
            </Notice>
            <Notice tone="ok" title="项目已添加">
              现在可以查看以前的会话，或新建一个会话。
            </Notice>
          </div>
          <div className="mt-6 grid min-w-0 gap-4 md:grid-cols-2">
            <Card className="p-4">
              <SectionState state="loading" />
            </Card>
            <Card>
              <SectionState
                state="empty"
                title="还没有项目"
                description="添加一个项目文件夹，开始新的工作。"
                action={
                  <Button onClick={() => setDialogOpen(true)}>添加项目</Button>
                }
              />
            </Card>
          </div>
        </ShowcaseSection>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="secondary">打开弹窗示例</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>基础组件示例</DialogTitle>
              <DialogDescription>
                用于检查焦点、键盘导航和浮层布局，不会创建项目或会话。
              </DialogDescription>
            </DialogHeader>
            <label
              htmlFor="showcase-dialog-name"
              className="text-md font-medium"
            >
              项目名称
            </label>
            <Input id="showcase-dialog-name" placeholder="输入项目名称" />
            <label htmlFor="showcase-tool" className="text-md font-medium">
              AI 工具
            </label>
            <Select value={choice} onValueChange={setChoice}>
              <SelectTrigger id="showcase-tool">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="codex">Codex</SelectItem>
                <SelectItem value="claude">Claude Code</SelectItem>
              </SelectContent>
            </Select>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setDialogOpen(false)}>
                取消
              </Button>
              <Button onClick={() => setDialogOpen(false)}>完成</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </main>
  )
}

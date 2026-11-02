import { Notice, StatusTag } from '@codetether/ui'

const roadmapItems = [
  {
    title: '同一账号下的 Mac 和 Windows',
    description:
      '让同一账号下的桌面电脑出现在“设备”中，并在上面继续项目和会话。',
    dependency:
      '协议与本地服务已有部分控制能力，但账号服务目前只提供读取权限；本版不提供只读设备入口。',
    partial: true,
  },
  {
    title: 'Windows 设备配对',
    description: '把另一台 Windows 电脑作为配对设备使用。',
    dependency: '当前 Node 发布目标仅包括 Linux x64 / ARM64 与 macOS ARM64。',
  },
  {
    title: '远程停止',
    description: '停止正在配对设备上运行的会话。',
    dependency: '远程执行尚未提供中断能力；现有会话不会显示停止按钮。',
  },
  {
    title: '远程审批',
    description: '将远程会话中的审批同步到“待处理”。',
    dependency: '当前远程执行采用不审批的固定能力范围，没有远程审批操作。',
  },
  {
    title: '删除会话',
    description: '永久删除已归档的会话，再移除不再使用的项目。',
    dependency: '当前没有删除会话接口；存在任何会话的项目仍不能移除。',
  },
  {
    title: '运行中排队、补充指令',
    description: '在这一轮尚未结束时补充下一条消息。',
    dependency: '当前 AI 工具能力描述与执行接口没有排队或插话能力。',
  },
  {
    title: '跨项目按内容搜索',
    description: '一次查找所有项目中发送过的内容。',
    dependency: '当前内容搜索限于单个项目；命令面板只匹配已加载的标题。',
  },
  {
    title: '选择模型与 Codex 推理强度',
    description: '创建会话时选择更多模型或推理设置。',
    dependency:
      '只显示 AI 工具实际提供的选项；当前 Codex 没有模型与推理强度选项，Claude Code 仅提供推理强度。',
  },
  {
    title: '浏览配对设备上的文件夹',
    description: '添加项目时，在配对设备上浏览并选择文件夹。',
    dependency: 'Node 没有列目录接口；目前需要输入完整路径。',
  },
  {
    title: 'Claude Code 编辑、终端与变更',
    description: '在 Claude Code 会话中编辑文件并查看变更。',
    dependency: '需要另行扩展并验证 AI 工具能力；当前仅提供读取与搜索。',
  },
  {
    title: '开机启动、托盘快捷入口',
    description: '在设置中提供启动选项与常用操作。',
    dependency:
      '需要桌面外壳的启动能力支持；本次前端改版不添加开关或修改原有后台行为。',
  },
] as const

/** Design directions only: no runtime import, request, or execution entry. */
export function RoadmapPage() {
  return (
    <section className="mx-auto w-full min-w-0 max-w-(--page-w) space-y-6 px-4 py-6 sm:px-8">
      <header>
        <h1 className="text-page font-semibold">后续规划</h1>
        <p className="mt-2 text-base text-text-secondary">
          远程控制和其他尚未提供的能力。
        </p>
      </header>
      <Notice tone="info" title="这些功能还在规划中">
        以下是后续可能提供的能力，目前还不能使用，也没有确定的时间。
      </Notice>
      <div className="grid gap-4 md:grid-cols-2">
        {roadmapItems.map((item) => (
          <section
            key={item.title}
            data-roadmap-item={item.title}
            className="min-w-0 space-y-3 rounded-xl border border-border bg-surface p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 className="min-w-0 flex-1 text-lg font-semibold">
                {item.title}
              </h2>
              <StatusTag tone={'partial' in item ? 'warn' : 'off'}>
                {'partial' in item ? '部分实现' : '尚未实现'}
              </StatusTag>
            </div>
            <p className="text-md text-text-secondary">{item.description}</p>
            <p className="text-sm text-text-muted">
              <span className="font-medium">当前限制：</span>
              {item.dependency}
            </p>
          </section>
        ))}
      </div>
    </section>
  )
}

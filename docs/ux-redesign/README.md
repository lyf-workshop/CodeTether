# CodeTether UX 重设计 v3（设计交付）

状态：设计提案，按已验收基线 `bbcda690a081` 校正。v3 把信息架构改成 **项目 › 文件夹 › 会话**，只画后端已经支持的能力；浅色为主、深色可切换的视觉沿用 v2。**尚未写入 Figma**（会话中没有 Figma 写入工具，见 02 文档开头），未开始生产前端重构。

| 文件 | 内容 |
|---|---|
| [01-feature-inventory-and-mapping.md](01-feature-inventory-and-mapping.md) | 关键事实、前端审核（摩擦点 → v3 处理）、功能盘点 F01–F68、旧入口 → 新入口 → 原型截图 → 源码 |
| [02-dev-handoff.md](02-dev-handoff.md) | 信息架构、视觉规范（浅色/深色 Token）、组件、状态表达、能力门控、数据依赖、待确认事项、Figma 写入计划、实现顺序 |
| [overview.html](overview.html) | 92 张截图总览（`png/00-overview.png` 为整页图） |
| `prototype/index.html` | 本地可点击原型（浏览器直接打开；演示数据，不调用任何真实接口） |
| `export-png.sh` | 重新导出 `png/`（需要 Chrome，约 1 分钟） |

## v3 相对 v2 的变化

- 侧栏回到基线的项目树，并在项目和会话之间加了 **文件夹**（项目在某台电脑上的位置）：`项目 › 电脑上的文件夹 › 会话`。点文件夹旁的“+”就在那个文件夹里启动 Codex 或 Claude Code，不用先在终端里切换目录。
- 起始页是 **项目**。v2 的首页、全部会话、全局搜索去掉了：Host 没有跨项目的会话列表和搜索接口。旧链接 `#/home`、`#/sessions`、`#/search` 重定向到 `#/projects`。
- 项目详情按文件夹分节列出会话（基线是单独一页、按智能体分组），已归档和项目内搜索都在项目里。
- 新建会话的顺序是 项目 → 文件夹 → AI 工具。Claude Code 有推理强度；Codex 不显示模型和推理强度（Codex 描述里没有这些选项）。
- 只保留有后端支持的操作；没有接口的能力（删除会话、远程停止和审批、跨项目内容搜索、选择模型等）只出现在 `#/roadmap`。

## 打开原型

直接用浏览器打开 `prototype/index.html`（file://，不访问网络）。URL 参数：

- `?theme=light|dark|system`：主题，默认浅色；也可以在 设置 › 外观 或 Ctrl K 里切换，选择会记在 localStorage。
- `?os=win|mac`：标题栏样式（Windows 窗口控制 / mac 红绿灯）与平台文案。
- `?modal=…`：直接打开某个浮层。
  - `new`：新建会话；`new~p-web` 预选项目（侧栏按钮、Ctrl N 的行为），`new:p-web` 固定项目，`new:p-web,m-local` 再固定文件夹，末尾加 `,claude` 预选 Claude Code；`new:m-mac` 从电脑详情打开。
  - `addproj` 添加项目文件夹；`addloc:p-api` 给项目添加另一台电脑上的文件夹；`addloc:m-mac` 在这台电脑上添加。
  - `rmloc:p-docs,m-mac` 移除文件夹；`rmproj:p-web` 移除项目（有会话时只说明原因）。
  - `palette`、`rename:c3`、`unpair:m-mac`、`addr:m-mac`。
- 快捷键：Ctrl K 命令面板，Ctrl N 新建会话（预选当前项目和文件夹），Esc 关闭浮层。

## 检查流程（hash 路由）

1. 首次启动 → 项目：`#/onboarding?step=welcome` … `step=ready` → `#/projects`
2. 侧栏找到会话：展开 CodeTether › 工作站 › 会话；文件夹超过 4 个会话时“显示全部”
3. 在文件夹里新建会话：侧栏文件夹行的“+”或 `#/projects/p-web` 文件夹标题旁的“新建会话” → 选 AI 工具 → 创建后进入会话
4. 处理审批：`#/inbox` → `#/c/c1`（等待批准）→ `#/c/c1?panel=files&tab=changes`
5. 找回会话：`#/projects/p-web/search?q=重连`（标题和你发送过的内容，只在一个项目里）；`#/projects/p-api?view=archived`；或 Ctrl K 按标题
6. 另一台电脑上的文件夹：`#/projects/p-api` → “在另一台电脑上添加文件夹”；`#/computers/m-mac` → 项目文件夹“添加”
7. 其他主机（仅查看）：侧栏“其他主机 · 仅查看” → `#/c/rc1`（没有输入框，底部说明）
8. 添加电脑：`#/add` → `#/add/desktop`（登录并申请查看）或 `#/add/node?step=1` … `step=4`（配对服务器）
9. 设置：`#/settings/appearance` · `account` · `notify` · `background` · `about`；`#/roadmap` 为后续规划（与当前功能隔离）

状态演示参数：`#/projects?state=loading|empty|error`、`#/projects/p-ml`（只有离线电脑上的文件夹）、`#/projects/p-docs`（一个文件夹无法访问）、`#/inbox?f=none`、`#/computers?account=out`、`#/computers?scroll=more`、`#/computers/m-linux`（离线）、`#/computers/m-mac?proj=error`、`#/computers/h-office`（无法连接）、`#/computers/h-lab`（等待批准）、`#/c/rc1?live=disconnected`、`#/c/c4`（离线且失败）、`#/c/c5`（导入的会话）、`#/signin?step=email|code|unconfigured`、`#/settings/account?host=disabled|enabled_unclaimed|claimed`。

旧路由（`#/home`、`#/sessions`、`#/search`、`#/devices`、`#/hosts`、`#/pair`、`#/connect`、`#/account`、`#/doctor`）会重定向到新路由。

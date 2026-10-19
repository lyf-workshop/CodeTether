# 02 · 开发交接说明（v4）

面向下一轮按设计稿重构前端的实现者。功能映射和前端审核见 [01-feature-inventory-and-mapping.md](01-feature-inventory-and-mapping.md)，可点击原型见 `prototype/index.html`，截图见 `png/` 与 [overview.html](overview.html)。

**仍未写入 Figma**。会话中没有暴露 Figma MCP 写入工具（`use_figma`、`create_new_file`），所以在“创建文件”这一步受阻。§7 是写入计划。AGENTS.md 规定 Figma 是 UI 唯一事实来源，因此在 Figma 文件建好并审批前，原型与截图只是设计提案，不能作为实现依据。

v4 的核心：**账号 › 设备 › 项目 › 会话**。一个项目就是一台设备上的一个文件夹；设备是这台电脑和用 CodeTether Node 配对的设备，都能完整使用；添加项目时自动找出这个文件夹里以前的 Codex / Claude Code 会话。

v3 的更正：v3 让一个项目挂多台电脑上的文件夹，还画了“其他主机 · 仅查看”。用户确认当前目标不是一个项目跨 Mac 和 Windows，也不需要只读设备。v4 去掉了这两部分；数据层仍然是 `ProjectRecord` + `ProjectLocation`，只是界面上每个项目只用一个位置。

## 0. 实现前需要确认

| 事项 | 现状 | 需要的决定 |
|---|---|---|
| 设计事实来源 | Figma 未写入，只有本地原型 | 先补 Figma 再实现；或者临时以原型为准，事后补 Figma（需修改 AGENTS.md 约定） |
| 起始页 | 基线 StartupGate 完成后进入 `/hosts`（startup-gate.tsx:59，英文、需要登录）；首次启动结束进入选中的项目或 `/inbox` | v4 进入 **设备** `/devices`（首次启动选了项目时进入该项目） |
| 一个项目一台设备 | Host 允许一个项目有多台设备上的位置（`registerProjectLocation`） | 界面不再提供“给项目添加另一台设备上的位置”。已有多位置的项目（老数据）怎么显示：建议按位置拆成“设备 › 项目”下的多个条目，同名并存，各自列出 `machineId` 对应的会话 |
| 同一账号下的其他桌面版 | 账号服务只给同账号的其他 Host 签发 `supervisor_read`，`supervisor_control` 不签发 | v4 不显示它们（不做只读设备）。基线 `/hosts` 的“申请查看”“允许其他电脑查看”在新导航里没有入口，需要确认是否可以先下线 |
| Windows 设备 | Node 配对只支持 Linux x64 / arm64 和 macOS arm64 | Windows 电脑只能作为“这台电脑”使用，不能被配对；写在添加设备页和后续规划里 |
| 主题切换 | 基线固定深色：`apps/web/src/main.tsx:15` 写死 `dataset.theme = 'dark'`，`packages/ui` 只有深色 Token | 原型默认浅色，设置 › 外观提供 跟随系统 / 浅色 / 深色。这是**新增的纯前端能力**，需要确认是否纳入本轮；不纳入时只上线浅色 Token，深色截图（06-*）留作后续 |
| Agent 标识 | 原型用抽象线条图标 + 品牌色（`.ag`），不是官方 Logo | 若要用官方 Logo，需确认授权后单独提供素材；不要直接取用仓库中未跟踪的 `packages/ui/src/assets/` |
| mac 文案 | 托盘菜单“打开 CodeTether / 退出 CodeTether”与“关闭窗口后继续运行”已在基线核实（system_tray.rs、host_supervisor.rs） | “⌘ W 关闭窗口”和“菜单栏”说法未在 Mac 实机上核对，实现前需要验证 |
| 首次启动步骤 | 基线 7 步（computer_check 与 provider_check 分开） | 原型把两步合并为“检查 AI 工具”共 6 步；只改展示，状态机仍用基线 7 个 step |

## 1. 信息架构

```
侧栏（桌面）                                              手机底部 Tab
├─ 品牌 + 搜索（Ctrl K 命令面板）                          设备 · 待处理 · 设置
├─ 新建会话（Ctrl N，预选当前项目）
├─ 待处理      /inbox      （角标 = 打开的事项数）
├─ 设备 ＋     /devices    （“＋”= 添加设备）
│   └─ 设备 ＋                       这台电脑排第一；“＋”= 在这台设备上添加项目；离线时显示状态
│       └─ 项目 ＋ 或 原因（无法访问 / 不能运行）   悬停显示路径；“＋”= 在项目里新建会话
│           └─ 会话（置顶在前，默认 4 个，“显示全部 N 个”；当前会话总是可见）
└─ 底部：账号 → /settings/account · 设置图标 → /settings/appearance

/devices                 每台设备一节：名称、连接、系统 · 架构 · 连接方式、“添加项目”；项目卡片 + “添加项目”卡片
/devices/:machineId      左：项目列表、最近的会话；右：AI 工具、连接（更新地址、取消配对）
/projects/:id            设备 › 项目；会话 / 已归档；搜索、状态和 AI 工具筛选；以前的会话；移除项目
/projects/:id/search?q=  项目内搜索（标题和你发送过的内容）
/c/:id 会话 · /add 添加设备（/add/node?step=1..4）· /signin · /onboarding
/settings/:section · /roadmap 后续规划（与当前功能隔离）
```

旧路由重定向：`/`、`/home`、`/sessions`、`/search`、`/projects`、`/computers`、`/hosts` → `/devices`；`/computers/:id` → `/devices/:id`；`/pair` → `/add/node`；`/connect`、`/add/desktop` → `/add`；`/account` → `/settings/account`；`/doctor` → `/settings/about`；`/settings` → `/settings/appearance`。

生产路由对应：
- `/machines`、`/machines/$id` → `/devices`、`/devices/$id`；`/hosts`、`/hosts/$hostId` 不再进入主导航（见 §0）。
- `/projects/$projectId` 与 `/projects/$projectId/conversations`（基线按智能体分组的会话页，`q` 和 `view=archived`）合并为一页；`/projects/$projectId/conversations` 保留为别名。
- `/conversations/$id` → `/c/$id`（或保留原路径，只换页面）。
- `/activity`、`/agents` 是基线里没有入口的占位页（“此页面尚未实现。”），v4 不使用，可以删除或重定向到 `/devices`。

命名：
- **设备**：Machine。只有两种：`local`（这台电脑）和 Node 配对的 `remote`。都在本机 Host 下，完整访问。
- **项目**：设备上的一个文件夹，对应 `ProjectRecord` 加它在那台设备上的 `ProjectLocation{machineId, rootPath, availability}`。名称默认取文件夹名，路径放在第二行或悬停提示里。
- **以前的会话**：在项目文件夹里找到的、还没加到 CodeTether 的 Codex / Claude Code 原生会话（provider-sessions 的候选）。导入后成为 `origin=adopted_native` 的会话。
- **AI 工具**：Codex、Claude Code。不再混用 Agent / 智能体。
上下文一致性：
- 会话标题下的上下文条是 `设备 › 项目（悬停显示路径）· AI 工具 · 推理强度（只有设置过才显示）`，前两段可点击；导入的会话加“从 Claude Code 导入”。面包屑为 `设备 › 项目 › 会话标题`。都取自 `conversation.projectId / machineId`，不另取当前选中的设备。
- 打开项目或会话时，侧栏自动展开它所在的设备和项目；当前会话在前 4 个之后时仍然显示。

添加项目（`add-project-dialog.tsx` + `previous-conversations-step.tsx`）：
- 第一步：设备（从设备入口打开时固定）→ 文件夹 → 名称（默认文件夹名）。这台电脑用系统选择窗口（`pick_project_directory`）或输入路径；配对设备只能输入完整路径（Node 没有列目录接口）。离线、不能运行的设备不能选。
- 同一台设备上已经添加过的文件夹，直接打开原来的项目，不重复创建。
- 第二步在同一个弹窗里：“已添加 X（设备 · 路径）”，然后列出在这个文件夹里找到的以前的会话，按 AI 工具分组，可以继续的默认勾选；“导入所选”或“跳过”，之后进入项目页。没有找到时说“没有找到以前的会话，你仍可以直接新建会话”。
- 基线已经在 createProject / createRemoteProject 之后接了 PreviousConversationsStep（首次启动和电脑详情共用），v4 只是把它放进添加项目弹窗的第二步，并在项目页常驻一节。

新建会话（`new-conversation-dialog.tsx`）：
- 顺序是 项目（按设备分组的下拉，显示设备 · 路径）→ AI 工具 → 推理强度（只有 Claude Code）。项目确定了设备和工作目录，不再单独选“运行位置”。
- 不可用的项目仍然列出，标出原因且不能创建：设备离线、不能运行 AI 工具、文件夹无法访问。
- AI 工具在那台设备上没有安装时不能选。配对设备上的 Codex 提示“在 X 上运行时，这里不能停止或审批命令”。
- Codex 不显示模型和推理强度（descriptor 没有 `models` / `reasoningOptions`）；任何 AI 工具都不显示模型选择。按 descriptor 显隐，不按工具名硬编码。
- 没有首条消息（`CreateConversationRequest` 不带输入），创建后进入会话并聚焦输入框。
- 入口：项目行的“＋”和项目页的“新建会话”固定项目；侧栏按钮和 Ctrl N 预选当前项目；设备页的“新建会话”预选这台设备上第一个可用的项目。

其他：
- 产品里没有“主 Machine”：这台电脑排第一。
- 手机（≤600px）没有侧栏，设备树由“设备”Tab、设备详情和项目详情代替；面包屑换成“返回 + 当前标题”。≤1000px 时会话的文件面板覆盖在消息上方。

## 2. 视觉规范

全部取值在 `prototype/tokens.css`，浅色与深色**变量名完全一致**，只换值（写在 `<html data-theme>` 上）。

| 角色 | 浅色 | 深色 | 用法 |
|---|---|---|---|
| `--ct-bg` 画布 | #fbfaf8 | #1b1a19 | 内容区背景 |
| `--ct-side` 侧栏 | #f3f1ed | #151413 | 暖灰侧栏、手机 Tab |
| `--ct-surface` 卡片 | #ffffff | #232221 | 卡片、输入框、弹窗 |
| `--ct-line` / `-strong` | #e9e5de / #d8d3ca | #2e2c29 / #3d3a36 | 分隔线 / 输入框边框 |
| `--ct-text` / `-2` / `-3` | #1d1c1a / #5c5852 / #8c877f | #ecebe8 / #aeaaa3 / #7f7b74 | 正文 / 次级 / 提示 |
| `--ct-ink` 主按钮 | #1d1c1a | #ecebe8 | 主按钮用墨色，不用蓝色 |
| `--ct-accent` 强调 | #1a7fd0 | #3c9be3 | 只用于链接、焦点、运行中、选中；全局唯一强调色 |
| `--ct-ok / warn / err` | #1e9a55 / #c98512 / #cc3f36 | #3fbf74 / #e0a341 / #ec6a60 | 圆点用基色，文字用 `-text`（4.5:1），底色用 `-soft` |
| `--ct-agent-codex / claude` | #1d1c1a / #d97757 | #ecebe8 / #e08a6b | AI 工具标识底色 |

- 字体跟随系统：`Segoe UI Variable` + `Microsoft YaHei UI`（Windows），`-apple-system` + `PingFang SC`（Mac）；等宽 `Cascadia Code` / `SF Mono`。
- 字号阶梯 11.5 / 12.5 / 13.5 / 14.5（正文）/ 16 / 19 / 24 / 30；间距以 4 为基数；圆角 6 / 8 / 12 / 16 / 全圆。
- 阴影只用于浮层和可点击卡片的悬停；平面卡片只用 1px 线。
- 布局：标题栏 44，侧栏 248（≤1180 为 224），阅读宽度 740，页面宽度 1040。
- 侧栏设备树：行高 设备 32 / 项目 30 / 会话 30 / “显示全部”和“还没有会话” 26。只有 运行中 / 等待批准 / 失败 显示圆点，其余留空位保持对齐；“＋”在悬停或键盘聚焦时出现。
- 主题偏好：`system | light | dark`，默认 `light`。需要在首帧前写入 `data-theme`（index.html 内联脚本），避免闪烁；`system` 监听 `prefers-color-scheme`。原型用 localStorage `ct-theme` 保存，也接受 `?theme=`。
- Figma 变量集合 `CT/color` 建 Light / Dark 两个 mode，变量名与 CSS 变量一一对应（去掉 `--ct-` 前缀）。
## 3. 组件（packages/ui）

| 新组件 | 基于现有 | 原型类名 | 变化 |
|---|---|---|---|
| AppSidebar | workspace-sidebar.tsx | `.side` `.nav-item` `.side-label` | 待处理 / 设备 + 设备树 + 底部账号/设置。去掉 “My Hosts” 入口 |
| DeviceTree | workspace-sidebar.tsx 的项目区、workspace-sidebar-model.ts | `.tree` `.tree-row.{dev,proj,ses,more,none}` `.tr-add` `.tr-tag` | 基线是 项目 › 会话、一次只展开一个；改为 设备 › 项目 › 会话，可展开多个，置顶在前、默认 4 个；会话状态文字用“等待批准”（基线为“需要处理”） |
| TitleBar | top-bar.tsx | `.topbar` `.crumbs` `.winctl` `.traffic` | 面包屑在标题栏；mac 红绿灯 / Win 窗口控制；可拖动区；内容滚动后才显示底部分隔线 |
| DeviceSection | machines-page.tsx | `.dev-sec` `.dev-h` | 设备页一台设备一节：图标、名称、连接状态、系统 · 架构 · 连接方式、“添加项目” |
| ProjectCard | project-row.tsx | `.pj` `.pj.add` `.pj.dim` | 项目名、状态（进行中圆点或不可用原因）、路径、`N 个会话 · N 个进行中 · N 个可导入`、最近时间；最后一张是“添加项目”卡片 |
| PreviousSessions | previous-conversations-step.tsx | `#native` `.nat-ic` | 一行一个候选：复选框（可继续）/ 对勾（已在 CodeTether，带“打开”）/ 空位（记录格式不支持继续）；重新扫描、导入所选；扫描失败、设备离线时显示说明 |
| AddProjectDialog | add-project-dialog.tsx + add-project-location-dialog.tsx | `addDlg` | 两步：设备 / 文件夹 / 名称 → 已添加 + 以前的会话 |
| SessionItem | product/conversation-item.tsx | `.item` | 标题 + 元信息（设备 · 项目，所在列表已经限定时省略）；右侧状态与时间，悬停换成 置顶 / 归档 / 更多；进行中时“归档”禁用并提示原因 |
| AttentionItem | inbox-item.tsx | `.item.attn` | 三行：会话标题 / 原因（审批时附命令，过长截断）/ 设备 · 项目；右侧时间 + 内联操作。手机上操作换到下一行 |
| StatusTag | status-badge.tsx | `.status.{ok,warn,err,off,run}` | 圆点 + 文字；`run` 带脉冲 |
| AgentBadge | 新建 | `.ag.{codex,claude}` | 方形底色 + 线条图标，三种尺寸 |
| ContextBar | conversation-header.tsx | `.ctx` | 设备 › 项目 · AI 工具 · 推理强度；导入会话加“从 Claude Code 导入” |
| ComposerGate | composer.tsx + conversation-controls.ts | `.dock` `.composer` `.gate` | 输入区固定在同一位置；不能发送时（设备离线 / 等待批准 / 这一轮还没结束）整块替换为说明条 + 下一步；可中断时“停止”在说明条里（基线只在 TopBar） |
| ApprovalCard | pending-action-dock.tsx、product/permission-card.tsx | `.approve` | 命令 + 允许一次 / 拒绝 |
| FailureCard | conversation-failure-card.tsx | `.failcard` | 说明 + 下一步，技术详情折叠 |
| FilesPanel | inspector-panel.tsx | `.panel` `.tabs` | 变更（只有 descriptor 支持 diff 时）/ 文件 / 工具输出；没有“变更”时说明原因 |
| NewSessionDialog | new-conversation-dialog.tsx | `.dialog` `.choices` `.choice` | 项目（按设备分组）→ AI 工具 → 推理强度，见 §1；手机上改为底部弹层 |
| Notice | Banner | `.notice.{info,warn,err,ok}` | 页面级提示，可带操作；`ok` 用于“项目已添加” |
| SettingsRow | settings 各卡片 | `.set-group` `.set-row` | 左标题说明、右控件 |
| SectionState | *-page-states.tsx | `.skel` `.empty` | 骨架 / 空 / 局部错误 + 重试；加载时侧栏设备树和待处理角标同样处于加载中 |
| CommandPalette | 新建（top-bar 的 ⌘K 未接线） | `.palette` | 最近会话（设备 · 项目）、项目、设备、操作（新建会话、添加项目、添加设备、切换主题）；只匹配已加载的标题 |
| Dialog、Seg、Switch、Steps、CodeBlock | 现有 | `.dialog` `.seg` `.switch` `.vsteps` `.term-block` | 换上新 Token |

v3 的 LocationSection、HostRow、ComputerCard（`.pc`）和“仅查看”标记随 v4 去掉。

类名约定：原型里组件类曾和状态修饰类撞名（`.run` 卡片 vs `.dot.run`、树里的 `.conv` 与会话页的 `.conv`），已分别改为 `.runcard`、`.tree-row.ses`。生产实现请用组件作用域（CSS Modules 或带前缀的类名），状态写在 `data-state` 上。带 OS 前缀的选择器（`.os-win .winctl`）在媒体查询里覆盖时要保持同样的特异性；产品代码不使用 `!important`。

## 4. 状态表达（必须分开）

| 维度 | 来源 | 取值 → 文案 |
|---|---|---|
| 会话状态 | `ConversationRecord.status` | running 运行中 · waiting 等待批准 · completed 已完成 · failed 失败 · idle 空闲。侧栏、列表、筛选、待处理用同一套文字 |
| 设备连接 | `MachineConnectionState` | local 这台电脑 · online 在线 · connecting 连接中 · offline 离线（附上次在线）· recovery_required 需要更新地址 · authentication_failed 身份验证失败 · incompatible 版本不兼容 |
| 设备能否运行 | `providerExecution` | 可以 · 不能运行（这台设备当前不能运行 AI 工具） |
| 项目 | 设备状态 + `ProjectLocation.availability` | 可用 · 设备离线 · 不能运行 · 无法访问（找不到文件夹或没有读取权限）。不可用的项目仍显示历史会话 |
| 以前的会话 | provider-sessions `providers[].status` + `failureReason`，候选 `resumeStatus` / `alreadyAdopted` | 可继续 · 已在 CodeTether 中 · 这个版本的记录格式不支持继续；扫描失败：读不到这个文件夹（`provider_session_store_unreadable`）· 设备离线（`machine_offline`）· 暂时无法查找（`provider_session_discovery_unavailable`，AI 工具忙时）· 记录格式不支持（`provider_session_format_unsupported`） |
| 待处理 | `AttentionItem.type` | approval 等待批准 · completed_review 待查看 · failed 失败 |
| 账号 | account session | 未登录 · 已登录 · 这个版本没有配置账号服务 |
| 传输 | `MachineExecutionTransport` | direct 局域网直连 · relay 通过 Relay · unavailable 暂时无法连接 |
| 执行健康 | `executionHealth` + freshness | 正常 / 最近有异常 / 尚未运行过；last_known 时说明“显示的是上次已知的状态” |
| 未取得 | query 未完成 | 骨架屏；值未知时显示“未知”，不要显示 0 |

v3 的“访问（其他主机）”“其他主机在线”“实时输出”“本机共享”四个维度随只读设备一起去掉。离线设备上的缓存内容要标明上次在线时间。

## 5. 能力门控（直接复用 conversation-controls.ts，不要重写判断）

| 能力 | 这台电脑 Codex | 这台电脑 Claude Code | 配对设备 Codex | 配对设备 Claude Code |
|---|---|---|---|---|
| 读历史、项目内搜索 | ✅ | ✅ | ✅ | ✅ |
| 找回以前的会话（发现 + 导入） | ✅ | ✅ | ✅ 设备在线 | ✅ 设备在线 |
| 新建会话 | ✅ 项目可用时 | ✅ 项目可用时 | ✅ 在线 + providerExecution | ✅ 在线 + providerExecution |
| 发送 + 流式 | ✅ | ◐ 仅读取、搜索类工具 | ✅ | ◐ 仅读取、搜索类工具 |
| 中断（停止） | ✅ | ✕ | ✕ | ✕ |
| 工具审批 | ✅ | ✕ | ✕ | ✕ |
| 变更 / Diff | ✅ | ✕ | ✕ | ✕ |
| 推理强度（创建时） | ✕ 无选项 | ✅ 默认 / 低 / 中 / 高 / 很高 / 最高 | ✕ 无选项 | ✅ 同左 |
| 模型选择 | ✕ | ✕ | ✕ | ✕ |
| 运行中排队 / 补充指令 | ✕ | ✕ | ✕ | ✕ |

Claude Code 以 `--tools Read,Glob,Grep --permission-mode dontAsk` 运行，所以只读取和搜索文件，没有审批和变更。中断、审批、Diff 按 machine + provider descriptor 判断：Node 和 Claude 适配器都报告 false，只有这台电脑上的 Codex 为 true。

UI 只读 descriptor 里的 `supportsInterrupt / supportsApprovals / supportsDiff`、`models`、`reasoningOptions`，不按上表硬编码。上表只是对当前代码的核实结果，原型的 `canInterrupt / canApprove / hasDiff` 是简化模拟。

运行中输入：没有 queue / steer，运行中再发送 Host 返回 409 `conversation_busy`。输入区换成说明条“{AI 工具名} 正在工作 · 这一轮完成后可以发送下一条消息”，可中断时带“停止”按钮，否则补一句：“Claude Code 会话暂不支持停止”或“在配对设备上运行的会话暂不支持停止”。

会话整理（与基线一致）：置顶、重命名、归档 / 取消归档。已归档的会话不能置顶，归档时清除置顶；运行中或等待批准时不能归档。没有删除会话的接口。

移除与取消配对（规则与基线一致，Host 仍是最终判断）：

| 操作 | 允许条件 | 不满足时 |
|---|---|---|
| 取消配对设备 | 这台设备上没有任何项目 | 弹窗列出这些项目，只给“知道了”（`machine_has_project_locations`） |
| 移除项目 | 项目没有任何会话，**包括已归档**（project-registry.ts:602） | 弹窗“暂时不能移除项目”，说明会话数和其中已归档的数量 |
| 添加项目 | 设备在线且能运行；同一设备上同一路径已存在时打开原项目 | 离线的设备不能选，说明“恢复在线后才能添加项目” |

- 基线是在确认提交后才显示错误（project-actions.ts:305 `projectErrorMessage`）。v4 在打开弹窗时预先判断：用现有的 `allProjectConversationsQueryOptions`（`archived: 'all'`）取项目会话计数，不需要新接口。提交后仍要保留 `projectErrorMessage` 的错误映射。
- 没有删除会话的接口，所以弹窗只能告诉用户“暂时不能移除”，不能引导去删除会话。“删除会话”列在 `#/roadmap`。

连接流程只有一条：添加设备 `#/add` → Node 配对 `#/add/node`（命令、地址或配对链接、6 位配对码、核对验证码），不需要账号；完成后直接“添加项目”。添加设备页同时说明 Windows 和同一账号下的其他电脑暂时不能添加。
## 6. 数据依赖

| ID | 需求 | 现状 | 过渡方案 |
|---|---|---|---|
| D1 | 侧栏设备树、项目详情 | `GET /machines`、`GET /projects`（项目带 locations）、`GET /projects/:id/conversations`（`provider / status / archived` 筛选，`limit ≤ 100`，没有游标） | 前端按 location 的 `machineId` 把项目挂到设备下，不需要新接口。侧栏只读取展开的项目。一个项目超过 100 个会话时说明“只显示最近 100 个”，引导用项目内搜索。不要用 `GET /snapshot` 拼全量列表：它只含 Host 内存里的会话（host-service.ts:1889-1907） |
| D2 | 找回会话 | 只有项目内搜索：标题 + 你发送过的内容，≤160 字，有游标；没有跨项目搜索 | 项目页搜索框进入 `/projects/:id/search`。Ctrl K 只筛选已加载的标题。跨项目按内容搜索列在 `#/roadmap` |
| D3 | 项目卡片、设备页上的会话数和运行数 | 没有计数接口 | 项目计数来自 D1 的列表，到 100 时显示“100+”；设备详情的“最近的会话”用 `GET /machines/:id` 的最近 100 个。没取到时不显示计数，不要显示 0 |
| D4 | 设备“上次在线”时间 | 需核实 MachineSummary 是否带最后连接时间 | 没有就只显示“离线”，不显示时间 |
| D5 | 自定义标题栏 | `decorations:true` | 可选：Tauri `decorations:false` + `titleBarStyle: overlay`（mac）。也可以保留原生标题栏，把面包屑放回内容顶栏 |
| D6 | 打开应用进入设备 | StartupGate 跳 `/hosts`（startup-gate.tsx:59） | 前端改跳转目标为 `/devices`（首次启动选了项目时进入该项目） |
| D7 | 以前的会话 | `GET /api/v1/projects/:pid/locations/:mid/provider-sessions`（`provider?`、`limit` 默认 50 最大 100、`cursor`、`rescan`）返回 `candidates[]{discoveryCandidateId, provider, title, createdAt?, lastActiveAt?, resumeStatus, alreadyAdopted, conversationId?}`、`providers[]{status, failureReason, candidateCount, corruptEntriesSkipped}`、`nextCursor`；`POST` 同一路径 `{actionId, discoveryCandidateId}` 导入，返回 `adopted / already_adopted`；候选过期 409 `provider_session_candidate_expired`（local-http-server.ts:415） | 添加项目第二步和项目页“以前的会话”都用它；超过一页时“加载更多”。Host 对这台电脑扫描 codex 与 claude-code；配对设备由 Node 的 CodexSessionDiscovery / ClaudeSessionDiscovery 扫描（apps/node/src/provider-session-discovery.ts），设备不在线返回 `machine_offline`。Codex 按 `thread.cwd` 与项目路径完全相等匹配；Claude 按规范化项目路径的摘要匹配。项目卡片上的“N 个可导入”要扫描结果，建议只在打开项目或添加项目时读取，不在设备页逐个扫描 |
| D8 | 导入时过期 | 候选有有效期 | 收到 409 时自动重新扫描并保留勾选（按标题 + 时间匹配），提示“列表已更新” |
| D9 | 文案中文化、用词统一 | `/hosts`、`/hosts/$hostId` 几乎全英文；“My Hosts”；Agent / 智能体 / AI 工具混用 | 随新页面替换；统一用 AI 工具、设备、项目、等待批准 |
| D10 | 主题偏好 | 无（固定深色） | 前端 localStorage + 首帧脚本；Desktop 与浏览器各自保存。需确认范围（§0） |
| D11 | 待处理 | `GET /attention`：approval、completed_review、failed | 直接使用；侧栏角标与待处理页同源 |
| D12 | 同一账号的其他桌面版（后续） | 只签发 `supervisor_read`；`supervisor_control` 有协议和 Host 路由但不签发 | v4 不接；要让它们像配对设备一样出现在“设备”里，需要账号服务签发 control 并补批准流程，见 `#/roadmap` |

## 7. Figma 待写入（本轮未完成）

文件名建议为 `CodeTether · UX Redesign v4`，页面与 Frame 命名同 PNG：

- `00 · 页面清单与核心流程`：01 文档的清单表和 README 的 9 条检查流程。
- `01 · 视觉规范与组件`：变量集合 `CT/color`（Light / Dark 两个 mode）、`CT/space`、`CT/radius`、`CT/type`，取值来自 tokens.css。§3 的全部组件，带 variant（状态、平台、尺寸、主题）；DeviceTree 的行类型单独做组件。
- `02 · 桌面全部页面`：png/02-01 … 02-40，1440×900。02-01…22 设备、项目与会话，02-23…29 添加设备与登录，02-30…40 设置与首次启动。
- `03 · 关键交互状态`：png/03-01 … 03-18，含加载 / 空 / 局部错误、设备离线、文件夹无法访问、不能移除、不能取消配对、未登录、未配置账号服务、1100 宽窄桌面。
- `04 · 平板与手机`：png/04-01 … 04-11，1024 与 390。
- `05 · 后续规划`：png/05-01，与其他页面隔离；部分实现（supervisor_control）和尚未实现分开标注。
- `06 · 深色主题`：png/06-01 … 06-12。用同一组件切换 Dark mode 生成，不复制一份深色组件。

写入要求：变量集合显式设置 scopes；容器全部用 Auto Layout；Frame 名与 PNG 名一致；原型连线覆盖 README 的检查流程；每页写入后截图与 PNG 核对。

## 8. 建议实现顺序

1. Token（浅色；确认后加深色和外观设置）和基础组件：StatusTag、Button、Seg、SectionState、Notice。不改路由。
2. AppSidebar、DeviceTree 与 TitleBar：在 workspace-sidebar-model.ts 里按 location 的 `machineId` 把项目挂到设备下、置顶在前、可展开多个；路由别名（旧 URL 重定向）；StartupGate 跳 `/devices`。先补测试。
3. 设备页与设备详情：DeviceSection、ProjectCard；设备详情的项目列表、最近的会话、AI 工具、连接（更新地址、取消配对的预先判断）。
4. 添加项目 + 以前的会话：AddProjectDialog 两步，复用 createProject / createRemoteProject 和 PreviousConversationsStep 的 actions；项目页常驻“以前的会话”。
5. 项目详情：合并 `/projects/$id` 和 `/projects/$id/conversations`，已归档、筛选、项目内搜索；移除项目的预先判断。
6. 新建会话弹窗：项目（按设备分组）→ AI 工具 → 推理强度，按 descriptor 显隐；各入口的预选和固定。
7. 会话详情：ContextBar、ComposerGate（停止移到说明条）、FilesPanel，中断 / 审批 / 变更按 descriptor 显隐。风险和价值最高，先补测试。
8. 添加设备：复用 AddRemoteMachineDialog 的 actions 和 parsers，只改布局为 4 步页。
9. 待处理、设置（外观 / 账号 / 通知 / 后台运行 / 关于与检查）、Ctrl K；响应式：≤1180 侧栏 224，≤1000 面板覆盖、详情单栏，≤600 底部 Tab 与返回式面包屑。

每一步都要保留：`actionId` 幂等、单一信任变更锁、运行中禁止归档、不自动重发、通知不含会话标题、本地与远程门控。

## 9. 原型说明

- 打开方式和 URL 参数见 [README.md](README.md)。所有数据来自 `data.js`（`NATIVE` 是各项目文件夹里的演示候选），标题栏右侧固定显示“演示数据”标记；按钮只修改内存，不调用任何 Host、授权、删除或 Agent 执行接口。
- 文件：`tokens.css`（双主题 Token）· `base.css`（窗口、侧栏与设备树、标题栏、按钮、输入）· `components.css`（列表、卡片、状态、设备节、项目卡片）· `conversation.css` · `screens.css`（各页面、弹窗、响应式）；脚本 `core.js`（数据访问、门控、外壳、设备树、公共片段）· `devices.js`（设备、设备详情）· `projects.js`（项目详情、以前的会话、项目内搜索）· `inbox.js`（待处理）· `add.js`（添加设备、登录）· `conv.js` · `more.js`（设置、首次启动、后续规划）· `router.js`（路由、浮层、添加项目、新建会话、快捷键）。
- `frame.html` 供导出手机截图用：headless Chrome 窗口最小约 500px，所以用固定尺寸的 iframe 加载 `index.html`。`bash export-png.sh` 重新导出全部截图和 `png/00-overview.png`；增减截图后要同步修改脚本末尾的总览高度。

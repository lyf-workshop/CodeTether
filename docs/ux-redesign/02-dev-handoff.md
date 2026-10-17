# 02 · 开发交接说明（v2）

面向下一轮按设计稿重构前端的实现者。功能映射见 [01-feature-inventory-and-mapping.md](01-feature-inventory-and-mapping.md)，可点击原型见 `prototype/index.html`，截图见 `png/` 与 [overview.html](overview.html)。

**仍未写入 Figma**。会话中没有暴露 Figma MCP 写入工具（`use_figma`、`create_new_file`），所以在“创建文件”这一步受阻。§7 是写入计划。AGENTS.md 规定 Figma 是 UI 唯一事实来源，因此在 Figma 文件建好并审批前，原型与截图只是设计提案，不能作为实现依据。

## 0. 实现前需要确认

| 事项 | 现状 | 需要的决定 |
|---|---|---|
| 设计事实来源 | Figma 未写入，只有本地原型 | 先补 Figma 再实现；或者临时以原型为准，事后补 Figma（需修改 AGENTS.md 约定） |
| 主题切换 | 基线固定深色：`apps/web/src/main.tsx:15` 写死 `dataset.theme = 'dark'`，`packages/ui` 只有深色 Token | v2 默认浅色，设置 › 外观提供 跟随系统 / 浅色 / 深色。这是**新增的纯前端能力**，需要确认是否纳入本轮；不纳入时只上线浅色 Token，深色截图（06-*）留作后续 |
| Agent 标识 | 原型用抽象线条图标 + 品牌色（`.ag`），不是官方 Logo | 若要用官方 Logo，需确认授权后单独提供素材；不要直接取用仓库中未跟踪的 `packages/ui/src/assets/` |
| mac 文案 | 托盘菜单“打开 CodeTether / 退出 CodeTether”与“关闭窗口后继续运行”已在基线核实（system_tray.rs、host_supervisor.rs） | “⌘ W 关闭窗口”和“菜单栏”说法未在 Mac 实机上核对，实现前需要验证 |
| 首次启动步骤 | 基线 7 步（computer_check 与 provider_check 分开） | 原型把两步合并为“检查 AI 工具”共 6 步；只改展示，状态机仍用基线 7 个 step |

## 1. 信息架构

```
侧栏（桌面）                                          手机底部 Tab
├─ 品牌 + 搜索（Ctrl K 命令面板）                      首页 · 待处理 · 电脑 · 设置
├─ 新建会话（Ctrl N）
├─ 首页        /home      需要你处理 / 正在运行 / 最近
├─ 待处理      /inbox     （角标 = 打开的事项数）
├─ 我的电脑    /computers
│   ├─ 本机和配对的电脑 → /computers/:machineId（完整访问）
│   ├─ 已授权的其他主机 → /computers/:hostId（仅查看）
│   └─ 同一账号下的其他电脑：申请查看 / 取消申请 / 重新申请
├─ 项目        /projects → /projects/:id
├─ 最近（8 条）+ “全部” → /sessions（?view=archived 已归档）
└─ 底部：账号 → /settings/account · 设置图标 → /settings/appearance

其他页面：/c/:id 会话 · /search 搜索 · /add 添加电脑（/add/desktop、/add/node?step=1..4）
/signin 登录 · /onboarding 首次启动 · /settings/:section · /roadmap 后续规划（与当前功能隔离）
```

旧路由重定向：`/devices`、`/hosts` → `/computers`；`/pair` → `/add/node`；`/connect` → `/add`；`/account` → `/settings/account`；`/doctor` → `/settings/about`；`/settings` → `/settings/appearance`。生产路由对应：`/machines` → `/computers`，`/hosts/$hostId` → `/computers/$hostId`，StartupGate 完成后进入 `/home`（原为 `/inbox`）。

命名：界面上统一叫“电脑”（Machine），不再用“设备”。“本机 / 已配对”是本机主机下的 Machine（完整访问）；“其他主机”是同一账号下别的 Desktop Host（supervisor_read，仅查看）。“设备”只用于主机方的访问申请（“MacBook Air 想查看这台电脑”）。

上下文一致性：
- 会话标题下的上下文条是 `电脑 › 项目 · AI 工具`，前两段可点击。标题栏面包屑、上下文条和输入区说明都取自 `conversation.machineId / projectId`，不允许另取当前选中的电脑。
- 新建会话弹窗的顺序是 电脑 → 项目（只列出在该电脑有文件夹的项目）→ AI 工具；Codex 额外有 模型 / 推理强度。从电脑详情打开时预选该电脑，从项目详情打开时预选该项目。
- 产品里没有“主 Machine”：本机排第一，标为“本机”。
- 手机（≤600px）没有侧栏，面包屑换成“返回 + 当前标题”；≤1000px 时会话的文件面板改为覆盖在消息上方，不再挤压阅读宽度。

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
| `--ct-agent-codex / claude` | #1d1c1a / #d97757 | #ecebe8 / #e08a6b | Agent 标识底色 |

- 字体跟随系统：`Segoe UI Variable` + `Microsoft YaHei UI`（Windows），`-apple-system` + `PingFang SC`（Mac）；等宽 `Cascadia Code` / `SF Mono`。
- 字号阶梯 11.5 / 12.5 / 13.5 / 14.5（正文）/ 16 / 19 / 24 / 30；间距以 4 为基数；圆角 6 / 8 / 12 / 16 / 全圆。
- 阴影只用于浮层和可点击卡片的悬停；平面卡片只用 1px 线。
- 布局：标题栏 44，侧栏 248（≤1180 为 224），阅读宽度 740，页面宽度 1040。
- 主题偏好：`system | light | dark`，默认 `light`。需要在首帧前写入 `data-theme`（index.html 内联脚本），避免闪烁；`system` 监听 `prefers-color-scheme`。原型用 localStorage `ct-theme` 保存，也接受 `?theme=`。
- Figma 变量集合 `CT/color` 建 Light / Dark 两个 mode，变量名与 CSS 变量一一对应（去掉 `--ct-` 前缀）。

## 3. 组件（packages/ui）

| 新组件 | 基于现有 | 原型类名 | 变化 |
|---|---|---|---|
| AppSidebar | workspace-sidebar.tsx | `.side` `.nav-item` `.recent` | 4 个主项 + 最近 8 条 + 底部账号/设置；不再显示项目树 |
| TitleBar | top-bar.tsx | `.topbar` `.crumbs` `.winctl` `.traffic` | 面包屑在标题栏；mac 红绿灯 / Win 窗口控制；可拖动区；内容滚动后才显示底部分隔线 |
| SessionItem | product/conversation-item.tsx | `.item` | 标题 + 元信息（AI 工具图标 · 电脑 · 项目）；右侧状态与时间，悬停换成 置顶 / 归档 / 更多 |
| AttentionItem | inbox-item.tsx | `.item.attn` | 三行：会话标题 / 原因（审批时附命令，过长截断）/ 电脑 · 项目；右侧时间 + 内联操作（允许一次 / 拒绝、查看结果）。手机上操作换到下一行 |
| RunCard | 新建 | `.runcard` | 首页“正在运行”：当前步骤 + 已运行时间 |
| ComputerCard | product/machine-badge.tsx | `.pc` | 图标、名称、系统 · 类型、连接状态、AI 工具；仅查看主机带“仅查看”标记 |
| HostRow | host-directory-page.tsx | `.item.static` + `hostRow` | 访问状态 + 申请查看 / 取消申请 / 重新申请 |
| StatusTag | status-badge.tsx | `.status.{ok,warn,err,off,run}` | 圆点 + 文字；`run` 带脉冲 |
| AgentBadge | 新建 | `.ag.{codex,claude}` | 方形底色 + 线条图标，三种尺寸 |
| ContextBar | 新建 | `.ctx` | 电脑 › 项目 · AI 工具；导入会话加“从 Claude Code 导入” |
| ComposerGate | composer.tsx + conversation-controls.ts | `.dock` `.composer` `.gate` | 输入区固定在同一位置；不能发送时整块替换为说明条 + 下一步，不显示可用的发送框 |
| ApprovalCard | product/permission-card.tsx | `.approve` | 命令 + 允许一次 / 拒绝 |
| FailureCard | conversation-failure-card.tsx | `.failcard` | 说明 + 下一步，技术详情折叠 |
| FilesPanel | inspector-panel.tsx | `.panel` `.tabs` | 变更 / 文件 / 输出；Claude Code 只有文件并说明原因 |
| Notice | Banner | `.notice.{info,warn,err}` | 页面级提示，可带操作 |
| SettingsRow | settings 各卡片 | `.set-group` `.set-row` | 左标题说明、右控件 |
| SectionState | *-page-states.tsx | `.skel` `.empty` | 骨架 / 空 / 局部错误 + 重试；首页加载时侧栏“最近”和待处理角标同样处于加载中，不提前显示 |
| CommandPalette | 新建（top-bar 的 ⌘K 未接线） | `.palette` | 筛选已加载的会话标题、跳转电脑与项目、新建会话、添加电脑、切换主题 |
| Dialog、Seg、Switch、Steps、CodeBlock | 现有 | `.dialog` `.seg` `.switch` `.vsteps` `.term-block` | 换上新 Token；手机上表单类弹窗（新建会话）改为底部弹层，操作按钮固定在底部 |

类名约定：原型里组件类曾和状态修饰类撞名（`.run` 卡片 vs `.dot.run`），已改为 `.runcard`。生产实现请用组件作用域（CSS Modules 或带前缀的类名），状态写在 `data-state` 上。带 OS 前缀的选择器（`.os-win .winctl`）在媒体查询里覆盖时要保持同样的特异性；产品代码不使用 `!important`。

## 4. 状态表达（必须分开）

| 维度 | 来源 | 取值 → 文案 |
|---|---|---|
| 连接 | `MachineConnectionState` | local 这台电脑 · online 在线 · connecting 连接中 · offline 离线 · recovery_required 需要更新地址 · authentication_failed 身份验证失败 · incompatible 版本不兼容 |
| 访问（本机主机下） | `MachineTrustState` | local 本机 · trusted 完整访问（已配对） |
| 访问（其他主机） | host access + grant scope | authorized 已授权 · 仅查看 · pending 等待对方批准 · denied 对方已拒绝 · cancelled 申请已取消 · expired 申请已过期 · none 尚未申请 |
| 其他主机在线 | presence（实际连接判断） | checking 检查中 · online 在线 · unreachable 无法连接 |
| 实时输出 | remote live state | idle 不显示 · connecting 正在连接 · live 运行中 · disconnected 与 X 的实时连接已断开（显示最后同步内容 + 重新连接） |
| 账号 | account session | 未登录 · 已登录 · 这个版本没有配置账号服务 |
| 本机共享 | local host lifecycle | disabled 关闭 · enabled_unclaimed 设置还没有完成 · claimed 已开启 |
| 传输 | `MachineExecutionTransport` | direct 局域网直连 · relay 通过 Relay · unavailable 暂时无法连接 |
| 执行健康 | `executionHealth` + freshness | 正常 / 最近有异常 / 尚未运行过；last_known 时说明“显示的是上次已知的状态” |
| 会话状态 | Conversation status | 运行中 / 待查看 / 已完成 / 失败 / 空闲 |
| 未取得 | query 未完成 | 骨架屏；值未知时显示“未知”，不要显示 0 |

离线电脑上的缓存内容要标明上次在线时间。
## 5. 能力门控（直接复用 conversation-controls.ts，不要重写判断）

| 能力 | 本地 Codex | 本地 Claude Code | 配对电脑 Codex | 配对电脑 Claude Code |
|---|---|---|---|---|
| 读历史、搜索 | ✅ | ✅ | ✅ | ✅ |
| 发送 + 流式 | ✅ | ✅ | ✅（online + providerExecution） | ◐ 仅读取、搜索类工具 |
| 中断 | ✅ | ✕ | ✕ | ✕ |
| 工具审批 | ✅ | ✕ | ✕ | ✕ |
| 变更 / Diff | ✅ | ✕ | 按 descriptor | ✕ |
| 运行中排队 / 补充指令 | ✕ | ✕ | ✕ | ✕ |

上表四列都是**本机主机**下的电脑（本机或 Node 配对）。**其他主机**（supervisor_read）另算：只能查看历史、项目、电脑、AI 工具可用性和运行中输出；不能发送、新建、审批或中断，输入区换成“你对 X 只有查看权限”说明条。supervisor_control 后端存在但不可达，见 `#/roadmap`。

UI 只读 descriptor 里的 `supportsInterrupt / supportsApprovals / supportsDiff`，不按上表硬编码。上表只是对当前代码的核实结果，原型的 `canInterrupt / canApprove` 是简化模拟。

运行中输入：没有 queue / steer。输入区换成说明条“{AI 工具名} 正在工作 · 这一轮完成后可以发送下一条消息”，可中断时带“停止”按钮，否则按原因补一句：“Claude Code 会话暂不支持停止”或“在其他电脑上运行的会话暂不支持停止”。

移除与取消配对（规则与基线一致，Host 仍是最终判断）：

| 操作 | 允许条件 | 不满足时 |
|---|---|---|
| 取消配对电脑 | 这台电脑上没有任何项目文件夹 | 弹窗列出这些项目，只给“知道了”（`machine_has_project_locations`） |
| 移除项目 | 项目没有任何会话，**包括已归档**（project-registry.ts:602） | 弹窗“暂时不能移除项目”，说明会话数和其中已归档的数量 |
| 移除文件夹 | 只限配对电脑上的文件夹，且不是项目的最后一个文件夹，该电脑上也没有这个项目的会话（conversation-store.ts:2324-2361） | 本机文件夹和最后一个文件夹不显示“移除”；有会话时弹窗“暂时不能移除文件夹” |

- 基线是在确认提交后才显示错误（project-actions.ts:305 `projectErrorMessage`）。v2 在打开弹窗时预先判断：用现有的 `allProjectConversationsQueryOptions`（`archived: 'all'`）取项目会话，按 `machineId` 过滤得到文件夹的会话数，不需要新接口。
- 预先判断只用来改文案，提交后仍要保留 `projectErrorMessage` 的错误映射，处理判断之后又新建了会话的情况。
- 没有删除会话的接口，所以弹窗只能告诉用户“暂时不能移除”，不能引导去删除会话。“删除会话”列在 `#/roadmap`。

三条连接流程分开，不混用文案：
1. 安装 Desktop → 登录 → 设置 › 账号与共享 › “允许其他电脑查看这台电脑”。
2. 配对服务器（`#/add/node`）：只有这里出现 Node 命令、地址和 6 位配对码；不需要账号。
3. 查看同一账号下的其他电脑（我的电脑 › “申请查看”）：对方批准后仅查看。

## 6. 数据依赖

| ID | 需求 | 现状 | 过渡方案 |
|---|---|---|---|
| D1 | 首页、全部会话、侧栏“最近”跨项目、跨电脑列表 | 只有按项目的接口 | 前端对 `listProjects` 结果并发调用 `listProjectConversations` 后合并（`allProjectConversationsQueryOptions` 已有类似实现，见 conversation-list-query.ts:50）。项目很多时需要新增 Host 聚合接口 |
| D2 | 全局搜索 | 只有项目内搜索（AGENTS.md 列为范围外） | 搜索页默认当前或最近的项目，写明“不搜索 AI 回复、工具输出和其他主机”。Ctrl K 只筛选已加载的标题。跨项目搜索需要新增 Host 聚合/搜索接口 |
| D3 | 电脑卡片、电脑详情上的会话数、运行数 | 没有可靠计数 | 原型显示了“N 个会话 / N 个运行中”。D1 完成后从合并结果计算；完成前隐藏计数 |
| D4 | 电脑“上次在线”时间 | 需核实 MachineSummary 是否带最后连接时间 | 没有就只显示“离线”，不显示时间 |
| D5 | 自定义标题栏 | `decorations:true` | 可选：Tauri `decorations:false` + `titleBarStyle: overlay`（mac）。也可以保留原生标题栏，把面包屑放回内容顶栏 |
| D6 | 首次启动完成后进入首页 | StartupGate 跳 `/inbox` | 前端改跳转目标即可 |
| D7 | 其他主机的会话数、运行数、“正在运行”卡片 | supervisor_read 只按主机读取 | 逐个已授权主机读取后合并；读不到时只显示主机，不显示计数 |
| D8 | 撤销授权、新申请通知 | 无接口调用 / 无通知 | 设置里写明“已批准的设备暂时不能在这里撤销”，入口指向后续规划 |
| D9 | 本机共享的平台文字 | 硬编码 macOS | 从运行平台读取 |
| D10 | 账号区文案中文化 | My Hosts 为英文 | 随新页面替换 |
| D11 | 主题偏好 | 无（固定深色） | 前端 localStorage + 首帧脚本；Desktop 与浏览器各自保存。需确认范围（§0） |

## 7. Figma 待写入（本轮未完成）

文件名建议为 `CodeTether · UX Redesign v2`，页面与 Frame 命名同 PNG：

- `00 · 页面清单与核心流程`：01 文档的清单表和 README 的 7 条检查流程。
- `01 · 视觉规范与组件`：变量集合 `CT/color`（Light / Dark 两个 mode）、`CT/space`、`CT/radius`、`CT/type`，取值来自 tokens.css。§3 的全部组件，带 variant（状态、平台、尺寸、主题）。
- `02 · 桌面全部页面`：png/02-01 … 02-42，1440×900。02-01…14 首页与会话，02-15…30 项目、电脑与连接，02-31…42 设置与首次启动。
- `03 · 关键交互状态`：png/03-01 … 03-16，含加载 / 空 / 局部错误、离线、主机无法连接、实时断开、未登录、未配置账号服务、1100 宽窄桌面。
- `04 · 平板与手机`：png/04-01 … 04-11，1024 与 390。
- `05 · 后续规划`：png/05-01，与其他页面隔离；部分实现（supervisor_control）和尚未实现分开标注。
- `06 · 深色主题`：png/06-01 … 06-11。用同一组件切换 Dark mode 生成，不复制一份深色组件。

写入要求：变量集合显式设置 scopes；容器全部用 Auto Layout；Frame 名与 PNG 名一致；原型连线覆盖 README 的检查流程；每页写入后截图与 PNG 核对。

## 8. 建议实现顺序

1. Token（浅色；确认后加深色和外观设置）和基础组件：StatusTag、Button、Seg、SectionState、Notice。不改路由。
2. AppSidebar 与 TitleBar：新导航、最近列表、路由别名（旧 URL 重定向）。
3. 会话详情：ContextBar、ComposerGate、FilesPanel，中断 / 审批按 descriptor 显隐。风险和价值最高，先补测试。
4. 我的电脑与电脑详情（会话列表 + AI 工具 / 项目文件夹 / 连接三张卡，各自处理局部状态），其他主机详情。
5. 首页与全部会话（先做 D1 的前端合并），搜索页，Ctrl K。
6. 添加电脑：复用 AddRemoteMachineDialog 的 actions 和 parsers，只改布局为 4 步页。
7. 待处理、项目、设置（拆分为 外观 / 账号与共享 / 通知 / 后台运行 / 关于与检查），检查状态并入“关于与检查”。
8. 响应式：≤1180 侧栏 224，≤1000 面板覆盖、详情单栏，≤600 底部 Tab 与返回式面包屑。

每一步都要保留：`actionId` 幂等、单一信任变更锁、运行中禁止归档、不自动重发、通知不含会话标题、本地与远程门控。

## 9. 原型说明

- 打开方式和 URL 参数见 [README.md](README.md)。所有数据来自 `data.js`，标题栏右侧固定显示“演示数据”标记；按钮只修改内存，不调用任何 Host、授权、删除或 Agent 执行接口。
- 文件：`tokens.css`（双主题 Token）· `base.css`（窗口、侧栏、标题栏、按钮、输入）· `components.css`（列表、卡片、状态）· `conversation.css` · `screens.css`（各页面、弹窗、响应式）；脚本 `core.js`（外壳与公共片段）· `home.js` · `projects.js` · `computers.js` · `add.js` · `conv.js` · `more.js`（设置、登录、首次启动、后续规划）· `router.js`（路由、浮层、快捷键）。
- `frame.html` 供导出手机截图用：headless Chrome 窗口最小约 500px，所以用固定尺寸的 iframe 加载 `index.html`。`bash export-png.sh` 重新导出全部截图和 `png/00-overview.png`；增减截图后要同步修改脚本末尾的总览高度。

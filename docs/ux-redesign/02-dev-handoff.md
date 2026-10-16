# 02 · 开发交接说明

面向下一轮按设计稿重构前端的实现者。功能映射见 [01-feature-inventory-and-mapping.md](01-feature-inventory-and-mapping.md)，可点击原型见 `prototype/index.html`，截图见 `png/` 与 [overview.html](overview.html)。

**本轮仍未写入 Figma**。第二轮已加载 Figma 插件技能（figma-use 等），但会话中没有暴露 Figma MCP 写入工具（`use_figma`、`create_new_file`），也没有加载它们的入口，所以在“创建文件”这一步受阻。§6 是按真实工具规则整理的写入计划。AGENTS.md 规定 Figma 是 UI 唯一事实来源，因此在 §6 的 Figma 文件建好并审批前，原型与截图只是设计提案，不能作为实现依据。

## 1. 信息架构

```
主导航（固定 4 项）        浏览区（低频）             本机主机（快捷）        其他主机 · 只读（快捷）
├─ 会话   /                ├─ 项目   /projects         └─ 每台 Machine        └─ 已授权主机 → /hosts/:id
├─ 设备   /devices         └─ 已归档 /?view=archived
│   ├─ 本机主机：Machine 卡片 → /devices/:id；添加 CodeTether Node → /pair
│   ├─ 其他主机：主机卡片 → /hosts/:id → /hosts/:id/c/:cid（只读）
│   └─ 访问申请（本机作为主机时）
├─ 待处理 /inbox
└─ 设置   /settings/:section（含 账号与主机 → /account）
连接另一台电脑 /connect：Desktop 主机（?mode=desktop）· Node（/pair）· 已在列表中
```

默认路径：打开 CodeTether → 会话（或 设备 → 设备详情）→ 会话详情。

上下文一致性规则：
- 会话详情始终显示上下文条：`设备(连接状态) / 项目 / Agent`。三段都可点击，分别跳到设备详情、项目详情和 Agent 信息。
- 标题栏面包屑、上下文条和 Composer 下方的“在 X · Y 上运行”使用同一个 `conversation.machineId / projectId`，不允许另取当前选中的设备。
- Host 下可以有多个 Machine。“设备”就是 Machine，本机是 `kind=local`。产品里没有“主 Machine”的概念：本机作为第一张卡片和“这台电脑”显示，其余按名称排序。
- 设备详情里的“新建会话”预选该设备，新建会话弹窗的顺序是 设备 → 项目（只列出在该设备有位置的项目）→ Agent。

## 2. 组件复用（packages/ui）

| 新组件 | 基于现有 | 变化 |
|---|---|---|
| AppNav | workspace-sidebar.tsx | 4 个主项、浏览区、设备快捷区；<1200px 仅显示图标；手机改为底部 Tab |
| TitleBar | top-bar.tsx | 面包屑与 ⌘K 放进标题栏；平台变体 mac / win；`data-tauri-drag-region` |
| SessionRow | product/conversation-item.tsx | 两行：标题 + 元信息（Agent·项目·设备）；右侧状态与时间；悬停时显示 Pin / 归档 / 更多 |
| DeviceCard | product/machine-badge.tsx | 连接、访问、AI 工具、项目数、“下一步”分行表达 |
| StatusTag | status-badge.tsx | 圆点加文字，变体见 §3 |
| ContextBar | 新建 | 设备 / 项目 / Agent 三段 |
| ComposerGate | composer.tsx + conversation-controls.ts | 不可发送时整块替换为说明条和下一步，不再只是禁用输入框 |
| ApprovalCard | product/permission-card.tsx | 不变 |
| FailureCard | conversation-failure-card.tsx | 不变，技术详情折叠 |
| SectionState | *-page-states.tsx | 统一加载 / 空 / 错误 / 局部重试 |
| Tabs、Dialog、Menu、SearchInput、Select、CodeBlock | 现有 | 换上新 token |

Tokens 见 `prototype/tokens.css`。颜色沿用 `globals.css`，品牌色补 `#37b8ff`（来自 app-icon），次级文字提亮到 `#a7b5c7` 以满足长时间阅读。字号阶梯是 11/12/13/14/16/20/24/30，间距以 4 为基数，圆角 4/8/12/全圆。

## 3. 状态表达（必须分开）

| 维度 | 来源 | 取值 → 文案 |
|---|---|---|
| 连接 | `MachineConnectionState` | local 本机 · online 在线 · connecting 连接中 · offline 离线 · recovery_required 需要更新地址 · authentication_failed 身份验证失败 · incompatible 版本不兼容 |
| 访问（本机主机） | `MachineTrustState` | local 本机完全访问 · trusted 已配对（可查看与发送） |
| 访问（其他主机） | host access + grant scope | authorized 已授权 · 只读（supervisor_read）· pending 等待对方批准 · denied 已被拒绝 · cancelled 已取消 · expired 已过期 · none 需要申请访问 |
| 其他主机在线 | presence（实际连接判断） | checking 检查中 · online 在线 · unreachable 无法连接 |
| 实时输出 | remote live state | idle 不显示 · connecting 正在连接实时输出 · live 正在实时查看 · disconnected 实时连接已断开（重新连接） |
| 账号 | account session | 未登录 · 已登录 · 未配置账号服务；本机主机 disabled 未启用 · enabled_unclaimed 设置未完成 · claimed 已启用 |
| 传输 | `MachineExecutionTransport` | direct 局域网直连 · relay 经 Internet Relay · unavailable 不显示 |
| AI 工具安装 | Provider availability | 可用 / 不可用 / 版本不支持… |
| 执行健康 | `executionHealth` + freshness | 正常 / 最近有异常 / 不可用 / 尚未观察；last_known 时加“（上次已知）” |
| 会话状态 | Conversation status | 运行中 / 需要处理 / 已完成 / 运行失败 / 空闲 |
| 未取得 | query 未完成 | 骨架屏；值未知时显示“未知”，不要显示 0 |

离线设备上的缓存内容要标明“更新于 …”。

## 4. 能力门控（直接复用 conversation-controls.ts，不要重写判断）

| 能力 | 本地 Codex | 本地 Claude Code | 远程 Codex | 远程 Claude Code |
|---|---|---|---|---|
| 读历史、搜索 | ✅ | ✅ | ✅ | ✅ |
| 发送 + 流式 | ✅ | ✅ | ✅（online + providerExecution） | ◐ 仅读取、搜索类工具 |
| 中断 | ✅ | ✕ | ✕ | ✕ |
| 工具审批 | ✅ | ✕ | ✕ | ✕ |
| 变更 / Diff | ✅ | ✕ | 按 descriptor | ✕ |
| 运行中排队 / 补充指令 | ✕ | ✕ | ✕ | ✕ |

上表四列都是**本机主机**下的 Machine（本地或 Node 配对）。**其他主机**（supervisor_read）另算：只能查看历史、项目、Machine、Provider 可用性和运行中输出；不能发送、新建、审批或中断。supervisor_control 后端存在但不可达，见 05。

UI 只读 descriptor 里的 `supportsInterrupt / supportsApprovals / supportsDiff`，不按上表硬编码。上表只是对当前代码的核实结果，原型的 `canInterrupt / canApprove` 是简化模拟。

运行中输入：没有 queue / steer 能力。Composer 换成说明条“{Agent} 正在执行本轮，暂不支持排队或补充指令。”，可中断时加“可以等待完成，或中断后重新发送”，否则“请等待本轮完成后再发送”。

三条连接流程分开，不混用文案：
1. 安装 Desktop → 登录账号 → 启用“作为主机”（设置 › 账号与主机）。
2. 安装并配对 Remote Linux Node（`#/pair`）：只有这里出现 Node 命令、地址和 6 位配对码。
3. 申请访问其他主机（设备 › 其他主机卡片上的“申请访问”）：结果是只读。

## 5. 数据依赖

| ID | 需求 | 现状 | 过渡方案 |
|---|---|---|---|
| D1 | 会话首页跨项目、跨设备列表 | 只有按项目的接口 | 前端对 `listProjects` 结果并发调用 `listProjectConversations` 后合并（`allProjectConversationsQueryOptions` 已有类似实现，见 conversation-list-query.ts:50）。项目很多时需要新增 Host 聚合接口 |
| D2 | 全局搜索 | 只有项目内搜索（AGENTS.md 列为范围外） | 搜索页显示“搜索范围”选择器，默认当前或最近的项目；帮助文字写明“不搜索 Agent 回复、工具输出或其他主机”。会话首页的输入框只筛选已加载标题。跨项目搜索需要新增 **Host 聚合/搜索接口** |
| D7 | 其他主机的会话数、运行数 | supervisor_read 只按主机读取 | 不展示计数；需要聚合接口 |
| D8 | 撤销授权、新申请通知 | 无接口调用 / 无通知 | 当前界面写明“目前还不能撤销”；05 规划 |
| D9 | 本机作为主机的平台文字 | 硬编码 macOS | 从运行平台读取 |
| D10 | 账号区文案中文化 | My Hosts 为英文 | 重构时随新页面替换 |
| D3 | 设备卡片上的会话数、运行数 | 没有可靠计数 | 不展示。D1 完成后可从合并结果计算 |
| D4 | 设备“上次在线”时间 | 需核实 MachineSummary 是否带最后连接时间 | 没有就显示“离线”，不显示时间 |
| D5 | 自定义标题栏 | `decorations:true` | 可选：Tauri `decorations:false` + `titleBarStyle: overlay`（mac）。也可以保留原生标题栏，只把面包屑放回内容顶栏 |
| D6 | 首次启动完成后跳转会话页 | StartupGate 跳 `/inbox` | 前端改跳转目标即可 |

## 6. Figma 待写入（本轮未完成）

文件名建议为 `CodeTether · UX Redesign 2026-10`，页面与 Frame 命名同 PNG：

- `00 · 页面清单与核心流程`：01 文档的清单表，以及 6 条流程（首次启动→会话、设备→详情→会话、会话首页→搜索→会话、待处理→会话、配对 4 步、设置→子页）。
- `01 · 视觉规范与组件`：变量集合 `CT/color`、`CT/space`、`CT/radius`、`CT/type`，取值来自 tokens.css。§2 的全部组件，带 variant（状态、平台、尺寸）。
- `02 · 桌面全部页面`：png/02-01 … 02-36，1440×900（02-28 起为账号、其他主机、只读会话、连接方式）。
- `03 · 关键交互状态`：png/03-01 … 03-15，含 1100 宽窄桌面、主机无法连接、实时断开、未登录、未配置账号服务、访问状态。
- `04 · 平板与手机`：png/04-01 … 04-12，1024 和 390。
- `05 · 后续规划`：png/05-01，与其他页面隔离；部分实现（supervisor_control）和尚未实现分开标注。

写入要求：变量集合显式设置 scopes；容器全部用 Auto Layout；组件带 variant（StatusTag 状态、Button 类型/尺寸、HostCard access、ReadonlyBar、ComposerGate）；Frame 名与 PNG 名一致；原型连线覆盖 README 列出的 6 条流程；每页写入后截图核对。

原型流程对应的 hash 路由见 01 文档的“原型 Frame”列。

## 7. 建议实现顺序

1. 换 Tokens 和基础组件（StatusTag、Button、Tabs、SectionState），不改路由。
2. AppNav 和 TitleBar：新导航、路由别名（`/machines`→`/devices`，保留旧 URL 重定向）。
3. 会话详情：ContextBar、ComposerGate、中断/审批按 descriptor 显隐。这是风险最高、价值最高的部分，要先补测试。
4. 设备列表和设备详情（Tabs，项目与会话各自处理局部状态）。
5. 会话首页（先实现 D1 的前端合并）和搜索页。
6. 连接另一台电脑页：复用 AddRemoteMachineDialog 的 actions 和 parsers，只改布局。
7. 待处理、项目、设置（拆分 section）、检查状态迁移。
8. 响应式：<1200 仅图标，≤1024 收起 Rail，≤600 底部 Tab。

每一步都要保留：`actionId` 幂等、单一信任变更锁、运行中禁止归档、不自动重发、通知不含会话标题、本地与远程门控。

## 8. 原型说明

- `prototype/index.html` 用浏览器直接打开即可（file://），不访问网络。`?os=mac` 切换标题栏样式。
- 所有数据来自 `data.js`，左下角固定显示“演示数据”标记。按钮只修改内存，不调用任何 Host、授权、删除或 Agent 执行接口。
- `bash export-png.sh` 重新导出全部截图（需要 Chrome）。

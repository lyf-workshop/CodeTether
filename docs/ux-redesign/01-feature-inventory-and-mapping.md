# 01 · 页面与功能清单 / 新旧映射

依据：已验收产品基线 **`bbcda690a081`**（Mac、Windows 均为此版本）的 `apps/web/src`（路由、组件、runtime/host、runtime/account）、`packages/protocol`、`apps/host`、`apps/desktop/src-tauri`、`apps/node`。第一轮盘点误读了较早的工作分支（ee11867），账号、其他主机、supervisor_read、访问申请的结论已按 bbcda69 更正。
状态：✅ 已实现 · ◐ 部分实现 · ✕ 尚未实现。
“原型 Frame” 列对应 `png/` 编号（`prototype/` 中的同名页面）；Figma 写入后 Frame 名称与 PNG 名相同（见 02 文档 §7）。标“缺口”的条目是原型没有画、但实现必须保留的现有能力。

## 关键事实（影响设计的结论）

| 主题 | 代码中的真实情况 | 源码 |
|---|---|---|
| 账号登录 | ✅ Supabase 邮箱一次性登录码（`shouldCreateUser:false`，只能登录已有账号）。入口只在 `/hosts`（My Hosts）页，文案为英文；退出登录在该页头部；设置里没有账号区。未配置账号服务时构建失败。 | runtime/account/control-plane-client.ts；routes/host-directory-page.tsx |
| 本机作为主机 | ✅ “Enable this Mac as a Host” 卡片，状态 `disabled → enabled_unclaimed → claimed`。平台文字硬编码为 macOS（Windows 上也显示 Mac）。 | host-directory-page.tsx |
| 两层结构 | **本机主机**（Desktop 内置 Host）= 1 个 `local` Machine + 经 Node 配对的 `remote` Machine（最多 64）。**其他主机** = 同一账号下其他电脑上的 Desktop Host，经账号发现、申请后只读查看。两者入口、认证和权限都不同。 | protocol machines.ts；listAuthorizedHosts / listOwnedHosts |
| 访问权限分级 | ✅ `supervisor_read` 已实现：其他主机授权后只读查看 Machine、项目、会话列表、transcript、Provider 可用性和运行中输出（live: idle/connecting/live/disconnected）。协议枚举含 `supervisor_control`，但控制面只签发 `supervisor_read`。 | protocol grant scope；remote-supervisor.ts；routes/remote-host-page.tsx |
| supervisor_control | ◐ 协议、Host 本地表 `host_supervisor_control` 和 `POST /api/v1/supervisor/control/approve` 存在，`conversation.create / conversation.turn.start` 已按 control 门控；**没有任何 UI 调用批准接口，控制面不签发 control**，因此出厂流程中不可达。 | apps/host supervisor 路由 |
| 访问申请 | ✅ 申请方：申请、取消、重新申请；状态 authorized/pending/denied/cancelled/expired/none。主机方：PendingAccessRequestPanel，允许/拒绝，显示设备指纹与“读取工作区 · 过期时间”，每 30 秒轮询。✕ 没有撤销已授权设备的界面，✕ 没有新申请通知。 | host-directory-page.tsx |
| 其他主机在线状态 | 通过一次实际连接判断：检查中 / 在线 / 无法连接。本机主机点击进入 `/machines`，其他主机进入 `/hosts/$hostId`。 | host-directory-page.tsx |
| Node 配对 | ✅ `codetether-node --pair`、`codetether-pairing://relay/v1`、6 位配对码。入口为 `/machines` 的“添加远程电脑”弹窗。**只属于 Node 流程**，与账号无关。 | add-remote-machine-dialog.tsx；apps/node |
| 全局会话列表与搜索 | **不存在**。列表和搜索都按项目：`GET /api/v1/projects/:id/conversations`、项目内搜索；`/conversations` 重定向 `/projects`。AGENTS.md 把跨项目/全局搜索列为范围外。 | router.tsx；conversation-list-query.ts；conversation-search-query.ts |
| 远程执行 | Node 配对的 Machine：✅ 远程 Codex；◐ 远程 Claude Code（仅读取、搜索类工具）。其他主机（supervisor_read）：✕ 不能发送。 | remote-machine-coordinator.ts；remote-claude-host-runtime.ts |
| 远程中断 | ✕ Node 远程 Codex/Claude 均不支持；supervisor 协议没有中断操作。本地仅 Codex 支持（`capabilities.interrupt`）。 | remote-codex-host-runtime.ts；claude-code-host-runtime.ts |
| 远程审批 | ✕ Node 远程运行时 `subscribeApprovals` 为空实现；supervisor 协议没有审批操作。 | remote-codex-host-runtime.ts |
| 运行中输入 | ✕ 没有排队（queue）或补充指令（steer）能力；Provider descriptor 无对应字段，AGENTS.md 列为范围外。运行中 Composer 禁用并提示“智能体正在运行”。 | conversation-controls.ts；AGENTS.md |
| 开机自启 / 语言 | ✕ 无开机自启；无 i18n（界面中文，My Hosts 区域英文）。托盘与“关闭后后台运行”提示已实现但没有开关。 | desktop tauri |
| 主题 | 仅深色，启动时写死 `dataset.theme = 'dark'`。v2 提议默认浅色、可切换深色/跟随系统，属于**新增前端范围**（见 02 §0、D11）。 | apps/web/src/main.tsx:15；packages/ui/README.md:7 |
| 只读历史 | 导入的本机会话（`origin=adopted_native`）的原生 transcript 只读，但仍可继续对话。 | native-transcript.ts:72 |
| 界面语言 | 仅简体中文，无 i18n。新设计保持中文；产品名词 Codex / Claude Code / Relay / Node 保留英文。 | — |
| 取消配对 | 电脑上还有项目文件夹时不能取消配对（`machine_has_project_locations`），需要先移除这些文件夹。 | unpair-machine-dialog.tsx；project-actions.ts:348 |
| 移除项目 | 只取消登记，不删除文件。项目还有任何会话（**包括已归档**）时 Host 拒绝（`has_conversations`）。 | project-registry.ts:595-610；conversation-store.ts:2599 |
| 移除文件夹（项目位置） | 只有配对电脑上的文件夹显示“移除”；本机文件夹、项目的最后一个文件夹不能移除（`local_required`）；该电脑上还有这个项目的会话时拒绝（`has_conversations`）。 | conversation-store.ts:2324-2361；project-locations-section.tsx:208 |
| 移除失败的提示时机 | 基线在用户点确认、提交后才显示错误（如“此项目仍有关联会话，当前不能移除。”）。v2 在打开弹窗时就预先说明不能移除的原因（依赖会话计数，见 02 §6 D1/D3）。 | host-service.ts:10000-10041；project-actions.ts:305 |
| 删除会话 | ✕ 不存在。本地 HTTP 服务没有删除会话的路由，只有归档。因此仍有会话的项目和文件夹无法移除。v2 列入后续规划。 | local-http-server.ts |

## 功能清单

| # | 功能 | 当前入口 | 用户目的 | 主要操作 | 数据来源 | 权限/条件 | 源码 | 状态 | 新设计去向 | 原型 Frame |
|---|---|---|---|---|---|---|---|---|---|---|
| F01 | 启动门 | `/` StartupGate | 打开应用 | 自动重试 5 次；“重新检查” | `getOnboarding` | Host 已连接 | onboarding/startup-gate.tsx:18；startup-gate-recovery.ts:8 | ✅ | 保留；完成后进入 **首页** `/home`（原为 `/inbox`，见 02 §6 D6） | — |
| F02 | 首次设置 7 步 | `/setup` | 检查本机、AI 工具、选项目、导入、远程 | welcome→computer_check→provider_check→project_setup→previous_conversations→remote_setup→ready | onboarding-query.ts（CAS revision） | — | onboarding-page.tsx:73-1032 | ✅ | **首次启动** 6 屏（欢迎 / AI 工具 / 项目 / 以前的会话 / 其他电脑 / 完成）；computer_check 与 provider_check 合并展示，状态机仍用基线 7 步 | 02-37…02-42 |
| F03 | 设置恢复态 | `/setup` | 出错恢复 | 重新选择项目、重试 | — | — | onboarding-page.tsx:1232-1323 | ✅ | 首次启动错误态，沿用 notice err 样式（原型未单独出图） | 03-03、03-06 样式 |
| F04 | Provider 安装/登录指引 | 设置·AI 工具卡 | 安装或登录 CLI | 打开官方说明 | native providerGuidance | Desktop | provider-guidance-link.tsx | ✅ | 首次启动·AI 工具的“查看登录说明”。**缺口**：电脑详情 AI 工具卡未画指引链接，实现保留 provider-guidance-link | 02-38, 02-18, 02-19 |
| F05 | 检查状态 (Doctor) | 顶栏“检查状态”、`/doctor` | 诊断 | 重新检查、打开设置、重新运行设置 | doctor-query.ts | — | doctor/doctor-page.tsx:184-760 | ✅ | **设置 › 关于与检查**；顶栏按钮移除，诊断代码折叠 | 02-36 |
| F06 | 侧栏主导航 | Sidebar：收件箱、电脑 | 导航 | — | — | — | workspace-sidebar.tsx:138 | ✅ | 主导航 **首页 / 待处理 / 我的电脑 / 项目** + “最近”会话 + 侧栏底部账号与设置；手机为 4 个底部标签（首页 / 待处理 / 电脑 / 设置） | 全部 |
| F07 | 侧栏项目树 + 最近 4 会话 | Sidebar | 快速进入 | 展开、新建、显示全部 | project-query, conversation-list-query | — | workspace-sidebar.tsx:157-437 | ✅ | 项目树移到 **项目** 页；侧栏“最近”显示跨项目最近 8 条（依赖 D1），“全部”进入 `/sessions` | 02-15, 02-01 |
| F08 | 侧栏折叠/拖宽 | 顶栏切换、拖拽 | 空间 | localStorage 持久 | — | — | workspace-sidebar-layout.ts | ✅ | **缺口**：原型侧栏固定宽，≤1180 只收窄到 224px，没有画折叠/拖宽；实现保留现有能力，Figma 需补 | 03-15 |
| F09 | 面包屑 | 顶栏 | 定位 | — | 各 detail query | — | root-layout.tsx:212 | ✅ | 移入**标题栏可拖动区**；会话详情另有**上下文条**（电脑 / 项目 / AI 工具） | 02-08, 04-06 |
| F10 | 顶栏 ⌘K / 通知 / 头像 | 顶栏 props | — | — | — | 未接线 | top-bar.tsx:152 | ✕ | Ctrl K（mac ⌘K）**命令面板**：按标题找会话、跳到电脑或项目、常用操作（新建会话 / 添加电脑 / 切换主题），底部链接到项目内搜索；头像移到侧栏底部；通知并入“待处理” | 02-06 |
| F11 | 项目会话列表 | `/projects/$id/conversations` | 浏览 | 按 Provider 分组 | listProjectConversations | — | conversations-page.tsx:84 | ✅ | 并入 **项目详情 › 会话**；跨项目的 **全部会话** `/sessions` 依赖聚合接口（D1） | 02-16, 02-03 |
| F12 | 会话状态/Agent 筛选 | 筛选菜单 | 缩小范围 | 全部/运行中/需要处理/已完成；Provider | client-side | — | conversation-list-model.ts:6-91 | ✅ | 全部会话：状态分段（全部 / 运行中 / 待查看 / 已完成 / 失败）+ AI 工具、电脑下拉（电脑按“我的电脑 / 其他主机”分组）+ 标题筛选 | 02-03 |
| F13 | 会话搜索（标题+用户输入） | 搜索框 `?q=` | 找回会话 | 分页 25 条，跳转 Turn | searchProjectConversations | 项目内 | conversation-search-query.ts:47 | ✅（项目内） | **搜索** 页：关键词 + 项目选择，结果上方写明范围和不搜索的内容；同一会话标题和消息都命中时合并为一行；沿用每页 25 条，还有下一页时才显示“加载更多”；全局搜索需聚合接口（D2） | 02-05 |
| F14 | Pin / Unpin | 行菜单 | 常用置顶 | — | `/pin` `/unpin` | 非忙碌 | conversation-organization-controls.tsx:157 | ✅ | 会话行悬停“置顶” + 会话设置弹窗开关 | 02-14 |
| F15 | 重命名 | 行菜单 | — | — | renameConversation | — | controls.tsx:174 | ✅ | **会话设置**弹窗（名称 / 置顶 / 归档） | 02-14 |
| F16 | 归档 / 恢复 | 行菜单、`view=archived` | 清理列表 | 确认、恢复 | `/archive` `/unarchive` | 运行中不可归档 | controls.tsx:180-297 | ✅ | 会话设置弹窗开关（运行中禁用并说明）；**全部会话 › 已归档** 分段找回 | 02-04, 02-14 |
| F17 | 新建会话 | 侧栏按钮、项目“+” | 开始工作 | 选项目、设备、Agent、模型、推理 | createConversation；machine-query | 设备 available + projectAccess + providerExecution + 有项目位置 | new-conversation-dialog.tsx:80-205；new-conversation-provider-selection.ts | ✅ | 侧栏“新建会话”（Ctrl N）、项目详情与电脑详情（预选）；顺序 **电脑 → 项目 → AI 工具** | 02-07, 04-11 |
| F18 | 会话详情头部/状态 | `/conversations/$id` | 阅读 | — | getConversation + SSE | — | conversation-header.tsx | ✅ | 标题 + 状态 + **上下文条**（电脑·连接 / 项目 / AI 工具） | 02-08 |
| F19 | 时间线、工具分组、Markdown、Diff/Shell 卡片 | 会话详情 | 理解 Agent 行为 | 展开 | detail + events | — | conversation-timeline.tsx；tool-grouping.ts | ✅ | 保留；阅读区最大宽 740 | 02-08 |
| F20 | 审批坞 | 会话详情底部 | 批准风险操作 | 允许一次 / 拒绝 | `/approvals/:id/resolve` | connected && supportsApprovals（仅本地 Codex） | pending-action-dock.tsx | ✅（本地 Codex） | 时间线内联审批卡，仅本地 Codex；远程会话不显示 | 02-08 |
| F21 | Composer 发送 | 会话详情 | 继续对话 | 发送、模型、推理/思考强度 | startTurn | canCompose 门控 | composer.tsx；conversation-controls.ts:164 | ✅ | 能发送时才显示输入框；运行中、远程只读、离线时替换为**说明条 + 下一步**，不显示可用发送框 | 02-08, 02-11, 02-13 |
| F22 | 中断 | 顶栏 chrome | 停止 | — | `/interrupt` | 仅本地 Codex | conversation-chrome-actions.tsx | ◐ | 运行状态条中的“停止”，仅本地 Codex；其他情况说明不能停止，不放按钮 | 02-11 |
| F23 | Inspector：文件/变更/工具输出 | 顶栏切换 | 查看改动 | 拖宽 | detail | supportsDiff / supportsToolOutput | inspector-panel.tsx:420 | ✅ | 右侧面板（文件 / 变更 / 输出）；Claude Code 只有“文件”并说明原因；≤1000 变为浮层 | 02-09, 02-10, 02-12, 04-02 |
| F24 | 会话 Rail（同项目） | 会话详情左栏 | 切换 | 筛选、搜索、新建 | conversation-list-query | 同项目 | conversation-rail.tsx | ✅ | 移除，由侧栏“最近”和 Ctrl K 取代 | — |
| F25 | 失败卡 + 重试 | 时间线 | 恢复 | 重试（新 Turn）、跳转设备/项目、技术详情 | canonical failure | 部分原因不提供重试 | conversation-failure-card.tsx | ✅ | 保留，文案说明下一步 | 03-10 |
| F26 | 导入会话原生历史 | 会话详情 | 阅读旧历史 | 加载更早 | native-transcript | origin=adopted_native | conversation-detail-route.tsx:222 | ✅ | 上下文条标签“已导入的本机会话” | 03-11 |
| F27 | 演示会话 adapter | 非法 ID | 开发演示 | — | mocks | — | demo-conversation-adapter.ts | ✅（开发用） | 保留并标注“演示数据” | — |
| F28 | Inbox 列表/汇总/筛选 | `/inbox` | 处理事项 | 全部/审批/完成/失败 | attention-query | connected | inbox-page.tsx；inbox-summary.tsx | ✅ | **待处理**：分段带计数，替代汇总卡；首页“需要你处理”显示前几条 | 02-02, 03-04, 02-01 |
| F29 | Inbox 审批 | 审批项 | 决定 | 允许一次 / 拒绝 | resolve approval | Provider 支持审批 | inbox-item.tsx:148 | ✅ | 保留；不支持审批时显示说明而非按钮 | 02-02 |
| F30 | Inbox 完成待查看 / 失败 | 项 | 查看 | 查看结果 / 打开会话 / 知道了 | resolve attention | — | inbox-actions.ts:34-52 | ✅ | 保留，跳转到对应会话 | 02-02 |
| F31 | 已读/未读、稍后提醒 | — | — | — | — | — | — | ✕ | 不设计已读态（处理即移出）；列入后续规划 | 05-01 |
| F32 | 系统通知 | Desktop | 后台提醒 | 点击打开会话 | attention-notification-coordinator.ts；attention_notifications.rs | Desktop、窗口不在对应页 | desktop-notification-model.ts:109 | ✅ | 不变；设置 › 通知（说明通知不含会话标题） | 02-34 |
| F33 | 通知偏好 ×3 | `/settings` | 控制提醒 | 需要批准 / 工作完成 / 执行失败 | notification-preferences.ts | Desktop | desktop-notification-settings.tsx:128 | ✅ | **设置 › 通知**，3 个开关 | 02-34 |
| F34 | 后台运行说明 | `/settings` | 理解关闭行为 | 无开关 | backgroundRuntime.available | Desktop | desktop-notification-settings.tsx:115 | ◐（仅说明） | **设置 › 后台运行**，只写状态不给开关，文案对齐托盘真实行为 | 02-35 |
| F35 | 托盘 | 系统托盘 | 恢复/退出 | “打开 CodeTether”、“退出 CodeTether” | — | Desktop | system_tray.rs:38-59 | ✅ | 不变；设置 › 后台运行中说明 | 02-35 |
| F36 | 关闭到托盘 + 首次提示 | 窗口 ✕ / Alt+F4 | 后台继续 | — | — | — | host_supervisor.rs:1326；system_tray.rs:100 | ✅ | 不变 | — |
| F37 | 单实例 | 再次打开 | 恢复窗口 | — | — | — | host_supervisor.rs:1221 | ✅ | 不变 | — |
| F38 | 原生标题栏 | 窗口 | — | — | — | decorations:true，1440×900，最小 1100×700 | tauri.conf.json | ✅ | 设计提供**自定义标题栏**方案（mac 红绿灯 / Win 窗口控制、可拖动区），实现需改 decorations（02 §6 D5，可选） | 全部 |
| F39 | 开机启动 / Deep link | — | — | — | — | — | — | ✕ | 后续规划；设置 › 后台运行只放“查看后续规划”链接，不放开关 | 05-01, 02-35 |
| F40 | 设备列表 | `/machines`（“电脑”） | 找到电脑 | 打开详情、添加 | listMachines | connected | machines-page.tsx:31-261 | ✅ | **我的电脑**：卡片显示系统、本机/已配对/其他主机、连接状态、运行中数、会话数、AI 工具（计数依赖 D3/D7） | 02-17, 04-08 |
| F41 | 本机详情 | `/machines/$id` | 查看本机 | Provider、项目、会话 | getMachine | — | machine-detail-page.tsx:269-467 | ✅ | **电脑详情**：左侧会话列表，右侧 AI 工具 / 项目文件夹 / 连接三张卡 | 02-18, 02-19 |
| F42 | 远程设备详情 | 同上 | 查看远程 | 重试连接、刷新 Provider | getMachine | remote | machine-detail-page.tsx:545-1313 | ✅ | 同上；离线时顶部 notice + 上次在线时间（D4）；项目列表读取失败单独提示 | 03-05, 03-06 |
| F43 | 添加远程电脑（配对） | 设备页“添加” | 连接另一台电脑 | 地址或 `codetether-pairing://` + 6 位码 → 核对验证码 → 完成 | begin/confirm/cancelRemoteMachinePairing | 单次一个信任变更 | add-remote-machine-dialog.tsx:50-506 | ✅ | **添加电脑** `/add` 选类型 → **CodeTether Node** `/add/node` 4 步（准备 → 输入 → 核对 → 完成） | 02-23, 02-25…02-28 |
| F44 | Relay 辅助首次配对 | Node 输出链接 | 跨网络配对 | — | relay rendezvous | 自动化测试，未宣称生产验证 | PHASE8D-RELAY-ASSISTED-FIRST-PAIRING.md | ◐ | 第 2 步输入框同时接受地址和配对链接，帮助文字说明 | 02-26 |
| F45 | 更新连接地址 | 设备详情 | 地址变化恢复 | 验证并保存 | updateMachineConnectionAddress | remote；recovery_required 提示 | update-machine-address-dialog.tsx | ✅ | 连接卡“更新地址”弹窗；离线 notice 也给入口 | 02-19, 03-05 |
| F46 | 取消配对 | 设备详情 | 撤销信任 | 确认 | unpairMachine | 无项目位置时 | unpair-machine-dialog.tsx | ✅ | 连接卡“取消配对”；还有项目文件夹时弹窗列出这些项目、不给确认按钮（与基线一致） | 02-20 |
| F47 | Internet Relay 配置/enroll/重试/断开/移除 | 设备详情 Relay 区 | 跨网络 | 配置、一次性令牌、重试、移除 | relay-actions.ts:111-152 | remote | machine-relay-section.tsx | ✅ | 连接卡只显示连接方式、地址、上次在线、权限。**缺口**：Relay 配置、一次性令牌、重试、移除没有画，实现保留并归入连接卡“高级” | 02-19 |
| F48 | Provider 安装选择 | 设备详情 | 选 CLI 安装 | 选择 | selectMachineProviderInstallation | — | provider-installation-selector.tsx | ✅ | **缺口**：电脑详情 AI 工具卡没有画安装选择，实现保留 provider-installation-selector | 02-18 |
| F49 | 安装 vs 执行健康 | 设备详情 | 判断可用 | — | providerDiscovery / executionHealth | current / last_known | machine-detail-page.tsx | ✅ | AI 工具行显示运行状况（正常 / 最近有异常 / 尚未运行过）和“上次已知”说明。**缺口**：安装状态没有单独表达，Figma 需补 | 02-18 |
| F50 | 项目列表 | `/projects` | 浏览项目 | — | listProjects | — | projects-page.tsx | ✅ | **项目**：你的项目（卡片列出各电脑上的文件夹）+ 其他主机的项目（仅查看） | 02-15 |
| F51 | 项目详情 + 位置 | `/projects/$id` | 管理 | 查看位置、可用性 | getProject | — | project-detail-page.tsx；project-locations-section.tsx | ✅ | 左侧会话，右侧“文件夹”卡：电脑 + 可用性 + 截断路径（title + 复制） | 02-16 |
| F52 | 添加项目（本机） | 项目页 | 登记文件夹 | 原生选择器 / 手输路径、名称 | createProject | Desktop 选择器 | add-project-dialog.tsx | ✅ | “添加项目文件夹”弹窗：选电脑 → 文件夹 → 新项目或已有项目 | 弹窗（未出图） |
| F53 | 添加远程位置 | 项目详情 | 远程登记 | 选设备 + 路径 | registerProjectLocation / createRemoteProject | remote 已配对 | add-project-location-dialog.tsx | ✅ | 同一个弹窗，入口在项目页、项目详情文件夹卡、电脑详情项目文件夹卡 | 弹窗（未出图） |
| F54 | 移除项目 / 移除位置 | 项目详情 | 清理 | 确认 | deleteProject / removeProjectLocation | 项目无会话（含已归档）；文件夹限配对电脑、非最后一个、无会话 | remove-project-*-dialog.tsx | ✅ | 项目详情“移除项目”卡 + 确认弹窗；配对电脑的文件夹行“移除” + 确认弹窗。仍有会话（含已归档）时弹窗预先说明不能移除，只给“知道了”（基线提交后才报错）。删除会话列入后续规划 | 02-16 |
| F55 | 导入以前的会话 | 添加项目后、设置步骤 | 继续旧会话 | 多选导入 | discover/adoptProviderSession | resumeStatus=supported | previous-conversations-step.tsx | ✅ | 首次启动“继续以前的会话”；添加项目后的入口保留 | 02-40 |
| F56 | 远程 Linux Node | CLI `codetether-node` | 让服务器可被连接 | `--pair`、`service install` 等 | — | 本地操作 | apps/node/src/main.ts；service-installation.ts | ✅（无 UI） | 添加 Node 第 1 步给出命令 | 02-25 |
| F57 | Node 控制端恢复 | Node 本地 CLI | 凭据丢失 | `--controller` | — | 本地交互 | local-controller-recovery.ts | ✅（无 UI） | 交接说明，产品内不提供 | — |
| F58 | `/activity` 活动 | 路由占位 | — | — | — | — | router.tsx:92 | ✕ | 不进主导航；路由重定向，列入后续规划 | — |
| F59 | `/agents` 智能体 | 路由占位 | — | — | — | — | router.tsx:125 | ✕ | 能力并入电脑详情 › AI 工具卡；路由移除或重定向 | — |
| F60 | 组件 Showcase | 开发 | 视觉检查 | — | — | — | showcase/component-showcase.tsx | ✅ | 更新为新组件（浅色 + 深色） | components.css；00-overview |
| F61 | 主题 / 语言 | — | — | — | — | — | apps/web/src/main.tsx:15 `dataset.theme = 'dark'` | ✕（仅深色、仅中文） | **设置 › 外观**：浅色 / 深色 / 跟随系统（新增范围，D11）；语言只说明“简体中文”，不给切换 | 02-31, 06-07 |
| F62 | 账号登录（邮箱登录码） | `/hosts` 页内（英文） | 发现其他主机 | 发送登录码、验证、退出 | Supabase OTP | 需配置账号服务 | host-directory-page.tsx | ✅ | **设置 › 账号与共享** + 登录页 `/signin`（中文）；我的电脑页未登录时给出登录入口 | 02-29, 02-30, 02-32, 03-13, 04-10 |
| F63 | 本机作为主机 | `/hosts` Host capability 卡 | 允许其他电脑只读查看本机 | 启用、完成设置 | local host lifecycle | 已登录 | host-directory-page.tsx | ✅（平台文字硬编码 macOS） | 账号与共享 › “这台电脑”；按实际平台显示（D9） | 02-32, 02-33, 03-14 |
| F64 | 其他主机列表 | `/hosts` My Hosts | 找到同账号下的电脑 | 打开、申请、取消、重新申请、重试 | listAuthorizedHosts / listOwnedHosts | 已登录 | host-directory-page.tsx | ✅ | **我的电脑**中的其他主机卡片（访问、连接分开表达）；“添加电脑 › Mac 或 Windows 电脑”说明流程 | 02-17, 02-22, 02-24, 03-07, 03-08, 03-09 |
| F65 | 其他主机只读查看 | `/hosts/$hostId` | 查看 Machine、项目、会话和运行中输出 | 浏览、实时查看 | remote-supervisor（supervisor_read） | access=authorized 且在线 | remote-host-page.tsx | ✅ | **主机详情** `/computers/:hostId` + **远程只读会话**；没有输入框，底部只读说明 | 02-21, 02-13, 03-12, 04-07, 04-09 |
| F66 | 访问申请处理（主机方） | `/hosts` PendingAccessRequestPanel | 批准或拒绝 | 允许、拒绝 | control-plane，30 秒轮询 | 本机已作为主机 | host-directory-page.tsx | ✅（无撤销、无通知） | 设置 › 账号与共享的申请行（拒绝 / 允许）；我的电脑页顶部同时提示 | 02-32, 02-17 |
| F67 | supervisor_control（远程发送/新建） | 无 UI | — | — | `/api/v1/supervisor/control/approve` | 控制面不签发 | apps/host | ◐ 后端存在、出厂不可达 | 后续规划 | 05-01 |
| F68 | 撤销已授权设备 / 访问申请通知 | — | — | — | — | — | — | ✕ | 后续规划；设置中写明“已批准的设备暂时不能在这里撤销” | 05-01, 02-32 |

## 旧入口 → 新入口

| 旧入口 | 新入口 | 说明 |
|---|---|---|
| `/` → `/inbox` | `/` → **首页** `/home` | 首页汇总：需要你处理、正在运行、最近会话 |
| 侧栏“收件箱” | 主导航 **待处理** `/inbox` | 带计数 |
| 侧栏“电脑” | 主导航 **我的电脑** `/computers` | 本机、配对电脑和其他主机在同一页 |
| 侧栏项目树 | 主导航 **项目** + 侧栏 **最近** | 主导航不再随项目数增长 |
| `/projects/$id/conversations` | 项目详情 › 会话；**全部会话** `/sessions` | 旧 URL 保留为重定向 |
| `?view=archived` | `/sessions?view=archived`（全部会话 › 已归档） | |
| 顶栏“检查状态” | 设置 › 关于与检查 | |
| `/settings`（常规/通知） | 设置：外观 / 账号与共享 / 通知 / 后台运行 / 关于与检查 | 后续规划单独一页 `/roadmap` |
| 添加远程电脑弹窗 | **添加电脑** `/add`（选类型）→ **CodeTether Node** `/add/node` 4 步 | Node 命令、地址、6 位码只出现在 Node 流程 |
| `/hosts`（My Hosts，英文） | **我的电脑**（其他主机卡片）+ **设置 › 账号与共享** + 登录页 `/signin` | 登录、共享这台电脑、申请访问分开表达 |
| `/hosts/$hostId` | 主机详情 `/computers/:hostId` | 旧 URL 保留为重定向 |
| `/machines`、`/machines/$id` | `/computers`、`/computers/:id` | 旧 URL 保留为重定向 |
| Machine 详情 Relay 区 | 电脑详情 › 连接卡（高级项见 F47 缺口） | |
| `/agents`、`/activity` | 无（后续规划 / 重定向） | |
| `/conversations/$id` | 会话详情（原型 `#/c/:id`） | 保留 URL |

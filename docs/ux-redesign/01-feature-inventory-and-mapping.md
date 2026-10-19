# 01 · 页面与功能清单 / 新旧映射（v4）

依据：已验收产品基线 **`bbcda690a081`**（Mac、Windows 均为此版本）的 `apps/web/src`（路由、组件、runtime/host、runtime/account）、`packages/protocol`、`apps/host`、`apps/desktop/src-tauri`、`apps/node`。
状态：✅ 已实现 · ◐ 部分实现 · ✕ 尚未实现。
“原型 Frame” 列对应 `png/` 编号（`prototype/` 中的同名页面）；Figma 写入后 Frame 名称与 PNG 名相同（见 02 文档 §7）。标“缺口”的条目是原型没有画、但实现必须保留的现有能力。

v4 的核心：**账号 › 设备 › 项目 › 会话**。登录后看到自己的设备（这台电脑 + 用 CodeTether Node 配对的设备），每台设备下是它自己的项目；一个项目就是一台设备上的一个文件夹（一个 ProjectLocation），Host 用它作为 AI 工具的工作目录。添加项目时自动找出这个文件夹里以前的 Codex / Claude Code 会话。没有只读设备。

## 关键事实（影响设计的结论）

| 主题 | 代码中的真实情况 | 源码 |
|---|---|---|
| 会话归属 | ProjectRecord → ProjectLocation `{projectId, machineId, rootPath, availability}`，一个项目在每台设备上最多一个位置，没有单独的 locationId。按项目新建会话只传 `projectId + machineId`，Host 取该位置的 `rootPath` 作为 cwd。数据层允许一个项目有多台设备上的位置；v4 界面每个项目只用一个，老的多位置项目见 02 §0。 | host-service.ts:5917-5933；protocol commands.ts:44-53 |
| 设备 | 本机 Host 下的 Machine：1 个 `local`（这台电脑）+ 经 Node 配对的 `remote`（最多 64）。两种都完整访问：浏览、新建、发送。 | protocol machines.ts |
| Node 平台 | Node 配对支持 Linux x64 / arm64 和 macOS arm64，**没有 Windows**。Windows 电脑只能作为“这台电脑”。 | apps/node 发布目标 |
| 基线前端的组织方式 | 侧栏是“项目 › 会话”：每个项目最近 4 条，一次只展开一个项目，置顶不优先，会话行不显示设备。项目详情页不列会话；会话列表在 `/projects/$id/conversations`，按 Agent 分组。启动后进入英文的 `/hosts`（My Hosts）。 | workspace-sidebar-model.ts:7；workspace-sidebar.tsx；startup-gate.tsx:59；conversations-page.tsx |
| 会话列表与搜索 | 只有按项目的接口：`GET /api/v1/projects/:id/conversations`（`provider / status / archived` 筛选，`limit ≤ 100`，没有游标）；项目内搜索（标题 + 你发送过的内容，关键词 ≤ 160 字，有游标）。**没有**跨项目列表或全局搜索。`GET /snapshot` 只含 Host 内存里的会话，不能当全量列表；`GET /machines/:id` 只带这台设备最近 100 个。 | router.tsx；conversation-list-query.ts；conversation-search-query.ts；host-service.ts:1889-1907、5025-5039 |
| 新建会话 | `CreateConversationByProjectRequest {actionId, machineId, provider, projectId, model?, reasoning?}`，不带第一条消息。Codex 的 descriptor 没有 `models` / `reasoningOptions`；Claude Code 有推理强度 low / medium / high / xhigh / max，没有模型列表。模型和推理强度只能在新建时选。 | protocol providers.ts:113-125；claude-code-host-runtime.ts:81；host-service.ts:9560-9631 |
| 以前的会话 | `GET/POST /api/v1/projects/:pid/locations/:mid/provider-sessions`：按项目位置扫描并导入 Codex / Claude Code 的原生会话。返回 `candidates`（`resumeStatus`、`alreadyAdopted`）、每个 AI 工具的 `status / failureReason`（如 `machine_offline`、`provider_session_discovery_unavailable`、`store_unreadable`、`format_unsupported`）和 `nextCursor`；支持 `rescan`。导入返回 `adopted / already_adopted`，候选过期返回 409 `provider_session_candidate_expired`。**这台电脑和配对设备都支持**：配对设备由 Node 扫描。Codex 按 `thread.cwd` 与项目路径完全相等匹配；Claude 按规范化项目路径的摘要匹配。 | local-http-server.ts:415；host-service.ts:2629、2657；apps/node/src/provider-session-discovery.ts；previous-conversations-step.tsx |
| 待处理 | `GET /attention`：approval / completed_review / failed，处理即移出。 | attention-query |
| 账号登录 | ✅ Supabase 邮箱一次性登录码（`shouldCreateUser:false`，只能登录已有账号）。入口只在 `/hosts`（My Hosts）页，文案为英文。未配置账号服务时构建失败。 | runtime/account/control-plane-client.ts；routes/host-directory-page.tsx |
| 同一账号的其他 Host（v4 不使用） | 基线 `/hosts` 能发现同一账号下其他电脑上的 Desktop Host，申请后获得 `supervisor_read`（只读查看）。`supervisor_control` 有协议、Host 表和 `POST /api/v1/supervisor/control/approve`，但控制面不签发、没有 UI 调用，出厂不可达。访问申请没有撤销和通知。v4 不做只读设备，所以这些都不在新导航里，“同一账号下的 Mac 和 Windows 作为设备”列入后续规划。 | host-directory-page.tsx；remote-supervisor.ts；apps/host supervisor 路由 |
| Node 配对 | ✅ `codetether-node --pair`、`codetether-pairing://relay/v1`、6 位配对码。与账号无关。 | add-remote-machine-dialog.tsx；apps/node |
| 远程执行 | 配对设备：✅ 远程 Codex；◐ 远程 Claude Code。Claude Code（本机和远程）都以 `--tools Read,Glob,Grep --permission-mode dontAsk` 运行，只读取和搜索文件。 | remote-machine-coordinator.ts；remote-claude-host-runtime.ts；claude-code-host-runtime.ts |
| 中断 / 审批 / 变更 | 只有这台电脑上的 Codex 支持中断（`capabilities.interrupt`）、审批和报告变更（Diff）。Node 远程运行时 `subscribeApprovals` 为空实现，Claude adapter 也都报告不支持。 | remote-codex-host-runtime.ts；claude-code-host-runtime.ts |
| 运行中输入 | ✕ 没有排队或补充指令。运行中再发送 Host 返回 409 `conversation_busy`；基线 Composer 运行中禁用，中断按钮只在顶栏。 | conversation-controls.ts；composer.tsx；AGENTS.md |
| 开机自启 / 语言 | ✕ 无开机自启；无 i18n（界面中文，My Hosts 区域英文）。托盘与“关闭后后台运行”已实现但没有开关。 | desktop tauri |
| 主题 | 仅深色，启动时写死 `dataset.theme = 'dark'`。设计提议默认浅色、可切换深色 / 跟随系统，属于**新增前端范围**（见 02 §0、D10）。 | apps/web/src/main.tsx:15；packages/ui/README.md:7 |
| 导入会话的历史 | 导入的会话（`origin=adopted_native`）的原生 transcript 只读，但仍可继续对话。 | native-transcript.ts:72 |
| 取消配对 | 设备上还有项目时不能取消配对（`machine_has_project_locations`），需要先移除这些项目。 | unpair-machine-dialog.tsx；project-actions.ts:348 |
| 移除项目 | 只取消登记，不删除文件。项目还有任何会话（**包括已归档**）时 Host 拒绝（`has_conversations`）。v4 在打开弹窗时就预先说明（用项目会话列表计数，见 02 §5、D1/D3）。 | project-registry.ts:595-610；conversation-store.ts:2599；host-service.ts:10000-10041 |
| 删除会话 | ✕ 不存在，只有归档。因此仍有会话的项目无法移除。列入后续规划。 | local-http-server.ts |

## 功能清单

| # | 功能 | 当前入口 | 用户目的 | 主要操作 | 数据来源 | 权限/条件 | 源码 | 状态 | 新设计去向 | 原型 Frame |
|---|---|---|---|---|---|---|---|---|---|---|
| F01 | 启动门 | `/` StartupGate | 打开应用 | 自动重试 5 次；“重新检查” | `getOnboarding` | Host 已连接 | onboarding/startup-gate.tsx:18；startup-gate-recovery.ts:8 | ✅ | 保留；完成后基线进入英文 `/hosts`（startup-gate.tsx:59），v4 改为进入 **设备** `/devices`（02 §6 D6） | — |
| F02 | 首次设置 7 步 | `/setup` | 检查本机、AI 工具、选项目、导入、远程 | welcome→computer_check→provider_check→project_setup→previous_conversations→remote_setup→ready | onboarding-query.ts（CAS revision） | — | onboarding-page.tsx:73-1032 | ✅ | **首次启动** 6 屏（欢迎 / AI 工具 / 项目 / 以前的会话 / 其他设备 / 完成）；“其他设备”只介绍 Node 配对并说明 Windows 暂不能配对；完成页展示 设备 › 项目 › 会话；状态机仍用基线 7 步 | 02-35…02-40 |
| F03 | 设置恢复态 | `/setup` | 出错恢复 | 重新选择项目、重试 | — | — | onboarding-page.tsx:1232-1323 | ✅ | 首次启动错误态，沿用 notice err 样式（原型未单独出图） | 03-04 样式 |
| F04 | Provider 安装/登录指引 | 设置·AI 工具卡 | 安装或登录 CLI | 打开官方说明 | native providerGuidance | Desktop | provider-guidance-link.tsx | ✅ | 首次启动·AI 工具的“查看登录说明”。**缺口**：设备详情 AI 工具卡未画指引链接，实现保留 provider-guidance-link | 02-36, 02-02, 02-03 |
| F05 | 检查状态 (Doctor) | 顶栏“检查状态”、`/doctor` | 诊断 | 重新检查、打开设置、重新运行设置 | doctor-query.ts | — | doctor/doctor-page.tsx:184-760 | ✅ | **设置 › 关于与检查**；顶栏按钮移除 | 02-34 |
| F06 | 侧栏主导航 | Sidebar：My Hosts、收件箱、电脑、项目树 | 导航 | — | — | — | workspace-sidebar.tsx:138-167 | ✅ | 主导航 **待处理**（带计数）/ **设备**（“＋”添加设备），下面是设备树，底部账号与设置；去掉 My Hosts；手机为 3 个底部标签（设备 / 待处理 / 设置） | 全部 |
| F07 | 侧栏项目树 + 最近 4 会话 | Sidebar | 快速进入 | 展开、新建、显示全部 | project-query, conversation-list-query | — | workspace-sidebar.tsx:157-437；workspace-sidebar-model.ts:7 | ✅ | 改为 **设备 › 项目 › 会话**：这台电脑排第一，可以同时展开多个；每个项目默认 4 个会话（置顶在前，当前会话总是可见），“显示全部 N 个”；只有运行中 / 等待批准 / 失败显示状态点；设备行“＋”添加项目，项目行“＋”新建会话 | 02-01, 02-04, 02-15 |
| F08 | 侧栏折叠/拖宽 | 顶栏切换、拖拽 | 空间 | localStorage 持久 | — | — | workspace-sidebar-layout.ts | ✅ | **缺口**：原型侧栏固定宽，≤1180 只收窄到 224px，没有画折叠/拖宽；实现保留现有能力，Figma 需补 | 03-16…03-18 |
| F09 | 面包屑 | 顶栏 | 定位 | — | 各 detail query | — | root-layout.tsx:212 | ✅ | 移入**标题栏可拖动区**：设备 › 项目 › 会话标题；会话详情另有**上下文条**：设备 › 项目（悬停看路径）· AI 工具 | 02-15, 04-08 |
| F10 | 顶栏 ⌘K / 通知 / 头像 | 顶栏 props | — | — | — | 未接线 | top-bar.tsx:152 | ✕ | Ctrl K（mac ⌘K）**命令面板**：按标题找已读取的会话、跳到设备或项目、常用操作（新建会话 / 添加项目 / 添加设备 / 切换主题）；头像移到侧栏底部；通知并入“待处理” | 02-12, 06-09 |
| F11 | 项目会话列表 | `/projects/$id/conversations` | 浏览 | 按 Provider 分组 | listProjectConversations | — | conversations-page.tsx:84 | ✅ | 并入 **项目详情**：置顶在前、其余按最近活动；不再按 AI 工具分组。没有跨项目的“全部会话”页（没有接口） | 02-04 |
| F12 | 会话状态/Agent 筛选 | 筛选菜单 | 缩小范围 | 全部/运行中/等待/已完成；Provider | client-side | — | conversation-list-model.ts:6-91 | ✅ | 项目详情：状态分段（全部 / 运行中 / 等待批准 / 已完成 / 失败）+ AI 工具下拉；“会话 / 已归档”分段 | 02-04, 02-06 |
| F13 | 会话搜索（标题+用户输入） | 搜索框 `?q=` | 找回会话 | 分页 25 条，跳转 Turn | searchProjectConversations | 项目内 | conversation-search-query.ts:47 | ✅（项目内） | **项目内搜索** `/projects/:id/search`：从项目详情的搜索框进入，写明搜索范围和不搜索的内容；同一会话多处命中合并为一行；还有下一页时才显示“加载更多”。跨项目搜索列入后续规划 | 02-07 |
| F14 | Pin / Unpin | 行菜单 | 常用置顶 | — | `/pin` `/unpin` | 非忙碌 | conversation-organization-controls.tsx:157 | ✅ | 会话行悬停“置顶” + 会话设置弹窗开关；置顶的会话在侧栏和项目里排在前面 | 02-20, 02-04 |
| F15 | 重命名 | 行菜单 | — | — | renameConversation | — | controls.tsx:174 | ✅ | **会话设置**弹窗（名称 / 置顶 / 归档） | 02-20 |
| F16 | 归档 / 恢复 | 行菜单、`view=archived` | 清理列表 | 确认、恢复 | `/archive` `/unarchive` | 运行中不可归档 | controls.tsx:180-297 | ✅ | 会话行悬停“归档” + 会话设置弹窗开关（运行中、等待批准时禁用并说明）；项目详情 **已归档** 分段找回 | 02-06, 02-20 |
| F17 | 新建会话 | 侧栏按钮、项目“+” | 开始工作 | 选运行位置（电脑）、项目、Agent、模型、推理 | createConversation；machine-query | 设备 available + projectAccess + providerExecution + 有项目位置 | new-conversation-dialog.tsx:80-205；new-conversation-provider-selection.ts | ✅ | 顺序 **项目（按设备分组）→ AI 工具 → 推理强度**（只在 Claude Code 显示）；项目确定了设备，不再单独选运行位置；不可用的项目列出原因；不显示模型选择；不带第一条消息。入口：侧栏按钮（Ctrl N）、项目行“＋”、项目详情、设备页 | 02-13, 02-14, 03-07, 04-11, 06-07 |
| F18 | 会话详情头部/状态 | `/conversations/$id` | 阅读 | — | getConversation + SSE | — | conversation-header.tsx | ✅ | 标题 + 状态 + **上下文条**（设备 › 项目 · AI 工具 · 推理强度） | 02-15…02-19 |
| F19 | 时间线、工具分组、Markdown、Diff/Shell 卡片 | 会话详情 | 理解 Agent 行为 | 展开 | detail + events | — | conversation-timeline.tsx；tool-grouping.ts | ✅ | 保留；阅读区最大宽 740 | 02-15 |
| F20 | 审批坞 | 会话详情底部 | 批准风险操作 | 允许一次 / 拒绝 | `/approvals/:id/resolve` | connected && supportsApprovals（仅本地 Codex） | pending-action-dock.tsx | ✅（本地 Codex） | 时间线内联审批卡，只有这台电脑上的 Codex；配对设备的会话不显示 | 02-15, 06-03 |
| F21 | Composer 发送 | 会话详情 | 继续对话 | 输入、发送 | startTurn `{actionId, input}` | canCompose 门控 | composer.tsx；conversation-controls.ts:164 | ✅ | 能发送时才显示输入框；运行中、等待批准、设备离线时替换为**说明条 + 下一步** | 02-15, 02-18, 03-12 |
| F22 | 中断 | 顶栏 chrome | 停止 | — | `/interrupt` | 仅本地 Codex | conversation-chrome-actions.tsx | ◐ | 移到输入区的运行说明条里（“停止”），只有这台电脑上的 Codex；配对设备上写明“在配对设备上运行的会话，这里不能停止”，不放按钮 | 02-15, 02-18 |
| F23 | Inspector：文件/变更/工具输出 | 顶栏切换 | 查看改动 | 拖宽 | detail | supportsDiff / supportsToolOutput | inspector-panel.tsx:420 | ✅ | 右侧面板（文件 / 变更 / 输出）；变更只有这台电脑上的 Codex，Claude Code 只有“文件”并说明原因；≤1000 变为浮层 | 02-16, 02-17, 02-19, 04-03 |
| F24 | 会话 Rail（同项目） | 会话详情左栏 | 切换 | 筛选、搜索、新建 | conversation-list-query | 同项目 | conversation-rail.tsx | ✅（基线未挂载） | 不需要：侧栏树已经列出同一项目的会话，另有 Ctrl K | — |
| F25 | 失败卡 + 重试 | 时间线 | 恢复 | 重试（新 Turn）、跳转设备/项目、技术详情 | canonical failure | 部分原因不提供重试 | conversation-failure-card.tsx | ✅ | 保留，文案说明下一步 | 03-12 |
| F26 | 导入会话原生历史 | 会话详情 | 阅读旧历史 | 加载更早 | native-transcript | origin=adopted_native | conversation-detail-route.tsx:222 | ✅ | 上下文条标签“从 Codex / Claude Code 导入” | 03-13 |
| F27 | 演示会话 adapter | 非法 ID | 开发演示 | — | mocks | — | demo-conversation-adapter.ts | ✅（开发用） | 保留并标注“演示数据”；生产应显示“找不到这个会话” | — |
| F28 | Inbox 列表/汇总/筛选 | `/inbox` | 处理事项 | 全部/审批/完成/失败 | attention-query | connected | inbox-page.tsx；inbox-summary.tsx | ✅ | **待处理**：分段带计数；每项第三行是 设备 · 项目；侧栏角标同源 | 02-11, 03-11, 04-07 |
| F29 | Inbox 审批 | 审批项 | 决定 | 允许一次 / 拒绝 | resolve approval | Provider 支持审批 | inbox-item.tsx:148 | ✅ | 保留；不支持审批时显示说明而非按钮 | 02-11 |
| F30 | Inbox 完成待查看 / 失败 | 项 | 查看 | 查看结果 / 打开会话 / 知道了 | resolve attention | — | inbox-actions.ts:34-52 | ✅ | 保留，跳转到对应会话 | 02-11 |
| F31 | 已读/未读、稍后提醒 | — | — | — | — | — | — | ✕ | 不设计已读态（处理即移出）；列入后续规划 | 05-01 |
| F32 | 系统通知 | Desktop | 后台提醒 | 点击打开会话 | attention-notification-coordinator.ts；attention_notifications.rs | Desktop、窗口不在对应页 | desktop-notification-model.ts:109 | ✅ | 不变；设置 › 通知（说明通知不含会话标题） | 02-32 |
| F33 | 通知偏好 ×3 | `/settings` | 控制提醒 | 需要批准 / 工作完成 / 执行失败 | notification-preferences.ts | Desktop | desktop-notification-settings.tsx:128 | ✅ | **设置 › 通知**，3 个开关 | 02-32 |
| F34 | 后台运行说明 | `/settings` | 理解关闭行为 | 无开关 | backgroundRuntime.available | Desktop | desktop-notification-settings.tsx:115 | ◐（仅说明） | **设置 › 后台运行**，只写状态不给开关 | 02-33 |
| F35 | 托盘 | 系统托盘 | 恢复/退出 | “打开 CodeTether”、“退出 CodeTether” | — | Desktop | system_tray.rs:38-59 | ✅ | 不变；设置 › 后台运行中说明 | 02-33 |
| F36 | 关闭到托盘 + 首次提示 | 窗口 ✕ / Alt+F4 | 后台继续 | — | — | — | host_supervisor.rs:1326；system_tray.rs:100 | ✅ | 不变 | — |
| F37 | 单实例 | 再次打开 | 恢复窗口 | — | — | — | host_supervisor.rs:1221 | ✅ | 不变 | — |
| F38 | 原生标题栏 | 窗口 | — | — | — | decorations:true，1440×900，最小 1100×700 | tauri.conf.json | ✅ | 设计提供**自定义标题栏**方案（mac 红绿灯 / Win 窗口控制、可拖动区），实现需改 decorations（02 §6 D5，可选） | 全部 |
| F39 | 开机启动 / Deep link | — | — | — | — | — | — | ✕ | 后续规划；设置 › 后台运行只放“查看后续规划”链接，不放开关 | 05-01, 02-33 |
| F40 | 设备列表 | `/machines`（“电脑”） | 找到设备 | 打开详情、添加 | listMachines | connected | machines-page.tsx:31-261 | ✅ | **设备**（起始页）：每台设备一节（名称、连接状态、系统 · 架构 · 连接方式、“添加项目”），节内是这台设备的项目卡片和“添加项目”卡片 | 02-01, 03-01, 03-02, 04-01, 04-04 |
| F41 | 本机详情 | `/machines/$id` | 查看本机 | Provider、项目、最近会话 | getMachine | — | machine-detail-page.tsx:269-511 | ✅ | **设备详情**：左侧项目列表和最近的会话（最近 100 个），右侧 AI 工具 / 连接 | 02-02 |
| F42 | 远程设备详情 | 同上 | 查看远程 | 重试连接、刷新 Provider | getMachine | remote | machine-detail-page.tsx:545-1313 | ✅（没有会话列表） | 同上，配对设备也显示项目和会话；离线时顶部 notice + 上次在线时间（D4）；项目列表读取失败单独提示 | 02-03, 03-03, 03-04, 04-05 |
| F43 | 添加远程电脑（配对） | 设备页“添加” | 连接另一台设备 | 地址或 `codetether-pairing://` + 6 位码 → 核对验证码 → 完成 | begin/confirm/cancelRemoteMachinePairing | 单次一个信任变更 | add-remote-machine-dialog.tsx:50-506 | ✅ | **添加设备** `/add`（Node 配对，并说明 Windows 和同一账号下的其他电脑暂不能添加）→ **配对设备** `/add/node` 4 步（准备 → 输入 → 核对 → 完成，完成后直接“添加项目”） | 02-23…02-27 |
| F44 | Relay 辅助首次配对 | Node 输出链接 | 跨网络配对 | — | relay rendezvous | 自动化测试，未宣称生产验证 | PHASE8D-RELAY-ASSISTED-FIRST-PAIRING.md | ◐ | 第 2 步输入框同时接受地址和配对链接，帮助文字说明 | 02-25 |
| F45 | 更新连接地址 | 设备详情 | 地址变化恢复 | 验证并保存 | updateMachineConnectionAddress | remote；recovery_required 提示 | update-machine-address-dialog.tsx | ✅ | 连接卡“更新地址”弹窗；离线 notice 也给入口 | 02-22, 03-03 |
| F46 | 取消配对 | 设备详情 | 撤销信任 | 确认 | unpairMachine | 无项目位置时 | unpair-machine-dialog.tsx | ✅ | 连接卡“取消配对”；还有项目时弹窗列出这些项目、不给确认按钮（与基线一致） | 02-21, 03-10 |
| F47 | Internet Relay 配置/enroll/重试/断开/移除 | 设备详情 Relay 区 | 跨网络 | 配置、一次性令牌、重试、移除 | relay-actions.ts:111-152 | remote | machine-relay-section.tsx | ✅ | 连接卡只显示连接方式、地址、上次在线、配对方式。**缺口**：Relay 配置、一次性令牌、重试、移除没有画，实现保留并归入连接卡“高级” | 02-03 |
| F48 | Provider 安装选择 | 设备详情 | 选 CLI 安装 | 选择 | selectMachineProviderInstallation | — | provider-installation-selector.tsx | ✅ | **缺口**：设备详情 AI 工具卡没有画安装选择，实现保留 provider-installation-selector | 02-02 |
| F49 | 安装 vs 执行健康 | 设备详情 | 判断可用 | — | providerDiscovery / executionHealth | current / last_known | machine-detail-page.tsx | ✅ | AI 工具行显示运行状况和“上次已知”说明。**缺口**：安装状态没有单独表达，Figma 需补 | 02-02, 02-03 |
| F50 | 项目列表 | `/projects` | 浏览项目 | 打开、移除 | listProjects | — | projects-page.tsx；project-row.tsx | ✅ | 不再有单独的项目列表页：项目在 **设备** 页按设备分节显示（`/projects` 重定向 `/devices`）；卡片显示状态、路径、会话数、进行中数、可导入数 | 02-01, 03-05, 03-06 |
| F51 | 项目详情 + 位置 | `/projects/$id` | 管理 | 查看会话、新建、添加位置、移除项目 | getProject | — | project-detail-page.tsx；project-locations-section.tsx | ✅（不列会话） | **项目详情**（设备 › 项目）：会话列表、筛选、搜索、“新建会话”、常驻“以前的会话”一节、“移除项目”；不可用时说明原因和下一步。不再提供“在另一台设备上添加位置” | 02-04, 02-05, 03-05, 03-06, 04-02, 04-06 |
| F52 | 添加项目（本机） | 项目页 | 登记文件夹 | 原生选择器 / 手输路径、名称 | createProject | Desktop 选择器 | add-project-dialog.tsx | ✅ | **添加项目**弹窗第一步：设备 → 文件夹（这台电脑用系统选择窗口或输入路径）→ 名称；同一设备上已添加过的文件夹直接打开原项目 | 02-08, 04-09 |
| F53 | 添加远程位置 | 项目详情、配对电脑详情 | 远程登记 | 选设备 + 路径 | registerProjectLocation / createRemoteProject | remote 已配对 | add-project-location-dialog.tsx | ✅ | 并入同一个“添加项目”弹窗：选配对设备时只能输入完整路径（Node 没有列目录接口）；从设备入口打开时设备固定。v4 只用 createRemoteProject，不给已有项目再加位置 | 02-09 |
| F54 | 移除项目 / 移除位置 | 项目详情 | 清理 | 确认 | deleteProject / removeProjectLocation | 项目无会话（含已归档） | remove-project-*-dialog.tsx | ✅ | 项目详情“移除项目” + 确认弹窗；仍有会话（含已归档）时弹窗预先说明不能移除，只给“知道了”（基线提交后才报错）。“移除位置”在一项目一位置下不再单独出现。删除会话列入后续规划 | 03-08, 03-09 |
| F55 | 导入以前的会话 | 添加项目后、设置步骤 | 继续旧会话 | 多选导入 | discover/adoptProviderSession | resumeStatus=supported | previous-conversations-step.tsx | ✅（这台电脑和配对设备） | **添加项目第二步自动扫描**：按 AI 工具分组，可以继续的默认勾选，“导入所选”或“跳过”；项目页常驻“以前的会话”（重新扫描、加载更多、已导入的“打开”、格式不支持的说明、设备离线的说明）；首次启动同样使用（D7、D8） | 02-05, 02-10, 02-38, 06-06 |
| F56 | 远程 Node | CLI `codetether-node` | 让设备可被连接 | `--pair`、`service install` 等 | — | 本地操作 | apps/node/src/main.ts；service-installation.ts | ✅（无 UI；Linux x64/arm64、macOS arm64） | 配对第 1 步给出命令和支持的系统 | 02-24 |
| F57 | Node 控制端恢复 | Node 本地 CLI | 凭据丢失 | `--controller` | — | 本地交互 | local-controller-recovery.ts | ✅（无 UI） | 交接说明，产品内不提供 | — |
| F58 | `/activity` 活动 | 路由占位 | — | — | — | — | router.tsx:93 | ✕ | 不进主导航；移除或重定向到 `/devices` | — |
| F59 | `/agents` 智能体 | 路由占位 | — | — | — | — | router.tsx:126 | ✕ | 能力并入设备详情 › AI 工具卡；移除或重定向 | — |
| F60 | 组件 Showcase | 开发 | 视觉检查 | — | — | — | showcase/component-showcase.tsx | ✅ | 更新为新组件（浅色 + 深色） | components.css；00-overview |
| F61 | 主题 / 语言 | — | — | — | — | — | apps/web/src/main.tsx:15 `dataset.theme = 'dark'` | ✕（仅深色、仅中文） | **设置 › 外观**：浅色 / 深色 / 跟随系统（新增范围，D10）；语言只说明“简体中文” | 02-30, 06-01…06-12 |
| F62 | 账号登录（邮箱登录码） | `/hosts` 页内（英文） | 登录账号 | 发送登录码、验证、退出 | Supabase OTP | 需配置账号服务 | host-directory-page.tsx | ✅ | **设置 › 账号**（登录 / 退出）+ 登录页 `/signin`（中文）；配对设备不需要账号 | 02-28, 02-29, 02-31, 03-14, 03-15 |
| F63 | 本机作为主机 | `/hosts` Host capability 卡 | 允许同账号其他电脑只读查看本机 | 启用、完成设置 | local host lifecycle | 已登录 | host-directory-page.tsx | ✅（平台文字硬编码 macOS） | v4 不显示（不做只读设备，02 §0）；随“同一账号下的 Mac 和 Windows”一起放进后续规划 | 05-01 |
| F64 | 其他主机列表 | `/hosts` My Hosts | 找到同账号下的电脑 | 打开、申请、取消、重新申请、重试 | listAuthorizedHosts / listOwnedHosts | 已登录 | host-directory-page.tsx | ✅ | v4 不显示；添加设备页说明同一账号下的其他电脑暂时不能添加 | 02-23, 05-01 |
| F65 | 其他主机只读查看 | `/hosts/$hostId` | 只读查看 Machine、项目、会话 | 浏览、实时查看 | remote-supervisor（supervisor_read） | access=authorized 且在线 | remote-host-page.tsx | ✅ | v4 不显示（没有只读设备） | — |
| F66 | 访问申请处理（主机方） | `/hosts` PendingAccessRequestPanel | 批准或拒绝 | 允许、拒绝 | control-plane，30 秒轮询 | 本机已作为主机 | host-directory-page.tsx | ✅（无撤销、无通知） | v4 不显示；需要确认基线 `/hosts` 可以先下线（02 §0） | — |
| F67 | supervisor_control（远程发送/新建） | `/hosts/$hostId`（仅 control 时出现） | — | — | `/api/v1/supervisor/control/approve` | 控制面不签发 | apps/host；remote-host-page.tsx:215, 407 | ◐ 后端存在、出厂不可达 | 后续规划“同一账号下的 Mac 和 Windows”（部分实现） | 05-01 |
| F68 | Windows 设备配对 | — | 把 Windows 电脑作为配对设备 | — | — | — | Node 发布目标 | ✕ | 后续规划；添加设备页和首次启动写明 | 05-01, 02-23 |

## 旧入口 → 新入口

| 旧入口 | 新入口 | 说明 |
|---|---|---|
| `/` → `/hosts`（My Hosts，英文） | `/` → **设备** `/devices` | 首次启动选了项目时进入该项目 |
| 侧栏“My Hosts” | 去掉；登录 / 退出移到 **设置 › 账号** | 其他主机和访问申请不在新导航里 |
| 侧栏“收件箱” | 主导航 **待处理** `/inbox` | 带计数 |
| 侧栏“电脑” + 项目树（项目 › 会话，一次展开一个） | 主导航 **设备** + 设备树 **设备 › 项目 › 会话**，可同时展开多个，置顶在前 | |
| `/projects` | 重定向 `/devices` | 项目按设备分节 |
| `/projects/$id`（不列会话）+ `/projects/$id/conversations`（按 Agent 分组） | 合并为 **项目详情** `/projects/:id` | 旧 URL 保留为重定向 |
| `?view=archived` | `/projects/:id?view=archived` | |
| `?q=` | 项目内搜索 `/projects/:id/search?q=` | |
| 顶栏“检查状态” | 设置 › 关于与检查 | |
| 顶栏中断按钮 | 输入区运行说明条里的“停止”（只有这台电脑上的 Codex） | |
| `/settings`（常规/通知） | 设置：外观 / 账号 / 通知 / 后台运行 / 关于与检查 | 后续规划单独一页 `/roadmap` |
| 添加远程电脑弹窗 | **添加设备** `/add` → **配对设备** `/add/node` 4 步 | |
| `/machines`、`/machines/$id` | `/devices`、`/devices/:id` | 旧 URL 保留为重定向 |
| `/hosts`、`/hosts/$hostId` | 不在主导航（v4 不做只读设备） | 需要确认下线（02 §0） |
| `/agents`、`/activity`（占位页） | 无（移除或重定向到 `/devices`） | |
| `/conversations/$id` | 会话详情（原型 `#/c/:id`） | 保留 URL |

## 前端审核（基线 bbcda69 的 apps/web）

方法：只读代码，没有运行生产应用、Tauri 外壳或测试。

### 1. “打开应用 → 选设备和项目 → 开始或继续”的摩擦点

| # | 基线现状 | v4 处理 | 需要后端？ |
|---|---|---|---|
| 1 | 启动进入英文、需要登录的 My Hosts（startup-gate.tsx:59） | 启动进入设备；去掉 My Hosts | 否 |
| 2 | 项目详情不列会话，要再点一次进入单独路由 | 项目详情直接列出会话 | 否 |
| 3 | 侧栏每个项目最近 4 条，一次只展开一个项目，置顶不优先，看不出项目在哪台设备上 | 设备 › 项目 › 会话，可同时展开，置顶在前，当前会话总是可见 | 否 |
| 4 | 列表到 100 条为止，提示“其余历史将在后续分页能力中提供” | 超过 100 条时说明并引导用项目内搜索（有游标） | 真正的分页需要 Host 加游标 |
| 5 | 新建对话框里“运行位置”在项目之后，却悄悄过滤项目列表 | 项目按设备分组，选项目就确定了设备；不可用的项目列出原因 | 否 |
| 6 | 导入以前的会话只在首次启动和添加项目后出现一次 | 添加项目第二步自动扫描，项目页常驻“以前的会话”，可重新扫描 | 否 |
| 7 | 用词不一致：等待 / 需要处理；Agent / 智能体 / AI 工具；电脑 / 主机 / Machine | 统一为 等待批准、AI 工具、设备、项目 | 否 |
| 8 | 运行中 Composer 锁定，中断只在顶栏 | 输入区换成说明条，“停止”放在说明条里（只有这台电脑上的 Codex） | 排队 / 补充指令需要 Host |
| 9 | 没有命令面板；顶栏搜索、铃铛、头像有 props 但没接线 | Ctrl K 按标题筛选已读取的会话并跳转；跨项目搜索列入后续规划 | 跨项目搜索需要 Host |
| 10 | 配对设备上的文件夹只能手输完整路径 | 保持手输，说明原因；“浏览配对设备上的文件夹”列入后续规划 | 需要 Node / Host |

### 2. 前端有入口，但后端不支持或没接线

- `/activity`、`/agents` 是占位页（router.tsx:93、126）。v4 移除或重定向。
- 顶栏 ⌘K、铃铛、头像组件存在但 app-shell 没传 props，不渲染。
- `ConversationRail` 和 `InboxFilters` 组件存在但没有挂载。
- `/hosts/$hostId` 的新建表单和输入框只在 `session.control === 'control'` 时出现（remote-host-page.tsx:215、407），而控制面只签发 supervisor_read。v4 不画这部分。
- 非法会话 ID 会显示演示数据（conversation-detail-route.tsx:135-156）。生产实现应显示“找不到这个会话”。

### 3. 后端已支持，前端没用上

- provider-sessions 在配对设备上也能扫描（Node 的 provider-session-discovery.ts），并支持 `rescan` 和游标；基线只在添加项目后用一次。
- `GET /machines/:id` 带这台设备最近 100 个会话；基线只有本机详情显示“最近会话”。v4 两者都显示。
- Host 支持 `status=failed` 筛选；基线会话页没有“失败”分段。
- 移除项目前，用现有的 `allProjectConversationsQueryOptions`（`archived: 'all'`）就能预先判断；基线提交后才报错。

## v3 的更正

v3 把会话组织成 项目 › 文件夹（电脑）› 会话，一个项目可以挂多台电脑上的文件夹，还把同一账号下其他电脑画成“其他主机 · 仅查看”，并在设置里放了访问申请。用户确认：一个项目只在一台设备上，当前目标不是一个项目跨 Mac 和 Windows；也不需要只读设备。v4 改为 设备 › 项目 › 会话，删掉了其他主机、访问申请、“在另一台电脑上添加文件夹”和“移除文件夹”，并把以前的会话从一次性的导入步骤改成添加项目时自动扫描、项目页常驻。

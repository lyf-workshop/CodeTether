# 01 · 页面与功能清单 / 新旧映射（v3）

依据：已验收产品基线 **`bbcda690a081`**（Mac、Windows 均为此版本）的 `apps/web/src`（路由、组件、runtime/host、runtime/account）、`packages/protocol`、`apps/host`、`apps/desktop/src-tauri`、`apps/node`。第一轮盘点误读了较早的工作分支（ee11867），账号、其他主机、supervisor_read、访问申请的结论已按 bbcda69 更正。
状态：✅ 已实现 · ◐ 部分实现 · ✕ 尚未实现。
“原型 Frame” 列对应 `png/` 编号（`prototype/` 中的同名页面）；Figma 写入后 Frame 名称与 PNG 名相同（见 02 文档 §7）。标“缺口”的条目是原型没有画、但实现必须保留的现有能力。

v3 的核心：会话按 **项目 › 文件夹 › 会话** 组织。“文件夹”就是项目在某台电脑上的位置（ProjectLocation），Host 用它作为 AI 工具的工作目录，用户不用再自己打开对应文件夹。

## 关键事实（影响设计的结论）

| 主题 | 代码中的真实情况 | 源码 |
|---|---|---|
| 会话归属 | ProjectRecord → ProjectLocation `{projectId, machineId, rootPath, availability}`，一个项目在每台电脑上最多一个文件夹，没有单独的 locationId。按项目新建会话只传 `projectId + machineId`，Host 取该文件夹的 `rootPath` 作为 cwd。所以“文件夹”= 项目 + 电脑。 | host-service.ts:5917-5933；protocol commands.ts:44-53 |
| 基线前端的组织方式 | 侧栏已经是“项目 › 会话”：每个项目最近 4 条，一次只展开一个项目，置顶不优先，会话行不显示电脑，没有文件夹这一层。项目详情页不列会话；会话列表在 `/projects/$id/conversations`，按 Agent 分组。启动后进入英文的 `/hosts`（My Hosts）。 | workspace-sidebar-model.ts:7；workspace-sidebar.tsx；startup-gate.tsx:59；conversations-page.tsx |
| 会话列表与搜索 | 只有按项目的接口：`GET /api/v1/projects/:id/conversations`（`provider / status / archived` 筛选，`limit ≤ 100`，没有游标，没有按电脑筛选）；项目内搜索（标题 + 你发送过的内容，关键词 ≤ 160 字，有游标）。**没有**跨项目列表或全局搜索；`/conversations` 重定向 `/projects`。`GET /snapshot` 只含 Host 内存里的会话（达到 `maxConversations` 会换出），不能当全量列表；`GET /machines/:id` 只带这台电脑最近 100 个。AGENTS.md 把跨项目/全局搜索列为范围外。 | router.tsx；conversation-list-query.ts；conversation-search-query.ts；host-service.ts:1889-1907、5025-5039 |
| 新建会话 | `CreateConversationByProjectRequest {actionId, machineId, provider, projectId, model?, reasoning?}`（另有旧的 cwd 变体），不带第一条消息。Codex 的 descriptor 没有 `models` / `reasoningOptions`；Claude Code 有推理强度 low / medium / high / xhigh / max（本机与配对电脑相同），没有模型列表。模型和推理强度只能在新建时选，之后 Inspector 只读显示。 | protocol providers.ts:113-125；claude-code-host-runtime.ts:81；host-service.ts:9560-9631；inspector-panel.tsx:130 |
| 待处理 | `GET /attention`：approval / completed_review / failed，处理即移出。 | attention-query |
| 导入以前的会话 | `GET/POST /projects/:id/locations/:machineId/provider-sessions`：按文件夹发现并导入 Codex / Claude Code 的本机会话。 | previous-conversations-step.tsx |
| 账号登录 | ✅ Supabase 邮箱一次性登录码（`shouldCreateUser:false`，只能登录已有账号）。入口只在 `/hosts`（My Hosts）页，文案为英文；退出登录在该页头部；设置里没有账号区。未配置账号服务时构建失败。 | runtime/account/control-plane-client.ts；routes/host-directory-page.tsx |
| 本机作为主机 | ✅ “Enable this Mac as a Host” 卡片，状态 `disabled → enabled_unclaimed → claimed`。平台文字硬编码为 macOS（Windows 上也显示 Mac）。 | host-directory-page.tsx |
| 两层结构 | **本机主机**（Desktop 内置 Host）= 1 个 `local` Machine + 经 Node 配对的 `remote` Machine（最多 64）。**其他主机** = 同一账号下其他电脑上的 Desktop Host，经账号发现、申请后只读查看。两者入口、认证和权限都不同。 | protocol machines.ts；listAuthorizedHosts / listOwnedHosts |
| 访问权限分级 | ✅ `supervisor_read` 已实现：其他主机授权后只读查看 Machine、项目、会话列表、transcript、Provider 可用性和运行中输出（live: idle/connecting/live/disconnected）。协议枚举含 `supervisor_control`，但控制面只签发 `supervisor_read`。 | protocol grant scope；remote-supervisor.ts；routes/remote-host-page.tsx |
| supervisor_control | ◐ 协议、Host 本地表 `host_supervisor_control` 和 `POST /api/v1/supervisor/control/approve` 存在，`conversation.create / conversation.turn.start` 已按 control 门控；**没有任何 UI 调用批准接口，控制面不签发 control**，因此出厂流程中不可达。 | apps/host supervisor 路由 |
| 访问申请 | ✅ 申请方：申请、取消、重新申请；状态 authorized/pending/denied/cancelled/expired/none。主机方：PendingAccessRequestPanel，允许/拒绝，显示设备指纹与“读取工作区 · 过期时间”，每 30 秒轮询。✕ 没有撤销已授权设备的界面，✕ 没有新申请通知。 | host-directory-page.tsx |
| 其他主机在线状态 | 通过一次实际连接判断：检查中 / 在线 / 无法连接。本机主机点击进入 `/machines`，其他主机进入 `/hosts/$hostId`。 | host-directory-page.tsx |
| Node 配对 | ✅ `codetether-node --pair`、`codetether-pairing://relay/v1`、6 位配对码。入口为 `/machines` 的“添加远程电脑”弹窗。**只属于 Node 流程**，与账号无关。 | add-remote-machine-dialog.tsx；apps/node |
| 远程执行 | Node 配对的 Machine：✅ 远程 Codex；◐ 远程 Claude Code。Claude Code（本机和远程）都以 `--tools Read,Glob,Grep --permission-mode dontAsk` 运行，只读取和搜索文件。其他主机（supervisor_read）：✕ 不能发送或新建。 | remote-machine-coordinator.ts；remote-claude-host-runtime.ts；claude-code-host-runtime.ts |
| 中断 / 审批 / 变更 | 只有本地 Codex 支持中断（`capabilities.interrupt`）、审批和报告变更（Diff）。Node 远程运行时 `subscribeApprovals` 为空实现；supervisor 协议没有中断和审批操作。 | remote-codex-host-runtime.ts；claude-code-host-runtime.ts |
| 运行中输入 | ✕ 没有排队（queue）或补充指令（steer）；Provider descriptor 无对应字段，AGENTS.md 列为范围外。运行中再发送 Host 返回 409 `conversation_busy`；基线 Composer 运行中禁用并提示“智能体正在运行”，中断按钮只在顶栏。 | conversation-controls.ts；composer.tsx；AGENTS.md |
| 开机自启 / 语言 | ✕ 无开机自启；无 i18n（界面中文，My Hosts 区域英文）。托盘与“关闭后后台运行”提示已实现但没有开关。 | desktop tauri |
| 主题 | 仅深色，启动时写死 `dataset.theme = 'dark'`。设计提议默认浅色、可切换深色/跟随系统，属于**新增前端范围**（见 02 §0、D11）。 | apps/web/src/main.tsx:15；packages/ui/README.md:7 |
| 只读历史 | 导入的本机会话（`origin=adopted_native`）的原生 transcript 只读，但仍可继续对话。 | native-transcript.ts:72 |
| 界面语言 | 仅简体中文，无 i18n。新设计保持中文；产品名词 Codex / Claude Code / Relay / Node 保留英文。 | — |
| 取消配对 | 电脑上还有项目文件夹时不能取消配对（`machine_has_project_locations`），需要先移除这些文件夹。 | unpair-machine-dialog.tsx；project-actions.ts:348 |
| 移除项目 | 只取消登记，不删除文件。项目还有任何会话（**包括已归档**）时 Host 拒绝（`has_conversations`）。 | project-registry.ts:595-610；conversation-store.ts:2599 |
| 移除文件夹（项目位置） | 只有配对电脑上的文件夹显示“移除”；本机文件夹、项目的最后一个文件夹不能移除（`local_required`）；该电脑上还有这个项目的会话时拒绝（`has_conversations`）。 | conversation-store.ts:2324-2361；project-locations-section.tsx:208 |
| 移除失败的提示时机 | 基线在用户点确认、提交后才显示错误（如“此项目仍有关联会话，当前不能移除。”）。v3 在打开弹窗时就预先说明不能移除的原因（用现有的项目会话列表计数，见 02 §5、§6 D1/D3）。 | host-service.ts:10000-10041；project-actions.ts:305 |
| 删除会话 | ✕ 不存在。本地 HTTP 服务没有删除会话的路由，只有归档。因此仍有会话的项目和文件夹无法移除。列入后续规划。 | local-http-server.ts |

## 功能清单

| # | 功能 | 当前入口 | 用户目的 | 主要操作 | 数据来源 | 权限/条件 | 源码 | 状态 | 新设计去向 | 原型 Frame |
|---|---|---|---|---|---|---|---|---|---|---|
| F01 | 启动门 | `/` StartupGate | 打开应用 | 自动重试 5 次；“重新检查” | `getOnboarding` | Host 已连接 | onboarding/startup-gate.tsx:18；startup-gate-recovery.ts:8 | ✅ | 保留；完成后基线进入英文 `/hosts`（startup-gate.tsx:59），v3 改为进入 **项目** `/projects`（02 §6 D6） | — |
| F02 | 首次设置 7 步 | `/setup` | 检查本机、AI 工具、选项目、导入、远程 | welcome→computer_check→provider_check→project_setup→previous_conversations→remote_setup→ready | onboarding-query.ts（CAS revision） | — | onboarding-page.tsx:73-1032 | ✅ | **首次启动** 6 屏（欢迎 / AI 工具 / 项目 / 以前的会话 / 其他电脑 / 完成），完成后进入项目；computer_check 与 provider_check 合并展示，状态机仍用基线 7 步 | 02-41…02-46 |
| F03 | 设置恢复态 | `/setup` | 出错恢复 | 重新选择项目、重试 | — | — | onboarding-page.tsx:1232-1323 | ✅ | 首次启动错误态，沿用 notice err 样式（原型未单独出图） | 03-03、03-14 样式 |
| F04 | Provider 安装/登录指引 | 设置·AI 工具卡 | 安装或登录 CLI | 打开官方说明 | native providerGuidance | Desktop | provider-guidance-link.tsx | ✅ | 首次启动·AI 工具的“查看登录说明”。**缺口**：电脑详情 AI 工具卡未画指引链接，实现保留 provider-guidance-link | 02-42, 02-21, 02-22 |
| F05 | 检查状态 (Doctor) | 顶栏“检查状态”、`/doctor` | 诊断 | 重新检查、打开设置、重新运行设置 | doctor-query.ts | — | doctor/doctor-page.tsx:184-760 | ✅ | **设置 › 关于与检查**；顶栏按钮移除，诊断代码折叠 | 02-40 |
| F06 | 侧栏主导航 | Sidebar：My Hosts、收件箱、电脑、项目树 | 导航 | — | — | — | workspace-sidebar.tsx:138-167 | ✅ | 主导航 **待处理**（带计数）/ **我的电脑** / **项目**，下面是项目树，再下面是“其他主机 · 仅查看”，底部账号与设置；去掉 My Hosts；手机为 4 个底部标签（项目 / 待处理 / 电脑 / 设置） | 全部 |
| F07 | 侧栏项目树 + 最近 4 会话 | Sidebar | 快速进入 | 展开、新建、显示全部 | project-query, conversation-list-query | — | workspace-sidebar.tsx:157-437；workspace-sidebar-model.ts:7 | ✅ | 保留并加一层：**项目 › 文件夹（电脑）› 会话**；可以同时展开多个项目；每个文件夹默认 4 条（置顶在前，当前会话总是可见），“显示全部 N 个”；只有运行中 / 等待批准 / 失败显示状态点；文件夹行悬停“+”在该文件夹新建会话（依赖 D1） | 02-01, 02-02, 02-13 |
| F08 | 侧栏折叠/拖宽 | 顶栏切换、拖拽 | 空间 | localStorage 持久 | — | — | workspace-sidebar-layout.ts | ✅ | **缺口**：原型侧栏固定宽，≤1180 只收窄到 224px，没有画折叠/拖宽；实现保留现有能力，Figma 需补 | 03-19…03-21 |
| F09 | 面包屑 | 顶栏 | 定位 | — | 各 detail query | — | root-layout.tsx:212 | ✅ | 移入**标题栏可拖动区**；会话详情另有**上下文条**：项目 › 文件夹（电脑，悬停看完整路径）· AI 工具 | 02-13, 04-07 |
| F10 | 顶栏 ⌘K / 通知 / 头像 | 顶栏 props | — | — | — | 未接线 | top-bar.tsx:152 | ✕ | Ctrl K（mac ⌘K）**命令面板**：按标题找会话（只筛选已读取的列表）、跳到项目或电脑、常用操作（新建会话 / 添加项目文件夹 / 添加电脑 / 切换主题），底部链接到当前项目内搜索；头像移到侧栏底部；通知并入“待处理” | 02-06 |
| F11 | 项目会话列表 | `/projects/$id/conversations` | 浏览 | 按 Provider 分组 | listProjectConversations | — | conversations-page.tsx:84 | ✅ | 并入 **项目详情**：每个文件夹一节，节内置顶在前、其余按最近活动；不再按 AI 工具分组。没有跨项目的“全部会话”页（没有接口） | 02-02 |
| F12 | 会话状态/Agent 筛选 | 筛选菜单 | 缩小范围 | 全部/运行中/等待/已完成；Provider | client-side | — | conversation-list-model.ts:6-91 | ✅ | 项目详情：状态分段（全部 / 运行中 / 等待批准 / 已完成 / 失败）+ AI 工具下拉；不需要电脑筛选（已按文件夹分节）；“会话 / 已归档”分段 | 02-02, 02-03 |
| F13 | 会话搜索（标题+用户输入） | 搜索框 `?q=` | 找回会话 | 分页 25 条，跳转 Turn | searchProjectConversations | 项目内 | conversation-search-query.ts:47 | ✅（项目内） | **项目内搜索** `/projects/:id/search`：从项目详情的搜索框进入，结果上方写明范围（这个项目的所有文件夹）和不搜索的内容；同一会话标题和消息都命中时合并为一行；沿用每页 25 条，还有下一页时才显示“加载更多”（原型数据不足一页，未出现）。跨项目搜索列入后续规划 | 02-04 |
| F14 | Pin / Unpin | 行菜单 | 常用置顶 | — | `/pin` `/unpin` | 非忙碌 | conversation-organization-controls.tsx:157 | ✅ | 会话行悬停“置顶” + 会话设置弹窗开关；置顶的会话在侧栏和文件夹里排在前面 | 02-19, 02-02 |
| F15 | 重命名 | 行菜单 | — | — | renameConversation | — | controls.tsx:174 | ✅ | **会话设置**弹窗（名称 / 置顶 / 归档） | 02-19 |
| F16 | 归档 / 恢复 | 行菜单、`view=archived` | 清理列表 | 确认、恢复 | `/archive` `/unarchive` | 运行中不可归档 | controls.tsx:180-297 | ✅ | 会话行悬停“归档” + 会话设置弹窗开关（运行中、等待批准时禁用并说明）；项目详情 **已归档** 分段找回 | 02-03, 02-19 |
| F17 | 新建会话 | 侧栏按钮、项目“+” | 开始工作 | 选运行位置（电脑）、项目、Agent、模型、推理 | createConversation；machine-query | 设备 available + projectAccess + providerExecution + 有项目位置 | new-conversation-dialog.tsx:80-205；new-conversation-provider-selection.ts | ✅ | 入口：侧栏按钮（Ctrl N，预选当前项目和文件夹）、侧栏文件夹行“+”、项目详情文件夹节、电脑详情。顺序 **项目 → 文件夹 → AI 工具 → 推理强度**（只在 Claude Code 显示）；不可用的文件夹说明原因；不显示模型选择（没有 descriptor 提供 `models`）；不带第一条消息 | 02-07, 02-08, 02-09, 03-04, 04-12 |
| F18 | 会话详情头部/状态 | `/conversations/$id` | 阅读 | — | getConversation + SSE | — | conversation-header.tsx | ✅ | 标题 + 状态 + **上下文条**（项目 › 文件夹 · AI 工具 · 推理强度） | 02-13…02-17 |
| F19 | 时间线、工具分组、Markdown、Diff/Shell 卡片 | 会话详情 | 理解 Agent 行为 | 展开 | detail + events | — | conversation-timeline.tsx；tool-grouping.ts | ✅ | 保留；阅读区最大宽 740 | 02-13 |
| F20 | 审批坞 | 会话详情底部 | 批准风险操作 | 允许一次 / 拒绝 | `/approvals/:id/resolve` | connected && supportsApprovals（仅本地 Codex） | pending-action-dock.tsx | ✅（本地 Codex） | 时间线内联审批卡，仅本地 Codex；远程会话不显示 | 02-13 |
| F21 | Composer 发送 | 会话详情 | 继续对话 | 输入、发送 | startTurn `{actionId, input}` | canCompose 门控 | composer.tsx；conversation-controls.ts:164 | ✅ | 能发送时才显示输入框；运行中、远程只读、离线时替换为**说明条 + 下一步**，不显示可用发送框。模型和推理强度只在新建时选 | 02-13, 02-16, 02-18 |
| F22 | 中断 | 顶栏 chrome | 停止 | — | `/interrupt` | 仅本地 Codex | conversation-chrome-actions.tsx | ◐ | 移到输入区的运行说明条里（“停止”），仅本地 Codex；其他情况写明不能停止，不放按钮 | 02-13, 02-16 |
| F23 | Inspector：文件/变更/工具输出 | 顶栏切换 | 查看改动 | 拖宽 | detail | supportsDiff / supportsToolOutput | inspector-panel.tsx:420 | ✅ | 右侧面板（文件 / 变更 / 输出）；变更只有本地 Codex，Claude Code 只有“文件”并说明原因；≤1000 变为浮层 | 02-14, 02-15, 02-17, 04-02 |
| F24 | 会话 Rail（同项目） | 会话详情左栏 | 切换 | 筛选、搜索、新建 | conversation-list-query | 同项目 | conversation-rail.tsx | ✅（基线未挂载，见审核 §2） | 不需要：侧栏树已经列出同一文件夹的会话，另有 Ctrl K | — |
| F25 | 失败卡 + 重试 | 时间线 | 恢复 | 重试（新 Turn）、跳转设备/项目、技术详情 | canonical failure | 部分原因不提供重试 | conversation-failure-card.tsx | ✅ | 保留，文案说明下一步 | 03-14 |
| F26 | 导入会话原生历史 | 会话详情 | 阅读旧历史 | 加载更早 | native-transcript | origin=adopted_native | conversation-detail-route.tsx:222 | ✅ | 上下文条标签“从 Codex / Claude Code 导入” | 03-15 |
| F27 | 演示会话 adapter | 非法 ID | 开发演示 | — | mocks | — | demo-conversation-adapter.ts | ✅（开发用） | 保留并标注“演示数据” | — |
| F28 | Inbox 列表/汇总/筛选 | `/inbox` | 处理事项 | 全部/审批/完成/失败 | attention-query | connected | inbox-page.tsx；inbox-summary.tsx | ✅ | **待处理**：分段带计数，替代汇总卡；侧栏角标同源；项目页顶部提示待处理数量 | 02-05, 03-08, 02-01 |
| F29 | Inbox 审批 | 审批项 | 决定 | 允许一次 / 拒绝 | resolve approval | Provider 支持审批 | inbox-item.tsx:148 | ✅ | 保留；不支持审批时显示说明而非按钮 | 02-05 |
| F30 | Inbox 完成待查看 / 失败 | 项 | 查看 | 查看结果 / 打开会话 / 知道了 | resolve attention | — | inbox-actions.ts:34-52 | ✅ | 保留，跳转到对应会话 | 02-05 |
| F31 | 已读/未读、稍后提醒 | — | — | — | — | — | — | ✕ | 不设计已读态（处理即移出）；列入后续规划 | 05-01 |
| F32 | 系统通知 | Desktop | 后台提醒 | 点击打开会话 | attention-notification-coordinator.ts；attention_notifications.rs | Desktop、窗口不在对应页 | desktop-notification-model.ts:109 | ✅ | 不变；设置 › 通知（说明通知不含会话标题） | 02-38 |
| F33 | 通知偏好 ×3 | `/settings` | 控制提醒 | 需要批准 / 工作完成 / 执行失败 | notification-preferences.ts | Desktop | desktop-notification-settings.tsx:128 | ✅ | **设置 › 通知**，3 个开关 | 02-38 |
| F34 | 后台运行说明 | `/settings` | 理解关闭行为 | 无开关 | backgroundRuntime.available | Desktop | desktop-notification-settings.tsx:115 | ◐（仅说明） | **设置 › 后台运行**，只写状态不给开关，文案对齐托盘真实行为 | 02-39 |
| F35 | 托盘 | 系统托盘 | 恢复/退出 | “打开 CodeTether”、“退出 CodeTether” | — | Desktop | system_tray.rs:38-59 | ✅ | 不变；设置 › 后台运行中说明 | 02-39 |
| F36 | 关闭到托盘 + 首次提示 | 窗口 ✕ / Alt+F4 | 后台继续 | — | — | — | host_supervisor.rs:1326；system_tray.rs:100 | ✅ | 不变 | — |
| F37 | 单实例 | 再次打开 | 恢复窗口 | — | — | — | host_supervisor.rs:1221 | ✅ | 不变 | — |
| F38 | 原生标题栏 | 窗口 | — | — | — | decorations:true，1440×900，最小 1100×700 | tauri.conf.json | ✅ | 设计提供**自定义标题栏**方案（mac 红绿灯 / Win 窗口控制、可拖动区），实现需改 decorations（02 §6 D5，可选） | 全部 |
| F39 | 开机启动 / Deep link | — | — | — | — | — | — | ✕ | 后续规划；设置 › 后台运行只放“查看后续规划”链接，不放开关 | 05-01, 02-39 |
| F40 | 设备列表 | `/machines`（“电脑”） | 找到电脑 | 打开详情、添加 | listMachines | connected | machines-page.tsx:31-261 | ✅ | **我的电脑**：卡片显示系统、本机/已配对/其他主机、连接状态、运行中数、会话数（来自 `GET /machines/:id` 最近 100 个，到上限显示“100+”）、AI 工具 | 02-20, 04-03, 04-09 |
| F41 | 本机详情 | `/machines/$id` | 查看本机 | Provider、项目、最近会话 | getMachine | — | machine-detail-page.tsx:269-511 | ✅ | **电脑详情**：左侧这台电脑上的会话（跨项目，最近 100 个），右侧 AI 工具 / 项目文件夹 / 连接三张卡 | 02-21, 02-22 |
| F42 | 远程设备详情 | 同上 | 查看远程 | 重试连接、刷新 Provider | getMachine | remote | machine-detail-page.tsx:545-1313 | ✅（没有会话列表） | 同上，配对电脑也显示会话列表；离线时顶部 notice + 上次在线时间（D4）；项目列表读取失败单独提示 | 03-09, 03-10, 03-20 |
| F43 | 添加远程电脑（配对） | 设备页“添加” | 连接另一台电脑 | 地址或 `codetether-pairing://` + 6 位码 → 核对验证码 → 完成 | begin/confirm/cancelRemoteMachinePairing | 单次一个信任变更 | add-remote-machine-dialog.tsx:50-506 | ✅ | **添加电脑** `/add` 选类型 → **CodeTether Node** `/add/node` 4 步（准备 → 输入 → 核对 → 完成） | 02-27, 02-29…02-32 |
| F44 | Relay 辅助首次配对 | Node 输出链接 | 跨网络配对 | — | relay rendezvous | 自动化测试，未宣称生产验证 | PHASE8D-RELAY-ASSISTED-FIRST-PAIRING.md | ◐ | 第 2 步输入框同时接受地址和配对链接，帮助文字说明 | 02-30 |
| F45 | 更新连接地址 | 设备详情 | 地址变化恢复 | 验证并保存 | updateMachineConnectionAddress | remote；recovery_required 提示 | update-machine-address-dialog.tsx | ✅ | 连接卡“更新地址”弹窗；离线 notice 也给入口 | 02-22, 03-09 |
| F46 | 取消配对 | 设备详情 | 撤销信任 | 确认 | unpairMachine | 无项目位置时 | unpair-machine-dialog.tsx | ✅ | 连接卡“取消配对”；还有项目文件夹时弹窗列出这些项目、不给确认按钮（与基线一致） | 02-24 |
| F47 | Internet Relay 配置/enroll/重试/断开/移除 | 设备详情 Relay 区 | 跨网络 | 配置、一次性令牌、重试、移除 | relay-actions.ts:111-152 | remote | machine-relay-section.tsx | ✅ | 连接卡只显示连接方式、地址、上次在线、权限。**缺口**：Relay 配置、一次性令牌、重试、移除没有画，实现保留并归入连接卡“高级” | 02-22 |
| F48 | Provider 安装选择 | 设备详情 | 选 CLI 安装 | 选择 | selectMachineProviderInstallation | — | provider-installation-selector.tsx | ✅ | **缺口**：电脑详情 AI 工具卡没有画安装选择，实现保留 provider-installation-selector | 02-21 |
| F49 | 安装 vs 执行健康 | 设备详情 | 判断可用 | — | providerDiscovery / executionHealth | current / last_known | machine-detail-page.tsx | ✅ | AI 工具行显示运行状况（正常 / 最近有异常 / 尚未运行过）和“上次已知”说明。**缺口**：安装状态没有单独表达，Figma 需补 | 02-21, 02-22 |
| F50 | 项目列表 | `/projects` | 浏览项目 | 打开、移除 | listProjects | — | projects-page.tsx；project-row.tsx | ✅ | **项目**（起始页）：卡片列出项目在各电脑上的文件夹（电脑、路径、会话数、不可用原因），顶部提示待处理数量；下面是其他主机的项目（仅查看） | 02-01, 03-01…03-03, 04-04 |
| F51 | 项目详情 + 位置 | `/projects/$id` | 管理 | 查看会话、新建、添加位置、移除项目 | getProject | — | project-detail-page.tsx；project-locations-section.tsx | ✅（不列会话） | **项目详情**：每个文件夹一节（电脑、可用性、路径悬停看全）和节内会话、“新建会话”；不可用时说明原因和下一步；底部“在另一台电脑上添加文件夹”“移除项目” | 02-02, 04-01, 04-05 |
| F52 | 添加项目（本机） | 项目页 | 登记文件夹 | 原生选择器 / 手输路径、名称 | createProject | Desktop 选择器 | add-project-dialog.tsx | ✅ | “添加项目文件夹”弹窗：选电脑 → 文件夹（本机用系统选择窗口或输入路径）→ 新项目或已有项目 | 02-10 |
| F53 | 添加远程位置 | 项目详情、配对电脑详情 | 远程登记 | 选设备 + 路径 | registerProjectLocation / createRemoteProject | remote 已配对 | add-project-location-dialog.tsx | ✅ | 同一个弹窗：从项目详情打开时项目固定，从电脑详情打开时电脑固定；配对电脑只能输入完整路径；每台电脑一个项目最多一个文件夹，没有可添加的电脑时说明 | 02-11, 02-23, 03-05 |
| F54 | 移除项目 / 移除位置 | 项目详情 | 清理 | 确认 | deleteProject / removeProjectLocation | 项目无会话（含已归档）；文件夹限配对电脑、非最后一个、无会话 | remove-project-*-dialog.tsx | ✅ | 项目详情“移除项目”卡 + 确认弹窗；配对电脑的文件夹节“移除文件夹” + 确认弹窗。仍有会话（含已归档）时弹窗预先说明不能移除，只给“知道了”（基线提交后才报错）。删除会话列入后续规划 | 02-12, 03-06, 03-07 |
| F55 | 导入以前的会话 | 添加项目后、设置步骤 | 继续旧会话 | 多选导入 | discover/adoptProviderSession | resumeStatus=supported | previous-conversations-step.tsx | ✅ | 首次启动“继续以前的会话”；添加项目文件夹后的入口保留（D13） | 02-44 |
| F56 | 远程 Linux Node | CLI `codetether-node` | 让服务器可被连接 | `--pair`、`service install` 等 | — | 本地操作 | apps/node/src/main.ts；service-installation.ts | ✅（无 UI） | 添加 Node 第 1 步给出命令 | 02-29 |
| F57 | Node 控制端恢复 | Node 本地 CLI | 凭据丢失 | `--controller` | — | 本地交互 | local-controller-recovery.ts | ✅（无 UI） | 交接说明，产品内不提供 | — |
| F58 | `/activity` 活动 | 路由占位 | — | — | — | — | router.tsx:93 | ✕ | 不进主导航；路由移除或重定向到 `/projects` | — |
| F59 | `/agents` 智能体 | 路由占位 | — | — | — | — | router.tsx:126 | ✕ | 能力并入电脑详情 › AI 工具卡；路由移除或重定向 | — |
| F60 | 组件 Showcase | 开发 | 视觉检查 | — | — | — | showcase/component-showcase.tsx | ✅ | 更新为新组件（浅色 + 深色） | components.css；00-overview |
| F61 | 主题 / 语言 | — | — | — | — | — | apps/web/src/main.tsx:15 `dataset.theme = 'dark'` | ✕（仅深色、仅中文） | **设置 › 外观**：浅色 / 深色 / 跟随系统（新增范围，D11）；语言只说明“简体中文”，不给切换 | 02-35, 06-01…06-12 |
| F62 | 账号登录（邮箱登录码） | `/hosts` 页内（英文） | 发现其他主机 | 发送登录码、验证、退出 | Supabase OTP | 需配置账号服务 | host-directory-page.tsx | ✅ | **设置 › 账号与共享** + 登录页 `/signin`（中文）；我的电脑页未登录时给出登录入口 | 02-33, 02-34, 02-36, 03-13, 03-17 |
| F63 | 本机作为主机 | `/hosts` Host capability 卡 | 允许其他电脑只读查看本机 | 启用、完成设置 | local host lifecycle | 已登录 | host-directory-page.tsx | ✅（平台文字硬编码 macOS） | 账号与共享 › “这台电脑”；按实际平台显示（D9） | 02-36, 02-37, 03-18 |
| F64 | 其他主机列表 | `/hosts` My Hosts | 找到同账号下的电脑 | 打开、申请、取消、重新申请、重试 | listAuthorizedHosts / listOwnedHosts | 已登录 | host-directory-page.tsx | ✅ | **我的电脑**中的其他主机卡片（访问、连接分开表达）；“添加电脑 › Mac 或 Windows 电脑”说明流程 | 02-20, 02-26, 02-28, 03-11, 03-12 |
| F65 | 其他主机只读查看 | `/hosts/$hostId` | 查看 Machine、项目、会话和运行中输出 | 浏览、实时查看 | remote-supervisor（supervisor_read） | access=authorized 且在线 | remote-host-page.tsx | ✅ | **主机详情** `/computers/:hostId` + 侧栏“其他主机 · 仅查看”+ 统一会话页的只读模式；没有输入框，底部只读说明 | 02-25, 02-18, 03-16, 04-08, 04-10, 06-07 |
| F66 | 访问申请处理（主机方） | `/hosts` PendingAccessRequestPanel | 批准或拒绝 | 允许、拒绝 | control-plane，30 秒轮询 | 本机已作为主机 | host-directory-page.tsx | ✅（无撤销、无通知） | 设置 › 账号与共享的申请行（拒绝 / 允许）；我的电脑页顶部同时提示 | 02-36, 02-20 |
| F67 | supervisor_control（远程发送/新建） | `/hosts/$hostId`（仅 control 时出现） | — | — | `/api/v1/supervisor/control/approve` | 控制面不签发 | apps/host；remote-host-page.tsx:215, 407 | ◐ 后端存在、出厂不可达 | 后续规划 | 05-01 |
| F68 | 撤销已授权设备 / 访问申请通知 | — | — | — | — | — | — | ✕ | 后续规划；设置中写明“已批准的设备暂时不能在这里撤销” | 05-01, 02-36 |

## 旧入口 → 新入口

| 旧入口 | 新入口 | 说明 |
|---|---|---|
| `/` → `/hosts`（My Hosts，英文） | `/` → **项目** `/projects` | 首次启动完成后也进入项目（基线进入所选项目或 `/inbox`） |
| 侧栏“My Hosts” | 去掉；拆到 **我的电脑** 和 **设置 › 账号与共享** | |
| 侧栏“收件箱” | 主导航 **待处理** `/inbox` | 带计数 |
| 侧栏“电脑” | 主导航 **我的电脑** `/computers` | 本机、配对电脑和其他主机在同一页 |
| 侧栏项目树（项目 › 会话，一次展开一个） | 侧栏 **项目 › 文件夹 › 会话**，可同时展开多个，置顶在前 | 另有“其他主机 · 仅查看” |
| `/projects/$id`（不列会话）+ `/projects/$id/conversations`（按 Agent 分组） | 合并为 **项目详情** `/projects/:id`，按文件夹分节列出会话 | 旧 URL 保留为重定向 |
| `?view=archived` | `/projects/:id?view=archived`（项目详情 › 已归档） | |
| `?q=` | 项目内搜索 `/projects/:id/search?q=` | |
| 顶栏“检查状态” | 设置 › 关于与检查 | |
| 顶栏中断按钮 | 输入区运行说明条里的“停止”（仅本地 Codex） | |
| `/settings`（常规/通知） | 设置：外观 / 账号与共享 / 通知 / 后台运行 / 关于与检查 | 后续规划单独一页 `/roadmap` |
| 添加远程电脑弹窗 | **添加电脑** `/add`（选类型）→ **CodeTether Node** `/add/node` 4 步 | Node 命令、地址、6 位码只出现在 Node 流程 |
| `/hosts`（My Hosts，英文） | **我的电脑**（其他主机卡片）+ **设置 › 账号与共享** + 登录页 `/signin` | 登录、共享这台电脑、申请访问分开表达 |
| `/hosts/$hostId`（三栏浏览器 + 自己的输入框） | 主机详情 `/computers/:hostId` + 统一会话页的只读模式 | 旧 URL 保留为重定向；supervisor_control 签发前不显示新建和输入框 |
| `/machines`、`/machines/$id` | `/computers`、`/computers/:id` | 旧 URL 保留为重定向 |
| Machine 详情 Relay 区 | 电脑详情 › 连接卡（高级项见 F47 缺口） | |
| `/agents`、`/activity`（占位页） | 无（移除或重定向到 `/projects`） | |
| `/conversations/$id` | 会话详情（原型 `#/c/:id`） | 保留 URL |

## 前端审核（基线 bbcda69 的 apps/web）

方法：只读代码，没有运行生产应用、Tauri 外壳或测试。分三类：主流程的摩擦点；前端有入口但后端不支持或没接线；后端已支持但前端没用上。

### 1. “打开应用 → 选项目或文件夹 → 开始或继续”的摩擦点

| # | 基线现状 | v3 处理 | 需要后端？ |
|---|---|---|---|
| 1 | 启动进入英文、需要登录的 My Hosts（startup-gate.tsx:59）；其中本机的“打开”进入电脑页，不是项目 | 启动进入项目；去掉 My Hosts | 否 |
| 2 | 项目详情不列会话，要再点一次进入单独路由 | 项目详情直接按文件夹列出会话 | 否 |
| 3 | 侧栏每个项目最近 4 条，一次只展开一个项目，置顶不优先 | 项目 › 文件夹 › 会话，可同时展开，置顶在前，当前会话总是可见 | 否 |
| 4 | 会话按 Agent 分组，行内不显示电脑；列表到 100 条为止，提示“其余历史将在后续分页能力中提供”（conversation-page-states.tsx:136） | 按文件夹（= 电脑）分组；超过 100 条时说明并引导用项目内搜索（有游标） | 真正的分页需要 Host 加游标 |
| 5 | 新建对话框里“运行位置”在项目之后，却悄悄过滤项目列表；改电脑会重置项目、Agent、模型 | 顺序 项目 → 文件夹 → AI 工具 → 推理强度；不可用的文件夹列出来并说明原因 | 否 |
| 6 | 用词不一致：等待 / 需要处理；Agent / 智能体 / AI 工具 | 统一为 等待批准、AI 工具、电脑、文件夹 | 否 |
| 7 | 运行中 Composer 锁定，中断只在顶栏 | 输入区换成说明条，“停止”放在说明条里（仅本地 Codex）。排队和补充指令没有后端，不做 | 排队 / 补充指令需要 Host |
| 8 | 两套会话界面：本地会话页，和 `/hosts/$hostId` 的英文三栏浏览器（自带新建表单和输入框） | 一个会话页；其他主机的会话用只读模式 | 否 |
| 9 | 没有跨项目搜索和命令面板；顶栏搜索、铃铛、头像有 props 但没接线，不渲染（top-bar.tsx:152-235） | Ctrl K 只按标题筛选已读取的会话并跳转；铃铛并入待处理；头像移到侧栏底部。跨项目搜索列入后续规划 | 跨项目搜索需要 Host |
| 10 | 配对电脑上的文件夹只能手输完整路径 | 保持手输，说明原因；“浏览远程文件夹”列入后续规划 | 需要 Node / Host |

### 2. 前端有入口，但后端不支持或没接线

- `/activity`、`/agents` 是占位页（“此页面尚未实现。”，router.tsx:93、126），导航里没有入口。v3 移除或重定向。
- 顶栏 ⌘K、铃铛、头像组件存在但 app-shell 没传 props，不渲染。
- `ConversationRail`（conversation-rail.tsx）和 `InboxFilters` 组件存在但没有挂载。
- `/hosts/$hostId` 的新建表单和输入框只在 `session.control === 'control'` 时出现（remote-host-page.tsx:215、407），而控制面只签发 supervisor_read，出厂时用户只能看到英文的“Remote control not authorized”（836）。v3 不画这部分，列入后续规划。
- 非法会话 ID 会显示演示数据（conversation-detail-route.tsx:135-156）。生产实现应显示“找不到这个会话”，或至少明确标为演示数据。

### 3. 后端已支持，前端没用上

- `GET /projects/:id/conversations` 已带 `machineId`，可以直接按文件夹分组；基线项目详情不列会话，会话行也不显示电脑。
- `GET /machines/:id` 带这台电脑最近 100 个会话；基线只有本机详情显示“最近会话”，配对电脑详情没有。v3 两者都显示。
- Host 支持 `status=failed` 筛选；基线会话页没有“失败”分段。v3 有。
- 移除项目或文件夹前，用现有的 `allProjectConversationsQueryOptions`（`archived: 'all'`）就能预先判断能不能移除；基线提交后才报错。

### 4. v2 原型超出后端的部分（v3 已收回）

v2 把项目树移出侧栏，改成跨项目的“最近 8 条”、首页汇总、“全部会话”页和全局搜索页，另有按电脑筛选。这些都要前端合并多个项目的列表或新增 Host 接口（没有跨项目列表和搜索，列表也不能按电脑筛选），还让会话离开了所属的文件夹。v3 改回以项目为起点：会话始终在 项目 › 文件夹 下，搜索限定在项目内，跨项目搜索列入后续规划。

更正：上一版清单把基线启动后的去向写成 `/inbox`（实际为 `/hosts`），并把 Composer 写成可以选模型和推理强度（实际只有输入和发送，模型和推理只在新建时选）。本版已改正。

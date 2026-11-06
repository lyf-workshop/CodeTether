# 08 · 远程管理（B4）

日期：2026-11-05。依据：07 §6、03 §4 的 B4、04 的 P1 / P2 / P5 / P6 / P9 / C3 / C4、`main` `b668e53` 的代码。

B4 让平板和 iPad 能做电脑上剩下的那些管理操作：浏览文件夹、添加和移除项目、找出并导入以前的会话、项目内搜索、置顶、重命名、恢复。界面在 T1b 和 I1 里做，B4 只做后端和电脑上的浏览入口。

## 1. 用的人看到什么

界面按 07 的原型。B4 定的是每个操作的行为和提示，不是新的布局。

### 平板和 iPad

- **添加项目**（07 的 03-07 至 03-09）：选设备 → 浏览文件夹 → 名称 → 找到以前的会话，勾选导入。
  - 打开时停在这台电脑的用户目录，只显示文件夹，不显示文件。点一个文件夹进去，点“上一级”回到上一层；往上可以一直到磁盘根目录，Windows 上再往上是各个盘。
  - 打不开的文件夹，点进去只说原因（没有权限，或者读取超时），不报错弹窗。能不能在列表里提前标出“无法打开”，等 Mac 实测（§3.3）再定。隐藏文件夹默认不显示，有一个“显示隐藏文件夹”的开关。
  - 名称默认用文件夹名，可以改。
- **以前的会话**：添加项目的最后一步和项目页里都能用。扫描时显示“正在查找以前的会话”，可以取消。结果按 AI 工具分组，每条显示标题、上次使用、能不能继续、是不是已经导入过。勾选后导入，已经导入过的不能再勾。
- **项目页**（07 的 03-04 至 03-06）：
  - “会话 / 已归档”两个分段。置顶的排在最上面，其余按最近活动排序。
  - 项目内搜索按标题和你发过的内容找，结果带一段匹配的文字。
  - 移除项目要确认。有会话的项目不能移除，提示“这个项目还有会话，先归档或在电脑上处理后再移除”，不提供强制删除。
- **会话的更多菜单**：置顶、取消置顶、重命名、归档、恢复。归档 B1 已经做了，B4 补另外几项。
- 这些操作对经由电脑访问的设备同样可用，浏览和扫描都发生在那台设备上。

### 电脑上（04 P9）

- 给配对设备添加项目时，现在只能输入完整路径（`apps/web/src/components/projects/add-project-fields.tsx:193`）。B4 改成和本机一样可以浏览，手动输入完整路径保留，作为浏览的补充。
- 本机添加项目继续用系统的文件夹选择窗口，不改。

### 文案

沿用 06 §1：界面上不出现 Host、Node（E1 之后）、Machine、ProductDevice、Supervisor、Relay、授权、grant、指纹。错误只说发生了什么、怎么办：

- “打不开这个文件夹。请在 Mac 上允许 CodeTether 访问，然后重试。”（macOS 上没有权限）
- “Mac 上可能弹出了授权窗口。请在 Mac 上点“允许”，然后重试。”（macOS 上读取超时）
- “没有权限打开这个文件夹。”（其他系统上没有权限）
- “这个文件夹读取超时，可能是网络盘。可以重试。”（其他系统上读取超时）
- “这台电脑正在等其他文件夹的授权或读取，请稍后再试。”（浏览名额占满，见 §3.3）
- Node 的授权窗口上写的名字可能不是“CodeTether”，上面两句 macOS 的文案等实测问题 6 再定。
- “这个文件夹已经添加过了，请打开已有项目。”
- “这个项目还有会话，不能移除。”
- “查找结果过期了，请重新查找。”
- “这台电脑现在连不上，请确认它开着并且联网。”
- “这台设备没有使用这台电脑的权限。”（只有查看权限的设备）

## 2. 现在的代码（`main` `b668e53` 上核实）

- **远程操作走 Supervisor**。请求是 `supervisor.request`，按 `operation` 区分，协议版本 1（`packages/supervisor-transport/src/protocol.ts:417`）。B1 的操作在 `supervisorB1OperationSchema`（同文件 :372），本机对应的执行在 `apps/host/src/api/supervisor-operations.ts:71` 的 `executeSupervisorB1Operation`。
- **权限只有一种**。连接时的授权范围是 `supervisor_read` 或 `supervisor_control`（`packages/supervisor-transport/src/server.ts:54`）。控制操作在 `isSupervisorControlOperation`（同文件 :710）里列出，没有控制权限就抛 `operation_not_allowed`（:539）。
- **变更都带 `actionId`**，格式 `act_` 加 6 到 96 个字符（`packages/protocol/src/ids.ts:63`）。Host 的 `#executeAction` 按 actionId 去重：同一个 actionId 配同样的内容直接返回上次的结果，配不同的内容报冲突。作用域是每个操作自己的，见 §3.1。
- **响应帧**（`protocol.ts:517`）只有 `ok`、`data`、`code`、`httpStatus`。`code` 只有 8 个值：`invalid_request`、`operation_not_allowed`、`not_found`、`conflict`、`unsupported`、`unavailable`、`session_expired`、`internal`。`httpStatus` 只允许 409 或 422，而且只在 `code` 是 `unsupported` 时出现（:542）。
- **错误被压扁了**。失败响应在 `server.ts:646` 构造，只带 `code` 和（仅 `unsupported` 时的）`httpStatus`。`supervisorReadErrorCode`（`server.ts:803`）按码名认 6 个值，外加 `runtime_unavailable` 和 `provider_unavailable` 映射成 `unavailable`，其余全部变成 `internal`。它不看 HTTP 状态。所以 `project_has_conversations`、`conversation_archived`、`machine_unreachable` 这些本机已经有的原因，远程都看不到。B3 要把发送失败的原因透出来（03 §4 的 B3），B4 用同一套办法，见 §3.2。
- **大小限制**：
  - 手机和平板的 Rust 核心每个请求不超过 16 KiB，单次等待 8 秒（`packages/supervisor-mobile/src/wire.rs:13-14`）。响应结构 `Response`（:571）用了 `deny_unknown_fields`，但 `data` 是不检查内容的 `Value`，所以返回里加字段不会让旧版本的核心解析失败；请求侧的 `Operation`（:652）由 Kotlin 传来的 JSON 解析（`lib.rs:140`），枚举带 `deny_unknown_fields`（:650），未知操作和未知字段都会被拒绝。核心和 Kotlin 打在同一个安装包里，旧版本发不出新操作和新字段，这是预期的。
  - 服务端帧上限 256 KiB（`packages/supervisor-transport/src/constants.ts:12`），但返回的行数据被压到 12 KiB 以内（`supervisor-operations.ts:20` 的 `maximumRowsBytes`）。
  - 电脑和 Node 之间的帧上限是 16 KiB（`packages/machine-transport/src/constants.ts:26`）。
- **会话目录缺置顶**。`SupervisorConversationDirectoryItem`（`apps/host/src/persistence/conversation-store.ts:265`）没有 `pinnedAt`，`listSupervisorConversations`（:3403）的查询也不取 `pinned_at`，排序只按 `last_activity_at`。本机侧栏是置顶优先的（`apps/web/src/components/app-shell/workspace-sidebar-model.ts:128`）。
- **本机已有、远程还没有的**：
  - 添加项目：`createProject`（`host-service.ts:3266`）和 `createRemoteProject`（:2393），请求都是 `actionId`、可选 `name`（1 到 240）、`path`（1 到 4096）（`packages/protocol/src/commands.ts:79`、:93）。
  - 移除项目：`deleteProject`（`host-service.ts:3290`）。有会话（含已归档）或有进行中的操作时拒绝，原因 `project_has_conversations`（`host-service.ts:10009`）。
  - 扫描以前的会话：`discoverProviderSessions`（`host-service.ts:2569`）。一次最多扫 60 秒、100 页（`host-service.ts:299-300`）；同一个项目、设备、AI 工具、路径的扫描会合并成一次（:6269 的 key）；结果快照保留 5 分钟、最多 4000 条（`provider-session-discovery-registry.ts:24-26`）；过期的游标报 `provider_session_candidate_expired`（`host-service.ts:2596`）。
  - 导入：`adoptProviderSession`（`host-service.ts:2707`），用 `candidate_` 开头的短期引用，不暴露 AI 工具自己的会话编号。
  - 搜索：`searchProjectConversations`（`host-service.ts:2524`）。查询最多 256 个码元、160 个字素；每页默认 25、最多 100；匹配文字最多 1024 个码元、160 个字素；游标以 `csc_` 开头、最多 2048（`packages/protocol/src/conversation-search.ts:10`）。
  - 置顶、取消置顶、重命名、恢复：`pinConversation`（:3108）、`unpinConversation`（:3127）、`renameConversation`（:3088）、`unarchiveConversation`（:3176）。标题 1 到 240 个码元、最多 160 个字素，会先做 NFC 规范化（`packages/protocol/src/records.ts:49`）。
- **项目没有重命名**。本机只有会话重命名（`local-http-server.ts:1808` 的 PATCH 只改会话标题），没有项目重命名的接口。07 §4 的项目页写了“重命名和移除”，其中的重命名指会话，不指项目。B4 不做项目重命名。
- **文件夹浏览是新的**。本机用系统选择窗口（`apps/desktop/src-tauri/src/project_directory_picker.rs:4`），Node 侧只有单个路径的校验 `project_location.validate`（`packages/machine-transport/src/messages.ts:439`，处理在 `apps/node/src/node-service.ts:740`），没有列目录的能力。
- **电脑操作另一台电脑**走 `POST /api/v1/remote-supervisor/sessions/:id/operations`（`local-http-server.ts:676`），请求体用 `supervisorB1OperationSchema` 校验。桌面端的远程客户端在 `apps/web/src/runtime/account/remote-supervisor.ts`。

## 3. 怎么实现

门控、`actionId` 幂等、忙碌时的冲突、运行中不能归档，全部和本机一致，和 06 §3.6 同一条规则。

### 3.1 新增远程操作

全部要求控制权限，加进 `isSupervisorControlOperation`。只读的浏览和搜索也算控制操作：能看文件夹本身就是新开放的能力，不能让只有查看权限的设备用。

| 操作                         | 作用                             | 复用                                                                |
| ---------------------------- | -------------------------------- | ------------------------------------------------------------------- |
| `folder.list`                | 列一台设备上一个文件夹的子文件夹 | 新的。本机直接读，经由电脑访问的设备走 §3.5 的新消息                |
| `project.create`             | 添加项目                         | 本机设备用 `createProject`，其他设备用 `createRemoteProject`        |
| `project.remove`             | 移除项目                         | `deleteProject`                                                     |
| `provider-sessions.discover` | 查找以前的会话                   | `discoverProviderSessions`，但改成 §3.4 的短等待加轮询              |
| `provider-sessions.adopt`    | 导入一条以前的会话               | `adoptProviderSession`                                              |
| `conversation.search`        | 项目内搜索                       | `searchProjectConversations`，返回按 12 KiB 截断                    |
| `conversation.pin`           | 置顶或取消置顶                   | `pinConversation` / `unpinConversation`，请求里带 `pinned: boolean` |
| `conversation.rename`        | 重命名会话                       | `renameConversation`，标题用 `ManualConversationTitleSchema`        |
| `conversation.restore`       | 恢复已归档的会话                 | `unarchiveConversation`                                             |

另外改一个已有的读取：`conversation.list` 的每一项加上 `pinnedAt`（没有置顶就不带这个字段），并新增可选的 `archived` 过滤（`active`、`archived`、`all`，**默认 `all`**）。默认必须是 `all`：现在的 `conversation.list` 不区分归档，T1a 的项目页拿到全部会话后在客户端自己过滤（`apps/android/app/src/main/java/org/codetether/app/remote/RemoteSupervisor.kt:116`），默认改成 `active` 会让已经装上的版本漏掉已归档的会话。排序改成和本机侧栏一样：置顶的在前，按置顶时间倒序，其余按最近活动倒序。

旧版本不受影响，但原因要说准确：

- 返回侧：Rust 核心的 `Response`（`wire.rs:571`）用了 `deny_unknown_fields`，帧上多一个字段会让它解析失败；它能容忍的是 `data` 里面多字段，因为 `data` 是不检查内容的 `Value`，Kotlin 侧用 `org.json`，多一个 `pinnedAt` 会被忽略。
- 请求侧：旧版本的 `conversation.list` 本来就没有 `archived` 这个字段，发出的请求不带它，靠服务端的默认值 `all`。`Operation` 从 Kotlin 传来的 JSON 解析（`lib.rs:140`），未知操作和未知字段都拒绝（`wire.rs:647-651`），所以 Kotlin 要传 `archived`，核心必须同时加上这个字段；两者在同一个安装包里，一起升级。

T1b 和 I1 之后的版本再传 `archived`，不必再整页取回来自己滤。

变更类操作的 `actionId` 规则和本机相同：

- `project.create` 的作用域按目标设备分。本机设备走 `createProject`，作用域是全局的 `'project.create'`（`host-service.ts:3266`）；其他设备走 `createRemoteProject`，作用域是 `project.remote.create:<machineId>`（:2393）。重复提交返回同一个项目。
- `project.remove` 的作用域是 `project.delete:<projectId>`（`host-service.ts:3290`）。
- `provider-sessions.adopt` 的作用域是 `provider.session.adopt:<projectId>:<machineId>`，和 `adoptProviderSession`（`host-service.ts:2719`）一致。
- `conversation.pin`、`conversation.rename`、`conversation.restore` 的作用域是会话，和本机的 `pinConversation`、`renameConversation`、`unarchiveConversation` 一致。

#### 没收到结果时怎么办

B4 的写操作不能用 `action.get` 查结果。`action.get` 只查发消息的 actionId（`apps/host/src/api/supervisor-transport-manager.ts:322` 调的是 `getTurnForStartAction`），其他 actionId 一律返回 `not_found`。B4 不扩展 `action.get`：那要把每个 actionId 的结果存进数据库，需要新的迁移，换来的只是重发能做到的事。

Host 的去重记录在内存里（`apps/host/src/api/action-idempotency-cache.ts`）：最多 256 条，满了先挤掉最早结束的，Host 退出时清空，失败的结果也会记住。所以客户端按下面两条处理：

- **没收到响应**（8 秒超时、连接断了）：用同一个 actionId 重发。Host 没重启、记录没被挤掉时，返回第一次的结果，包括第一次的失败。
- **收到了明确的失败**（`ok: false`）：同一个 actionId 重发只会拿回同一个失败。用户点重试时换一个新的 actionId。

Host 重启过或者记录被挤掉时，重发会再执行一次。所以每个写操作再执行一次必须安全，而且结果能看懂：

- `project.create`：同一个文件夹返回已有项目，`created: false`。
- `project.remove`：第一次已经删掉的，第二次返回 `not_found`。客户端在“重发移除”时收到 `not_found`，按已经移除处理。
- `provider-sessions.adopt`：返回 `already_adopted`。
- `conversation.pin`：请求带的是目标状态 `pinned`，不是“切换”，执行几次结果都一样。`conversation.rename` 同理，标题相同。
- `conversation.restore`：会话已经是未归档时返回成功和当前会话。执行代理要核对 `unarchiveConversation` 现在是不是这样；如果它对未归档的会话报错，在 Supervisor 这一层把这种情况当成功，不改本机接口。

#### 每个操作的请求和返回

请求都是 `supervisor.request` 的形状，下面只列各操作自己的字段。返回都放在响应帧的 `data` 里。

`folder.list`（只读，但仍要求控制权限）：

- 请求：`machineId`、可选 `path`、可选 `cursor`、可选 `includeHidden`（默认 `false`）。
- 返回：`path`、`status`、可选 `parent`、可选 `drives`，`status` 是 `readable` 时再带 `folders`、`skipped`、可选 `nextCursor`。字段含义见 §3.3。

`project.create`：

- 请求：`machineId`、`actionId`、`path`（1 到 4096 字节）、可选 `name`（1 到 240 个码元）。
- 返回：本机设备用 `CreateProjectResponse` 的 `data`，即 `{project, created}`；其他设备用 `CreateRemoteProjectResponse` 的 `data`，即 `{project, location, created}`。`created` 为 `false` 表示这个文件夹已经添加过，返回已有项目，不报错。

`project.remove`：

- 请求：`projectId`、`actionId`。
- 返回：`{projectId}`。

`provider-sessions.discover`：

- 请求：`projectId`、`machineId`、可选 `provider`、可选 `cursor`、可选 `limit`（默认 50，最大 100）、可选 `rescan`（默认 `false`）。
- 返回：`status`（`scanning` 或 `complete`）。`complete` 时再带 `candidates`、`providers`、可选 `nextCursor`，字段和本机的 `DiscoverProviderSessionsResponse` 相同。`scanning` 时不带候选项。

`provider-sessions.adopt`：

- 请求：`projectId`、`machineId`、`actionId`、`discoveryCandidateId`。
- 返回：`{conversation, disposition}`，`disposition` 是 `adopted` 或 `already_adopted`。

`conversation.search`：

- 请求：`projectId`、`query`（1 到 256 个码元、最多 160 个字素）、可选 `archive`（`active`、`archived`、`all`，默认 `active`）、可选 `provider`、可选 `status`、可选 `cursor`、可选 `limit`（默认 25，最大 100）。
- 返回：`results`、`hasMore`、可选 `nextCursor`，和本机的 `ConversationSearchResponse` 相同。

`conversation.pin`、`conversation.rename`、`conversation.restore`：

- 请求都带 `machineId`、`projectId`、`conversationId`、`actionId`。`conversation.pin` 另加 `pinned`（`true` 置顶，`false` 取消）。`conversation.rename` 另加 `title`。
- 返回都是 `{conversation}`，`conversation` 用 `ConversationSummary`。
- 这三个操作先调用 `getSupervisorConversation(machineId, projectId, conversationId)` 校验这条会话属于这台设备和这个项目，和 B1 的会话操作一样。

### 3.2 错误怎么报

响应帧不加字段。`supervisorResponseSchema`（`protocol.ts:517`）和 Rust 核心的 `Response`（`wire.rs:571`）都拒绝未知字段，帧上加 `reason` 会让所有现有客户端解析失败。原因放在失败响应的 `data` 里：`data` 在 schema 里是 `z.unknown()`，在 Rust 里是 `Value`，都不检查内容。现在的失败响应（`server.ts:646`）不带 `data`，这是给失败响应补上 `data`，不是改帧的形状。

- `code` 按 Host 的错误码归类，不按 HTTP 状态。现有的 `supervisorReadErrorCode`（`server.ts:803`）是按码名认的，兜底是 `internal`，不是按状态归类。B4 的映射是新规则：

  | Host 错误码                                                                                                                                                                                                  | `code`            |
  | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
  | `not_found`、`project_location_not_found`、`project_location_missing`                                                                                                                                        | `not_found`       |
  | `conflict`、`project_has_conversations`、`project_location_conflict`、`project_location_has_conversations`、`project_location_local_required`、`conversation_archived`、`provider_session_candidate_expired` | `conflict`        |
  | `invalid_request`、`project_location_invalid`                                                                                                                                                                | `invalid_request` |
  | `runtime_unavailable`、`provider_unavailable`、`machine_unreachable`、`machine_connection_failed`、`provider_session_discovery_unavailable`                                                                  | `unavailable`     |
  | 其余                                                                                                                                                                                                         | `internal`        |

- 失败时 `data` 带 `reason`，取值是 Host 的 `HostErrorCode`（`packages/protocol/src/errors.ts:61`）。不在 `HostErrorCode` 里的原因不传，只留 `code`。
- 本机有三处把路径问题报成 `invalid_request`，真正的原因在 `failure.reason` 里是 `project_location_invalid`（`host-service.ts:10022`、:9899）。`data.reason` 在 `code` 是通用码（`invalid_request`、`conflict`、`unavailable`）时，回退到 `failure.reason`，这样客户端能区分“路径不合法”和“请求格式不对”。`failure.reason` 不在 `HostErrorCode` 里时不回退。
- 不传 `message`。那是给开发者看的英文句子，界面文案由客户端按 `reason` 决定。
- 执行还没开始就失败的才这样报。已经开始执行、结果不确定的仍报 `internal`，客户端继续按“结果不确定”处理，这条和 B3 的约定相同。
- B3 的发送失败也用这个 `data.reason`，两边不要各做一套。谁先做谁把 `supervisorReadErrorCode` 的这层映射提出来共用。

### 3.3 浏览文件夹

`folder.list` 的请求：

- `machineId`：在哪台设备上列。
- `path`：可省略。省略时列起点：有用户目录就列用户目录，否则列根。Windows 的根是各个盘，其他系统的根是 `/`。
- `cursor`：可省略，续上一页。
- `includeHidden`：默认 `false`。

路径规则：

- 必须是绝对路径，最长 4096 字节，不能含 NUL，和 `RemoteProjectLocationPathSchema`（`packages/machine-transport/src/messages.ts:263`）同一条边界。
- 先规范化再读。符号链接按它指向的真实位置算，返回里带规范化后的 `path`，客户端下一层用这个值，不自己拼。
- 不限制在项目目录里。可以浏览所有文件夹是 2026-11-04 定的：有控制权限的设备本来就能让 AI 工具在这台电脑上执行命令，列目录没有放宽它已有的能力；Relay 只转发加密的流，看不到内容。

返回：

- `path`：这一层规范化后的路径。起点那一次是用户目录或空字符串（空字符串表示列的是根）。
- `parent`：上一层的路径。已经在根上时不带。
- `drives`：只有列根而且是 Windows 时带，每项是 `letter`（如 `C:`）和可选的 `label`。
- `status`：这一层本身读没读到，三种分开返回：`readable`（读到了）、`access_denied`（没有权限）、`timeout`（3 秒内没读完）。只有 `readable` 带 `folders`、`skipped`、`nextCursor`。三种都是成功的响应（`ok: true`），不走 §3.2 的失败：点进一个打不开的文件夹是正常结果，界面只说原因（§1）。这样也不用为“没有权限”新造一个 `HostErrorCode`。
- `folders`：每项是 `name`、`hidden`。列一层时不打开子文件夹（见下面“不能拖住其他读写”），所以子文件夹上不带能不能打开，点进去由那一层的 `status` 说明。能不能在列表里提前标出来，等 Mac 实测的问题 1。
- `nextCursor`：还有下一页时带。

数量和大小：

- 一层最多返回 200 个文件夹，同时按字节截断，先到哪个算哪个。单个名字最长 255 字节，超出的跳过并计数。
- 返回里带 `skipped`：被跳过的条目数，包括名字超长的和不支持的文件名（Windows 上不是合法 Unicode 的）。客户端只在 `skipped` 大于 0 时显示“还有一些文件夹没能显示”。
- 字节预算按返回给谁算。返回给手机和平板时，行数据沿用 12 KiB。返回给 Node 再转回电脑时，整帧不能超过电脑和 Node 之间的 16 KiB：`path` 和 `parent` 各可到 4096 字节，外壳另计，所以这一路的行数据预算要按 16 KiB 减去路径和外壳来算，不能照搬 12 KiB。
- 游标不编码路径。路径可到 4096 字节，编码进游标会让游标本身超限。游标是服务端签发的短引用，格式 `fld_` 加一段，校验它对应的路径和 `includeHidden` 一致后继续。游标只在同一次列表里有效，服务端不长期保存列表状态，过期后重新从这一层的开头列。

读取行为：

- 读一层的超时是 3 秒。超时返回 `status: timeout`，没有权限返回 `status: access_denied`。起点也一样，不让请求失败。
- 隐藏文件夹的判断：名字以 `.` 开头的，加上 Windows 上带隐藏属性的。默认不返回，`includeHidden` 为真时返回并标 `hidden: true`。Windows 上怎么判断隐藏，见 §6 第 4 项。

不能拖住其他读写：

- Node.js 的文件操作、`dns.lookup`、部分加密和压缩共用 libuv 线程池，默认 4 个线程，整个进程共用，`worker_threads` 也共用这一个池。一次卡在授权窗口或断开的网络盘上的读取会一直占着一个线程。3 秒超时只是不再等它，线程收不回来，要等系统调用自己返回。
- 4 个都卡住时，同一进程里的其他文件读写、查找以前的会话都会停下。连 Relay 和账号服务时的域名解析走 `dns.lookup`，也会停下，平板就连不上这台电脑，连超时的提示都看不到。
- 所以：
  - 列一层只对这一层做一次目录读取，不打开子文件夹。符号链接要 `stat` 一次才知道指向的是不是文件夹，这次 `stat` 也算一次读取。
  - 浏览单独限流：Host 和 Node 各自同时最多 2 个还没返回的浏览读取。超时后还没返回的仍然占着名额，直到系统调用真正返回。留下 2 个线程给其他读写；一个文件夹在等授权时，还能浏览别的文件夹。
  - 同一个规范化路径已经有一个没返回的读取时，不再发起第二个，直接返回 `status: timeout`。
  - 名额占满时，新的浏览请求立刻失败，`code: unavailable`、`reason: runtime_unavailable`，不排队。客户端显示“这台电脑正在等其他文件夹的授权或读取，请稍后再试。”
  - 不靠调大 `UV_THREADPOOL_SIZE` 解决：调大只是让卡住的读取多攒几个才出事，线程还是收不回来。
  - 不用单独的进程去读：Host 和 Node 都是 Node SEA，每列一层拉一个子进程要多花上百毫秒；在 macOS 上还多出一个要单独验证授权归属的进程。
- 列盘符同样不能逐个去读：断开的网络盘会让读取卡住，见 §6 第 4 项。

macOS 的授权窗口（待实测，先不定稿）：

- 第一次读“桌面”“文稿”“下载”这类受保护的文件夹时，系统会在 Mac 上弹授权窗口。读操作会不会一直阻塞到人点完、拒绝后再读是立刻失败还是再弹一次、只看文件夹属性会不会弹窗，都还没在 Mac 上验证。
- 在实测结果出来之前，按最保守的写法实现：3 秒没读完返回 `status: timeout`，没有权限返回 `status: access_denied`，加上上面的限流。客户端在 macOS 设备上收到 `timeout` 时显示“Mac 上可能弹出了授权窗口。请在 Mac 上点“允许”，然后重试。”，收到 `access_denied` 时显示“打不开这个文件夹。请在 Mac 上允许 CodeTether 访问，然后重试。”
- 这个弹窗只出现在被访问的那台 Mac 上，经由电脑访问时出现在那台设备上，不出现在发起浏览的设备上。

Mac 上读文件夹的进程有两个，授权分开记：

- **Host**：桌面应用拉起的 Node SEA 子进程（`apps/desktop/src-tauri/tauri.conf.json` 的 `externalBin`，由 `host_supervisor.rs:255` 以 sidecar 拉起）。平板和 iPad 浏览这台 Mac 自己的文件夹时用它。系统按“负责的进程”记授权，子进程算在拉起它的应用名下，所以预计记在 `com.codetether.desktop` 上。桌面应用用 ad-hoc 签名（`tauri.macos.conf.json` 的 `signingIdentity: "-"`），`Info.plist` 里没有 `NSDesktopFolderUsageDescription`、`NSDocumentsFolderUsageDescription`、`NSDownloadsFolderUsageDescription`。
- **CodeTether Node**：launchd 单独启动的用户服务 `com.codetether.node`（`apps/node/src/service-installation.ts:19`），程序在 `~/Library/Application Support/CodeTether/Node/bin/codetether-node`，构建时 ad-hoc 签名（`apps/node/scripts/build-node.mjs:102`）。从 Windows 浏览这台 Mac 时用它（§3.5）。它不是应用的子进程，也没有应用包，授权预计按程序路径加签名记录。ad-hoc 签名跟着程序内容变，Node 每次更新都换掉程序文件，授权可能要重新给。

实测要打在这两个进程上。终端里跑的 `node` 不算：终端拉起的进程，授权记在终端名下。`tauri dev` 和从终端直接运行 `.app` 里的程序也一样。

清掉旧记录的办法，两个进程不同：

- Host：按应用标识清，只影响 CodeTether，不影响其他程序。注意这也会清掉已安装的 CodeTether 对这三个文件夹的授权。

  ```bash
  tccutil reset SystemPolicyDesktopFolder com.codetether.desktop
  tccutil reset SystemPolicyDocumentsFolder com.codetether.desktop
  tccutil reset SystemPolicyDownloadsFolder com.codetether.desktop
  ```

- Node：`tccutil` 只能按应用标识清，或者把一整类全清，后者会连终端在内所有程序对这个文件夹的授权一起清掉。所以不清记录，改用新路径：把 Node 程序复制到一个从没用过的路径，用单独的 launchd 标签启动。新路径上的程序对系统来说是一个没有记录的新程序。每测一轮换一个新路径。这个办法依赖“按路径记录”的假设，问题 7 会验证它。

要回答的问题，Host 和 Node 各测一遍，桌面、文稿、下载至少各测一次：

1. 只看属性会不会弹窗。对受保护的文件夹本身和它里面的子文件夹做 `stat` 和 `access`，不 `readdir`、不打开。看有没有弹窗，以及结果里能不能看出没有权限。
2. 读取会不会一直阻塞。`readdir` 从调用到返回多久；弹窗是在调用还没返回时出现，还是返回后才出现；不点的话会不会一直不返回。
3. 拒绝后再读是不是立刻失败，报什么错误码；还是又弹一次、又阻塞。
4. 授权记在哪里。Host 的允许是不是记在 `com.codetether.desktop` 上；重启后还在不在；重新构建（ad-hoc 签名变了）后会不会失效，失效时是再弹窗还是直接拒绝。
5. 卡住时占不占线程。一个读取卡在弹窗上时，同一进程里其他文件操作和 `dns.lookup` 慢不慢；4 个读取同时卡住时，其他操作是不是全部停下，点完弹窗后能不能恢复。
6. Node 会不会弹窗。由 launchd 启动、没有应用包的程序读受保护的文件夹时，是弹窗（窗口上写的名字是什么）、直接拒绝，还是一直阻塞。拒绝后，用户在系统设置的哪里能重新允许。
7. Node 更新后。换掉程序文件（内容变了，签名跟着变）后，之前的允许还在不在。同一个程序放到另一个路径，算不算新程序。

测完把结果写回这一节，再定三件事：子文件夹能不能在列这一层时就标出打不开（问题 1）；3 秒超时和限流的数字要不要改（问题 2、5）；Node 更新后要不要提示用户重新允许，提示怎么写（问题 6、7）。在那之前，实现按上面的保守写法，不依赖实测结论。实测提示词：`docs/reviews/b4-mac-folder-access-prompt.md`。

### 3.4 查找以前的会话

扫描一次要到 60 秒（`host-service.ts:299`），而客户端 8 秒就超时。`provider-sessions.discover` 不等扫描结束：

- 请求带 `machineId`、`projectId`、可选的 `provider`、可选的 `cursor`、`limit`（默认 50，最大 100，和本机一致）、可选的 `rescan`（默认 `false`）。
- 扫描要在 Host 侧保活，不能挂在请求的 signal 上。现在的 `waitForProviderSessionScan`（`host-service.ts:8853`）里，最后一个等待者中止时会把扫描本身也中止；扫描结果只在 `discoverProviderSessions` 完成时才变成快照。所以“等 4 秒后提前返回”如果顺手中止了请求，扫描会被取消，下一轮轮询什么都拿不到。保活的扫描不受单次请求的 signal 影响，完成后自己保存快照。
- 没有在进行的扫描时发起一次，然后最多等 4 秒。4 秒内完成就直接返回 `status: complete` 和结果。
- 没完成就返回 `status: scanning`，不带候选项。扫描在服务端继续跑，和本机一样按 `项目\0设备\0AI工具\0路径` 合并，重复请求不会再开一次。
- 客户端每 3 秒重试同一个请求。扫描完成后，下一次请求返回 `status: complete`、这一页候选项、`providers` 和 `nextCursor`。
- `rescan` 为真时，丢弃这个项目、设备、AI 工具、路径上已有的快照，重新发起一次扫描。默认 `false`：有未过期的快照就直接用，不重新扫。
- 带 `cursor` 的请求只读已有的快照，不发起扫描。快照过期（5 分钟）报 `conflict`，`reason` 是 `provider_session_candidate_expired`。
- 并发扫描数达到上限时，本机现在返回一个 `unavailable` 的页面（`host-service.ts:6287`）。远程改成返回 `status: scanning`，让客户端过几秒再试，不把“忙”说成“找不到”。
- 候选项的字段和本机的 `ProviderSessionDiscoveryCandidateSchema`（`packages/protocol/src/provider-sessions.ts:74`）相同：标题、AI 工具、创建和上次使用时间、能不能继续、有没有历史记录、是否已导入。已导入的带 `conversationId`。不返回 AI 工具自己的会话编号。
- 每次扫描都会给候选项生成新的编号（`provider-session-discovery-registry.ts` 的 `createSnapshot`）。重新扫描后，客户端按编号记的勾选会失效。勾选要保持的话，需要一个在同一次快照里稳定、重新扫描后也能对上的引用，而且这个引用不能是 AI 工具自己的会话编号。这一项在写提示词之前要定下来。
- 返回按字节截断，不能照搬 `boundedRows`。`boundedRows`（`supervisor-operations.ts:26`）只丢行，不给游标；注册表现在的游标按“偏移加本页长度”算（`provider-session-discovery-registry.ts` 的 `#page`），按字节截断后这个偏移会跳过没返回的行。截断时游标要指向第一条没返回的候选项，这需要注册表能在截断处签发游标。
- 标题按码元计，不按字节。`ProviderSessionDiscoveryCandidateSchema` 的标题上限是 240 个码元（`packages/protocol/src/provider-sessions.ts`），一个中文标题在 UTF-8 里约 720 字节。按字节估算一页能放多少条会偏多。
- 取消：客户端停止轮询即可。保活的扫描有自己的 60 秒超时，不新增取消操作。

导入用 `provider-sessions.adopt`，一次一条，每条一个 `actionId`。批量勾选由客户端逐条发送，这样某一条失败不影响其他条，失败的那条可以单独重试。

### 3.5 经由电脑访问的设备

`folder.list` 的目标设备是经由电脑访问的设备时，电脑把请求转给那台设备上的 Node。照 `project_location.validate` 的样子加一对消息：

- 请求 `folder.list`：`protocolVersion`、`requestId`、`expectedMachineId`、`expectedNodeId`、可选的 `path`、可选的 `cursor`、`includeHidden`。加进 `apps/node/src/node-service.ts:87` 的 `AuthenticatedRequestSchema`。
- 返回 `folder.listed`：规范化后的 `path`、`status`、可选 `parent`、可选 `drives`，`status` 是 `readable` 时再带 `folders`、`skipped`、可选 `nextCursor`。
- 没有权限和超时放在 `folder.listed` 的 `status` 里，不走 `machine.error`，所以不需要新的错误码。其余校验失败走已有的 `machine.error`，复用 `project_location_path_invalid`、`project_location_missing`、`project_location_not_directory`、`project_location_inaccessible`。
- Node 自己也按 §3.3 限流，同时最多 2 个没返回的浏览读取，名额满时回 `machine.error`，电脑把它报成 `unavailable`、`reason: runtime_unavailable`。错误码用哪个现有值还是新加一个，由执行代理核对 `MachineWireErrorCodeSchema`（`packages/machine-transport/src/messages.ts:1730`）后在报告里说明。
- 电脑等 Node 回复的时间要比 Node 的 3 秒长，让 Node 先回 `status: timeout`，电脑不自己判超时。
- 列出的逻辑只写一份，本机和 Node 共用，放在 Node 能依赖的位置。`apps/node/src/project-location-validation.ts` 是同样的拆法：校验逻辑和传输分开，测试可以换掉文件系统。
- 设备不在线时报 `unavailable`，`reason` 用 `machine_unreachable` 或 `machine_connection_failed`，和 `machineUnavailableError`（`host-service.ts:9788`）的归类一致。
- 电脑和 Node 之间的帧是 16 KiB。`path` 和 `parent` 各可到 4096 字节，所以这一路的行数据预算按 §3.3 的算法算，不能直接说 12 KiB 留得下。

### 3.6 大小和超时

- 每个操作的请求都要能放进 16 KiB。上面这些请求最大的是带 4096 字节路径的 `folder.list`，留有余量。
- 返回给手机和平板的行数据按 12 KiB 截断。截断处必须给得出继续的位置：`folder.list` 和 `provider-sessions.discover` 给 `nextCursor`，`conversation.search` 给 `nextCursor` 和 `hasMore`。`boundedRows` 只丢行、不给游标，不能直接拿来用；用它的逐条累加算法，但要在截断处签发游标。
- 搜索的 `matchPreview` 在本机可以到 1024 个码元，远程按页截断后一页可能少于请求的 `limit`，这是正常的，用 `hasMore` 说明。搜索的游标按最后一条已返回结果的排序键编码，不能按请求的 `limit` 编码，否则按字节截断后会跳过没返回的结果。
- 单次请求的服务端处理不超过 6 秒，给 8 秒的客户端超时留余量。`folder.list` 一层 3 秒是读文件夹的内部等待，不是整次请求的等待。卡住的读取怎么不拖住其他读写，见 §3.3 的“不能拖住其他读写”；数字等 §3.3 的实测再定。
- `provider-sessions.discover` 的 4 秒等待是这里唯一一处接近上限的，不再加长。

### 3.7 电脑上的浏览入口

- 桌面端给配对设备添加项目时，浏览按钮走一个新的本机接口，不绕 Supervisor。Supervisor 是给手机和平板的，电脑操作自己的 Host 不需要再过一遍授权。
- 新接口复用 §3.5 的同一份列出逻辑，返回格式和 `folder.list` 相同。
- `add-project-fields.tsx:193` 那句“配对设备暂不支持浏览文件夹”去掉，改成浏览按钮加手动输入。手动输入的路径仍由 Node 按 `project_location.validate` 校验，规则不变。

### 3.8 Rust 核心

`packages/supervisor-mobile/src/wire.rs` 的 `Operation` 枚举加上 §3.1 的 9 个操作，并在 UniFFI 导出的接口上暴露对应的方法。这一层只做请求和返回的传递，不做界面。

- 返回的解析保持 `data` 为 `Value`，不在 Rust 侧解释每个操作的返回。解释放在 Kotlin 和 Swift 侧，和现有操作一致。
- 失败响应里的 `data.reason` 要透传出去。现在 `MobileError::Failure`（`wire.rs:628`）只有 `code` 和 `httpStatus`，需要能带上 `reason`，否则 T1b 和 I1 拿不到 §1 的那些提示。
- `conversation.list` 的请求加上可选的 `archived`，默认 `all`，和现在的行为一致，见 §3.1。T1a 的项目页依赖这个默认值，不能改成只返回未归档的。

## 4. 验收

用开发诊断页或一个最小的测试客户端发这些操作，不依赖 T1b 的界面。

- **权限**：只有查看权限的连接，§3.1 的每个操作都返回 `operation_not_allowed`；有控制权限的能执行。
- **浏览**：从用户目录开始，逐层到根，Windows 上能列出各个盘。一层超过 200 个文件夹或放不下时有 `nextCursor`，续页不重复不遗漏。隐藏文件夹默认不出现，打开开关后出现。点进没有权限的文件夹返回 `ok: true`、`status: access_denied`，不报失败。列一层时不打开子文件夹：用测试里换掉的文件系统记下调用，确认只有这一层的一次目录读取和符号链接的 `stat`。
- **超时和限流**：用测试里换掉的、永远不返回的文件系统。3 秒后返回 `status: timeout`。同一路径再请求立刻返回 `timeout`，不发起第二次读取。两个读取卡住后，第三个浏览请求立刻返回 `unavailable`、`reason: runtime_unavailable`，这时 `project.list`、`conversation.history` 照常返回。卡住的读取返回后名额释放。Node 上同样测一遍。
- **重发**：每个 B4 写操作用同一个 actionId 重发，返回第一次的结果；第一次失败时，重发拿回同一个失败。Host 重启后用同一个 actionId 重发：`project.create` 返回 `created: false`，`project.remove` 返回 `not_found`，`provider-sessions.adopt` 返回 `already_adopted`，置顶、重命名、恢复返回成功。
- **添加和移除**：添加后项目出现在 `project.list` 里。同一个文件夹再添加返回已有项目、`created: false`，不报错；用同一个 `actionId` 重试也返回同一个项目。有会话的项目移除返回 `conflict`、`reason: project_has_conversations`；没有会话的能移除。
- **以前的会话**：扫描超过 4 秒时先拿到 `status: scanning`，轮询到 `complete`。提前返回不会取消扫描：4 秒时断开等待的那个请求，扫描仍继续，下一轮能拿到结果。同一个扫描不重复发起。`rescan` 为真时丢弃旧快照重新扫。快照过期后带旧游标返回 `conflict`、`reason: provider_session_candidate_expired`。导入一条后，再查到的同一条标已导入；用同一个 `actionId` 重试不导入两次。
- **截断**：一页候选项或一层文件夹按字节放不下时，`nextCursor` 指向第一条没返回的，续页不跳过。
- **搜索**：按标题和按内容各查一次，结果带 `matchedField`；一页放不下时 `hasMore` 为真且续页不重复。
- **置顶、重命名、恢复**：置顶后 `conversation.list` 里该项带 `pinnedAt` 且排在前面；取消后字段消失。重命名超过 240 个码元返回 `invalid_request`。归档的会话恢复后回到“会话”分段。
- **经由电脑访问的设备**：对一台在线的 Node 做上面的浏览和添加；Node 不在线时返回 `unavailable` 并带 `machine_unreachable` 一类的 `reason`。
- **错误映射**：上面每个 `reason` 都是 `HostErrorCode` 里已有的值，没有新造的字符串。路径不合法时 `code` 是 `invalid_request`，`reason` 回退到 `project_location_invalid`。
- **帧大小**：返回给手机和平板的行数据不超过 12 KiB，请求不超过 16 KiB。经由电脑访问的设备那一路，整帧不超过 16 KiB。用一页满的搜索结果和一层满的文件夹核对。
- 电脑上给配对设备添加项目时能浏览，手动输入完整路径仍然可用。

## 5. 不在 B4

- 平板和 iPad 的界面（T1b、I1）。B4 只保证接口和 Rust 核心的方法。
- 项目重命名。本机没有这个功能，见 §2。
- 发送速度和发送失败的提示（B3）。B4 只和 B3 共用 §3.2 的错误映射。
- 通知和后台保持连接（B2）。
- `conversation.create` 第二步失败留下空会话、`action.get` 查不到新建会话的 actionId（B3 里顺带处理的两项）。
- 一台电脑就是一个设备（E1）。B4 仍按现在的方式区分本机设备和经由电脑访问的设备。
- 手机上显示哪些管理功能（M 系列）。接口通用，显示由 M 系列决定。

## 6. 写提示词之前还要定的

1. macOS 受保护文件夹的行为，等 Mac 实测的结果，见 §3.3 的 7 个问题。Host 和 Node 分开测；只有点授权窗口需要你本人。实测提示词：`docs/reviews/b4-mac-folder-access-prompt.md`。
2. 重新扫描后勾选怎么保持。候选项编号每次扫描都变，需要一个不暴露 AI 工具会话编号的稳定引用，见 §3.4。
   - 建议：不加字段，把候选项编号本身改成在同一次 Host 运行内稳定。Host 启动时生成一个只在内存里的随机密钥，对“项目、设备、AI 工具、AI 工具的会话编号”算 HMAC，截一段做 `candidate_` 后面的部分（`packages/protocol/src/provider-sessions.ts:24` 要求 16 到 96 个字符）。同一条会话重新扫描后编号不变，勾选自然保留；外面拿不到密钥，从编号反推不出会话编号。Host 重启后编号会变，这时清空勾选，客户端提示重新勾选。
3. `conversation.search` 现在按控制权限要求。搜索只读已有会话，是否放宽到查看权限，由你定。
   - 建议：放宽到查看权限。搜索查的是标题和你发过的内容，只有查看权限的设备用 `conversation.list` 和 `conversation.history` 本来就能读到这些，放宽不多给任何东西。`folder.list` 不一样，它看的是项目以外的文件夹，仍要求控制权限。
4. Windows 上列盘符和判断隐藏文件夹，Node.js 都没有现成接口：`fs.Stats` 不带 Windows 的文件属性，也没有列盘符的函数，仓库里也没有这样的代码。对 A 到 Z 逐个 `stat` 不行，断开的网络盘会卡住线程（§3.3）。
   - 建议：隐藏只按名字判断：以 `.` 开头，或在一个固定名单里（`$Recycle.Bin`、`System Volume Information`、`$WinREAgent`、`Config.Msi`、`Recovery`，以及用户目录下的 `AppData`）。少数用户自己设成隐藏的文件夹会显示出来，可以接受。
   - 建议：盘符用一次有时限的系统命令取，不经过线程池，命令由执行代理选并在报告里说明。`label` 能顺带拿到就带，拿不到就不带。

# 任务：Mac 第 7 轮（给网页通知链路加诊断，查清第二次为什么没发）

在 Mac 上运行。这一轮改少量代码，在 `fix/macos-notifications` 分支上新增一个提交，然后打包、替换安装版、实测。先读 `~/agenthub-archive/v4-acceptance-report-mac.md` 里第 1 到 6 轮的记录。界面以 docs/ux-redesign 为准，这是用户的临时授权，优先于 AGENTS.md 里“Figma 是唯一来源”的规定。

用户要求：界面检查由智能体直接完成，不把界面判断交回给用户。下面要用户做的几件事（点访达、点通知、退出应用），是因为智能体做不了或者会影响测试结果。

开始前只读核对：
- `/Applications/CodeTether.app` 运行的构建是 `git-a8abbecc12ea`；
- 正式数据是 11 个项目、2 台设备、25 个会话；
- `origin/fix/macos-notifications` 是 `a8abbecc12ea6b0b5fa83c52373a85322435130e`。

有一项不一致就停下报告。

## 背景

第 6 轮：
- 系统对照通知能显示。
- 用 `open -a` 正常启动后，第一次回合（访达遮挡）弹出了通知，点击也回到了对应会话。这说明原生通知、显示和点击都是好的。
- 之后几次回合都正常完成，待处理从 24 增加到 26，说明 Host 生成了新的待处理，但 Desktop 日志里没有新的 `notification requested`。

所以问题出在网页这一层，从收到 Host 的 `attention.created` 到调用 `deliver_attention_notification` 之间。这条路在 `apps/web/src/runtime/notifications/attention-notification-coordinator.ts` 的 `#deliverAttention`（193 到 297 行）里，有这些地方会不留痕迹地提前结束：
- 197、208、261、274 行：协调器已经停止（`#isActive` 为假）。
- 201 行：`recentIds.has` 返回真。`main.tsx` 现在没有传 `recentIds`，这一步应该不会走到，日志用来确认。
- 221 行：这个类型的通知开关是关的。
- 247 行：判断为“用户正在看”而不发（窗口有焦点、可见、没最小化，并且停在待处理页或这个会话）。
- 225 行 `getWindowState` 和 266 行 `ensurePermission`：这两步只要一直不返回，这条提醒就会永远卡住，也不会报错。`ensurePermission` 卡住时，后面所有提醒都会排在它后面一起卡住（`native-capabilities.ts:309-326` 会把同一个请求共享出去）。
- 网页和 Host 的连接（SSE）断开以后，如果重连时拿到 `stream.reset`，网页会重新取一份快照，中间生成的提醒不会再以 `attention.created` 的形式到达。这是设计行为，但要确认是不是在测试时发生了。

现在网页里的失败诊断只写 `console.warn`，安装版看不到，所以前几轮的日志里什么都没有。

这一轮只加诊断，不修。看到日志以后，审核方再写修复。

## 第一部分：准备

1. `git fetch origin`，在现有工作区 `~/agenthub-work/v4-fix-macos-notify` 里，确认 `fix/macos-notifications` 是干净的，HEAD 和远端都是 `a8abbecc12ea6b0b5fa83c52373a85322435130e`。不要动 Mac 上的其他工作区，也不要动主工作区里的官网改动。
2. 把现在的 `/Applications/CodeTether.app`（a8abbec 这一版）复制到 `~/agenthub-archive/mac-install-backup-2026-10-23/CodeTether-a8abbec.app`，核对文件数和大小。数据目录前面已经备份过，不用再备份。

## 第二部分：代码改动

只做下面这些，作为一个提交，提交说明写 `chore(desktop): log notification pipeline stages for diagnosis`，结尾写 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。

### 1. 原生日志命令（Rust）

在 `apps/desktop/src-tauri/src/attention_notifications.rs` 里加一个命令 `log_notification_stage`：
- 参数只有一个 `stage`，类型是 Rust 枚举，用 serde 的 `rename_all = "kebab-case"` 反序列化。不认识的值直接被反序列化拒绝，不接受任意字符串。
- 枚举值固定为下面这些，不多不少：
  - `received`：收到一条新的 `attention.created`；
  - `skip-inactive`、`skip-recent`、`skip-disabled`、`skip-suppressed`、`skip-permission-denied`：各个提前结束的地方；
  - `window-state-start`、`window-state-done`、`window-state-timeout`；
  - `metadata-start`、`metadata-done`；
  - `permission-start`、`permission-done`、`permission-timeout`；
  - `deliver-start`、`deliver-done`；
  - `failed-recent-id-read`、`failed-preferences`、`failed-window-state`、`failed-presentation`、`failed-metadata`、`failed-permission`、`failed-delivery`、`failed-recent-id-write`、`failed-click-listener`、`failed-navigation`；
  - `sse-connected`、`sse-reconnecting`、`sse-reset`、`sse-unavailable`。
- 命令只做一件事：`eprintln!("[codetether:desktop] notification stage={stage}")`。不读也不写任何状态，返回 `()`。
- 用小函数生成这行文字，照现有 `notification_requested_log` 的写法。加单元测试，覆盖所有值，确认每行都是固定格式、没有换行。再加一个测试，确认反序列化会拒绝未知值、空字符串和带换行的值。

把命令接到已有的权限和清单里，三处要一致：
- `apps/desktop/src-tauri/build.rs` 的命令清单；
- `apps/desktop/src-tauri/permissions/attention-notifications.toml` 的 `commands.allow`；
- `host_supervisor.rs:1287` 的 `generate_handler!`。

更新 `apps/desktop/test/security-config.test.mjs` 里检查命令清单的测试（`Web UI exposes only the bounded Desktop product commands`），把新命令加进去。`docs/ARCHITECTURE.md` 的 Native Security Boundary 一节列了网页能调用的命令，在那里补上新命令，并说明它只接受固定的阶段名，只写一行日志。

### 2. 网页协调器（TypeScript）

在 `apps/web/src/runtime/native/native-capabilities.ts` 的 notifications 适配器上加一个方法 `logStage(stage)`：
- 调用 `invoke('log_notification_stage', { stage })`；
- 失败时吞掉错误，不抛出，不重试；
- 浏览器版本（没有 Tauri）是空函数。

在 `DesktopNotificationAdapter` 接口里加上这个可选方法。在 `attention-notification-coordinator.ts` 里：
- `#onAppliedEvent` 里每收到一条新的 `attention.created`，记 `received`。去重返回的那条不记。
- `#deliverAttention` 里每个提前结束的地方记对应的 `skip-…`，每个 `#report` 同时记对应的 `failed-…`（阶段名照 `DesktopNotificationFailureStage` 一一对应）。
- `getWindowState`、`resolveMetadata`、`ensurePermission`、`deliver` 四步前后分别记 `…-start` 和 `…-done`。
- `getWindowState` 和 `ensurePermission` 用 5 秒上限包起来，超时就记 `…-timeout`：
  - 窗口状态超时，就按原来抛错时的处理，当作“不在看”继续往下走；
  - 权限超时，就按原来抛错时的处理，结束这一条。
  - 超时不取消底层的请求，只是这一条提醒不再等它。
  - 定时器在请求返回后要清掉。
- 不改判断逻辑，不改通知文案，不改去重，不改开关。超时上限是唯一的行为变化，只影响“永远不返回”的情况。

在 `apps/web/src/main.tsx` 里订阅 `runtime.subscribe`（`host-runtime.ts:296`）。这个 listener 没有参数，要在里面用 `runtime.getConnectionState()` 读当前状态，只在状态真的变化时记：变成 `connected`、`reconnecting`、`unavailable` 时，分别记 `sse-connected`、`sse-reconnecting`、`sse-unavailable`。订阅要在 `pagehide` 时和协调器一起释放。在 `HostRuntime` 处理 `stream.reset` 的地方（`host-runtime.ts:798` 附近），通过已有的 applied event 或一个最小的回调记 `sse-reset`。选改动最小的写法，不改重连逻辑。

日志里只有阶段名，不写标题、正文、设备名、项目名、路径和任何 ID。

### 3. 窗口事件日志（Rust）

在 `host_supervisor.rs` 已有的 `RunEvent::WindowEvent` 处理里：
- `Resized` 分支：最小化状态变化时，用已有的 `log_lifecycle_event` 记 `main_window_minimized` 或 `main_window_restored`。只在状态真的变了时记，不要每次 Resized 都记。
- 新增 `WindowEvent::Focused(focused)` 分支：记 `main_window_focused` 或 `main_window_blurred`。

### 4. 测试

- 协调器测试（`apps/web` 里已有的 attention-notification-coordinator 测试文件）：
  - 每个提前结束的分支都记了对应阶段；
  - `ensurePermission` 和 `getWindowState` 永远不返回时，5 秒后分别记 `permission-timeout` 和 `window-state-timeout`，用假时钟，不真的等 5 秒；
  - 窗口状态超时以后，这条提醒仍然会走到 `deliver-start`；
  - 浏览器适配器的 `logStage` 不调用任何 Tauri 模块。
- 已有的测试不能有新的失败。

### 不要改的

- Host、通知文案、通知开关、去重规则、Windows 的通知行为、Rust 原生发送逻辑。
- 不加依赖。

### 检查

- `env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_MODEL pnpm typecheck`，`lint`、`build` 也用同样的写法跑。
- `pnpm test`：已知 3 项 Windows 安装器路径测试会失败；Claude 测试有 `/var` 和 `/private/var` 的路径问题，用规范的 `TMPDIR` 重跑。除了这两类，不能有新的失败。
- 在 `apps/desktop/src-tauri` 里跑 `cargo test --locked`、`cargo clippy --locked --all-targets -- -D warnings`、`cargo fmt --check`。
- 改过的文件用 prettier 检查，`git diff --check` 无输出。
- 不用装 Windows 工具链，Windows 编译由审核方复核。

## 第三部分：打包和安装

1. 构建配置用 `~/agenthub-work/v4-build.env`。只用 `set -a; . ~/agenthub-work/v4-build.env; set +a` 在打包命令所在的 shell 里加载，不打印、不复制它的内容。运行 `pnpm desktop:build`，日志用 sed 去掉 `sk-…`、`sb_publishable_…` 和 Bearer 再保存。
2. 记下 `.app` 和 `.dmg` 的路径、大小和 SHA256。
3. 请用户从菜单栏退出 CodeTether，确认 Desktop、Host 和 Host guardian 都退出了。
4. 用新的 `.app` 替换 `/Applications/CodeTether.app`，数据目录不动。替换后运行一次 `lsregister -f /Applications/CodeTether.app`（运行前先说明）。不注销其他登记。
5. 用第 6 轮的方式正常启动，不要直接运行可执行文件：
   `open -a /Applications/CodeTether.app --stderr ~/agenthub-archive/v4-mac-r7-desktop-stderr.raw`
   如果 `--stderr` 拿不到日志，停下报告，不要改用直接运行可执行文件的方式。
6. 只读核对：
   - 运行构建是新提交的前 12 位；
   - 正式数据还是 11 个项目、2 台设备、25 个会话；
   - 日志里有 `authorization status=…` 和 `notification stage=sse-connected`。
   `sse-connected` 不出现，说明网页日志没接通，停下检查，不要开始实测。

## 第四部分：实测

都在测试项目 `v4 Mac Acceptance Test` 的测试 Codex 会话里做，每次发“只回复 OK，不要读写文件”。三次测试之间至少隔 1 分钟，不要连着发。

每次测试都记下：开始和结束时间；日志里这段时间的所有 `notification stage=…`、`notification requested`、`notification shown` 和 `[codetether:lifecycle]` 行；屏幕和通知中心有没有通知；待处理数量。

测试 1，窗口被挡住：
- 发送后马上请用户点一下访达，让访达挡在 CodeTether 前面，不最小化。
- 等回合完成后 30 秒。

测试 2，窗口在前台、但不在这个会话：
- 发送后马上切到“设备”页，窗口留在前台。
- 等回合完成后 30 秒。

测试 3，最小化：
- 发送后马上 ⌘M 最小化，确认日志里出现 `main_window_minimized`。没有出现就写明，不要用别的方式补。
- 等回合完成后 30 秒。出现通知就请用户点一下，智能体检查窗口是否回到这个会话。

每次测试结束，按日志判断停在哪一步：

| 日志 | 结论 |
|---|---|
| 没有 `received` | 网页没收到 `attention.created`：看同一时间有没有 `sse-reconnecting` 或 `sse-reset` |
| `received` 后是 `skip-…` | 被这一步判断为不发：写明是哪一个 |
| `…-start` 后没有 `…-done` 也没有 `…-timeout` | 卡在这一步，超时上限也没起作用：写明是哪一个 |
| `…-timeout` | 这一步超过 5 秒：写明是哪一个 |
| `deliver-done` 后有 `notification shown` 但屏幕上没有 | 回到系统层，写明 |

## 预算和停止条件

- Codex：最多 3 个回合，每个测试 1 个，回合失败不重发。Claude Code：0 个回合。
- 三个测试都要做，不因为某一个没出通知就停。这一轮的目的是收集日志。
- 某个检查失败时，先修到通过再打包。改动超出第二部分的范围，停下报告。
- 遇到 API 429 或 524：按 Retry-After 等待，最多重试 3 次，每次记下时间，之后停下报告。

## 不要做的事

- 只改第二部分列出的文件、对应测试和 `docs/ARCHITECTURE.md` 那一段。
- 不推送，不合并，不打标签。分支要不要推送，在报告最后问用户，用户同意了再推 `fix/macos-notifications` 这一个分支，不强推。
- 不改账号、Provider 选择、gateway、`~/.codex` 和 `~/.claude`。
- 不配对，不取消配对，不新建或移除项目。
- 不改系统设置、通知权限、专注模式和 Gatekeeper，不清图标缓存。
- 不删备份，不删旧的 `.app`。

## 日志和报告

- 测完请用户退出 CodeTether，处理日志：
  - 用 sed 去掉 `sk-…`、`sb_publishable_…` 和 Bearer；
  - 只保留含 `[codetether:desktop]`、`[codetether:lifecycle]` 和 `notification` 的行；
  - 另存为 `.sanitized.log`，然后删掉 `.raw`。
  - 最后请用户正常打开 CodeTether。
- 追加到 `~/agenthub-archive/v4-acceptance-report-mac.md`，新开一节“第 7 轮”，写这些内容：
  - 提交哈希和标题，各项检查结果；
  - 安装包路径和 SHA256，运行版本；
  - 三个测试的时间、日志行、屏幕观察和按上表得出的结论；
  - 15 项最终统计；
  - 结束时正式数据的项目、设备、会话数量。
- 最后在回复里用中文写一段总结，并附上：
  - `git log --oneline origin/main..HEAD`；
  - `git diff --stat origin/main..HEAD`；
  - 这一轮新提交的完整 diff；
  - 脱敏日志全文。
  用户会转给 Windows 上的审核方。

## 限制

- 不读 .secrets/、其他 .env、凭据文件、machine-credentials 内容、`~/.codex/auth.json` 和 `~/.claude.json`。`v4-build.env` 只按第三部分第 1 条加载，不读出内容。
- 每次运行 `defaults` 和 `lsregister` 前，先说明要做什么。
- 不注销或删除别的 App 登记，不删备份。
- 新增依赖要写精确版本，这一轮预计不需要新增。
- 某个操作被权限拒绝时，不绕过，写成命令交给用户在终端里运行。
- 报告用中文，不用感叹号和破折号。

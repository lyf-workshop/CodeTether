# 任务：修 macOS 系统通知（Mac 第 5 轮，含少量代码改动）

在 Mac 上运行。这一轮要改代码、打包、替换 Mac 安装版。先读 `~/agenthub-archive/v4-acceptance-report-mac.md` 里第 1 到 4 轮的记录。界面以 docs/ux-redesign 为准，这是用户的临时授权，优先于 AGENTS.md 里“Figma 是唯一来源”的规定。

用户要求：界面检查由智能体直接在安装版上完成，不把界面判断交回给用户。

## 背景

前 4 轮在 Mac 上 13 项通过，第 9 项系统通知一直没出现，第 10 项没测。第 4 轮确认系统设置里 CodeTether 的通知开着，没有开专注模式，Desktop 日志里也没有任何通知记录。

审核方读代码后的判断：
1. 最可能的原因：macOS 的 WKWebView 默认会在窗口不在前台时挂起网页（`inactiveSchedulingPolicy` 默认是 suspend）。CodeTether 被挡住或最小化后，网页收不到 Host 推来的提醒，也就不会调用发通知。等窗口回到前台，提醒按设计不再弹。Windows 用 Web Lock 解决了同类问题，macOS 上没有效果。Tauri 2.11.5 提供 `backgroundThrottling` 窗口配置，macOS 14 以上生效。
2. macOS 发通知成功时不打日志（`apps/desktop/src-tauri/src/macos_notifications.rs:289-310`），所以前几轮分不清“没发”和“发了没显示”。
3. 应用退出后再点通知，代码只在内存里找通知意图（`macos_notifications.rs:66-77`），找不到就只打开窗口，不跳到会话。Windows 在 R11 已经有按 attention ID 查找的路径（`activate_notification_link`），macOS 可以复用。

## 第一部分：准备

1. `git fetch origin`。在 `origin/main`（`835489dd3c9e7e703ecdfb86b9cd4d2f53391b16`）上新建分支 `fix/macos-notifications`，用一个新的干净工作区，例如 `~/agenthub-work/v4-fix-macos-notify`。不要动 Mac 上已有的工作区，也不要动原工作区里的 `apps/site/` 改动。
2. 先只读记下 `sw_vers -productVersion`。macOS 低于 14.0 时，第二部分第 3 条不会生效，写进报告，继续做。
3. 把现在的 `/Applications/CodeTether.app`（835489d 那一版）复制到 `~/agenthub-archive/mac-install-backup-2026-10-23/CodeTether-835489d.app`，核对文件数和大小。数据目录前面已经备份过，不用再备份。

## 第二部分：代码改动

只改下面这些，按功能分成 2 到 3 个提交。提交结尾写 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。

1. 日志（`apps/desktop/src-tauri/src/attention_notifications.rs` 和 `macos_notifications.rs`）：
   - `deliver_attention_notification` 一进来就打 `[codetether:desktop] notification requested type=<类型>`，所有平台都打。
   - macOS 权限请求结束时打 `[codetether:desktop] macOS notification authorization result=<granted|denied|error>`。
   - macOS 通知被系统接受时打 `[codetether:desktop] notification shown type=<类型> platform=macos`，和 Windows 的 shown 日志对应。
   - 启动完成后（`initialize` 里），用 `getNotificationSettingsWithCompletionHandler` 读一次授权状态，打 `[codetether:desktop] macOS notification authorization status=<notDetermined|denied|authorized|provisional|ephemeral|unknown>`。
   - 日志里不写标题、正文和任何 ID。照现有 `notification_activated_log` 的写法做成小函数，加单元测试，确认不含哨兵值。
2. 退出后点通知（`macos_notifications.rs:66-77`）：
   - 内存里找不到时，从通知标识 `codetether-attention-<attentionId>` 里取出 attention ID。前缀必须完全一致，ID 用 `is_public_id(…, "attn_")` 校验。
   - 校验通过就调用 `activate_notification_link`，把它的 `#[cfg(windows)]` 放宽到 `any(windows, target_os = "macos")`。校验不通过就只恢复窗口，和现在一样。
   - 加单元测试：合法标识、前缀不对、ID 不合法、空值。
3. 后台挂起（`apps/desktop/src-tauri/tauri.conf.json` 的 `main` 窗口）：
   - 加 `"backgroundThrottling": "disabled"`。Windows 和 Linux 上这项不起作用，不影响它们。
   - 如果 `apps/desktop/test/security-config.test.mjs` 或其他配置测试因此失败，就更新测试，并在 `docs/ARCHITECTURE.md` 讲 macOS 通知的那段里补一句说明原因。
4. 不改网页代码、Host、通知文案、通知开关和 Windows 的行为。

检查：
- `env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_MODEL pnpm typecheck`，`lint`、`build` 也用同样的写法跑。
- 跑 `pnpm test`，已知有 3 项 Windows 安装器路径测试在 macOS 上失败。除了这 3 项，不能有新的失败。
- 在 `apps/desktop/src-tauri` 里跑 `cargo test`、`cargo clippy --all-targets -- -D warnings`、`cargo fmt --check`。
- 改过的文件用 prettier 检查。
- 第 1 条里所有平台都会走的那行日志，Windows 编译由审核方在 Windows 上复核。如果你能装 `x86_64-pc-windows-msvc` 目标做 `cargo check`，就做一次，做不了就写明。

## 第三部分：打包和安装

1. 构建配置用第 1 轮已经保存的 `~/agenthub-work/v4-build.env`。只用 `set -a; . ~/agenthub-work/v4-build.env; set +a` 在打包命令所在的 shell 里加载，不打印、不复制它的内容。然后运行 `pnpm desktop:build`，日志用 sed 去掉 `sk-…`、`sb_publishable_…` 和 Bearer 再保存。
2. 记下 `.app` 和 `.dmg` 的路径、大小和 SHA256。
3. 请用户从菜单栏退出 CodeTether，确认 Desktop、Host 和 Host guardian 都退出了。
4. 用新的 `.app` 替换 `/Applications/CodeTether.app`，数据目录不动。第一次打开被系统拦下时，请用户在“隐私与安全性”里点“仍要打开”。
5. 请用户在终端用日志方式启动（`<可执行文件名>` 用 `Info.plist` 里的 `CFBundleExecutable`），回复“已启动”：
   `/Applications/CodeTether.app/Contents/MacOS/<可执行文件名> 2> ~/agenthub-archive/v4-mac-r5-desktop-stderr.raw &`
6. 只读核对：运行构建是新提交的前 12 位；正式数据还是 11 个项目、2 台设备、25 个会话；日志里有一行 `authorization status=…`。

## 第四部分：实测

都在测试项目 `v4 Mac Acceptance Test` 的测试 Codex 会话里做。每次发：“只回复 OK，不要读写文件”。

测试 1，窗口在前台、但不在这个会话：
- 发送后马上切到“设备”页，窗口留在前台。
- 预期：日志里出现 `notification requested`、`notification shown`，屏幕上出现横幅，内容是“设备 · 项目”加一句说明，没有会话标题。
- 这一项用来判断原生发通知这条路本身通不通。

测试 2，窗口被挡住：
- 发送后马上请用户点一下访达，让访达挡在 CodeTether 前面，不最小化。
- 预期和测试 1 一样。

测试 3，最小化后点通知：
- 发送后马上 ⌘M 最小化。
- 出现通知后，请用户点这条通知，回复“已点击”。
- 智能体检查：窗口回到前面，路由带这一轮的 `turn` 参数和 `notification-N`，只跳转一次。

测试 4，退出后点通知：
- 发送后马上最小化。出现通知后先不要点。
- 请用户从菜单栏退出 CodeTether，确认进程都退出了。
- 请用户在通知中心点这条通知，回复“已点击”。
- 智能体检查：CodeTether 是否被启动，窗口是否出现，路由是否带这一轮的 `turn` 参数。这次启动没有日志，根据窗口和路由判断。

判断：
- 测试 1 不出通知：原生这条路有问题，看 `authorization` 两行日志，停在报告，不做测试 2 到 4。
- 测试 1 出了，测试 2 或 3 不出：`backgroundThrottling` 没解决挂起，写清 macOS 版本和日志，停在报告。
- 第 9 项通过的条件：测试 2 和测试 3 都出了通知，内容正确；测试 3 和测试 4 都打开了正确的会话。

## 第五部分：第 10 项和图标

第 4 轮已经确认智能体能截到 CodeTether 窗口。这次由智能体自己完成，不用等用户：
1. 设置里选浅色，请用户从菜单栏退出 CodeTether。
2. 智能体先启动录屏 `screencapture -v -V 3 -R <x,y,w,h> <文件>`，只录 CodeTether 窗口所在的区域，紧接着用 `open -a CodeTether` 打开。把视频按每秒 10 帧拆成图片，逐张看有没有深蓝色的帧。只留最早出现窗口的那一帧，删掉视频和其他帧。
3. 用 `screencapture -R` 截两块小区域：Dock 上的 CodeTether 图标、菜单栏上的 CodeTether 图标。都应该是紫色双卡片。
4. 启动台不用单独截，关于窗口和 `icon.icns` 前几轮已经确认过。
5. 截不到就写“未测”和原因，不要猜。

## 预算和停止条件

- Codex：最多 4 个回合，测试 1 到 4 各 1 个，回合失败不重发。Claude Code：0 个回合。
- 某个检查失败时，先修到通过再打包。改动超出第二部分的范围，停下报告。
- 遇到 API 429 或 524：按 Retry-After 等待，最多重试 3 次，每次记下时间，之后停下报告。

## 不要做的事

- 只改第二部分列出的文件和对应测试、文档。不改网页代码、Host、Windows 的行为和通知文案。
- 不推送，不合并，不打标签。分支要不要推送到 GitHub，在报告最后问用户，用户同意了再推 `fix/macos-notifications` 这一个分支。
- 不改账号、Provider 选择、gateway、`~/.codex` 和 `~/.claude`。
- 不配对，不取消配对，不新建或移除项目。
- 智能体不改系统设置、通知权限、专注模式、录屏权限和 Gatekeeper，不清图标缓存。
- 不删备份，不删旧的 `.app`。

## 日志和报告

- 测完请用户退出 CodeTether，处理日志：用 sed 去掉 `sk-…`、`sb_publishable_…` 和 Bearer，只保留含 `[codetether:desktop]`、`[codetether:lifecycle]` 和 `notification` 的行，另存为 `.sanitized.log`，然后删掉 `.raw`。最后请用户正常打开 CodeTether。
- 追加到 `~/agenthub-archive/v4-acceptance-report-mac.md`，新开一节“第 5 轮”，写这些内容：
  - macOS 版本；
  - 每个提交的哈希和标题，各项检查结果；
  - 安装包路径和 SHA256，运行版本；
  - 四个测试的时间、日志行和结论；
  - 第 10 项和图标的结果；
  - 15 项最终统计；
  - 结束时正式数据的项目、设备、会话数量。
- 最后在回复里用中文写一段总结，并附上：
  - `git log --oneline origin/main..HEAD`；
  - `git diff --stat origin/main..HEAD`；
  - 第二部分改动的完整 `git diff origin/main..HEAD`；
  - 脱敏日志全文。
  用户会转给 Windows 上的审核方。

## 限制

- 不读 .secrets/、其他 .env、凭据文件、machine-credentials 内容、`~/.codex/auth.json` 和 `~/.claude.json`。`v4-build.env` 只按第三部分第 1 条加载，不读出内容。
- 新加依赖要写精确版本。这一轮预计不需要加依赖。
- 某个操作被权限拒绝时，不绕过，写成命令交给用户在终端里运行。
- 报告用中文，不用感叹号和破折号。

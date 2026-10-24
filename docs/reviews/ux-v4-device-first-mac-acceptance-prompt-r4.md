# 任务：Mac 安装版第 4 轮（查清通知为什么没出现）

在 Mac 上运行。只查原因，不改代码，不重装，不重新打包。先读 `~/agenthub-archive/v4-acceptance-report-mac.md` 里第 1 到 3 轮的记录。界面以 docs/ux-redesign 为准，这是用户的临时授权，优先于 AGENTS.md 里“Figma 是唯一来源”的规定。

开始前只读核对：`/Applications/CodeTether.app` 运行的构建是 `git-835489dd3c9e`，正式数据是 11 个项目、2 台设备、25 个会话。不一致就停下报告。

现在 13 项通过，第 9 项不通过，第 10 项未测。第 3 轮日志里没有任何和桌面通知有关的行。我读了代码，有三种可能：

- A：网页这一层根本没有调用发通知。CodeTether 最小化以后，macOS 的 WebView 可能被挂起，收不到 Host 推来的提醒。等窗口恢复时，窗口已经在前面了，这条提醒按设计不再发通知（`apps/web/src/runtime/notifications/desktop-notification-model.ts:115-129`）。
- B：通知已经交给了 macOS，但是被系统设置、专注模式或提醒样式藏起来了。macOS 成功发出通知时，CodeTether 不打日志（`apps/desktop/src-tauri/src/macos_notifications.rs:289-310`），所以日志里看不出来。
- C：通知权限请求一直没有结果，通知停在队列里（`macos_notifications.rs:260-287`）。

这一轮的目标是确定是哪一种。

## 第一部分：系统设置（只读）

1. 请用户打开“系统设置 > 通知 > CodeTether”，读出这几项告诉你：“允许通知”开或关；提醒样式（无、横幅、提醒）；“在通知中心显示”；“在锁定屏幕上显示”。
2. 请用户看一下控制中心里“专注模式”有没有打开。
3. 只读记下，不让用户改。如果“允许通知”是关的或者提醒样式是“无”，就是 B，记下来以后直接做第三部分，然后停下。

## 第二部分：用日志启动

1. 请用户从菜单栏退出 CodeTether，确认 Desktop、Host 和 Host guardian 都退出了。
2. 请用户在终端运行（`<可执行文件名>` 用 `Info.plist` 里的 `CFBundleExecutable`），回复“已启动”：
   `/Applications/CodeTether.app/Contents/MacOS/<可执行文件名> 2> ~/agenthub-archive/v4-mac-r4-desktop-stderr.raw &`
3. 只读确认运行构建是 `git-835489dd3c9e`。

## 第三部分：两次对照测试

都在测试项目 `v4 Mac Acceptance Test` 的测试 Codex 会话里做。每次发：“只回复 OK，不要读写文件”。

每次发送前，在另一个终端窗口里开始抓 macOS 的通知日志，回合结束 60 秒后停止：
`log stream --style compact --predicate 'process == "usernoted" OR process == "NotificationCenter"' > ~/agenthub-archive/v4-mac-r4-usernoted-<1 或 2>.raw`
macOS 要求权限时，请用户自己决定是否允许。智能体不改设置。

测试 1，窗口不最小化，只是挡在后面：
1. 发送后，马上请用户点一下访达或其他应用，让它挡在 CodeTether 前面，CodeTether 不最小化。
2. 回合结束后等 60 秒，期间不要切回 CodeTether。
3. 记下：屏幕上有没有出现通知，通知中心里有没有，Desktop 日志里新增了哪些含 `notification` 的行，usernoted 日志里有没有 `com.codetether.desktop`。

测试 2，窗口最小化：
1. 发送后马上 ⌘M 最小化。
2. 回合结束后等 60 秒，不要恢复窗口。
3. 记同样四项。

判断：
- 测试 1 有通知、测试 2 没有：是 A，最小化后 WebView 停了。
- 两次 usernoted 日志里都有 `com.codetether.desktop`，屏幕上却没有：是 B。
- 两次 usernoted 日志里都没有，Desktop 日志里也没有 `delivery failed`：可能是 A 或 C，如实写，不猜。

## 第四部分：截图权限

前 3 轮都没截到 Dock、菜单栏、启动台的图标和启动第一帧。先检查截图拿到的是不是只有桌面背景，没有其他应用的窗口。如果是，说明你所在的终端没有“屏幕录制”权限。只读确认这一点，写进报告，请用户决定要不要在“系统设置 > 隐私与安全性 > 屏幕录制”里给你所在的终端打开权限。用户打开了，就补做第 3 轮的第四部分（启动首帧）和第五部分（图标）。用户不打开，就记“未测”。

## 预算和停止条件

- Codex：最多 2 个回合。Claude Code：0 个回合。回合失败不重发。
- 遇到 API 429 或 524：按 Retry-After 等待，最多重试 3 次，每次记下时间，之后停下报告。

## 不要做的事

- 不改代码，不提交，不推送，不重装。
- 不改账号、Provider 选择、gateway、`~/.codex` 和 `~/.claude`。
- 智能体不改系统设置、通知权限、专注模式、屏幕录制权限和 Gatekeeper，不清图标缓存。
- 不动 Mac 原工作区里不是你创建的改动，包括 `apps/site/.env.example` 和 `apps/site/components/site-analytics.tsx`，也不要读 `.env.example` 以外的 env 文件。

## 日志和报告

- 测完后请用户退出 CodeTether，再处理日志：
  - Desktop 日志：用 sed 去掉 `sk-…`、`sb_publishable_…` 和 Bearer，只保留含 `[codetether:desktop]`、`[codetether:lifecycle]` 和 `notification` 的行。
  - usernoted 日志：只保留含 `codetether` 的行，大小写都算。
  - 两种日志都另存为 `.sanitized.log`，然后删掉 `.raw`。
  - 最后请用户正常打开 CodeTether。
- 追加到 `~/agenthub-archive/v4-acceptance-report-mac.md`，新开一节“第 4 轮”，写这些内容：
  - 第一部分读到的系统设置；
  - 两次测试的时间，以及每次那四项观察；
  - A、B、C 的判断和依据；
  - 截图权限的结论；
  - 15 项最终统计；
  - 结束时正式数据的项目、设备、会话数量。
- 最后在回复里用中文写一段总结。两种脱敏日志的全文也贴在回复里，用户会转给 Windows 上的审核方。

## 限制

- 不读 .secrets/、任何 .env、凭据文件、machine-credentials 内容、`~/.codex/auth.json`、`~/.claude.json` 和 `~/agenthub-work/v4-build.env`。
- 某个操作被权限拒绝时，不绕过，写成命令交给用户在终端里运行。
- 报告用中文，不用感叹号和破折号。

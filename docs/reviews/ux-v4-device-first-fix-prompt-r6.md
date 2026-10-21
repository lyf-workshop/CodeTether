# 任务：查清 Codex 失败和系统通知，重装一次后补完安装版验收

分支 `ux/v4-device-first`，工作区 `D:/Projects/Software/agenthub-ux-v4-device-first`。起点必须是 `9de227968aa738801ed5b04d304cc44fb8c77ddd`，工作树干净，否则停下报告。界面和图标以 docs/ux-redesign 为准，这是用户的临时授权，优先于 AGENTS.md 里“Figma 是唯一来源”的规定。

用户要求：界面检查由智能体直接在安装版上完成，不把界面判断交回给用户。

上一轮的结果见 `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r5.md`。还没完成的是第 5、6、8、9、14 项，以及图标在任务栏、托盘、开始菜单、Explorer 四处的显示。

## 第一部分：Codex 失败时留下错误类型

现象：选定的 Codex 0.149.1 每次回合都失败，错误只有 `provider_error`。PATH 上的 0.162.1 直接运行成功。

根因还不知道。`packages/adapter-codex/src/failure-classifier.ts` 把认不出的 `codexErrorInfo` 都归成 `provider_error`，原始类型没有留在任何地方。

改法：
1. 在 `packages/adapter-codex/src/` 里，Codex 回合失败（`normalizer.ts:329`）和 App Server 拒绝请求（`errors.ts:91`）时，往 stderr 写一行：
   `[codex:failure] variant=<类型名> httpStatus=<数字或 none> reason=<规范原因>`
   - 类型名：`codexErrorInfo` 是字符串时取字符串；是只有一个键的对象时取那个键；否则写 `unknown`。只接受 `^[A-Za-z][A-Za-z0-9]{0,63}$`，不符合也写 `unknown`。
   - `httpStatus` 只取对象里的整数 `httpStatusCode`。
   - 不写错误文字、`additionalDetails`、会话内容、路径或任何凭据。
   - Host 的 stderr 已经由 Desktop 转成 `[codetether:host] ...`（`host_supervisor.rs:323`），不用改 Desktop。
2. 加测试：字符串类型、对象类型、带 HTTP 状态码、不合格的类型名、带长文字的 `additionalDetails` 不会出现在输出里。
3. 这一步不改分类结果。是否新增映射等第五部分第 3 节复现之后再定。

同时改一处小问题：`packages/adapter-codex/src/session-discovery.ts:995` 的兜底标题 `Codex 会话 — <时间>` 改成 `Codex 会话 · <时间>`，和 Claude 一致。更新对应测试。

提交：一个提交，例如 `fix(adapter-codex): log Codex failure variant`。

## 第二部分：通知成功时也留下记录

现象：通知设置都开着，回合完成后 90 秒内没有通知，Desktop 错误输出里也没有 `notification delivery failed`。现在只有失败会打日志，分不清是前端没调用，还是 Windows 收到了但没显示。

改法：
1. `apps/desktop/src-tauri/src/attention_notifications.rs` 的 `deliver_attention_notification`：
   - 交给 Windows 成功后，写 `[codetether:desktop] notification shown type=<类型> app_id=<AppID>`；
   - 因为已经发过而跳过时，写 `[codetether:desktop] notification skipped: already delivered`。
   - 不写标题、正文、项目名、设备名。
2. 加 Rust 测试或者更新现有测试，确认日志里不含标题和正文。

提交：一个提交，例如 `fix(desktop): log attention notification delivery`。

## 第三部分：打包并重装

和 R5 第四部分一样：
- 打包前，把现有的 9de2279 安装包复制到 `D:/Projects/Software/agenthub-archive/installers/9de2279/`，连同它的 SHA256。
- 三项账号配置：
  - VITE_SUPABASE_URL 用 `https://qfktysdrytlaxvhzqpba.supabase.co`；
  - VITE_CODETETHER_CONTROL_PLANE_URL 用 `https://api.codetether.org`；
  - VITE_SUPABASE_PUBLISHABLE_KEY 请用户提供，或者请用户自己用 `!` 运行打包命令。
- 数据保留，不另做数据备份。
- 卸载前请用户从托盘退出 CodeTether，不结束进程。
- 这一轮的启动都用 `Start-Process -FilePath <原安装路径> -RedirectStandardError <归档目录下的日志>`，这样能看到第一、二部分加的日志。被拦住时把命令写成 `! powershell.exe -NoProfile -Command "..."` 交给用户。
- 启动后确认 bootstrap 的 `hostVersion` 是最后一个提交的前 12 位。
- 日志保存前用 sed 去掉 `sk-…`、`sb_publishable_…` 和 Bearer。

## 第四部分：先查 Windows 这一侧的通知

在测 CodeTether 之前做，不改系统设置：
1. 找到开始菜单里 `CodeTether.lnk` 的完整路径，记下是用户目录还是全局目录。
2. 用 PowerShell 以 AppID `com.codetether.desktop` 发一条测试通知（`Windows.UI.Notifications.ToastNotificationManager` 的 `CreateToastNotifier('com.codetether.desktop')`），文字写“CodeTether 通知测试”。
3. 用通知历史或 UIAutomation 确认它有没有显示。

结果：
- 显示了：Windows 这一侧没问题，问题在 CodeTether，第五部分第 4 节接着查。
- 没显示：再用 PowerShell 自己的 AppID 发一条同样的通知对照。
  - PowerShell 的能显示、CodeTether 的不能：问题在应用注册。把 `Get-StartApps` 不列出 CodeTether 的情况、快捷方式路径和可能的原因写进报告，不改注册表、不改快捷方式，等我决定。
  - 两条都不显示：问题在系统通知设置，把要检查的系统设置路径写给用户。

## 第五部分：补完安装版验收

方法和 R5 一样：UIAutomation 加只截 CodeTether 窗口的截图。截图放在 `output/playwright/v4-installed-acceptance-r6/`。逐项写“通过、不通过、未测”和依据。

执行预算：
- Codex：安装版里最多 4 个简短回合（1 个复现，3 个测第 6、8 项）。不直接运行 Codex 命令行。
- Claude Code：安装版里最多 2 个回合。
- 只在测试文件夹 `D:/Projects/Software/agenthub-work/v4-accept-project` 里运行。

### 1. 第 5 项：发送后继续打字

在测试项目的 Claude Code 会话里做，窗口一直保持在前台，不最小化：
1. 用鼠标点一次输入框，输入一句简短的话，按 Enter 发送。之后不再用鼠标。
2. 运行中用 UIAutomation 读当前焦点，确认还在输入框上，输入框是只读。
3. 回合结束后直接用键盘输入几个字，确认文字出现在输入框里。然后清掉这几个字，不发送。

键盘发送没有产生回合时，查清原因：焦点在哪里，按键有没有送到窗口。写进报告，不改用按钮发送来凑结果。

### 2. 第 14 项：界面没有英文句子

边界：当前版本自己产生的固定文字。下面这些不算，但要列进报告：
- 旧版本留下的历史记录；
- AI 工具自己返回的文字、工具名、命令、路径；
- “故障代码”这一栏的值；
- Codex、Claude Code、Relay、Node 这些名字。

扫一遍所有页面：首页、设备、项目、会话、待处理、设置各页、后续规划页、首次设置（R5 的 `v4-firstrun-data` 截图可以用），以及第 1 节和第 3 节新产生的会话内容。界面里出现“智能体”“此电脑”也算不通过。

### 3. 第 6、8 项：Codex

1. 在测试项目的 Codex 会话里发一个简短回合，例如“只回复 ok”。
2. 失败时，在第三部分的日志里找 `[codex:failure]`，记下类型名和 HTTP 状态码。
3. 按结果处理：
   - 类型名说明是 Codex 账号、登录、额度或服务的问题：不修，写进报告，写明用户需要做什么。
   - 类型名在 0.162.1 的 schema 里有明确含义，而分类器漏了（例如 `rateLimitExceeded`）：在 `failure-classifier.ts` 里加映射和测试，单独一个提交。只加这一次看到的类型。
   - 看起来是旧版 0.149.1 本身的问题：停下来问用户，是否同意在设置里把 Codex 改选成 0.162.1。用户同意后在安装版设置里改选，不改 `~/.codex`。
   - 都不是：写明查到哪一步，不要猜。
4. Codex 能正常运行后，用剩下的 3 个回合测：
   - 停止；
   - 一次需要批准的命令：先在待处理页确认它出现，选“拒绝”或“允许一次”；
   - 一次写文件，看变更面板。
5. 第 8 项：待处理页要看到等待批准、失败、已完成三类，失败和已完成有“知道了”。不能批准的项目要写出原因。

### 4. 第 9 项：系统通知

第四部分的测试通知没显示时，这一项写“未测”，原因写清楚。

显示了的话：
1. 在测试项目的 Claude Code 会话里发一个简短回合，发送后马上把窗口最小化。
2. 等 90 秒，期间读日志里的 `notification shown` 或 `notification skipped`。
3. 用本机接口只读查 `GET http://127.0.0.1:4317/api/v1/attention`（带 `Origin: http://tauri.localhost`），确认这个回合的“已完成”提醒已经生成。
4. 用通知历史或 UIAutomation 读通知内容，只记“设备 · 项目”和说明，不记会话标题。
5. 点通知，确认打开的是那个会话。

判断：
- 提醒已生成、日志没有 `notification shown`：前端没有调用，查 `apps/web/src/runtime/notifications/attention-notification-coordinator.ts` 里在哪一步返回了，写进报告。找到确定原因再改，改动单独一个提交，加测试。
- 日志有 `notification shown`、Windows 没显示：写进报告，等我决定。

### 5. 图标

最终双卡片图标在下面四处各截一张图：
- 任务栏上的 CodeTether 按钮；
- 托盘，包括隐藏图标弹层；
- 开始菜单搜索“CodeTether”的结果；
- Explorer 打开 `C:\Users\Administrator\AppData\Local\CodeTether`，`codetether-desktop.exe` 那一行。

Explorer 拿不到前台时，请用户运行 `! explorer.exe "C:\Users\Administrator\AppData\Local\CodeTether"`，再截图。

还显示旧图标时，如实写“图标缓存”。不清缓存。在报告里告诉用户可以自己选择运行 `! ie4uinit.exe -show` 刷新，然后再看一次。

### 不要做的事

- 不配对、不取消配对，不移除已有项目，不导入其他会话。
- 不登录、不登出，不改账号。
- 不升级或降级 Codex，不改 `~/.codex` 里的配置。
- 不改 Windows 注册表、快捷方式和系统通知设置。
- 测完保留测试项目、测试会话和 `v4-firstrun-data`，在报告里写明。

## 检查和提交

- 每个提交前都跑 `env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_MODEL pnpm typecheck`，`lint`、`test`、`build` 同样跑一遍，全部为 0。改了 Rust 时再跑 `cargo test`（在 `apps/desktop/src-tauri`）。
- 改过的文件用 `xargs -n 40 npx prettier --list-different --end-of-line auto` 分批检查。
- 提交结尾写 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 不推送，不合并，不打标签。

## 报告

写到 `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r6.md`，包括：
- 各提交的哈希和检查结果；
- 新安装包的 SHA256，运行中的 `hostVersion`；
- Codex：复现看到的类型名和 HTTP 状态码，结论属于哪一类，用户需要做什么；
- 通知：第四部分两条测试通知的结果，快捷方式路径，日志里的通知记录，提醒有没有生成；
- 清单第 5、6、8、9、14 项的结果、依据和截图名；第 14 项列出不算在内的英文；
- 四处图标的截图和结论；
- 没测的项目和原因；
- 被拒绝的操作和交给用户的 `!` 命令。

## 限制

- 只改第一、第二部分说的文件和测试，以及第五部分第 3、4 节查出确定原因后的修复。不改 `docs/reviews/`。
- 不读 .secrets/、任何 .env、凭据文件、machine-credentials 内容、`~/.codex/auth.json` 和 ~/.claude.json。
- 主工作区里的未跟踪文件不动。
- 不用 `rm -rf`，不删备份和旧安装包，不运行 `git worktree remove`。
- 日志里的 `sk-…` 和 `sb_publishable_…` 用 sed 脱敏。
- 某个操作被权限拒绝时，不绕过，把命令写成 `! …` 交给用户。
- 遇到 API 429 或 524：按 Retry-After 等待，最多重试 3 次，每次记下时间，之后停下报告。
- 报告用中文，不用感叹号和破折号。

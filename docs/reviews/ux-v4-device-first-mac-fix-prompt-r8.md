# 任务：Mac 第 8 轮（先让 CodeTether 能启动，再在一轮里查清并修好系统通知）

在 Mac 上运行。用户要求这一轮加快进度，给智能体更大的自主权：下面“已授权”的事直接做，不用再问。“绝对不做”那一节的边界不变。

先读 `~/agenthub-archive/v4-acceptance-report-mac.md` 里第 1 到 7 轮的记录，以及 `origin/ux/design` 上的 `docs/reviews/ux-v4-device-first-mac-fix-prompt-r7.md`。这一轮沿用 r7 的诊断设计。界面以 docs/ux-redesign 为准，这是用户的临时授权，优先于 AGENTS.md 里“Figma 是唯一来源”的规定。

开始前确认这份文件有 12 个二级标题，最后一节是“限制”，正文中间没有省略标记。不完整就停下报告。

## 现状

- 分支 `fix/macos-notifications`，本地 HEAD 是 `aeb0b5f`（r7 诊断提交），还没推送。远端还是 `a8abbec`。
- `/Applications/CodeTether.app` 现在是 r7 的构建 `git-aeb0b5fbd229`，启动后 Host 以退出码 1 退出，CodeTether 现在用不了。
- 上一版能用的备份在 `~/agenthub-archive/mac-install-backup-2026-10-23/CodeTether-a8abbec.app`。
- r7 的原始日志 `~/agenthub-archive/v4-mac-r7-desktop-stderr.raw` 还在。Host 的报错会以 `[codetether:host]` 开头转进这份日志。r7 的脱敏规则只保留了 desktop、lifecycle 和 notification 三类行，把这行报错过滤掉了，所以脱敏日志里看不到退出原因。
- 审核方的推测：这一轮没有改 Host 的代码，变的是打包环境。
  - r7 用 `/tmp/codetether-node-v25.5.0` 里的 Node 25.5.0 打的 Host。第 1 轮报告写的是用核对过 SHA256 的官方 Node 26.4.0 ARM 包打的。
  - App 从 157.8 MB 变成了 145.6 MB，差的 12 MB 正好像是内嵌的 Node 换了版本。
  - 这一点还没证实，以日志为准。

## 已授权（直接做，不用问）

- 在 `~/agenthub-work/v4-fix-macos-notify` 的 `fix/macos-notifications` 分支上改代码、提交。范围见第三部分。
- 从 nodejs.org 下载官方 Node 安装包，用 `SHASUMS256.txt` 核对 SHA256。只放在临时目录，打包时通过 PATH 使用，不装到系统里。
- 多次打包，多次替换 `/Applications/CodeTether.app`。每次替换前确认有一份能用的备份；需要备份的话，把当前这份复制到 `~/agenthub-archive/mac-install-backup-2026-10-23/`，并在文件名里写上构建号。
- 运行 `lsregister -f /Applications/CodeTether.app`。
- 用 `open -a /Applications/CodeTether.app --stderr <日志路径>` 启动 CodeTether，用 `osascript -e 'quit app "CodeTether"'` 正常退出，并确认 Desktop、Host 和 Host guardian 都退出了。15 秒内没退出就请用户从菜单栏退出，不用 `kill`。
- 测试时自己切换窗口：用 `osascript -e 'tell application "Finder" to activate'` 让访达挡住 CodeTether；在 CodeTether 在前台时，用 System Events 发 ⌘M 最小化。
- 最多发 10 个 Codex 回合。
- 结束时推送 `fix/macos-notifications` 这一个分支（`git push origin fix/macos-notifications`，不加 `--force`）。

## 仍然要用户做的事

- 出现通知时，告诉你屏幕上和通知中心里有没有看到，并在需要时点一下通知。
- 智能体退出不了 CodeTether 时，从菜单栏退出。

## 第一部分：让 CodeTether 能启动

1. 从 r7 的原始日志里取出 Host 的报错。先用 sed 去掉 `sk-…`、`sb_publishable_…` 和 Bearer，再只看含 `[codetether:host]` 的行，`provider-unknown-notification` 那种行跳过。把找到的报错写进报告。
2. 看 `~/agenthub-archive/v4-acceptance-build-logs/` 和前几轮的报告，确认 a8abbec 那一版是用哪个 Node 版本打的。确认不了的话，以第 1 轮写的 Node 26.4.0 为准。
3. 按原因处理：
   - 报错和 Node 版本或运行时有关（比如模块、API 或 SQLite 相关的报错），或者看不出原因、但版本确实不同：换成和 a8abbec 相同的 Node 版本重新打包。
   - 端口 4317 被占用：用 `lsof -nP -iTCP:4317 -sTCP:LISTEN` 看是谁。是 CodeTether 自己留下的 Host，就按上面的方法正常退出；是别的程序，就停下来问用户，不要结束它。
   - 数据库或迁移报错：不要碰数据。恢复 a8abbec 的备份，写进报告，然后停下。
   - 明确是 Host 代码本身的问题：恢复 a8abbec 的备份，写进报告，然后停下。这一轮不改 `apps/host`。
4. 重新打包后替换、`lsregister -f`、用 `open -a … --stderr` 启动。确认这几项：
   - 运行构建是当前 HEAD 的前 12 位；
   - 日志里有 `notification stage=sse-connected`；
   - 正式数据还是 11 个项目、2 台设备、25 个会话。
5. 最多试两次打包。还是起不来，就恢复 a8abbec 的备份，确认它能正常运行，然后停下报告。结束时用户手里必须有一个能用的 CodeTether。

## 第二部分：诊断实测

用 r7 的诊断提交 `aeb0b5f`。打包检查要求和 r7 一样：`pnpm typecheck`、`lint`、`build`，`cargo test`、`clippy`、`fmt`。如果第一部分没有改代码，就不用重跑。

都在测试项目 `v4 Mac Acceptance Test` 的测试 Codex 会话里做，每次用键盘发“只回复 OK，不要读写文件”。每次测试之间至少隔 1 分钟。

很重要：等待通知的这段时间里，不要点、不要聚焦 CodeTether 的窗口，也不要用会把 CodeTether 切到前台的方式截图。CodeTether 在前台并且停在这个会话或待处理页时，按设计不发通知，这会让测试结果失真。截图只用 `screencapture -R` 截屏幕右上角的一小块。

测试 1，窗口被挡住：发送后马上让访达到前台。日志里应该出现 `main_window_blurred`。
测试 2，窗口在前台、但不在这个会话：发送后马上切到“设备”页，窗口留在前台。
测试 3，最小化：发送后马上发 ⌘M。日志里应该出现 `main_window_minimized`。没出现就再发一次 ⌘M，还是没有就如实记下。

每次测试都等回合完成，再等 30 秒，然后记下：
- 这段时间日志里所有的 `notification stage=…`、`notification requested`、`notification shown` 和 `[codetether:lifecycle]` 行；
- 右上角截图；
- 用户看到的情况；
- 待处理数量。

按日志判断：

| 日志 | 结论 |
|---|---|
| 没有 `received` | 网页没收到 `attention.created`。看同一时间有没有 `sse-reconnecting` 或 `sse-reset` |
| `received` 后是 `skip-suppressed` | 当时被判断为“用户正在看”。对照 lifecycle 行：窗口当时真在前台并停在这个会话或待处理页，就是设计行为，改测试方法重测；窗口当时已经失焦或最小化了，就是缺陷 |
| `received` 后是别的 `skip-…` 或 `failed-…` | 写明是哪一个 |
| `…-start` 后没有 `…-done` 也没有 `…-timeout` | 卡在这一步，超时也没起作用 |
| `…-timeout` | 这一步超过 5 秒 |
| `deliver-done` 和 `notification shown` 都有，但屏幕上没有 | 回到系统层，写明 |

## 第三部分：按日志修复

日志指向网页通知链路里的缺陷时，直接修，不用等审核方：
- 可以改的文件：
  - `apps/web/src/runtime/notifications/` 下的文件；
  - `apps/web/src/runtime/native/native-capabilities.ts`；
  - `apps/web/src/main.tsx`；
  - `apps/web/src/runtime/host/host-runtime.ts`，只改事件发布和 `stream.reset` 附近；
  - `apps/desktop/src-tauri/src/attention_notifications.rs` 和 `macos_notifications.rs`；
  - `apps/desktop/src-tauri/src/host_supervisor.rs`，只改窗口事件；
  - 上面这些文件对应的测试，以及 `docs/ARCHITECTURE.md` 里讲通知的那段。
- 每个修复单独提交，提交说明写清原因，并加一个能复现这个问题的测试。
- 不改：Host；通知文案；通知开关的含义；“用户正在看就不发”的规则；去重规则；Windows 的行为。如果确实需要改这些才能修好，停下报告。
- 诊断日志先保留，要不要去掉由审核方决定。
- 修完重新打包、替换，然后只重测之前失败的那几项。最多修 3 次。

## 第四部分：第 9 项完整验收

三个测试都能出通知以后，再做下面这些：
1. 内容：通知是“设备 · 项目”加一句说明，没有会话标题。
2. 运行中点击：再做一次测试 3。出现通知后请用户点一下。智能体检查窗口回到前台，路由带这一轮的 `turn` 参数和 `notification-N`，只跳转一次。
3. 退出后点击：再做一次测试 3。出现通知后先不要点，智能体正常退出 CodeTether，确认进程都退出了，再请用户在通知中心点这条通知。智能体检查 CodeTether 被启动了，窗口出现了，路由带这一轮的 `turn` 参数。这次启动没有日志，根据窗口和路由判断。

第 9 项通过的条件：测试 1、2、3 都出了通知，内容正确，两次点击都打开了正确的会话。

最后用 `open -a` 正常启动一次，让用户手里是能用的最新版。

## 每次提交前的检查

- `env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_MODEL pnpm typecheck`，`lint`、`build` 也用同样的写法跑。
- `pnpm test`：已知 3 项 Windows 安装器路径测试会失败；Claude 测试有 `/var` 和 `/private/var` 的问题，用 `TMPDIR=/private/tmp` 重跑。除了这两类，不能有新的失败。
- 在 `apps/desktop/src-tauri` 里跑 `cargo test --locked`、`cargo clippy --locked --all-targets -- -D warnings`、`cargo fmt --check`。
- 改过的文件用 prettier 检查，`git diff --check` 无输出。
- 构建配置用 `set -a; . ~/agenthub-work/v4-build.env; set +a` 在打包的 shell 里加载，不打印、不复制。打包日志用 sed 去掉 `sk-…`、`sb_publishable_…` 和 Bearer 再保存。

## 预算和停止条件

- Codex：最多 10 个回合。Claude Code：0 个回合。回合失败不重发。
- 打包加替换：最多 6 次。修复：最多 3 次。
- 遇到 API 429 或 524：按 Retry-After 等待，最多重试 3 次，每次记下时间，之后停下报告。
- 下面这些情况，先恢复一个能用的 CodeTether，再停下报告：
  - Host 代码有问题；
  - 数据库报错；
  - 要改的超出第三部分的范围；
  - 预算用完。

## 绝对不做

- 不推送 `main`，不合并，不打标签，不强推。只推 `fix/macos-notifications`。
- 不改 `apps/host`。
- 不读 .secrets/、其他 .env、凭据文件、machine-credentials 内容、`~/.codex/auth.json` 和 `~/.claude.json`。`v4-build.env` 只按上面的方法加载，不读出内容。
- 不读数据库内容，只查数量。不删、不改、不恢复正式数据目录。
- 不改账号、Provider 选择、gateway、`~/.codex` 和 `~/.claude`。不配对，不取消配对，不新建或移除项目。
- 不改系统设置、通知权限、专注模式、录屏权限和 Gatekeeper。不清图标缓存，不注销其他 App 的登记。
- 不删备份，不删旧的 `.app`。
- 不用 `kill -9` 结束任何进程。
- 不动 Mac 主工作区里的官网改动。

## 日志和报告

- 每份原始日志（包括 r7 那份）都要处理：
  - 用 sed 去掉 `sk-…`、`sb_publishable_…` 和 Bearer；
  - 保留含 `[codetether:desktop]`、`[codetether:lifecycle]`、`notification` 的行，以及 `[codetether:host]` 开头的报错行，`provider-unknown-notification` 不留；
  - 另存为 `.sanitized.log`，然后删掉 `.raw`。
- 追加到 `~/agenthub-archive/v4-acceptance-report-mac.md`，新开一节“第 8 轮”，写这些内容：
  - Host 退出的原因和处理方法；
  - 用的 Node 版本和它的 SHA256；
  - 每个提交的哈希和标题，各项检查结果；
  - 安装包路径和 SHA256，运行版本；
  - 每个测试的时间、日志行、截图、用户观察和按表得出的结论；
  - 修了什么、为什么；
  - 第 9 项的结论；
  - 15 项最终统计；
  - 结束时正式数据的项目、设备、会话数量；
  - 推送结果。
- 最后在回复里用中文写一段总结，并附上：
  - `git log --oneline origin/main..HEAD`；
  - `git diff --stat origin/main..HEAD`；
  - 这一轮新提交的完整 diff；
  - 脱敏日志全文。
  用户会转给 Windows 上的审核方。

## 限制

- 新增依赖要写精确版本，这一轮预计不需要新增。
- 某个操作被权限拒绝时，不绕过，写成命令交给用户在终端里运行。
- 报告用中文，不用感叹号和破折号。

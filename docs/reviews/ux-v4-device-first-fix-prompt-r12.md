# 任务：合并前在 Windows 安装版上复测系统通知（R12）

在 Windows 上运行。不改代码，只打包、交给用户安装、实测。界面以 docs/ux-redesign 为准，这是用户的临时授权，优先于 AGENTS.md 里“Figma 是唯一来源”的规定。

用户要求：界面检查由智能体直接在安装版上完成，用 UIAutomation 和只截 CodeTether 窗口的截图来判断，不把界面判断交回给用户。

开始前确认这份文件有 9 个二级标题，最后一节是“限制”。不完整就停下报告。

## 背景

- Windows 安装版现在是 R11 的 `git-835489dd3c9e`，15 项已全部通过。
- 分支 `fix/macos-notifications` 的 HEAD 是 `111f1b0b…`（`111f1b0 fix(desktop): bound macOS notification native calls`），Mac 上已经 15 项全部通过。
- 这个分支改了 Windows 和 Mac 共用的网页通知代码：
  - `apps/web/src/runtime/notifications/attention-notification-coordinator.ts`：每一步打诊断日志，窗口状态和权限检查加了 5 秒上限；
  - `apps/web/src/runtime/native/native-capabilities.ts`：原生窗口状态和权限检查加了 1 秒上限，窗口状态超时改用网页自己的状态；权限超时只在 macOS 上当作已授权，Windows 上的行为不变；
  - 新命令 `log_notification_stage`，只写一行 `[codetether:desktop] notification stage=…`。
- 单元测试在 Windows 上都通过了：Rust 80 项，网页 929 项，desktop JS 26 项。还缺在 Windows 安装版上实际弹一次通知、点一次通知。这一轮就做这件事，通过以后合并到 main。

## 第一部分：准备

1. 工作区：`D:/Projects/Software/agenthub-fix-macos-notifications`，HEAD 是分离状态，指向 `origin/fix/macos-notifications`。
   - 运行 `git fetch origin`，确认 HEAD 和 `origin/fix/macos-notifications` 都是 `111f1b0`。远端更新过就停下报告，不要切到新的提交。
   - `git status --porcelain --untracked-files=no` 没有输出。
   - 这个工作区里有之前复制进来的 `apps/web/dist` 和 `apps/desktop/src-tauri/binaries/` 下的文件，它们都在 .gitignore 里，打包时会重新生成，不用管。
2. 只读核对现在的安装版：
   - `curl -H 'Origin: http://tauri.localhost' http://127.0.0.1:4317/api/v1/bootstrap` 里的 `hostVersion` 是 `git-835489dd3c9e`；
   - 记下项目数、设备数和测试 Codex 会话的回合数，只记数量。
   - CodeTether 没在运行时不要启动它，记为“未运行”，安装后再核对。
3. 备份 R11 的安装包：把 `D:/Projects/Software/agenthub-ux-v4-device-first/apps/desktop/src-tauri/target/release/bundle/nsis/CodeTether_0.1.0-alpha.0_x64-setup.exe`（SHA256 `3771248138459A1CAF42C4B851A5CF9A153B492D76E7C3D5232690E603461589`）复制到 `D:/Projects/Software/agenthub-archive/installers/835489d/`，旁边写一个 `SHA256SUMS.txt`。哈希对不上就停下报告。

## 第二部分：打包

1. 照 `D:/Projects/Software/agenthub-ux-v4-device-first/.tmp/v4-r11-desktop-build.sh` 的写法，在这个工作区写 `.tmp/v4-r12-desktop-build.sh`：
   - 日志写到 `D:/Projects/Software/agenthub-archive/v4-r12-desktop-build.log`；
   - 只检查三项 `VITE_*` 环境变量有没有设置，不打印值；
   - 工作树不干净就不打包；
   - 日志用 sed 去掉 `sk-…`、`sb_publishable_…` 和 Bearer；
   - 不覆盖已有日志。
2. 不要设置 `CARGO_TARGET_DIR`，让产物落在这个工作区自己的 `apps/desktop/src-tauri/target/` 里，不要碰 v4 工作区的 target。
3. 记下打包用的 Node 版本（`node --version`），要求 25.5 以上。
4. 用 `bash .tmp/v4-r12-desktop-build.sh` 打包。工具需要批准时，把命令申请出来，等用户批准。被策略拒绝时，不要绕过，把命令交给用户在 Codex 外运行。三项配置缺少时停下，请用户设置，不要猜。
5. 确认构建日志里 `DESKTOP_BUILD_EXIT=0`、`REDACTION_EXIT=0`，构建号是 `git-111f1b08e5f3`。记下新安装包的路径、大小和 SHA256，并确认和 R11 的不同。

## 第三部分：安装和启动（由用户在 Codex 外做）

智能体不运行安装程序和卸载程序，也不启动或退出 CodeTether。原因见 R7：在 Codex 应用里运行安装程序，写开始菜单时会被重定向，Windows 不会登记 CodeTether。

把下面这些写给用户，然后等用户回复：
1. 从托盘退出 CodeTether。
2. 在 Claude Code 会话里运行（路径换成第二部分得到的安装包路径）：
   `! start "" "<新安装包路径>"`
   按默认选项装完。装完后如果 CodeTether 自动打开了，再从托盘退出。
3. 用带日志的方式启动：
   `! powershell.exe -NoProfile -Command "Start-Process -FilePath 'C:\Users\Administrator\AppData\Local\CodeTether\codetether-desktop.exe' -RedirectStandardError 'D:\Projects\Software\agenthub-archive\v4-r12-desktop-stderr.raw'"`
4. 回复“已安装并用日志命令启动”。

用户回复后，只读核对：
- `hostVersion` 是 `git-111f1b08e5f3`；
- Desktop 和 Host 各一个，都在安装目录里；
- `HKCU\Software\Classes\codetether\shell\open\command` 仍然指向安装目录里的 `codetether-desktop.exe "%1"`；
- 日志里有 `notification stage=sse-connected`。没有的话不要开始实测，停下报告；
- 项目数、设备数、测试会话回合数和第一部分记下的一致。

## 第四部分：实测

都在测试项目 `v4-accept-project` 的测试 Codex 会话里做，每次用安装版的输入框发“只回复 OK，不要读写文件”。

测试 B，通知中心：
1. 发送后马上最小化窗口，确认 `IsIconic=true` 后再开始等。
2. 等日志里出现这一轮的 `notification shown`，再等到出现 `notification dismissed reason=TimedOut`，最多等 60 秒。
3. 请用户按 Win+N，点最上面那条 CodeTether 通知，回复“已点击”。
4. 智能体检查：
   - 日志里有 `notification activated` 或 `notification link received result=matched`，并且有 `main_window_restored`；
   - 窗口已恢复并在前台；
   - 路由带这一轮的 `turn` 参数和 `notification-N`，只跳转一次；
   - 截一张只含会话标题栏区域的截图。
5. 用原生 Toast History 只读核对这条通知的内容：是“本地电脑 · v4-accept-project”加一句说明，没有会话标题。只记标题、上下文和说明，不保存 XML 和通知标识。

测试 C，CodeTether 退出后点通知：
1. 发第二个回合，发送后马上最小化，确认 `IsIconic=true`。
2. 等出现这一轮的 `notification shown` 和 `dismissed reason=TimedOut`。
3. 请用户从托盘退出 CodeTether。智能体确认 Desktop 和 Host 都是 0 个，连续看三次，每次间隔 500 毫秒。
4. 请用户在通知中心点这条通知，回复“已点击”。
5. 智能体检查：
   - 出现了新的 Desktop 和 Host 进程，路径正确，`hostVersion` 是 `git-111f1b08e5f3`；
   - 窗口可见并在前台；
   - 路由带这一轮的 `turn` 参数；
   - 截一张只含会话标题栏区域的截图。
   - 这次启动没有日志，根据窗口和路由判断。

两次测试都要在日志里核对诊断阶段：`received`、`window-state-start`、`window-state-done`、`metadata-start`、`metadata-done`、`permission-start`、`permission-done`、`deliver-start`、`deliver-done`，然后是 `notification requested` 和 `notification shown`。有下面这些情况就如实记下：
- 出现了 `window-state-timeout`、`permission-timeout` 或任何 `failed-…`；
- 窗口最小化了，却出现了 `skip-suppressed`。

第 9 项通过的条件：B 和 C 都打开了正确的会话，通知内容正确，日志里没有 `failed-…`。有 `…-timeout` 但通知照常送达，也算通过，在报告里写明。

## 预算和停止条件

- Codex：最多 2 个回合，B 和 C 各 1 个，回合失败不重发。Claude Code：0 个回合。
- 第 9 项不通过时，写清卡在哪一步、对应的日志行，然后停下。不在这一轮改代码。R11 的安装包已经备份，要不要装回由用户决定。
- 遇到 API 429 或 524：按 Retry-After 等待，最多重试 3 次，每次记下时间，之后停下报告。

## 不要做的事

- 不改代码，不提交。不推送，不合并，不打标签。
- 智能体不运行安装程序或卸载程序，不启动、不退出 CodeTether。
- 不改账号、Provider 选择、gateway 和 `~/.codex`。不配对，不取消配对，不新建或移除项目。
- 不改注册表、通知设置和快捷方式，不清图标缓存。
- 不删备份，不删旧安装包，不删 `v4-firstrun-data`，不运行 `git worktree remove`。

## 日志和报告

- 测完请用户从托盘退出 CodeTether，然后处理原始日志：
  - 用 sed 去掉 `sk-…`、`sb_publishable_…` 和 Bearer；
  - 保留含 `[codetether:desktop]`、`[codetether:lifecycle]`、`notification` 的行，以及 `[codetether:host]` 开头的报错行，`provider-unknown-notification` 不留；
  - 另存为 `D:/Projects/Software/agenthub-archive/v4-r12-desktop-stderr.sanitized.log`，然后只删这一个 `.raw`。
  - 最后请用户从开始菜单正常打开 CodeTether。
- 报告写到 `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r12.md`，包括：
  - 工作区 HEAD、Node 版本；
  - R11 安装包备份的位置和哈希；
  - 新安装包的路径、大小和 SHA256，构建日志的两个退出码；
  - 运行版本、注册表和数据核对结果；
  - B 和 C 的时间线（发送、完成、shown、dismissed、点击、activated 或 link、窗口恢复、路由）、诊断阶段序列和截图名；
  - 通知内容；
  - 第 9 项结论，清单累计结果。
- 截图放在 `D:/Projects/Software/agenthub-fix-macos-notifications/output/playwright/v4-installed-acceptance-r12/`。
- 最后在回复里用中文写一段总结：第 9 项是否通过，诊断阶段有没有超时或失败，新安装包的 SHA256。

## 限制

- 不读 .secrets/、任何 .env、凭据文件、machine-credentials 内容、`~/.claude.json`、`~/.codex/auth.json` 和归档里的 `phase9c-control-plane.env`。
- 不用 `rm -rf`。某个操作被权限拒绝时，不绕过，把命令写成 `! …` 交给用户。
- 报告用中文，不用感叹号和破折号。

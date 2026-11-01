# 任务：修复输入区空闲后卡在“正在重新连接”，再复测系统通知（R13）

在 Windows 上运行。界面以 docs/ux-redesign 为准，这是用户的临时授权，优先于 AGENTS.md 里“Figma 是唯一来源”的规定。

用户要求：
- 界面检查由智能体直接在安装版上完成，用 UIAutomation 和只截 CodeTether 窗口的截图来判断，不把界面判断交回给用户。
- 需要操作电脑的，智能体直接完成。被策略拒绝的命令不要绕过，写成 `! …` 交给用户。

开始前确认这份文件有 11 个二级标题，最后一节是“限制”。不完整就停下报告。

## 背景

- R12 第 9 项卡在 B 发送前：两次带日志启动后，目标会话的输入区一直显示“当前不能发送消息”和“正在重新连接 CodeTether，请等待连接恢复。”，一次正常启动后输入框可用。B 和 C 都没有做。报告在 `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r12.md`。
- 审核方在代码里找到的机制：
  - 会话 projection 存在 QueryClient 的 `['host', 'conversation-projection']` 里，由 `replaceHostProjection`（`setQueryData`）写入，用的是默认 gcTime 5 分钟；
  - 只有会话详情页用的 `useHostProjection`（`apps/web/src/runtime/host/host-runtime-hooks.ts:28-39`）把 gcTime 提到无限，而这个 hook 只在 `conversation-detail-route.tsx:261` 用到；
  - 所以启动后停在 /devices，5 分钟内没打开过会话页，projection 就会被回收；
  - 回收后 `conversation-gate-presentation.ts:40-43` 把“已连接但没有 projection”显示成“正在重新连接”，`conversation-detail-route.tsx:296-301` 在没有 projection 时直接返回；
  - HostRuntime 只在收到下一个 Host 事件时发现 projection 没了，再重新取快照（`host-runtime.ts:814-818`）。空闲时没有事件，输入区就一直卡着。
- HostRuntime 自己的连接状态一直是 connected，和日志里的 `sse-connected` 一致。
- 日志里的 `[codetether:http-error] AbortError` 是离开会话页时取消原生记录读取产生的（`local-http-server.ts:1679-1683`，`http-boundary.ts:349-351` 把它当成内部错误记录），是噪音，不是原因。这一轮不改。
- stderr 重定向和工作目录也排除了：`host_supervisor.rs:253-274` 没有设置 current_dir，两次带日志启动 Host 都在 470 毫秒内就绪。
- R12 日志没有时间戳，所以“空闲超过 5 分钟”这个时间条件还没有在安装版上实际验证。第二部分先在现在的安装版上复现一次。
- 修复：在 HostRuntime 的构造函数里，给这个 key 设置 gcTime 和 staleTime 为无限的默认值。query-core 5.102.2 的 `setQueryData` 会合并 `getQueryDefaults(queryKey)`，所以这个默认值对 `replaceHostProjection` 写入的条目生效。

## 第一部分：准备

1. 工作区：`D:/Projects/Software/agenthub-fix-macos-notifications`，HEAD 是分离状态。
   - 运行 `git fetch origin`，确认 HEAD 和 `origin/fix/macos-notifications` 都是 `111f1b08e5f398581f992212789654d802498795`。远端更新过就停下报告，不要切到新的提交。
   - `git status --porcelain --untracked-files=no` 没有输出。
   - 有已修改的已跟踪文件时，照 R12 的做法逐个和索引比较（`git show :<文件> | cmp - <文件>`）：逐字节相同的是 CRLF 误报，用 `git checkout -- <文件>` 恢复；有不同的就停下报告。
   - 记下 Node 版本（`node --version`），要求 25.5 以上。
2. 备份 R12 的安装包，第四部分打包会覆盖它：
   - 源文件：`D:/Projects/Software/agenthub-fix-macos-notifications/apps/desktop/src-tauri/target/release/bundle/nsis/CodeTether_0.1.0-alpha.0_x64-setup.exe`；
   - SHA256 应为 `ADDFCD5015CE2E4076BB6689AF3A93EC49CD5066C4ABF8441737F9BA7C874E44`，大小 26751389 字节；
   - 复制到 `D:/Projects/Software/agenthub-archive/installers/111f1b0/`，旁边写一个 `SHA256SUMS.txt`；
   - 哈希对不上就停下报告。

## 第二部分：在现在的安装版上复现（修复前基线）

目的：确认“正常启动、不打开会话页、空闲超过 5 分钟”会让输入区卡住。这一部分不发任何回合。

1. CodeTether 在运行时，智能体从托盘菜单“退出 CodeTether”正常退出，不强制结束进程。确认 Desktop 和 Host 都是 0 个，连续看三次，每次间隔 500 毫秒。
2. 请用户从开始菜单正常打开 CodeTether，回复“已打开”。R12 最后智能体从开始菜单启动没有成功，这一步交给用户。
3. 用户回复后，只读记下：
   - Desktop 进程的启动时间（UTC，精确到秒），作为计时起点；
   - `curl -H 'Origin: http://tauri.localhost' http://127.0.0.1:4317/api/v1/bootstrap` 里的 `hostVersion`，应为 `git-111f1b08e5f3`；
   - 现在的路由。应为 /devices。如果打开后已经在会话页上，这次基线无效，记下原因，跳到第三部分。
4. 等待期间只停在 /devices：不打开任何项目页或会话页，不点通知，不关窗口。
5. 启动满 6 分钟后，通过已有项目和已有会话链接进入 `v4-accept-project` 的测试 Codex 会话，记下进入时间。用 UIAutomation 读输入区：
   - 有没有“当前不能发送消息”和“正在重新连接 CodeTether”；
   - 有没有 Edit 输入控件和“发送消息”按钮；
   - 截一张只含输入区的截图。
6. 如果卡住，再等 30 秒，读一次输入区，排除刚进入时的短暂状态。
7. 结论只写“复现”或“未复现”。未复现不阻塞后面的步骤，在报告里如实写明。这次启动没有日志，空闲期间有没有 Host 事件无法确认，报告里也写明。
8. 从托盘正常退出 CodeTether，确认 Desktop 和 Host 都是 0 个，连续看三次。打包期间不要再打开它。

## 第三部分：修复

只改这两个文件：`apps/web/src/runtime/host/host-runtime.ts` 和 `apps/web/test/host-runtime.test.mjs`。

1. 先加测试，放在 `test/host-runtime.test.mjs` 里，用 `node:test` 的 mock timers（`t.mock.timers.enable({ apis: ['setTimeout'] })`）。启用要在创建 QueryClient 之前，因为回收计时器是在缓存条目创建时安排的：
   - 测试一：用文件里已有的 `createQueryClient()` 和 `FakeHostClient` 创建 `HostRuntime`（不调用 `start()`），用 `queryClient.setQueryData(hostQueryKeys.projection, …)` 写入一个 projection，`t.mock.timers.tick(301_000)`，断言 `readHostProjection(queryClient)` 仍然有值；
   - 测试二（对照）：只创建 QueryClient，不创建 HostRuntime，同样写入并 tick，断言变成 `undefined`。这一项证明 mock timers 确实驱动了回收，测试一能抓到这个问题；
   - 按文件里已有的写法用 `t.after` 收尾。
2. 先不改 `host-runtime.ts`，在 `apps/web` 里运行 `pnpm exec tsc -p tsconfig.test.json && node --test --test-concurrency=1 test/host-runtime.test.mjs`。确认测试一失败、测试二通过，记下失败信息。测试一没有失败，说明测试写得不对，先改测试，不要往下做。
3. 改 `host-runtime.ts`：在构造函数里 `this.#queryClient = options.queryClient` 的下一行加：

   ```ts
   // The Conversation projection is runtime-owned state, not a disposable
   // cached read. Default gcTime would drop it after 5 minutes without a
   // mounted Conversation page and leave the composer gated as reconnecting.
   this.#queryClient.setQueryDefaults(hostQueryKeys.projection, {
     gcTime: Number.POSITIVE_INFINITY,
     staleTime: Number.POSITIVE_INFINITY,
   })
   ```

   `hostQueryKeys` 已经从 `./host-query.js` 导入，不用加导入。
4. 不改 `conversation-gate-presentation.ts`、`conversation-detail-route.tsx`、`host-runtime-hooks.ts`，也不改 AbortError 的记录方式。
5. 在 `apps/web` 里验证：
   - `pnpm test`：全部通过，比改之前多 2 项；
   - `pnpm typecheck`：没有错误；
   - `pnpm exec eslint src/runtime/host/host-runtime.ts test/host-runtime.test.mjs`：没有新的错误或警告。
   有问题只在这两个文件里修。修不好就停下报告。
6. `git diff --stat` 只有这两个文件。提交（HEAD 是分离状态，直接在上面提交）：

   ```text
   fix(web): keep Host projection cache alive while idle

   The Conversation projection used the default 5 minute gcTime unless a
   Conversation page was mounted. After it was collected the composer
   showed "reconnecting" until the next Host event arrived.

   Co-Authored-By: Claude Code <noreply@anthropic.com>
   ```
7. 推送前再 `git fetch origin`，确认 `origin/fix/macos-notifications` 仍是 `111f1b0`。变了就停下报告，不推送。然后快进推送，不加 force：
   `git push origin HEAD:refs/heads/fix/macos-notifications`
   被策略拒绝时，把这条命令写成 `! git -C D:/Projects/Software/agenthub-fix-macos-notifications push origin HEAD:refs/heads/fix/macos-notifications` 交给用户，不用等推送完成，继续打包。
8. 记下新提交的完整哈希和前 12 位，下面用 `<新提交>` 和 `<新构建号>`（`git-` 加前 12 位）表示。

## 第四部分：打包

1. 照 R12 的两个脚本，在这个工作区写 `.tmp/v4-r13-desktop-build.sh` 和 `.tmp/v4-r13-desktop-build.mjs`：
   - `.sh`：日志写到 `D:/Projects/Software/agenthub-archive/v4-r13-desktop-build.log`，`task_expected_commit` 是 `<新提交>`，`task_expected_build` 是 `<新构建号>`，其余照抄。不覆盖已有日志；
   - `.mjs`：继续读 `.tmp/v4-r12-build-config.json`，不复制、不改、不打印它的内容；启动 `.tmp/v4-r13-desktop-build.sh`，提示文字里的 R12 改成 R13。
2. 不要设置 `CARGO_TARGET_DIR`。
3. 用 `node .tmp/v4-r13-desktop-build.mjs` 打包。工具需要批准时，把命令申请出来，等用户批准。被策略拒绝时，交给用户在 Codex 外运行。
4. 确认：
   - 构建日志里 `DESKTOP_BUILD_EXIT=0`、`REDACTION_EXIT=0`；
   - 构建号是 `<新构建号>`，没有 `-dirty`；
   - 打包后重新生成的 TOML 和 `Cargo.toml` 照第一部分的做法处理，处理完工作树干净；
   - 记下新安装包的路径、大小和 SHA256，确认和 R12 的不同。

## 第五部分：安装和启动（由用户在 Codex 外做）

智能体不运行安装程序和卸载程序。原因见 R7：在 Codex 应用里运行安装程序，写开始菜单时会被重定向，Windows 不会登记 CodeTether。

这一轮仍用带日志的方式启动。R12 两次卡住都是在这种启动方式下，修复后在同样条件下通过，才能同时说明 stderr 重定向不是原因。

把下面这些写给用户，然后等用户回复：
1. 在 Claude Code 会话里运行（路径换成第四部分得到的安装包路径）：
   `! start "" "<新安装包路径>"`
   按默认选项装完。装完后如果 CodeTether 自动打开了，从托盘退出。
2. 用带日志的方式启动：
   `! powershell.exe -NoProfile -Command "Start-Process -FilePath 'C:\Users\Administrator\AppData\Local\CodeTether\codetether-desktop.exe' -RedirectStandardError 'D:\Projects\Software\agenthub-archive\v4-r13-desktop-stderr.raw'"`
3. 回复“已安装并用日志命令启动”。

用户回复后，只读核对：
- `hostVersion` 是 `<新构建号>`；
- Desktop 和 Host 各一个，都在安装目录里；记下 Desktop 进程的启动时间（UTC，精确到秒）；
- `HKCU\Software\Classes\codetether\shell\open\command` 仍然指向安装目录里的 `codetether-desktop.exe "%1"`；
- 日志里有 `notification stage=sse-connected`。没有的话不要开始实测，停下报告；
- 项目数、设备数和测试会话回合数，和 R12 记下的一致（项目 5、设备 3、回合 11）。不一致就如实记下，不要改数据；
- 现在的路由是 /devices。

## 第六部分：实测

都在测试项目 `v4-accept-project` 的测试 Codex 会话里做。

测试 A，空闲后的输入区（不发送）：
1. 启动后只停在 /devices，不打开任何项目页或会话页。
2. Desktop 启动满 6 分钟后，通过已有项目和已有会话链接进入测试会话，记下进入时间。
3. 用 UIAutomation 确认：有 Edit 输入控件和“发送消息”按钮，没有“当前不能发送消息”和“正在重新连接 CodeTether”。截一张只含输入区的截图。
4. 输入区卡住时，再等 30 秒读一次。仍然卡住就截图，停下报告，不做 B 和 C。

测试 B 和 C 照 R12 第四部分做，每次用安装版的输入框发“只回复 OK，不要读写文件”。文件在 `D:/Projects/Software/agenthub/docs/reviews/ux-v4-device-first-fix-prompt-r12.md`。和 R12 不同的地方：
- C 第 5 步核对的 `hostVersion` 是 `<新构建号>`；
- B 和 C 里的“已点击”仍由用户在通知中心点，智能体不代点；
- C 第 3 步的退出可以由智能体从托盘完成，然后确认 Desktop 和 Host 都是 0 个，连续看三次。

诊断阶段的核对和 R12 一样：`received`、`window-state-start`、`window-state-done`、`metadata-start`、`metadata-done`、`permission-start`、`permission-done`、`deliver-start`、`deliver-done`，然后是 `notification requested` 和 `notification shown`。有 `window-state-timeout`、`permission-timeout`、任何 `failed-…`，或者窗口最小化了却出现 `skip-suppressed`，都如实记下。C 那次启动没有日志，根据窗口和路由判断。

第 9 项通过的条件：A 通过；B 和 C 都打开了正确的会话；通知内容是“本地电脑 · v4-accept-project”加一句说明，没有会话标题；日志里没有 `failed-…`。有 `…-timeout` 但通知照常送达，也算通过，在报告里写明。

## 预算和停止条件

- Codex：最多 2 个回合，B 和 C 各 1 个，回合失败不重发。Claude Code：0 个回合。第二部分和测试 A 不发送。
- 第二部分未复现：照常往下做，在报告里写明。
- 第三部分测试或检查修不好：停下报告，不打包。
- 测试 A 不通过：停下报告，不做 B 和 C，不再改代码。
- 第 9 项不通过：写清卡在哪一步、对应的日志行，然后停下。R12 的安装包已经备份，要不要装回由用户决定。
- 遇到 API 429 或 524：按 Retry-After 等待，最多重试 3 次，每次记下时间，之后停下报告。

## 不要做的事

- 只改第三部分列出的两个文件。只提交一次，只推送到 `fix/macos-notifications`，快进，不加 force。不合并到 main，不打标签，不开 PR，不碰其他分支。
- 智能体不运行安装程序或卸载程序。退出 CodeTether 只用托盘菜单，不强制结束进程。
- 不改账号、Provider 选择、gateway 和 `~/.codex`。不配对，不取消配对，不新建或移除项目。
- 不改注册表、通知设置和快捷方式，不清图标缓存。
- 不删备份，不删旧安装包，不删 `v4-firstrun-data`，不运行 `git worktree remove`。

## 日志和报告

- 带日志启动的进程退出后（C 第 3 步，或者测试 A 不通过时由智能体从托盘退出），处理原始日志：
  - 用 sed 去掉 `sk-…`、`sb_publishable_…` 和 Bearer；
  - 保留含 `[codetether:desktop]`、`[codetether:lifecycle]`、`notification` 的行，以及 `[codetether:host]` 开头的报错行，`provider-unknown-notification` 不留；
  - 另存为 `D:/Projects/Software/agenthub-archive/v4-r13-desktop-stderr.sanitized.log`，然后只删这一个 `.raw`。
- 测完 CodeTether 保持打开（C 里由通知启动的那个）。如果已经关了，请用户从开始菜单正常打开。
- 报告写到 `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r13.md`，包括：
  - 工作区 HEAD、Node 版本，R12 安装包备份的位置和哈希；
  - 第二部分：启动时间、进入会话的时间、输入区读数、截图名，复现或未复现；
  - 第三部分：修复前测试一的失败信息，修复后的测试数、typecheck 和 lint 结果，新提交哈希，推送结果（已推送，或交给用户的命令）；
  - 新安装包的路径、大小和 SHA256，构建日志的两个退出码；
  - 运行版本、注册表和数据核对结果；
  - 测试 A 的启动时间、进入时间、输入区读数和截图名；
  - B 和 C 的时间线（发送、完成、shown、dismissed、点击、activated 或 link、窗口恢复、路由）、诊断阶段序列和截图名；
  - 通知内容；
  - 第 9 项结论，清单累计结果。
- 截图放在 `D:/Projects/Software/agenthub-fix-macos-notifications/output/playwright/v4-installed-acceptance-r13/`。
- 最后在回复里用中文写一段总结：基线是否复现，测试 A 是否通过，第 9 项是否通过，新提交哈希，新安装包的 SHA256。

## 限制

- 不读 .secrets/、任何 .env、凭据文件、machine-credentials 内容、`~/.claude.json`、`~/.codex/auth.json` 和归档里的 `phase9c-control-plane.env`。
- 不打开、不打印 `.tmp/v4-r12-build-config.json` 的内容，只由启动器传给构建子进程。
- 不用 `rm -rf`。某个操作被权限拒绝时，不绕过，把命令写成 `! …` 交给用户。
- 报告用中文，不用感叹号和破折号。

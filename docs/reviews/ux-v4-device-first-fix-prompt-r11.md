# 任务：通知点击改用 codetether:// 链接打开会话

分支 `ux/v4-device-first`，工作区 `D:/Projects/Software/agenthub-ux-v4-device-first`，起点必须是 `bb1d55b922753f08ea037d25fc3a4cd7063aa583`，跟踪工作树干净，否则停下报告。界面以 docs/ux-redesign 为准，这是用户的临时授权，优先于 AGENTS.md 里“Figma 是唯一来源”的规定。

用户要求：界面检查由智能体直接在安装版上完成，不把界面判断交回给用户。

R10 的结果见 `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r10.md`，审核意见见 `docs/reviews/ux-v4-device-first.md` 的“第 10 轮”。在通知中心点 CodeTether 通知，进程内的 `Activated` 回调没有触发，窗口也没有恢复。用户选了这个修法：安装时登记 `codetether://` 链接，通知点击时由 Windows 打开这个链接。

## 设计

1. 通知 XML：`<toast>` 加上 `activationType="protocol"` 和 `launch="codetether://notification/<attentionId>"`。链接里只放 attention ID，不放会话标题、项目名或正文。进程内的 `Activated` 回调保留，横幅还在时它可能先触发。
2. 登记链接：安装时在当前用户下登记 `codetether` 协议，打开命令是安装目录里的 `codetether-desktop.exe "%1"`，卸载时删掉。
   - 先查 `@tauri-apps/cli` 2.11.4 对应的 tauri-bundler 的 NSIS 模板支不支持 `plugins.deep-link.desktop.schemes`，会不会在卸载时清理。支持的话用官方 `tauri-plugin-deep-link`，版本要和 tauri 2.11.5 匹配，写精确版本。`tauri-plugin-single-instance` 打开 `deep-link` 功能。
   - 模板不支持时，改用 NSIS 安装钩子写 `HKCU\Software\Classes\codetether`，卸载钩子删掉。不加插件。
   - 选了哪种、查到的依据，写进报告。
3. 收到链接：
   - CodeTether 正在运行时，Windows 启动的第二个进程会被单实例插件交给已有进程。已有进程解析链接，从内存里按 attention ID 找到对应的通知意图，走现有的 `activate_notification`，恢复窗口并跳到那个回合。
   - 内存里找不到这个 ID 时，例如重启过，只恢复窗口，另外把 attention ID 交给前端。前端用 Host 已有的 attention 接口查出会话和回合再跳转，查不到就停在当前页面。先确认 Host 现有接口能按 ID 查到会话和回合，不能的话只恢复窗口，在报告里写明，不要为此改 Host。
   - CodeTether 没在运行时，Windows 直接用链接启动它。启动完成后按上一条处理。
4. 防重复：同一个 attention 的 `Activated` 回调和链接可能都会来，只能跳转一次。用现有的 attention ID 去重。
5. 安全：任何程序和网页都能打开这个链接，所以链接只能做“打开窗口、跳到会话”这一件事。
   - 格式严格是 `codetether://notification/<attentionId>`，ID 用现有的 `is_public_id(…, "attn_")` 校验，长度有上限。
   - 不认识的路径、多余的查询参数和片段，一律只恢复窗口，不做别的。
   - 不确认、不消除、不批准任何提醒，不发送任何回合。
   - 日志只记 `[codetether:desktop] notification link received result=<matched|unmatched|invalid>`，不记链接全文和 ID。
6. 开发构建（target/release 下运行、用 PowerShell AppID）不登记链接。现在的判断保持不变。

## 测试

单元测试：
- 链接解析：合法、ID 格式错误、太长、路径不对、多了查询参数或片段、大小写变体、编码字符、空值。
- 通知 XML 带上 `activationType` 和 `launch`，并且做了转义。
- 同一个 attention 回调和链接都到时，只放行一次。
- 单实例转来的参数里有链接时，走链接处理；没有链接时，保持现在的“恢复窗口”。
- 前端：用 attention ID 查到会话就跳转；查不到不跳。

改动按功能分成一到两个提交，跑四项门禁、Rust 测试、`cargo fmt --check`，改过的文件用 prettier 检查。全仓 `pnpm format:check` 的 CRLF 问题不在这一轮处理。

## 打包和安装

- 打包脚本照 R10 的写法另存为 `.tmp/v4-r11-desktop-build.sh`，日志写到 `agenthub-archive/v4-r11-desktop-build.log`。打包前把 R10 安装包（`D210320D…`）连同 SHA256SUMS.txt 复制到 `agenthub-archive/installers/bb1d55b/`。需要批准时把命令申请出来等用户批准。
- 智能体不运行安装程序和卸载程序。请用户从托盘退出 CodeTether，在 Codex 外用 `!` 命令安装：
  `! start "" "D:\Projects\Software\agenthub-ux-v4-device-first\apps\desktop\src-tauri\target\release\bundle\nsis\CodeTether_0.1.0-alpha.0_x64-setup.exe"`
  装完后如果自动打开了，请用户从托盘退出，再用日志命令启动：
  `! powershell.exe -NoProfile -Command "Start-Process -FilePath 'C:\Users\Administrator\AppData\Local\CodeTether\codetether-desktop.exe' -RedirectStandardError 'D:\Projects\Software\agenthub-archive\v4-r11-desktop-stderr.raw'"`
- 用户回复后只读核对：运行版本是新提交的前 12 位；`HKCU\Software\Classes\codetether` 存在，打开命令指向安装目录；Desktop 和 Host 各一个；数据数量和 R10 结束时一致。

## 实测

都在测试项目 `v4-accept-project` 的 Codex 会话里，每轮发 1 个只读回合（例如“只回复 OK，不要读写文件”），发完最小化窗口，确认 `IsIconic=true`。点击都由用户来点，结果由智能体判断。

测试 B，通知中心（最重要）：等日志出现 `dismissed reason=TimedOut`，再请用户按 Win+N 点最上面那条 CodeTether 通知。

测试 A，横幅：先告诉用户横幅只停留约 6 秒，回合大约 2 分钟完成，请用户盯住屏幕右下角，弹出就点。错过了就如实记录，不补发回合。

测试 C，CodeTether 没在运行：测试 B 之后，请用户从托盘退出 CodeTether，再在通知中心点测试 A 或 B 留下的那条通知。这一项不用发回合。CodeTether 会被 Windows 启动，这次没有日志，结果从窗口和路由判断。

每次点击后记下：日志里的 `notification activated` 和 `notification link received`，`main_window_restored` 或 `could not restore`，窗口是否恢复并在前台，路由里有没有这一轮的 `turn` 参数和 `notification-N`，同一个 attention 有没有跳转两次。通过的话截一张只含会话标题栏区域的截图。

链接安全，由智能体用只读方式验证：在 CodeTether 运行时，用 `Start-Process 'codetether://notification/attn_invalid'` 和 `Start-Process 'codetether://other'` 各打开一次。确认只恢复窗口，没有跳转，提醒状态不变，日志是 `invalid` 或 `unmatched`。这两条命令打开的是 CodeTether 自己，不算启动应用的违规操作。如果被权限拒绝，交给用户用 `!` 运行。

第 9 项通过的条件：测试 B 和 C 都打开了正确的会话。测试 A 通过更好，错过不影响结论。

## 预算和停止条件

- Codex：最多 2 个回合，测试 B 和测试 A 各 1 个。回合失败不重发。
- Claude Code：0 个回合。
- 测试 B 失败时，做完测试 C 和链接安全验证后停下，写清卡在哪一步，不在这一轮继续改。
- 遇到 API 429 或 524：按 Retry-After 等待，最多重试 3 次，每次记下时间，之后停下报告。

## 不要做的事

- 只改通知、链接处理、单实例、安装登记相关的代码、配置和测试，不改 Host。
- 不加 COM 激活器，不改快捷方式。
- 智能体不运行安装程序或卸载程序，不退出 CodeTether。除了上面的链接安全验证，不用其他方式启动它。
- 不改账号、Provider 选择、gateway 和 `~/.codex`。
- 智能体不手动写注册表，不改通知设置，不清图标缓存。登记链接只能由安装程序完成。
- 不删 Codex 包目录里的旧快捷方式，不删测试项目、测试会话和 `v4-firstrun-data`。
- 不推送，不合并，不打标签。

## 日志和报告

- 用户退出 CodeTether 后，原始日志用 sed 去掉 `sk-…`、`sb_publishable_…` 和 Bearer，只保留启动、通知、链接和窗口相关的行，另存脱敏副本，然后只删这个 `.raw`。
- 报告写到 `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r11.md`，包括：链接登记方式的选择和依据，提交哈希和检查结果，新安装包的 SHA256，注册表核对结果，A、B、C 三次测试的时间线和截图名，链接安全验证结果，第 9 项结论和清单累计结果。
- 截图放在 `output/playwright/v4-installed-acceptance-r11/`。

## 限制

- 不读 .secrets/、任何 .env、凭据文件、machine-credentials 内容、`~/.codex/auth.json` 和 ~/.claude.json。
- 新加依赖写精确版本，只用 Tauri 官方插件。
- 某个操作被权限拒绝时，不绕过，把命令写成 `! …` 交给用户。
- 报告用中文，不用感叹号和破折号。
- 提交结尾写 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。

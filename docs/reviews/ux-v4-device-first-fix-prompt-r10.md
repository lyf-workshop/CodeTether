# 任务：查清点击通知为什么没有打开会话

分支 `ux/v4-device-first`，工作区 `D:/Projects/Software/agenthub-ux-v4-device-first`，起点必须是 `9800ae2f8b7dc44c73317aeb2afa7cb61ed53b17`，跟踪工作树干净，否则停下报告。界面以 docs/ux-redesign 为准，这是用户的临时授权，优先于 AGENTS.md 里“Figma 是唯一来源”的规定。

用户要求：界面检查由智能体直接在安装版上完成，不把界面判断交回给用户。

R9 的结果见 `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r8.md` 第 22 节，审核意见见 `docs/reviews/ux-v4-device-first.md` 的“第 9 轮”。通知能生成，文案正确。用户在通知中心点了通知，CodeTether 还是最小化，路由没有变。

## 背景和假设

Windows 下点击通知只走一条路：`apps/desktop/src-tauri/src/attention_notifications.rs` 里注册的 `ToastNotification.Activated` 事件，触发后调用 `activate_notification` 恢复窗口并发送定位意图。通知的 XML 里没有 `launch` 参数，安装时也没有注册 COM 激活器（快捷方式上没有 `ToastActivatorCLSID`）。

R9 的点击发生在回合完成 10 分钟之后，横幅早已超时，点的是通知中心里的那一条。微软文档说，没有 COM 激活器的桌面应用，通知进入通知中心以后再点击，不保证能回调到进程内的 `Activated` 事件。代码里 `:354` 的注释假设“横幅超时后在通知中心仍然可以点击”，这个假设没有经过实测。

所以这一轮要分开测两种点击：横幅还在时点横幅，和横幅超时后在通知中心点。这还只是假设，以实测为准。另一种可能是 `Activated` 触发了，但恢复窗口这一步失败。现在这两种情况在日志里分不出来，所以先加日志。

## 第一部分：加诊断日志

在 `attention_notifications.rs` 里加两行日志，不记通知内容和任何标识：
- `Activated` 回调一进来就打一行 `[codetether:desktop] notification activated type=<类型>`，放在 `activation_flag` 判断前面。重复触发也要打，另外记一个 `repeat=true|false`。
- `Dismissed` 回调打一行 `[codetether:desktop] notification dismissed reason=<TimedOut|UserCanceled|ApplicationHidden|unknown>`。

照 `notification_shown_log` 的写法做成小函数，加单元测试。窗口恢复成功时已经有 `[codetether:lifecycle]` 的 `main_window_restored`，失败时有 `could not restore the main window`，不用再加。

一个提交，例如 `fix(desktop): log notification activation and dismissal`。按原来的方式跑四项门禁和 Rust 测试，改过的文件用 prettier 和 `cargo fmt --check` 检查。

## 第二部分：打包，用户在 Codex 外安装

- 打包用 `.tmp/v4-r8-desktop-build.sh` 的同样写法，另存为 `.tmp/v4-r10-desktop-build.sh`，日志写到 `agenthub-archive/v4-r10-desktop-build.log`。打包前把 R8 安装包（`6A454BB5…`）复制到 `agenthub-archive/installers/9800ae2/`，连同 SHA256。打包需要用户批准时，把命令申请出来等用户批准，不要绕过。
- 智能体不运行安装程序和卸载程序。请用户从托盘退出 CodeTether，在 Codex 外双击新安装包装好，然后在 Codex 外用这条命令启动，抓 Desktop 日志：
  `! powershell.exe -NoProfile -Command "Start-Process -FilePath 'C:\Users\Administrator\AppData\Local\CodeTether\codetether-desktop.exe' -RedirectStandardError 'D:\Projects\Software\agenthub-archive\v4-r10-desktop-stderr.raw'"`
- 用户回复后，只读核对运行版本是新提交的前 12 位，Desktop 和 Host 各一个，数据数量和 R9 结束时一致。

## 第三部分：两种点击分开测

两次都在测试项目 `v4-accept-project` 的 Codex 会话里，各发 1 个只读回合（例如“只回复 OK，不要读写文件”），发完最小化窗口，确认 `IsIconic=true`。两次点击都由用户来点，事先把步骤写清楚，结果由智能体读日志和窗口状态判断。

测试 A，点横幅：
1. 发送前请用户准备好：回合完成后屏幕右下角会弹出横幅，看到就马上点它。
2. 智能体记下 `notification shown` 的时间，等用户回复“已点击横幅”。

测试 B，在通知中心点：
1. 回合完成后先不要点。智能体等日志里出现这条通知的 `notification dismissed reason=TimedOut`，最多等 60 秒。
2. 然后请用户按 Win+N，点最上面那条 CodeTether 通知，回复“已点击”。

每次点击后，智能体记下：
- 日志里有没有 `notification activated`，有没有 `main_window_restored` 或 `could not restore`；
- 窗口是否已恢复并在前台（`IsIconic`、前台窗口）；
- 路由里有没有这次回合的 `turn` 参数和 `notification-N` hash；
- 通过的话，截一张只含会话标题栏区域的截图。

测试 A 失败时，也照样做测试 B，然后停下。

## 结论怎么写

报告里按下面四种情况之一写结论，不要自己修：
1. A 和 B 都通过：第 9 项通过。
2. A 通过，B 日志里没有 `activated`：假设成立。只写清证据，修法由我和用户决定。
3. 有 `activated`，但没有恢复窗口，或者恢复了但路由没变：写清卡在哪一步，对应到代码位置。
4. 都不属于：如实写观察到的。

## 预算和停止条件

- Codex：最多 2 个回合，测试 A 和测试 B 各 1 个。回合失败不重发。
- Claude Code：0 个回合。
- 遇到 API 429 或 524：按 Retry-After 等待，最多重试 3 次，每次记下时间，之后停下报告。

## 不要做的事

- 只改第一部分说的文件和测试。不改通知 XML、快捷方式和安装脚本，不加 COM 激活器。
- 智能体不运行安装程序或卸载程序，不启动、不退出 CodeTether。
- 不改账号、Provider 选择、gateway 和 `~/.codex`。
- 不改注册表和通知设置，不清图标缓存。
- 不删 Codex 包目录里的旧快捷方式，不删测试项目、测试会话和 `v4-firstrun-data`。
- 不推送，不合并，不打标签。

## 日志和报告

- 用户退出 CodeTether 后，原始日志用 sed 去掉 `sk-…`、`sb_publishable_…` 和 Bearer，只保留 `[codetether:desktop]` 和 `[codetether:lifecycle]` 里和启动、通知、窗口有关的行，另存脱敏副本，然后只删这个 `.raw`。
- 报告写到 `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r10.md`，包括：提交哈希和检查结果，新安装包的 SHA256，运行版本，两次测试的时间线（发送、完成、shown、dismissed、点击、activated、窗口恢复、路由）和截图名，按上面四种情况写的结论，清单累计结果。
- 截图放在 `output/playwright/v4-installed-acceptance-r10/`。

## 限制

- 不读 .secrets/、任何 .env、凭据文件、machine-credentials 内容、`~/.codex/auth.json` 和 ~/.claude.json。
- 某个操作被权限拒绝时，不绕过，把命令写成 `! …` 交给用户。
- 报告用中文，不用感叹号和破折号。
- 提交结尾写 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。

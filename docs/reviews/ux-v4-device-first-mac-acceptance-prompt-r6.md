# 任务：Mac 第 6 轮（查清“系统接受了通知却不显示”）

在 Mac 上运行。不改代码，不重新打包，不重装。先读 `~/agenthub-archive/v4-acceptance-report-mac.md` 里第 1 到 5 轮的记录。界面以 docs/ux-redesign 为准，这是用户的临时授权，优先于 AGENTS.md 里“Figma 是唯一来源”的规定。

用户要求：界面检查由智能体直接完成，不把界面判断交回给用户。下面几处必须请用户看屏幕，是因为要确认系统通知有没有出现，智能体截图也要同时核对。

开始前只读核对：`/Applications/CodeTether.app` 运行的构建是 `git-a8abbecc12ea`，正式数据是 11 个项目、2 台设备、25 个会话。不一致就停下报告。

## 背景

第 5 轮的日志里依次有 `notification requested`、`authorization result=granted`、`notification shown … platform=macos`，重启后还有 `authorization status=authorized`。这说明网页已经调用了发通知，macOS 已经授权，`addNotificationRequest` 也没有报错。但屏幕上和通知中心里都看不到这条通知。代码里没有删除已送达通知的调用，通知内容只有标题和正文。

剩下的可能都在系统那边：
1. 系统整体不弹横幅。比如屏幕正在被共享、远程控制或镜像，macOS 默认这时不弹通知。
2. 同一个 bundle id `com.codetether.desktop` 在系统里登记了好几份 App：安装版、两份备份、两个构建目录里的 App，可能还有 DMG。它们都是临时签名，签名各不相同，通知服务可能对不上正在运行的那一份，就把通知丢了。
3. 第 3 到第 5 轮为了抓日志，都是在终端里直接运行 App 里面的可执行文件，没有通过系统正常启动（LaunchServices）。这可能影响通知归属到哪个 App。
4. 第 4 轮的 `log stream` 没加 `--level debug`。usernoted 的记录大多是 info 和 debug 级，所以那次日志是空的，不能说明系统没收到通知。

这一轮的目标是确定是哪一种。

## 第一部分：只读核对

1. 运行 `codesign -dv --verbose=4 /Applications/CodeTether.app 2>&1`，记下 Identifier、Signature、CDHash、TeamIdentifier 这几行。
2. 列出系统登记的同一 bundle id 的所有 App：
   `/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -dump | grep -B5 -A5 'com.codetether.desktop' | grep -E '^\s*path:'`
   只记下路径。
3. 运行 `defaults read com.apple.ncprefs apps`，只摘出 `bundle-id = "com.codetether.desktop"` 那一段的字段，其他 App 的设置一概不记。
4. 请用户回答两件事，只记下，不让用户改：
   - 现在是不是通过屏幕共享、远程桌面或投屏在操作这台 Mac？
   - “系统设置 > 通知”里“镜像或共享显示器时允许通知”是开着还是关着？

## 第二部分：对照通知，不用回合

1. 运行：`osascript -e 'display notification "诊断用测试通知" with title "通知对照"'`
2. 马上截屏幕右上角的一小块区域，同时请用户看屏幕右上角和通知中心，回复“看到了”或“没看到”。
3. 用户没看到，说明系统整体不弹通知（屏幕共享、专注模式等），不是 CodeTether 的问题。写清楚原因，跳过第三、四部分，直接写报告。

## 第三部分：通过系统正常启动再测

1. 请用户从菜单栏退出 CodeTether，确认 Desktop、Host 和 Host guardian 都退出了。
2. 智能体用下面的命令启动。这样是通过系统正常启动，同时保留日志：
   `open -a /Applications/CodeTether.app --stderr ~/agenthub-archive/v4-mac-r6-desktop-stderr.raw`
3. 只读核对运行构建和数据数量。
4. 在另一个终端开始抓系统通知日志，回合结束 60 秒后停止：
   `log stream --level debug --style compact --predicate 'process == "usernoted" OR process == "NotificationCenter" OR subsystem == "com.apple.UserNotifications"' > ~/agenthub-archive/v4-mac-r6-usernoted-1.raw`
5. 回合 1：在测试项目 `v4 Mac Acceptance Test` 的测试 Codex 会话里，用键盘发“只回复 OK，不要读写文件”。发送后马上请用户点一下访达，挡住 CodeTether。
6. 回合完成后 60 秒内：截屏幕右上角；请用户看屏幕和通知中心；记下 Desktop 日志里新增的含 `notification` 的行；然后停止 log stream。
7. 通知出现了：内容应该是“设备 · 项目”加一句说明，没有会话标题。接着用回合 2 按第 5 轮的测试 3 和测试 4 补测点击：运行中点击一次；然后请用户退出 CodeTether，再在通知中心点一次。注意回合 2 只能用一次，两次点击要用回合 1 和回合 2 各自产生的通知。两次都打开了正确的会话，第 9 项就通过。
8. 通知没出现：记下 usernoted 日志里含 codetether 的行，然后做第四部分。

## 第四部分：同一 bundle id 的多份登记

只有同时满足两个条件才做：第一部分第 2 步列出了不止一个路径，并且第三部分还是没出通知。

1. 把列出的路径告诉用户，标明哪些是备份、哪些是构建目录。请用户决定，要不要把这些不用的副本从系统登记里注销：`lsregister -u <路径>`。只注销备份和构建目录里的副本，不动 `/Applications/CodeTether.app`。注销只是去掉系统登记，不删文件，以后可以用 `lsregister -f <路径>` 恢复。
2. 用户同意后，由用户自己在终端运行；或者用户明确授权，由智能体运行。
3. 然后运行 `lsregister -f /Applications/CodeTether.app`。请用户退出 CodeTether，按第三部分第 2 步重新启动，用回合 2 按第三部分第 4 到 7 步再测一次，日志文件名改成 `-2`。
4. 如果第三部分已经用掉了回合 2，就不再测，写清楚。

## 图标

如果第 5 轮还没截 Dock 和菜单栏上的 CodeTether 图标，这一轮顺带补上：用 `screencapture -R` 只截图标所在的小块区域，确认是紫色双卡片。

## 预算和停止条件

- Codex：最多 2 个回合。Claude Code：0 个回合。回合失败不重发。
- 遇到 API 429 或 524：按 Retry-After 等待，最多重试 3 次，每次记下时间，之后停下报告。

## 不要做的事

- 不改代码，不提交，不推送，不重装，不重新打包。
- 不改账号、Provider 选择、gateway、`~/.codex` 和 `~/.claude`。
- 智能体不改通知权限、专注模式、镜像时通知的设置和 Gatekeeper，这些只读不改。
- 不删任何 App 副本和备份。第四部分的注销登记只在用户同意后做。
- 不清通知数据库，不清图标缓存。

## 日志和报告

- 测完请用户退出 CodeTether，然后处理日志，最后请用户正常打开 CodeTether：
  - Desktop 日志：用 sed 去掉 `sk-…`、`sb_publishable_…` 和 Bearer，只保留含 `[codetether:desktop]`、`[codetether:lifecycle]` 和 `notification` 的行。
  - usernoted 日志：只保留含 `codetether` 的行（不区分大小写），并记下原始日志的总行数。
  - 两种日志都另存为 `.sanitized.log`，然后删掉 `.raw`。
- 追加到 `~/agenthub-archive/v4-acceptance-report-mac.md`，新开一节“第 6 轮”，写这些内容：
  - 第一部分的签名信息、登记路径列表、ncprefs 里 CodeTether 那一段、屏幕共享和镜像设置的情况；
  - 对照通知的结果；
  - 第三部分每个回合的时间、观察和日志行；
  - 第四部分有没有做，做了的结果；
  - 图标结果；
  - 15 项最终统计；
  - 结束时正式数据的项目、设备、会话数量。
- 最后在回复里用中文写一段总结，附上脱敏日志全文和 lsregister 路径列表。用户会转给 Windows 上的审核方。

## 限制

- 不读 .secrets/、任何 .env、凭据文件、machine-credentials 内容、`~/.codex/auth.json`、`~/.claude.json` 和 `~/agenthub-work/v4-build.env`。
- 某个操作被权限拒绝时，不绕过，写成命令交给用户在终端里运行。
- 报告用中文，不用感叹号和破折号。

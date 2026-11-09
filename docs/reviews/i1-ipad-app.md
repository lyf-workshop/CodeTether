# 审核记录：i1/ipad-app

## 真机验收（30e8b9f，2026-11-08）

报告：`~/agenthub-archive/i1-report.md` 的"真机验收（30e8b9f）"。iPad Air 11-inch (M4)、iPadOS 27.2，Mac 安装版 `git-fd1d90540450`。

- 经互联网的连接检查通过；只读页面和旋转通过。
- 新建会话失败，"当前会话不支持此操作"。执行代理找的根因我核对过，是对的：`SupervisorClient.swift:280` 从 AI 工具的能力里读 `providerExecution`，这个字段在设备的能力里（`packages/protocol/src/machines.ts:38`）。`readWorkspace`（`:644`）读的位置是对的。模拟器的假数据把字段放错了地方，所以测试没发现。
- 经互联网的其余业务、断网恢复、移除复配、外观和键盘没做，等修完。

另外读代码找到几个可用性问题（后台刷新禁用输入框、轮询失败反复弹窗、新消息把人拉到底、横屏打开变更面板侧栏不收起、被移除页的电脑名），连同上面的根因都放进 r4（`docs/reviews/i1-fix-prompt-r4.md` 第 6 到 10、13 项），详见 `docs/ux-redesign/09-tablet-usability.md` §6。r4 之后做真机交互测试：`docs/reviews/i1-ipad-interaction-test-prompt.md`。

## r3 及真机修复（2026-11-07）

审核对象：`origin/i1/ipad-app` 上 `90cd7f5` 之后的 `5004eb9`、`a82162f`（r3 登录配置）、`8d5707d`（毫秒时间）、`e2bba61`（配对忙碌状态）、`30e8b9f`（连接检查）。任务：`docs/reviews/i1-fix-prompt-r3.md`。

结论：没有“必须改”，可以继续真机验收。

核对过、没有问题的：

- **根因修对了**：`generate-local-config.mjs` 把 `://` 写成 `:/$()/`，避开 xcconfig 把 `//` 当注释；带空白或引号的值直接报错。`Base.xcconfig` 删掉了和 `Info.plist` 重复的 `INFOPLIST_KEY_*`。
- **构建后检查**：`verify-build-config.mjs` 读最终 `.app` 里的 `Info.plist`，规则和 `Configuration.swift` 一致（https 来源、密钥字符集和长度、Relay 要么全有要么全无），只输出“存在、形状正确”和两个主机名，不输出密钥和指纹。
- **时间解析**：`TabletTimestamp.parse` 先试带毫秒、再试不带，四处旧的 `ISO8601DateFormatter()` 都换了。
- **配对状态**：配对按钮改用单独的 `isPairing`，退出登录时清掉；后台刷新不再改配对按钮，也不再弹窗挡住配对页。
- **连接检查**：进度在成功、失败、退出登录时都会清掉；诊断只显示白名单里的操作名和错误码。

建议改（不挡验收）：

1. `build.sh` 里的 `XCODEBUILD_OPTIONS` 定义了没用到，`-allowProvisioningUpdates` 在下面又单独加了一次。删掉没用的那个。
2. `verify-build-config.mjs` 对三项 Relay 配置只检查非空，却输出“present, shape correct”。要么真的检查形状，要么输出改成“present”。
3. `readWorkspace` 里任何一台机器的任一步读取失败，都会让整台电脑显示离线（`SupervisorClient.swift` 的 `refresh` 循环）。B1 修复后这种情况应该少了，但一台机器出问题不该拖累同一台电脑上的其他机器。放到下一轮。

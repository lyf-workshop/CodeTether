# 任务：I1 iPad 真机验收后的修复（第 4 轮）

在 Mac 上运行，接着在 `i1/ipad-app` 上做。真机验收报告已经写完（`~/agenthub-archive/i1-report.md` 的"真机验收（30e8b9f）"），经 Relay 的新建会话卡在第 6 项的问题上，其余经 Relay 的验收等这轮修完再做。这轮要改代码，只改 `apps/ios`。提交推送到 `i1/ipad-app`，不推 `main`、不合并、不打标签。

依据（都在 `origin/ux/design` 上，用 `git show` 读）：

- `docs/ux-redesign/07-tablet.md`、平板原型 `docs/ux-redesign/tablet/`（截图在 `tablet/png/`），iPad 和安卓平板用同一份设计；
- `docs/ux-redesign/06-pairing-remote-control.md` §1：文案规则；
- `docs/reviews/i1-ipad-app.md`：上一轮审核的建议改；
- `docs/reviews/t1a-tablet-fidelity-prompt.md`：安卓平板同样问题的修复要求，第 4 到 9 项是按原型还原的清单，iPad 照同样的标准做；
- `docs/ux-redesign/09-tablet-usability.md` §6：iPad 的可用性问题 I1 到 I12，标了"r4 修"的在下面第 6 到 10 项。

开始前确认这份文件有 4 个二级标题，最后一节是"报告"。

## 目标

**必须改**：

1. **验收里失败的项**：真机验收报告里，凡是 `apps/ios` 自己的缺陷让某个验收项失败的，都修掉。原因在 Host、Relay、Rust 核心或其他电脑上的，不修，列出来。
2. **文案规则**：06 §1 规定界面上不出现 Host、Node、Machine、ProductDevice、Supervisor、Relay、授权、grant、指纹。现在连接检查有"Supervisor / Relay"的标签和"只走 Relay"的选项。
   - 连接检查照原型 04-04：单独的页面，可以返回，用原型里的通俗说法和状态徽章。
   - 强制只走某一种连接的开关、密钥保护级别、技术诊断只在 Debug 构建里显示，验收要用；Release 构建不显示。
   - 顺带检查全应用还有没有违反这条规则的文案。
3. **宽窄切换保留状态**：07 的规则是横屏时变更面板在右边（宽 420）、侧栏自动收起、可以再叫出来，竖屏时面板盖在会话上面（宽 520）。旋转、分屏和侧拉改变宽度时，面板开着、选中的文件、diff 的滚动位置、草稿、打开的会话都保留。验收里如果已经保留，写明并补测试。
4. **被移除页**：照原型 04-06 和 07 的路由（`#/home?removed=1`），在首页顶部显示红色告警条，侧栏保留，说明哪台电脑移除了它，操作是"输入配对码"和"看其他电脑"。
5. **一台机器失败不拖累整台电脑**（审核建议改第 3 项）：`SupervisorClient.swift` 的 `readWorkspace` 里，一台机器的读取失败，现在会让整台电脑显示离线。改成只把那台机器标成读不出来并显示原因，同一台电脑上的其他机器照常显示。连接本身失败时，电脑才显示离线。
6. **新建会话读错了能力字段**（真机验收挡住经 Relay 的全部业务）：`SupervisorClient.swift:280` 从 AI 工具的 `capabilities` 读 `providerExecution`，这个字段在设备的能力里（`packages/protocol/src/machines.ts:38`，`machine.get` 返回的 `machine.capabilities`），AI 工具的能力里没有（`packages/protocol/src/providers.ts:26`）。所以真机上总是"当前会话不支持此操作"。`readWorkspace`（`:644`）读的位置是对的，照它改。
   - 根本原因是假数据：`UITestPendingCreateFixture.swift:89` 和 `AppModelRegressionTests.swift` 的 `:631`、`:763` 把 `providerExecution` 放进了 AI 工具，`machine.get` 的 `machine` 里又缺了 `capabilities`、`availability` 这些必有字段。假数据要和真实响应同形：照 `MachineSummarySchema` 和 `ProviderDescriptor` 的字段写全，或者从真机验收的日志里脱敏取一份真实的 `machine.get` 响应当样本。顺带检查其他假数据有没有同类问题。
   - 补一个测试：用真实形状的 `machine.get`（AI 工具的能力里没有 `providerExecution`）走新建会话，要成功。
7. **后台刷新不挡输入**（09 的 I2）：后台每 10 秒刷新时 `performBusy` 把 `isBusy` 设成真，会话的输入框（`TabletViews.swift:1224`）、发送按钮、新建会话的"创建会话"跟着被禁用，打字时键盘可能被收起。后台刷新和轮询不设 `isBusy`；输入框只在这个会话自己有发送进行中、或不能发送时禁用。补测试：后台刷新进行中，输入框可以输入，发送按钮可用。
8. **轮询失败不弹窗**（09 的 I3）：`pollForeground` 失败就 `show(error)`（`AppModel.swift:841-843`），每 750 ms 一次，离线时弹窗关掉又弹。后台轮询和后台刷新的失败只在页面上显示状态（例如会话顶部"连不上这台电脑，正在重试"），恢复后自动消失；只有用户自己点的操作失败才弹窗。被移除的判断照旧。
9. **新消息不把人拉走**（09 的 I4、P8）：`onChange(of: detail.messages.count)` 无条件滚到底（`TabletViews.swift:1195`）。改成：已经在底部才跟随；不在底部时显示"有新消息"，点了回到最新。打开会话时停在最新的地方。
10. **被移除页的电脑名**（09 的 I12）：`removedComputerName` 取的是第一台不可用的电脑（`AppModel.swift:884`），有几台电脑时可能写错。用收到移除错误的那台电脑。

第 3 项里"侧栏自动收起"现在没做：宽屏总是显示侧栏（`TabletViews.swift:253`），横屏打开变更面板后会话只剩约 460 pt 宽（09 的 I5）。照 07 做：打开面板时侧栏收起，可以再叫出来。

**应该改**：

11. **按原型还原**：在 iPad 上逐页截图对照原型，照 `t1a-tablet-fidelity-prompt.md` 第 4 到 9 项的标准还原（列表和分段、变更面板、会话、新建、设备、设置）。后端没有数据的，不编造、不改后端，列出来。
12. **构建脚本的两处小问题**（审核建议改第 1、2 项）：`build.sh` 里定义了没用到的 `XCODEBUILD_OPTIONS`，删掉；`verify-build-config.mjs` 对三项 Relay 配置只检查非空，要么真的检查形状，要么输出改成"present"。
13. **新建会话预选项目**（09 的 P2、I11）：从项目页、设备页、侧栏项目行打开时，预选那个项目，现在总是预选第一个可用的；第一句话的输入框至少 4 行；新建窗口里 ⌘↩ 开始。
14. **定下来的交互规则**（`07-tablet.md` §4 的“交互规则”，原型 02-01、02-04、02-13、02-14 已更新）：首页“需要你处理”和“正在运行”分开；“变更 N”入口；diff 默认换行和“换行”开关；停止先确认；会话标题下的“设备 › 项目”可以点，从左边缘右滑返回上一页。

**不在这轮**：T1b 的功能（置顶、重命名、添加和移除项目、以前的会话、项目内搜索、通知、后台、解锁），原型里画了也继续不显示。

## 已知情况

- 验收报告里的"已知情况"四项（文案、一台机器失败、diff 截断没标记、原生会话历史慢），前两项在本轮修；后两项是 Host 的问题，只看报告里的实际现象，不在 iOS 侧补。
- 发送和新建的重试规则在第 2 轮已经定了：重试成功或 Host 明确拒绝才清掉待确认，其他失败保留，`action.get` 的 `not_found` 不算明确失败。安卓已按同一规则修完（`origin/fix/android-retry-explicit-failure` 的 `aeac893`，`RemoteSupervisor.kt` 的 `uncertainErrors` 和 `definitiveMutationErrors`），两个平台的分类要一致：
  - **明确失败**（重试发出的写请求本身得到这些，或 Rust 在发送前本地检查失败）：`invalid_request`、`not_found`、`conflict`、`operation_not_allowed`、`unsupported`。
  - **不确定**：连接断开、`connection_failed`、`session_expired`、`authorization_revoked`、`remote_host_unreachable`、`timeout`、`invalid_response`、`internal`、`protocol_error`、`unavailable`，以及重试前的读取或连接失败。
  - iPad 现在的分类如果和这两组不一致（比如把 `unavailable` 当成明确失败），照这两组改，并补测试；已经一致就写明。不要为这部分改别的行为。
- 测试要走真实的代码路径（`TabletAppModel`、`SupervisorClient` 加假的连接），宽窄切换用 UI 测试或快照覆盖。
- **规模**：改动超过约 30 个文件或 3000 行（不算测试和截图）时，先完成 1 到 10 并推送，再做 11 到 14，报告里说明。
- 构建、签名、安装沿用上一轮的做法。

## 边界

- **自己决定**：实现方式；提交怎么拆（每项一个或几个提交，带测试）；测试和截图的方法；原型里没写清楚的细节，按原型 HTML 和 CSS 推断。
- **先问用户**：
  - 要改 `apps/ios` 以外的代码，包括 Rust 核心；
  - 原型和 07 的文字说明有冲突；
  - 要显示原型里没有的东西；
  - 需要用户本人在 iPad 或 Mac 上操作。
- **不做**：读取或打印凭据；推送 `main`、合并、打标签；强制推送。

## 报告

追加到 `~/agenthub-archive/i1-report.md`，新开一节"r4 修复"：

- 1 到 14 每一项改了什么、对应的提交，推送后的远端提交；
- 验收失败项里哪些修了、哪些不在 iOS 侧（原因）；
- 宽窄切换和被移除页的测试结果；
- iPad 上每个原型页的截图，还剩的差异和原因；
- 后端没有数据的项列表；
- 单元测试、UI 测试、构建的结果，失败的原样贴出；
- 没做完的事和原因，以及在"完成"的哪一级。

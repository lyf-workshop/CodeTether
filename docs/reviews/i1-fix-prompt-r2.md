# 任务：I1 iPad 审核后的修复（第 2 轮）

在 Mac 上运行，接着在 I1 的工作区里做（分支 `i1/ipad-app`，现在是 `82a1aff`）。iPad 还没准备好，这轮仍然只在模拟器上验证。我审核了 `82a1aff`，r1 列的大部分已经改对（见“已知情况”），还剩下面这些。依据和前两轮一样：`docs/reviews/i1-ipad-app-prompt.md`、`docs/reviews/i1-fix-prompt-r1.md`（在 `origin/ux/design` 上，用 `git show` 读）。

开始前确认这份文件有 4 个二级标题，最后一节是“报告”。

## 目标

行号以 `82a1aff` 为准，Swift 路径省略 `apps/ios/Sources/CodeTether/`。

1. **必须修**：
   1. **历史缺轮次**（`SupervisorClient.swift:841`）：`reconcileHistory` 在已加载的历史 `complete` 时直接合并，不往前补页。`complete` 只说明已加载的部分从第一轮开始，不说明它和最新一页接得上。例子：iPad 上看过一个两轮的会话，离开后在 Mac 上又聊了 10 轮；回到 iPad，`readConversation` 读到最新一页（第 5 到 12 轮），和缓存的第 1、2 轮合并，结果是 1、2、5…12，还标成完整、没有往前的游标，第 3、4 轮再也看不到。去掉这条提前返回，不管 `complete` 都补到接上为止。Android 的 `remote/HistoryMerge.kt`（`origin/t1a/tablet-app`）没有这条。
      另外，补到最前面（没有 `beforeCursor`）还接不上时，现在抛 `invalidResponse`（`:847-848`、`:854`），`liveCursor` 没更新，轮询每 750 ms 重读一次、报一次同样的错。这种情况说明缓存已经过时，用新读到的这段直接替换，不报错。
   2. **明确失败被当成结果不确定**（`SupervisorClient.swift:446-453`）：带 actionId 的请求，只要是 `SupervisorWireFailure` 都包成 `uncertainActionID`，包括 Host 明确拒绝的 `invalid_request`、`not_found`、`conflict`、`operation_not_allowed`，也包括 Rust 核心在发送前本地检查失败的（`packages/supervisor-mobile/src/lib.rs:136-145`）。r1 以后这些都记成待确认，这个会话只能点“使用原请求重试”，重试还是同样的错误，会话一直卡住，只能杀掉应用。例子：粘贴一大段日志，超过 Host 的输入上限，`apps/host/src/api/host-service.ts:3694-3700` 返回 `invalid_request`。只有连接断开、超时、`session_expired`、`authorization_revoked`、`internal`、协议错误和响应对不上才算不确定，Android 的分法见 `remote/RemoteSupervisor.kt` 的 `uncertainErrors`。明确失败直接显示原因，草稿留着，改了可以再发。
   3. **重试时还没发出去就失败，待确认被删掉**（`SupervisorClient.swift:255-289`，`AppModel.swift:373-423`）：重试先连接，连不上（电脑离线、网络断了、拿不到连接信息）时抛出的是原始错误，走到 `catch let failure as ClientFailure` 和最后的 `catch`，待确认被删掉，`AppModel` 也跟着清掉。可是第一次那次可能已经到了 Host。用户看到发送按钮又能用了、草稿还在，再点发送就是新的 actionId，可能多一轮或多一个会话。规则：重试成功，或者 Host 对这次重试明确拒绝，才清；其他失败一律保留待确认。Host 先按 actionId 查重（`host-service.ts:3654-3688`），所以同样的 actionId 和内容被明确拒绝，说明第一次没有生效。
   4. **待确认没有保存**（`AppModel.swift` 的 `state.pendingActions`，`SupervisorClient.swift:83` 的 `uncertainActions`）：两份都只在内存里，草稿却已经保存了。发送或新建过程中应用被系统回收，重开以后草稿还在、待确认没了，再发一次就是新的 actionId。改成：
      - 提交前就把 actionId 和原请求（操作、computerId、machineId、projectId、conversationId、provider、reasoning、文字）存下来，和草稿一样放 `UserDefaults` 就可以；成功或明确失败后删，重开时恢复成“结果未确认”；
      - 只留一份，`SupervisorClient` 重试时用传进来的原请求，不再自己另存；
      - 跟登录的账号绑定，退出登录时清掉，换账号不恢复；
      - 重开后 `projectTargets` 是空的，新建的重试不能因为找不到项目就当成失败，先刷新，或者直接用存下的 machineId 和 projectId。

      Android 的写法在 `ui/PendingMutations.kt`（`origin/t1a/tablet-app` 的 `b668e53`，我还没审核，只作参考）。
2. **应该修**：
   1. **新建窗口的重试**（`TabletViews.swift:1815-1822`、`:1838-1843`）：点“使用原请求重试”没有设 `didSubmit`。关掉窗口再打开后重试，成功了窗口不关，失败了也不显示原因。重新打开时输入框是空的，看不出要重试的是哪句话，要显示原来的第一句话（只读就可以）。
   2. **发送按钮**（`TabletViews.swift:1236`）：有待确认时按钮还能点，点了在 `AppModel.swift:342` 直接返回，没有任何反应。有待确认时禁用。
   3. **退出登录**（`AppModel.swift:173-188`）：退出后草稿还留在 `UserDefaults` 里，待确认、`SupervisorClient` 里的历史缓存和会话目标也还在内存里。退出时一起清。
   4. **变更路径长度**（`SupervisorClient.swift:924`）：上限是 2048，协议是 4096（`packages/protocol/src/runtime-history.ts:131`），一条长路径会让整张变更列表读失败。改成 4096。
3. **模拟器测试环境**：`DeviceIdentityTests` 失败不是身份逻辑的问题，`simulator` 加 `DEBUG` 用软件密钥这条是对的。原因很可能是测试构建没签名：`project.yml` 三个 target 都是 `CODE_SIGNING_ALLOWED: "NO"`，`Scripts/test.sh:56`、`:65` 也传了这个参数。没签名的模拟器应用没有钥匙串权限，带 `kSecAttrIsPermanent` 的密钥建不出来（通常是 `errSecMissingEntitlement`，-34018）。`SecureStore` 存登录状态用的也是钥匙串，很可能也存不下，那样模拟器上登录和配对都走不通。模拟器的构建和测试改成本地签名（`CODE_SIGN_IDENTITY = "-"`，不需要开发者账号），真机构建不变。改完这个测试要通过；还不行就把 `OSStatus` 记到报告里。
4. **测试**：r1 有两个测试没测到真实代码。`AppModelRegressionTests.testInactiveThenActiveDoesNotCancelPendingSendOrCreateWork` 自己建了两个任务，按 `TabletLifecyclePolicy` 决定取不取消，没经过 `TabletAppModel.sceneChanged`；`testMutationRetryReusesOriginalActionIDAndPayload` 只测了 `PendingSupervisorAction.replay` 转发参数。给 `SupervisorClient` 和 `TabletAppModel` 加注入点（假的 `SupervisorConnector`，`AccountClient` 可以抽成协议），测试走真实的发送、新建、重试和 `sceneChanged`。至少覆盖：
   - 发送进行中进入 `.inactive` 再回到 `.active`，请求没被取消，只提交一次；
   - 缓存了一个完整的两轮会话，最新一页从第 5 轮开始：补页以后 1 到 12 轮都在，不重复，不报错；补到最前面还接不上时用新读到的替换，不报错；
   - 第一次提交返回 `invalid_request`：显示原因，不记待确认，草稿还在，可以再发；
   - 结果不确定以后重试，连接失败：待确认还在；再重试成功：用的是原来的 actionId 和内容，待确认清掉；
   - 重试返回 `conflict`：待确认清掉，显示原因；
   - 发送中应用被回收，重开：显示待确认，重试用原来的 actionId；
   - 退出登录后草稿、待确认、历史缓存都清掉，换账号不恢复；
   - 新建窗口关掉再打开，重试成功后窗口关闭，进入新会话。

## 已知情况

- 我核对过、不用改的：`.inactive` 不再停止；新建失败时窗口不关、输入还在；每轮先放用户输入，再按 `order` 放回复和工具，最后放 `final:`；变更 id 用 turnId、itemId、path；重试用原来的 actionId 和内容，待确认只挡同一会话或同一项目；401 只有 `authentication_failed` 加登录失效的 `code` 才清登录状态，设备证明失败不清；草稿只在确认发送成功后清。
- CoreSimulator 收尾时挂起，看起来是环境问题，不改代码。单元测试和 UI 测试分两次跑，每次用新建的模拟器，跑完关掉；报告里写清每个测试包的结果来自哪个 `xcresult`。
- 新建在 Host 上分两步：先建会话，再开第一轮（`apps/host/src/api/supervisor-transport-manager.ts:315-345`）。第二步失败时会话已经建好，会留下一个空会话。这是 Host 的问题，以后处理，这轮不用管，测试也不要假设它不会出现。
- 合并顺序不变：Android（T1a）先合并到 `main`，这个分支再变基，crate 的改动由 Windows 那边复核。这轮 crate 不改。
- 实机的事等 iPad 准备好再做。用户没说准备好之前，不要停下来等。

## 注意事项

- 不改 Host、控制服务、Relay、B1、`apps/android` 和 Rust crate 的代码。
- 凭据的规则和上一轮一样：不打印，也不进仓库、日志、Xcode 控制台输出和报告；不读 `.secrets/`、其他 `.env`、凭据文件、`~/.codex/auth.json` 和 `~/.claude.json`；构建脚本和子进程用环境变量白名单。存下的原请求里不放凭据。
- 只用自己建的模拟器。不动 Mac 安装版和它的数据目录。
- **门禁**：
  - 模拟器上的 `xcodebuild test` 全部通过，包括 `DeviceIdentityTests`；
  - 真机构建（`generic/platform=iOS`）；
  - 这轮不改 Rust 和 TypeScript，`cargo test` 和 pnpm 门禁不用重跑。
- 怎么拆提交由你定。做完推送分支。

## 报告

追加到 `~/agenthub-archive/i1-report.md`，新开一节“审核修复 r2”：

- 每一条怎么改的，对应的测试；
- `DeviceIdentityTests` 的原因和改法；
- 门禁结果、`xcresult` 和日志链接；
- 提交、是否推送；
- 没做完的事和原因。

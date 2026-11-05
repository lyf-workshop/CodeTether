# 任务：I1 iPad 审核后的修复（第 1 轮）

在 Mac 上运行，接着在 I1 的工作区里做（分支 `i1/ipad-app`，现在是 `d9ad373`）。iPad、开发者模式和设备信任还没准备好，实机验收以后再做；这轮修代码，在模拟器上验证。我审核了 `d3b56ba`、`d9ad373`，要修的列在下面。依据和上一轮一样：`docs/reviews/i1-ipad-app-prompt.md`（在 `origin/ux/design` 上，用 `git show` 读，里面“Android 审核找到的问题”现在有 12 条），设计文件在 `origin/ux/design`。

开始前确认这份文件有 4 个二级标题，最后一节是“报告”。

## 目标

行号以 `d9ad373` 为准，Swift 路径省略 `apps/ios/Sources/CodeTether/`。

1. **必须修**：
   1. **`.inactive` 不算切到后台**（`AppModel.swift:75-90`）：现在只要不是 `.active`，就取消轮询、配对和所有操作，再断开所有连接。下拉控制中心或通知中心、打开多任务切换、系统弹窗（包括第一次直连时的本地网络权限弹窗）都会进入 `.inactive`，正在发送或新建的请求被取消，结果变成不确定。只有 `.background` 才停，`.inactive` 什么都不做。
   2. **新建会话**（`TabletViews.swift:1785-1789`）：点“创建会话”马上 `dismiss()`，失败时第一句话和选择都丢了。成功后再关，失败时保留输入，在窗口里显示原因。
   3. **历史**（`SupervisorClient.swift:138-154`、`:464-517`，`AppModel.swift:377-404`、`:425-438`）：轮询只要有新事件，就重读最新 8 条，整个替换当前会话，`olderCursor` 也换成新的。运行中每 750 ms 一次，往前翻过的历史马上被冲掉。重读的结果要和已加载的合并，分页边界跟着更新，做法可以参考 Android 的 `remote/HistoryMerge.kt`（`origin/t1a/tablet-app` 的 `41dbf72`）。
   4. **时间线顺序**（`SupervisorClient.swift:642-676`）：所有记录放在一起按 `order` 排序，但 Turn 记录没有 `order` 字段（`packages/protocol/src/records.ts:248-263`），用户输入都落到 `Int.max - 1`，排在全部回复之后；补的 `final:` 用的是 0，排在最前面。改成按轮分组：每轮先放用户输入，再按 `order` 放回复和工具，最后放补的 `final:`。Android 的写法在 `remote/RemoteProjection.kt:145-168`。
   5. **变更**（`SupervisorClient.swift:681-687`、`TabletViews.swift:1368`）：`TabletDiffFile` 的 id 用的是 path。Host 按 turnId、itemId、path 区分变更，同一路径可以有多条，`ForEach` 里的 id 会重复。id 改成这三项。
   6. **结果不确定时重试**（`SupervisorClient.swift:156-208`，`AppModel.swift:272-308`，`Configuration.swift:90`）：发送和新建每次都生成新的 actionId。结果不确定时用户再点一次，就是另一个 actionId，可能多出一轮或多一个会话。记下待确认的 actionId 和内容，给一个“重试”，用原来的 actionId 和内容再提交；Host 按 actionId 去重，同样的内容重复提交是安全的，内容不同会返回 409。`action.get` 只能查发送的 actionId，新建的查不到（Host 只查 `turn_start_actions`）。待确认的操作只挡同一个会话（新建挡同一个项目）。提示文案相应改掉“请重新打开会话查看状态”。
2. **应该修**：
   1. **控制服务返回 401**（`AccountClient.swift:397-418`）：没有区分登录失效和设备证明失败。设备证明失败时，刷新以后还是 401，就会清掉登录状态。看响应体：`{status:'authentication_failed', code}` 才算登录失效，`code` 的取值见 `apps/control-plane/src/auth/human-auth-verifier.ts:18-27`；`device_authentication_failed` 不清登录状态。Android 的写法在 `account/AccountHttp.kt` 的 `SESSION_FAILURE_CODES`。
   2. **草稿**（`AppModel.swift:310`、`TabletViews.swift:1136-1139`）：只在内存里。iPad 在后台常被系统回收，回来草稿就没了。保存起来，只有明确发送成功才清。
3. **测试**：每条都加回归测试（单元测试或 UI 测试），至少覆盖：
   - 进入 `.inactive` 再回到 `.active`，发送和新建没有被取消，只提交一次；
   - 新建失败时窗口不关，输入还在；
   - 往前翻过的会话收到新事件后，前面的轮次还在；
   - 三轮的会话，时间线是“问、答、问、答、问、答”；
   - 同一路径有两条变更时都能显示；
   - 结果不确定时点重试，用的是原来的 actionId 和内容；
   - 设备证明返回 401 时不回登录页；
   - 应用被系统回收后重开，草稿还在。

## 已知情况

- 我核对过、不用改的：退出登录先清本地登录状态；签名回调只抛 `MobileError`；配对可以取消等待；`ConnectOptions` 没有被打印；控制服务 401 刷新一次再回登录页；`authorization_revoked` 时先用最新的授权重连一次。
- Android 那边正在修两个同类问题：旋转被当成切到后台，和结果不确定时卡住。对应上面的 1.1 和 1.6。它修完、审核通过后先合并到 `main`，然后这个分支再变基到 `main`。
- crate 的两处改动（`staticlib`、iOS 的 `BUILD_ID`）等变基以后由 Windows 那边复核 Android 构建。这轮 crate 不再改。
- 实机的事（免费 Apple ID 安装、Secure Enclave、本地网络权限、iPad 上的直连和 Relay）等 iPad 准备好再做。用户没说准备好之前，不要停下来等。

## 注意事项

- 不改 Host、控制服务、Relay、B1、`apps/android` 和 Rust crate 的代码。
- 凭据的规则和上一轮一样：不打印，也不进仓库、日志、Xcode 控制台输出和报告；不读 `.secrets/`、其他 `.env`、凭据文件、`~/.codex/auth.json` 和 `~/.claude.json`；构建脚本和子进程用环境变量白名单。
- 只用自己建的模拟器。不动 Mac 安装版和它的数据目录。
- **门禁**：
  - 模拟器上的 `xcodebuild test`：单元测试、互通测试、关键流程的 UI 测试；
  - 真机构建（`generic/platform=iOS`）；
  - 这轮不改 Rust 和 TypeScript，`cargo test` 和 pnpm 门禁不用重跑。
- 怎么拆提交由你定。做完推送分支。

## 报告

追加到 `~/agenthub-archive/i1-report.md`，新开一节“审核修复 r1”：

- 每一条怎么改的，对应的测试；
- 门禁结果和日志链接；
- 提交、是否推送；
- 上一轮验收表里，哪些行已经在模拟器上验证过、哪些等实机；
- 没做完的事和原因。

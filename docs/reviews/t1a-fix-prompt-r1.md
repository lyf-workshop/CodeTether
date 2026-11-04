# 任务：T1a 审核后的修复（第 1 轮）

在这台 Windows 电脑上运行，接着在 T1a 的工作区 `D:/Projects/Software/agenthub-t1a-tablet` 里做。审核报告是 `D:/Projects/Software/agenthub-archive/t1a-kotlin-review.md`，我已经逐条对照 `f290602` 核实过，要修的列在下面。依据和 T1a 一样：任务提示词 `docs/reviews/t1a-tablet-app-prompt.md`，设计文件在 `origin/ux/design`。

开始前确认这份文件有 4 个二级标题，最后一节是“报告”。

## 目标

行号以 `f290602` 为准，Kotlin 路径省略 `apps/android/app/src/main/java/org/codetether/app/`。

1. **先收尾上一轮没提交的改动**：工作区里的变更面板修复（同一路径的多条记录按 turnId、itemId、path 区分，就是审核第 5 条）和新加的测试。跑它的 Compose 回归测试，通过后单独提交。默认跳过的真实 Provider 和撤销计时测试可以一起提交，保持默认跳过。
2. **必须修**：
   1. **退出登录**（`ui/TabletController.kt:172-186`）：现在先清界面、断开连接，最后才清本地登录状态。中间切后台或旋转会取消这个操作：界面已经是未登录，凭据还在，重开应用又登录了。改成先清本地登录状态（`TabletAccount.signOut` 里清本地的那一步已经不可取消），再断开连接、清界面。
   2. **发送**（`ui/TabletPages.kt:284-297`、`ui/TabletController.kt:262`）：发送被取消（切后台、旋转）时没有 error，界面就把草稿清了；草稿用的是 `remember`，旋转也会丢。草稿要能经过旋转和切后台保留，只有明确成功才清。结果不确定时不重发，回到前台后靠重新读取会话确认。
   3. **新建会话**（`ui/TabletApp.kt:263-265`）：点提交就关窗口，失败时第一条消息和选择都丢了。成功后再关，失败时保留输入并显示原因。
   4. **历史**（`remote/RemoteSupervisor.kt:143-147`、`ui/TabletController.kt:410-411`）：一轮结束时重读的是最新 8 条，控制器却沿用旧的 `olderCursor` 和 `olderMessages`。超过 8 轮的会话，第一轮会消失而且加载不回来；已经往前翻过的，中间会缺几轮。重读后和已加载的历史合并，分页边界跟着更新。
3. **应该修**：
   1. **配对等待**（`ui/TabletApp.kt:138-139`、`account/ControlPlane.kt:104-111`）：等电脑完成连接时，“返回”和“退出登录”都是禁用的，最长约 355 秒。加一个取消等待。
   2. **控制服务返回 401**（`account/ControlPlane.kt:185`、`ui/TabletController.kt:189-195`）：本地还有登录状态时不回登录页，下次还用同一个 token，会一直失败到 token 过期。收到 401 时刷新一次；刷新也被拒绝就清掉登录状态，回登录页。设备证明的失败和登录失效分开处理。
   3. **项目页**（`ui/TabletController.kt:73`、`:84-101`、`:425-444`）：读取中切到后台，回来不重读，页面一直显示“没有符合条件的会话”。回到前台时重读当前的项目页；读取中显示“正在读取”，不要显示成空列表。
4. **顺手改**：
   - `account/TabletAccount.kt:105-109`：签名回调抛的是 `AccountFailure`，Keystore 出错时也会抛别的异常。`MobileError` 没有实现从 UniFFI 意外回调错误的转换，这时 Rust 会 panic（`uniffi_core` 0.29.4 的 `ffi_converter_impls.rs:538`），最后变成通用错误。回调里的所有失败都转成 `MobileException.Failure`，加一个测试。Rust crate 这轮不改，iPad 分支也在改它。
   - UniFFI 生成的 `ConnectOptions` 的 `toString` 带 `accessToken`。现在没有打印它的地方；保证它不进日志和异常信息，必要时包一层。
   - 409 的提示（`ui/TabletController.kt:458`）对所有 409 都说“会话正在运行”，但等待批准时归档也会返回 409。换一个两种情况都说得通的说法。
   - 上一轮两次邮箱验证码验证失败，原因没查清。修完以后在模拟器上真实登录一次；还失败的话，用已有的不记录正文的观察器查出 HTTP 状态，写进报告。
5. **测试**：上面每条都加回归测试（单元测试或 Compose 测试），至少覆盖：旋转后草稿还在；取消发送不清草稿；新建失败保留输入；九轮的会话一轮结束后第一轮还在；退出登录中途被取消，重开后仍是未登录；401 后回登录页；回到前台后项目页重新读取。

## 已知情况

- 我核对过、不用改的：
  - `disconnect` 在主线程调用不会卡。Rust 的 `disconnect` 只是取消令牌、`try_lock` 后丢弃连接，不阻塞（`packages/supervisor-mobile/src/lib.rs:178`）。
  - 轮询有锁，连接会复用；配对等待有 25 秒上限（`account/ControlPlane.kt:109`）；读目录时网络失败映射成 `request_failed`，不会被判成“被移除”。
- 真实 Provider 的逐行变更、文本流和撤销计时，上一轮按用户的要求暂停了，这轮也不做。iPad 那一轮会在 Mac 上用真实 Codex 验证。
- 这轮只改 `apps/android`，不需要电脑那一侧的开发版，也不需要配对。
- 模拟器的 DNS 问题和上一轮一样，处理办法见 `t1a-report.md` “服务器恢复后的最终补测”一节。

## 注意事项

- 不改 Host、控制服务、Relay、B1 和 Rust crate 的代码。
- 凭据不打印，也不进仓库、日志、logcat 和报告：`.secrets/`、Supabase key、登录 token、验证码、配对码、私钥。不读 `.secrets/`、其他 `.env` 和凭据文件。构建和测试的子进程继续用环境变量白名单。
- 只用自己建的模拟器，`anju_api36` 不动。
- **门禁**：
  - `gradlew` 的 `testDebugUnitTest`、`lint`、`assembleDebug`、`assembleDebugAndroidTest`；
  - 专用模拟器上的仪器测试和 Compose 测试全部通过，包括上一轮还没跑完的；
  - 这轮不改 TypeScript 和 Rust，pnpm 门禁和 `cargo test` 不用重跑。
- 怎么拆提交由你定。做完推送分支。

## 报告

追加到 `D:/Projects/Software/agenthub-archive/t1a-report.md`，新开一节“审核修复 r1”：

- 每一条怎么改的，对应的测试；
- 真实登录的结果（失败的话写 HTTP 状态和原因）；
- 门禁结果和日志链接；
- 提交、是否推送、新的 debug APK 的大小和 SHA-256；
- 没做完的事和原因。

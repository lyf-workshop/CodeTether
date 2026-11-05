# 任务：T1a 审核后的修复（第 2 轮）

在这台 Windows 电脑上运行，接着在 T1a 的工作区 `D:/Projects/Software/agenthub-t1a-tablet` 里做。第 1 轮（`a52605d`、`41dbf72`）我已经审核过，列出的问题大多修对了，还剩两个问题会让发送或新建卡住，要修完才能合并。依据和前两轮一样：任务提示词 `docs/reviews/t1a-tablet-app-prompt.md`，设计文件在 `origin/ux/design`。

开始前确认这份文件有 4 个二级标题，最后一节是“报告”。

## 目标

行号以 `41dbf72` 为准，Kotlin 路径省略 `apps/android/app/src/main/java/org/codetether/app/`。

1. **旋转不算切到后台**（`MainActivity.kt:31-32`）：`onStop` 每次都调 `controller.foreground(false)`。清单没有声明 `configChanges`，旋转、分屏、调整窗口大小都会重建 Activity、走一次 `onStop`。于是正在进行的发送、新建、配对被取消（`ui/TabletController.kt:87`），所有连接被断开，然后重连。平板上旋转很常见，这也是下一条那种卡住状态最容易出现的原因。配置变化时（`isChangingConfigurations`）不要当成切到后台，正在进行的操作继续，连接保持。真的切到后台时照旧。
2. **结果不确定时可以重试**：
   - 现在的情况：
     - 结果不确定时界面写“请勿重复提交”（`ui/TabletController.kt:372`），然后只靠 `action.get` 确认（`:389-420`）。
     - 新建会话的 actionId 用 `action.get` 永远查不到。Host 的 `action.get` 只查 `turn_start_actions`（`apps/host/src/api/supervisor-transport-manager.ts:322-350`），而新建时第一轮用的是派生出来的另一个 actionId（同一文件 `:384-388`），所以新建的结果只要不确定，就一直是 `not_found`。
     - 发送如果没到达电脑，也一直是 `not_found`。
     - 卡住以后，输入框和“创建会话”一直禁用。控制器的检查（`:359`）还会挡住所有会话、所有电脑的发送或新建，直到退出登录。
   - 改法：
     - 结果不确定时给用户一个“重试”，用原来的 actionId 和原来的内容、选择再提交一次，去掉“请勿重复提交”。Host 按 actionId 去重：内存里有 `apps/host/src/api/action-idempotency-cache.ts:61-104`，持久化的有发送用的 `turn_start_actions` 和新建用的 create action（`apps/host/src/api/host-service.ts:3320-3352`、`:3663-3692`）。同一个 actionId、同样的内容重复提交是安全的，内容不同会返回 409。
     - 自动确认照旧只读、不重发，重发只能由用户点。
     - 待确认的操作只挡同一个会话（新建挡同一个项目），不挡别的会话和别的电脑。
     - 关掉新建窗口再打开、进程被系统杀掉后重建，也要能看到待确认的操作并重试，输入框不能一直禁用。现在控制器把待确认的请求放在内存里，界面另存一份 actionId，进程重建后两边会对不上。可以合到一处保存，比如 `SavedStateHandle`，具体怎么做由你定。
3. **顺手改**：历史里一轮没有回复记录时，`remote/RemoteProjection.kt:164` 补一条 `final:${turn.id}`。如果实时读取已经有这一轮的回复（id 是 itemId），合并以后可能显示两遍。合并时同一轮已经有回复，就去掉补的那条。
4. **测试**：每条都加回归测试，至少覆盖：
   - 用真实的 Activity 旋转，发送和新建不被取消，只提交一次，结果是成功；
   - `action.get` 一直返回 `not_found` 时，点重试会用原来的 actionId 和内容再提交一次，成功后清草稿或关窗口；
   - 一个会话的发送待确认时，另一个会话还能发送；
   - 关掉新建窗口再打开，还能重试；
   - 进程重建后，待确认的发送能重试，输入框不会一直禁用；
   - 同一轮的 `final:` 和实时回复不会显示两遍。

## 已知情况

- 第 1 轮我核对过、修对了的：
  - 退出登录的顺序；签名回调只抛 `MobileException.Failure`；401 的刷新和回登录页；`ConnectionCredentials` 不打印凭据；
  - 历史的合并和分页边界；草稿用 `rememberSaveable` 保存，只有成功才清；新建成功后才关窗口；
  - 配对可以取消等待；项目页回到前台重读，读取中不显示成空列表；409 的说法。
- `action.get` 只返回 `not_found`、`accepted`、`running`、`completed`、`failed`（`docs/PHASE9B5-REMOTE-CONVERSATION-CONTROL.md:46-50`）。`confirmPendingMutations` 里的 `rejected` 分支不会走到，可以留着。
- 让 Host 的 `action.get` 也能查新建的 actionId 是 Host 的改动，以后再做。客户端不要自己算派生的 actionId，那是 Host 的内部实现。
- 这轮只改 `apps/android`，不需要电脑那一侧的开发版，也不需要配对。第 1 轮已经验证过真实登录，这轮不用再做。
- 模拟器的 DNS 问题和前两轮一样，处理办法见 `t1a-report.md` “服务器恢复后的最终补测”一节。

## 注意事项

- 不改 Host、控制服务、Relay、B1 和 Rust crate 的代码。
- 凭据不打印，也不进仓库、日志、logcat 和报告：`.secrets/`、Supabase key、登录 token、验证码、配对码、私钥。不读 `.secrets/`、其他 `.env` 和凭据文件。构建和测试的子进程继续用环境变量白名单。
- 只用自己建的模拟器，`anju_api36` 不动。
- **门禁**：
  - `gradlew` 的 `testDebugUnitTest`、`lint`、`assembleDebug`、`assembleDebugAndroidTest`；
  - 专用模拟器上的仪器测试和 Compose 测试全部通过；
  - 这轮不改 TypeScript 和 Rust，pnpm 门禁和 `cargo test` 不用重跑。
- 怎么拆提交由你定。做完推送分支。

## 报告

追加到 `D:/Projects/Software/agenthub-archive/t1a-report.md`，新开一节“审核修复 r2”：

- 每一条怎么改的，对应的测试；
- 门禁结果和日志链接；
- 提交、是否推送、新的 debug APK 的大小和 SHA-256；
- 没做完的事和原因。

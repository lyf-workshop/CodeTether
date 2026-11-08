# 任务：安卓重试收到明确失败时退出"结果待确认"

在 Windows 上运行。这轮要改代码：从 `e4bdd57`（`origin/fix/relay-create-uncertain`）开出分支 `fix/android-retry-explicit-failure`，工作区放 `D:/Projects/Software/agenthub-work/fix-android-retry-explicit-failure`。只改 `apps/android`。依据：`docs/reviews/i1-fix-prompt-r2.md` 的"必须修"第 2、3 项（在 `origin/ux/design` 上，用 `git show` 读），`D:/Projects/Software/agenthub-archive/relay-create-uncertain-report.md`。

开始前确认这份文件有 4 个二级标题，最后一节是"报告"。

## 目标

现象：发送或新建进入"结果待确认"后，用原 actionId 重试，即使 Host 明确拒绝，界面还是显示待确认，用户只能杀掉应用。

规则和 iPad 第 2 轮修复一致：

- **重试成功**：清掉待确认，按成功处理（发送留在会话里，新建打开新会话），只处理一次。
- **重试收到 Host 的明确拒绝**（`invalid_request`、`not_found`、`conflict`、`operation_not_allowed`、`unsupported`），或者 Rust 核心在发送前本地检查失败：清掉待确认，显示原因。草稿和新建窗口里的输入保留，用户改了可以再提交，再提交用新的 actionId。
- **其他失败**（连接断开、超时、`session_expired`、`authorization_revoked`、`internal`、协议错误、响应对不上）：保留待确认，仍然可以用原 actionId 重试。
- 第一次提交和重试用同一套分类：复用 `RemoteSupervisor.kt` 现有的 `uncertainErrors`，不另写一份。
- `action.get` 返回的 `not_found` 不算明确失败。它只说明 Host 查不到这个 actionId，不说明操作没生效，保持待确认，和现在一样。上面列的 `not_found` 只指重发操作本身得到的结果。
- 明确失败清掉待确认后，刷新一次对应的会话或项目列表。如果中间 Host 重启过，去重记录会丢，第一次那次可能已经生效，刷新后用户能看到。

要做到：

1. 按上面的规则修复，发送和新建两条路径都要改。
2. 测试走控制器的真实代码路径，至少覆盖：
   - 待确认 → 重试收到明确失败 → 清掉，显示原因，草稿还在，再提交用新的 actionId；
   - 待确认 → 重试结果不确定 → 仍然待确认，还是原 actionId；
   - 待确认 → 重试成功 → 清掉，只成功一次；
   - 进程恢复后的待确认 → 重试收到明确失败 → 清掉；
   - `action.get` 返回 `not_found` → 仍然待确认。
3. Gradle 门禁 `testDebugUnitTest lint assembleDebug assembleDebugAndroidTest` 通过，专用模拟器上相关的仪器测试通过。

## 已知情况

- 相关代码：`apps/android/app/src/main/java/org/codetether/app/ui/PendingMutations.kt`、`ui/TabletController.kt`、`remote/RemoteSupervisor.kt`。T1a 第 2 轮怎么保存原请求、怎么做只读确认，写在 `D:/Projects/Software/agenthub-archive/t1a-report.md` 的"审核修复 r2"。
- 模拟器只用专用的 `codetether_t1a_pixel_tablet_api36`，不要动其他模拟器。
- 平板验收可能正在用真机，不要把新 APK 装到平板或手机上。
- 构建环境照 T1a 的做法：子进程用环境变量白名单，不读 `.env`。

## 边界

- **自己决定**：修复方式；测试怎么写；提交怎么拆；构建环境问题。
- **先问用户**：要改 `apps/android` 以外的代码；把新构建装到平板或手机上。
- **不做**：读取或打印凭据；推送 `main`、合并、打标签；强制推送。

推送分支到 `origin`，不合并。

## 报告

追加到 `D:/Projects/Software/agenthub-archive/t1a-report.md`，新开一节"重试明确失败修复"：

- 根因：现在的代码在哪里把重试的明确失败当成了不确定；
- 改动的提交和推送后的远端提交；
- 测试和门禁的结果，失败的原样贴出；
- 新 debug APK 的大小和 SHA-256；
- 没做完的事和原因，以及在"完成"的哪一级。

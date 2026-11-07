# 任务：经 Relay 新建会话停在"结果待确认"

在 Windows 上运行。这轮要改代码：从 `fd1d905` 开出分支 `fix/relay-create-uncertain`（`fd1d905` 是 `origin/fix/b1-supervisor-internal`，也是现在两台电脑安装版的提交），工作区放 `D:/Projects/Software/agenthub-work/fix-relay-create-uncertain`。依据：`D:/Projects/Software/agenthub-archive/t1a-report.md` 的"fd1d905 复测"一节，`docs/DEVELOPMENT-PROCESS.md`（在 `origin/ux/design` 上，用 `git show` 读）。

开始前确认这份文件有 4 个二级标题，最后一节是"报告"。

## 目标

现象：vivo X60 经 Relay 在测试项目里新建会话，显示"结果待确认"；点一次"重试"（用原来的 actionId），Windows 上仍然没有对应的会话。同一台手机直连新建是好的，经 Relay 的回复、停止、批准、归档也都好。

要做到：

1. **确认根因**：先确认 Host 有没有收到这次请求，再确认收到后发生了什么。不用手机，用仓库里的 Supervisor 测试客户端或开发诊断页复现。
2. **修复根因**。不改帧的形状、协议版本和帧上限。
3. **用户能恢复**：新建的结果不确定时，用户要么重试后得到会话，要么得到明确的失败原因，不能一直卡在"结果待确认"。
4. **回归测试**：覆盖这次的根因。
5. **验证**：用测试客户端经直连和经 Relay 各新建几次，每次 Host 上恰好多一个会话，第一条消息只发一次。

改完推送分支，不合并。手机和平板的复测这轮不做，完成后告诉用户。

## 已知情况

- **Host 的诊断**：`fd1d905` 起，Supervisor 对每个请求都记诊断，成功是 `supervisor.read`，失败是 `supervisor.read.failed`，带操作名、传输方式、错误码和异常类名。复测时 Windows 上跑的就是 `fd1d905`，先去 Host 的日志里找那次新建的记录（时间在复测报告里），再决定往哪查。
- **几个怀疑方向**（都没确认）：
  - **请求根本没到 Host**：比如经 Relay 的这一帧在路上丢了，或者手机端在发送前就失败了，又被当成了"结果不确定"。
  - **Host 在建会话之前就失败了，但返回的是 `internal`**：客户端把 `internal` 当成结果不确定。Host 的去重缓存会记住失败（`apps/host/src/api/action-idempotency-cache.ts`），同一个 actionId 重试只会拿回同一个失败，所以永远是"待确认"。
  - **客户端超时后 Host 把操作取消了**：`conversation.create` 在 Rust 核心里的等待上限是 8 秒（`packages/supervisor-mobile/src/wire.rs` 的 `MESSAGE_TIMEOUT`，`wait_ms` 对它是 0）。新建要建会话、启动 AI 工具、发第一条消息，经 Relay 多一段延迟，可能超过 8 秒。如果手机超时后断开连接，而 Host 的新建挂在这个连接或请求的取消信号上，就会被取消。
  - **写操作的响应超过帧上限**：`fd1d905` 的发送前检查跳过了写操作（`docs/reviews/fix-b1-supervisor-internal.md` 的建议改第 1 项）。不过这种情况下 Host 上应该已经有会话，和现象对不上，优先级低。
- **`action.get` 查不到新建的结果**：它只查发消息的 actionId（`apps/host/src/api/supervisor-transport-manager.ts` 里调的是 `getTurnForStartAction`），新建的 actionId 一律 `not_found`。客户端只能用同一个 actionId 重发。这是 B3 计划处理的一项（`docs/ux-redesign/08-remote-management.md` §5），如果修复需要让 `action.get` 能查到新建的结果，可以一起做，报告里说明。
- **客户端的分类**：安卓在 `apps/android/app/src/main/java/org/codetether/app/remote/RemoteSupervisor.kt` 的 `uncertainErrors`，iPad 在 `origin/i1/ipad-app` 的 `apps/ios/Sources/CodeTether/SupervisorClient.swift`。根因如果在客户端，先问用户。
- **复现环境**：不要用 Windows 的正式安装版做写操作复现。优先用独立的数据目录、独立端口的 Host 实例，加上隔离的 Relay，上一个修复任务就是这样验证的（`D:/Projects/Software/agenthub-archive/b1-supervisor-internal-report.md`）。平板验收可能同时在用 Windows 的正式安装版，不要占用 4317。
- **质量检查**：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`。完整的 `pnpm test` 里 Relay 指纹限流用例（`apps/relay/test/relay-service.test.mjs:1164`）偶尔失败，单跑能过；遇到就重跑并在报告里记一笔。

## 边界

- **自己决定**：诊断方法；修复方式；测试怎么写；提交怎么拆；构建环境问题。
- **先问用户**：
  - 根因在安卓、iOS 或 Rust 核心，需要改那边的代码；
  - 要改帧的形状、协议版本、帧上限，或者加数据库迁移；
  - 需要用户在手机、平板或 Windows 上本人操作；
  - 动 Windows 的正式安装版；
  - 改生产服务的配置；
  - 推送 `main`、打标签。
- **不做**：
  - 读取或打印凭据，日志和报告里不出现令牌、密钥、连接串、消息内容；
  - 强制推送、改写已推送的历史。

## 报告

写到 `D:/Projects/Software/agenthub-archive/relay-create-uncertain-report.md`：

- 根因和证据：Host 日志里那次新建的记录，以及复现的过程；
- 改动的提交和推送后的远端提交；
- 质量检查的结果，失败的原样贴出；
- 直连和 Relay 新建的验证结果：每次 Host 上的会话数和第一条消息的轮数；
- 没做完的事和原因，以及在"完成"的哪一级。

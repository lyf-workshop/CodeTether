# 审核记录：fix/android-retry-explicit-failure

日期：2026-11-07。审核对象：`origin/fix/android-retry-explicit-failure` 的 `aeac893`，对比 `e4bdd57`，5 个文件，都在 `apps/android`。任务：`docs/reviews/android-retry-explicit-failure-fix-prompt.md`。执行报告：`D:/Projects/Software/agenthub-archive/t1a-report.md` 的"重试明确失败修复"。

## 第 1 轮

结论：没有“必须改”，可以合并，也可以在它上面接着做平板修复。

核对过、没有问题的：

- **根因对**：原 `TabletController.executeMutation` 的异常分支写成 `retrying || …`，重试的任何失败都回到 `Unknown`。现在改成 `RemoteSupervisor.isUncertainMutationFailure(failure, retrying)`：只有 `RemoteSupervisor.mutate` 里写请求本身得到明确拒绝（或 Rust 发送前的检查失败），才带上 `definitiveMutationFailure` 标记。
- **`action.get` 的 `not_found` 不会被误判**：重试前的读取抛出的 `RemoteFailure("not_found")` 没有这个标记，重试时仍然是不确定；测试 `actionNotFoundAndUncertainRetriesKeepTheOriginalSendUntilOneSuccess` 专门覆盖这一点，并断言整个过程只有一次逻辑执行。
- **两条路径、进程恢复都覆盖**：发送和新建的明确失败都有 Compose 测试，序列化恢复后的明确失败有控制器测试。
- **明确失败后的恢复**：清掉待确认、显示原因、保留草稿和新建表单，再提交用新的 actionId，测试里断言了 `actionId` 不同。
- **刷新**：失败后读一次原会话或原项目（`refreshRejectedMutation`），仅在前台、客户端没换的时候做，`outcome` 现在返回是否真的记录了，避免待确认已被替换时还去刷新。

建议改（不挡合并）：

1. **`uncertainErrors` 悄悄加了两个码**：`protocol_error` 和 `unavailable`。`protocol_error` 合理，和 iPad 第 2 轮一致。`unavailable` 是个行为变化：以前首次提交收到 `unavailable` 记为失败，现在记为待确认。
   - 保守的理由成立：Host 把 `machine_unreachable` 等也归为 `unavailable`，其中有写请求可能已经到了对端的情况，当成失败会让用户重发一条重复的提示。
   - 代价也要记下：Host 的去重缓存会记住失败（`apps/host/src/api/action-idempotency-cache.ts`）；`runtime_unavailable` 这类执行前的失败也在缓存里，同一个 actionId 重试只会拿回同一个错误，用户只能放弃这条待确认再重发。
   - 决定：两个平台按安卓现在的分类统一，iPad 第 4 轮提示词已写明。Host 侧的根本修法是不缓存执行前的瞬时失败，记入 B3。
   - 报告没有说明为什么加这两个码，以后改分类要在报告里写原因。
2. **`internal` 仍算不确定**：这符合约定，但 `internal` 现在是 Host 里所有没归类的错误，包括执行前就失败的。B4a 的失败原因（`data.reason`）上线后，客户端可以区分更多情况，到时回头看这张分类表。
3. 报告里只写了“真实控制器及 Compose 路径覆盖”，没有列出每个测试的名字。测试代码我看了新增和改动的部分，覆盖和描述相符，没有逐条核对断言。

## 后续

这个分支是线性的，在它上面开 `fix/t1a-tablet-fidelity`；发布时按 `fd1d905`、`e4bdd57`、本分支、`fix/t1a-tablet-fidelity` 的顺序快进。

# 审核记录：fix/b1-supervisor-internal

日期：2026-11-07。审核对象：`origin/fix/b1-supervisor-internal`（`46f2e81`、`fd1d905`），对比 `main` 的 `b668e53`。任务：`docs/reviews/b1-supervisor-internal-fix-prompt.md`。执行报告：`D:/Projects/Software/agenthub-archive/b1-supervisor-internal-report.md`。

## 第 1 轮

结论：没有“必须改”，可以合并。下面是“建议改”，放到后续任务里做，不挡这次合并。

审核范围：传输层（`server.ts`、`constants.ts`）、预算模块（`supervisor-read-budget.ts`、`supervisor-machine-reads.ts`）、持久化里的两个目录查询和历史分页、`host-service.ts` 里的远程历史和实时读取。`supervisor-transcript-budget.ts` 只看了涉及身份字段的部分。测试只看了范围，没有逐条核对。

核对过、没有问题的：

- 发送前对读取响应按完整帧（含外壳）计算字节数，超过 16 KiB 时记 `supervisor.read.frame_too_large` 后失败，不再落到发送时抛错。`supervisorTransportLimits.maximumFrameBytes` 改成引用 machine-transport 的 16 KiB，全仓库只有 `server.ts` 用它。
- 诊断只记操作名、传输方式、字节数、错误码和异常类名（`server.ts` 的 `supervisorReadErrorFields`），不记内容。
- `machine.get` 不再转发 `providerLifecycles`。安卓、iPad、桌面远程读取都不读这个字段。
- 项目和会话目录：游标取自最后一条实际返回的记录，`hasMore` 按实际返回的条数算，不会跳过或重复。项目游标用的 `updatedAt` 就是排序键 `sort_at`（`supervisorProjectDirectoryItemFromRow`）。
- 新加的 `truncated` 字段，桌面远程读取的解析（`remote-supervisor.ts:965`、`:1004`）是逐项检查，多一个字段不影响。
- 持久化的改动都只在读取路径：没有迁移、不写库。`readDurableConversationHistoryPage` 只被远程历史调用（`host-service.ts:2079`、`:2193`），本机界面的历史不受影响。
- 实时读取在第一条事件都放不下时返回 `resetRequired: true`。安卓（`RemoteProjection.kt:216`）和 iPad（`SupervisorClient.swift:255`）都处理这个字段。

建议改：

1. **写操作没有发送前检查**（`server.ts` 计算 `responseBytes` 时跳过了控制操作）。写操作的响应超限时仍然变成 `internal`，而且没有诊断；同一个 actionId 重发会拿回同一个过大的结果，永远是“结果不确定”。至少记诊断，并在测试里断言这几个写操作的响应大小有上限。
2. **机器列表和推理选项被截断时，客户端看不出来**。`supervisorMachineList`、`supervisorMachineDetail` 用 `Symbol` 标记截断，不进 JSON，原因是有客户端对机器数据做严格校验。机器多到超过 12 KiB 时，设备上会少显示几台，而且没有提示。先记为已知限制；以后让那几个客户端容忍多余字段，再用 JSON 字段标出来。
3. **经 Node 的电脑上，导入的原生会话一次只读一条历史**（`host-service.ts` 远程原生历史：非本机时 `limit` 固定为 1）。结果是对的，但这类会话的历史要一条一条往回翻，很慢。设备复测时看一下实际体验。
4. **截断后的条目去掉了 `terminal.itemId`**（`supervisor-transcript-budget.ts:153-156`），截断的 diff 文本（:225）也只加了省略号，没有单独标记。客户端可能把被截断的 diff 当成完整的显示。真机复测时看一下变更面板。

## 后续

用户同意后合并到 `main`，Mac 和 Windows 的安装版更新到新的 `main`，iPad 和安卓再复测。复测结果写在这份记录的“验收”一节。

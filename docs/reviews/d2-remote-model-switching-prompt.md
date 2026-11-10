# 任务：D2 远程模型切换（Supervisor 协议扩展）

在 Mac 或 Windows 上运行。接着在 `main` 上做（当前是 `4801ef1`）。扩展 Supervisor 协议支持远程会话内切换模型和推理强度，让平板/iPad 访问远程 Codex/Claude 时能和原生 app 体验一致。提交推送到 `feat/d2-remote-model-switching`，不推 `main`、不合并、不打标签。

依据（都用 `git show` 读）：

- `docs/ux-redesign/10-desktop-improvements.md` §I3（Composer 模型切换）
- `docs/reviews/d2-protocol-model-switching-prompt.md`：本地模型切换的设计（已实现于 `feat/d2-model-switching` @ `c9ba712`，本轮做远程部分）
- `docs/ux-redesign/08-remote-management.md` §3.1：Supervisor 操作扩展规则
- `packages/supervisor-transport/src/protocol.ts`：当前协议结构
- `packages/supervisor-transport/src/server.ts`：操作分发逻辑

开始前确认这份文件有 4 个二级标题，最后一节是"报告"。

## 背景

本地模型切换已在 `feat/d2-model-switching` 实现：
- 新增 `PATCH /api/v1/conversations/:id/model` 接口
- `conversations` 表增加 `current_model` 和 `current_reasoning` 字段（migration 026）
- `ProviderDescriptor` 增加 `availableModels` 字段
- `ConversationSummary` 增加 `currentModel` 和 `currentReasoning` 字段
- Composer 有模型选择控件（本地会话可用）

这一轮把同样的能力通过 Supervisor 协议暴露给远程设备（平板/iPad）。

## 目标

**必须完成**：

1. **新增 Supervisor 操作 `conversation.updateModel`**：
   - 请求：`conversationId`、`actionId`、可选 `model`、可选 `reasoning`
   - 权限：要求控制权限，加进 `isSupervisorControlOperation`
   - 执行：调用本机已有的模型切换逻辑（`host-service.ts` 的相应方法）
   - 返回：更新后的 `ConversationSummary`（含 `currentModel` 和 `currentReasoning`）
   - 幂等：同一个 `actionId` 重发返回第一次的结果
   - 限制：不能切换 Provider（Codex 不能换成 Claude），只能切换模型和推理强度

2. **`conversation.list` 和 `conversation.detail` 返回 `currentModel` 和 `currentReasoning`**：
   - `SupervisorConversationDirectoryItem` 增加 `currentModel?` 和 `currentReasoning?` 字段
   - `listSupervisorConversations` 查询取这两个字段
   - Supervisor 会话详情同样带这两个字段
   - 只在 Provider 支持时返回（Codex 和 Claude 都支持）

3. **`machine.get` 的 Provider 描述返回 `availableModels`**：
   - 通过 Supervisor 获取设备详情时，`ProviderDescriptor` 包含 `availableModels`
   - 格式和本机接口一致：`Array<{ id: string; name: string; description?: string }>`
   - 客户端用这个列表渲染模型选择 UI

4. **Rust 核心方法**：
   - `packages/supervisor-mobile/src/lib.rs` 增加 `conversation_update_model` 函数（通过 UniFFI 暴露）
   - 请求：`conversationId`、`actionId`、可选 `model`、可选 `reasoning`
   - 返回：更新后的 `ConversationSummary`
   - Kotlin 调用层（`apps/android/`）增加对应调用
   - iOS Swift 层目前无仓库，只在报告里说明接口签名

5. **帧大小检查**：
   - `availableModels` 列表如果很长可能超过 16 KiB
   - 如果超限，截断 `availableModels` 并带 `_truncated: true` 标记
   - 实测 Codex 和 Claude 的模型列表大小，记录在报告里

**应该完成**：

6. **SSE 事件**：
   - 模型切换成功后发送 `conversation.updated` 事件
   - 事件携带 `currentModel` 和 `currentReasoning`
   - 平板/iPad 收到事件后更新 Composer 显示

## 已知情况

- 本地模型切换已实现（`feat/d2-model-switching` @ `c9ba712`），但这个分支还没合并到 `main`
- 本轮从 `main`（`4801ef1`）开始，不依赖 `feat/d2-model-switching`
- 两个分支最终会一起合并，所以这轮只做 Supervisor 协议部分，不重复本地接口
- 如果 `feat/d2-model-switching` 合并前，可以先从它 cherry-pick 必要的 schema 变更

- 当前 Supervisor 协议版本 1（`packages/supervisor-transport/src/protocol.ts`）
- B4a 已增加 `reason` 字段和 6 个远程操作，本轮在此基础上增加 `conversation.updateModel`
- Rust 核心（`packages/supervisor-mobile/`）已有 B4a 增加的操作，本轮继续扩展

## 边界

**自己决定**：
- 是否直接从 `feat/d2-model-switching` cherry-pick schema，还是重新定义
- `availableModels` 截断阈值（建议 50 个模型，超过实际不会有）
- 实现方式和提交拆分方式

**先问用户**：
- 需要改 Supervisor 协议版本号
- 需要改已冻结的 Phase 边界
- 需要改 `main` 以外的基础设施

**不做**：
- 不实现 iOS Swift 调用层（仓库没有 iOS App）
- 不实现前端接入（D2.1b 阶段做）
- 不推 `main`、不合并、不打标签

## 报告

追加到 `~/agenthub-archive/d2-protocol.md`，新开"远程模型切换"一节：

- 新增的 Supervisor 操作（请求/响应格式）
- `availableModels` 实测帧大小（Codex 和 Claude 各多少个模型，占多少字节）
- 是否 cherry-pick 了 `feat/d2-model-switching` 的 schema，还是重新定义
- Rust 函数签名（方便 iOS 后续实现）
- Kotlin 调用层改动
- 测试结果（typecheck / lint / Rust / Android / build）
- 提交哈希和推送的远端分支
- 没做完的事和原因

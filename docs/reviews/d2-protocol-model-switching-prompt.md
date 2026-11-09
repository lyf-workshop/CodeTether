# 任务：D2 协议扩展 — 会话内切换模型

在 Mac 或 Windows 上运行。依据：`docs/ux-redesign/10-desktop-improvements.md` I3（Composer）的 Q3 决定，目标是让用户在 CodeTether 里使用 Codex/Claude 时体验与原生 app 一致。

开始前确认这份文件有 4 个二级标题，最后一节是"报告"。

## 目标

扩展 Protocol v1，支持在已有会话内切换模型和推理强度，而不需要新建会话。

**必须改**：

1. **新增 `conversation.updateModel` 接口**（或类似名称）：
   - 路径：`PATCH /api/v1/conversations/:conversationId/model`
   - 请求体：
     ```json
     {
       "model": "gpt-4o",           // 可选，切换模型
       "reasoning": "high"           // 可选，切换推理强度（Claude）
     }
     ```
   - 响应：更新后的会话摘要（`ConversationSummary`）
   - 权限：只有会话所属的 Machine 在线且有控制权限时才能切换
   - 限制：
     - 不能切换 Provider（Codex 不能换成 Claude，反之亦然）
     - 只能切换该 Provider 支持的模型
     - 如果 Provider 不支持模型切换，返回 `operation_not_allowed`

2. **`ConversationSummary` 增加当前模型和推理强度字段**：
   - `currentModel?: string`：当前使用的模型 ID（如 `"gpt-4o"`、`"claude-opus-5-5"`）
   - `currentReasoning?: string`：当前推理强度（如 `"high"`、`"medium"`）
   - 只有支持切换的 Provider 才返回这两个字段

3. **`ProviderDescriptor` 增加可用模型列表**：
   - `availableModels?: Array<{ id: string; name: string; description?: string }>`
   - 例如 Codex 返回：
     ```json
     [
       { "id": "gpt-4o", "name": "GPT-4o", "description": "最新的 GPT-4 优化版本" },
       { "id": "gpt-4", "name": "GPT-4" },
       { "id": "o1-preview", "name": "o1 Preview", "description": "深度推理模型" }
     ]
     ```
   - 例如 Claude 返回：
     ```json
     [
       { "id": "claude-opus-5-5", "name": "Opus 5.5" },
       { "id": "claude-sonnet-5-5", "name": "Sonnet 5.5" },
       { "id": "claude-haiku-5-5", "name": "Haiku 5.5" }
     ]
     ```
   - 如果 Provider 不支持模型列表，字段为空或不返回

4. **Host 实现**：
   - Codex adapter：
     - 读取 Codex 的可用模型列表（如果 Codex 提供）
     - 切换模型时调用 Codex 的模型切换接口（如果支持）
     - 如果 Codex 不支持会话内切换，返回 `operation_not_allowed`
   - Claude adapter：
     - 返回固定的 Claude 模型列表（Opus/Sonnet/Haiku）
     - 切换模型时修改下一轮 Turn 的模型参数
     - 推理强度对应 Claude 的 `--effort` 参数
   - 数据库：在 `conversations` 表增加 `current_model` 和 `current_reasoning` 字段（可为空）
   - SQLite migration：新增 migration 015（`conversation_model_switching`）

5. **SSE 事件**：
   - 模型切换成功后发送 `conversation.updated` 事件，包含新的 `currentModel` 和 `currentReasoning`
   - 前端收到事件后更新 Composer 显示

6. **远程会话支持**：
   - 远程 Codex/Claude 会话也支持模型切换
   - Node 端的 adapter 同样实现模型切换逻辑
   - 通过 Supervisor 协议传递模型切换请求

**边界**：

- **不改变 Provider**：Codex 会话不能切换成 Claude，反之亦然
- **不影响历史**：切换模型只影响下一轮 Turn，历史 Turn 保持原模型
- **降级行为**：如果切换失败（Provider 不支持、模型不可用），返回明确错误，不影响已有会话
- **权限检查**：只有有控制权限的客户端可以切换模型

## 已知情况

- 当前新建会话时固定 Provider、模型、推理强度，会话内不能切换
- `ConversationSummary` 有 `provider` 字段，但没有 `currentModel`
- `ProviderDescriptor` 有 `capabilities`，但没有 `availableModels`
- Codex 和 Claude Code 的原生 CLI 是否支持会话内切换模型？待验证
  - 如果原生不支持，我们自己实现（通过重新创建 session 或调整参数）

## 边界

- **自己决定**：
  - 接口路径和命名（`updateModel`、`switchModel`、`setModel` 都可以）
  - 数据库字段命名
  - 如何判断 Provider 是否支持模型切换
  - 如果原生 CLI 不支持，如何在 adapter 里实现
- **先问用户**：
  - 要改 Protocol v1 以外的协议（如 Supervisor 协议）
  - 要修改 frozen 的 Phase 边界
  - 需要用户提供 Codex/Claude 的测试账号或密钥
- **不做**：
  - 不自动切换模型（由用户手动选择）
  - 不推荐模型（只列出可用的）
  - 不支持自定义模型（只用 Provider 提供的）

## 报告

完成后写到 `~/agenthub-archive/d2-protocol.md`：

- 新增的接口路径和请求/响应格式
- 数据库 migration 的内容
- Codex/Claude adapter 的实现方式（是否调用原生接口，还是自己实现）
- 测试：本地 Codex 会话切换模型、本地 Claude 会话切换模型和推理强度、远程会话切换
- 如果原生 CLI 不支持，说明你是怎么实现的
- 提交哈希和推送的远端分支

分支名：`feat/d2-model-switching`，推送到 `origin`，不合并到 `main`。

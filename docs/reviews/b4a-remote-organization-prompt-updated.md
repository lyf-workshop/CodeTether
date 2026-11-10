# 任务：B4a 远程组织操作（远程管理第 1 轮）— 包含投影策略

在 Windows 或 Mac 上运行。接着在 `main` 上做（当前是 `b668e53`）。B4 让平板和 iPad 能做电脑上剩下的那些管理操作，分三轮，这是第一轮：失败响应带原因、`conversation.list` 的 `pinnedAt` 和 `archived`、远程添加/移除项目、远程置顶/重命名/恢复会话、远程搜索。**新增**：`project.create` 响应可能超过 16 KiB 帧限制时，返回目标设备的投影。提交推送到 `feat/b4a-remote-organization`，不推 `main`、不合并、不打标签。

依据（都用 `git show` 读）：

- `docs/ux-redesign/08-remote-management.md`：完整的设计（7 节），B4a 对应 §3.1、§3.2、§7 的第一行
- `docs/ux-redesign/03-project-plan.md` §4 的 B4 行
- `docs/ux-redesign/06-pairing-remote-control.md` §1：文案规则
- 本提示词的"投影策略"节

开始前确认这份文件有 4 个二级标题，最后一节是"报告"。

## 目标

**必须完成**：

1. **失败响应带原因**（08 §3.2）：
   - 扩展 Supervisor 协议响应帧，增加 `reason` 字段
   - `reason` 用 `HostErrorCode`（`packages/protocol/src/errors.ts`）的子集
   - 从本机 `HostError` 映射到 Supervisor 响应时保留 `code` 和 `reason`
   - 手机和平板的 Rust 核心增加 `reason` 字段（可选，向后兼容）
   - 客户端（Kotlin 和 Swift）使用 `reason` 显示更精确的错误文案

2. **`conversation.list` 的 `pinnedAt` 和 `archived`**（08 §2）：
   - `SupervisorConversationDirectoryItem` 增加 `pinnedAt` 字段
   - `listSupervisorConversations` 的查询取 `pinned_at`
   - 排序改为：置顶优先（`pinnedAt DESC`），然后 `last_activity_at DESC`
   - 增加 `archived` 参数（`active`、`archived`、`all`），默认 `active`

3. **新增远程操作**（08 §3.1）：
   - `project.create`：复用 `createProject`（本机）或 `createRemoteProject`（其他设备）
   - `project.remove`：删除项目，有会话时拒绝，原因 `project_has_conversations`
   - `conversation.pin`：置顶会话，请求带目标状态 `pinned`（不是切换）
   - `conversation.rename`：重命名会话，标题 1 到 240 个码元、最多 160 个字素，NFC 规范化
   - `conversation.restore`：恢复会话，会话已经是未归档时返回成功和当前会话
   - `conversation.search`：搜索会话，查询最多 256 个码元、160 个字素，每页默认 25、最多 100

4. **权限门控**（08 §3.1）：
   - `project.create`、`project.remove`、`conversation.pin`、`conversation.rename`、`conversation.restore` 要求控制权限
   - `conversation.search` 只要求查看权限（08 §6 第 3 项已确认）
   - 加进 `isSupervisorControlOperation`（`packages/supervisor-transport/src/server.ts:710`）

5. **`actionId` 幂等**（08 §3.1）：
   - `project.create` 的作用域：本机设备用全局 `'project.create'`，其他设备用 `project.remote.create:<machineId>`
   - `project.remove` 的作用域：`project.delete:<projectId>`
   - `conversation.pin`、`conversation.rename`、`conversation.restore` 的作用域：会话（和本机一致）
   - 重发处理：同一个 actionId 返回第一次的结果，收到明确失败时换新 actionId 重试

6. **写操作的帧检查**（08 §2）：
   - 返回里的 `data` 放得进 16 KiB 的帧
   - 行数据沿用 12 KiB（`supervisor-operations.ts:20` 的 `maximumRowsBytes`）
   - **新增投影策略**（见下面"投影策略"节）

7. **Rust 核心方法**（08 §3.1）：
   - `packages/supervisor-mobile/src/lib.rs` 增加对应的 Rust 函数（通过 UniFFI 暴露）
   - Kotlin（`apps/android/app/src/main/kotlin/org/codetether/supervisor/`）和 Swift（`apps/ios/Sources/CodeTether/`）调用这些方法

8. **文案规则**（06 §1、08 §1）：
   - 界面上不出现 Host、Node、Machine、ProductDevice、Supervisor、Relay、授权、grant、指纹
   - 错误只说发生了什么、怎么办

---

## 投影策略（新增）

### 问题

`project.create` 返回完整 `Project` 对象时，极端情况会超过 16 KiB 帧限制：
- 项目最多 64 个位置，每个路径 4096 字节
- 理论最大：64 × 4096 ≈ 260 KiB >> 16 KiB 帧上限

### 决策

允许 Supervisor 在响应超限时返回**目标设备位置的投影**，使用 `_projection` 字段标记。

### 实现细节

**响应结构**（`project.create` 超限时）：

```typescript
{
  project: {
    projectId: "proj_xxx",
    name: "my-project",
    // ... 基础字段（displayName, createdAt 等）
    locations: [
      {
        machineId: "target-machine-id",  // 仅包含目标设备的位置
        path: "/path/to/project",
        availability: "available",
        // ... 其他必要字段
      }
    ],
    // 新增投影标记
    _projection: {
      type: "target_location_only",      // 标记这是投影
      reason: "frame_size_exceeded",     // 为什么是投影
      completeSizeEstimate: 260000,      // 完整项目估计大小（字节）
      omittedLocationCount: 63           // 省略了多少个位置
    }
  },
  created: true,
  location: { ... }  // 目标设备的位置详情
}
```

**协议扩展**（`packages/protocol/src/commands.ts`）：

```typescript
export const CreateRemoteProjectResponseSchema = z.object({
  project: ProjectSchema.extend({
    _projection: z.object({
      type: z.enum(['complete', 'target_location_only']),
      reason: z.enum(['frame_size_exceeded']).optional(),
      completeSizeEstimate: z.number().optional(),
      omittedLocationCount: z.number().optional(),
    }).optional(),
  }),
  location: RemoteProjectLocationSchema,
  created: z.boolean(),
})
```

**客户端行为**：

- 收到 `_projection.type === 'target_location_only'` 时，项目创建成功但仅显示目标位置
- 立即发起 `project.detail` 后台加载完整项目
- 用户看到项目创建成功，位置列表逐步加载（无 UX 中断）

**实测数据**：

- 典型项目（1-8 位置）：完整响应 < 1 KiB，总是完整返回
- 大型项目（8-16 位置）：< 8 KiB，总是完整返回
- 极端项目（64 位置）：~260 KiB，返回投影

### 与本机的差异

| 维度 | 本机 `createProject` | 远程 `project.create` |
|------|-----------------|-----------------|
| 返回完整项目 | 总是 | 通常；超限时返回投影 |
| 投影标记 | 无 | 有 `_projection` 字段 |
| 帧大小限制 | 无 | 16 KiB |
| 客户端体验 | 创建后直接看到所有位置 | 创建后仅看目标位置，其他后加载 |

**投影极少发生**：极端项目（64 位置）极其罕见（估计 <0.1% 用户），但协议必须处理这种情况，否则返回 `internal` 错误。

---

## 已知情况

- 现状：`main` `b668e53`
- 远程操作走 Supervisor，请求是 `supervisor.request`，按 `operation` 区分，协议版本 1
- B1 的操作在 `supervisorB1OperationSchema`（`packages/supervisor-transport/src/protocol.ts:372`）
- 本机对应的执行在 `apps/host/src/api/supervisor-operations.ts:71` 的 `executeSupervisorB1Operation`
- 权限只有一种：`supervisor_read` 或 `supervisor_control`
- 变更都带 `actionId`，格式 `act_` 加 6 到 96 个字符
- Host 的 `#executeAction` 按 actionId 去重

- 响应帧（`protocol.ts:517`）：只有 `ok`、`data`、`code`、`httpStatus`
  - `code` 只有 8 个值：`invalid_request`、`operation_not_allowed`、`not_found`、`conflict`、`unsupported`、`unavailable`、`session_expired`、`internal`
  - `httpStatus` 只允许 409 或 422，而且只在 `code` 是 `unsupported` 时出现
  - 错误被压扁了：失败响应在 `server.ts:646` 构造，只带 `code`。B4a 增加 `reason` 字段。

- 大小限制：
  - 手机和平板的 Rust 核心每个请求不超过 16 KiB，单次等待 8 秒
  - Supervisor 的实际帧上限是 16 KiB
  - 列表的行数据被压到 12 KiB 以内

- 本机已有、远程还没有的：
  - 添加项目：`createProject`（`host-service.ts:3266`）和 `createRemoteProject`（:2393）
  - 移除项目：`deleteProject`（`host-service.ts:3290`）
  - 搜索：`searchProjectConversations`（`host-service.ts:2524`）
  - 置顶、取消置顶、重命名、恢复：`pinConversation`（:3108）、`unpinConversation`（:3127）、`renameConversation`（:3088）、`unarchiveConversation`（:3176）

- 会话目录缺置顶：`SupervisorConversationDirectoryItem` 没有 `pinnedAt`，`listSupervisorConversations` 的查询也不取 `pinned_at`

## 边界

**自己决定**：
- 实现方式
- 提交怎么拆（每项一个或几个提交，带测试）
- 测试和截图的方法
- `reason` 字段的具体子集（从 `HostErrorCode` 里选）
- 投影策略的帧大小阈值（当前是 16 KiB，可以调整吗？建议保持不变）

**先问用户**：
- 需要改 Supervisor 协议的版本号（协议扩展通常要升版本）
- 需要改手机和平板的 Rust 核心的公开接口（UniFFI 定义）
- 投影策略是否需要在现在实现，还是等遇到实际超限时再补（建议现在实现）

**不做**：
- 读取或打印凭据
- 推送 `main`、合并、打标签
- 强制推送
- 浏览文件夹（B4b）
- 扫描和导入以前的会话（B4c）

## 报告

追加到 `~/agenthub-archive/b4a-report.md`（新文件），写这几节：

- 起点：分支从哪个提交开始，确认 08 的 7 节都读过
- 1 到 8 每一项改了什么、对应的提交
- 协议扩展的细节（`reason` 字段的具体子集、是否升协议版本、`_projection` 字段的实现）
- 投影策略的实测数据（不同大小项目的响应帧字节数）
- Rust 测试结果（单元测试、集成测试）
- Node.js 测试结果（类型检查、lint、单元测试、集成测试）
- 投影策略的客户端处理验证（Kotlin 和 Swift 是否正确处理了 `_projection` 字段）
- 推送后的远端提交
- 没做完的事和原因，以及在"完成"的哪一级

---

## 不在这轮

- `folder.list`（浏览文件夹）：B4b
- `provider-sessions.discover`、`provider-sessions.adopt`（扫描和导入以前的会话）：B4c
- T1b 和 iPad 的远程管理界面：B4 三轮都合进 `main` 以后做


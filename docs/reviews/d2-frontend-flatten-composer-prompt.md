# 任务：D2.1 前端实现 — 扁平化电脑层级 + Composer 基础重做

在 Windows 上运行。依据：`docs/ux-redesign/10-desktop-improvements.md` I1（扁平化）和 I3（Composer）。这一轮先做扁平化和 Composer 基础输入框，模型切换等协议完成后再接入。

开始前确认这份文件有 4 个二级标题，最后一节是"报告"。

## 目标

**必须改**：

### 第一部分：扁平化电脑层级（I1）

1. **隐藏 Machine 概念，显示"电脑"**：
   - 用户界面不再出现"Machine""Node"字样
   - 一台物理电脑可能有多个 Machine（如 Windows + WSL），显示为两台独立的电脑
   - 命名规则（使用 `displayName` + `platform` + `architecture`）：
     - **主标题**：`displayName`（Machine 的 displayName 字段，用户自定义的电脑名称，最长 240 字符）
     - **副标题**：`操作系统 · 架构 · 连接状态`
       - 操作系统：`platform` 字段映射（"windows" → "Windows"、"darwin" → "macOS"、"linux" → "Linux"）
       - 架构：`architecture` 字段（"x64"、"arm64" 等）
       - 连接状态：`connectionState` 映射（"local" → "在线"、"online" → "在线"、"offline" → "离线"、"connecting" → "连接中"）
     - **本机显示**：`displayName` + 副标题（不特殊处理为"这台电脑"，用户能看到自己给电脑的命名）
     - **远程电脑示例**：
       - "MacBook Pro" / "macOS · arm64 · 在线"
       - "Windows WSL" / "Linux · x64 · 在线"（用户自定义 displayName 为"Windows WSL"）
       - "Ubuntu Server" / "Linux · x64 · 离线"

2. **设备页（`/devices`）重构**：
   - 每个 Machine 显示为一张独立的电脑卡片
   - 卡片内容：
     - 标题：`displayName`（加粗，如"MacBook Pro"）
     - 副标题：`操作系统 · 架构 · 连接状态`（如"macOS · arm64 · 在线"，灰色）
     - 详细信息：
       - AI 工具状态：Codex / Claude Code 各一行，显示安装状态（"可用""未安装""未登录"）
       - 项目数量（"3 个项目"）
   - 点击卡片进入设备详情页
   - 布局：网格布局，每行 2-3 张卡片（响应式）
   - 排序：
     - 本机排第一
     - 远程电脑按最近在线时间排序
     - 离线的电脑排后面

3. **设备详情页（`/devices/:machineId`）重构**：
   - 页面标题：`displayName`（如"MacBook Pro"）
   - 副标题：`操作系统 · 架构 · 连接状态 · 连接方式`（如"macOS · arm64 · 在线 · 同一网络"）
   - 第一节：**项目**（每个项目一张卡片，显示名称、路径缩略、最近活动）
   - 第二节：**最近的会话**（最近 10 条，按时间排序，每行显示标题、Provider、项目、状态）
   - 第三节：**AI 工具**（Codex / Claude Code 的详细状态，安装位置、版本、登录状态、能力）
   - 第四节：**连接**（连接方式、上次在线时间、Relay 状态）
   - 底部操作：
     - "添加项目"（只在本机或有文件访问权限的远程）
     - "配对新设备"（只在本机）

4. **新建会话（`/conversations/new`）项目选择器**：
   - 按电脑分组（用 `<optgroup>` 或自定义下拉）
   - 每组标题：`displayName (操作系统)`（如"MacBook Pro (macOS)"、"Windows WSL (Linux)"）
   - 本机特殊：显示为"这台电脑 (操作系统)"
   - 每组下面列出该电脑的项目
   - 离线的电脑和项目显示为灰色不可选，副文本说明原因

5. **会话列表和搜索**：
   - 会话行的"设备"字段改为显示电脑名称（不显示"Machine"）
   - 搜索结果的设备分组也用电脑名称

6. **术语映射**（全局替换）：
   - 代码里的 `Machine` 类型保持不变（后端不改）
   - 前端显示文本：
     - "Machine" → 不显示
     - displayName 直接显示为电脑名称
     - platform 字段映射为操作系统名称（"windows" → "Windows"、"darwin" → "macOS"、"linux" → "Linux"）
     - architecture 字段显示为架构名称（"x64"、"arm64" 等）
     - connectionState 字段映射为连接状态（"local"/"online" → "在线"、"offline" → "离线"、"connecting" → "连接中"）
     - "Node" → 不显示

---

### 第二部分：Composer 基础重做（I3.1，不含模型切换）

7. **多行输入框增强**：
   - 使用 `<textarea>` 替换当前的单行输入框
   - 初始高度：2 行（约 48px）
   - 自动扩展：输入内容超过 2 行时自动增高，最大到视口 40%
   - 超过最大高度时内部滚动（`overflow-y: auto`）
   - Placeholder 根据 Provider 显示：
     - Codex："告诉 Codex 要做什么…"
     - Claude："问 Claude 一个问题…"
     - 默认："输入消息…"

8. **快捷键**：
   - Enter：发送（可在设置里改为 Ctrl+Enter 发送，Enter 换行）
   - Shift+Enter：始终换行
   - Ctrl+Up：复制上一轮的输入（填充到输入框）
   - Esc：清空输入框
   - 快捷键配置保存在 `localStorage`（Key: `composer-send-shortcut`，值: `"enter"` 或 `"ctrl-enter"`）

9. **草稿自动保存**：
   - 每次输入后 500ms 自动保存到 `localStorage`
   - Key: `composer-draft-${conversationId}`
   - 切换会话时自动恢复草稿
   - 发送成功后清空草稿

10. **Provider 信息栏**（占位，模型切换功能暂不实现）：
    - 输入框上方显示一行 Provider 信息：
      - 左侧：Provider 图标 + 名称（"Codex"或"Claude Opus 5.5"）
      - 中间：占位文本"剩余上下文"（暂不实现进度条，等协议扩展完成）
      - 右侧：占位按钮"模型"（暂时禁用，提示"模型切换功能开发中"）
    - 样式：浅灰色背景，高 32px，圆角 8px

11. **操作栏**：
    - 输入框下方显示一行操作栏：
      - 左侧：占位按钮"📎 附件""🎤 语音"（暂时隐藏或禁用，提示"即将推出"）
      - 中间：字数统计（实时更新，显示当前字符数）
      - 右侧：发送按钮
    - 发送按钮：
      - 输入为空或只有空白时禁用
      - 会话不能发送时（运行中、等待批准、设备离线）也禁用，并显示原因提示

12. **布局**：
    ```
    ┌─────────────────────────────────────────────────────────┐
    │ [Provider 图标] Codex · GPT-4     剩余上下文    [模型▼]│  ← Provider 信息栏（32px 高）
    ├─────────────────────────────────────────────────────────┤
    │                                                         │
    │  [多行输入框，最少 2 行，最多到视口 40%]                 │
    │                                                         │
    ├─────────────────────────────────────────────────────────┤
    │  [📎][🎤]              字数 125              [发送]  │  ← 操作栏（40px 高）
    └─────────────────────────────────────────────────────────┘
    ```

---

### 第三部分：设置页增加快捷键配置

13. **设置 › 编辑器**（新增一节）：
    - 标题："编辑器与输入"
    - 选项：
      - "发送快捷键"：Segmented Control，选项：
        - "Enter 发送，Shift+Enter 换行"
        - "Ctrl+Enter 发送，Enter 换行"
      - 默认："Enter 发送"
    - 保存到 `localStorage`，Composer 读取这个设置

---

## 已知情况

- `packages/client` 的 `Machine` 和 `Computer` 类型已定义
- 当前设备页使用 Machine 列表，显示"Machine"字样
- 新建会话的项目选择器是简单的下拉列表，没有分组
- Composer 是固定在底部的单行输入框 + 发送按钮
- 草稿保存目前没有实现
- Provider 信息（模型、推理强度、剩余上下文）目前不显示

## 边界

- **自己决定**：
  - 电脑卡片的布局和样式（参考 `packages/ui` 的设计系统）
  - 设备详情页的四个节的顺序和样式
  - Composer 的具体实现方式（用 shadcn/ui 的 Textarea 还是自己写）
  - 输入框自动扩展的实现（CSS `field-sizing: content` 或 JS 动态调整）
  - 占位按钮的样式和提示文案
- **先问用户**：
  - 要改后端代码或协议
  - 要改 `packages/ui` 的共享组件（可以改，但先确认）
  - 电脑名称的命名规则不符合用户期望
- **不做**：
  - 不实现模型切换（等协议扩展完成）
  - 不实现附件上传和语音输入（X1 阶段）
  - 不实现"回到某一轮"或"分支对话"
  - 不改 Timeline 样式（D2.5 阶段）

## 报告

完成后写到 `~/agenthub-archive/d2-frontend.md`：

- 改动的文件列表（按第一、二、三部分分组）
- 电脑命名规则的实现方式（怎么判断同一 `computerId` 下有几个 Machine）
- 设备页的截图（Windows 本机 + 一台 Mac 配对设备，如果有 WSL 也截图）
- 新建会话的项目选择器截图（按电脑分组）
- Composer 的截图（扩展前、扩展后、占位的 Provider 信息栏）
- 快捷键测试：Enter 发送、Shift+Enter 换行、Ctrl+Up 复制、Esc 清空
- 草稿保存测试：输入草稿 → 切换会话 → 回来看到草稿
- TypeScript 类型检查和构建通过
- 提交哈希和推送的远端分支

分支名：`feat/d2-frontend-flatten-composer`，推送到 `origin`，不合并到 `main`。

**注意**：这一轮不接入模型切换功能，Provider 信息栏的"模型"按钮是占位的。等 `feat/d2-model-switching` 合并后，再做 D2.1b 接入模型切换。

# 任务：D2.1 前端改进 — 项目选择器、会话列表、路径截断、按钮 Tooltip

在 Windows 上运行。接着在 `feat/d2-frontend-flatten-composer` 上做（当前是 `876834c`）。根据代码审查反馈，优化 5 个 UI/UX 细节。提交推送到同一分支，不新建分支。

开始前确认这份文件有 4 个二级标题，最后一节是"报告"。

## 目标

**必须改**：

1. **项目选择器分组头优化**（优先级中）：
   - 当前：HTML `<optgroup>` 标签（原生，可能不够显眼）
   - 改为：更显眼的分组头样式
   - 方案：如果 shadcn/ui Select 支持自定义分组头，用灰色背景 + 加粗文字；如果不支持，保持原状并在报告说明
   - 位置：`apps/web/src/components/conversations/new-conversation-selection.ts` 或相关文件
   - 测试：有多个电脑时，分组头应该清晰可见

2. **会话列表超长显示**（优先级中）：
   - 当前：设备详情页显示"最近的会话 1"，但设计说"最近 10 条"
   - 改为：检查实现代码，当会话 > 10 条时是否有加载更多或分页
   - 方案：如果没有，加一个"查看全部会话"链接或分页控制
   - 位置：`apps/web/src/components/machines/machine-conversations-section.tsx` 附近
   - 测试：创建 10+ 条会话，验证显示效果

3. **新建会话项目路径截断优化**（优先级低）：
   - 当前：项目路径显示被截断（"C:\Users\Administrator\AppData\Local\Temp\codetether-d2-frontend-ev..."）
   - 改为：用 HTML `title` 属性显示完整路径
   - 方案：给项目路径的 DOM 元素加 `title={fullPath}`
   - 位置：`apps/web/src/components/conversations/new-conversation-fields.tsx` 附近
   - 测试：Hover 项目路径时显示完整路径

4. **附件和语音按钮 Tooltip**（优先级低）：
   - 当前：附件和语音按钮是禁用状态（灰色），无提示
   - 改为：添加 Tooltip 说"即将推出"
   - 方案：给按钮外包 shadcn/ui Tooltip 组件，或用原生 `title` 属性
   - 位置：`apps/web/src/components/conversation/composer.tsx` 附近（Paperclip 和 Mic 按钮）
   - 测试：Hover 附件和语音按钮时显示"即将推出"

5. **项目卡片的项目数量显示**（优先级低）：
   - 当前：显示 "1 个项目"（仅文字）
   - 改为：可以考虑加项目图标，但这个是优化而非必须
   - 方案：如果有时间，在数字前加 Folder 或 FolderOpen 图标；否则保持原状
   - 位置：`apps/web/src/components/machines/machine-summary-card.tsx` 附近
   - 测试：设备卡片显示项目数量时是否更直观

## 边界

**自己决定**：
- 如果 shadcn/ui Select 的分组不支持自定义样式，可以保持原状并在报告说明
- 附件和语音按钮的 Tooltip 是用 shadcn/ui 组件还是原生 `title` 属性，自己选

**先问用户**：
- 要改 `packages/ui` 的共享组件或 Select 组件行为（可以改，但先说）

**不做**：
- 不改 Composer 的占位功能（模型切换、剩余上下文进度条等，等 D2.1c）
- 不做其他新功能，仅优化这 5 个 UI 细节

## 报告

追加到 `~/agenthub-archive/d2-frontend.md`，新增"改进完成"一节：

- 1 到 5 每一项改了什么、对应的提交
- shadcn/ui Select 组件是否支持自定义分组样式（如果尝试过）
- 会话列表超长时的实现方案（分页/加载更多）
- 项目路径 Tooltip 的测试截图（Hover 时显示完整路径）
- 附件和语音按钮 Tooltip 的测试截图
- 项目卡片是否添加了图标
- 再次运行 pnpm typecheck / lint / test / build，确认全通过
- 提交哈希和推送状态

---

## 已知情况

- 当前分支：`feat/d2-frontend-flatten-composer` @ `876834c`
- 已通过：typecheck、lint、968 个 Web 测试、构建
- 一个未改动的 Relay 鉴权测试失败（不阻塞）
- 目标：优化这 5 个 UI/UX 细节，然后推送同一分支


# 审核记录：ux/v4-device-first

- 分支：`ux/v4-device-first`，工作区 `D:/Projects/Software/agenthub-ux-v4-device-first`
- 审核范围：`bbcda69..df91601`（9 个功能提交；3562f12 是平台权限测试，不在本轮范围）
- 依据：`docs/ux-redesign/04-requirements.md`（第三版）、`02-dev-handoff.md`、原型；AGENTS.md
- 当前级别：代码完成，审核未通过（见 DEVELOPMENT-PROCESS §2）

## 第 1 轮（D1，2026-10-19）

审核方式：四路只读代码审核（外壳和设备、会话、设置和提醒和组件、全局审计），我抽查核实了全部“必须改”。另跑了一遍质量检查。没有在桌面应用或浏览器里实际操作。

### 质量检查

| 检查 | 结果 | 说明 |
|---|---|---|
| `pnpm typecheck` | 通过 | |
| `pnpm lint` | 通过 | |
| `pnpm build` | 通过 | |
| `pnpm test` | 1 个失败，非本分支引入 | `packages/adapter-claude/test/detection.test.mjs:331` 期望测试用的令牌，实际读到了本机环境里的真实 `ANTHROPIC_AUTH_TOKEN`。去掉 ANTHROPIC_* 环境变量后重跑：12 个测试，0 失败。本分支没有改 adapter-claude。测试应在开始前清掉继承的 ANTHROPIC_* 变量（另开任务） |
| `pnpm format:check` | 659 个文件报错，非本分支引入 | 全是工作区 CRLF 换行。改动过的文件用 `prettier --list-different --end-of-line auto` 检查没有输出 |

日志存放在仓库外 `D:/Projects/Software/agenthub-archive/d1-*.log`（令牌已脱敏，不要提交）。

### 必须改（M）

| 编号 | 位置 | 问题 | 依据 |
|---|---|---|---|
| M1 | `apps/web/src/components/projects/project-detail-page.tsx`；`machines/unpair-machine-dialog.tsx:103-126,148-156` | “从这台设备移除项目”的入口没了。`project-locations-section.tsx` 和 `remove-project-location-dialog.tsx` 已无人引用。项目同时有本机和配对设备上的文件夹、本机那边有会话时：解除配对被文件夹挡住，弹窗只有“知道了”；整个项目又因为有会话（含已归档）不能删。这台配对设备就永远无法解除配对 | AGENTS.md 解除配对需先明确移除位置；03 §6 不变量 |
| M2 | `apps/web/src/components/conversations/conversations-page.tsx`（1045 行）、`project-conversations-route.tsx` | 路由 `/projects/$projectId/conversations` 已指向 `ProjectDetailRoute`（`router.tsx:115-120`），这个页面没有地方渲染，但本分支还改了它 +72/−17。修复会落到死代码上 | 代码一致性 |
| M3 | `apps/web/src/components/app-shell/workspace-sidebar.tsx:122` | 设备树展开状态只在 `useState`，刷新后丢失 | G1“展开状态保存在本机” |
| M4 | `apps/web/src/components/app-shell/workspace-shortcuts.ts:33-36` | 没有 Ctrl B（Mac 上 ⌘B）收起侧栏 | G2 |
| M5 | `apps/web/src/components/app-shell/workspace-sidebar.tsx:346-351` | 侧栏“+”自己写了一套条件，没用 `machineCanAddProject`（`device-project-model.ts:14`），漏了 AI 工具能否运行的检查，和设备页、设备详情页不一致 | 只显示真实能力 |

### 建议改（S）

会话：
- S1 发送后键盘焦点丢失：`composer.tsx:131-135` 提交中给编辑器外层加了 `hidden`，焦点落到 body，结束后也不回来（`conversation-workspace.tsx:111-131` 只跟 `archivedAt`）。基线是只读不隐藏。读屏和键盘用户每句都要重新 Tab 过去。可访问性退步，修复时按“必须改”对待。
- S2 创建会话手动重试会重复：`new-conversation-actions.ts:80-81` 每次新 actionId。照 `live-conversation-actions.ts:137-139` 的做法：同一选择、上次失败不是 Host 明确拒绝，就复用 actionId（基线就有）。
- S3 界面还有“智能体”“推理后端”：`pending-action-dock.tsx:122`、`live-conversation-actions.ts:387,392`、`conversation-gate-presentation.ts:227`（没走 181 行的替换）、`conversation-controls.ts:269,345`。改源头字符串为“AI 工具”。
- S4 新建会话的项目列表没有“最近使用”在前：`new-conversation-selection.ts:58-60`。以 04 C1 为准，用已加载的 `lastActivityAt` 加一组“最近使用”。
- S5 状态和 AI 工具筛选在前端对最多 100 条做：`project-workspace-model.ts:68-80`、`conversation-list-query.ts:38-42`。把 `status`、`provider` 传给 `listProjectConversations` 并放进查询键。
- S6 批准放在输入框上方的待处理栏，不是时间线里的卡片（W6、原型 approveCard）：`conversation-timeline.tsx:270`、`conversation-workspace.tsx:159-167`。门控正确，接受这处偏离，记录在这里；以后改原型时同步。

外壳、设备和项目：
- S7 项目卡片指标只在悬停时加载：`machine-projects-section.tsx:108-122`。
- S8 添加项目的竞态抛英文 Error、提示不对：`add-project-dialog.tsx:168-170`。
- S9 旧词“此电脑 / 位置 / 提供商”：`machine-actions.ts:446`、`project-actions.ts:341`、`previous-conversations-step.tsx:555,810-819`。
- S10 原生 checkbox，应改用 packages/ui 的组件：`previous-conversations-step.tsx:640-655`。
- S11 魔法数字和断点散落：`use-workspace-sidebar-width.ts:16,83`、`top-bar.tsx:248`、`machine-detail-page.tsx:225`、`startup-gate.tsx:75`。收到 tokens 或一个常量文件。
- S12 Host 没就绪时“解除配对”按钮可点：`machine-detail-page.tsx:404`。
- S13（待核实）`/devices` 对每台设备各调一次 getMachine：`machines-page.tsx:47-52`。

全局：
- S14 v4 之前批准的手机或平板，访问授权仍每 60 秒续期，桌面端没地方查看或撤销：`main.tsx:117`、`local-supervisor-presence.tsx:91-124`（`/hosts` 已重定向）。B1 之前在 设置 › 账号 加只读的“已允许访问的手机和平板”列表，不加开关。B1 会接管这块。
- S15 英文文案：`tool-presentation.ts:210,216,223,230,241`（失败工具行标题）、`provider-presentation.ts:403,408,426`（“Provider …”）、`message-markdown.tsx:88`（'Agent 代码块'）。
- S16 输入框演示分支没删：`composer.tsx:172` 的 '发送消息（演示）'，`controller` 改为必填。
- S17 草稿只在内存里（W4 要求保存在本机）：`composer.tsx:60`。草稿是提示词，先只存会话级内存加 `sessionStorage`，不进 `localStorage`，并在 02 记一笔。
- S18（待核实）Node 文档链接在桌面应用里可能打不开：`node-setup-instructions.tsx:63-70`，照 `provider-guidance-link.tsx` 走原生打开。
- S19 死代码约 2000 多行：`components/hosts/*`、`runtime/account/remote-conversation-read-model.ts`、`conversation/conversation-rail*`、`conversation/demo-conversation-adapter.ts`、`mocks/*`、`conversations/{project-conversations-route,conversation-page-states,project-summary,new-conversation-presentation}`、`runtime/host/conversation-list-view-state.ts`、`projects/{projects-page,project-locations-section,add-project-location-dialog}`、`inbox/inbox-filters.tsx`、`app-shell/route-placeholder.tsx`。删掉，相关测试一起删或改。`remove-project-location-dialog` 给 M1 复用。
- S20 账号页提到未实现功能，没链到“后续规划”：`account-settings.tsx:89-92`（O8）。
- S21 本次变大的文件要拆：`previous-conversations-step.tsx` 859、`workspace-sidebar.tsx` 745、`conversation-organization-controls.tsx` 714、`add-project-dialog.tsx` 555。`onboarding-page.tsx` 1283 行在改 UX-V4-001 时顺手拆。
- S22 风险路径的测试是对源码做正则：`new-conversation-dialog.test.mjs:23-91` 等。补渲染层测试：双击只发一次、409 保留草稿不重发、发送后焦点。

首次设置（来自 `docs/UX-V4-REVIEW-NOTES.md`，用户实际使用时发现）：
- S23 UX-V4-001：把“AI 服务尚未验证”说成“工具未就绪”。安装、运行、服务三项分开显示，主按钮“继续设置”。只改 `onboarding-page.tsx` 和 `onboarding-model.ts`，验收清单见该文件。

### 核实后排除

- `use-conversation-inspector-style.ts` 用 `adoptedStyleSheets`：macOS 最低 13.5（`tauri.macos.conf.json:8`），系统 WebKit 16.6 已支持。
- 未发现：假开关、“即将上线”类文案、运行时演示数据、新增网络调用、`style=`、`!important`、令牌外的颜色、Zustand。通知内容已不含会话标题。

### 设置、提醒和组件

这一路审核两次遇到 API 524，按 Retry-After 120 秒等待后续跑（02:50:27、02:55:01 UTC，第 2 次续跑完成）。`product/*` 内部、`dialog/input/select/textarea` 的改动、`workspace-responsive.css`、通知去重逻辑没有审到，第 2 轮补。

必须改：

| 编号 | 位置 | 问题 | 依据 |
|---|---|---|---|
| M6 | `packages/ui/src/styles/globals.css:23`（浅色 `--ct-text-3: #8c877f`）、`:68`（深色 `#7f7b74`） | 次要文字对比度不够。我按 WCAG 公式算过：浅色在背景上 3.42，在 inset 上 3.19；深色在 surface 上 3.77。小字需要 4.5。影响待处理的时间和上下文行、各页脚注、空闲和离线状态标签 | WCAG AA 1.4.3 |
| M7 | `apps/web/src/components/inbox/inbox-page.tsx:228`、`inbox-item.tsx:154` | 用 `text-warning`（#c98512）当文字色，在 `bg-warning-muted` 上 2.74。已有 `text-warning-text`（5.39） | WCAG AA 1.4.3 |
| M8 | `apps/web/src/components/inbox/inbox-item.tsx:192-243` | 等待批准的项在这台设备不能批准时只剩“打开会话”，不说原因；已完成的项没有“知道了”。Host 的 `resolveAttention` 拒绝 approval 类（`host-service.ts:3220-3225`，422），所以批准类不能加“知道了”，要写原因 | N2 |

建议改：
- S24 通知正文缺设备名：`desktop-notification-model.ts:84`、`main.tsx:87-92`。N4/N5 要求“类型、设备 · 项目、一句说明”。
- S25 “始终开启”配灰色离线点：`background-settings.tsx:18`；`desktop-notification-settings.tsx:35` 的 `backgroundRuntimeAvailable` 没用到。
- S26 `<main>` 嵌套：`roadmap-page.tsx:69` 在 `main-content.tsx:9` 的 `<main>` 里又放了一个。
- S27 `Notice` 默认 `role="status"`（`notice.tsx:39`），静态说明每次挂载都被读屏播报。默认不加，调用方需要时再加。
- S28 `command-list.tsx:116,166`：listbox 里放了 `<h3>` 和 `role="status"`，`aria-expanded` 恒为 true。
- S29 通知开关没有 `aria-describedby`：`desktop-notification-settings.tsx:80`。
- S30 `attention-row.tsx:31,58` 窄屏时两个按钮挤掉标题。
- S31 设置页写死断点：`settings-page.tsx:36,61`、`appearance-settings.tsx:38`（并入 S11）。
- S32 桌面窗口底色还是深蓝 `#07111f`（`apps/desktop/src-tauri/tauri.conf.json:26`），默认已是浅色，启动会闪一下。
- S33 待处理页在 Host 已连接但查询失败时仍说“本地服务暂时不可用”：`inbox-page-states.tsx:35-37`。
- S34 “查看结果”依赖 `resolveAttention` 成功才跳转：`inbox-actions.ts:42`。失败也要能打开会话。
- S35 重新发送登录码没有本地冷却：`sign-in-page.tsx:211`。
- S36 设置相关测试多是对源码做正则：`settings-v4.test.mjs:157-221`（并入 S22）。
- 待核实：`statuses.ts` 把所有 `waiting` 都叫“等待批准”，如果 waiting 还有别的含义就违反 N1/N7；Claude 徽标白字在 `#d97757` 上约 2.9；`index.html` 的主题初始化脚本在发布版 CSP 下能否执行。

核实后排除：
- 手机首页按设备分组（C8、E11）没做：这两项是平板和手机的阶段（T1/M1），电脑端 N1 是平铺带筛选，现在的做法对。
- 已核实没问题：通知开关真实保存、失败回滚；主题只有一处控制、默认浅色；登录 `shouldCreateUser: false`、报错中文、不泄露令牌；待处理数据来自 `listAttention`，批准按设备和 AI 工具能力门控；后续规划页没有控件；`apps/web` 用到的 Button、Badge 变体都还在。

### 结论

不能合并。共 8 个必须改（M1–M8），36 个建议改。修完 M1–M8、S1，以及提示词列出的建议改后进第 2 轮审核。修复提示词：`ux-v4-device-first-fix-prompt.md`。

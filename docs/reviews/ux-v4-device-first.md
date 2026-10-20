# 审核记录：ux/v4-device-first

- 分支：`ux/v4-device-first`，工作区 `D:/Projects/Software/agenthub-ux-v4-device-first`
- 审核范围：`bbcda69..df91601`（9 个功能提交；3562f12 是平台权限测试，不在本轮范围）
- 依据：`docs/ux-redesign/04-requirements.md`（第三版）、`02-dev-handoff.md`、原型；AGENTS.md
- 当前级别：第 4 轮修复（2d9ad41）审核通过，已装到 Windows；安装版验收 8 项通过、1 项不通过、6 项未测，待 R5 修复和补测（见 DEVELOPMENT-PROCESS §2）

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

## 第 2 轮（2026-10-20，审 df91601..33f5b5d，13 个提交）

审核方式：两路只读代码审核（逐条核实修复；删除、拆分和第 1 轮没审到的部分），我抽查核实了下面每一条“要修”。没有在桌面应用、Mac 或手机上实际操作。

### 质量检查（我重跑，去掉 ANTHROPIC_* 环境变量）

typecheck、lint、test、build 退出码都是 0。测试 2255 项：2241 通过，0 失败。改动的 203 个文件 Prettier 检查通过（第一次一次传入 203 个文件，Windows 报命令行太长，分批重跑为 0）。日志在 `D:/Projects/Software/agenthub-archive/d1r2-*.log`。

### 第 1 轮问题的状态

| 编号 | 状态 | 说明 |
|---|---|---|
| M1 | 已修 | 设备详情和解除配对弹窗都能“从这台设备移除”，按这台设备上的会话（含已归档）门控，移除后重新预检。测试是改 props 重渲染，不是点完整流程 |
| M2、S19 | 已修 | 删掉的模块在 df91601 只被同一提交改过的 barrel 引用；路由和 `main.tsx` 不引用 |
| M3 | 已修 | `ct-workspace-tree-expansion` 只存 ID，严格校验，坏数据当空 |
| M4 | 已修 | Ctrl B / ⌘B，组字中和输入框里不触发 |
| M5 | 部分 | 已用 `machineCanAddProject`；设备在线但不能添加时“+”直接消失，不说原因（`workspace-device-section.tsx:89-97`） |
| M6、M7 | 已修 | 新值浅色 `#68635c`、深色 `#96928b`，`token-contrast.test.mjs` 读真实 CSS |
| M8 | 已修 | 不能批准时写原因；已完成有“知道了”；批准类没有 |
| S1 | 部分 | 提交中改为只读；但 AI 工具运行中（`running`/`waiting`）编辑器仍隐藏（`composer.tsx:82`），整个运行期间焦点在 body |
| S2、S14、S17、S24 | 已修 | 通知正文“设备 · 项目”，不含标题 |
| S6 | 接受偏离 | |
| S18 | 未做，合理 | 原生打开命令只接受 Codex、Claude Code 两个固定入口，要改原生命令，超出本轮授权。另开任务 |
| 状态标签 | 核实无误 | Host 只在请求批准时设 `waiting`（`approval-registry.ts:185`），显示“等待批准”是对的 |

关于新建会话：现在电脑上新建不带首条消息、不选模型，这符合 04 C1 和 W13。第 1 轮提示词第 10 步写的“缺首条输入或模型时不能创建”是审核方写错了，以 C1 为准。编码智能体报告里写“按用户确认”，依据应写 C1。

### 要修（第 3 轮）

| 编号 | 位置 | 问题 |
|---|---|---|
| R2-1 | `composer.tsx:82` | S1 未完：运行中隐藏编辑器，焦点丢失。改成运行中也只读不隐藏，补 submitting → running → idle 的测试。可访问性退步，必须修 |
| R2-2 | `globals.css:40`；`conversation-files-surface.tsx:54`、`inspector-panel.tsx:215`、`conversation-timeline.tsx:134` | `text-success` 当文字色，浅色 3.47（我算的），和 M7 同类。改 `text-success-text`，并把 success 加进对比度测试 |
| R2-3 | `machine-actions.ts:384,398,400,404,418,444` | 机械替换出的病句：“这台电脑操作正在处理中”“不支持这台电脑操作”“请检查Node显示的六码” |
| R2-4 | `workspace-device-section.tsx:89-97` | M5 未完：补不能添加的原因 |
| R2-5 | `workspace-responsive.css:91-105` | S30 没生效：旧规则不在 CSS layer 里，覆盖了新的 Tailwind 类，窄屏按钮成了第三列。测试只查类名 |
| R2-6 | `workspace-responsive.css:68-81` | 宽度 ≤ 600px 时添加项目、新建会话弹层一半在屏幕外：只重置了 `transform`，Tailwind v4 的 `translate`、`scale` 是独立属性。桌面应用最小宽 1100 不受影响 |
| R2-7 | `machine-projects-section.tsx:131-134` | S7 改成了挂载就加载每张卡片的指标，应是可见时加载 |
| R2-8 | `attention-notification-metadata.ts:30-34` | 每条通知都重新请求最多 100 条会话，先读缓存 |
| R2-9 | `apps/web/test/user-visible-copy.test.mjs:8,47` | 文案扫描没扫 `packages/ui/src` |
| R2-10 | `project-location-removal-ui.test.mjs:307-335` | M1 补一条点击到底的测试：移除 → 确认 → Host 返回更新 → 弹窗变成可解除配对 |
| R2-11 | `new-conversation-provider-selection.ts:91-107` | 只剩测试在用的 `defaultProviderControls`、`defaultProviderModel` 删掉 |

### 记下不修（本次合并后再看）

- N4“已经在屏幕上”的判断：待处理页一律不通知（即使被筛选隐藏），项目页和设备页一律通知。
- `ProjectCard`、`SessionItem`、`DeviceSection` 写死标题级别；复制按钮挂载后 `role` 从 status 变 alert。
- `apps/web/src` 还有 24 个文件超过 400 行（最大 `control-plane-client.ts` 1470），这次没要求拆。
- 树展开状态里过期的 ID 不清理；Mac 上 Ctrl B 也生效。
- S18 Node 文档原生打开（另开任务）。
- adapter-claude 测试不隔离 ANTHROPIC_* 环境变量（另开任务）。

### 结论

还不能合并，但离验收很近。没有新的必须改；R2-1、R2-2 属于可访问性必须修，其余是小修。修完 R2-1 到 R2-11 后我做第 3 轮（只看这些改动），通过后进入你的验收。修复提示词：`ux-v4-device-first-fix-prompt-r2.md`。

## 第 3 轮（2026-10-20，审 33f5b5d..b1e1ccf，7 个提交，38 个文件）

审核方式：我直接读了全部源码改动。没有在桌面应用、Mac 或手机上实际操作。

质量检查（我重跑，去掉 ANTHROPIC_* 环境变量）：typecheck、lint、test、build、改动文件 Prettier 退出码都是 0；测试 2280 项，2266 通过，0 失败，14 项跳过。日志在 `D:/Projects/Software/agenthub-archive/d1r3-*.log`。边界：`apps/host`、`apps/desktop`、`apps/node`、`packages/protocol`、`packages/client`、Control Plane、Relay 都没改。

| 编号 | 结果 |
|---|---|
| R2-1 | 已修。编辑器只在已归档、不可用时隐藏；运行中和等待批准时保持挂载、只读（`composer.tsx:82,227`） |
| R2-2 | 已修。两棵源码树里不再有 `text-success/warning/danger` 作文字色 |
| R2-3、R2-9 | 已修。剩一处旧词“节点地址”（`update-machine-address-dialog.tsx:130`），不是病句，记下不修 |
| R2-4 | 已修。侧栏和设备页共用 `machineCannotAddProjectReason` |
| R2-5 | 已修。删掉旧 CSS 规则，断点改用 `phone` 变体（`globals.css:12`，≤ 37.5rem） |
| R2-6 | 已修。`translate: none`、`scale: none` 分开写在 `@supports` 里，防止生产压缩把它们并进 `transform` |
| R2-7 | 已修。卡片进入视口后才加载指标，清理时断开观察 |
| R2-8 | 已修。先读缓存 |
| R2-10、R2-11 | 已修 |

记下不修：项目卡片外多了一层 `<div>`，同一行卡片高度可能不齐，验收时看一下。

结论：**审核通过**。当前级别：审核通过，等待你的验收。

## 验收（你来做）

### 在已安装的版本上验收

按你的要求（2026-10-20），Windows 上已安装的版本已经换成这个分支：

- 来源：b1e1ccf。还没合并、没打标签，版本号仍显示 0.1.0-alpha.0。这和“安装版来自 main 的标签”不一致，是这次的例外。
- 安装包 SHA256 以 CBD7BC93B7A40C61 开头，未签名。
- 我在运行中核对过：Host 报告 `hostVersion` 为 `git-b1e1ccf123c7`，协议版本 1。只有一个 Desktop 和一个 Host，都在安装目录下运行，4317 端口由这个 Host 监听。
- 卸载时保留了原数据，包括数据库、配对凭据和 WebView 数据，新版本接着用。所以首次设置可能不会再出现，以前的项目和配对设备都还在。
- 旧版本和数据的备份在 `D:/Projects/Software/agenthub-archive/windows-install-backup-20261020-pre-v4`，回退步骤见其中的 RESTORE.txt。
- 安装报告：`D:/Projects/Software/agenthub-archive/v4-install-report-20261020.md`。

从开始菜单打开 CodeTether，按下面的清单验收即可。

### Windows 验收清单

| # | 检查 | 依据 | 结果 |
|---|---|---|---|
| 1 | 首次设置：安装、运行、服务三项分开显示，主按钮“继续设置” | UX-V4-001 | |
| 2 | 添加一个项目，能看到并导入以前的 Codex / Claude Code 会话 | P 系列 | |
| 3 | 侧栏：展开收起几个设备和项目，重启应用后保持；Ctrl B 收起和展开 | G1、G2 | |
| 4 | 新建会话：选项目和 AI 工具，不要求首条消息；创建后在会话里发第一句 | C1 | |
| 5 | 发送后不用鼠标，直接继续打字（AI 工具运行中输入框只读但焦点还在） | S1、R2-1 | |
| 6 | 本机 Codex 会话：停止、批准“允许一次 / 拒绝”、变更面板能用 | W 系列 | |
| 7 | Claude Code 会话：没有停止、批准按钮，看到说明 | 只显示真实能力 | |
| 8 | 待处理页：三类都在，失败和已完成有“知道了”，不能批准的写原因 | N1、N2、M8 | |
| 9 | 系统通知：内容是“设备 · 项目”加一句说明，没有会话标题；点开进入会话 | N4、R4 | |
| 10 | 设置：浅色、深色、跟随系统切换，重启后保持，启动不闪深蓝 | O3、S32 | |
| 11 | 次要文字（时间、脚注）看得清 | M6 | |
| 12 | 后续规划页只列没做的功能，其他页面没有假开关 | O8 | |
| 13 | 草稿：输入一半切到别的会话再回来，草稿还在；关掉应用后不保留 | S17 | |
| 14 | 界面没有英文句子和“智能体”“此电脑” | 中文界面 | |
| 15 | 项目卡片高度是否整齐 | 第 3 轮记录 | |

有配对的 Node 时再加：从这台设备移除项目后能解除配对（M1）。

第 1 项：数据保留后，首次设置可能不再出现。如果设置里能看到 AI 工具状态，就在那里看安装、运行、服务是否分开显示（我没确认设置里有这个入口）。否则之后用空数据目录补测。

### Mac

Mac 上需要拿到这个分支。分支只在本机，没有推送。要在 Mac 上验收，需要你同意把 `ux/v4-device-first` 推送到 GitHub（不是 main）。清单同上，另加：⌘B 收起侧栏、macOS 13.5 上界面正常。

### 验收结果

第一次安装版检查（2026-10-20，智能体在安装窗口上直接检查，见安装报告第 9 节）：

- 通过：
  - 中文界面，侧栏按 设备 › 项目 分组；
  - 浅色和深色切换；
  - 设备页、设置、状态检查、添加设备页、新建会话弹窗（目录不可用时有原因，创建按钮禁用）；
  - Ctrl K 打开搜索，Esc 关闭后焦点回到搜索按钮；
  - 约 1100×700 的窗口里没有遮挡或横向溢出。
- Codex 0.149.1 和 Claude Code 2.1.251 都检测到。AI 服务显示“尚未检查”，这是正确的未知状态。
- 两个旧项目显示无法访问，是因为登记的目录确实不存在，和这次安装无关。
- 不通过：R4-1。Windows 本机添加项目的示例是 `/Users/user/project`。
  - 原因：Host 发出的平台值是 `Windows`，前端 `add-project-fields.tsx:157-163` 只认小写的 `windows` 和 `win32`。测试夹具用的是小写，所以没测出来。
  - 我核实过源码。整个前端只有这一处做了大小写敏感的比较。
- 未测：
  - 侧栏状态重启后保持、Ctrl B；
  - 启动闪色；
  - 新建会话和发送；
  - Codex 停止、批准、变更面板；
  - Claude Code 的说明；
  - 待处理页和系统通知；
  - 草稿；
  - 控制台错误。

R4 之后的结果见下一节。

## 第 4 轮（2026-10-20，审 b1e1ccf..2d9ad41，1 个提交，4 个文件）

修 R4-1。我看过提交：

- 新增 `machinePlatformFamily`，不区分大小写，写法和 `machinePlatformLabel` 一致。
- 本机示例：Windows `C:\Projects\我的项目`，macOS `/Users/user/project`，其他和远程设备 `/home/user/project`。
- 测试夹具改成 Host 实际发出的 `Windows`，加了归类函数的单元测试。
- 检查全部为 0：2307 项测试，2293 通过，0 失败，14 项原有跳过。

结论：审核通过。新安装包 SHA256 以 34F4A788CD6F51DB 开头，运行中 `hostVersion` 为 `git-2d9ad41f7e38`。报告：`D:/Projects/Software/agenthub-archive/v4-acceptance-report-r4.md`。

### 安装版验收（第 2 次，智能体在安装窗口上检查）

- R4-1：通过。
- 通过 8 项：3、4、5、7、11、12、13、15。
- 不通过 1 项：14。Claude Code 的搜索步骤显示英文 `Search workspace`。
  - 来源是 `packages/adapter-claude/src/normalizer.ts` 的固定摘要。同一个函数里还有 `Read file`、`Edit file`、`Run unavailable tool`、`Run tool`。
  - Codex 适配器批准摘要的兜底文字也是英文：`Codex requested command approval`、`Codex requested file or permission access`（`packages/adapter-codex/src/normalizer.ts:428`、`436`）。
- 未测 6 项：
  - 1、2：没有重置首次设置，也没有导入旧会话。这是 R4 的限制。
  - 6：Codex 第一个回合失败，错误码 `provider_error`，测试文件夹仍是空的，停止、批准、变更都没法测。本机 PATH 上的 Codex 现在是 0.162.1，适配器验证过的是 0.149.1，第一次安装检查时看到的也是 0.149.1。这是线索，还没证实是原因。
  - 8：没有等待批准的项目，原因同 6。
  - 9：90 秒内没有收到系统通知。没有核对 Windows 的通知设置，Desktop 的错误输出也没有记录。
  - 10：最早约 1.4 秒没有截到。

下一步：按 `ux-v4-device-first-fix-prompt-r5.md` 修中文摘要、换图标、查 Codex 失败原因，重装一次，然后补测 1、2、6、8、9、10、14。补测通过后合并进 main、打标签，每一步再问你。

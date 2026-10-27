# 审核记录：ux/v4-device-first

- 分支：`ux/v4-device-first`，工作区 `D:/Projects/Software/agenthub-ux-v4-device-first`
- 审核范围：`bbcda69..df91601`（9 个功能提交；3562f12 是平台权限测试，不在本轮范围）
- 依据：`docs/ux-redesign/04-requirements.md`（第三版）、`02-dev-handoff.md`、原型；AGENTS.md
- 当前级别：第 11 轮完成（835489d 已装机），Windows 安装版验收 15 项全部通过，审核通过，可以合并（见 DEVELOPMENT-PROCESS §2）

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

## 第 5 轮（2026-10-21，审 2d9ad41..9de2279，3 个提交）

报告：`D:/Projects/Software/agenthub-archive/v4-acceptance-report-r5.md`。

### 代码

- 57a30ec `fix(adapters): use Chinese tool summaries`：通过。
  - Claude Code 摘要按 R5 表改成中文，失败摘要是“<摘要>失败”，有路径时仍按字节上限截断，加了 2000 字中文长路径用例。
  - Codex 批准兜底改成“Codex 请求运行命令”“Codex 请求访问文件或权限”。
  - 兜底会话标题改成“Claude 会话”“Codex 会话”。小问题：Codex 的兜底标题用 ` — ` 连接时间，Claude 用 ` · `，R6 统一成 ` · `。
- c350190：风筝图标，已被否决，保留为历史提交，不再作为验收依据。
- 9de2279 `feat(desktop): replace app icon with CodeTether stacked cards mark`：通过。
  - `icons/source/*.svg` 和 `docs/ux-redesign/icon/final/` 逐字节一致。
  - ICO 6 层，第一层 32 像素（窗口和托盘默认取第一层），ICNS 用 PNG 类型。
- 检查全部为 0：2314 项测试，2300 通过，0 失败，14 项原有跳过。
- 安装包 SHA256 以 51A5EC704F84FD3C 开头，运行中 `hostVersion` 为 `git-9de227968aa7`。

### 安装版验收（第 3 次）

- 通过 10 项：1、2、3、4、7、10、11、12、13、15。
  - 1 用空数据目录 `CODETETHER_DATA_DIR` 测，之后不带变量启动，原数据都在。
  - 10 由采样脚本自己启动应用，首帧没有深蓝。
- 不通过：无。
- 未测 5 项：
  - 5：成功的那次发送用了按钮，随后最小化；用键盘的那次没有产生回合。
  - 6、8：选定的 Codex 0.149.1 回合仍是 `provider_error`，没有批准和文件变更。PATH 上的 0.162.1 直接运行成功，协议关键结构一致。公开接口没有原始 `codexErrorInfo`，原因还没查明。
  - 9：应用通知 Enabled=1，系统通知开，勿扰关，90 秒内没有通知，Desktop 错误输出里没有 `notification delivery failed`。开始菜单快捷方式的 AppID 是 `com.codetether.desktop`，但 `Get-StartApps` 不列出 CodeTether。
  - 14：新产生的摘要是中文。旧版本留下的英文历史没有迁移，验收边界没定，所以没判。
- 图标：双卡片只确认了标题栏。任务栏、托盘、开始菜单、Explorer 没有取得新截图。风筝版时任务栏还显示旧蓝 C，像是图标缓存。

### 我对未测项的判断

- Codex：现在所有失败路径最后都落到 `provider_error`，看不出是哪一类。下一步先让适配器把原始错误类型名（只有类型名和 HTTP 状态码，不含文字）写进 Host 错误输出，复现一次再决定。如果是旧版 0.149.1 本身的问题，修法是请用户同意后在设置里改选 0.162.1。
- 通知：Desktop 只在失败时打日志，成功调用 Windows 也没有记录，所以分不清是前端没调用，还是 Windows 收到后没显示。`Get-StartApps` 不列出应用时，Windows 可能会丢掉这个 AppID 的通知。下一步先用同一个 AppID 发一条系统测试通知，再加成功日志复测。
- 14：边界定为“当前版本产生的固定文字”。旧版本留下的历史、AI 工具原文、工具名、命令、路径和“故障代码”的值不算，列进报告。
- 5：用 Claude Code 回合测，窗口保持在前台，用 Enter 发送。

下一步：按 `ux-v4-device-first-fix-prompt-r6.md` 加诊断输出、统一兜底标题、重装一次，然后补测 5、6、8、9、14 和四处图标。补测通过后合并进 main、打标签，每一步再问你。

## 第 6 轮（2026-10-21，审 9de2279..4f30416，2 个提交）

报告：`D:/Projects/Software/agenthub-archive/v4-acceptance-report-r6.md`。

### 代码

- a2f78db `fix(adapter-codex): log Codex failure variant`：通过。
  - 失败时 stderr 只写类型名、HTTP 状态码和规范原因，类型名有字符和长度限制，写日志出错不影响失败结果。
  - Codex 兜底标题改成 ` · `。
  - 分类结果没改，符合 R6 要求。
- 4f30416 `fix(desktop): log attention notification delivery`：通过。
  - Windows 接受通知后记录类型和 AppID，去重跳过时记录原因，测试确认不含标题、正文和各类标识。
  - 另外两个 Rust 文件各加一行测试用导入，修 Windows 下测试编译错误，用户已同意。
- 检查全部为 0：2317 项测试，2303 通过，0 失败，14 项原有跳过。Rust 69 项通过。
- 安装包 SHA256 以 56A1841DDD8BCF93 开头，运行中 `hostVersion` 为 `git-4f30416e4307`。

### 安装版验收（第 4 次）

- 新通过 2 项：
  - 5：第三次尝试用真实 Enter 发送，运行中焦点留在同一输入框且只读，结束后直接用键盘输入成功。前两次没进入输入框，没产生回合，如实记录。
  - 14：按 R6 定的边界检查了设备、项目、待处理、设置 5 页、会话、后续规划和首次设置，产品固定文字都是中文，没有禁用词。
- 累计 12 项通过，0 项不通过，3 项未测（6、8、9）。
- 6：复现得到 `variant=other httpStatus=none reason=provider_error`。`other` 是 Codex 协议里自己的兜底类别，看不出原因。用户已决定改用最新版 Codex。
- 8：等待批准一类还没有出现，要等 Codex 能跑。
- 9：两条 Windows 对照通知都是 `DisabledForApplication`，见下。
- 图标：
  - 标题栏、Explorer 是新版双卡片；
  - 任务栏还是风筝，是图标缓存；
  - 托盘截图后窗口位置变了，没有保存；
  - 开始菜单搜不到。

### 我补查的通知情况（只读，没改任何设置）

- 报告说 Start 菜单快捷方式存在，这只在重装那一刻成立。现在 `%APPDATA%\Microsoft\Windows\Start Menu\Programs\CodeTether.lnk` 不存在，全局开始菜单里也没有，只剩桌面快捷方式。什么时候、被什么删的不知道。开始菜单搜不到 CodeTether、`Get-StartApps` 不列出它，都和这一点一致。
- PowerShell 不是有效对照：它的通知设置 `Enabled=0`，本来就被关了。Chrome、QQ、Claude、Codex 等应用查到的都是 `Enabled`，所以 Windows 的通知整体是好的，问题只在 CodeTether 这个应用标识。
- CodeTether 的通知设置 `Enabled=1`，但系统仍返回 `DisabledForApplication`。最后一次收到它的通知是 2026-08-29。
- 本机账号是内置 Administrator，CodeTether、Explorer 都以提升权限运行。这一点先记下，还没证据说明和通知有关。

下一步：按 `ux-v4-device-first-fix-prompt-r7.md` 改选 Codex 0.162.1 补测 6、8，恢复开始菜单快捷方式后查通知并补测 9，补齐托盘和开始菜单图标。

## 第 7 轮（2026-10-21，补测，HEAD 仍是 4f30416，没有新提交）

报告：`D:/Projects/Software/agenthub-archive/v4-acceptance-report-r7.md`。用 R6 原安装包重装一次，数据前后一致，`hostVersion` 为 `git-4f30416e4307`。

### 安装版验收（第 5 次）

- 新通过 2 项：
  - 6：改选 Codex 0.162.1 后 4 个回合正常。停止后状态是 interrupted，输入框恢复可编辑；批准请求在待处理页出现，拒绝后归零；新文件出现在变更列表，点开能跳到对应位置。
  - 8：等待批准 1、待查看 13、失败 11 同时出现，对本轮的一个已完成项点了“知道了”，以前的项目没动。
- 累计 14 项通过，0 项不通过，1 项未测（9）。
- 图标：托盘是新版双卡片。任务栏没有新截图，开始菜单搜不到。

### 我补查的两件事（只读）

1. 新增文件没有逐行差异，原因找到了。
   - Codex 对新增文件给的 `diff` 是文件全文，不是统一差异格式。测试文件 27 字节，报告里 `diffLength=27`，正好一致。
   - 前端 `parseUnifiedDiff`（`apps/web/src/runtime/host/conversation-projection.ts:1344`）只认 `+`、`-`、空格开头的行，所以全文一行也认不出来，显示 `+0` 和“未提供可展示的差异内容”。
   - 删除文件很可能一样。修改文件给的是统一差异，不受影响。
   - 第 6 项要求的是“变更面板能用”，我仍算通过，但新增文件显示 +0 是真实缺陷，R8 修。
2. 开始菜单快捷方式“消失”和通知被禁用，原因很可能是安装是在 Codex 桌面应用里执行的。
   - Codex 桌面应用是商店（MSIX）应用，它启动的安装程序写 `%APPDATA%` 时被重定向到了 Codex 自己的目录：`%LOCALAPPDATA%\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Roaming\Microsoft\Windows\Start Menu\Programs\CodeTether.lnk`，时间 09:12:53 UTC，正是 R7 安装的时刻。
   - 智能体在 Codex 里看到的是合并后的视图，所以九次检查都说快捷方式在。真实的开始菜单目录里没有，Windows 也就没有登记这个应用：`Get-StartApps` 为 0，开始菜单搜不到，通知返回 `DisabledForApplication`，Windows 通知列表里没有 CodeTether。
   - NTFS 日志里真实开始菜单目录没有 CodeTether.lnk 的任何记录，而安装目录里的文件有，这和重定向一致。桌面快捷方式在 E 盘，没有被重定向。
   - 同一个目录里还有更早的 `CodeTether-rollback` 和 `com.codetether.v4-preview`，说明以前也有在 Codex 里装的情况。
   - 安装目录 `%LOCALAPPDATA%\CodeTether` 和数据是真实位置，没有受影响。
   - 修法：安装和第一次启动都不能在 Codex 桌面应用里做，由用户双击安装包，或在普通终端里运行。

下一步：按 `ux-v4-device-first-fix-prompt-r8.md` 修新增和删除文件的差异显示，打包后由用户在 Codex 应用外安装，然后补测第 9 项、新增文件差异和开始菜单、任务栏图标。

## 第 8 轮（进行中）

代码审核：`9800ae2 fix(adapter-codex): show added and deleted file content as diffs`，通过。

- 只在 adapter-codex 归一化时转换：新增和删除、并且不含统一差异标记时，补 `@@` 头和逐行 `+`/`-`，没有末尾换行时补 `\ No newline at end of file`。修改、改名、未知类型原样保留。
- 去重仍用 Codex 原始内容，转换后超过 4 MiB 时只丢差异内容，路径和类型保留。
- 测试覆盖多行、单行、无末尾换行、中文、已是统一差异、上限边界，前端加了一条解析用例。
- 小问题，不阻塞：新文件内容里如果有以 `--- `、`+++ ` 或 `@@ -n +n @@` 开头的行，会被当成已有统一差异而不转换，显示回到 `+0`。CRLF 文件的行内容会带 `\r`。等实测后再定要不要处理。

打包：Desktop 打包被工具策略拒绝，由用户在 Codex 应用外的普通 PowerShell 里运行 `.tmp/v4-r8-desktop-build.sh`。脚本我看过：只检查三项环境变量是否存在，不打印值，要求工作树干净，日志用 sed 脱敏，不覆盖已有日志。R6 安装包已归档到 `agenthub-archive/installers/4f30416/`，SHA256 与 R6 一致。

安装后核对（我只读复核）：

- 用户在 Codex 应用外运行安装程序（Claude Code 的 `!` 命令）。真实开始菜单有 `CodeTether.lnk`（02:25），`Get-StartApps` 列出 `com.codetether.desktop`，运行版本 `git-9800ae2f8b7d`。R7 的开始菜单问题确认由 Codex 应用的重定向造成，已解决。
- Desktop 文件哈希不同的原因已查清：两份文件大小相同，只差 3 个字节，在 `__TAURI_BUNDLE_TYPE_VAR_` 标记处，构建目录里是 `UNK`，安装版里是 `NSS`。这是 Tauri 打包时写进安装包副本的安装类型标记，属于正常现象，不是缺陷。
- 通知状态：从普通 PowerShell 读 `CreateToastNotifier(...).Setting` 得到空值，这个查询方法不可靠，不再作为判断依据。注册表 `Notifications\Settings\com.codetether.desktop` 是 `Enabled=1`，没有全局关闭项。第 9 项改为直接实测。

实测结果（R8 报告第 16 至 21 节，我核对过）：

- 新增和删除差异通过：Codex 新建 3 行文件显示 `+3` 和 3 行新增，删除后显示 `-3` 和 3 行删除。截图 `30-r8-diff-add.png`、`31-r8-diff-delete.png`。
- 图标通过：任务栏和开始菜单搜索结果都是新版紫色双卡片（`icons-taskbar-01.png`、`icons-start-menu-visual-08.png`），没有清图标缓存。至此标题栏、托盘、Explorer、任务栏、开始菜单五处都已确认。
- 第 9 项大部分通过：日志有 `notification shown type=completed_review` 和 `type=failed`，没有 skipped。原生通知历史里有 2 条 CodeTether 通知，文案是“本地电脑 · v4-accept-project”加一句说明，没有会话标题。R7 之前通知发不出来，原因确认是开始菜单没登记。
- 第 9 项还差一步：Claude Code 那个回合因 gateway 返回 `provider_service_unavailable` 失败，弹出的是失败通知。UIAutomation 没找到唯一的通知卡片，没有点击，点开进入会话没有验证。gateway 故障不归这个分支，不改代码。
- 原始日志在用户退出后脱敏并删除，进程和 4317 端口都已清零，R5、R7 测试文件保留。

下一步：按 `ux-v4-device-first-fix-prompt-r9.md` 用 1 个 Codex 回合触发完成通知，点开验证路由。不改代码，不重装。

## 第 9 轮

补测，不改代码。报告见 `v4-acceptance-report-r8.md` 第 22 节。

- Codex 只读回合 01:33 发送，01:35 完成。生成了 1 条 `completed_review` 提醒，通知历史多了 1 条“CodeTether · 工作已完成 / 本地电脑 · v4-accept-project / AI 工具已完成本轮工作”，没有会话标题。通知文案这一半通过。
- 智能体用 Win+N 没找到唯一的通知卡片，没有点。用户在 01:45 左右从通知中心点了通知。之后 23 次采样，窗口都还是最小化，路由仍是 `/c/conv_…`，没有 `turn` 参数和 `notification-N`。第 9 项未通过。
- 我读了代码：Windows 下点击只靠进程内 `ToastNotification.Activated` 回调（`attention_notifications.rs:336`）。通知 XML 没有 `launch`，快捷方式没有 `ToastActivatorCLSID`，没有 COM 激活器。点击发生在横幅超时 10 分钟后，点的是通知中心里的那一条。微软文档说这种情况下不保证回调进程内事件，`:354` 注释里“超时后仍可点击”的假设没有实测过。
- 现在没有 `activated` 日志，分不清是回调没触发，还是 `show_main_window` 失败（后者会打 `could not restore`，但 R9 没抓日志）。

下一步：按 `ux-v4-device-first-fix-prompt-r10.md` 加激活和关闭日志，重装后分别测点横幅和在通知中心点，再决定修法。

## 第 10 轮（进行中）

代码审核：`bb1d55b fix(desktop): log notification activation and dismissal`，通过。只改了 `attention_notifications.rs`：激活回调一进来就打 `notification activated type=… repeat=…`，在去重判断前面；关闭回调打 `notification dismissed reason=…`。两行都不含标题、正文和任何标识，测试里用哨兵值核过。原有激活逻辑不变。

安装包 `D210320D…A411`，26,725,660 字节，我复核过。日志里没有 key。R8 安装包已备份到 `installers/9800ae2/`，哈希一致，那个目录少了一个 SHA256SUMS.txt，不影响。

实测结果（`v4-acceptance-report-r10.md`，我核对过脱敏日志）：

- 两轮 Codex 回合都完成了，各生成一条 `completed_review` 通知。日志里每轮都是先 `shown`，约 6 秒后 `dismissed reason=TimedOut`，横幅只停留 6 秒左右。
- 测试 A：用户没赶上横幅，没有点，结果未观察到。
- 测试 B：横幅超时后，用户在通知中心点了最新那条。之后没有 `notification activated`，也没有 `main_window_restored` 或 `could not restore`，窗口一直最小化。整份日志 `activated` 为 0。
- 结论：点通知中心里的通知，Windows 没有回调到进程内的 `Activated`，也没有重新启动应用（否则单实例插件会恢复窗口）。这和第 9 轮的假设一致，和微软文档对未打包桌面应用的说明也一致。A 没有对照，所以只证明了通知中心这条路不通，没证明横幅能点通。用户离开电脑后回来点通知中心，正是这个功能最主要的用法，所以不管 A 结果如何都要修。
- 其他：R10 报告里全仓 `pnpm format:check` 有 617 个文件不通过，抽查是 Windows checkout 的 CRLF 造成的，不是这轮引入的，合并前另外处理。

下一步：用户选了登记 `codetether://` 链接（不选 COM 组件），按 `ux-v4-device-first-fix-prompt-r11.md` 实现并测通知中心、横幅和应用未运行三种点击。

## 第 11 轮（进行中）

代码审核：`835489d fix(desktop): activate notifications through protocol links`，通过。17 个文件，没有改 Host。

- 登记方式：用官方 `tauri-plugin-deep-link` 2.4.9 和现有 NSIS 模板，只放在 Windows 配置 `tauri.windows.conf.json` 里。单实例插件打开 `deep-link` 功能，排在第一个。开发构建不在运行时登记。
- 链接解析（`notification_links.rs`）：严格前缀，不解码、不改大小写，ID 用 `is_public_id(…, "attn_")` 校验，有长度上限。参数个数不是 2 时按无效处理，不从单实例转来的参数里拼链接。无效链接只恢复窗口。日志只有 matched、unmatched、invalid 三种。
- 点击处理：内存里按 attention ID 找到通知意图就走原来的 `activate_notification`。找不到就交给前端，前端只在 open、resolved、expired 三个列表里各查一次（每次最多 100 条），ID 唯一匹配才跳转，否则不跳。另加了按 attention ID 的激活去重，回调和链接都到时只放行一次。
- 应用没在运行时，`desktop_ready` 之后再处理启动参数，顺序正确。
- 小问题，不阻塞：前端只查最近 100 条，再旧的提醒点开只恢复窗口。可以接受。

安装包 `37712481…1589`，26,739,086 字节，我复核过。日志里没有 key。R10 安装包已备份到 `installers/bb1d55b/`，有 SHA256SUMS.txt。

实测结果（`v4-acceptance-report-r11.md`，我核对过脱敏日志）：

- 安装和登记：`HKCU\Software\Classes\codetether` 已登记，打开命令是安装目录里的 `codetether-desktop.exe "%1"`。
- 测试 B，通知中心：日志依次是 `shown`、`dismissed reason=TimedOut`、`activated repeat=false`、`main_window_restored`（22 毫秒）、`link received result=matched`。窗口恢复到前台，路由带这一轮的 `turn` 和唯一的 `notification-1`，只跳转一次。通过。
- 测试 C，应用没在运行：用户退出后确认 Desktop 和 Host 都是 0。用户点了保留的通知，Windows 启动了新进程（10:43:10），窗口可见、在前台，路由指向正确的会话和回合，只跳转一次，数据数量不变。通过。这次启动没有重定向日志，所以 C 没有日志行。
- 测试 A，横幅：两个回合都给了 B 和 C，没有测。B 已经证明点击这条路是通的，A 不影响结论。
- 链接安全：`codetether://notification/attn_invalid` 结果 `unmatched`，`codetether://other` 结果 `invalid`，都只恢复窗口，路由和提醒状态不变。通过。
- 截图：B 和 C 的标题栏截图都没拿到，因为补拍时窗口已经被最小化。功能结论以 Codex 当时记录的窗口状态、路由和日志为准，不缺截图以外的证据。
- 原始日志已脱敏并删除。

第 9 项通过：通知文案在第 8 轮核实过，点开进入会话在这一轮核实了。Windows 清单 15 项全部通过。

格式检查：全仓 `pnpm format:check` 报的 617 个文件，原因是本机 `core.autocrlf=true`，工作区里是 CRLF，索引里是 LF。加 `--end-of-line auto` 再查只剩 3 个文件（`host-presence-diagnostics.ts`、`host-presence-publisher.ts`、`docs/PRODUCT.md`），这 3 个在 main 上就没格式化，这个分支没改过它们。所以不挡合并，以后单独处理。

合并：`ux/v4-device-first` 在 main 之后 39 个提交，可以快进。用户同意后本地快进合并 main 到 835489d。推送和打标签另外征求同意。Mac 安装版没有验收，要先推送分支。

## Mac 第 1 轮

报告：Mac 上的 `~/agenthub-archive/v4-acceptance-report-mac.md`（用户转来全文，我没法直接读 Mac 的文件）。

- 构建 `git-835489dd3c9e`，`.dmg` SHA256 `c2d58c5f…24e0`，临时签名，没有公证。旧版和数据有完整备份，文件数和大小核对一致。
- 通过 9 项：3、4、7、8、11、12、13、14、15。不通过 0 项。未测 6 项：1、2、5、6、9、10，图标也没看。
- `pnpm test` 有 3 项失败，都是 Windows 安装器路径的测试在 macOS 上把 Windows 路径当成相对路径，是测试本身的平台问题，不是产品缺陷。以后单独修，不挡这次验收。
- 正式数据里多了 1 个测试项目和 1 个测试会话（10/2/24 变成 11/2/25）。没有删除会话的功能，保留。用户不想要的话可以用备份恢复。
- 风险提示：macOS 点通知只在内存里找通知意图（`macos_notifications.rs:66-77`），应用退出后再点，可能只打开窗口、不跳到会话。Windows 在 R11 用链接解决了这个问题，Mac 还没有。第 2 轮会实测。
- 构建配置被保存到了 Mac 上 `~/agenthub-work/v4-build.env`（权限 600）。提示词没要求保存，里面有 publishable key，不进仓库就行，用户可以自己决定是否删掉。

下一步：按 `ux-v4-device-first-mac-acceptance-prompt-r2.md` 补测。

## Mac 第 2 轮

报告：用户转来全文。通过 11 项，不通过 2 项（5、9），未测 2 项（6、10）。

- 第 1、2 项通过：用隔离数据目录跑了首次设置，导入了 1 个以前的 Codex 会话，正式数据没动，结束时还是 11/2/25。
- 第 6 项部分通过：停止可以用，新增和删除文件分别显示 `+3`、`-3`，逐行内容都能看到。没出现批准请求，因为 `sleep` 在 Codex 默认的 `workspace-write` 沙箱里（`packages/adapter-codex/src/client.ts:324-326`）不需要批准。“允许一次”和“拒绝”没测。
- 第 5 项不通过，我认为是误判：第 2 轮提示词写的是“运行中直接打几个字”，这一条是我写错了。按设计，运行中输入框是只读的，`readOnly` 加 `aria-disabled`（`composer.tsx:227-228`），辅助功能接口会报“禁用”，所以打不进字。清单要求的是焦点留在输入框，回合结束后能直接接着打字，Windows 第 5 项就是按这个标准通过的。第 3 轮按这个标准重测。
- 第 9 项不通过，原因不明：两次都没在通知中心看到 CodeTether 通知，也没抓日志。可能是 macOS 的通知权限没给（代码首次通知时才申请，`macos_notifications.rs:260-287`），或者通知根本没发。第 3 轮先用日志查原因，不修。
- 第 10 项：跟随系统和重启后保持已通过，没截到首帧。
- 图标：关于窗口和 `icon.icns` 是新图标，Dock、启动台和菜单栏没截到。

下一步：按 `ux-v4-device-first-mac-acceptance-prompt-r3.md` 查通知原因，重测第 5、6 项，补第 10 项首帧和图标。

## Mac 第 3 轮

报告：用户转来全文和脱敏日志。通过 13 项，不通过 1 项（9），未测 1 项（10）。

- 第 5 项通过：两次发送后焦点都在输入框，回合结束后直接打 `abc` 成功。
- 第 6 项通过：往项目外写文件触发了批准请求，“拒绝”后文件没有建，“允许一次”后建出来了，内容正确。
- 第 9 项不通过：三个通知开关都开着，系统设置里有 CodeTether，但等批准时最小化了 55 秒，没有通知。整份日志里没有 `notification shown`、`skipped`、`delivery failed`，也没有 `could not restore`。37 行 `provider-unknown-notification` 是 Host 抑制 Codex 未知事件的日志，和桌面通知无关。
- 我读代码后的判断：
  - macOS 发通知成功时，代码不打日志（`macos_notifications.rs:289-310`）。Windows 在 4f30416 加了 `notification shown` 日志，macOS 没加。所以“日志里没有”分不清是没发还是发了被藏起来。
  - 另一种可能：最小化后 macOS 的 WebView 被挂起，收不到 Host 推来的提醒。等窗口恢复时，窗口已经在前面了，提醒按设计不再弹（`desktop-notification-model.ts:115-129`）。Windows 用 Web Lock 防挂起（`native-capabilities.ts:333-338` 的注释），macOS WKWebView 有没有同样效果没有验证过。
- 第 10 项和 Dock、菜单栏、启动台图标：三轮都没截到，很可能是 Mac 终端没有“屏幕录制”权限，截图只能拿到桌面背景。
- 其他：Mac 原工作区里出现了不是智能体创建的改动（`apps/site/.env.example`、`apps/site/components/site-analytics.tsx`），在网站部分，和这个分支无关。智能体没有碰，要不要保留由用户决定。

下一步：按 `ux-v4-device-first-mac-acceptance-prompt-r4.md` 读系统通知设置，用 usernoted 日志做最小化和不最小化的对照，确定原因后再写修复提示词。

## Mac 第 4 轮

报告：用户转来全文和脱敏日志。还是 13 项通过，第 9 项不通过，第 10 项未测。

- 系统设置：允许通知开着，通知中心和锁屏显示开着，专注模式关着，提醒样式不是“无”。所以不是 B（系统把通知藏了）。
- 被挡住（不最小化）和最小化两次都没出通知。Desktop 日志没有任何通知行，usernoted 日志是空的。
- 我的判断：A（网页在后台被挂起）的可能性最大。WKWebView 的 `inactiveSchedulingPolicy` 默认是 suspend，窗口不在前台就会挂起网页。被挡住和最小化都会触发，和两次结果都吻合。Windows 的 Web Lock 办法（`native-capabilities.ts:333-338`）在 macOS 上没用。Tauri 2.11.5 有 `backgroundThrottling` 窗口配置（tauri-utils 2.9.3 `config.rs:2194-2200`），macOS 14 以上生效，现在没设。
- 也不能排除 C：日志太少，看不出原生这条路有没有被调用。macOS 成功发通知时不打日志，网页的失败诊断只写到 WebView 控制台。
- 另外，旧的 macOS 通知代码是 Phase 8D 写的，当时的 README 写明 macOS 通知没有实机验证过（`apps/desktop/README.md:298`）。所以这是一直没验证的问题，不是这个分支改坏的。
- 截图权限没问题。第 10 项和 Dock、菜单栏图标没补做，原因是我第 4 轮提示词写的条件只在没有权限时才要求补做。

下一步：按 `ux-v4-device-first-mac-fix-prompt-r5.md`，由 Mac 上的智能体在 `fix/macos-notifications` 分支上加通知日志、设 `backgroundThrottling: disabled`、让退出后点通知走按 ID 查找的路径，打包替换后测四种情况，再补第 10 项和图标。代码由我审核。

## Mac 第 5 轮

材料：用户转来报告、完整 diff 和检查日志（Mac 上的 `v4-mac-r5-review-materials.md`）。分支 `fix/macos-notifications`，两个本地提交 `469f58a`、`0076c37`，基于 835489d，没推送。macOS 27.0。

代码审核：通过，6 个文件 +204 −5。
- 日志：`notification requested`、`authorization result=granted/denied/error`、启动时 `authorization status=…`、`notification shown … platform=macos`，只有类型和状态，测试用哨兵值核过。`requested` 打在校验和去重之前，被拒或跳过时也会有一行，排查时有用。
- `backgroundThrottling: "disabled"` 写在基础配置里。Tauri 和 wry 文档写的是 Windows、Linux 不支持这项，会被忽略，和 `native-capabilities.ts` 里 Web Lock 的注释一致，Windows 行为不变。
- 退出后点击：先查内存，找不到再用 `codetether-attention-` 严格前缀加 `is_public_id(…, "attn_")` 取出 ID，走 R11 的 `activate_notification_link`（cfg 放宽到 macOS）。只用 ID 去 Host 查，不信任通知里的其他内容。ID 解析的反例测试覆盖了前缀、大小写、类型、长度、路径、查询串和换行。
- Cargo 只多开了 `UNNotificationSettings` 一个 feature，没加依赖。

检查：clippy 被两处 main 上已有的警告挡住，都只在 macOS 上出现，Windows 的 clippy 编不到这两段代码，所以以前没发现。
- `attention_notifications.rs:161` 手写 `Default`：在 macOS 非测试构建里，剩下的字段都能 `Default`，所以被提示 derivable。但 Windows 和测试构建里有 `BoundedRegistry::new(MAX_…)` 字段，要指定容量，照 clippy 的建议改成 `#[derive(Default)]` 会改坏 Windows。正确改法是在这个 impl 上加 `#[allow(clippy::derivable_impls)]`，并注明原因。
- `product_device_key_store.rs:555` cfg 块里的 `return`：去掉 `return` 和分号，两个 cfg 块都作为结尾表达式，两个平台行为不变。
- 我同意它在第三个提交里改这两处。改动超出了第二部分的范围，但只是机械修改，不改变行为。
- `pnpm test` 有两类已知失败：Windows 安装器路径测试在 macOS 上失败；Claude 测试在 macOS 上因为 `/var` 和 `/private/var` 是同一个目录的两个路径而失败，用规范的 `TMPDIR` 重跑后全部通过。都是测试本身的跨平台问题，这个分支没有引起，这一轮不修，以后单独处理。

下一步：Mac 上改好 clippy，提交并推送 `fix/macos-notifications`，然后打包、替换、做四项实测。分支推上来以后，我在 Windows 上跑 cargo check、clippy 和 test。

结果：14 项通过，第 9 项不通过，未测 0 项。
- 第三个提交 `a8abbec` 只改那两处 clippy，和我给的改法一致。已推送 `fix/macos-notifications`（a8abbecc），没推 main，没打标签。
- 第 10 项通过：浅色启动的首帧没有深蓝。
- 第 9 项：日志依次是 `notification requested type=completed_review`、`authorization result=granted`、`notification shown … platform=macos`，重启后有 `authorization status=authorized`。
  - 后台挂起的问题解决了：网页在后台已经能调用发通知，第 3、4 轮完全没有这一行。
  - 但横幅和通知中心都没有显示。代码里没有删除已送达通知的调用，通知内容只有标题和正文。剩下的原因都在系统那边，见第 6 轮提示词。
- 第 4 轮的 `log stream` 没加 `--level debug`，usernoted 的 info 和 debug 记录都被过滤掉了，所以那次日志是空的，不能说明系统没收到通知。
- Windows 编译复核：分支已推送，但本会话的权限服务暂时不可用，fetch 和 cargo 都还没跑，之后补上。

下一步：按 `ux-v4-device-first-mac-acceptance-prompt-r6.md` 查系统层面的原因，不改代码：
- 签名和 LaunchServices 里同一 bundle id 的多份登记；
- ncprefs 里 CodeTether 的设置；
- 屏幕共享或镜像时不弹通知；
- 用 `osascript` 发一条对照通知；
- 用 `open -a … --stderr` 通过系统正常启动后再测，带 debug 级 usernoted 日志；
- 用户同意后，注销备份和构建目录里那几份副本的登记。

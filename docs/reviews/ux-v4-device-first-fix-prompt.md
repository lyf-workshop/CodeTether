# 修复提示词：ux/v4-device-first 第 1 轮审核

> 把下面整段交给编码智能体。

---

你在 CodeTether 仓库里修复 `ux/v4-device-first` 第 1 轮审核发现的问题。

## 起点

- 工作区：`D:/Projects/Software/agenthub-ux-v4-device-first`（已存在，不要新建 worktree）
- 分支：`ux/v4-device-first`，起点提交 `df91601`。开工前确认 `git rev-parse HEAD` 是 df91601 开头、工作区除 `docs/UX-V4-REVIEW-NOTES.md` 外是干净的；不一致就停下报告。
- 审核记录（必读）：`D:/Projects/Software/agenthub/docs/reviews/ux-v4-device-first.md`。下面的 M*、S* 编号都指它。
- 需求和设计：`D:/Projects/Software/agenthub/docs/ux-redesign/04-requirements.md`（第三版）、`02-dev-handoff.md` 和原型页面。
- 授权说明：Figma 同步暂停期间，`docs/ux-redesign` 的需求和原型是用户授权的临时界面依据（用户 2026-10-19 的决定），本任务覆盖 AGENTS.md 里“Figma 是唯一来源”。AGENTS.md 的其余规则全部照常遵守。

## 要做的事和提交

每一步一个提交，提交信息用英文 conventional commit，末尾加：
`Co-Authored-By: Claude Code <noreply@anthropic.com>`（如果你不是 Claude Code，换成你自己的名字，格式不变）。

1. **M1 恢复“从这台设备移除项目”**（`fix(web): restore per-device project removal`）
   - 在设备详情页的项目卡片，以及解除配对弹窗被挡住时列出的每个项目旁边，提供“从这台设备移除”。复用 `remove-project-location-dialog.tsx` 和 `runtime.removeProjectLocation`。
   - 只有这个项目在这台设备上没有会话（含已归档）时才可点；否则显示原因，不显示可点的按钮。
   - 解除配对弹窗在移除后重新预检，全部移除后变成可解除配对。
   - 测试：用渲染测试覆盖“本机有会话、配对设备有文件夹”这个场景，能走通到可以解除配对。
2. **M3、M4、M5 侧栏**（`fix(web): persist sidebar tree and gate add project`）
   - 展开 / 收起的设备和项目 ID 存 `localStorage`（只存 ID，键名带 `ct-` 前缀，读出时校验，坏数据当空）。当前路径仍自动展开。
   - Ctrl B（Mac 上 ⌘B）收起 / 展开侧栏，输入法组字中、焦点在输入框里时不触发，和现有快捷键写在同一处。
   - 侧栏“+”改用 `machineCanAddProject`，不可用时和设备页一样显示原因。
3. **S1、S2、S16、S17 输入框和创建**（`fix(web): keep composer focus and idempotent create`）
   - 发送中不再隐藏编辑器（只读即可），发送结束焦点回到编辑器（前提是发送前焦点在输入框里）。
   - 创建会话：同一选择、上次失败不是 Host 明确拒绝（非 `CodeTetherResponseError`）时复用 actionId，做法照 `live-conversation-actions.ts:137-139`。
   - 删掉 `composer.tsx:172` 的演示分支，`controller` 改成必填。
   - 草稿按会话 ID 存 `sessionStorage`，发送成功或归档后删除，不写 `localStorage`。
4. **M2、S19 删死代码**（`refactor(web): remove unreachable v3 modules`）
   - 删掉审核记录 S19 列出的模块和 `conversations-page.tsx`、`project-conversations-route.tsx`，同时删或改只为它们存在的测试。`remove-project-location-dialog.tsx` 保留（第 1 步在用）。
   - 删之前用 import 可达性确认它们确实不被 `main.tsx` 引用；有疑问的不删，写进报告。
5. **S3、S9、S15、S20 文案**（`fix(web): chinese-only copy and roadmap link`）
   - 源头字符串改成“AI 工具”“这台电脑”“文件夹”等 04 用语，不在展示层打补丁；`tool-presentation.ts`、`provider-presentation.ts`、`message-markdown.tsx` 里的英文译成中文。
   - 账号页那句提到其他电脑的话后面加到 `/roadmap` 的链接。
   - 加一个测试：扫描 `apps/web/src` 的用户可见字符串，出现“智能体”“推理后端”“Provider”“此电脑”时失败（允许 Codex、Claude Code、Relay、Node）。
6. **S4、S5 列表**（`fix(web): recent projects first and server-side filters`）
   - 新建会话的项目列表加“最近使用”组（最多 5 个，按 `lastActivityAt`），其余按设备分组。
   - `status`、`provider` 传给 `listProjectConversations`，并放进查询键。Host 接口已支持，不改 Host。
7. **S7、S8、S10、S11、S12 设备和项目**（`fix(web): device page polish`）
   - 项目卡片指标在卡片可见时加载（不依赖悬停）。
   - 添加项目竞态时显示中文提示“这个文件夹刚被添加过，列表已更新”，并刷新列表。
   - 原生 checkbox 换成 `packages/ui` 组件（没有就在 `packages/ui` 加一个，带标签和键盘操作）。
   - 断点和尺寸常量收到一个文件或 tokens。
   - Host 没就绪时“解除配对”按钮禁用并说明原因。
8. **S14 已授权的手机和平板**（`feat(web): read-only list of authorized mobile devices`）
   - 在 设置 › 账号 下加只读列表“已允许访问的手机和平板”：名称、类型、授权时间。数据来自现有协调器已拿到的授权，不新增后端接口，不加开关和按钮。没有授权时整段不显示。
   - 说明一行：“移除功能会在配对码配对上线时提供”，链到 `/roadmap`。
9. **S23 / UX-V4-001 首次设置**（`fix(web): separate install runtime and service readiness`）
   - 按 `docs/UX-V4-REVIEW-NOTES.md` 改，只动 `onboarding-page.tsx`、`onboarding-model.ts`，顺便把 onboarding-page 拆小。验收清单逐条做到。改完后把这个笔记文件里的状态改成“已修复，待复核”，随这个提交一起提交。
10. **S18、S21、S22 和 S6 记录**（`refactor(web): split large files and add behavior tests`）
    - Node 文档链接改走 `provider-guidance-link.tsx` 的原生打开方式。
    - 拆 `previous-conversations-step.tsx`、`workspace-sidebar.tsx`、`conversation-organization-controls.tsx`、`add-project-dialog.tsx`，每个不超过 400 行，只拆不改行为。
    - 把 `new-conversation-dialog.test.mjs` 里对源码的正则测试换成渲染测试：双击只创建一次、缺首条输入或模型时不能创建、409 时保留草稿且不重发、发送后焦点回到输入框。
    - S6（批准放在输入框上方的待处理栏，偏离 W6）不用改代码，也不用改文档：本分支没有 `docs/ux-redesign`，这处偏离由审核方记录。

11. **M6、M7 对比度**（`fix(ui): meet AA contrast for muted and warning text`）
    - `globals.css`：浅色 `--ct-text-3` 改为约 `#706b64`，深色改为约 `#928e87`（审核方算过：在 bg、surface、inset 上都 ≥ 4.5）。改完用脚本算一遍所有 `--text-muted`、`--status-idle-text`、`--status-offline-text` 和它们实际所在背景的组合，结果写进报告。
    - 所有把 `text-warning`、`text-danger` 当文字色的地方改成 `text-warning-text`、`text-danger-text`（先 grep 全部用法，至少 `inbox-page.tsx:228`、`inbox-item.tsx:113,154`）。
    - `apps/desktop/src-tauri/tauri.conf.json:26` 的窗口底色改成浅色主题的背景色（S32）。这是唯一允许改的 `apps/desktop` 文件。
12. **M8、S24、S33、S34 待处理**（`fix(web): attention actions and notification body`）
    - 已完成待查看加“知道了”（`resolveAttention`）。等待批准在这台设备不能批准时，显示一句原因（例如“这台设备上的 AI 工具不支持在这里批准，请打开会话处理”），不加“知道了”：Host 对 approval 类返回 422（`host-service.ts:3220-3225`），不改 Host。
    - “查看结果”在 `resolveAttention` 失败时也打开会话，并显示失败提示。
    - Host 已连接但列表查询失败时，换成“待处理列表暂时读不到，请稍后重试”之类的准确说法。
    - 系统通知正文加设备名：“设备 · 项目”，仍不含会话标题、提示词、命令和路径。
13. **S25–S30、S35 组件和设置**（`fix(ui): settings and component accessibility`）
    - “始终开启”用正常色或不显示点；删掉没用的 `backgroundRuntimeAvailable`。
    - `roadmap-page.tsx` 的 `<main>` 改成 `<section>`。
    - `Notice` 默认不带 `role`，错误类仍用 `role="alert"`；检查现有调用方需要播报的地方显式加上。
    - `CommandList`：listbox 里不放标题和状态，空状态移到外面，`aria-expanded` 跟随实际状态。
    - 通知开关加 `aria-describedby` 指向那一行的说明。
    - `AttentionRow` 窄屏时按钮换到正文下面。
    - 重新发送登录码加 30 秒本地冷却，按钮上显示剩余秒数。

先核实再改：`packages/ui/src/tokens/statuses.ts` 把 `waiting` 统一显示为“等待批准”。查清 Host 的 `waiting` 是否只表示等待批准；不是的话改回中性说法，结论写进报告。

S13（getMachine 调用次数）先核实：确实是每台设备一次请求，就合并成一次；不是就写进报告。

## 不能破坏的规则

- `docs/ux-redesign/03-project-plan.md` §6 的不变量。
- 界面只显示后端真实提供的能力；还没做的只出现在 `/roadmap`。不加假开关、不加“即将上线”。
- 界面只用中文（Codex、Claude Code、Relay、Node 可以保留英文；“AI 工具”可以）。
- 不加演示数据；任何演示都不调用真实的登录、删除和 AI 工具执行接口。
- 远程和本机操作沿用现有门控：actionId 幂等、运行中不能归档、失败不自动重发、409 不重发、停止和审批只对支持的 AI 工具开放。
- 通知不含会话标题、提示词、命令和路径。
- AGENTS.md：不用 `style=`、不用 `!important`、颜色只用 tokens、不用 Zustand、通用组件放 `packages/ui`。
- 不改 `apps/host`、`packages/protocol`、`packages/client`、Control Plane 和 Relay；`apps/desktop` 只允许改第 11 步那一处窗口底色。需要改它们才能完成的，停下写进报告。

## 不能做的事

- 不读、不写 `.secrets/`、任何 `.env` 和凭据文件；不读 `~/.claude.json`。
- 不部署，不推送（包括 `ux/v4-device-first` 和 main），不合并，不打 tag，不替换已安装的 Mac 和 Windows 版本。
- 不动主工作区 `D:/Projects/Software/agenthub` 根目录下未跟踪的文件（`PHASE8D-*`、`demo-ui-*.html`、`ICON-COLLECTION-PLAN.md`、`docs/MULTI-PROVIDER-STRATEGY.md`、`packages/ui/src/assets/`）。
- 不用 `git add .`，按文件暂存。不改 git 配置，不跳过 hooks。
- 不在任何输出、日志、提交里打印环境变量的值。

## 验证

在工作区根目录依次运行：

```
pnpm typecheck
pnpm lint
pnpm test
pnpm build
npx prettier --list-different --end-of-line auto <本次改动的文件>
```

- `pnpm test` 里 `packages/adapter-claude/test/detection.test.mjs:331` 已知会因为本机的 ANTHROPIC_* 环境变量失败，和本任务无关。请用 `env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_MODEL pnpm test` 跑，并在报告里写明。不要修改这个测试。
- `pnpm format:check` 全仓库会因 CRLF 换行报错，不用管；只看上面那条针对改动文件的检查。
- 重点检查：第 1 步的场景测试；第 5 步的文案扫描测试；侧栏刷新后展开状态保持；Ctrl B；发送后焦点；第 11 步的对比度计算结果；第 12 步通知正文不含标题的测试。

如果遇到 API 429 或 524：按返回的 Retry-After 等待后重试，每种错误最多重试 3 次，每次记下时间和等待时长；第 3 次后仍失败就停下，在报告里说明停在哪一步。

## 报告格式（中文）

1. 每一步：提交哈希、改了什么、对应的 M/S 编号。
2. 检查结果：五条命令的退出码，失败的原样贴出（先把任何形如令牌的字符串替换成 `[REDACTED]`）。
3. 没做的和原因（包括 S13 的核实结论、因为不能改 Host 而停下的地方）。
4. 偏离需求或原型的地方。
5. 所在的“完成”级别（见 `D:/Projects/Software/agenthub/docs/DEVELOPMENT-PROCESS.md` §2）。检查全部通过时是“代码完成”，不要自称“审核通过”。

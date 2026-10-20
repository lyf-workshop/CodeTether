# 修复提示词：ux/v4-device-first 第 2 轮审核

> 把下面整段交给编码智能体。

---

你在 CodeTether 仓库里修复 `ux/v4-device-first` 第 2 轮审核的问题。范围小，只改下面列出的地方。

## 起点

- 工作区：`D:/Projects/Software/agenthub-ux-v4-device-first`（已存在，不要新建 worktree）
- 分支：`ux/v4-device-first`，起点提交 `33f5b5d`。开工前确认 `git rev-parse HEAD` 以 33f5b5d 开头、工作树干净；不一致就停下报告。
- 审核记录（必读“第 2 轮”一节）：`D:/Projects/Software/agenthub/docs/reviews/ux-v4-device-first.md`。下面的 R2-* 编号都指它。
- 需求：`D:/Projects/Software/agenthub/docs/ux-redesign/04-requirements.md`。
- 授权说明：Figma 同步暂停期间，`docs/ux-redesign` 的需求和原型是用户授权的临时界面依据（用户 2026-10-19 的决定），本任务覆盖 AGENTS.md 里“Figma 是唯一来源”。AGENTS.md 的其余规则照常遵守。
- 更正：第 1 轮提示词第 10 步“缺首条输入或模型时不能创建”写错了。以 04 C1、W13 为准：电脑上新建会话不带首条消息、不选模型，保持现状。报告里引用 C1，不要写“按用户确认”。

## 要做的事和提交

每一步一个提交，英文 conventional commit，末尾加：
`Co-Authored-By: Claude Code <noreply@anthropic.com>`（如果你不是 Claude Code，换成你自己的名字，格式不变）。

1. **R2-1 运行中保持焦点**（`fix(web): keep composer mounted while turn runs`）
   - `composer.tsx:82`：`running`、`waiting` 时编辑器保持挂载、只读，门控栏显示在旁边，不再隐藏。`archived`、`unavailable` 维持现状。
   - 焦点规则不变：发送前焦点在输入框里、之后没被用户移走，才在可编辑时回到输入框。
   - 加渲染测试：submitting → running → idle 全程焦点不落到 body；运行中输入框只读，不能发送。
2. **R2-2 成功色文字对比度**（`fix(ui): success text contrast`）
   - 把 `text-success` 当文字色的地方改成 `text-success-text`（先 grep 全部用法，至少 `conversation-files-surface.tsx:54`、`inspector-panel.tsx:215`、`conversation-timeline.tsx:134`）。
   - `token-contrast.test.mjs` 加上 success-text、warning-text、danger-text 在各自实际背景上的组合，并加一条测试：`apps/web/src`、`packages/ui/src` 里不再出现 `text-success`、`text-warning`、`text-danger` 作文字色（`*-text`、`bg-*`、`border-*` 除外）。
3. **R2-3、R2-9 文案**（`fix(web): rewrite mechanical copy replacements`）
   - 手工改写 `machine-actions.ts:384,398,400,404,418,444`，例如“设备操作正在处理中，请稍候。”“当前 CodeTether 版本不支持这项设备操作。”“配对码无效，请检查 Node 上显示的 6 位配对码。”中英文之间加空格。
   - 全仓库 grep 一遍“这台电脑操作”“Node显示”“在Node”这类替换残留，一并改。
   - `user-visible-copy.test.mjs` 同时扫描 `packages/ui/src`。
4. **R2-4 侧栏不能添加的原因**（`fix(web): explain why sidebar cannot add project`）
   - `workspace-device-section.tsx`：设备在线但 `machineCanAddProject` 为 false 时，在设备行显示和设备页同样的原因（复用 `machine-projects-section.tsx:109-114` 的文案，抽成一个函数，两处共用）。
5. **R2-5、R2-6 窄屏布局**（`fix(web): narrow layout for attention rows and sheets`）
   - 删掉 `workspace-responsive.css` 里 `attention-body`、`attention-time`、`attention-actions` 三条规则，让 `attention-row.tsx` 里 33f5b5d 加的类生效（或者反过来全放 CSS，二选一，不要两处都写）。
   - 弹层规则里在 `transform: none` 旁边加 `translate: none; scale: none;`。
   - 用浏览器在 390 和 600 宽度下核对：待处理行的按钮在正文下面；添加项目和新建会话弹层贴底、完整可见。报告里写明检查方法和结果。测试至少检查构建后的 CSS 里没有 `attention-actions` 的 `grid-column: 3`，并且弹层规则包含 `translate: none`。
6. **R2-7、R2-8 请求次数**（`perf(web): load card metrics when visible and reuse cache`）
   - `machine-projects-section.tsx:131-134`：项目卡片进入视口（IntersectionObserver）后才加载指标；不支持 IntersectionObserver 时直接加载。
   - `attention-notification-metadata.ts:30-34`：先用 `queryClient.getQueryData` 读已有的会话列表，没有再请求，和 `:43-44` 读设备的做法一致。
7. **R2-10、R2-11 测试和清理**（`test(web): end-to-end project location removal`）
   - 给 M1 加一条 jsdom 测试：打开解除配对弹窗（被挡住）→ 点“从这台设备移除” → 确认 → 模拟 Host 返回更新后的设备 → 弹窗变成可以解除配对。
   - 删掉只剩测试在用的 `defaultProviderControls`、`defaultProviderModel`（`new-conversation-provider-selection.ts:91-107`）和对应测试。

不在本轮：S18（Node 文档原生打开）、通知“已在屏幕上”的判断、标题级别、其余大文件拆分、adapter-claude 环境隔离。遇到也不要顺手改。

## 不能破坏的规则

- `docs/ux-redesign/03-project-plan.md` §6 的不变量。
- 界面只显示后端真实提供的能力；还没做的只出现在 `/roadmap`。不加假开关、不加“即将上线”。
- 界面只用中文（Codex、Claude Code、Relay、Node 可以保留英文；“AI 工具”可以）。
- 不加演示数据。
- 远程和本机操作沿用现有门控：actionId 幂等、运行中不能归档、失败不自动重发、409 不重发、停止和审批只对支持的 AI 工具开放。
- 通知不含会话标题、提示词、命令和路径。
- AGENTS.md：不用 `style=`、不用 `!important`、颜色只用 tokens、不用 Zustand、通用组件放 `packages/ui`。
- 不改 `apps/host`、`apps/desktop`、`apps/node`、`packages/protocol`、`packages/client`、Control Plane 和 Relay。需要改它们才能完成的，停下写进报告。

## 不能做的事

- 不读、不写 `.secrets/`、任何 `.env` 和凭据文件；不读 `~/.claude.json`。
- 不部署，不推送，不合并，不打 tag，不替换已安装的 Mac 和 Windows 版本。
- 不动主工作区 `D:/Projects/Software/agenthub` 根目录下未跟踪的文件。
- 不用 `git add .`，按文件暂存。不改 git 配置，不跳过 hooks。
- 不在任何输出、日志、提交里打印环境变量的值。

## 验证

在工作区根目录运行：

```
env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_MODEL pnpm typecheck
env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_MODEL pnpm lint
env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_MODEL pnpm test
env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_MODEL pnpm build
git diff --name-only --diff-filter=AM 33f5b5d..HEAD | xargs -n 40 npx prettier --list-different --end-of-line auto
```

（Prettier 要分批传文件，一次传太多 Windows 会报命令行太长。）

如果遇到 API 429 或 524：按返回的 Retry-After 等待后重试，每种错误最多重试 3 次，每次记下时间和等待时长；第 3 次后仍失败就停下，在报告里说明停在哪一步。

## 报告格式（中文）

1. 每一步：提交哈希、改了什么、对应的 R2 编号。
2. 检查结果：五条命令的退出码，失败的原样贴出（先把形如令牌的字符串替换成 `[REDACTED]`）。
3. 第 5 步的浏览器核对方法和结果。
4. 没做的和原因。
5. 所在的“完成”级别（见 `D:/Projects/Software/agenthub/docs/DEVELOPMENT-PROCESS.md` §2）。检查全部通过时是“代码完成”，不要自称“审核通过”。

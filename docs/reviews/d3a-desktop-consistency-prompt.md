# Task: D3a Desktop Consistency (Status Wording, Page Headers, Naming)

**Where it runs.** On Windows or the Mac, whichever is free. This is web-only work.

**Windows-only scope (Owner, 2026-11-18; AD-13).** Run it on Windows only: the Owner develops only on Windows for now. The report's screenshots and the acceptance come from the Windows desktop app.

**Branch and worktree.** Start from the current `origin/main` after task 5 (D2 model-control integration) has been merged (fetch first). Create branch `feat/d3a-desktop-consistency` in worktree `<agenthub-work>/feat-d3a-desktop-consistency`. That is `D:/Projects/Software/agenthub-work/` on Windows and `~/agenthub-work/` on the Mac.

**Why this task exists.** The visual system is consistent, but screens disagree with each other:

- One AI-tool state has four different wordings.
- Every page builds its own header, so content starts at a different place on each page.
- The same thing has two names.
- A healthy tool shows an amber warning at the moment the user starts work.

**References** (read with `git show origin/ux/design:<path>`):

- `docs/reviews/2026-11-13-desktop-ui-review.md`, findings 4, 5, 6, 7, 8 (computer and project pages; the conversation part belongs to D2.5), 15 and 16
- `docs/PRODUCT.md`, Phase 4D (user copy avoids implementation terms) and `docs/ux-redesign/10-desktop-improvements.md` §3.1 (terminology mapping)
- the prototype pages in `docs/ux-redesign/png/`: `02-01-devices`, `02-02-device-local`, `02-03-device-paired`, `02-04-project-detail`, `02-06-project-archived`, `02-11-inbox`, `02-14-new-session-project`, `02-23-add-device`, `02-34-settings-about`, `02-36-onboarding-tools`
- `docs/ux-redesign/03-project-plan.md` §6 (invariants)

Before starting, confirm this file has 4 second-level headings and that the last one is "Report".

## Goals

**Must:**

1. **One status vocabulary for AI tools** (finding 5).
   - `apps/web/src/provider/provider-presentation.ts` becomes the only place that turns these Provider facts into a label and a tone:
     - installation availability
     - sign-in readiness
     - compatibility
     - execution health
     - freshness
   - The computer card, the computer page, Setup (onboarding), "关于与检查" (Doctor) and the New Conversation dialog all use it.
   - Delete the four local mappings listed in Known facts.
   - **One summary status per computer and tool.** Proposed labels (keep them unless a fact does not fit, and report any change):

     | Label               | Tone    | Condition                                            |
     | ------------------- | ------- | ---------------------------------------------------- |
     | 可用                | success | installed, compatible, signed in, not unhealthy      |
     | 可用，部分功能受限  | warning | limited compatibility, or degraded health            |
     | 未登录              | warning | sign-in required                                     |
     | 需要更新此 AI 工具  | warning | unsupported version                                  |
     | 需要更新 CodeTether | warning | incompatible contract                                |
     | 未安装              | neutral | not installed                                        |
     | 暂时不可用          | danger  | misconfigured, unavailable, or execution unavailable |

   - **Freshness is secondary text**, never the status itself. Examples: "上次检查 10 分钟前", or "尚未检查" when no check has run. That is why Codex reads "可用" on one screen and "尚未检查" on another today: a check that never ran is shown in the status slot.
   - **One status component** in `packages/ui`, or the existing `Badge` with one variant mapping, renders the summary everywhere.
   - **Detail views** (Doctor, "查看详细状态") may still show each underlying fact, but with labels from the same module.
2. **A healthy tool raises no warning** (finding 4).
   - In the New Conversation dialog, a Provider that is healthy, or last known healthy, shows no advisory box.
   - A degraded or unavailable Provider shows one plain sentence and, where one exists, the next step, using the vocabulary from goal 1.
   - No internal terms in that copy: "执行", "上次已知", "首个明确轮次", "重新验证" and similar go.
3. **One page header** (finding 6).
   - Add `PageHeader` to `packages/ui`, with a title, an optional description and optional actions.
   - Every top-level page uses it: Devices, computer detail, project, archived conversations, Inbox, each Settings section, Add Device, Setup and Doctor.
   - Define one content width and left edge per page type (list page, detail page, settings, form page) with layout tokens. At 1440 px, pages of the same type start at the same x.
   - The Inbox subtitle no longer touches its title.
   - No subsection heading is larger than its page heading (today "状态检查" on "关于与检查" is).
4. **One name for one thing** (finding 7).
   - The devices page title becomes "设备", matching the sidebar, breadcrumb and button. It lists computers and also "手机和平板".
   - The archived view's breadcrumb no longer repeats the project ("本地电脑 › weather-cli › 已归档会话", not "… › weather-cli › weather-cli").
   - Check the terminology table in 10 §3.1 against every page header and breadcrumb, and report any other mismatch you fixed.
5. **Navigation and status shown once** (finding 8, computer and project pages).
   - Computer and project pages drop the "返回设备" link; the breadcrumb is the way back. The project page's back link also skips the computer level.
   - The computer card says "在线" once.
6. **Quality gate:**
   - `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`
   - `pnpm format:check` for changed files
   - tests for:
     - the summary-status mapping, one case per row of the table plus freshness
     - the New Conversation advisory (healthy shows nothing; degraded and unavailable show one sentence)
     - `PageHeader`
   - update tests that asserted the old labels

**Should:**

7. **One disclosure style** (finding 15). Replace the native `<details>` triangles ("会话信息", "查看详细状态", "技术详情") with one disclosure built on the Lucide chevrons used elsewhere. It must be keyboard operable and expose `aria-expanded`.
8. **Aligned AI-tool list** (finding 16). On the computer page, name, version and status sit in fixed columns, so they stay aligned whatever the tool name's length.
9. **This computer comes first** (W0-04, added 2026-11-18).
   - **Today:** someone who uses only this computer sees the account, remote computers and AI-tool health side by side, and must work out what each one means. W0 saw an account that was not signed in, this computer online and two remote computers offline.
   - **Change:**
     - On the devices page, show this computer first, with one line saying it works without an account.
     - Say what the account is for, pairing phones and other computers, where the account appears.
     - Remote computers keep their current information, below this computer.
   - **Limits:** wording and order only. No new data, and no change to pairing or sign-in.

## Known facts

Line numbers refer to `4801ef1`.

- **The four mappings today:**
  - `apps/web/src/components/machines/machine-summary-card.tsx:185-197`: 未登录, 可用, 未安装, 版本不支持, 暂不可用 (note "暂不可用", not "暂时不可用")
  - `apps/web/src/components/machines/machine-providers-section.tsx:211-216`: a success or danger `Badge` showing "可用" or `availabilityLabel`, followed by a native `<details>` "查看详细状态"
  - `apps/web/src/components/doctor/doctor-page.tsx:803-814` (`sessionDiscoveryLabel`): 可用, 此 AI 工具版本不受支持, 暂时不可用, 尚未检查
  - `apps/web/src/components/onboarding/onboarding-model.ts:50-63` (`doctorStateLabel`): 就绪, 需要处理, 受限, 不可用, 离线, 尚未检查
  - **`provider-presentation.ts` already has partial maps:**
    - `availabilityLabels` (`:100-106`)
    - the compatibility `stateLabels` (`:356-362`): 兼容, 兼容 — 新版本, 受限, 需要更新 CodeTether, 不可用
    - descriptions full of internal terms, for example "必需运行契约已通过"
- **What the review saw at one moment.** Codex was "可用" on the computer card and the computer page, but "尚未检查" on Setup and "关于与检查". Claude Code was "版本不支持" on one screen and "需要处理" / "需要更新 CodeTether" on others.
- **The advisory.** `apps/web/src/components/conversations/new-conversation-provider-selection.ts:61` produces the amber box for a healthy Codex: "执行正常 · 上次已知。…这是最近一次观测；新会话的首个明确轮次会重新验证，不会重发任何旧请求。"
- **Frozen recovery rule.** Historical execution health is advisory, never a permanent lock (FROZEN-BOUNDARIES, Phase 6D). This task changes wording and tone only, not which Providers can be chosen.
- **Headers.** Pages hand-roll their `h1`: `text-page` with `mt-5`, `mb-5` or `mb-6`, plus `text-xl` and `text-2xl` in places.
  - At 1440 px, content starts at x = 352 (Inbox), 356 (Devices), 396 (Settings) and 496 (Add Device).
  - `apps/web/src/components/machines/machines-page.tsx:57` titles the page "电脑".
- **Primitives.** `packages/ui` has no tests (assessment backlog). Add tests for what you add there.
- **Screenshots.** The review's screenshots are in `C:\Users\Administrator\AppData\Local\Temp\claude\f1eed4d30b5bb503\60ba83ab-1cea-4a54-a949-667ddf3e701e\scratchpad\ui-review\shots\` on the Windows PC (02-devices, 03-device-local, 07-inbox, 09b-new-conversation-project, 14-onboarding, 15-about, 17-add-device, 19-archived). That folder is temporary; capture your own baseline.
- **W0-04's evidence:** `D:/Projects/Software/agenthub-archive/w0-windows-desktop-audit-report.md`, finding W0-04 (`j11-account-settled.json`, `j1-first-native.png`).
- **Demo data.** The README demo data shows two local projects, two completed Codex conversations and two open Attention items. A paired remote computer, if one is available, shows the offline and last-known states.

## Boundaries

- **Decide yourself:**
  - the internal shape of the presentation module and the status component
  - layout token names and values
  - exact Chinese copy within the table's meaning
  - which fact wins when several apply (state the precedence in the report)
  - test changes and commit splitting
- **Ask the Owner first:**
  - a label that changes the meaning of a row in the table
  - any change to which Providers can be selected
  - any Host or Protocol change; this task is web and `packages/ui` only
  - a page layout that departs from the prototype beyond the header and width rules here
- **Do not:**
  - change the conversation page (D2.5 owns it)
  - change the Composer
  - edit `AGENTS.md` or `docs/`
  - push `main`, merge or tag
  - read or print credentials

Push `feat/d3a-desktop-consistency` to `origin`.

## Report

Write to `<agenthub-archive>/d3a-desktop-consistency-report.md` (`D:/Projects/Software/agenthub-archive/` on Windows, `~/agenthub-archive/` on the Mac), with screenshots in a `d3a-desktop-consistency/` folder next to it:

- **Vocabulary:** the final table (label, tone, condition, precedence), and every surface that now uses it.
- **Headers:** each page with its page type and content x position at 1440 px, before and after.
- **Naming and navigation:** each change.
- **This computer first:** the new order and wording of the devices page (goal 9).
- **Screenshots:** before and after for Devices, computer detail, project, archived, Inbox, Settings › 关于与检查, Setup, Add Device and the New Conversation dialog, in the light theme, plus dark for Devices and the dialog.
- **Gates:** results for each check, with failures quoted verbatim.
- **Commits:** your commits and the pushed remote commit.
- **Status:** anything not done and why, and the completion level reached.

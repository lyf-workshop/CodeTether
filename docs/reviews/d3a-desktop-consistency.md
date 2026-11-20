# Review: `feat/d3a-desktop-consistency` (2026-11-20)

**Branch.** Pushed at `c529b6b`. It starts from `main` at `6fb9dd3`, which includes the UI/UX runtime audit.

- Task prompt: `d3a-desktop-consistency-prompt.md`.
- Report: `D:/Projects/Software/agenthub-archive/d3a-desktop-consistency-report.md`, with 25 screenshots of the Windows desktop app.
- Two commits:
  - `8401573`: one status vocabulary, page headers, terminology
  - `c529b6b`: a fresh provider check wins over an older in-flight read
- 97 files, +1,811 / −1,218 lines. Only web and `packages/ui`: no Host, Protocol, Composer or shared Select change, as the boundaries required.

**Gates (as reported):**

- typecheck, lint, build and test passed: 2,585 passed, 14 skipped, 0 failed
- Prettier passed on all 97 changed paths
- The repository-wide check fails on the line-ending baseline (W0f carried item 5).

**Verdict.** Accepted after one follow-up round. Goals 1–10 are done, and most of the work holds up.

- Every page now uses one status module and one page header.
- No paragraph ends in an orphaned line.
- The disclosures are keyboard operable.

On the Owner's real data, however, the new status vocabulary turns stale and unreachable facts into red "暂时不可用" badges (must-fix 1 and 2). D3a merges after W0e, so it ships after alpha.5 unless both finish together.

## Checked hands-on

- **Setup:** D3a built in Claude Code's review worktree. An isolated Host ran with a copy of the detail pass's data: the Owner's 17 projects and 2 paired remote computers, whose credentials were not copied. The web UI came from Vite, viewed in headless Chromium.
- **Evidence:** `D:/Projects/Software/agenthub-archive/d3a-review-2026-11-20/`.
- **Every page at 1440 and 800 px in light mode** (15 pages), compared with the detail pass on `main` at `13fa6b8`:
  - Last lines of one or two characters dropped from 1–3 per page to none on every page.
  - Overlapping text dropped on 关于与检查 (17 → 0), the archived conversation (12 → 0) and the remote conversation (11 → 1). Those were the old `<details>` triangles.
  - Remaining overlaps on the computer page are ellipsized project paths, which D3b goal 1 covers.
- **The status vocabulary** read the same on Devices, the computer page, 关于与检查 and New Conversation, as intended. The problems below therefore show on every surface at once.
- **Not re-measured:** the header x positions (the report's table), Setup, and the dark theme.

## Must-fix

1. **An old execution failure becomes today's status.**
   - **Seen on the Owner's data.** Claude Code is installed and available (`availability: available`, 2.1.329), and it can be selected in New Conversation. Yet it reads red "暂时不可用" on every surface.
   - **The cause.** Its only execution-health record is a `provider_service_unavailable` failure from **2026-10-22**, with freshness `last_known`. In `provider-presentation.ts`, `health?.state === 'unavailable'` yields "暂时不可用" whatever its freshness or age; only the sign-in case looks at freshness. Before D3a, the same data read "就绪".
   - **Rule (this clarifies the prompt's table).**
     - Only a `current` execution-health observation can make the summary "暂时不可用" or "可用，部分功能受限".
     - A `last_known` failure or degradation does not change the summary. It shows as secondary text with its date (for example "上次运行失败 · 10月22日"), and in the detail views.
     - The summary then follows the current facts: installation, compatibility and service readiness.
   - **Tests:** a `last_known` unavailable and a `last_known` degraded observation with an available installation both give "可用" plus the dated secondary text. A `current` failure still gives "暂时不可用".
2. **A computer that is not connected shows its tools as red "暂时不可用".**
   - For a paired computer CodeTether cannot reach, the Host reports each tool as `availability: unavailable` with unknown health. Each card therefore shows two red badges under the computer's own red status.
   - The note on the same card says "AI 工具显示上次已知的安装状态", which the badges contradict.
   - **Rule.** When the computer is not connected, its tool rows have no red badge.
     - Show the last-known installation in a neutral tone if one is known.
     - Otherwise show the secondary text "电脑未连接" with no badge, as "尚未检查" already does.
     - The computer's status explains why.
3. **After merging W0e: one state for "still checking".**
   - Right after the Host starts, local Codex read red "暂时不可用" on Devices; a few minutes later it read "可用".
   - W0e's round 2 adds "正在检查…" to New Conversation for that interval (W0-30) and reports what the Host returns meanwhile.
   - When D3a merges `main` with W0e in it, that state goes through `provider-presentation.ts` as a neutral "正在检查…" on all five surfaces. A cold start then shows no red anywhere.

## Merging with W0e

W0e merges first; it is the last change before alpha.5. The report predicts five conflicts against W0e's `74969a8`, and W0e's round 2 may add more. When resolving:

- **Doctor page.** Keep W0e's no-project summary ("CodeTether 可以使用" when this computer has a working AI tool) and its offline-computers group. Today D3a's 关于与检查 still reads "设置需要处理", because it branched before that fix.
- **The conversation adapter.** Keep W0e's "等待批准" for a tool waiting on an Approval and its quiet running placeholder, with D3a's wording.
- **The offline computers group** and the two tests: keep both behaviors.
- **Afterwards,** check 关于与检查, a conversation through one Approval, and the sidebar's offline group again, with screenshots.

## Carried items

1. **Resetting Claude's reasoning to "默认"** needs a Host and Protocol change: the update request accepts only a non-empty reasoning value, and leaving it out keeps the current one. New Conversation already offers "默认" before the first choice. Backlog: a small task that allows clearing the saved reasoning.
2. **The accepted vocabulary.** The report's table, with its precedence and the new neutral row "已安装，待确认", is accepted. After the follow-up round, Claude Code records the final table in 10 §3.1.
3. **The layout tokens** `--layout-form-width` and `--layout-page-gutter` replace the onboarding and Inbox tokens. D3b's layout work should build on them.

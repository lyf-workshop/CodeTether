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

**Status.** Accepted on 2026-11-21 at `6f3dc65`, after two follow-up rounds and the merge with W0e. D3a and W0e finished together, so the alpha.5 release merged D3a first, as `eb5d44f` with `6f3dc65`'s tree. It was released in alpha.5 on 2026-11-21 (`release-v0.1.0-alpha.5.md`). See the follow-up sections at the end.

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
   - W0e derives the state in `conversationCreationProviderOptions` (`new-conversation-selection.ts`). Move that derivation unchanged into `provider-presentation.ts`, keep it to this computer as W0e does, and keep W0e's tests. A later Host task replaces the inference with a reported fact (`w0e-windows-fixes.md`, round 2 carried item 1).

## Merging with W0e

W0e merges first; it is the last change before alpha.5. The report predicts five conflicts against W0e's `74969a8`, and W0e's round 2 may add more. When resolving:

- **Doctor page.** Keep W0e's no-project summary ("CodeTether 可以使用" when this computer has a working AI tool) and its offline-computers group. Today D3a's 关于与检查 still reads "设置需要处理", because it branched before that fix.
- **The conversation adapter.** Keep W0e's "等待批准" for a tool waiting on an Approval and its quiet running placeholder, with D3a's wording.
- **The offline computers group** and the two tests: keep both behaviors.
- **Afterwards,** check these again, with screenshots:
  - 关于与检查
  - a conversation through one Approval
  - the sidebar's offline group
  - a cold start: the New Conversation dialog reads "正在检查…" and then shows Codex ready with no amber notice. W0e's round 2 saw "执行正常 · 上次已知。…" in amber on `main`, and D3a replaces that text.
  - the conversation header names the model as the Composer's menu does ("GPT-6.1 Terra", not `gpt-6.1-terra`).

## Carried items

1. **Resetting Claude's reasoning to "默认"** needs a Host and Protocol change: the update request accepts only a non-empty reasoning value, and leaving it out keeps the current one. New Conversation already offers "默认" before the first choice. Backlog: a small task that allows clearing the saved reasoning.
2. **The accepted vocabulary.** The report's table, with its precedence and the new neutral row "已安装，待确认", is accepted. After the follow-up round, Claude Code records the final table in 10 §3.1.
3. **The layout tokens** `--layout-form-width` and `--layout-page-gutter` replace the onboarding and Inbox tokens. D3b's layout work should build on them.

## Follow-up round 1 (2026-11-20, `f1db6cd`)

**What changed.**

- One commit, `f1db6cd`: 12 files, +332 / −43 lines, web only. `origin/main` does not have W0e yet, so the branch did not merge it.
- Evidence: `D:/Projects/Software/agenthub-archive/d3a-followup-2026-11-20/`, before and after screenshots from an isolated native shell.
- **Gates (as reported):** typecheck, lint, build and test passed, 2,591 passed and 14 skipped. Prettier passed on the changed files.

**Code read.**

- **Must-fix 1.**
  - `providerSummary` now uses only a `current` execution-health observation for "暂时不可用", "可用，部分功能受限", the sign-in state and "需要更新此 AI 工具".
  - A `last_known` failure or degradation becomes `executionHistoryLabel`: "上次运行失败 · 10月22日" or "上次运行受限 · …".
- **Must-fix 2.**
  - When the computer is neither local nor online, a tool with a known installation reads the neutral "已安装，待确认", with any dated note. Otherwise it reads "电脑未连接" with no badge.
  - The connection state is passed in from every surface that shows a tool.
- **The note's layout.** `ProviderSummaryBadge` stacks the note under the badge, right-aligned, on every surface.

**Checked hands-on.**

- **Setup:** `f1db6cd` built in Claude Code's review worktree, with the same isolated Host and data as the first review. The web UI came from Vite, viewed in headless Chromium at 1440 px.
- **Evidence:** `d3a-review-2026-11-20/`: `fu-status.txt`, `fu-measure.txt` and the `fu-*` screenshots.
- **Must-fix 1, met.** Local Claude Code reads "可用" with "上次运行失败 · 10月22日" on Devices, the computer page, 关于与检查 and New Conversation. It can be selected in New Conversation.
- **Must-fix 2, met.**
  - Both unreachable computers' tools read "已安装，待确认" in grey. One adds "上次运行失败 · 11月4日".
  - The only red left is each computer's own connection status, "身份验证失败", and two unreachable project folders.
- **关于与检查 still reads "设置需要处理".** That is expected until W0e merges.
- **New: the note moves titles and badges** (must-fix 4).

| Surface                   | Codex (no note)                   | Claude Code (with the note)                                                                                          |
| ------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Computer page, AI tools   | badge's right edge at 1,228.3 px  | badge's right edge at 1,311.0 px: the shared grid column widens to fit the note, and Codex's badge stays at its left |
| 关于与检查, AI tool cards | title at y 871.3 px               | title at y 880.1 px: the header row centres on the taller stack                                                      |
| New Conversation          | 80 px card, badge beside the name | 104 px card, badge on a line of its own, right-aligned under the name                                                |

## Must-fix 4, with must-fix 3

**The dated note must not move a title or a badge.**

- **New Conversation:** the badge stays beside the name, as for Codex. The note goes on its own muted line under the capability text, left-aligned. Both options are the same height.
- **Card headers on 关于与检查:** the title and badge stay on one line, at the same y in every card. The note goes on the line below.
- **Rows on the computer page and Devices:** every badge is right-aligned in its column, and the note sits under its badge.
- Give `ProviderSummaryBadge` the two placements it needs. Do not give each page its own version.
- **Check:** measure the three surfaces above. Titles agree within 1 px, badges' right edges agree within 1 px, and the two New Conversation options are the same height. Add before and after screenshots.

This does not depend on W0e. Do it now with must-fix 3's preparation, then merge `main` when W0e lands.

## Follow-up round 2 and the merge with W0e (2026-11-21, `6f3dc65`)

**What changed.**

- `cdcd287`: must-fix 4. `ProviderSummaryBadge` has two placements:
  - **row:** the badge is right-aligned, with the note below it
  - **inline:** the badge sits beside the tool's name, with the note on its own left-aligned line
- `6f3dc65` merges `origin/main` at W0e's `6553480`:
  - It resolves eight conflicted files.
  - It moves W0e's "正在检查…" derivation unchanged into `providerSummary` (must-fix 3).
- Report: the same file, extended. Evidence:
  - `d3a-followup-round2-2026-11-20/`: native Windows screenshots and measurements
  - `d3a-post-w0e-2026-11-20/`: the checks after the merge, some from labelled fixtures
- **Gates (as reported) on the merged tree:**
  - typecheck, lint, build and test passed: 2,634 passed, 14 skipped
  - desktop `cargo test`: 93 tests
  - Prettier on the changed files

**Merge checked.**

- `6553480` is W0e's two-parent merge (`6fb9dd3`, `dc9cfe2`). Its tree equals the clean `git merge-tree` result, and no tag was added.
- In `6f3dc65`, W0e's Host, Protocol, desktop, Composer and Select files equal `main`'s.
- The 关于与检查 summary "CodeTether 可以使用" and "等待批准" are kept.
- The "正在检查…" condition reads exactly as W0e's, now with the computer's kind as a parameter. It applies to Devices, the computer page, Setup, 关于与检查 and New Conversation.

**Checked hands-on.**

- **Setup:** `6f3dc65` built in Claude Code's review worktree, with the same isolated Host and data as the first review. Viewed in headless Chromium at 1440 px.
- **Evidence:** `d3a-review-2026-11-20/`:
  - `cold-devices.txt`, `cold-computer.txt`, `cold-about.txt`, `cold-dialog.txt`
  - `r2-measure.txt`, `r2-warm.txt`
  - the `cold-*` and `warm-*` screenshots
- **Cold start on four surfaces,** one cold Host start each, read every 250 ms:
  - Devices, the computer page and New Conversation:
    - Both local tools read "正在检查…", then "可用", after 7.3–7.8 s.
    - "暂时不可用" never showed, and no badge was red apart from two unreachable project folders.
    - In the dialog, Codex was selectable as soon as it read "可用".
  - 关于与检查 showed the same sequence. Its one "暂时不可用" is a plain detail row ("运行环境") of an unreachable computer, under that card's note that the details are last known.
- **Must-fix 4, met:**

| Surface          | Codex                             | Claude Code (with the note) |
| ---------------- | --------------------------------- | --------------------------- |
| Computer page    | badge's right edge at 1,311.0 px  | 1,311.0 px                  |
| 关于与检查       | title at y 871.3 px               | 871.3 px                    |
| New Conversation | 82 px option, badge at y 488.1 px | 82 px, 488.1 px             |

- **The ready dialog** shows no amber notice. W0e's round 2 had seen "执行正常 · 上次已知。…" there.
- **A Codex Turn through one Approval,** live, in the scratch project:
  - The tool row and the dock read "等待批准" while the request was pending.
  - "允许一次" let the Turn complete, in 43 s.
- **The conversation header** reads "Codex GPT-6.1 Terra", as the Composer's menu does.
- **关于与检查 with no project** reads "CodeTether 可以使用 · 这台电脑至少有一个 AI 工具可用。选择项目后即可开始工作。"
- **The sidebar.** The two paired computers report `authentication_failed`, so they stay in the list, which is correct. W0e's offline group holds only `offline` computers; the agent showed it with a labelled fixture.

**Verdict.** Accepted. D3a merges into `main` and ships in alpha.5. The release prompt merges it first and checks that the merge's tree equals `6f3dc65`'s.

**Carried items.**

1. **A badge that contradicts its rows.**
   - On 关于与检查, the Raspberry Pi's Codex reads "已安装，待确认", while its 版本 and 运行环境 rows read "未安装".
   - The Host's last-known facts hold one installation (0.161.0) that is unusable and not selected, and no version on the tool.
   - This goes to D3b (`d3b-desktop-usability-prompt.md`, goal 10).
2. **The vocabulary** is recorded in 10 §3.1 with this review.
3. **"正在检查…" stays inferred** until the Host reports it. The task is in the plan's backlog with the reasoning reset (carried item 1 above).

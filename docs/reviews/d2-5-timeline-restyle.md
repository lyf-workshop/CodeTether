# Review: `feat/d2-5-timeline` (2026-11-19)

**Branch.** Pushed at `1fdee65`. It starts from `49dcd89`, which is `main` after B3a and the W0-11 fix. Task prompt: `d2-5-timeline-restyle-prompt.md`. Report: `D:/Projects/Software/agenthub-archive/d2-5-timeline-report.md`, with 32 before-and-after screenshot pairs in `d2-5-timeline/`.

- `b067d97` adds highlighted fenced code and readable diffs to `packages/ui`.
- `1fdee65` restyles the Turns and the inspector in `apps/web`.
- 39 files, all in `apps/web` and `packages/ui`. No Host, Protocol or adapter change.

**Gates (as reported):**

- typecheck, lint and build passed
- `pnpm test`: 2,533 passed, 14 skipped, 0 failed
- Prettier and `git diff --check` passed on the changed files
- The first attempts had three type errors, two lint errors and two tests that asserted the old layout. The report quotes them, and all are fixed.

**Verdict.** Accepted, no must-fix. As planned, it merged into `main` after the alpha.4 tag: `9932e70` on 2026-11-19. It was released in alpha.5 on 2026-11-21 (`release-v0.1.0-alpha.5.md`).

## Checked in this review

- **Baseline (goal 1).**
  - Eight states, each in light and dark themes at 1440 and 1100 px.
  - They come from real Codex and Claude Code runs on a scratch Git project, with an isolated Host. The installed app and its Host on `4317` were not used.
  - The baseline found three problems the UI review could not see, and the task fixed all three:
    - At 1100 px with the inspector open, a long Approval Turn overflowed its scroll area, and 94 px of the cards were cut off.
    - In a Turn waiting for Approval, an earlier message read "已完成" while its tool read "等待批准".
    - For Claude Code, the inspector opened on the duplicate file panel and its empty explanation.
- **Tool rows (goal 2, W0-13).**
  - **Collapsed rows** show the kind and the subject, for example:
    - "执行命令 Get-Content -LiteralPath ./README.md 等 2 条", with the PowerShell wrapper removed
    - "读取 README.md"
    - "搜索 MATCH in ."
  - **The right side** shows status and duration, never output.
    - Duration comes from the Tool's observed start and completion events.
    - Exit codes and search result counts are left out, because the normalized events carry no trusted field for them.
  - **Expanding.** Every row is a button with `aria-expanded`, and Enter and Space work. A failed row starts expanded, with its failure label, the full command and its output.
  - **J13's sample, re-run for real:** a failing `node --test` with TAP output ("命令执行失败"), next to a `Get-Content` of a missing file ("找不到路径"). Both rows show their own command, status and output on one screen.
  - The action button that had no handler is gone.
  - **Grouping.** The rule is unchanged.
    - A group of one kind gets its own title, "读取 3 个文件" or "检查 N 次 Git 状态". A mixed group keeps "已完成 N 个操作".
    - Expanding a group of real Claude Code reads shows every original row.
- **Diffs (goal 3, W0-14).**
  - Monospace, with whitespace kept.
  - Added and removed rows are tinted in both themes, with the existing `success-muted` and `danger-muted` tokens.
  - At 1100 px a long-line diff scrolls sideways: a 378 px viewport over 1,290 px of content.
  - The edit row in the timeline shows the path and "改动 N 行", counted from the real diff.
- **One header per Turn (goal 4, W0-15).**
  - The header's status and time come from the Turn. A message can no longer say "已完成" while its Turn waits.
  - All 32 browser checks found exactly one header per Turn.
  - Native read-only history keeps its record layout.
- **Messages and code (goal 5).**
  - The reading width is 800 px.
  - **Fenced code** uses the shared `CodeBlock`:
    - a language label and line numbers
    - Copy, shown on hover and on keyboard focus
    - no wrapping
    - blocks over 30 lines show the first 10 and last 5 lines, with "展开 N 行"
    - the Should is done: the expanded state is kept in `localStorage` per message and block, wrapped in try/catch
  - **Highlighting** uses `refractor` 5.0.0, pinned. Each of the ten languages loads on first use.
    - Its syntax tree becomes plain text tokens with six fixed tones, which React renders.
    - No HTML string reaches the DOM, so the frozen Markdown boundary holds.
    - If a grammar fails to load, the plain text stays.
- **Inspector (goal 6, W0-16).**
  - For Codex on this computer there is one "变更" tab; the "文件" tab is gone.
  - For Claude Code, "已查看文件" lists the paths from its read and search events, and is absent when there are none.
  - The panel opens on the first tab with content, and zero counts are not shown.
- **Tokens (goal 7).** The only hex values added are token definitions for both themes in `packages/ui/src/styles/globals.css`. Components use token classes. The report maps each hex value from 10 §3.4 to its token.
- **Location once (goal 8).**
  - The breadcrumb keeps device › project.
  - The title area keeps Provider, model and reasoning.
  - The line under the Composer is gone, and the Composer's controls are unchanged.
- **Should items.**
  - Done: the sticky, translucent title bar, and the two-second Turn highlight, which is static under reduced motion.
  - **Bundle:** the conversation route grows by 4,406 B gzip, against a limit of about 60 kB. The highlighter's lazy chunks total 24,187 B gzip.
- **Merging.** `git merge-tree` shows that the branch merges cleanly with `fix/w0-small-fixes` at `27c759a`.

## Carried items (not blocking)

1. **The installed window.** The checks ran in Edge against an isolated production Host, not in the Tauri window. Acceptance of the release after alpha.4 checks the timeline in the installed app.
2. **Output after a reload.**
   - While the browser watches a Turn, it keeps up to 4 KiB of output per Tool.
   - After a reload, the Host's snapshot holds output for one Tool only, in its bounded terminal. Earlier rows show the Host's short output summary instead.
   - Keeping an output tail for every Tool would be a Host change. Decide it in a later Host task if it matters in daily use.
3. **The "工具输出" panel** still shows the raw invocation, including the bundled PowerShell path. The timeline now shows the unwrapped command, so this is cosmetic.
4. **Small layout points in the screenshots:**
   - At 1100 px, the Approval-linked row in the timeline truncates its text to a few characters.
   - With one changed file, "变更" shows the same +/− counts twice, as the total and on the file.
5. **Expanded code-block keys** in `localStorage` are removed when the block is collapsed, but never pruned otherwise. Each is a few bytes.

## Next

Merge into `main` with a merge commit after the `v0.1.0-alpha.4` tag. First merge `main` into the branch if it does not merge cleanly, and run the gates on the result. Pushing `main` needs the Owner's approval. It ships in the next alpha.

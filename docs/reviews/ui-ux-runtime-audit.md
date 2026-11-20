# Review: `fix/ui-ux-runtime-audit` (2026-11-20)

**Origin.** The Owner ran a UI/UX runtime audit with a coding agent, outside the task prompts in `docs/reviews/`. This review is its record.

**Branch.**

- Local branch `fix/ui-ux-runtime-audit`, worktree `D:/Projects/Software/agenthub-work/fix-ui-ux-runtime-audit`. It starts from `main` at `745c701` (W0f merged) and is **not pushed yet**.
- Commits: `5b5b211` (Android) and `54d2c7b` (web).
- 23 files, +290 / −181 lines.

**Report and evidence.**

- The report and evidence are in `D:/Projects/Software/agenthub/output/ui-ux-audit/`. That folder is in the main checkout and ignored by git, so a clean would delete it.
  - the report: `README.md`
  - the issue list: `issues.md`
  - page coverage: `coverage.md`
  - gate results: `verification/README.md`
  - 231 screenshots and 3 recordings
- **Gates (as reported):**
  - `pnpm typecheck`, `lint`, `build` and `test` passed: 2,564 passed, 14 skipped, 0 failed.
  - The four Android Gradle gates passed.
  - Prettier passed on the changed files.

**Verdict.** Accepted, no must-fix. Each of the 10 fixes was reproduced before the fix and checked again after it. Merge this branch before W0e's follow-up round.

## The fixes

| ID  | Severity | Fix                                                                                                                                                   | Overlap                                                                                                                        |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| W05 | P1       | A draft edited less than 500 ms before a refresh was lost. Pending drafts now save on `pagehide` and when the page is hidden; typing stays debounced. | New                                                                                                                            |
| A01 | P2       | Android sign-in lost the typed email on rotation; it now uses `rememberSaveable`                                                                      | New; a one-line fix in the existing app. The M series stays postponed.                                                         |
| W01 | P2       | Reopening the command palette with Ctrl+K kept the old query; focus now returns to the button that opened it (30 of 30 times)                         | New                                                                                                                            |
| W06 | P2       | The add-device and pairing pages rendered a second `<main>`                                                                                           | New                                                                                                                            |
| W07 | P2       | An empty project suggested adjusting filters that were not set; the archived view kept the "运行中" filter                                            | D3b goal 3, "Empty state": done                                                                                                |
| W02 | P2       | At 640 px the appearance theme cards were about 27 px wide; settings now lay out by their container's width                                           | New                                                                                                                            |
| W03 | P2       | The devices page kept two columns at 800 px                                                                                                           | D3b goal 8 (detail-pass finding 9): done                                                                                       |
| W08 | P2       | A long conversation title squeezed the computer and project names in the top bar to 0 px                                                              | D3b goal 8, top-bar breadcrumb: done. The New Conversation dialog part remains.                                                |
| W04 | P3       | The devices page was titled "电脑"; a computer card showed its status twice                                                                           | D3a goal 5, the page title and "在线" once: done. Check the remote card's subtitle (detail-pass finding 12) before redoing it. |
| W09 | P3       | Radix warned that a Select switched from uncontrolled to controlled when the current model was not listed                                             | New; it is the same Select as W0e must-fix 1                                                                                   |

## Checked in this review

- **The diff, read in full.**
  - Container queries replace viewport breakpoints on the settings and devices pages. Most of the settings page diff is indentation from wrapping it in a container.
  - The command palette clears its query whenever it renders closed, and the shell restores focus.
  - Drafts save when the page hides or unloads.
  - The project page drops a status filter that the current view cannot show.
- **Merges.** `git merge-tree` with W0e (`79d67eb`) is clean.
- **Screenshots.** Checked before and after for the devices page at 800 px and the top bar at 820 px.
- **Not repeated here:** the gates and the Android build.

## Notes

1. **The branch had no task prompt.** The Owner pasting its report counts as the authorization, and this review is the record.
   - D3a and D3b now mark the overlapping items as done, so their agents verify them instead of redoing them.
   - An audit like this overlaps less if Claude Code hears about it before it starts.
2. **Push the branch before merging.** It exists only locally.
3. **Move the evidence** to `D:/Projects/Software/agenthub-archive/ui-ux-audit-2026-11-20/`, where the other review evidence lives.

## Carried items

1. **Large bundle chunks.** The production build warns about JavaScript chunks over 500 kB. The audit suggests measuring cold start and the timeline's first frame on the release build before splitting them. Backlog.
2. **Not covered by the audit:**
   - the native tray and notifications
   - real email
   - pairing across devices

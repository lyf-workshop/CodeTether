# Task: W0b, Finish the Windows Desktop Audit (Coding, Approvals, Changes)

**Where it runs.** On Windows, in the installed `0.1.0-alpha.3` desktop, with the Owner available for Approvals, notifications and sign-in. It starts only after the Owner has finished Owner action 9 in `2026-11-13-assessment-and-plan.md`: Codex's default model is now one this account can use.

**Branch and worktree.** Same as W0: no branch, no commits, no code changes. Read code in the detached worktree `D:/Projects/Software/agenthub-work/release-v0.1.0-alpha.3` (`0bf8cba`) without modifying it. Put scratch projects and tooling under `E:/Projects/Software/agenthub/w0b-audit/`.

**Why this task exists.** W0 (report of 2026-11-18) could not test the core loop. Every Codex Turn failed because the Owner's Codex configuration chose a model this account cannot use (W0-01). Writing code, Approvals, reviewing changes, a failing command, retry, and native import were never seen working. W0 also compared CodeTether with the CLI only on failures. This task runs those jobs now that Codex works, so the Windows plan is based on real use.

**References** (read with `git show origin/ux/design:<path>`):

- `docs/reviews/w0-windows-desktop-audit-prompt.md`: its method, evidence rules, jobs J1–J13, measurement rules and finding fields apply here unless this prompt says otherwise
- `D:/Projects/Software/agenthub-archive/w0-windows-desktop-audit-report.md` and its evidence folder: what W0 already established. Do not repeat checks it marked as passing.
- `docs/reviews/2026-11-17-windows-completion-scope.md` §2 group A
- `docs/reviews/2026-11-13-desktop-ui-review.md`

Before starting, confirm this file has 4 second-level headings and that the last one is "Report".

## Goals

**Must:**

1. **Start safely,** as in W0 goal 1: build `git-0bf8cbae7101`, a database backup after a normal Quit, and the starting counts.
   - Confirm the new default with one read-only Codex CLI Turn in a scratch folder: it must complete.
   - Record which model a new desktop conversation stores, without printing configuration contents.
2. **Use new scratch conversations only.** W0's three scratch conversations stored the unusable model, and alpha.3 cannot change a conversation's model. Leave them archived.
3. **Do the jobs W0 could not complete,** with real small coding tasks, recording steps, keys or clicks, time, and what worked:
   - **J3 Codex run:** a task that edits at least three files and runs a test. Can you tell what the agent is doing at each moment?
   - **J4 Approvals:** a Turn that asks for permission, for example a command outside the workspace sandbox. Approve one request and deny another. Handle one from the Inbox, and one from a Windows notification while the window is in the tray.
   - **J5 Change review:** Changes and Files after J3, compared with `git diff`. What is missing for deciding whether to keep the work?
   - **J6 Steer:** a follow-up, an interrupt during a running Turn, and the explicit retry where the failure allows it.
   - **J7 Continue and import:** quit and relaunch, then continue a successful conversation. Import a successful native Codex CLI session from "以前的会话", then continue it.
   - **J8 Parallel:** two successful Turns in two projects at once. Where does the app show what needs you?
   - **J13 Failing command:** a Turn whose test command fails. How does the app show the failure and its output?
   - J10 Claude Code is **not** part of this task. alpha.3 still blocks it (W0-03); it is checked after the fix ships.
4. **Measure** what W0 could not, with the median of 3 each:
   - first send to your own message visible, to the first work record, and to the Turn finishing
   - a follow-up send to your own message visible
   - an Approval click to the Turn continuing

   Time from the window, as W0 did. Breaking the time down by internal stage is task 6's job, not this one.

5. **Compare with the Codex CLI** on W0's TA and TB tasks: fresh copies of the same scratch repository, the same prompt, and W0 goal 5's method. Record which one finished, how long it took, how many times you intervened, and whether the result passes its tests.
6. **Re-check the UI-review findings W0 marked as "not re-checked"** because nothing ran: 1, 2, 12 and 13, plus the Approval dock, Allow and Deny, and the Approval notification.
7. **Write findings,** continuing W0's numbering from W0-11, with W0's fields and severity levels.
   - If a W0 finding (W0-01 to W0-10) looks different now that Codex works, update it in a "W0 changes" table instead of filing it again.
   - Give a revised verdict: would you use CodeTether instead of the CLI for daily work on Windows, and what stops you?
8. **Leave things as you found them,** as in W0 goal 8. Archive your scratch conversations; leave the scratch projects registered.

**Should:**

9. **Keyboard only** (W0 goal 10), which W0 could not finish without Approvals: new conversation, send, approve, open Changes, switch conversations.
10. **First run as a new user** (W0 goal 9), which stopped at the first screen. With the Owner present, sign in to the clean profile with a one-time code the Owner enters, then do J2 and J3 there. In particular, can a new user find how to sign in from the first screen?

Budget: at most 20 Codex Turns, all small. Going over needs the Owner's approval.

## Known facts

- **The model.** Codex reads its default model from the Owner's Codex configuration. On 2026-11-18 W0 reproduced `model_not_found` for that model on both the CLI and the App Server, and a one-off Turn with another model succeeded. alpha.3 creates a conversation without a model and stores the one the App Server returns, then sends that stored model with every Turn.
- **What W0 already settled.** Start, tray, window behavior, theme following the system, adding projects, search, archive and restore, Host loss, and folder rename were exercised in W0. Do not repeat them, unless a job above needs them as a step.
- **Fixes that are not installed.** `fix/w0-local-execution` adds a clear message for a rejected model and admits Claude Code `2.1.327` on Windows. It is not in the installed build. Findings are about alpha.3 as installed.
- **Host and port.** The installed Desktop owns the only Host on `127.0.0.1:4317`. Do not run a development Host while the installed one is running.

## Boundaries

- **Decide yourself:**
  - the scratch projects, tasks and the order of the jobs
  - quitting from the tray and relaunching the installed desktop, as W0 allowed
  - Codex Turns in scratch projects within the budget
- **Ask the Owner first:**
  - anything in the Owner's own projects or conversations beyond looking
  - signing in or out, including in the clean profile
  - changing the Codex configuration or any system setting
  - going over the Turn budget
- **Do not:**
  - change code, commit, push, tag or merge
  - edit `AGENTS.md` or `docs/`
  - install a development build or replace the installed app
  - delete anything that belongs to the Owner
  - read or print credentials, session tokens, configuration contents or full identifiers
  - copy the Owner's code or prompts into the report text

## Report

Write to `D:/Projects/Software/agenthub-archive/w0b-windows-desktop-audit-report.md`, with evidence in `D:/Projects/Software/agenthub-archive/w0b-windows-desktop-audit/`.

- **Verdict:** the revised verdict from goal 7, and the top 10 changes for daily use, re-ranked with W0's list.
- **Scorecard:** one row each for J3–J8 and J13 (works / works with friction / broken / missing), with time and clicks.
- **Measurements:** goal 4, with raw numbers.
- **CLI comparison:** TA and TB side by side.
- **Findings:** W0-11 onward, with W0's fields. The cause is `file:line` at `0bf8cba` when traced.
- **W0 changes:** any W0 finding that now looks different.
- **UI-review re-check:** goal 6.
- **Should items:** keyboard-only and first-run results, or why they were not done.
- **End state:** the backup, counts compared with the start, the build, and Host health.
- **Status:** what was not done and why, and the completion level.

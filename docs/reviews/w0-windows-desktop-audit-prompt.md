# Task: Windows Desktop Hands-On Audit (W0)

**Where it runs.** On Windows, in the installed CodeTether desktop (the alpha.3 build with the update source), with real Codex and Claude Code runs. The Owner is nearby for steps that need a person.

**Branch and worktree.** No branch, no commits, no code changes. To read code, use the clean detached worktree at the tag, `D:/Projects/Software/agenthub-work/release-v0.1.0-alpha.3` (commit `0bf8cba`), without modifying it. Put scratch projects and audit tooling under `E:/Projects/Software/agenthub/w0-audit/`, because D: is short of space.

**Why this task exists.**

- The Owner has put the Windows desktop first: it should be useful, easy and convenient for daily work before other platforms get more effort (AD-13 in `2026-11-13-assessment-and-plan.md`).
- The 2026-11-13 UI review ran the web UI in a browser with demo data. It never saw running Turns, Approvals, failures, account pages or the real Tauri window, and it never did real work end to end.
- This task uses the real app for real jobs, measures it, compares it with using the CLIs directly, and returns a ranked list of what most hurts daily use. Claude Code turns that list into the next desktop tasks.

**References** (read with `git show origin/ux/design:<path>`):

- `docs/PRODUCT.md`: what the desktop promises, including the Windows lifecycle (tray, notifications, Quit, session end)
- `docs/reviews/2026-11-13-desktop-ui-review.md`: the earlier review and its 18 findings
- The prompts already written for the desktop, to map findings to them:
  - `docs/reviews/d2-model-control-integration-prompt.md` (task 5)
  - `docs/reviews/b3a-send-speed-prompt.md`
  - `docs/reviews/d2-5-timeline-restyle-prompt.md`
  - `docs/reviews/d3a-desktop-consistency-prompt.md`
  - `docs/reviews/d3b-desktop-usability-prompt.md`
  - `docs/reviews/x1a-context-usage-prompt.md`, `x1b-image-attachments-prompt.md`, `x1c-voice-input-prompt.md`
- `docs/ux-redesign/10-desktop-improvements.md` and the prototype screens in `docs/ux-redesign/png/`
- `docs/reviews/windows-install-update-prompt.md`: the backup and health-check procedure

Before starting, confirm this file has 4 second-level headings and that the last one is "Report".

## Goals

**Must:**

1. **Start safely.**
   - Confirm the installed desktop reports build `git-0bf8cbae7101` and its executable's SHA-256 starts with `51415988`. If not, stop and tell the Owner.
   - Back up the database with checksums, following the install procedure's backup step.
   - Record the starting state: whether Account is signed in, what Devices shows, the number of projects and conversations, the last 10 minutes of the presence log (`LocalAppData/CodeTether/logs/host-presence.jsonl`), and free space on D: and E:.
2. **Drive the real window and capture evidence.** Every finding needs a screenshot, a log line or a timing. Capture at the window size the Owner normally uses, plus 1100×760.
3. **Do these jobs with real work**, in scratch projects only. For each job, record the steps, the clicks or keys, the time taken, and what worked and what didn't.
   - **J1 Start.** Cold start from Quit, and reopening from the tray. What does the first screen tell you, and is the next action obvious?
   - **J2 Add a project.** Use the native folder picker, once for a git repository and once for a plain folder. Also try adding the same folder twice, and check how paths are shown.
   - **J3 Run a Codex conversation.** Create it, choose what the app lets you choose, and send a real small coding task. Follow it to completion. Can you tell what the agent is doing at each moment?
   - **J4 Approve.** Use a permission mode that asks. Approve one request and deny another. Handle one from the Inbox, and one from a Windows notification while the window is hidden in the tray.
   - **J5 Review changes.** Use Changes and Files after a Turn that edited several files. Can you tell what changed and why? Compare with `git diff`. What do you need that isn't there?
   - **J6 Steer.** Send a follow-up, interrupt a running Turn, and retry a failed one.
   - **J7 Continue later.** Quit and relaunch, then continue the same conversation. Import an earlier native Codex session from "以前的会话"; create one first with the Codex CLI in a scratch folder.
   - **J8 Parallel work.** Run two conversations in two projects at once. Where does the app show what needs you (sidebar, Inbox, tray, notifications)? How long does switching between them take?
   - **J9 Find and tidy.** Use Search, the command palette, archive and restore, and the Inbox filters.
   - **J10 Claude Code.** Run one conversation. Is it clear, before the user hits a wall, what it can't do (no edits, no shell, no Approvals)?
   - **J11 Settings and health.** Check Setup, Doctor and AI-tool status, "关于与检查" with "check for updates", and Account. Look at Devices from the point of view of someone who uses only this computer.
   - **J12 Window and Windows.** Test:
     - the close button and its first-time explanation
     - tray Open and Quit
     - launching a second time
     - minimize, maximize, snap, and resizing to the minimum size
     - light and dark theme following the system
     - clicking a notification
     - the display scale the Owner uses now
   - **J13 Failure.** Test:
     - killing the owned Host process once
     - a Turn whose command fails
     - renaming a scratch project's folder while the app is running, then renaming it back

   Budget: at most 25 Codex Turns and 6 Claude Code Turns, all with small tasks.

4. **Measure.** Repeat each timed item 3 times and report the median:
   - cold start to the first usable screen
   - tray Open to a visible window
   - sending:
     - from Enter until your message shows
     - until the first agent activity
     - until the Turn completes
     - for a first message and for a follow-up
   - an Approval, from appearing in the app to the agent continuing
   - opening the longest scratch conversation (at least 15 Turns), and how smoothly it scrolls
   - memory and CPU of the Desktop, the Host, WebView2 and the Provider processes:
     - idle for 5 minutes
     - during a Turn
     - after the Turn budget is used
5. **Compare with the CLIs.** Do two reference tasks, once in CodeTether and once in the Codex CLI in Windows Terminal, each time on a fresh copy of the same scratch repository:
   - **TA:** add a small feature with a test.
   - **TB:** find and fix a failing test.

   Compare:
   - the steps and the time
   - how you learn what the agent did
   - how you review the changes
   - Approvals and interrupting
   - coming back later

   Conclude what CodeTether adds, what it loses, and where it is slower.

6. **Re-check the 18 findings** of the 2026-11-13 review in the real window. For each, say whether it is still present, fixed, or different. Also describe the states that review could not see: running Turns, the Approval dock, failure cards, account pages and the Tauri window.
7. **Write findings and a verdict** as the Report section describes.
8. **Leave things as you found them.**
   - Archive the scratch conversations.
   - Relaunch the desktop normally, without any debugging port.
   - Confirm health:
     - bootstrap returns 200
     - the build ID is correct
     - the Host owns `127.0.0.1:4317`
     - presence returns 2xx within 2 minutes
   - Confirm that the Owner's own projects and conversations are unchanged, by count and by comparison with the backup.

**Should:**

9. **First run as a new user.**
   - Quit the desktop. Launch it with `CODETETHER_DATA_DIR` set to an empty folder and `WEBVIEW2_USER_DATA_FOLDER` set to another empty folder, both in the evidence folder.
   - Before anything else, open Account and confirm it shows signed out. If it shows the Owner's account or any device, or if the presence log shows it publishing as the existing computer, quit at once and record that.
   - Do not sign in. Walk J1–J3 from nothing.
   - If the app cannot be used without signing in, stop that part and record it as a finding.
   - Quit, relaunch normally, and confirm the real data is back.
10. **Keyboard only.** Do the core loop by keyboard alone: new conversation, send, approve, open Changes, and switch conversations. Note where focus is lost or invisible.
11. **Readability over a long session.** Note what tires the eye or wastes space after an hour of use: density, contrast in both themes, and repeated chrome.

## Known facts

- **The installed build.**
  - alpha.3 with the update source, build ID `git-0bf8cbae7101`, installed on 2026-11-16 (`alpha3-update-source-windows-report.md`).
  - The Desktop executable's SHA-256 is `51415988b4e4e9ba…`. The installer is `E:/Projects/Software/agenthub/release-alpha3-windows-build/CodeTether_0.1.0-alpha.3_x64-setup.exe`. The rollback installer is in `D:/Projects/Software/agenthub-archive/alpha3-update-source-windows/`.
  - The data is in `C:/Users/Administrator/AppData/Local/CodeTether/`.
  - "Check for updates" shows "暂时无法检查更新，请稍后再试" until the Owner uploads `latest.json`. That is known; report it only if it changes.
- **Known gaps, already planned.**
  - The model button is a placeholder (task 5).
  - "剩余上下文", "附件" and "语音" are placeholders (X1a–X1c).
  - Every send re-checks the AI tool (B3a).

  Record how these affect each job, but list them as "covered", not as new findings.

- **Features outside the current scope.** Examples include conversation delete, drag-and-drop folders, Open in Explorer, recent folders, start with Windows, and a close-behavior setting (AGENTS.md "Out of Scope"). If a missing capability hurts a job, report it as kind "missing", naming the job. Whether to build it is the Owner's decision.
- **The Windows lifecycle.** Per PRODUCT.md:
  - X and Alt+F4 hide the window to the tray.
  - The tray has Open and Quit only.
  - Quit gives the Host up to 12 seconds to drain.
  - Notifications cover Approvals, completed reviews and failures. They are suppressed when the window already shows that conversation, contain no titles, and never approve anything.
  - Windows Focus Assist can hide notifications. If none appear, check it and ask the Owner.
- **Claude Code** runs a restricted profile: Read, Glob and Grep only, with no Edit, no shell and no Approvals.
- **Driving the window.**
  - The desktop is a single instance with one Host on `127.0.0.1:4317`. Any relaunch with different settings needs a Quit from the tray first.
  - WebView2 reads `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`. Launching the installed `codetether-desktop.exe` with `--remote-debugging-port=<free port>` set for that process only should let Playwright attach with `connectOverCDP`. Confirm the port opens. If it does not, use Windows UI Automation, the keyboard and screenshots.
  - The folder picker, tray, notifications and window frame are outside the WebView. Use UI Automation or the keyboard, or ask the Owner to do the step while you time and capture it.
  - `CODETETHER_DATA_DIR` is read by the Host (`apps/host/src/persistence/data-directory.ts`) and by the desktop (`apps/desktop/src-tauri/src/system_tray.rs:180`).
  - WebView2 keeps its own profile, including the account session in `localStorage`, separate from that folder.
- **A recent account incident.**
  - From 2026-11-16 07:12 to at least 2026-11-17 10:56 UTC, the Control Plane rejected the desktop's presence (4xx). During that time Devices showed "暂时无法读取设备" and pairing codes failed.
  - It recovered after a re-login around 13:00 UTC on 2026-11-17.
  - Task 1b analyses the cause. Here, just record what Account and Devices show, and whether the app would let a user notice such a state.
- **Other work.**
  - Task 1b (the phone) is paused and must not be touching the desktop.
  - Task 5 may be running on the Mac. It does not use this computer's installed app.

## Boundaries

- **Decide yourself:**
  - how to drive the window, and installing audit tooling such as Playwright into `E:/Projects/Software/agenthub/w0-audit/`
  - the scratch projects, their content, and the order of the jobs
  - quitting from the tray and relaunching the installed desktop as often as the audit needs, including with the debugging port or the clean profile. This prompt is the Owner's approval. Avoid quitting during a Turn unless that is the test.
  - killing the owned Host process once, for J13
  - Codex and Claude Code Turns in scratch projects, within the budget
- **Ask the Owner first:**
  - anything in the Owner's own projects or conversations beyond looking: sending, archiving, renaming, importing
  - signing out or in
  - changing system settings: display scale, Focus Assist, network, sleep
  - going over the Turn budget
  - pairing or removing devices
- **Do not:**
  - change code, commit, push, tag or merge
  - edit `AGENTS.md` or `docs/`
  - uninstall or reinstall the app, or restore the backup over the current data
  - delete anything that belongs to the Owner
  - read or print credentials, session tokens or full identifiers
  - copy the Owner's code or prompts into the report text. Screenshots of their projects may stay in the local evidence folder.

## Report

Write to `D:/Projects/Software/agenthub-archive/w0-windows-desktop-audit-report.md`, with screenshots, logs and timings in `D:/Projects/Software/agenthub-archive/w0-windows-desktop-audit/`.

- **Verdict:**
  - one short paragraph each on whether the app is useful, easy to use and convenient, with evidence
  - whether you would use it instead of the CLI for daily work, and why
  - **the top 10 changes**, ranked by how much each would improve daily use on Windows
- **Scorecard:** one row per job (J1–J13): works / works with friction / broken / missing, with time and clicks.
- **Measurements:** the table from goal 4.
- **CLI comparison:** goal 5.
- **Findings.**
  - Fields for each finding:
    - **ID:** `W0-nn`
    - **severity**
    - **kind:** bug / friction / missing / copy / visual
    - **job**
    - **what you did**
    - **expected**
    - **what happened**
    - **evidence**
    - **cause:** if traced, as `file:line` at `0bf8cba`
    - **suggested direction:** no code
    - **covered by:** an existing prompt and item; or "new"; or "covered, but the prompt needs changing", saying how
  - Severity levels:
    - **Blocker:** stops a core job or loses work.
    - **High:** the job works, but is slow, confusing or untrustworthy enough that a user would go back to the CLI.
    - **Medium:** clear friction or inconsistency.
    - **Low:** polish.
- **UI review re-check:** goal 6, one row per finding.
- **First run:** goal 9, if done.
- **End state:** the backup location, the scratch conversations archived, the desktop relaunched normally, the health results, and the Owner's data intact.
- **Status:** anything not done and why, and the completion level reached.

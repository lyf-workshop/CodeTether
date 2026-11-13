# Task. Mac installed-build acceptance (v4 desktop)

Run this prompt on Mac. Use GitHub main exactly at `835489dd3c9e7e703ecdfb86b9cd4d2f53391b16` (tag `v0.1.0-alpha.1`), otherwise stop/report. UI follows docs/ux-redesign under temporary user authorization overriding AGENTS.md's Figma-only rule.

The agent must inspect the installed UI using accessibility interfaces and CodeTether-window-only screenshots, without delegating judgments to the user.

All 15 Windows installed-build items pass. This round tests Mac only, without code changes. Record problems and stop at the report instead of fixing them.

## Part 1. Preparation

1. Fetch `git fetch origin --tags` and create a clean worktree at `v0.1.0-alpha.1`, preserving existing Mac worktrees/uncommitted changes.
2. Read-only record version/build from `/Applications/CodeTether.app` (or actual path) and project/device/conversation counts in `~/Library/Application Support/CodeTether`. Counts only, no database contents or credentials.
3. Back up before the authorized Mac replacement.
   - Copy the complete old `CodeTether.app` to `~/agenthub-archive/mac-install-backup-<date>/`.
   - Copy the entire `~/Library/Application Support/CodeTether` there.
   - Write RESTORE.txt with recovery steps.
   - Compare file counts/total bytes. Stop if incomplete.

## Part 2. Packaging

- Required variables are `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_CODETETHER_CONTROL_PLANE_URL`, matching Windows. The user sets these in Mac terminal. Check presence only, never print/save/request values again. Stop for missing settings.
- Run `env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_MODEL pnpm install --frozen-lockfile` then `pnpm desktop:build`. Sed-redact `sk-…`, `sb_publishable_…`, Bearer before saving logs.
- Run `pnpm typecheck`, `pnpm lint`, `pnpm test` before packaging, record failures and continue packaging.
- Record .app/.dmg paths, sizes, SHA256. Use ad-hoc `signingIdentity: "-"` without notarization.

## Part 3. Installation

1. Ask user to exit old CodeTether through menu bar and verify all processes exited.
2. Replace `/Applications/CodeTether.app` with new .app, preserving data.
3. If macOS cannot verify developer, ask user to click Open Anyway in System Settings > Privacy & Security. Do not change Gatekeeper, run `spctl --master-disable`, or alter security settings other than quarantine attributes.
4. Read-only verify `git-835489dd3c9e`, one Desktop/one Host, and unchanged project/device/conversation counts.

## Part 4. Acceptance checklist

Record Pass/Fail/Untested and evidence for all 15. Mac uses ⌘ instead of Ctrl.

| # | Check |
|---|---|
| 1 | Initial setup separates installation, runtime, service and uses Continue setup. Use isolated data, preserving production |
| 2 | Add a project and discover/import existing Codex / Claude Code conversations |
| 3 | Expand/collapse devices/projects, retain across restart, ⌘B toggles sidebar |
| 4 | New conversation selects project/tool without requiring initial message, then send within conversation |
| 5 | Continue typing without mouse after send (read-only while running, focus retained) |
| 6 | Local Codex stop, Allow once / Reject, Changes, line diffs for added/deleted files |
| 7 | Claude Code omits stop/approval buttons with explanation |
| 8 | Three Inbox categories, Got it for failed/completed, reasons for non-approvable |
| 9 | Notifications contain Device · Project plus explanation, no conversation title. Click opens correct conversation both while running and after menu-bar exit |
| 10 | Light/dark/system appearance persists across restart, no dark-blue startup flash |
| 11 | Secondary times/footnotes readable |
| 12 | Roadmap lists future-only features, no fake controls elsewhere |
| 13 | Draft survives conversation switching but not application exit |
| 14 | UI has no English sentences or words meaning agent / this PC |
| 15 | Consistent project card heights |

Also verify purple dual-card icon in Dock, Launchpad, menu bar, and About, replacing the old icon.

Test in one new folder such as `~/agenthub-work/v4-accept-project-mac`. Delete only files created this round.

## Budget and stop conditions

- At most four Codex and two Claude Code turns. No failed-turn resend.
- If the first item-9 click does not open the conversation, add no more turns. Record notification-related `[codetether:desktop]` log lines and stop at the report.
- Honor Retry-After on 429/524, at most three timestamped retries, then stop/report.

## Do not do

- Change code, commit, push, tag.
- Change account, Provider selection, gateway, `~/.codex`, `~/.claude`.
- Pair/unpair or remove existing projects.
- Change system settings, notification permissions, or Gatekeeper. Ask user to enable notifications personally.
- Delete backups or old .app.

## Report

- Write `~/agenthub-archive/v4-acceptance-report-mac.md` with commit/tag, backup verification, three check results, installer paths/SHA256, running version, all 15 outcomes/evidence, icons, untested items/reasons, and user handoffs.
- Shots in `~/agenthub-archive/v4-acceptance-mac-screenshots/`, only CodeTether window, not full screen/private conversation content.
- Final Chinese summary gives pass/fail/untested totals, failed items and reasons. User will send it to the Windows reviewer.

## Restrictions

- Do not read .secrets/, any .env, credentials, machine-credentials contents, `~/.codex/auth.json`, or `~/.claude.json`.
- Never bypass denied permission. Provide commands for user terminal execution.
- Report in Chinese without exclamation marks or em dashes.

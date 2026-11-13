# Task: Continue I1 iPad Physical-Device Acceptance

Run on Mac. Acceptance only. Do not change repository code or commit.

Read these on `origin/ux/design` with `git show`: `docs/reviews/i1-ipad-app-prompt.md`, `docs/reviews/i1-fix-prompt-r1.md`, `docs/reviews/i1-fix-prompt-r2.md`, `docs/reviews/i1-fix-prompt-r3.md`, and review record `docs/reviews/i1-ipad-app.md`. Prior results are in `~/agenthub-archive/i1-report.md`.

Before starting, confirm this file has 4 second-level headings and the final section is "Report".

## Goals

Installation, login, and pairing previously passed, but `machine.get` returned `internal` when reading Mac content because a Supervisor response exceeded 16 KiB. `fd1d905` fixes that, and the installed Mac app is now `git-fd1d90540450`. Finish acceptance.

Test `30e8b9f` on `origin/i1/ipad-app`. If the latest branch commit differs, inform the user first.

First:

1. Verify the running Mac app's build ID is `git-fd1d90540450`. Otherwise stop and inform the user without installing independently.
2. Rebuild `30e8b9f` in a clean worktree and overwrite-install on iPad without deleting the app, preserving pairing. The existing iPad package includes uncommitted changes and cannot be used for acceptance.
3. Inventory unrelated uncommitted login/account changes in `~/agenthub-work/i1-ipad`, describing files/purpose without credentials. Leave them in place, outside the acceptance build, without deletion.
4. Run Connection Check, confirming workspace reads and no `internal` from `machine.get`.

Then mark each item Passed, or Failed with symptoms and errors:

1. **Direct**, using Automatic and verifying the actual path:
   - Refresh recent conversations and view devices/projects.
   - Existing history/live updates and reply.
   - Create with project/tool selection and Claude Code-only reasoning strength, then see the response.
   - Changed-file list and line-by-line diff.
   - Inbox approval, rejection, and mark reviewed.
   - Archive, restore, title search, device list, and project list.
2. **Relay**: wait until the user confirms production Relay is updated to `e4bdd57`. Another task is deploying and will restart it. Select Relay only and repeat item 1. Create at least 3 times, each adding exactly one Mac conversation and sending the first message once. Mac disconnection/exit shows offline on iPad. Continue over Relay after recovery.
3. **Rotate while pending**: immediately disable iPad Wi-Fi after Send. When confirmation becomes pending, rotate and verify draft/prompt persist. After reconnecting, Mac has exactly one new Turn.
4. **Width transitions**: rotation, split screen, and Slide Over preserve draft, conversation, Changes panel, and selected diff.
5. **Removal/re-pairing**: retain a connected conversation, remove iPad from Mac Devices, and measure seconds to Removed. Confirm Mac work continues, re-pair with a new code, connect, then remove again to leave no test authorization.
6. **Appearance**: light, dark, and system. Ask about a keyboard. If available, test ⌘N, ⌘K, ⌘↩, Esc, and hold-⌘ shortcut help. Otherwise record Not tested.

## Known Facts

- **Unfixed issues to record without blocking**:
  - "Supervisor / Relay" and "Relay only" violate wording rules in `docs/ux-redesign/06-pairing-remote-control.md` §1. Fix next round.
  - One machine read failure makes the entire computer appear offline (review suggestion 3).
  - Long Mac diffs are truncated with only an ellipsis. Check whether incomplete Changes content is presented as complete.
  - Imported native history on a computer accessed through Node reads one record per request, slowing backward pagination. Check if applicable.
- **Android tablet reference**: Lenovo acceptance found loss of panel/selected diff after rotation and prototype differences on Removed, Connection Check, and other pages in `docs/ux-redesign/tablet/png/`. The detailed `D:` report is on Windows. Focus iPad checks on these shared-design issues and compare screenshots.
- **Build**: reuse previous build/signing (`apps/ios/Scripts/build.sh device` plus Personal Team) in `~/agenthub-archive/i1-report.md`. Post-build checks print two hostnames and "present, shape correct", never keys.
- **Test targets**: writes use only user-prepared projects and real Codex or Claude Code.
- **Origins**: iPad is native. No allowlist changes or Windows-user action are needed.
- Preserve `[codetether:` error lines in sanitized logs.

## Boundaries

- **Decide independently**: build/install/observe/screenshot/time methods, environment diagnosis, and retries. Record issues and continue other items.
- **Ask the user first**:
  - Personal actions: iPad trust/dialogs, Mac pairing-code generation/removal/network disconnect, keyboard connection.
  - Repository changes.
  - Deleting/overwriting user data or killing processes you did not start.
  - Production configuration changes.
- **Do not**:
  - Read/print credentials. Only build scripts read `v4-build.env`.
  - Touch production `com.codetether.node` service/data or directly access the installed app database.
  - Commit, push, or tag.

## Report

Append "Physical-device acceptance (30e8b9f)" to `~/agenthub-archive/i1-report.md`:

- iPad model/OS, tested commit, and installed Mac build ID.
- Original-worktree uncommitted changes.
- Results for items 1–6, including each Relay creation attempt.
- Removal latency and measurement method.
- Prototype differences by page number with screenshots, at least one each of landscape, portrait, light, and dark, showing only iPad screen.
- Actual observations for Known Facts issues.
- Unfinished work and reasons.

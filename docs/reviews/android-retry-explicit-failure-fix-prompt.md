# Task. Exit "Result pending confirmation" when an Android retry receives a definitive failure

Run on Windows. This round changes code. Create branch `fix/android-retry-explicit-failure` from `e4bdd57` (`origin/fix/relay-create-uncertain`), with the worktree at `D:/Projects/Software/agenthub-work/fix-android-retry-explicit-failure`. Change only `apps/android`. References are required fixes 2 and 3 in `docs/reviews/i1-fix-prompt-r2.md` (read from `origin/ux/design` with `git show`) and `D:/Projects/Software/agenthub-archive/relay-create-uncertain-report.md`.

Before starting, confirm this file has four second-level headings and the last section is "Report".

## Goal

Symptom. After a send or create enters "Result pending confirmation", retrying with the original actionId leaves the UI pending even if the Host explicitly rejects it. The user can only kill the app.

Use the same rules as the second round of iPad fixes.

- **Retry succeeds.** Clear the pending state and handle success once. Sending stays in the conversation, while creation opens the new conversation.
- **The retry receives an explicit Host rejection** (`invalid_request`, `not_found`, `conflict`, `operation_not_allowed`, or `unsupported`), or the Rust core fails a local pre-send check. Clear the pending state and show the reason. Preserve the draft and create-dialog inputs so the user can edit and submit again with a new actionId.
- **Other failures** (disconnect, timeout, `session_expired`, `authorization_revoked`, `internal`, protocol errors, or a mismatched response). Keep the pending state and allow another retry with the original actionId.
- Initial submission and retry use the same classification. Reuse the existing `uncertainErrors` in `RemoteSupervisor.kt` instead of creating another copy.
- A `not_found` from `action.get` is not definitive failure. It only means the Host cannot find this actionId, not that the operation had no effect. Keep it pending as today. The `not_found` above refers only to the response to resubmitting the operation itself.
- After definitive failure clears the pending state, refresh the affected conversation or project list once. A Host restart may have lost the deduplication record even though the first attempt took effect. Refreshing lets the user see that outcome.

Required outcomes follow.

1. Implement these rules for both sending and creating.
2. Exercise the controller's real code paths in tests, covering at least the following cases.
   - Pending confirmation → retry receives definitive failure → clear pending, show the reason, keep the draft, and use a new actionId on resubmission.
   - Pending confirmation → retry is uncertain → remain pending with the original actionId.
   - Pending confirmation → retry succeeds → clear pending and handle success only once.
   - Pending confirmation restored after process recreation → retry receives definitive failure → clear pending.
   - `action.get` returns `not_found` → remain pending.
3. Pass Gradle gates `testDebugUnitTest lint assembleDebug assembleDebugAndroidTest` and the relevant instrumentation tests on the dedicated emulator.

## Known facts

- Relevant code is `apps/android/app/src/main/java/org/codetether/app/ui/PendingMutations.kt`, `ui/TabletController.kt`, and `remote/RemoteSupervisor.kt`. The T1a second-round approach to saving the original request and read-only confirmation is in the "Review fixes r2" section of `D:/Projects/Software/agenthub-archive/t1a-report.md`.
- Use only the dedicated `codetether_t1a_pixel_tablet_api36` emulator. Leave other emulators alone.
- Physical tablet acceptance may be in progress. Do not install a new APK on a tablet or phone.
- Follow the T1a build environment approach. Use an environment-variable allowlist for child processes and do not read `.env`.

## Boundaries

- **Decide independently.** Fix implementation, tests, commit breakdown, and build environment issues.
- **Ask the user first.** Changes outside `apps/android`, or installation of a new build on a tablet or phone.
- **Do not do.** Read or print credentials, push `main`, merge, tag, or force-push.

Push the branch to `origin` without merging.

## Report

Append a new "Definitive retry failure fix" section to `D:/Projects/Software/agenthub-archive/t1a-report.md`.

- Root cause and the code that currently treats a definitive retry failure as uncertain.
- Change commits and the remote commit after pushing.
- Test and gate results, with failures reproduced verbatim.
- Size and SHA-256 of the new debug APK.
- Remaining work, reasons, and the current completion level.

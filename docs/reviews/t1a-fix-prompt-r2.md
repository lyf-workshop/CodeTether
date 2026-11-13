# Task. T1a fixes after review (round 2)

Run on this Windows computer in the existing T1a worktree `D:/Projects/Software/agenthub-t1a-tablet`. I reviewed round 1 (`a52605d`, `41dbf72`). Most issues were fixed correctly, but two remaining problems can leave sends or creation stuck and must be fixed before merging. References remain the original `docs/reviews/t1a-tablet-app-prompt.md` and designs on `origin/ux/design`.

Before starting, confirm this file has four second-level headings and the last section is "Report".

## Goals

Line numbers refer to `41dbf72`. Kotlin paths omit `apps/android/app/src/main/java/org/codetether/app/`.

1. **Rotation is not backgrounding** (`MainActivity.kt:31-32`). `onStop` always calls `controller.foreground(false)`. With no `configChanges` declaration, rotation, split-screen, and resizing recreate the Activity and call `onStop`, cancelling active sends, creation, and pairing (`ui/TabletController.kt:87`), disconnecting all sessions, and reconnecting. Rotation is common on tablets and easily triggers the next problem. During configuration changes (`isChangingConfigurations`), keep operations and connections running. Preserve true background behavior.
2. **Allow retries when results are uncertain.**
   - Current behavior.
     - Uncertain results display "Do not submit again" (`ui/TabletController.kt:372`) and rely solely on `action.get` confirmation (`:389-420`).
     - Creation actionIds can never be found through `action.get`. Host queries only `turn_start_actions` (`apps/host/src/api/supervisor-transport-manager.ts:322-350`), while creation's first turn uses a different derived actionId (`:384-388`). Uncertain creation therefore remains `not_found` forever.
     - Sends that never reached the computer also remain `not_found`.
     - The input and "Create conversation" remain disabled. The controller check (`:359`) blocks sends and creation for all conversations and computers until sign-out.
   - Required changes.
     - Offer "Retry" for uncertainty, resubmitting the original actionId, content, and selections. Remove "Do not submit again". Host deduplicates through `apps/host/src/api/action-idempotency-cache.ts:61-104`, durable send `turn_start_actions`, and durable create actions (`apps/host/src/api/host-service.ts:3320-3352`, `:3663-3692`). Same actionId plus same content is safe. Different content returns 409.
     - Automatic confirmation remains read-only. Only an explicit user click may resend.
     - Pending actions block only the same conversation, or same project for creation, leaving other conversations and computers usable.
     - Closing/reopening creation and system process recreation must preserve visible pending actions and retry. Inputs must not stay permanently disabled. Currently the controller saves pending requests in memory while UI separately saves actionId, causing mismatch after recreation. Consolidate saved state, for example in `SavedStateHandle`, using an appropriate implementation.
3. **Related fix.** When a turn has no reply record, `remote/RemoteProjection.kt:164` synthesizes `final:${turn.id}`. If live reads already supplied the reply with itemId, merging may show it twice. Remove the synthetic record when the same turn already has a reply.
4. **Tests.** Add regressions covering at least these cases.
   - Real Activity rotation preserves sends and creation without cancellation or duplicate submission, ending successfully.
   - Persistent `action.get` `not_found` followed by Retry resubmits the original actionId/content and clears draft or closes the dialog after success.
   - Another conversation remains sendable while one send awaits confirmation.
   - Closing and reopening creation still permits retry.
   - Restored pending sends can retry after process recreation without permanently disabling input.
   - Same-turn `final:` and live reply appear only once.

## Known facts

- Correct round-1 fixes already verified.
  - Sign-out ordering, signer callback throwing only `MobileException.Failure`, 401 refresh/login routing, and `ConnectionCredentials` credential-safe printing.
  - History merging/pagination, `rememberSaveable` drafts cleared only after success, and create dialogs closed only after success.
  - Cancellable pairing wait, project foreground rereads, loading distinguished from empty, and 409 wording.
- `action.get` returns only `not_found`, `accepted`, `running`, `completed`, or `failed` (`docs/PHASE9B5-REMOTE-CONVERSATION-CONTROL.md:46-50`). The `rejected` branch in `confirmPendingMutations` is unreachable and may remain.
- Making Host `action.get` find creation actionIds is a later Host change. Clients must not calculate derived actionIds, a Host implementation detail.
- Change only `apps/android`. No computer-side development build or pairing is needed. Real login passed round 1 and need not be repeated.
- Emulator DNS issues are unchanged. See "Final supplementary testing after server recovery" in `t1a-report.md`.

## Notes

- Do not change Host, control service, Relay, B1, or Rust crate code.
- Keep credentials out of output, repository, logs, logcat, and reports, including `.secrets/`, Supabase keys, login tokens, OTPs, pairing codes, and private keys. Do not read `.secrets/`, other `.env` files, or credentials. Continue child-process environment allowlists.
- Use only your own emulator. Leave `anju_api36` untouched.
- **Gates.**
  - Run `gradlew` tasks `testDebugUnitTest`, `lint`, `assembleDebug`, and `assembleDebugAndroidTest`.
  - All instrumentation and Compose tests on the dedicated emulator pass.
  - No TypeScript/Rust changes this round, so pnpm gates and `cargo test` need not rerun.
- Choose commit breakdown. Push the branch when done.

## Report

Append "Review fixes r2" to `D:/Projects/Software/agenthub-archive/t1a-report.md`.

- Each fix and corresponding tests.
- Gate outcomes and log links.
- Commits, push status, debug APK size and SHA-256.
- Remaining work and reasons.

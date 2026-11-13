# Task: T1a fixes after review (round 1)

Run on this Windows computer, continuing in T1a worktree `D:/Projects/Software/agenthub-t1a-tablet`. Review report `D:/Projects/Software/agenthub-archive/t1a-kotlin-review.md` has been checked item by item against `f290602`; required fixes follow. References remain T1a task `docs/reviews/t1a-tablet-app-prompt.md` and design files on `origin/ux/design`.

Before starting, confirm that this file has four second-level headings and that the final section is "Report".

## Goals

Line numbers refer to `f290602`. Kotlin paths omit `apps/android/app/src/main/java/org/codetether/app/`.

1. **Finish uncommitted work from the previous round first**: the changes-panel fix distinguishing same-path records by turnId, itemId, and path (review item 5), plus new tests. Run its Compose regression and commit separately after it passes. The opt-in real-Provider and revocation-timing tests may be included while remaining skipped by default.
2. **Required fixes**:
   1. **Sign-out** (`ui/TabletController.kt:172-186`): currently clears UI and disconnects before clearing local login. Backgrounding or rotation cancels it between those steps; UI is signed out but credentials remain and reopening signs in again. Clear local login first (`TabletAccount.signOut` already makes that step noncancellable), then disconnect and clear UI.
   2. **Sending** (`ui/TabletPages.kt:284-297`, `ui/TabletController.kt:262`): cancelled sends during backgrounding/rotation have no error, so UI clears the draft. `remember` also loses it on rotation. Preserve drafts through rotation/backgrounding and clear only on explicit success. Do not resend uncertain operations; reread conversation on foreground to confirm.
   3. **Create conversation** (`ui/TabletApp.kt:263-265`): submitting closes immediately and loses the first message/selections on failure. Close only on success; preserve input and show failure reasons.
   4. **History** (`remote/RemoteSupervisor.kt:143-147`, `ui/TabletController.kt:410-411`): turn completion rereads the newest eight records while keeping old `olderCursor`/`olderMessages`. Conversations longer than eight turns lose their first turn irretrievably; paged history can develop gaps. Merge with loaded history and update boundaries.
3. **Recommended fixes**:
   1. **Pairing wait** (`ui/TabletApp.kt:138-139`, `account/ControlPlane.kt:104-111`): Back and Sign out are disabled while waiting for computer completion, potentially about 355 seconds. Add cancellation.
   2. **Control-service 401** (`account/ControlPlane.kt:185`, `ui/TabletController.kt:189-195`): existing local login prevents returning to sign-in, and the same token fails repeatedly until expiry. Refresh once on 401; if refresh is rejected, clear login and return to sign-in. Distinguish device-proof failure from expired login.
   3. **Project page** (`ui/TabletController.kt:73`, `:84-101`, `:425-444`): backgrounding during a read leaves an empty-results message forever. Reread the active project on foreground and show loading instead of an empty list while reading.
4. **Related fixes**:
   - `account/TabletAccount.kt:105-109`: signing callbacks throw `AccountFailure`, but Keystore can throw other exceptions. `MobileError` cannot convert unexpected UniFFI callback failures, causing a Rust panic (`uniffi_core` 0.29.4 `ffi_converter_impls.rs:538`) and generic error. Convert every callback failure to `MobileException.Failure` and add a test. Leave Rust crate unchanged while the iPad branch also edits it.
   - Generated `ConnectOptions.toString` includes `accessToken`. No call currently prints it; ensure it cannot enter logs or exceptions, using a wrapper if necessary.
   - The 409 message (`ui/TabletController.kt:458`) always says the conversation is running, but archive while waiting approval also returns 409. Use wording accurate for both.
   - Two email-code verification failures last round remain unexplained. After fixes, perform a real simulator login. If it still fails, use the existing observer that excludes bodies to record HTTP status and the cause in the report.
5. **Tests**: add unit or Compose regressions for each item, covering retained draft after rotation; cancellation preserving drafts; failed creation retaining input; first turn remaining after completion in a nine-turn conversation; interrupted sign-out remaining signed out after reopening; returning to sign-in after 401; and project reread on foreground.

## Known facts

- Reviewed and correct:
  - Calling `disconnect` on the main thread does not block. Rust `disconnect` cancels a token and drops the connection after `try_lock` (`packages/supervisor-mobile/src/lib.rs:178`).
  - Polling is locked and connections reused; pairing wait is capped at 25 seconds (`account/ControlPlane.kt:109`); directory network failure maps to `request_failed` rather than removal.
- Real-Provider line changes, text streaming, and revocation timing were paused at user request last round and remain outside this round. iPad testing will use real Codex on Mac.
- Modify only `apps/android`; no computer-side development build or pairing is needed.
- Simulator DNS issues match last round; see "Final additional testing after server recovery" in `t1a-report.md`.

## Precautions

- Do not change Host, control service, Relay, B1, or Rust crate code.
- Never print credentials or include them in repository, logs, logcat, or report: `.secrets/`, Supabase keys, login tokens, verification/pairing codes, private keys. Do not read `.secrets/`, other `.env`, or credential files. Keep environment-variable allowlists for build/test children.
- Use only your own simulators, preserving `anju_api36`.
- **Gates**:
  - `gradlew` tasks `testDebugUnitTest`, `lint`, `assembleDebug`, `assembleDebugAndroidTest`;
  - All instrumentation and Compose tests on the dedicated emulator, including unfinished previous tests;
  - TypeScript/Rust are unchanged, so pnpm gates and `cargo test` need not be rerun.
- Decide commit boundaries. Push the branch afterward.

## Report

Append "Review fixes r1" to `D:/Projects/Software/agenthub-archive/t1a-report.md`.

- Fix and corresponding test for each item;
- Real-login result (HTTP status/cause if failed);
- Gate results and logs;
- Commits, push status, new debug APK size and SHA-256;
- Incomplete work and reasons.

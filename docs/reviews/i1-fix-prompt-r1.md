# Task: I1 iPad fixes after review (round 1)

Run on the Mac, continuing in the I1 worktree (branch `i1/ipad-app`, currently `d9ad373`). The iPad, Developer Mode, and device trust are not ready; physical acceptance comes later. Fix code and validate on simulators this round. I reviewed `d3b56ba` and `d9ad373`; required fixes follow. References remain `docs/reviews/i1-ipad-app-prompt.md` (read with `git show` from `origin/ux/design`; its "Issues found in Android review" now has 12 items), and design files on `origin/ux/design`.

Before starting, confirm that this file has four second-level headings and that the final section is "Report".

## Goals

Line numbers refer to `d9ad373`. Swift paths omit `apps/ios/Sources/CodeTether/`.

1. **Required fixes**:
   1. **`.inactive` does not mean background** (`AppModel.swift:75-90`): any state other than `.active` currently cancels polling, pairing, and every operation, then disconnects everything. Control Center, Notification Center, app switching, and system dialogs (including the first direct connection's local-network permission prompt) cause `.inactive`, cancelling in-flight sends/creates and making their outcome uncertain. Stop only on `.background`; take no action on `.inactive`.
   2. **Create conversation** (`TabletViews.swift:1785-1789`): clicking "Create conversation" immediately calls `dismiss()`, losing the first message and selections on failure. Close only after success; preserve input on failure and show the reason inside the window.
   3. **History** (`SupervisorClient.swift:138-154`, `:464-517`, `AppModel.swift:377-404`, `:425-438`): new polling events trigger rereading the newest eight records and replacing the entire conversation, including `olderCursor`. During execution this happens every 750 ms, immediately discarding earlier paged history. Merge reread results with loaded records and update pagination boundaries. See Android `remote/HistoryMerge.kt` (`41dbf72` on `origin/t1a/tablet-app`).
   4. **Timeline order** (`SupervisorClient.swift:642-676`): all records are sorted together by `order`, but Turn records have no `order` (`packages/protocol/src/records.ts:248-263`). User inputs receive `Int.max - 1` and appear after all replies; synthesized `final:` records use 0 and appear first. Group by turn: user input first, replies and tools by `order`, then synthesized `final:`. See Android `remote/RemoteProjection.kt:145-168`.
   5. **Changes** (`SupervisorClient.swift:681-687`, `TabletViews.swift:1368`): `TabletDiffFile` uses path as its ID. The Host distinguishes changes by turnId, itemId, and path; multiple records can share a path and duplicate `ForEach` IDs. Use all three for identity.
   6. **Retry uncertain outcomes** (`SupervisorClient.swift:156-208`, `AppModel.swift:272-308`, `Configuration.swift:90`): sends and creates generate new actionIds each time. Clicking again after an uncertain outcome can duplicate a turn or conversation. Retain the pending actionId and payload, expose "Retry", and resubmit the originals. The Host deduplicates by actionId; identical content is safe, while different content returns 409. `action.get` looks up only send actionIds, not creates (Host queries only `turn_start_actions`). Pending operations block only the same conversation, or the same project for creates. Replace the message asking users to reopen the conversation to check its state accordingly.
2. **Recommended fixes**:
   1. **Control-service 401** (`AccountClient.swift:397-418`): expired login and device-proof failure are not distinguished. A device-proof 401 persisting after refresh clears login. Inspect the body: only `{status:'authentication_failed', code}` means expired login; allowed `code` values are in `apps/control-plane/src/auth/human-auth-verifier.ts:18-27`. `device_authentication_failed` must preserve login. See Android `SESSION_FAILURE_CODES` in `account/AccountHttp.kt`.
   2. **Drafts** (`AppModel.swift:310`, `TabletViews.swift:1136-1139`): memory-only drafts disappear when iPad reclaims background processes. Persist them and clear only after explicit send success.
3. **Tests**: add unit or UI regression coverage for every item, including at least:
   - Enter `.inactive` then `.active`; sends and creates are not cancelled and submit once;
   - Failed creation keeps the window open and input intact;
   - Earlier paged turns remain after a new event;
   - A three-turn conversation displays "question, answer, question, answer, question, answer";
   - Two changes for one path both appear;
   - Retrying uncertain results uses the original actionId and payload;
   - A device-proof 401 does not return to sign-in;
   - Reopening after system reclamation restores the draft.

## Known facts

- Reviewed and correct: sign-out clears local login first; signing callbacks throw only `MobileError`; pairing wait is cancellable; `ConnectOptions` is not printed; control-service 401 refreshes once before returning to sign-in; `authorization_revoked` first tries reconnecting once with the latest authorization.
- Android is fixing analogous rotation-as-background and uncertain-result deadlock issues, corresponding to 1.1 and 1.6. Merge its reviewed fixes into `main` first, then rebase this branch onto `main`.
- Windows will recheck Android builds for the two crate changes (`staticlib`, iOS `BUILD_ID`) after rebasing. Make no further crate changes this round.
- Physical work (free Apple ID installation, Secure Enclave, local-network permission, and direct/Relay on iPad) waits until the iPad is ready. Continue without waiting until the user says it is ready.

## Precautions

- Do not edit Host, control service, Relay, B1, `apps/android`, or Rust crate code.
- Credential rules remain: never print or include credentials in the repository, logs, Xcode console, or report; do not read `.secrets/`, other `.env` files, credential files, `~/.codex/auth.json`, or `~/.claude.json`; use environment-variable allowlists for build scripts and children.
- Use only simulators you create. Preserve the installed Mac app and its data directory.
- **Gates**:
  - Simulator `xcodebuild test`: unit tests, interoperability tests, and critical-flow UI tests;
  - Physical-device build (`generic/platform=iOS`);
  - Rust and TypeScript are unchanged, so `cargo test` and pnpm gates need not be rerun.
- Decide commit boundaries. Push the branch when finished.

## Report

Append a new "Review fixes r1" section to `~/agenthub-archive/i1-report.md`.

- Fix for each item and corresponding tests;
- Gate results and log links;
- Commits and whether pushed;
- Previous acceptance-table rows verified on simulators versus those awaiting a physical device;
- Incomplete work and reasons.

# Task: I1 iPad fixes after review (round 2)

Run on the Mac, continuing in the I1 worktree (branch `i1/ipad-app`, currently `82a1aff`). The iPad is not ready; validate only on simulators again. I reviewed `82a1aff`; most r1 issues are fixed correctly (see "Known facts"), with the following remaining. References remain `docs/reviews/i1-ipad-app-prompt.md` and `docs/reviews/i1-fix-prompt-r1.md` (read with `git show` from `origin/ux/design`).

Before starting, confirm that this file has four second-level headings and that the final section is "Report".

## Goals

Line numbers refer to `82a1aff`. Swift paths omit `apps/ios/Sources/CodeTether/`.

1. **Required fixes**:
   1. **Missing history turns** (`SupervisorClient.swift:841`): `reconcileHistory` merges immediately when loaded history is `complete`, without paging backward. `complete` means the loaded segment begins at turn 1, not that it overlaps the newest page. For example, iPad viewed two turns, then ten more occurred on Mac. Returning, `readConversation` loads turns 5-12 and merges with cached 1 and 2, yielding 1, 2, 5...12, marked complete without an earlier cursor. Turns 3 and 4 become inaccessible. Remove the early return and page until overlap regardless of `complete`. Android `remote/HistoryMerge.kt` (`origin/t1a/tablet-app`) has no such return.
      Also, reaching the beginning without overlap (no `beforeCursor`) currently throws `invalidResponse` (`:847-848`, `:854`), leaving `liveCursor` unchanged. Polling repeats that read and error every 750 ms. This means the cache is stale. Replace it with the newly read segment without error.
   2. **Explicit failures treated as uncertain outcomes** (`SupervisorClient.swift:446-453`): every `SupervisorWireFailure` for a request with actionId becomes `uncertainActionID`, including explicit Host rejections `invalid_request`, `not_found`, `conflict`, and `operation_not_allowed`, plus local Rust pre-send validation (`packages/supervisor-mobile/src/lib.rs:136-145`). After r1 these become pending operations; the conversation permits only "Retry original request", repeating the same error until the app is killed. For example, an oversized pasted log receives `invalid_request` from `apps/host/src/api/host-service.ts:3694-3700`. Only disconnection, timeout, `session_expired`, `authorization_revoked`, `internal`, protocol errors, and mismatched responses are uncertain. See Android `uncertainErrors` in `remote/RemoteSupervisor.kt`. Display explicit failures, retain drafts, and permit editing and resending.
   3. **Pre-send retry failure deletes pending state** (`SupervisorClient.swift:255-289`, `AppModel.swift:373-423`): retry connects first. Connection failure (computer offline, network disconnected, or missing connection information) throws the original error into `catch let failure as ClientFailure` or final `catch`, deleting pending state; `AppModel` clears it too. Yet the first attempt may have reached Host. Send becomes available with the draft intact, and clicking uses a new actionId, potentially duplicating a turn/conversation. Clear only after retry success or explicit Host rejection of that retry; preserve pending state for every other failure. Host checks actionId first (`host-service.ts:3654-3688`), so explicit rejection of the same actionId/payload means the first attempt did not take effect.
   4. **Pending operations are not persisted** (`state.pendingActions` in `AppModel.swift`, `uncertainActions` at `SupervisorClient.swift:83`): both are memory-only while drafts are persisted. System reclamation during send/create restores the draft without pending state, so another send uses a new actionId. Change this as follows.
      - Before submission, persist actionId and the original request (operation, computerId, machineId, projectId, conversationId, provider, reasoning, text), for example in `UserDefaults` alongside drafts. Delete on success/explicit failure; restore as "Outcome unconfirmed" after reopening.
      - Keep one copy. `SupervisorClient` retries the supplied original request without another stored copy.
      - Bind it to the signed-in account. Clear on sign-out; never restore under another account.
      - Reopening leaves `projectTargets` empty. Create retry must not fail simply because the project is not loaded. Refresh first or use the saved machineId/projectId directly.

      Android `ui/PendingMutations.kt` (`b668e53` on `origin/t1a/tablet-app`, not yet reviewed) is a reference only.
2. **Recommended fixes**:
   1. **Create-window retry** (`TabletViews.swift:1815-1822`, `:1838-1843`): "Retry original request" does not set `didSubmit`. Closing/reopening then retrying neither closes on success nor shows a reason on failure. The reopened input is empty, hiding the message to replay. Display the original first message, read-only if necessary.
   2. **Send button** (`TabletViews.swift:1236`): clickable while pending, it returns silently at `AppModel.swift:342`. Disable it while pending.
   3. **Sign-out** (`AppModel.swift:173-188`): drafts remain in `UserDefaults`, while pending operations, history cache, and conversation targets remain in `SupervisorClient` memory. Clear all on sign-out.
   4. **Change-path length** (`SupervisorClient.swift:924`): its 2048 limit disagrees with protocol 4096 (`packages/protocol/src/runtime-history.ts:131`). One long path fails the whole list. Use 4096.
3. **Simulator test environment**: failed `DeviceIdentityTests` does not indicate faulty identity logic. Software keys under `simulator` plus `DEBUG` are correct. The likely cause is unsigned tests: all three `project.yml` targets set `CODE_SIGNING_ALLOWED: "NO"`; `Scripts/test.sh:56` and `:65` pass it too. Unsigned simulator apps lack Keychain entitlement, preventing permanent keys with `kSecAttrIsPermanent` (usually `errSecMissingEntitlement`, -34018). `SecureStore` also uses Keychain, likely preventing login persistence and simulator sign-in/pairing. Use local signing for simulator builds/tests (`CODE_SIGN_IDENTITY = "-"`, no developer account required), preserving device builds. Make the test pass; otherwise record `OSStatus` in the report.
4. **Tests**: two r1 tests bypassed real code. `AppModelRegressionTests.testInactiveThenActiveDoesNotCancelPendingSendOrCreateWork` created tasks and used `TabletLifecyclePolicy` for cancellation without `TabletAppModel.sceneChanged`; `testMutationRetryReusesOriginalActionIDAndPayload` tested only `PendingSupervisorAction.replay` argument forwarding. Add injection points to `SupervisorClient` and `TabletAppModel` (fake `SupervisorConnector`; `AccountClient` may become a protocol) so tests exercise actual send/create/retry and `sceneChanged`. Cover at least:
   - `.inactive` then `.active` during send does not cancel it and submits once;
   - Complete cached turns 1-2 plus a page starting at 5 reconcile to 1-12 without duplicates/errors; no overlap at the beginning replaces cache with newly read history without error;
   - Initial `invalid_request` displays its reason, stores no pending operation, retains the draft, and permits resending;
   - Retry after uncertainty with connection failure retains pending state; later success uses original actionId/payload and clears it;
   - Retry `conflict` clears pending state and shows its reason;
   - Reclamation during send followed by reopening shows pending state and retries the original actionId;
   - Sign-out clears drafts, pending operations, and history cache, with no restoration for another account;
   - Reopening creation and retrying successfully closes the window and opens the new conversation.

## Known facts

- Reviewed and correct: `.inactive` no longer stops work; failed creation preserves window/input; each turn shows input, ordered replies/tools, then `final:`; change IDs use turnId/itemId/path; retry uses original actionId/payload and pending state blocks only its conversation/project; 401 clears login only for `authentication_failed` with an expired-login `code`, preserving login for device-proof failure; drafts clear only after confirmed success.
- CoreSimulator hangs during cleanup appear environmental. Do not change code for it. Run unit and UI tests separately on newly created simulators and shut each down afterward. Identify the `xcresult` supplying each test bundle's results.
- Host creation has two steps: create conversation, then start the first turn (`apps/host/src/api/supervisor-transport-manager.ts:315-345`). Step-two failure leaves an empty conversation. This Host issue is for later; tests must not assume it cannot occur.
- Merge Android (T1a) into `main` first, then rebase this branch. Windows rechecks crate changes. Make no crate edits this round.
- Physical-device work waits until iPad is ready. Continue until the user says it is ready.

## Precautions

- Do not edit Host, control service, Relay, B1, `apps/android`, or Rust crate code.
- Credential rules remain: never print or include credentials in the repository, logs, Xcode console, or report; do not read `.secrets/`, other `.env` files, credential files, `~/.codex/auth.json`, or `~/.claude.json`; use environment-variable allowlists for builds and children. Persist no credentials in original requests.
- Use only simulators you create. Preserve installed Mac app and data.
- **Gates**:
  - All simulator `xcodebuild test` tests pass, including `DeviceIdentityTests`;
  - Physical-device build (`generic/platform=iOS`);
  - Rust and TypeScript are unchanged; `cargo test` and pnpm gates need not be rerun.
- Decide commit boundaries. Push the branch when finished.

## Report

Append a new "Review fixes r2" section to `~/agenthub-archive/i1-report.md`.

- Fixes and corresponding tests;
- `DeviceIdentityTests` cause and correction;
- Gate results, `xcresult` files, and log links;
- Commits and whether pushed;
- Incomplete work and reasons.

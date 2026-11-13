# Review record: i1/ipad-app

## Physical-device acceptance (30e8b9f, 2026-11-08)

Report: "Physical-device acceptance (30e8b9f)" in `~/agenthub-archive/i1-report.md`. iPad Air 11-inch (M4), iPadOS 27.2, installed Mac build `git-fd1d90540450`.

- Internet connection checks, read-only pages, and rotation passed.
- Conversation creation failed with "This operation is not supported for the current conversation". I verified the execution agent's root cause: `SupervisorClient.swift:280` reads `providerExecution` from AI-tool capabilities, but it belongs to device capabilities (`packages/protocol/src/machines.ts:38`). `readWorkspace` (`:644`) reads it correctly. Simulator fixtures placed it incorrectly, hiding the issue.
- Remaining internet business operations, network recovery, removal/re-pairing, appearance, and keyboard testing await the fix.

Code review also found usability issues (background refresh disabling input, repeated polling-failure alerts, new messages pulling the reader to the bottom, landscape changes not collapsing the sidebar, and the computer name on the removed page). These and the root cause are in r4 (`docs/reviews/i1-fix-prompt-r4.md`, items 6-10 and 13); see `docs/ux-redesign/09-tablet-usability.md` section 6. After r4, run physical interaction testing with `docs/reviews/i1-ipad-interaction-test-prompt.md`.

## r3 and physical-device fixes (2026-11-07)

Reviewed commits on `origin/i1/ipad-app` after `90cd7f5`: `5004eb9` and `a82162f` (r3 login configuration), `8d5707d` (millisecond timestamps), `e2bba61` (pairing busy state), and `30e8b9f` (connection checks). Task: `docs/reviews/i1-fix-prompt-r3.md`.

Conclusion: no required changes; physical-device acceptance may continue.

Verified and correct:

- **Root cause fixed**: `generate-local-config.mjs` writes `://` as `:/$()/` to prevent xcconfig interpreting `//` as a comment, and rejects whitespace or quotes. `Base.xcconfig` removes `INFOPLIST_KEY_*` entries duplicated by `Info.plist`.
- **Post-build checks**: `verify-build-config.mjs` reads the final `.app`'s `Info.plist` using `Configuration.swift` rules (HTTPS origins, key character set/length, and all-or-none Relay configuration). It prints presence/shape checks and two hostnames without keys or fingerprints.
- **Timestamp parsing**: `TabletTimestamp.parse` tries milliseconds first, then no milliseconds, replacing all four old `ISO8601DateFormatter()` calls.
- **Pairing state**: the pairing button uses separate `isPairing`, cleared on sign-out. Background refresh neither changes it nor blocks pairing with alerts.
- **Connection checks**: progress clears on success, failure, and sign-out. Diagnostics show only allowlisted operation names and error codes.

Recommended changes (not blocking acceptance):

1. `build.sh` defines unused `XCODEBUILD_OPTIONS` and adds `-allowProvisioningUpdates` separately below. Remove the unused definition.
2. `verify-build-config.mjs` checks three Relay values only for nonemptiness but prints "present, shape correct". Validate shape or print "present".
3. Any machine-read failure in `readWorkspace` makes the entire computer offline (`SupervisorClient.swift` refresh loop). B1 fixes should reduce occurrences, but one machine must not affect others on the same computer. Address next round.

## r4 (`3084164`, reviewed 2026-11-13)

Reviewed `origin/i1/ipad-app` from `30e8b9f` to `3084164`: one commit, 16 files, +1630/−244, all in `apps/ios`. Task: `docs/reviews/i1-fix-prompt-r4.md`.

The r4 report is on the Mac (`~/agenthub-archive/i1-report.md`, "r4 fixes") and was not available for this review. Screenshots and the per-item status still need checking against it.

Conclusion: **one must-fix** (below). The fix round is `docs/reviews/i1-fix-prompt-r5.md`.

Checked, no problem:

- **Item 6.** This was the root cause of the failed Relay creation. Creation now reads `providerExecution` from `machine.get`'s `machine.capabilities` (`SupervisorClient.swift:279-280`), not from the AI tool's capabilities.
- **Item 5 (one device does not take down the computer).**
  - In `readWorkspace`, each device's reads run in their own `do`/`catch`.
  - Only computer-level failures rethrow (`isComputerLevelFailure`): connection, Relay, session, authorization, removal or identity.
  - Any other failure marks just that device unavailable, with "暂时无法读取，请稍后重试。".
- **Item 7 (background refresh).** Background refresh no longer counts toward `isBusy` (`performBusy(updatesBusy: presentError)`). The send button is gated only on this conversation's own pending send and on `canSend`.
- **Item 8, inside a conversation.** A failed foreground poll shows an inline notice, "连不上这台电脑，正在重试。", which clears on the next success. Only revocation or removal still leads to the removed page.
- **Items 9 and 10.**
  - New messages follow only when the reader is already at the bottom; otherwise a "有新消息 · 回到最新" button appears.
  - The removed page names the computer that returned the removal error.
  - A newly opened conversation starts at the latest message. Switching rebuilds the scroll view, because `detail` is nil until the new conversation loads.
- **Items 3 and 4.**
  - The sidebar collapses when the changes panel opens on a wide screen, and can be called back.
  - The panel is 420 wide in landscape and up to 520 in portrait.
  - The removed state is a Home banner with "输入配对码" and "看其他电脑".
- **Item 2 (wording).** The connection-mode picker, including "只走 Relay", is inside `#if DEBUG` (`TabletViews.swift:1777-1817`).
- **Item 14.** All present:
  - Home separates "需要你处理" and "正在运行".
  - "变更 N" entry.
  - The "换行" toggle.
  - Stop asks for confirmation.
  - Edge-swipe back.
- **Account session hardening.** This was not on the r4 list; presumably it came from acceptance.
  - Refresh is single-flight. Supabase rotates refresh tokens, so a parallel refresh would look like token reuse.
  - A session generation fences every write after sign-out or verification.
  - Device registration is single-flight and is stored only for the current generation.
  - `signOut` clears storage before the remote logout, and reports a storage failure.
  - An expired session (`signInRequired`) anywhere signs the app out cleanly instead of looping on errors.
- **Item 12 (build scripts).** The unused `XCODEBUILD_OPTIONS` is gone, and the Relay fields now print "present".

Must fix:

1. **Restore retries show the error alert every 10 seconds while offline.** This is the r4 item 8 symptom again, in the state before the session is restored:
   - `taskDidStart()` starts polling at launch, before sign-in (`AppModel.swift:193-195`).
   - If the first `start()` fails for any reason other than `signInRequired`, for example no network at launch, `bootstrapped` stays false.
   - `pollForeground()` then calls `start()` again every 10 seconds (`AppModel.swift:871-873`).
   - Each failure ends in `show(error)`. That sets `errorMessage`, which is presented as the "操作未完成" alert (`TabletViews.swift:376-382`).
   - Result: an iPad launched offline shows the alert, the user dismisses it, and it comes back 10 seconds later until the network returns.

   Retried restores must report failure inline and must not raise the alert. At most the first failure at launch may.

Suggested changes (not blocking):

1. In `readWorkspace`, a device's `projectTargets` entries are written before that device's later reads. If `conversation.recent` then fails, the device shows as unavailable with no projects, yet its project targets stay registered. Register them only after the device's reads succeed.
2. When the account session expires, as opposed to an explicit sign-out, `expireAccountSession` also discards `pendingActions`. Those include sends whose outcome is uncertain. After signing in again as the same account, the user no longer sees that a message may already have been sent, and could send it again by hand. Keep uncertain actions keyed by account across expiry. Drop them only for a different account or an explicit sign-out.
3. One line in `loadConversation`'s catch block is indented a level too deep (`AppModel.swift:536`).

## Next steps

r5 (`docs/reviews/i1-fix-prompt-r5.md`) fixes the must-fix. It also takes suggestions 1 and 2 as should-fix.

After r5, the Owner finishes the iPad acceptance that r4 was blocking:
- the remaining Relay operations
- network recovery
- removal and re-pairing
- appearance and keyboard

Use `docs/reviews/i1-ipad-interaction-test-prompt.md`. I1 merges into `main` only after that acceptance. It is no longer part of the `v0.1.0-alpha.3` release.

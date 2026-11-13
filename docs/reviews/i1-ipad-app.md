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

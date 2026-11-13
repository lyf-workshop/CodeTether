# Task: I1 Post-Acceptance iPad Fixes (Round 4)

Run on Mac and continue on `i1/ipad-app`. The physical-device report is complete under "Physical-device acceptance (30e8b9f)" in `~/agenthub-archive/i1-report.md`. Relay conversation creation is blocked by item 6 below. Continue remaining Relay acceptance after these fixes. Change only `apps/ios`. Commit and push to `i1/ipad-app`, without pushing `main`, merging, or tagging.

References on `origin/ux/design`, read with `git show`:

- `docs/ux-redesign/07-tablet.md` and `docs/ux-redesign/tablet/` (screenshots in `tablet/png/`). iPad and Android tablets share this design.
- `docs/ux-redesign/06-pairing-remote-control.md` §1, wording rules.
- `docs/reviews/i1-ipad-app.md`, suggested changes from the previous review.
- `docs/reviews/t1a-tablet-fidelity-prompt.md`, Android fixes for the same issues. Its items 4–9 are the fidelity checklist to apply to iPad.
- `docs/ux-redesign/09-tablet-usability.md` §6, iPad issues I1–I12. Issues marked for r4 correspond to items 6–10 below.

Before starting, confirm this file has 4 second-level headings and the final section is "Report".

## Goals

**Required changes**:

1. **Failed acceptance cases**: fix every failed case caused by `apps/ios` defects. List issues originating in Host, Relay, Rust core, or other computers without fixing them.
2. **Wording**: 06 §1 forbids Host, Node, Machine, ProductDevice, Supervisor, Relay, authorization, grant, and fingerprint in UI. Connection Check currently shows "Supervisor / Relay" and "Relay only".
   - Follow 04-04 as a standalone page with Back, everyday descriptions, and status badges.
   - Forced transport switches, key-security level, and technical diagnostics appear only in Debug for acceptance, never Release.
   - Audit the rest of the app for the same wording violations.
3. **Preserve width-transition state**: 07 specifies a 420-wide landscape Changes panel on the right, automatically collapsing the sidebar while allowing it to reopen. Portrait overlays a 520-wide panel. Rotation, split screen, and Slide Over preserve open state, selected file, diff scroll, draft, and conversation. Document already-working behavior and add tests.
4. **Removed page**: follow 04-06 and 07 route `#/home?removed=1`, with a red Home alert retaining the sidebar, naming the computer that removed the device, and offering Enter Pairing Code / View Other Computers.
5. **One machine failure must not hide the whole computer** (review suggestion 3): `readWorkspace` in `SupervisorClient.swift` currently marks the computer offline if any machine read fails. Mark only that machine unreadable with its reason. Keep other machines visible. Mark the computer offline only for connection failure.
6. **New Conversation reads the wrong capability** (blocking all Relay business acceptance): `SupervisorClient.swift:280` reads `providerExecution` from tool capabilities, but this is a machine capability (`packages/protocol/src/machines.ts:38`, `machine.capabilities` in `machine.get`), absent from provider capabilities (`packages/protocol/src/providers.ts:26`). Physical devices therefore always report unsupported operation. Follow the correct lookup in `readWorkspace` (`:644`).
   - Root cause is fixture shape. `UITestPendingCreateFixture.swift:89` and `AppModelRegressionTests.swift` at `:631` and `:763` incorrectly place `providerExecution` in tools and omit required `machine` fields `capabilities`/`availability`. Match `MachineSummarySchema` and `ProviderDescriptor` completely, or sanitize a real acceptance `machine.get` sample. Audit other fixtures for similar mistakes.
   - Add a successful creation test using a real-shaped `machine.get` with no provider `providerExecution`.
7. **Background refresh must not block typing** (09 I2): `performBusy` sets `isBusy` during 10-second refreshes, disabling the conversation field (`TabletViews.swift:1224`), Send, and Create, potentially dismissing the keyboard. Background refresh/polling must not set `isBusy`. Disable input only for that conversation's own in-flight send or inability to send. Test typing and Send availability during refresh.
8. **Polling failures must not show dialogs** (09 I3): `pollForeground` calls `show(error)` (`AppModel.swift:841-843`) every 750 ms, repeatedly reopening dismissed offline alerts. Background errors become page status, such as "Cannot reach this computer. Retrying", and clear on recovery. Only user-initiated failures show dialogs. Preserve removal classification.
9. **New messages must not interrupt reading** (09 I4, P8): `onChange(of: detail.messages.count)` unconditionally scrolls to bottom (`TabletViews.swift:1195`). Follow only when already at bottom. Otherwise show New Messages, returning to latest when tapped. Opening a conversation starts at latest.
10. **Correct removed-computer name** (09 I12): `removedComputerName` currently takes the first unavailable computer (`AppModel.swift:884`), which may be wrong in multi-computer accounts. Use the computer that produced the removal error.

Item 3's automatic sidebar collapse is absent. Wide layouts always show the sidebar (`TabletViews.swift:253`), leaving about 460 pt for conversation with Changes open (09 I5). Follow 07, collapsing on open and allowing manual reopening.

**Expected changes**:

11. **Prototype fidelity**: capture every iPad page and apply items 4–9 of `t1a-tablet-fidelity-prompt.md` for lists/segments, Changes, conversation, creation, devices, and settings. List missing backend data without fabricating it or changing backend.
12. **Two build-script fixes** (review suggestions 1–2): remove unused `XCODEBUILD_OPTIONS` from `build.sh`. For the three Relay values, `verify-build-config.mjs` currently checks only nonempty. Either validate their shape or change output to "present".
13. **Preselect New Conversation project** (09 P2, I11): opening from project page, device page, or sidebar project row should preselect that project. Currently it always chooses the first available. Use at least 4 lines for the initial-message field and ⌘↩ to start in the dialog.
14. **Approved interaction rules** (`07-tablet.md` §4 Interaction Rules, prototypes 02-01, 02-04, 02-13, 02-14 updated): separate Home Needs Attention and Running sections, Changes N entry, default diff wrapping with a Wrap switch, confirm Stop, clickable Device › Project below the title, and swipe right from the left edge to return.

**Outside this round**: T1b features (pin, rename, add/remove projects, previous conversations, project-content search, notifications, background, unlock). Keep them hidden even when present in prototypes.

## Known Facts

- Of the acceptance report's four known issues (wording, one-machine failure, unmarked diff truncation, slow native history), fix the first two. The other two are Host issues. Report observed behavior without iOS workarounds.
- Round 2 defined send/create retry semantics: clear pending confirmation only on success or an explicit Host rejection. Preserve it for other failures. `action.get` `not_found` is not explicit failure. Android already follows this (`aeac893` on `origin/fix/android-retry-explicit-failure`, `uncertainErrors`/`definitiveMutationErrors` in `RemoteSupervisor.kt`). Keep both platforms aligned:
  - **Explicit failure**, returned by the retried write itself or pre-send local Rust validation: `invalid_request`, `not_found`, `conflict`, `operation_not_allowed`, `unsupported`.
  - **Uncertain**: disconnect, `connection_failed`, `session_expired`, `authorization_revoked`, `remote_host_unreachable`, `timeout`, `invalid_response`, `internal`, `protocol_error`, `unavailable`, and pre-retry read/connection failures.
  - If iPad differs, such as treating `unavailable` as explicit, correct it and test. Otherwise document consistency. Change no other behavior for this part.
- Tests must use real `TabletAppModel`/`SupervisorClient` paths with fake connections. Cover width transitions through UI tests or snapshots.
- **Scale**: beyond about 30 files or 3000 lines excluding tests/screenshots, finish and push items 1–10 before 11–14, explaining in the report.
- Reuse prior build, signing, and installation procedures.

## Boundaries

- **Decide independently**: implementation, tested commit breakdown, test/screenshot methods, and prototype details inferred from HTML/CSS.
- **Ask the user first**:
  - Changes outside `apps/ios`, including Rust core.
  - Conflicts between prototype and 07.
  - UI absent from the prototype.
  - Personal iPad/Mac actions.
- **Do not** read/print credentials, push `main`, merge, tag, or force-push.

## Report

Append "r4 fixes" to `~/agenthub-archive/i1-report.md`:

- Changes/commits for items 1–14 and remote commit after pushing.
- Fixed failed-acceptance cases and issues outside iOS, with reasons.
- Width-transition and Removed-page test results.
- Every prototype page's iPad screenshot and remaining differences/reasons.
- Missing backend data.
- Unit/UI/build results, reproducing failures verbatim.
- Unfinished work, reasons, and completion level.

# Review Record: fix/t1a-tablet-fidelity

Task: `docs/reviews/t1a-tablet-fidelity-prompt.md`. Execution report: "Tablet acceptance fixes" in `D:/Projects/Software/agenthub-archive/t1a-report.md`.

## Round 1 (Items 1–3, `4d2c474`)

Date: 2026-11-08. Reviewed `4d2c474` on `origin/fix/t1a-tablet-fidelity` against `aeac893`, covering 16 files, all under `apps/android`.

Conclusion: no required changes. Proceed with items 4–9.

Checked and accepted:

- **Changes-panel preservation**: `ChangesPanelState` uses `rememberSaveable` for open state, selected file (`turnId`, `itemId`, `path`, `order`), and list/diff scroll positions, resetting when `(user, conversation)` changes. State restores after rotation, split screen, and process reconstruction. Saved scroll positions are not applied before changes load, so an empty loading state cannot clamp them to 0.
- **Wide/narrow placement**: wide and narrow sidebar states are stored independently. Opening Changes closes both. Landscape docks the panel on the right at 420, while portrait overlays it at up to 520. Panel state is independent of placement. Back dismisses the dialog, panel, narrow sidebar, returns Connection Check to Settings, then returns Home, in that order.
- **Process restoration**: saved conversation routes include the user ID. A same-user conversation restores after reconstruction, even without a pending send. If its computer has left the directory, return Home, or to Pairing if no computers remain.
- **Removed-device page**: a red alert at the top of Home retains the sidebar and offers "Enter pairing code" and "View other computers", using a pairing dialog. Removed computers immediately leave the directory and loaded cache. Each computer's removal is reported once, with reporting reset after re-pairing.
- **Connection Check**: a standalone page with "‹ Settings" at top left. Computer and indirect-device rows describe "Same network, direct connection", "Connected over the internet", "Via [computer]", or "Unreachable · Online 2 hours ago", with Connected/Offline badges. "Check again" is a gray rounded button below.
- **Wording rules**: pages do not expose Supervisor, Relay, authorization, or fingerprint. Forced connection mode ("Automatic / Internet only") and device key-protection level appear only under `BuildConfig.DEBUG`, and are absent in Release.
- **Screenshots against the prototype** (2560×1600 emulator, compared with `docs/ux-redesign/tablet/png/`):
  - 04-06 Removed: matching title, red alert/icon, black and gray pill actions, and layout.
  - 04-04 Connection Check: matching title, subtitle, grouped rows, badges, and "Check again". Additional controls below are Debug options.
  - 05-03 portrait Changes: overlays the conversation and includes file rows, paths, and red/green diff. Diff backgrounds cover text rather than complete rows (item 5).
  - Sidebar circular count badges, icons, and expandable device groups differ from the prototype (items 4 and 8).

Suggested changes (non-blocking):

1. `RemoteProjection.machine()` special-cases `displayName` equal to `"CodeTether Node"` to display "Remote computer". A user-chosen name matching that string also changes. A cleaner approach is for Host to assign Node a user-friendly default name. Add this to B3/maintenance work.
2. The Debug forced-connection option was renamed from "Relay only" to "Internet only". Tests and the retest prompt were updated. The mode persists locally and may survive installing Release. Release should ignore it and always use Automatic. Check the implementation and correct it if necessary.
3. End-to-end system process reclamation (`adb shell am kill`) was not tested, only saved-state reconstruction. Include it during the physical-device retest, as already added to the prompt.

## Next Steps

Continue items 4–9 on this branch. Push two batches, items 4–6 and then 7–9, with each batch reviewed separately.

## Rounds 2 and 3 (items 4–9, `312343b` and `945c849`)

Date: 2026-11-13. Reviewed `origin/fix/t1a-tablet-fidelity` from `4d2c474` to `945c849`: 24 files, +2193/−553, all in `apps/android`.

Report: the "Items 4–6" and "Items 7–9" sections of `D:/Projects/Software/agenthub-archive/t1a-report.md`, with the prototype comparison sheets `t1a-logs/t1a-tablet-fidelity-4-6/qa-final-*.png` and `t1a-logs/t1a-tablet-fidelity-7-9/qa-final-*.png`.

Conclusion: no must-fix. This round is ready for the Owner's device re-check. The report still says both batches are "awaiting review and device re-check". So `release-alpha3-prompt.md` was wrong to call them already reviewed and accepted.

Checked, no problem:

- **Attention counts.**
  - Per-type counts come from the Host summary fields `approvalOpen`, `completedReviewOpen` and `failedOpen`, which `apps/host/src/api/attention-service.ts:55-58` really sends.
  - Without those fields, counts are computed from the list only when the list is complete; otherwise they are omitted rather than guessed.
  - Resolving one item decrements only that item's type.
- **Project counts.** Active and archived counts come from the full paged `conversation.list` directory. The old code already read it in full and filtered locally, so this adds no extra reads, and switching the segment reuses the directory.
- **Capability gating.**
  - Stop is shown only when the Provider supports interrupt and the device has control.
  - Settings shows no notification, background or unlock toggles, because they are not real capabilities yet (03 §6). The prototype does draw them.
  - Removing a computer goes through a confirmation sheet (`TabletSettings.kt:192`).
- **Wording.** User-visible strings never say Host, Node, Machine, Supervisor, Relay, authorization or fingerprint. The forced-connection modes and key-protection details are Debug-only; the release DEX audit in the report confirms it.
- **Earlier suggestion 2 (persisted Debug connection mode)** is resolved. The mode is in-memory state that defaults to `AUTO` (`TabletState.kt:64`) and is never read back from storage.
- **Gates**, per the report:
  - Gradle `testDebugUnitTest lint assembleDebug assembleDebugAndroidTest` passed.
  - 64 instrumented tests passed; 6 are skipped by default.
  - `assembleRelease` passed.
- **Screenshots** match the prototypes page by page. The remaining differences are data gaps the report explains.

Suggested changes (not blocking):

1. When Stop is unavailable, the running bar says "这台设备上不能停止" (`ConversationStatus.kt:172`). The real reason is usually the AI tool (Claude Code has no interrupt) or missing control permission, not the tablet. Name the actual reason when it is known.
2. Two data gaps belong to the Host, in B4 or T1b. Track them in 08, not on this branch:
   - The project directory has no root path, so paths cannot be shortened.
   - The tablet directory has no pairing or last-used dates, so Settings shows connection state instead.

## Next steps

The Owner re-checks items 1–9 on a device: the Android emulator for the tablet layout, the vivo X60 for the basics. If that passes, this branch goes into the `v0.1.0-alpha.3` release together with `fix/android-retry-explicit-failure` (`docs/reviews/release-alpha3-prompt-r2.md`).

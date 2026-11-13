# Task: iPad Physical Interaction Testing and Remaining Acceptance

Run on Mac with iPad Air 11-inch (M4), iPadOS 27.2, after r4 (`docs/reviews/i1-fix-prompt-r4.md`) is pushed and approved. Test the commit the user specifies when issuing this prompt, asking if unspecified. Testing only, without repository changes or commits.

Read on `origin/ux/design` with `git show`:

- `docs/ux-redesign/09-tablet-usability.md`: tasks T1–T8, hypotheses P1–P8, and §6 issues I1–I12.
- `docs/ux-redesign/07-tablet.md` and `docs/ux-redesign/tablet/` prototype.
- `docs/reviews/i1-ipad-acceptance-prompt.md`: finish prior checklist items 2–6.
- `docs/reviews/t1a-tablet-interaction-test-prompt.md`: Android counterpart, with comparable results.

Prior results: `~/agenthub-archive/i1-report.md`.

Before starting, confirm this file has 4 second-level headings and the final section is "Report".

## Goals

**A. Remaining acceptance**, previously blocked at creation:

1. Internet path, forced in Debug: repeat all of prior item 1. Create at least 3 times, each adding exactly one Mac conversation, sending the initial message once, and not remaining pending. Mac exit/disconnection shows offline, with operation resuming on recovery.
2. Prior items 3–6: pending rotation, width transitions, removal/re-pairing, appearance, keyboard.

**B. Frequent tasks**, T1–T8 in 09 §1, at least once per direct/internet path. Record for each:

- Actual steps, counting every tap, input, and swipe, and differences from 09 §2.
- Time from start to completion.
- Hesitation, wrong taps, and backtracking, with screenshots.

**C. Interaction details**:

- Back: each sidebar/dialog/Changes/conversation/settings level, left-edge swipe, and landscape conversation-to-project step count (I6).
- Scrolling: fast long-history smoothness, initial position, incoming messages while reading older content and Back to Latest (P8), and restoration after leaving/returning.
- Input: keyboard dismissal or gray-button flicker during refresh (I2), keyboard occlusion, floating/split keyboard, accidental ⌘↩ submission during Chinese composition, keyboard/focus after sending.
- Offline/slow network: disable Wi-Fi in an open conversation, inspect repeated alerts (I3), and automatic clearing after recovery.
- Selection/copy: partial message, approval-command, and diff copying, including multiple diff lines (P7, I8).
- Rapid taps: Send, Allow Once, Create Conversation, Mark Reviewed execute once only. A second tap in the Send location must not accidentally stop the new Turn (I7).
- Creation (P2, I11): open from Home, project, device, sidebar project row, checking preselection and visibility of 3–4 input lines.
- Stop (P5): proximity to other controls and accidental-tap risk.
- Search (P6): query an unopened older title and inspect results/explanation.
- Landscape Changes: sidebar collapse and remaining conversation width (I5).
- Trackpad/keyboard, if available: hover feedback, secondary-click menus (I10), hold-⌘ help.

**D. Accessibility**:

- Enable VoiceOver and perform T2/T3. Verify labels for sidebar, Changes, More, Close, Stop, and Send icon buttons.
- Set maximum text size in Accessibility. Check scaling, truncation, overlap, and usable buttons (I9).
- Use Xcode Accessibility Inspector to find targets smaller than 44 pt.
- Check dark-mode text/background readability.

**E. Large content and counts**: long titles, project names, paths, commands, code lines, hundreds of diff lines/messages, and many devices/projects. Use real device data where feasible, otherwise synthetic simulator data, clearly labeled.

**F. Fifteen-minute user trial**:

- After A–E, ask the user to perform these six tasks unprompted while recording through Control Center or Mac QuickTime. Time each:
  1. Find a waiting conversation, understand its command, and approve.
  2. Read all changes in a modified-file conversation and request one more test.
  3. Create Codex in the test project and ask a question.
  4. Start work, then stop it.
  5. Find a conversation from yesterday or earlier.
  6. Rotate portrait/landscape and continue the same task.
- Ask five questions and record verbatim responses: hardest task, uncertainty about where to tap, wrong taps, most desired improvement, and comparison with desktop/Android tablet.

## Known Facts

- **Peer**: installed Mac app. Verify its running build ID matches the prior report. Otherwise stop and inform the user without installing.
- **Build**: reuse `apps/ios/Scripts/build.sh device` plus Personal Team, overwrite-install without deleting so pairing persists. Internet-only switch is Debug-only.
- **Test project**: writes only to user-prepared targets. Small real Codex tasks may create long conversations/diffs.
- **Known data gaps**, record without treating as usability defects: root paths, original pairing/last-use dates, progress percentage, slow backward imported history through another computer, unmarked long-diff truncation.
- **Unimplemented**: T1b project search/add/import/pin/rename, notifications, background connectivity, and pre-approval unlocking. Prototype controls for them are intentionally absent.
- Capture iPad screen only. Tell the user where recordings are stored, without uploading.
- Preserve `[codetether:` error lines when sanitizing logs.

## Boundaries

- **Decide independently**: test order/method, timing, data preparation, environment issues, retries. Record failures and continue other cases.
- **Ask the user first**: personal device/settings/pairing/removal/network/keyboard/trackpad/trial actions, repository changes, production configuration, deleting/overwriting user data, or killing processes you did not start.
- **Do not** read/print credentials (only build scripts read `v4-build.env`), touch production `com.codetether.node`/data, directly access the installed database, commit, push, tag, or fix code.

Restore original text-size, VoiceOver, dark-mode, and Wi-Fi settings. Ask whether to retain or remove the final pairing.

## Report

Append "Interaction testing" to `~/agenthub-archive/i1-report.md`:

- Tested commit and iPad/Mac versions.
- **A**: each internet creation and each prior checklist item 1–6.
- **B**: one row per T1–T8, with step count, time, 09 §2 differences, and blockers.
- **Issues**: one row with severity (blocking / cumbersome / minor), page, reproduction, screenshot, and 09 reference (P1–P8, I1–I12, or new issue).
- **P1–P8/I1–I12**: confirmed, disproved, fixed, or untested for each.
- **D**: unlabeled VoiceOver buttons, truncation, and targets below 44 pt.
- **F**: task timings/completion/sticking points, five verbatim responses, recording path.
- Restored settings, unfinished work, and reasons.

Report only observations and the user's words. Design determines remedies.

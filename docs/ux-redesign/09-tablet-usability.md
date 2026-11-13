# 09 · Tablet Usability Review (T1)

Date — 2026-11-08. References are S5 and the tablet column in 04, 07, the `tablet/` prototype, Android `fix/t1a-tablet-fidelity` at `945c849` (screenshots in `D:/Projects/Software/agenthub-archive/t1a-shots/t1a-tablet-fidelity-7-9/`), and Lenovo TB375FC physical-device acceptance (`t1a-report.md`).

This document asks how many steps common tablet tasks take, whether they flow naturally, and what needs to change. Sections 2 and 3 contain inferences from screenshots, code, and prototypes. The physical interaction tests in section 4 should confirm or refute them.

## 1. What the Tablet Must Do Well

The tablet is a screen for comfortably reading conversations and reviewing changes, while also supporting creation and replies (04 item 4, 03 §0). This positioning suggests the following common tasks and target step counts.

| # | Task | Target |
| --- | ----------------------------------------------- | -------- |
| T1 | Open the app and immediately identify conversations needing attention and those running | 0 steps |
| T2 | Approve or reject a pending approval | 2 steps |
| T3 | Read a conversation, review line-by-line changes, and add another instruction (S5) | At most 5 steps |
| T4 | Create a conversation within a project | At most 4 steps |
| T5 | Stop a task that has gone off track | 2 steps |
| T6 | Find a conversation from several days ago | At most 3 steps |
| T7 | Understand what to do when a computer is offline, connectivity fails, or the device is removed | No guessing |
| T8 | Continue after rotating or switching to split screen | Nothing lost |

## 2. Current Paths (945c849, Inferred from Screenshots and Code)

| # | Current Path | Steps | Issue |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------- |
| T1 | Home starts with “Needs your attention,” followed by sections per device | 0 | The attention section includes running conversations, and its count differs from the sidebar Inbox (P1). |
| T2 | Tap a conversation on Home → “Allow once” | 2 | Smooth |
| T3 | Open a conversation → Open changes with the top-right icon → Select a file → Drag horizontally to read long lines → Close panel → Tap input → Send | 6 to 7 | Changes uses an unlabeled icon (P3), and long lines require horizontal dragging (P4). |
| T4 | Click New Conversation on a project page → Open the project list and select a project → Choose AI tool → Write first message → Start | 5 | The project must be selected again even from its page, and the first message uses a single-line field (P2). |
| T5 | Tap Stop in a conversation | 1 | Stops immediately, without confirmation or undo (P5). |
| T6 | Sidebar search field → Type title | 2 | Searches only already-loaded titles, missing older conversations. The field appears to search everything (P6). |
| T7 | Offline notice and Recheck, plus Enter Pairing Code and View Other Computers on the removal page | — | Physical acceptance passed, but slow networks and errors have not been reviewed systematically. |
| T8 | Draft, conversation, changes panel, selected file, and scroll positions persist | — | Passed on emulator. Restoration after OS process reclamation has not been tested on hardware. |

## 3. Findings and Recommendations

Items marked “Your decision needed” change the prototype or rules. These were decided in section 5. The others are implementation deviations to fix directly.

**P1 Home's “Needs your attention” and sidebar Inbox mean different things (your decision needed)**

- Home currently combines awaiting-approval and running conversations, as the prototype's `screens.js` `live` selection does. Sidebar Inbox contains awaiting approval, completed awaiting review, and failed. The screenshots show counts of 2 and 3. Running conversations require no user action yet appear in the attention section.
- This is a prototype design error, rather than an implementation error.
- Put only items requiring user action in Home's first section, using the same data and counts as Inbox. Put running conversations in a second “Running” section. Keep the device groups.

**P2 New Conversation ignores its opening context (fix to match prototype)**

- The prototype preselects the project when opened from a project page, device page, or sidebar project-row “+”. The implementation requires selecting it again. The report states that manual project selection was retained.
- The first message is a single-line field that cannot display longer instructions well. Make it multiline, at least four lines high, with further growth supported.
- Ctrl+Enter starts from the keyboard.

**P3 Changes is hard to discover (your decision needed)**

- The top-right changes button is an unlabeled icon. Reviewing changes is central to the tablet (S5), so the entry should be immediately recognizable.
- Use a label such as “Changes 3,” where 3 counts changed files, and hide it when there are no changes.

**P4 Long lines require horizontal dragging (your decision needed)**

- Code lines require horizontal dragging in the 420-wide panel and the 520-wide portrait overlay.
- Enable wrapping by default and add a Wrap toggle at the top. Disabling it restores horizontal scrolling. Remember the last choice.

**P5 Stop lacks confirmation (your decision needed)**

- One tap stops the task irreversibly. Accidental palm input is more common on tablets. A7 in 04 plans unlocking before approval and stop, but is not implemented.
- Until A7, confirm stopping with “Stop this turn? Changes already made will be kept.” Replace this with unlock once A7 is implemented. Approval needs no extra confirmation because it is the most frequent quick action and its command is visible in the card.

**P6 Search scope is unclear (addressed by B4a)**

- Search looks global but covers only already-loaded conversation titles.
- Integrate server-side `conversation.search` after B4a adds it. Until then, state “Searches only titles of previously opened conversations” in the search dialog. Similar wording already exists, so confirm its visibility on hardware.

**P7 Selection and copying (to test)** — Check whether messages, approval commands, and diffs support long-press selection and copying. Tablet users often need to move output or commands elsewhere. Failure is a major T3 issue.

**P8 Position in long conversations (to test)** — Determine whether incoming messages pull readers back to the bottom while reading older content and whether a Jump to Latest action exists.

## 4. Validation

The physical interaction test prompt is `docs/reviews/t1a-tablet-interaction-test-prompt.md`. It covers three activities.

- Perform T1–T8 from section 1, recording steps, time, and sticking points.
- Inspect gestures, scrolling, keyboards, selection and copying, repeated taps, loading and error states, accessibility, and long content.
- Ask you to spend 15 minutes on six tasks while the executing agent records screen video and timing, then asks a few questions.

Classify findings as **blocking** (cannot complete or produces errors), **cumbersome** (completes but requires extra steps, guessing, or backtracking), or **minor** (appearance or wording). After testing, I will add results here and define the fix scope.

## 5. Decisions Made (2026-11-09)

You accepted the recommendations. They are reflected in 07 §4's Interaction Rules and prototype pages 02-01, 02-04, 02-13, and 02-14.

1. P1 puts only actionable items in Home's first section, matching Inbox, and separates running conversations into “Running.”
2. P3 labels the entry “Changes 3.”
3. P4 enables diff wrapping by default and adds a Wrap toggle.
4. P5 and I7 require stop confirmation until A7.
5. I6 makes Device › Project clickable on iPad and supports a rightward swipe from the left edge to return.

Implement these on iPad in r4, item 14. For Android, wait for interaction-test results and include these with the discovered issues in the next fix prompt.

## 6. iPad (`30e8b9f`)

Based on physical acceptance on iPad Air 11-inch (M4), iPadOS 27.2 (`~/agenthub-archive/i1-report.md`, “Physical-device acceptance (30e8b9f)”), and inspection of `apps/ios`. Acceptance was blocked at conversation creation, leaving later interactions untested on hardware. Most observations below are code inferences to confirm in interaction testing.

P1–P8 also apply on iPad, with the following additions.

| # | Severity | Issue | Resolution |
| --- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| I1 | Blocking | New Conversation always reports “This operation is not supported by the current conversation.” `SupervisorClient.swift:280` reads `providerExecution` from tool capabilities, although it belongs to device capabilities (`packages/protocol/src/machines.ts:38`). Emulator fixtures incorrectly placed it on the tool, hiding the defect. | Fix in r4 |
| I2 | Cumbersome | Background refresh every 10 seconds sets `isBusy`, disabling input and send (`TabletViews.swift:1224`, `AppModel.swift:847`, `:858`). While typing, the keyboard may dismiss and send flashes disabled. | Fix in r4 |
| I3 | Cumbersome | Conversation polling every 750ms opens “Operation not completed” after a single failure (`AppModel.swift:841-843`). Offline, it reappears after dismissal. | Fix in r4 |
| I4 | Cumbersome | New messages always scroll to the bottom (`TabletViews.swift:1195`), pulling readers away from older content, with no Jump to Latest. Desktop rules follow only while already at the bottom (AGENTS.md). This is an implementation error (P8). | Fix in r4 |
| I5 | Cumbersome | Opening landscape changes does not collapse the sidebar (`TabletViews.swift:253` always shows it in wide mode), leaving about 460pt for the conversation. 07 requires collapsing it. | Fix in r4, item 3 |
| I6 | Cumbersome | No Back navigation. Routing is custom rather than `NavigationStack`, with neither landscape Back nor an edge-swipe gesture. Returning from a conversation to its project requires the sidebar. Android's system Back makes this specific to iPad. | Decided, implement in r4 |
| I7 | Cumbersome | Send and Stop occupy the same position (`TabletViews.swift:1226`). Send immediately becomes Stop, so a second rapid tap stops the turn just started. | Decided, implement in r4 |
| I8 | To test | On iOS, `.textSelection(.enabled)` may allow only whole-paragraph copying rather than partial selection. Each diff line is a separate paragraph, potentially limiting copying to one line (P7). | Decide after testing |
| I9 | To test | Hardcoded `.system(size:)` font sizes may ignore Larger Text in system settings. | Decide after testing |
| I10 | To test | Common iPad interactions are absent, including long-press and right-click conversation menus, trackpad hover, and swipe-left actions. The prototype also omits them. | Observe whether users look for them |
| I11 | Minor | New Conversation preselects the first available project instead of the current project's context (P2), and ⌘↩ does not work in its dialog. | Fix with P2 |
| I12 | Minor | The removed page names the first unavailable computer (`AppModel.swift:884`), potentially identifying the wrong one when several exist. | Fix in r4 |

Run `docs/reviews/i1-ipad-interaction-test-prompt.md` for physical interaction testing after r4 is pushed and reviewed.

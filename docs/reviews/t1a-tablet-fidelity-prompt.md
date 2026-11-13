# Task: fixes after T1a tablet acceptance (state retention, removed page, copy, prototype fidelity)

Run on Windows. Change only `apps/android`. Create branch `fix/t1a-tablet-fidelity` from latest `origin/fix/android-retry-explicit-failure`; wait if that branch is not yet pushed. Worktree `D:/Projects/Software/agenthub-work/fix-t1a-tablet-fidelity`.

References (all on `origin/ux/design`, read with `git show`):

- `docs/ux-redesign/07-tablet.md`: layout rules and page table;
- Tablet prototype `docs/ux-redesign/tablet/`: `index.html`, `*.js`, and `*.css`. Colors, spacing, and typography follow `tablet.css`, `components.css`, and `conversation.css`; page-numbered screenshots are under `docs/ux-redesign/tablet/png/`;
- `docs/ux-redesign/06-pairing-remote-control.md` section 1: UI-copy rules;
- "Physical-device acceptance (Android tablet)" in `D:/Projects/Software/agenthub-archive/t1a-report.md`, listing physical/prototype differences page by page; screenshots `t1a-shots/tablet-tb375fc-20261107/`.

Before starting, confirm that this file has four second-level headings and that the final section is "Report".

## Goals

Functional acceptance on Lenovo TB375FC largely passed. One state-retention defect and several prototype mismatches remain. The prototype defines the UI; implement it faithfully without redesigning in code (`AGENTS.md`).

**Required changes** (behavior and rules):

1. **Retain the changes panel on rotation and width changes**: fullscreen landscape/portrait switching currently closes it and loses the selected file/diff. Under 07, landscape docks it on the right at width 420 and collapses the sidebar, which can be reopened; portrait overlays it from the right at width 520. Width changes affect placement only, retaining open state, file selection, and diff scroll position, including split-screen resizing. Preserve them after process reclamation using existing saved-state mechanisms.
2. **Removed page**: follow prototype 04-06 and route `#/home?removed=1` in 07. Show a red warning atop Home, retain the sidebar, name the computer that removed this device, and offer "Enter pairing code" and "View other computers". The current standalone page offers only "Pair again".
3. **Copy rules**: 06 section 1 forbids Host, Node, Machine, ProductDevice, Supervisor, Relay, authorization, grant, and fingerprint in UI. Connection checks currently show "Relay / Supervisor" and "Relay only".
   - Follow 04-04: a separate page with top-left Back, plain-language connection descriptions, status badges, and prototype styling for "Check again".
   - Forced transport switches and key-protection levels (TEE, etc.) are absent from the prototype. Show them only in debug for acceptance; hide in release.
   - Audit the rest of the app for violations.

**Recommended changes** (prototype fidelity where backend data exists):

4. **Lists and segments** (02-01, 02-02, 02-12, 03-04, 03-05): segment counts and white selected background; separate status pills (03-04); colored status dots, AI tool, project, and relative time in rows; search-field styling; circular sidebar count badges and icons. Match 02-02 grouping, icons, status labels, times, and "View" / "Got it" actions.
5. **Changes panel** (02-04): file totals and addition/deletion summary; per-file icons and counts; display paths relative to the project while retaining raw paths (desktop already has this rule); full-row red/green diff backgrounds; centered heading.
6. **Conversation** (02-03, 02-05): white command box inside approval cards, light-gray rounded Reject; running progress bar, spinner, current action, elapsed time, and red Stop as in the prototype.
7. **New conversation** (02-10, 02-11): centered title, Cancel/Start top bar, horizontal AI-tool segments.
8. **Devices** (03-01, 03-02): one group per device, expanded projects/paths/conversation counts, separate pairing card below.
9. **Settings** (04-01, 04-05): same-page groups; pairing/last-used dates for accessible computers with red trailing Remove; a separate roadmap page with Back, icons, and descriptions.

If backend data is genuinely unavailable (for example no project root in Supervisor responses, preventing relative paths), neither fabricate it nor modify the backend. List the gap in the report and display existing data.

**Outside this round**:

- T1b: pin, rename, add/remove projects, previous conversations, project search; notifications, background connection, pre-approval unlock. These appear in the prototype but remain absent in the app.
- System UI (status bar, multitasking entry, stylus button) and test-data differences (device/conversation names and counts).
- External keyboard: the user has no physical keyboard, so skip it.

## Known facts

- **Wide layout**: at least 900dp wide and landscape (`apps/android/app/src/main/java/org/codetether/app/ui/TabletApp.kt:165`). TB375FC is about 1385dp landscape, 866dp portrait, and 689dp split-screen.
- **Relevant code**: UI is under `apps/android/app/src/main/java/org/codetether/app/ui/` (`TabletApp.kt`, `TabletPages.kt`, `TabletState.kt`, `TabletController.kt`). Reuse T1a r2 state persistence (`SavedStateHandle`, `rememberSaveable`; "Review fixes r2" in `t1a-report.md`).
- **Validation environment**: only dedicated emulator `codetether_t1a_pixel_tablet_api36`. Use synthetic screenshots to compare with prototypes. Ask before physical-tablet retesting, which requires a new debug APK.
- **Size**: if changes exceed about 30 files or 3000 lines excluding tests/screenshots, complete and push 1-3 first, then 4-9; explain in the report.
- iPad shares this design and will reuse the difference list. Describe differences clearly enough for reuse.

## Boundaries

- **Decide independently**: implementation, commit boundaries, tests/screenshots, and unspecified details inferred from prototype HTML/CSS.
- **Ask the user first**:
  - Code outside `apps/android`, including backend/Rust core;
  - Conflicts between prototype and 07 prose;
  - Installing new builds on physical tablets/phones;
  - Displaying anything absent from the prototype.
- **Do not**: read/print credentials; push `main`, merge, tag, or force-push.

Push the branch to `origin` without merging.

## Report

Append a new "Tablet acceptance fixes" section to `D:/Projects/Software/agenthub-archive/t1a-report.md`.

- Changes and corresponding commits for each item 1-9;
- State-retention tests after rotation, split-screen, and process restoration;
- Emulator captures for every prototype page, remaining differences, and reasons (missing backend data, T1b, system UI);
- List of backend data gaps;
- Gradle/instrumentation results with failures verbatim, plus debug APK size and SHA-256;
- Incomplete work and reasons, with the level of completion reached.

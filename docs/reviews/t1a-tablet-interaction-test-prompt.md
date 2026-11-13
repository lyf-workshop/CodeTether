# Task: physical Android tablet interaction testing

Run on Windows, where T1a's toolchain and `adb` are installed. Testing only: no repository changes or commits. Sending this prompt authorizes installing the `945c849` debug build on Lenovo TB375FC.

References (all on `origin/ux/design`, read with `git show`):

- `docs/ux-redesign/09-tablet-usability.md`: tasks, current paths, and hypotheses P1-P8;
- `docs/ux-redesign/07-tablet.md` and prototype `docs/ux-redesign/tablet/`;
- Android-tablet section of `docs/reviews/device-recheck-prompt.md`, incorporated here instead of a separate retest.

Previous results: `D:/Projects/Software/agenthub-archive/t1a-report.md`. Procedures/scripts: `t1a-logs/tablet-tb375fc-20261107/`.

Before starting, confirm that this file has four second-level headings and that the final section is "Report".

## Goals

Functionality is already accepted. This round measures usability: steps for common tasks, uncertainty, mis-taps, and whether errors explain recovery.

**A. Common tasks** (T1-T8 in 09 section 1, at least once each on direct and internet connections). Record:

- Actual steps, counting every tap, input, and swipe; differences from the paths inferred in 09 section 2;
- Start-to-finish time;
- Hesitation, mistakes, or backtracking, with screenshots.

**B. Interaction details**:

- System Back gestures at every layer (sidebar, dialog, changes, conversation, settings subpage): correct destination, without accidentally exiting;
- Scrolling: fast scrolling through long conversations; new messages while reading earlier content, position changes, and a "Latest" action (P8); retained list/conversation positions after leaving and returning;
- Keyboard/IME: input obscuration, focus/keyboard after sending, and accidental sends when Enter commits Chinese composition;
- Selection/copy: long-press selection of messages, approval commands, and diffs (P7);
- Repeated taps: rapidly tap Send, Allow once, Start, and Mark done, verifying one execution;
- State/feedback: latency to button/spinner/message feedback, loading, empty, offline, slow network (developer settings or Wi-Fi disconnection/reconnection), and errors; whether messages explain what happened and recovery;
- New conversation (P2): open from Home, project, device, and sidebar project row; check project preselection and visibility of a three/four-line first message;
- Stop (P5): proximity to other controls and risk of accidental finger/palm activation;
- Search (P6): search an older unopened conversation title, recording results and explanation.

**C. Accessibility**:

- Enable TalkBack and complete T2/T3; verify names for icon-only controls (sidebar, changes, more, close);
- Maximum system font and increased display size: truncation, overlap, and clickable controls;
- Use layout inspection (`uiautomator dump` or Layout Inspector) to list clickable targets below 48dp;
- Text/background legibility in dark mode.

**D. Long content and large counts**:

- Long titles/project names/paths/commands, very long code lines, several-hundred-line diffs, several-hundred-message conversations, and many devices/projects in the sidebar;
- Generate real data on the physical tablet where possible. Use synthetic data on `codetether_t1a_pixel_tablet_api36` for impractical cases such as many devices, and label them.

**E. Retests** (tablet items from `device-recheck-prompt.md`):

- Production Relay is `e4bdd57`: force internet-only using the debug option, create five conversations, each adding exactly one computer conversation with the first message sent once and no stuck uncertain result;
- Process reclamation: open a conversation and changes, select a file, enter a draft, background the app, run `adb shell am kill org.codetether.app`, then return via Recents and verify all retained;
- Removed page/copy: remove the tablet on Windows, confirm Home's red warning, retained sidebar and two actions; no Host, Node, Machine, Supervisor, Relay, authorization, or fingerprint in UI except debug diagnostics; pair again with a new code.

**F. Fifteen-minute hands-on user trial**:

- After A-E, stop and ask the user to perform these six tasks without guidance. Record the tablet screen with `adb shell screenrecord` and time each task:
  1. Find a conversation awaiting approval, understand the command, and approve;
  2. Open a conversation with file changes, read all changes, and append "Add another test";
  3. Create a Codex conversation in the test project and ask a question;
  4. Start a task and stop it;
  5. Find a conversation from yesterday or earlier;
  6. Rotate portrait and landscape, then continue.
- Ask five questions afterward and record answers verbatim: hardest task; any uncertainty about where to tap; any mistakes; most desired improvement; overall experience compared with desktop.

## Known facts

- **APK**: `945c849` on `origin/fix/t1a-tablet-fidelity`, SHA-256 `1b3e3fb35fa37c58356254fa385bf43776b14ee48c028e9a7ba9fe8d4954726a` (`t1a-logs/t1a-tablet-fidelity-7-9/app-debug-945c849.apk`). Verify before installation.
- **Peer**: installed Windows `git-fd1d90540450`. Tablet was removed after previous testing and needs pairing; user generates the code on Windows.
- **Test project**: Windows `T1a TB375FC tablet acceptance`. All writes stay there. Real Codex may generate long conversations/diffs with small tasks.
- **Known data gaps** (already reported, not usability defects): project root, initial-pairing/last-used dates, execution percentage. Note when encountered.
- **Known unimplemented features**: T1b project search/add/import/pin/rename, notifications, background connection, pre-approval unlock. Their absence despite appearing in the prototype is expected.
- **Decided but unimplemented changes** ("Interaction rules" in `07-tablet.md` section 4, decided 2026-11-09): separate Needs attention/Running, "Changes N", diff wrapping switch, Stop confirmation, and new messages preserving reading position. `945c849` still has old behavior; record it against P1-P8 without treating it as newly discovered.
- **Physical keyboard**: none available; mark keyboard shortcuts "Not tested".
- Capture/record only the tablet screen. Tell the user file locations afterward without uploading.

## Boundaries

- **Decide independently**: test order/method, timing/records, data generation, environment troubleshooting, and retries. Record problems and continue other cases.
- **Ask the user first**: personal actions (USB authorization, installation confirmation, pairing codes, Windows removal, trial F); repository code changes; production configuration changes; clearing other apps' data/uninstalling them; changes beyond tablet system settings.
- **Do not**: read/print credentials; touch installed Windows data, remote machines, or Node; commit, push, tag, or fix code.

After testing, restore tablet settings (font/display size, TalkBack, dark mode, rotation, and modified developer options) and remove the test device on Windows.

## Report

Append "Interaction testing (945c849)" to `D:/Projects/Software/agenthub-archive/t1a-report.md`.

- APK SHA-256 and tablet/computer versions;
- **A**: one row per T1-T8 with actual step count/time, differences from 09 section 2, and difficulties;
- **Issue list**: severity (blocking / difficult / minor), page, reproduction, screenshot, and corresponding P1-P8 or new issue;
- **P1-P8**: confirmed, refuted, or untested;
- **C**: unnamed TalkBack controls, truncations, and sub-48dp target list;
- **E**: each of five Relay creates, process restoration, and removal/copy results;
- **F**: time/completion/difficulty for each user task, five verbatim answers, recording path;
- Restored settings, incomplete work, and reasons.

Record observed behavior and the user's words only. Design determines remedies.

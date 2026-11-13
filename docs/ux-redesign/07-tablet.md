# 07 · Tablet Application (T1)

Date — 2026-11-03. Based on the T1 column in 04, 03 §5 (native Android using Kotlin + Compose and a Rust connection core), 06 (pairing and remote operations), and the desktop v4 prototype. Tablet prototypes are in `tablet/`.

## 1. Decisions (Your Answers on 2026-11-03)

- **The tablet can perform all computer operations**, eliminating the need for a remote desktop. Only the following still require being at the computer.
  - Pairing a new device. The code appears only on the computer, which is a security boundary.
  - Installing and signing in to Codex or Claude Code through the computer's browser or terminal.
  - Initial computer setup and diagnostics.
- **Use the same layout as desktop**. The left sidebar contains Recent Conversations / Inbox / Devices › Projects › Conversations, with content on the right. Desktop users should already know how to use the tablet.
- **Use iPadOS-style visuals**, with grouped lists, large titles, translucent navigation bars, and centered form dialogs.
- **Keep colors as restrained as desktop**, as you decided on 2026-11-03. Primary buttons, selection, and send use monochrome ink colors (white in dark mode). Blue is reserved for links and running status. Purple appears only in the app icon.
- **Build tablet first and add the phone layout later**, as you decided on 2026-11-03. Tablet is the first Android UI, and M0 connection verification becomes part of the first tablet round.
- **Defer CC Switch-style configuration switching**. Switching AI tools' API services and model configurations from the tablet goes into Future Plans, with separate research before implementation.

The AI tools' limitations remain the same as on desktop. Approval, stop, and line-by-line changes are available only for Codex running locally on the computer. Codex on devices reached through a computer supports conversation only. Claude Code only reads and searches files.

## 2. Layout

| Element | Landscape (1280×800 dp) | Portrait (800×1280 dp) |
| -------- | ------------------------------------------------ | ---------------------------------------- |
| Sidebar | Persistent, 300 wide | Collapsed. The top-left button slides it in from the left. Tapping outside dismisses it. |
| Content | List pages up to 820 wide, conversation reading area up to 760 | Same |
| Changes panel | Opens on the right, 420 wide. The sidebar collapses automatically and can be reopened. | Overlays the conversation from the right, 520 wide |
| Form dialogs | Centered, 560 wide. Folder and import dialogs use 680. | Same |

Sidebar content follows.

- Top contains the application name and conversation search (Ctrl K).
- Recent Conversations and Inbox, with a count badge.
- Devices have one row each, followed by their projects and each project's five most recent conversations. Each device row has a “+” for Add Project on its right. Devices reached through a computer display “Via Computer name.” Offline groups are dimmed.
- Settings is fixed at the bottom.

External keyboard shortcuts are Ctrl N for New Conversation, Ctrl K for conversation search, Ctrl Enter for send, and Esc to close a dialog. Use ⌘ on iPad.

## 3. Visuals

- Grouped background is `#f2f2f7`, with white rows and cards rounded to 12. Dark mode uses a black background and `#1c1c1e` cards.
- List pages have 32-point large titles and one explanatory sentence. Conversation pages have centered two-line titles (conversation title / Device › Project · AI tool).
- Align colors with desktop's `packages/ui/src/styles/globals.css`.
  - Primary buttons, send, selected filters and checkmarks, and enabled switches use ink `#1c1c1e` with white text. Dark mode reverses this to `#f2f2f7` with dark text.
  - Sidebar selection uses a gray background and bold text, without a colored block.
  - Links use `#135e9c` (dark mode `#7cc0f2`), matching desktop `--ct-accent-text`.
  - Status colors use blue `#1a7fd0` for running, orange for awaiting approval, green for completed, and red for failed. Include text rather than relying on color alone.
  - The in-app mark is an ink-colored square with `>_`. Purple appears only in the launcher icon.
  - Do not adopt Android wallpaper colors (Material You). Light, dark, and system appearance modes remain supported.
- Touch targets must be at least 48 dp, as required by Android, compared with iPadOS's 44.
- Tokens are in `tablet/tablet.css`.

Implement this styling in Compose instead of using the default Material 3 appearance. This requires more work than a pure Material UI. System-owned notifications, permission dialogs, and fingerprint unlocking retain Android's native appearance.

## 4. Pages

Screenshots are in `tablet/png/`. Regenerate them with `bash docs/ux-redesign/tablet/export-png.sh`.

| Page | Route | Screenshots | Description |
| ---------- | ---------------------------- | -------------- | --------------------------------------------------------------------------------------------- |
| Sign-in | `#/signin` | 01-01, 01-02 | Email sign-in code. Existing accounts only. |
| First pairing | `#/pair` | 01-03 to 01-05 | Enter the computer's six-digit code. Incorrect and expired messages follow 06 §1. |
| Recent Conversations | `#/home` | 02-01 | Home. “Needs your attention” comes first, sharing the Inbox data and counts. “Running” is second, followed by a section per device with five conversations each. |
| Inbox | `#/inbox` | 02-02 | Segments for All / Awaiting Approval / Completed Awaiting Review / Failed. Approvals happen within the list. |
| Conversation | `#/c/:id` | 02-03 to 02-09, 02-13 | Approval cards, running states with and without stop support, failure and retry, imported conversations, and a More menu (pin, rename, archive). Stop requires confirmation (02-13). |
| Changes | `#/c/:id?panel=changes` | 02-04, 02-14 | Labeled “Changes N,” hidden when there are no changes. File list and line-by-line diff, wrapping by default with a Wrap toggle (02-14). Explain unsupported conversations. |
| New Conversation | Dialog | 02-10, 02-11 | Project → AI tool → Reasoning effort (Claude Code only) → First message. Explain offline projects and tools requiring sign-in. |
| Conversation Search | Dialog | 02-12 | Search titles of already-loaded conversations. |
| Devices | `#/devices`, `#/devices/:id` | 03-01 to 03-03 | Each device's projects, recent conversations, AI tool status, and connection method. “Enter pairing code” adds another computer. |
| Project | `#/projects/:id` | 03-04 to 03-06 | Conversations / Archived, status filters, project search, earlier conversations with selected import, rename, and remove. |
| Add Project | Dialog | 03-07 to 03-09 | Select device → Browse folders → Name → Find earlier conversations and select them for import. |
| Settings | `#/settings` | 04-01 to 04-05 | Account, available computers with removal, notifications, background connection, unlock confirmation, appearance, connection check, and future plans. |
| Removed | `#/home?removed=1` | 04-06 | Identify the computer that removed this device and explain how to pair again. |
| Portrait and Dark Mode | | 05-01 to 05-06 | Portrait sidebar, portrait changes overlay, dark mode, and a presentation image with a device bezel. |

### Interaction Rules (Your Decisions on 2026-11-09, Based on 09)

- **Needs your attention** contains only items requiring user action (awaiting approval, completed awaiting review, failed), using the same data and count as the sidebar Inbox. Running conversations go in “Running.”
- **Changes entry** reads “Changes 3” at the top right of a conversation, where 3 is the file count. Hide it when there are no changes.
- **Diff wrapping** is enabled by default. Turning off the panel's Wrap toggle enables horizontal scrolling. Remember the last choice.
- **Confirm before stopping** with “Stop this turn? Changes already made will be kept, and you can send another message.” Replace confirmation with unlock once 04's A7 is implemented. Do not add confirmation to approval. Confirmation also prevents rapid double clicks from stopping a turn when the user clicks the send location again immediately after sending.
- **New messages** follow automatically only when the user is already at the bottom. Otherwise show “New messages,” which returns to the latest content when clicked. Open a conversation at its latest content.
- **New Conversation** preselects the project when opened from a project page, device page, or sidebar project row. The first message is at least four lines high. Ctrl Enter (iPad ⌘↩) starts the conversation.
- **Back navigation (iPad only)** makes Device › Project below the conversation title clickable and supports a rightward swipe from the left edge to return to the previous page. Android uses system Back and does not implement these two interactions.
- **Background refresh** leaves fields and buttons enabled. Failures appear as page status without a dialog. Only failures of operations explicitly initiated by the user open a dialog.

## 5. Tablet Additions Compared with 04

| Feature | Previously in 04 | Now | Backend |
| --------------------------- | --------- | ------------ | ------------------ |
| P1 Add projects and browse folders | — | T1 | B4 |
| P2 Discover earlier conversations while adding a project | — | T1 | B4 |
| P5 Earlier conversations on the project page | — | T1 | B4 |
| P6 Remove projects | — | T1 | B4 |
| C3 Project search | T1 (B1+) | T1 | B4 |
| C4 Pin, rename, archive, and restore | L | T1 | B4 (archive already implemented in B1) |
| C5 Conversation search, Ctrl K | L | T1, titles only | None required |
| Settings › Available Computers | — | T1 | Available |

The tablet still excludes Node pairing, connection-address updates, Relay settings, and device unpairing. These happen on the computer, with most disappearing after E1. AI tool installation and sign-in, first startup, and diagnostics also remain on the computer.

## 6. New Backend Stage B4 — Remote Management

All operations use Supervisor, require control permission, support `actionId` idempotency, and perform the same checks as local interfaces.

| Operation | Purpose | Existing Local Capability |
| ------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------ |
| `folder.list` | List subfolder names in one folder on a device, one level at a time with a count limit | None. Desktop uses the system folder picker. |
| `project.create` / `project.remove` | Add and remove projects | Available. The same folder cannot be added twice, and projects containing conversations cannot be removed. |
| `provider-sessions.discover` / `.adopt` | Scan for earlier conversations in a folder and import them | Available |
| `conversation.search` | Project search | Available |
| `conversation.pin` / `.rename` / `.restore` | Pin, rename, and restore | Available |

- `folder.list` is a newly exposed capability that can browse all folders on the computer, as you decided on 2026-11-04. Start at the user directory and allow navigation up to the disk root, listing drives on Windows. Return folder names only, with no files, one level at a time and with a count limit. Only devices with control permission may use it. Mark inaccessible folders “Cannot open,” hide hidden folders by default, and time out slow network-drive reads. On macOS, first access to Desktop, Documents, or Downloads triggers a permission prompt on the Mac. The B4 design determines how to handle it.
- These operations also apply to devices accessed through a computer. Desktop's current requirement to enter an absolute path when adding a project on a paired device (04 P9) may also be replaced with browsing.
- Phones use the same interfaces. The M series determines which features their UI exposes.

B4 depends on B1 (merged as `9694895`) and may proceed alongside B2 and B3. T1a depends on B1. T1b depends on T1a and B4. See §8.

## 7. Outstanding Decisions

1. ~~Tablet or phone first~~ — Tablet first, as you decided on 2026-11-03. See §8.
2. ~~Root scope for `folder.list`~~ — All folders may be browsed, as you decided on 2026-11-04. See §6.
3. No physical Android tablet is available. Validate with a tablet emulator configuration first and record “Not validated on a physical device.”
4. For CC Switch-style switching, first investigate how CC Switch actually changes configuration and where Codex and Claude Code read it. Then decide whether to implement it and in which stage.

## 8. Two Implementation Rounds

Build tablet first, including M0 connection verification in the first round. Add phone layouts (M1, M2) to the same application later.

| Round | Scope | Dependencies | Prompt |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | --------------------------------------- |
| **T1a** | Android application skeleton, Rust connection core (direct and Relay), device keys in Keystore, sign-in, pairing, and every page and operation already supported by the backend. This includes Recent Conversations, Inbox, approval and rejection, stop, conversations, creation, replies, changes, archive, devices and projects, title-only conversation search, and Settings sections for account, available computers, appearance, and connection checks. | B1 (merged as `9694895`) | `docs/reviews/t1a-tablet-app-prompt.md` |
| **T1b** | B4 remote management, including adding projects, folder browsing, earlier conversations, project removal, project search, pinning, renaming, and restoration | T1a + B4 | To be written after B4 |
| **I1** | iPad application using SwiftUI, reusing T1a's Rust core with device keys in Secure Enclave and the same scope as T1a. Install with a free Apple ID, as you decided on 2026-11-04. | T1a | `docs/reviews/i1-ipad-app-prompt.md` |
| Later | Notifications and background connection (B2 + M3), unlock confirmation, phone layouts (M1, M2) | — | — |

T1a features without backend support (adding projects, earlier conversations, pinning, renaming, restoration, project search, notifications, background connection, unlock confirmation) remain absent from the UI and appear only in Settings › Future Plans. See 03 §6, “The UI shows only capabilities actually provided by the backend.” The prototype includes them in preparation for T1b and later work.

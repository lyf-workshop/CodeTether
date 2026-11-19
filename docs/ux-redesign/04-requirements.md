# 04 · Requirements (desktop · tablet · phone)

Date: 2026-10-19. Status: **Third draft**, revised based on your answers to §9 of the first draft and R1–R4 of the second draft, with no open questions (see §9).
Sources: your ideas from the discussion, code at the accepted baseline `bbcda69`, v4 prototypes (`34b8ee5`), 01 feature inventory, and 03 project plan. Once confirmed, this document governs subsequent design, prompts, and reviews; the phase table in 03 will be adjusted to match.

## 1. Goals

CodeTether is a control center for AI coding tools. It should solve these problems:

1. Instead of opening terminals, changing into folders, and launching Codex and Claude Code separately, choose a device and project in one app to create or continue a conversation.
2. Keep conversations previously started from the command line: automatically find them when a project folder is selected, import them, and continue working.
3. See at a glance which conversations are running, awaiting approval, completed, or failed, and which device and project each belongs to.
4. Away from the computer, comfortably talk to Codex and Claude Code from a phone: create conversations in existing projects and continue replying, with a composer as complete as the desktop one; receive push notifications when needed, and safely approve or stop work. Use a tablet to read conversations and review changes comfortably, and also create conversations and reply.
5. Every button in the interface must work; features not yet implemented appear only on the “Planned features” page.

## 2. User and scenarios

The user is you: an individual developer who uses AI coding tools daily and owns several computers and servers. Team and enterprise administration are out of scope.

| # | Scenario | Client |
|---|---|---|
| S1 | Open the computer, see projects and ongoing conversations on every device, and continue working | Desktop |
| S2 | Add a folder as a project and import conversations previously started from the command line | Desktop |
| S3 | Start a Codex conversation in a project on a paired Linux server or Mac | Desktop |
| S4 | While out, receive a phone notification that “1 item needs approval,” open it to understand the operation, then approve or reject it | Phone |
| S5 | After a task finishes, read the full conversation and review changes line by line on a tablet, then add another instruction | Tablet |
| S6 | When a conversation fails, see the cause and next step, then retry or rephrase | All three |
| S7 | Stop a conversation immediately when it goes off track | All three (only Codex conversations running locally on the computer) |
| S8 | Think of a question while traveling, create a Claude Code conversation in a project from the phone, ask it and lock the screen; receive a notification when it finishes and return to continue | Phone |
| S9 | Continue replying from the phone after leaving a conversation open on the computer | Phone |

## 3. Core concepts and rules

- **Account › Device › Project › Conversation**: every interface follows this hierarchy.
- **Account**: sign in with an email login code. The MVP only supports existing accounts; in-app account registration comes later (A9). The desktop must be signed in before phones and tablets can access it; paired devices do not need accounts.
- **Device**: a computer capable of running AI tools, including “This computer” and devices paired using CodeTether Node (Linux x64 / arm64, macOS arm64). There are no read-only devices: every listed device supports browsing, creating conversations, and sending messages.
- **Phones and tablets are not devices**: they are remote clients that sign in with the same account and access a computer and its paired devices through that computer. They do not run AI tools and do not appear in the “Devices” list. On phones and tablets, show a computer by its name (for example, “Windows desktop”), never as “This computer.”
- **Remote clients do not affect work on the computer**: closing the phone or tablet app, backgrounding it, locking the screen, losing connectivity, having the OS terminate it, signing out, or uninstalling it never stops or pauses conversations on the computer. Only tapping “Stop” stops them. When the phone returns, it reads the state again and displays the computer’s actual progress.
- **Access is granted separately for each computer**: each phone or tablet must be paired once with each computer using a pairing code. The code appears only on the computer, so pairing requires physical access to it. A computer can remove a phone or tablet at any time; that client must use a new pairing code to regain access. Removal affects only that computer.
- **Project**: one folder on one device. The same folder on the same device can belong to only one project. Removing a project unregisters it without deleting files.
- **Conversation**: a dialogue with one AI tool within one project. A conversation cannot switch AI tools or devices.
- **AI tools**: Codex and Claude Code have different capabilities; the interface reflects actual support:
  - Codex on the local computer: dialogue, approvals, stopping, and viewing changes.
  - Codex on paired devices: dialogue.
  - Claude Code (on any device): dialogue, file reading and searching only, with no file modifications or command execution; reasoning effort can be selected at creation.
- **Show only real capabilities**: do not offer buttons for operations unsupported by the backend; explain the reason in place. Features not yet implemented appear only on the “Planned features” page. No fake toggles.
- **Demo data**: clearly labeled; demo actions must not call real authentication, deletion, or AI execution APIs.

## 4. Feature inventory

How to read the tables:

- The three client columns identify the phase in which that client gains the feature (see 03 §4): `D1` desktop v4 finishing work, `M1` phone viewing, `M2` phone dialogue and actions, `M3` phone push notifications, `T1` tablet, `X1` composer enhancements for all three clients (after M2), `L` later, and `—` not planned for that client.
- Backend column: `Available` means the backend already supports it; `B0` / `B1` / `B2` / `B3` means it depends on that backend phase; `New` means a new backend capability is needed and has not been scheduled.
- Desktop entries marked `D1` have been implemented, accepted, and released as `v0.1.0-alpha.2`.
- The tablet column was revised following the 2026-11-03 decision: tablets support all desktop operations (see 07). `B4` is the remote management backend phase.

### 4.1 Accounts and access

| # | Feature | Desktop | Tablet | Phone | Backend | Notes |
|---|---|---|---|---|---|---|
| A1 | Email-code sign-in and sign-out | D1 | T1 | M1 | Available | Existing accounts only; sign-in page `/signin` is in Chinese. After sign-in, phones and tablets register as remote clients using the system device name |
| A2 | Allow phones and tablets to access this computer | M1 | — | — | Available / B0 | Settings › Account › Phones and tablets. Off by default; this computer becomes visible to phones and tablets only after you enable it. The old `/hosts` page has this flow (with Mac hardcoded in its copy); v4 hid the entry, which must be restored in Settings |
| A3 | Pair using a code | B1 | Enter code | Enter code | B1 / New | On the computer: Devices › “Add device” (one entry for computers, phones, and tablets; see 03 §1.1), showing a 6-digit numeric pairing code and remaining time. On the phone or tablet: select this computer and enter the code. A correct code pairs immediately, without another Allow click on the computer; the computer’s code dialog changes to “Added · Device name.” Rules: codes last 5 minutes and are single-use; 5 incorrect attempts invalidate a code and require generating another on the computer; closing the dialog or clicking “Cancel” invalidates it immediately. Pairing accepts only phones and tablets signed in to the same account. Each phone–computer pair is paired once and remains valid while in use and not removed (automatic renewal). The current phone-request / computer-allow flow is replaced in B1; issuance controls and automatic renewal must also be added (currently expires after 30 days without renewal), and Android currently appears as “Other platform” |
| A4 | ~~View only / Control~~ | — | — | — | — | Removed (2026-11-03): one permission level only; pairing enables viewing, creation, replies, approvals, and stopping, subject to AI tool support. B1 must still restrict the grant API to actions initiated by you through the computer UI (request origin is currently unchecked) |
| A5 | Remove a device | B1 | — | — | B1 | The “Phones and tablets” section at the bottom of Devices lists paired clients: name, OS, and last used (06 §1). “Remove” disconnects immediately; a new code is required to pair again. Affects only this computer and never its running work. Revocation currently takes up to about 5 minutes to disconnect; B1 makes it immediate. No separate “Block” feature: codes are generated only on the computer, so without you generating one it cannot connect |
| A6 | View this phone or tablet’s access status | — | T1 | M1 | Available | Show accessible computers and last connection time; after removal, explain the reason and next step (generate a new code on the computer) |
| A7 | Unlock before approving or stopping | — | T1 | M2 | Not needed | Confirm using the system fingerprint, face authentication, or lock-screen passcode; lock-screen notifications can only open the app, never perform actions directly. Sending messages does not require confirmation each time. On by default; can be disabled in phone settings |
| A8 | Lost phone: revoke it from the account | L | L | L | Available / New | From any signed-in computer, tablet, or phone, revoke another phone or tablet on the same account so all computers reject it. Control Plane already has the API, but no UI; immediate disconnection depends on A5 |
| A9 | Register a new account in the app | L | L | L | New | The backend currently has no registration, only sign-in to existing accounts. After the MVP |

### 4.2 First launch and settings (primarily desktop)

| # | Feature | Desktop | Tablet | Phone | Backend | Notes |
|---|---|---|---|---|---|---|
| O1 | Startup checks | D1 | — | — | Available | Automatically retry 5 times, with “Check again”; go to “Devices” when complete |
| O2 | Six first-launch screens | D1 | — | — | Available | Welcome / AI tools / Projects / Previous conversations / Other devices / Done. The AI tools screen displays “Installed,” “Can run,” and “AI service” separately, without inferring one from another (UX-V4-001) |
| O3 | Appearance: light / dark / system | D1 | System | System | Not needed | Desktop defaults to light |
| O4 | Settings › Account | D1 | T1 | M1 | Available | Sign-in status and sign-out; desktop also includes A2–A5 |
| O5 | Notification toggles: approval needed / work completed / execution failed | D1 | T1 | M3 | Available / B2 | All enabled by default; desktop controls OS notifications, phone and tablet control push notifications |
| O10 | Background connection and setup guidance | — | T1 | M3 | B2 | Push relies on a background connection from the phone to the computer (see B2); Android requires a persistent “Keeping connection active” notification during this time. It can be disabled; then alerts arrive only while the app is open. When enabling push for the first time, guide users through allowing notifications, disabling battery optimization, allowing autostart, and locking the app in recent tasks, with paths by brand (vivo, Xiaomi, OPPO, Honor, Huawei). Show actual status for settings readable from the OS (notification permission, battery optimization); give paths only for the rest |
| O6 | Settings › Background operation | D1 | — | — | Available | Explanation only: continues running after the window closes, tray behavior, and how to quit. No toggle |
| O7 | Settings › About and checks | D1 | Version | Version | Available | Desktop has the full checks page (diagnostics, check again, rerun setup) |
| O8 | Planned features page | D1 | T1 | M1 | Not needed | Lists features not yet implemented; other pages link here when mentioning unsupported capabilities |
| O9 | Launch at startup | L | — | — | New | Appears only in planned features for now |

### 4.3 Devices

| # | Feature | Desktop | Tablet | Phone | Backend | Notes |
|---|---|---|---|---|---|---|
| E1 | Devices page | D1 | T1 | M1 | Available | Desktop start page; phone home is “Conversations” (C8). One section per device: name, connection status, OS · architecture · connection method, containing that device’s project cards. This computer comes first |
| E2 | Device details | D1 | T1 | M1 simplified | Available | Projects, recent conversations (latest 100), AI tools, connection. Phone shows only projects and recent conversations |
| E3 | AI tool status | D1 | T1 viewing only | M1 viewing only | Available | Display installation and runtime status separately; mark as “Last known” when offline; desktop offers sign-in help links and installation choices |
| E4 | Offline explanation | D1 | T1 | M1 | Available | Show “Offline · Last online …” (device summaries include lastSeenAt, same API locally and remotely); show only “Offline” when no timestamp is available |
| E5 | Add device · Pair Node | D1 | — | — | Available | Four steps: Preparation (commands and supported OSes) → enter address or pairing link + 6-digit code → verify confirmation code → proceed directly to “Add project” when complete. State that Windows cannot currently be paired. After E1, replace with “same-account sign-in + pairing code” from 03 §1.1 and remove this entry |
| E6 | Update connection address | D1 | — | — | Available | Available in both the connection card and offline explanation. Remove after E1 (automatic connection requires no address) |
| E7 | Internet Relay configuration | D1 | — | — | Available | Single-use token, retry, and remove in the connection card’s “Advanced” section. Relay configures automatically after B1; remove this entry after E1 |
| E8 | Unpair | D1 | — | — | Available | If the device still has projects, the dialog lists them and offers no confirmation button |
| E9 | Use a Windows computer as a device | E1 | — | — | New | Solved by E1: the desktop app itself becomes accessible, eliminating the need for Windows Node |
| E10 | Other computers on the same account as full devices | E1 | — | — | New | One computer is one device: sign in with the same account and add it with a pairing code (later also allow clicking “Allow” on the computer). Afterward Node disappears from the interface. Conversations belong only to their executing computer, with consistent conversation lists across devices. Until then, v4 keeps its current behavior and does not show other hosts (see 03 §4 E1) |
| E11 | Group by device when multiple computers exist | — | T1 | M1 | Available | On phones and tablets, both “Devices” and “Conversations” (C8) are grouped by device: one section for each computer and each paired device. Section heading: name · online status; paired devices add “Via Computer name.” “Devices” sections contain that device’s projects; “Conversations” sections contain its conversations. When a computer is offline, devices reached through it show “Offline · Via Computer name”; the entire section is dimmed and opening it explains “Waiting for Computer name to come online.” A Node can pair with only one computer at a time (revoke before switching), so the same server never appears twice. Order: online computers first, with each computer’s paired devices immediately after it. UI example in §9 R1 |

### 4.4 Projects

| # | Feature | Desktop | Tablet | Phone | Backend | Notes |
|---|---|---|---|---|---|---|
| P1 | Add project · Choose folder | D1 | T1 | — | Available / B4 | Device → folder (system picker or path entry for this computer; full path entry only for paired devices) → name. If the folder has already been added on the same device, open the existing project |
| P2 | Add project · Automatically find previous conversations | D1 | T1 | — | Available / B4 | Step two automatically scans this folder for Codex / Claude Code conversations, grouped by AI tool; resumable ones are checked by default, with “Import selected” or “Skip.” Scanning also works on paired devices |
| P3 | Project details · Conversation list | D1 | T1 | M1 | Available | Pinned first, then by recent activity; “Conversations / Archived” segments. The remote API returns archived conversations (with an archived flag) without pinning metadata, so tablets and phones sort by recent activity only |
| P4 | Filter by status and AI tool | D1 | T1 | — | Available / New | All / Running / Awaiting approval / Completed / Failed + AI tool. The remote API used by phones and tablets has no filter parameters; tablets initially filter the loaded list locally |
| P5 | Project details · Previous conversations | D1 | T1 | — | Available / B4 | Persistent section: rescan, load more, “Open” for imported entries, explanations for unsupported formats and offline devices; automatically rescan expired candidates while preserving selections |
| P6 | Remove project | D1 | T1 | — | Available / B4 | Unregister only, without deleting files; if conversations remain (including archived ones), explain in advance that removal is unavailable and offer only “Got it” |
| P7 | Project unavailable explanation | D1 | T1 | M1 | Available | Missing folder, offline device, etc.; history remains readable |
| P8 | Pagination beyond 100 conversations | L | T1 | M1 | Available / New | The remote API supports pagination; tablets and phones use “Load more.” The local API used by desktop caps at 100 with no pagination; explain this and direct users to project search for now |
| P9 | Browse folders on paired devices | L | — | — | New | Currently full path entry only |

### 4.5 Conversations

| # | Feature | Desktop | Tablet | Phone | Backend | Notes |
|---|---|---|---|---|---|---|
| C1 | Create conversation | D1 | T1 | M2 | Available / B1 | Existing projects only. Order: project (recently used first, others grouped by device, same device order as E11) → AI tool → reasoning effort (Claude Code only). Explain why unavailable projects cannot be used. Desktop creation sends no first message; tablet and phone creation sends the first message simultaneously (required by the remote API), using the W4 composer |
| C2 | Creation entry points | D1 | T1 | M2 | Available | Desktop: sidebar button (Ctrl N), project-row “＋”, project details, Devices page. Tablet: top of conversation list and project details. Phone: create button at lower right of “Conversations” and project details |
| C3 | Search within project | D1 | T1 | — | Available / B4 | Search titles and messages you sent, with keywords up to 160 characters; explain the scope; combine multiple matches in one conversation into one row; show “Load more” only when another page exists. Tablet needs a new remote search API |
| C4 | Pin, rename, archive, restore | D1 | T1 | L | Available / B4 | Archiving is unavailable while running or awaiting approval, with an explanation. The remote API lacks these operations. See §9 Q11 |
| C5 | Command palette Ctrl K | D1 | T1 titles only | — | Not needed | Find loaded conversations by title, jump to devices or projects, and common actions (new conversation / add project / add device / switch theme) |
| C6 | Cross-project search | L | L | L | New | Project search only for now |
| C7 | Delete conversation | L | — | — | New | Only archiving exists, so projects with conversations cannot be removed |
| C8 | Recent conversations (all computers, devices, projects) | — | T1 | M1 | Available / B1 | Phone home, grouped by device (E11). A top “Needs your attention” section contains conversations awaiting approval or running on all devices; subsequent sections contain each device’s conversations sorted by recent activity, initially showing 5 per section with “View all.” Each row: title, AI tool, project, status, time (device is already in the section heading). The remote API currently reads conversations only by project, requiring requests for every project and becoming slow with many projects; B1 adds a per-computer recent-conversations operation |

### 4.6 Conversation details

| # | Feature | Desktop | Tablet | Phone | Backend | Notes |
|---|---|---|---|---|---|---|
| W1 | Conversation timeline | D1 | T1 | M1 | Available | Messages, grouped tool calls, Markdown, change and command cards, live output; reading area maximum width 740 |
| W2 | Context bar | D1 | T1 | M1 | Available | Device › Project (hover or long press for path) · AI tool · reasoning effort; mark imported conversations “Imported from Codex / Claude Code.” The remote API does not return reasoning effort, so tablet and phone omit it unless the backend adds it |
| W3 | Native history of imported conversations | D1 | T1 | M1 | Available | Native history is read-only, but dialogue can continue. For imported conversations, the remote API returns AgentHub records first, then native history |
| W4 | Composer and sending | D1 | T1 | M2 | Available / B1 | Multiline input, Send button, locally stored drafts; phone can use the input method’s voice typing. Show the composer only when sending is possible; replace it with an explanation bar and next step while running, awaiting approval, or offline. Remote sending requires control permission. Enhancements in W13–W17 |
| W5 | Stop | D1 | T1 | M2 | Available / B1 | Only Codex conversations running locally on the computer; place it in the running-state explanation bar in the input area. For other conversations, explain “Cannot stop here” without a button |
| W6 | Approve / reject | D1 | T1 | M2 | Available / B1 | Approval card in the timeline: allow once / reject, clearly stating the operation, device, and project. Local-computer Codex only |
| W7 | Files / Changes / Output panel | D1 | T1 line by line | M2 summary only | Available / B1 | Changes are available only for local-computer Codex; Claude Code has only “Files,” with an explanation. Changed by D2.5 (accepted 2026-11-19): Codex on this computer has one “Changes” tab; Claude Code gets “Viewed Files” only when its reads and searches name paths, and no explanation tab otherwise. Becomes an overlay in narrow windows |
| W8 | Failure card | D1 | T1 | M1 viewing only / M2 retry | Available / B1 | Cause, next step, technical details; “Retry” starts a new turn and never resends automatically |
| W9 | Conversation not found | D1 | T1 | M1 | Available | Show “Conversation not found,” never demo data |
| W10 | Queue messages or add instructions while running | L | L | L | New | Sending while running is currently rejected as busy |
| W11 | Stop and approve on paired devices | L | L | L | New | Not currently supported by Node |
| W12 | Claude Code file modification and command execution | L | L | L | New | Currently read and search only |

Composer enhancements (reference: the Claude Code extension in VS Code; implement for all three clients together):

| # | Feature | Desktop | Tablet | Phone | Backend | Notes |
|---|---|---|---|---|---|---|
| W13 | Select model and reasoning effort each turn | X1 | X1 | X1 | B3 | Model and reasoning effort are currently set only at creation and reused each turn. Codex supports changing them each turn, but Host does not expose this; Claude Code currently receives no model parameter and uses its own default. The backend must also supply available model lists: Codex’s list is currently empty, so the interface hides model selection |
| W14 | Slash-command menu | X1 | X1 | X1 | B3 (evaluate first) | Typing “/” opens available commands. Slash commands are currently disabled at Claude Code startup, so “/xxx” is sent as ordinary text; first verify which commands actually work noninteractively. Codex has no integration for compact, review, and similar commands. List only commands that can actually execute |
| W15 | “@” project file references | X1 | X1 | X1 | B3 | Type “@” to search project files and insert references. Neither the remote nor local API provides a project file listing operation |
| W16 | Image and file attachments | X1 | X1 | X1 | B3 | Camera, gallery, pasted screenshots. Sending currently accepts only text (maximum 1 MiB); both AI tools need image input support |
| W17 | Permission mode (manual approval / auto-edit / plan only) | L | L | L | New | Depends on W12. Currently fixed: Claude Code is read-only; local-computer Codex requests approval when needed; Codex on paired devices is read-only and does not request approval |

### 4.7 Pending items and notifications

| # | Feature | Desktop | Tablet | Phone | Backend | Notes |
|---|---|---|---|---|---|---|
| N1 | Pending list | D1 | T1 | M2 | Available / B1 | Segments: All / Awaiting approval / Completed, awaiting review / Failed, with counts; third line of each row is “Device · Project.” Only these three categories; never infer “Needs your reply” |
| N2 | Handle an item | D1 | T1 | M2 | Available / B1 | Awaiting approval: allow once / reject; completed: view; failed: open conversation; all three also offer “Got it.” Remove from the list after handling |
| N3 | Count badge | D1 | T1 | M2 | Available / B1 | Sidebar and bottom-tab counts use the same data source as the list |
| N4 | Desktop OS notifications | D1 | — | — | Available | Separate toggles for all three categories (O5). Clicking opens the corresponding conversation without directly approving; do not notify if the item is already on screen |
| N5 | Push notifications | — | T1 | M3 | B2 | Three categories: awaiting approval / work completed / execution failed. Same content as desktop OS notifications: type, device · project, one-line explanation; no conversation title (derived from your first message). Lock screen shows only type and count, for example, “1 conversation awaiting approval.” On tap, connect first, then open the conversation; no action buttons on notifications. Delivered over the encrypted phone–computer connection, without Google, phone vendors, or other push services |
| N6 | Read / remind later | L | L | L | New | |
| N7 | “Needs your reply” category | L | L | L | New | Requires structured signals from the AI tool; never infer from text |

### 4.8 Navigation and layout

| # | Feature | Desktop | Tablet | Phone | Backend | Notes |
|---|---|---|---|---|---|---|
| G1 | Device tree | D1 | T1 | — | Available | Sidebar: Pending / Devices › Projects › Recent conversations; expansion state saved locally |
| G2 | Collapse sidebar and resize by dragging | D1 | — | — | Not needed | Ctrl B collapses |
| G3 | Title-bar breadcrumb | D1 | — | — | Not needed | Device › Project › Conversation, each segment clickable; system-style window controls |
| G4 | Window adaptation | D1 | — | — | Not needed | ≤1180: right panel becomes an overlay; ≤1000: sidebar becomes a drawer; minimum 1100×700 |
| G5 | Phone bottom tabs | — | — | M1 | Not needed | Conversations / Pending / Devices / Settings; home is “Conversations” (C8). M1 has no “Pending” (requires B1); M2 adds it with a count badge |
| G6 | Tablet two-pane layout | — | T1 | — | Not needed | Device tree or list on the left, conversation on the right; left pane can collapse in portrait; support shortcuts with an external keyboard |
| G7 | Reconnect and recover | D1 | T1 | M1 | Available | Read state again on foregrounding or network recovery; never resend previously sent operations; show a status bar while connecting |
| G8 | Tray, single instance, close to tray | D1 | — | — | Available | |

## 5. Backend work required

| Phase | Work | Features unlocked |
|---|---|---|
| B0 | Phase 10A / 10A.1: deploy Control Plane migration 0008 and public Relay; 9B.2 forced-Relay real-device verification | Phone and tablet connectivity to the computer: A1–A3, A6, all of M0 and M1 |
| B1 | Per 03 §1.1: code pairing (computer generates a 6-digit code, valid 5 minutes, single-use, invalid after 5 wrong attempts, replacing request/allow); one permission level, grantable only by you through the computer UI (fix the local grant API’s missing request-origin check); automatic renewal while authorization is used; Settings › Devices list with immediate disconnection on removal; automatic Relay setup; new remote operations: per-computer recent conversations, pending list, change reads, approve / reject, acknowledge completed items, stop; gating identical to local behavior | A3–A5, C1, C8, W4–W8, N1–N3 on tablet and phone |
| B4 | Remote management: browse folders, add and remove projects, scan and import previous conversations, project search, pin / rename / restore (07 §6) | P1, P2, P5, P6, C3, C4 on tablet |
| B2 | Push over the app’s own connection: phones and tablets use a foreground service to keep a background connection to the computer (Relay or direct, automatically reconnecting when the 5-minute session expires); when new pending items appear, the computer informs the phone over this connection and the phone posts a local notification. Requires a remote subscription to pending-item changes (or polling B1’s pending list), and confirmation that Relay supports long-lived idle connections. No FCM: most phones in China lack Google services and cannot receive it; Xiaomi, vivo, and OPPO vendor push requires an app-store listing and enterprise account, so integrate later after publication | N5, O5, O10 on phone and tablet |
| B3 | Composer enhancement backend: per-turn model and reasoning effort, available model lists, project file listing, image input, evaluation of working slash commands; implement local and remote APIs together | W13–W16 |
| New | Unscheduled: pagination beyond 100 in local-computer lists, paired-device folder browsing, cross-project search, conversation deletion, queuing while running, Claude Code file modification, permission modes, stopping and approvals on paired devices, remote pin / rename / archive, reasoning effort in remote responses, launch at startup, account registration, account-wide revocation UI for lost phones | Entries marked `L` in the tables |

The remote API currently has only 12 operations: read devices, projects, conversations, history, live output, and action status, plus sending and creation (which require control permission, not currently issued). M1 can therefore provide viewing only; all action features depend on B1.

## 6. Nonfunctional requirements

- **Security**: follow the invariants in 03 §6. Phone and tablet device private keys stay in Android Keystore (prefer StrongBox) and cannot be exported; local caches stay in the app-private directory. Control permission can be granted only by you through the computer UI; pairing codes appear only on the computer, last 5 minutes, are single-use, and invalidate after 5 incorrect attempts; retries must not bypass validation. Removal disconnects immediately. Unlock the phone before approval or stopping (A7). Reconnection or retries must never execute approval, stopping, or similar actions twice.
- **Privacy**: OS and push notifications contain only type, device · project, and a one-line explanation, never conversation titles, prompts, commands, or paths; lock screens show only type and count. Push travels over the encrypted phone–computer connection without third-party push services.
- **Copy**: interface text is Chinese only; Codex, Claude Code, Relay, and Node remain in English; use consistent terms for “Device,” “Project,” “Conversation,” “Awaiting approval,” and “AI tool.” Error messages explain the cause and next step rather than exposing error codes directly (technical details may expand).
- **Appearance**: complete light and dark themes; desktop defaults to light, phones and tablets follow the system.
- **Accessibility**: all desktop operations are keyboard-accessible with clear focus; text contrast meets AA; status is never conveyed by color alone. Phones and tablets support TalkBack and system font scaling, with tap targets at least 48dp. Full WCAG validation requires manual assistive-technology testing and professional review.
- **Performance (suggested targets, to verify on real devices)**: desktop cold start to “Devices” within 3 seconds; phone notification tap to visible conversation within 2 seconds on a healthy network; messages appear immediately after tapping Send (B3); connected state appears within 3 seconds of a correct pairing code (E1); smooth scrolling in long conversations.
- **Reliability**: sending and creation both carry operation IDs so retries never duplicate execution; when disconnected, show the last state read-only with a “Disconnected” label, without queuing outgoing messages.
- **Platforms**: Windows and macOS desktop; Android 10 and later for phones and tablets, adapting to current versions. vivo (OriginOS), Xiaomi (HyperOS), OPPO (ColorOS), and Honor are Android and can install the app; Huawei HarmonyOS 4 and earlier can install APKs, but HarmonyOS 5 / NEXT cannot. Distribute APKs directly initially, without app stores. Initially install on iPad from Xcode using a free Apple ID (I1); iPhone later.
- **Release**: installed Mac and Windows versions remain unchanged until you accept a new version. Agents may install test builds after making a backup and ensuring the previous version can be restored if necessary (03 §6).

## 7. Out of scope

- Teams, enterprise administration, billing, multi-user sharing.
- Switching AI tools or devices during a conversation.
- One project spanning multiple devices or folders.
- SSH, terminals, file synchronization, editing files in the app.
- Read-only devices.
- Running AI tools on phones and tablets; pairing new devices or installing and signing in to AI tools from phones and tablets. Phones also do not add projects or import previous conversations (tablets may; see 07).
- Inferring “it is asking you a question” from AI output text.
- Queuing messages while offline and automatically sending them on reconnection.
- An iPhone app, iOS push notifications, and App Store distribution without a paid Apple Developer membership. Initially install the iPad app on your own iPad using a free Apple ID (your 2026-11-04 decision; see I1 in 03).

## 8. Acceptance criteria

Every phase must satisfy:

1. **Show only real capabilities**: every button works; unsupported actions have no button and explain why in place; unimplemented features appear only on “Planned features.”
2. **Complete states**: every page has loading, empty, error, and offline states, all with a next step.
3. **Appearance and copy**: light and dark themes checked; no English sentences or error codes in the interface (except permitted English proper names).
4. **Demo data**: clearly labeled; actions on demo data never call real APIs.
5. **Keyboard and screen reader**: every desktop operation works using only the keyboard; phone and tablet primary flows work with TalkBack.

By feature area:

- **Access**: phones and tablets cannot see a computer until access is allowed there; pairing requires a valid code; expired, used, and invalidated codes all fail with explanations; removal immediately disconnects connected phones, and their next request fails with a reason; running work on the computer is unaffected. Other local programs cannot bypass the computer UI to grant control permission.
- **Devices and projects**: check before unpairing or removing a project; explain why an action is unavailable and offer no confirmation button; the same folder cannot be added twice.
- **Previous conversations**: importable scan results are selected by default; expired scan results (409) trigger an automatic rescan while preserving selected items.
- **Sending and creation**: when a conversation is busy (409), explain “Running; send again after it finishes”; retries never create duplicate messages.
- **Approval and stopping**: appear only for conversations supported by the backend; phone unlocks before execution; pending counts update immediately afterward; tapping a notification opens the conversation without directly approving.
- **Notifications**: OS and push notification content contains no conversation titles, prompts, commands, or paths; lock screen contains only type and count. After the phone is locked for 30 minutes, a new approval request on the computer still produces a phone notification (after O10 setup; verify on your phone).
- **Backgrounding and reconnecting**: after backgrounding and returning, or losing and restoring connectivity, the phone state matches the computer with no duplicate operations.
- **Remote clients do not affect work**: send a message from the phone, then immediately force-stop the app (or disconnect the network or lock the screen); the computer conversation runs to completion normally; reopening the phone app shows the full result.
- **Connectivity**: from M0 onward, both direct and Relay connections must work on real devices.

## 9. Confirmed decisions

### Confirmed (2026-10-19, your answers to first-draft §9)

| # | Decision | Recorded in |
|---|---|---|
| Q1 | Both tablet and phone can create conversations, in existing projects only, sending the first message at creation | C1, C2 |
| Q2 | Dialogue with AI tools is the phone’s top priority, then push notifications; phone home is “Conversations” (recent conversations) | §1, C8, G5 |
| Q3 | Phone changes view shows summaries only | W7 |
| Q4 | The composer must be complete, referencing the VS Code Claude Code extension. M2 provides a basic composer first; model selection, slash commands, @files, and images require new backend support and belong in X1 for all three clients together | W4, W13–W17, B3 |
| Q5 | Reference similar projects (§10). Push uses the phone–computer connection, without FCM | N5, O10, B2 |
| Q6 | Unlock before approving or stopping; stopping the phone app never affects work on the computer | A7, §3, §8 |
| Q8 | First connection requires being at the computer (later settled on pairing codes; see R2); the computer can remove any phone or tablet at any time | A3–A5 |
| Q9 | In-app account registration follows the MVP | A9 |
| Q11 | Phone and tablet pinning, renaming, and archiving come later | C4 |
| Q12 | Adapt to newer Android versions; domestic-brand phones are Android except Huawei HarmonyOS 5 / NEXT | §6 Platforms |

### Confirmed (2026-10-19, your answers to second-draft R1–R4)

| # | Decision | Recorded in |
|---|---|---|
| R1 | Group by device: one section per device, paired-device headings say “Via Computer name”; both “Devices” and “Conversations” use this grouping | E11, C8 |
| R2 | Start with codes: generate on the computer, enter on the new client, pair immediately when correct; add “Allow on the computer” later (E1). One permission level, no more “View only” (revised 2026-11-03); no separate blocking | §3, A3–A6 |
| R3 | Do not retain a separate `/hosts` page: move enabling and pairing to “Settings › Account › Phones and tablets”; viewing other computers read-only waits for E10 | A2, A3 |
| R4 | Push notifications omit conversation titles | N5 |

R1 example (phone “Conversations” page):

```
Needs your attention
  Fix sign-in redirect   Codex · agenthub · Awaiting approval
  Organize test data     Claude Code · scripts · Running

Windows desktop · Online
  Fix sign-in redirect   Codex · agenthub · Awaiting approval · 2 minutes ago
  Update README          Claude Code · agenthub · Completed · 1 hour ago
Linux server · Online · Via Windows desktop
  Organize test data     Claude Code · scripts · Running
MacBook · Offline (last online 2 hours ago), entire section dimmed
  Signing script         Codex · release · Completed · Yesterday
Mac mini · Offline · Via MacBook, entire section dimmed
  (No conversations)
```

“Devices” uses the same sections, with project cards instead. Hide section headings when only one device exists.

R2 pairing flow:

```
Computer: Devices › Add device
          Pairing code  482 913      Expires in 4:32   [Cancel]
Phone:    Select computer › Windows desktop › Enter pairing code › Paired
Computer: Added · Xiaomi 14
```

The code appears only on the computer, so physical access is still required. This is as safe as the original “Allow on the computer” flow, with less back-and-forth waiting.

### Confirmed (2026-11-03, tablet)

Tablets can perform all desktop operations without remote desktop; only pairing new devices, installing and signing in to AI tools, and desktop first launch remain on the computer. Use the same sidebar layout as desktop with iPadOS-style visuals. CC Switch-style switching comes later. The tablet column has been revised accordingly; see design 07.

### Information still needed from you

Known (2026-10-19):
- Phone: vivo X60, updated to the latest system. It runs OriginOS 3 (Android 13); you confirmed Android 13 in Settings › About phone. Write O10 setup guidance and the real-device checklist for vivo first; other brands’ paths use public documentation only, marked “Not verified on a real device.”
- Development implications: the minimum supported version cannot exceed Android 13; request notification permission at runtime (required from Android 13); declare background connection foreground-service types according to current Android requirements, and verify on the X60 that notifications still arrive after 30 minutes locked.
- Tablet: no Android tablet available yet. Verify tablet layouts (two panes and orientation changes) with an Android tablet emulator profile; mark acceptance records “Not verified on a real device,” and supplement testing when hardware is available.
## 10. Similar projects referenced (reviewed 2026-10)

| Project | Phone connection | Phone capabilities | Push |
|---|---|---|---|
| Claude Code Remote Control | Claude app, conversation link, or QR code; same-account sign-in only, with revocable “Trusted devices” (beta) | Dialogue, permission responses, viewing changes, model and reasoning effort selection, @files, attachments, some slash commands | Not found |
| Happy | QR scan exchanges end-to-end encryption keys | Create conversations, switch models and permission modes, voice, images | “Finished,” “Needs permission,” “Needs your reply,” with conversation title; tapping opens the app |
| Codex in ChatGPT | Desktop Settings › Connections › Control this computer, QR scan, secure relay; pairing persists after sign-out | Remotely control Codex on the computer | Not found |
| VS Code Claude Code extension (composer reference) | — | Permission modes (manual / auto-edit / plan / auto), model and reasoning effort, “/” menu, @files and line numbers, @terminal, pasted images, dragged files | — |

Common ground: none allow direct approval from notifications; the app must be opened first. Claude Code Remote Control traffic is not end-to-end encrypted.

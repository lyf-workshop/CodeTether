# 02 · Development Handoff (v4)

For the implementer refactoring the frontend from the designs in the next round. See [01-feature-inventory-and-mapping.md](01-feature-inventory-and-mapping.md) for feature mapping and frontend review, `prototype/index.html` for the clickable prototype, and `png/` and [overview.html](overview.html) for screenshots.

The prototype, screenshots, and this document are the UI source of truth (AGENTS.md; Figma has no longer been used since 2026-11-02). The desktop implementation follows this document and has shipped as `v0.1.0-alpha.2`; all §0 decisions have been made, and the §7 Figma authoring plan is canceled.

The core of v4: **Account › Device › Project › Conversation**. A project is a folder on one device; devices include this computer and devices paired through CodeTether Node, all with full access. Adding a project automatically finds previous Codex / Claude Code conversations in that folder.

Correction to v3: v3 let one project contain folders on multiple computers and included “Other Hosts · View Only.” The user confirmed the current goal does not involve one project spanning Mac and Windows, or read-only devices. v4 removes both; the data layer still uses `ProjectRecord` + `ProjectLocation`, but the UI uses one location per project.

## 0. Decisions Required Before Implementation

| Item | Current state | Decision required |
|---|---|---|
| Design source of truth | Not authored in Figma; only a local prototype | Decided: use the prototype; stop using Figma (AGENTS.md updated on 2026-11-02) |
| Start page | After baseline StartupGate, enter `/hosts` (startup-gate.tsx:59, English, sign-in required); after first-run setup, enter the selected project or `/inbox` | v4 opens **Devices** `/devices` (open the project if one was selected during first-run setup) |
| One device per project | Host permits locations on multiple devices for one project (`registerProjectLocation`) | Remove “add a location on another device to this project.” For existing projects with multiple locations (legacy data), suggested display: split locations into multiple entries under “Device › Project,” allowing duplicate names and listing conversations for each location's `machineId` |
| Other desktop apps on the same account | The account service issues only `supervisor_read` to other Hosts on the same account, never `supervisor_control` | Do not show them in v4 (no read-only devices). The baseline `/hosts` actions “Request viewing access” and “Allow other computers to view” have no entry in the new navigation; confirm whether they may be retired for now |
| Windows devices | Node pairing supports only Linux x64 / arm64 and macOS arm64 | A Windows computer can only serve as “This computer,” not be paired; explain this on Add Device and Roadmap |
| Theme switching | Baseline is fixed dark: `apps/web/src/main.tsx:15` hardcodes `dataset.theme = 'dark'`; `packages/ui` has only dark tokens | Prototype defaults to light; Settings › Appearance offers System / Light / Dark. This is **new, frontend-only functionality**; confirm inclusion this round. Otherwise ship only light tokens and defer dark screenshots (06-*) |
| Agent identity | Prototype uses abstract line icons + brand colors (`.ag`), not official logos | If official logos are desired, confirm permission and supply assets separately; do not take untracked `packages/ui/src/assets/` assets directly |
| Mac copy | Tray menu “Open CodeTether / Quit CodeTether” and “Keep running after closing the window” verified in baseline (system_tray.rs, host_supervisor.rs) | “⌘ W closes the window” and “menu bar” have not been checked on a physical Mac; verify before implementing |
| First-run steps | Baseline has 7 steps (computer_check and provider_check separate) | Prototype combines them as “Check AI tools,” for 6 steps; change presentation only and keep the baseline state machine's 7 steps |

## 1. Information Architecture

```
Sidebar (desktop)                                        Phone bottom tabs
├─ Brand + Search (Ctrl K command palette)                Devices · Inbox · Settings
├─ New conversation (Ctrl N; preselect current project)
├─ Inbox       /inbox      (badge = open item count)
├─ Devices ＋  /devices    (“＋” = add device)
│   └─ Device ＋                     This computer first; “＋” = add project on device; show offline state
│       └─ Project ＋ or reason (inaccessible / cannot run)   Hover for path; “＋” = new conversation in project
│           └─ Conversations (pinned first, 4 by default, “Show all N”; current conversation always visible)
└─ Bottom: Account → /settings/account · Settings icon → /settings/appearance

/devices                 One section per device: name, connection, OS · architecture · transport, “Add project”; project cards + “Add project” card
/devices/:machineId      Left: projects, recent conversations; right: AI tools, connection (update address, unpair)
/projects/:id            Device › Project; Conversations / Archived; search, status and AI tool filters; previous conversations; remove project
/projects/:id/search?q=  Search within project (titles and messages you sent)
/c/:id Conversation · /add Add device (/add/node?step=1..4) · /signin · /onboarding
/settings/:section · /roadmap Roadmap (separate from current features)
```

Legacy route redirects: `/`, `/home`, `/sessions`, `/search`, `/projects`, `/computers`, `/hosts` → `/devices`; `/computers/:id` → `/devices/:id`; `/pair` → `/add/node`; `/connect`, `/add/desktop` → `/add`; `/account` → `/settings/account`; `/doctor` → `/settings/about`; `/settings` → `/settings/appearance`.

Production route mapping:
- `/machines`, `/machines/$id` → `/devices`, `/devices/$id`; `/hosts`, `/hosts/$hostId` leave the primary navigation (see §0).
- Merge `/projects/$projectId` and `/projects/$projectId/conversations` (baseline agent-grouped conversation page, with `q` and `view=archived`) into one page; retain `/projects/$projectId/conversations` as an alias.
- `/conversations/$id` → `/c/$id` (or retain the original path and replace only the page).
- `/activity`, `/agents` are placeholder pages without baseline entry points (“This page has not been implemented yet”); v4 does not use them, so remove them or redirect to `/devices`.

Terminology:
- **Device**: Machine. Only two kinds: `local` (this computer) and Node-paired `remote`. Both belong to the local Host and have full access.
- **Project**: A folder on a device, represented by `ProjectRecord` and its `ProjectLocation{machineId, rootPath, availability}` on that device. Default the name to the folder name; show the path on a second line or hover tooltip.
- **Previous conversations**: Native Codex / Claude Code conversations found in the project folder but not yet added to CodeTether (provider-sessions candidates). After import, they become conversations with `origin=adopted_native`.
- **AI tools**: Codex, Claude Code. Stop mixing Agent / Intelligent Agent terminology.
Context consistency:
- The context bar below the conversation title is `Device › Project (hover for path) · AI tool · Reasoning effort (only if set)`; the first two segments are clickable. Add “Imported from Claude Code” to imported conversations. Breadcrumbs are `Device › Project › Conversation title`. Derive both from `conversation.projectId / machineId`, never the currently selected device.
- Opening a project or conversation automatically expands its device and project in the sidebar; always show the current conversation even when it falls beyond the first 4.

Add project (`add-project-dialog.tsx` + `previous-conversations-step.tsx`):
- Step one: Device (fixed when opened from a device entry) → Folder → Name (default folder name). This computer uses the system folder picker (`pick_project_directory`) or a typed path; paired devices require a full typed path (Node has no directory-listing API). Disable offline devices and devices unable to run tools.
- If the folder is already added on that device, open the existing project rather than creating another.
- Step two in the same dialog: “Added X (Device · Path),” followed by previous conversations found in the folder, grouped by AI tool. Select resumable ones by default; offer “Import selected” or “Skip,” then enter the project. If none were found, say “No previous conversations found. You can still create a new conversation.”
- Baseline already follows createProject / createRemoteProject with PreviousConversationsStep (shared by first-run setup and computer details). v4 only moves it into the Add Project dialog's second step and adds a permanent section on the project page.

New conversation (`new-conversation-dialog.tsx`):
- Order: Project (dropdown grouped by device, showing Device · Path) → AI tool → Reasoning effort (Claude Code only). The project determines device and working directory; stop selecting a separate “Run location.”
- List unavailable projects, explain why, and disable creation: device offline, cannot run AI tools, folder inaccessible.
- Disable an AI tool if it is not installed on the device. For Codex on paired devices, show “When running on X, you cannot stop or approve commands here.”
- Do not show model or reasoning-effort controls for Codex (the descriptor lacks `models` / `reasoningOptions`); do not show model selection for any AI tool. Use the descriptor to control visibility rather than hardcoding tool names.
- No first message (`CreateConversationRequest` has no input); after creation enter the conversation and focus the composer.
- Entry points: the project row's “＋” and project page's “New conversation” fix the project; sidebar button and Ctrl N preselect the current project; device page's “New conversation” preselects the first available project on that device.

Other:
- The product has no “primary Machine”: put this computer first.
- Phones (≤600px) have no sidebar; replace the device tree with the Devices tab, device details, and project details; replace breadcrumbs with “Back + Current title.” At ≤1000px the conversation file panel overlays messages.

## 2. Visual Specification

All values are in `prototype/tokens.css`. Light and dark themes use **identical variable names**, changing only values (on `<html data-theme>`).

| Role | Light | Dark | Usage |
|---|---|---|---|
| `--ct-bg` canvas | #fbfaf8 | #1b1a19 | Content background |
| `--ct-side` sidebar | #f3f1ed | #151413 | Warm gray sidebar, phone tabs |
| `--ct-surface` card | #ffffff | #232221 | Cards, inputs, dialogs |
| `--ct-line` / `-strong` | #e9e5de / #d8d3ca | #2e2c29 / #3d3a36 | Separators / input borders |
| `--ct-text` / `-2` / `-3` | #1d1c1a / #5c5852 / #8c877f | #ecebe8 / #aeaaa3 / #7f7b74 | Body / secondary / hint |
| `--ct-ink` primary button | #1d1c1a | #ecebe8 | Primary buttons use ink, not blue |
| `--ct-accent` accent | #1a7fd0 | #3c9be3 | Links, focus, running, selected only; the sole global accent color |
| `--ct-ok / warn / err` | #1e9a55 / #c98512 / #cc3f36 | #3fbf74 / #e0a341 / #ec6a60 | Base color for dots, `-text` for text (4.5:1), `-soft` for backgrounds |
| `--ct-agent-codex / claude` | #1d1c1a / #d97757 | #ecebe8 / #e08a6b | AI tool badge backgrounds |

- Use system fonts: `Segoe UI Variable` + `Microsoft YaHei UI` (Windows), `-apple-system` + `PingFang SC` (Mac); monospace `Cascadia Code` / `SF Mono`.
- Type scale 11.5 / 12.5 / 13.5 / 14.5 (body) / 16 / 19 / 24 / 30; spacing in multiples of 4; corner radii 6 / 8 / 12 / 16 / fully rounded.
- Shadows only for overlays and hover on clickable cards; flat cards use a 1px border only.
- Layout: title bar 44, sidebar 248 (224 at ≤1180), reading width 740, page width 1040.
- Sidebar device tree row heights: device 32 / project 30 / conversation 30 / “Show all” and “No conversations yet” 26. Show dots only for Running / Waiting for approval / Failed; reserve blank space for alignment otherwise. Show “＋” on hover or keyboard focus.
- Theme preference: `system | light | dark`, default `light`. Set `data-theme` before the first frame (inline index.html script) to avoid flashing; `system` watches `prefers-color-scheme`. Prototype saves to localStorage `ct-theme` and accepts `?theme=`.
- Figma variable collection `CT/color` has Light / Dark modes; names correspond one-to-one to CSS variables (without the `--ct-` prefix).
## 3. Components (packages/ui)

| New component | Based on | Prototype classes | Changes |
|---|---|---|---|
| AppSidebar | workspace-sidebar.tsx | `.side` `.nav-item` `.side-label` | Inbox / Devices + device tree + bottom account/settings. Remove “My Hosts” |
| DeviceTree | workspace-sidebar.tsx project area, workspace-sidebar-model.ts | `.tree` `.tree-row.{dev,proj,ses,more,none}` `.tr-add` `.tr-tag` | Baseline is Project › Conversation, one expanded at a time; change to Device › Project › Conversation, allow multiple expanded, pinned first, default 4. Conversation status says “Waiting for approval” (baseline “Needs attention”) |
| TitleBar | top-bar.tsx | `.topbar` `.crumbs` `.winctl` `.traffic` | Breadcrumbs in title bar; Mac traffic lights / Windows controls; draggable region; bottom separator appears only after content scrolls |
| DeviceSection | machines-page.tsx | `.dev-sec` `.dev-h` | One section per device: icon, name, connection state, OS · architecture · transport, “Add project” |
| ProjectCard | project-row.tsx | `.pj` `.pj.add` `.pj.dim` | Project name, status (running dot or unavailability reason), path, `N conversations · N running · N importable`, recent time; last card is “Add project” |
| PreviousSessions | previous-conversations-step.tsx | `#native` `.nat-ic` | One candidate per row: checkbox (resumable) / checkmark (already in CodeTether, with “Open”) / blank (record format cannot resume); Rescan, Import selected; explain scan failure or device offline |
| AddProjectDialog | add-project-dialog.tsx + add-project-location-dialog.tsx | `addDlg` | Two steps: Device / Folder / Name → Added + Previous conversations |
| SessionItem | product/conversation-item.tsx | `.item` | Title + metadata (Device · Project, omitted if the list already limits scope); status and time on right, replaced on hover with Pin / Archive / More. Disable Archive while running and explain why |
| AttentionItem | inbox-item.tsx | `.item.attn` | Three lines: conversation title / reason (command for approval, truncated if long) / Device · Project; right-side time + inline actions. Actions move to next line on phones |
| StatusTag | status-badge.tsx | `.status.{ok,warn,err,off,run}` | Dot + text; `run` pulses |
| AgentBadge | New | `.ag.{codex,claude}` | Square background + line icon, three sizes |
| ContextBar | conversation-header.tsx | `.ctx` | Device › Project · AI tool · Reasoning effort; add “Imported from Claude Code” for imports |
| ComposerGate | composer.tsx + conversation-controls.ts | `.dock` `.composer` `.gate` | Keep composer position fixed; when sending is unavailable (device offline / waiting for approval / current turn unfinished), replace the entire area with explanation + next step. If interruptible, place “Stop” in the explanation bar (baseline only in TopBar) |
| ApprovalCard | pending-action-dock.tsx, product/permission-card.tsx | `.approve` | Command + Allow once / Reject |
| FailureCard | conversation-failure-card.tsx | `.failcard` | Explanation + next step, collapsed technical details |
| FilesPanel | inspector-panel.tsx | `.panel` `.tabs` | Changes (only if descriptor supports diff) / Files / Tool output; explain why Changes is unavailable |
| NewSessionDialog | new-conversation-dialog.tsx | `.dialog` `.choices` `.choice` | Project (grouped by device) → AI tool → Reasoning effort, see §1; bottom sheet on phones |
| Notice | Banner | `.notice.{info,warn,err,ok}` | Page-level notice, optional action; `ok` for “Project added” |
| SettingsRow | settings cards | `.set-group` `.set-row` | Left title/description, right control |
| SectionState | *-page-states.tsx | `.skel` `.empty` | Skeleton / Empty / Partial error + Retry; sidebar device tree and Inbox badge also show loading while loading |
| CommandPalette | New (top-bar's ⌘K is unwired) | `.palette` | Recent conversations (Device · Project), projects, devices, actions (new conversation, add project, add device, switch theme); matches loaded titles only |
| Dialog, Seg, Switch, Steps, CodeBlock | Existing | `.dialog` `.seg` `.switch` `.vsteps` `.term-block` | Apply new tokens |

Remove v3's LocationSection, HostRow, ComputerCard (`.pc`), and “View only” badges in v4.

Class naming: prototype component and state classes once collided (`.run` card vs `.dot.run`, tree `.conv` vs conversation-page `.conv`); these are now `.runcard` and `.tree-row.ses`. Use component scope in production (CSS Modules or prefixed classes), with states in `data-state`. OS-prefixed selectors (`.os-win .winctl`) need the same specificity in media-query overrides; product code must not use `!important`.

## 4. State Representation (Keep Dimensions Separate)

| Dimension | Source | Values → Copy |
|---|---|---|
| Conversation status | `ConversationRecord.status` | running Running · waiting Waiting for approval · completed Completed · failed Failed · idle Idle. Use identical wording in sidebar, lists, filters, and Inbox |
| Device connection | `MachineConnectionState` | local This computer · online Online · connecting Connecting · offline Offline (with last online) · recovery_required Address update needed · authentication_failed Authentication failed · incompatible Incompatible version |
| Device execution capability | `providerExecution` | Available · Cannot run (This device cannot currently run AI tools) |
| Project | Device state + `ProjectLocation.availability` | Available · Device offline · Cannot run · Inaccessible (folder missing or no read permission). Unavailable projects still show conversation history |
| Previous conversations | provider-sessions `providers[].status` + `failureReason`, candidate `resumeStatus` / `alreadyAdopted` | Resumable · Already in CodeTether · This version's record format cannot resume; scan failures: Cannot read this folder (`provider_session_store_unreadable`) · Device offline (`machine_offline`) · Cannot search right now (`provider_session_discovery_unavailable`, AI tool busy) · Unsupported record format (`provider_session_format_unsupported`) |
| Inbox | `AttentionItem.type` | approval Waiting for approval · completed_review To review · failed Failed |
| Account | account session | Signed out · Signed in · Account service not configured in this build |
| Transport | `MachineExecutionTransport` | direct Direct LAN connection · relay Through Relay · unavailable Temporarily unable to connect |
| Execution health | `executionHealth` + freshness | Normal / Recent issues / Never run; for last_known, explain “Showing the last known state” |
| Not yet fetched | Query incomplete | Skeleton; show “Unknown” for unknown values, never 0 |

Remove v3's four dimensions “Access (other Hosts),” “Other Host online,” “Live output,” and “Local sharing” along with read-only devices. Mark cached content on offline devices with the last online time.

## 5. Capability Gating (Reuse conversation-controls.ts Directly; Do Not Rewrite Conditions)

| Capability | This computer, Codex | This computer, Claude Code | Paired device, Codex | Paired device, Claude Code |
|---|---|---|---|---|
| Read history, search within project | ✅ | ✅ | ✅ | ✅ |
| Recover previous conversations (discover + import) | ✅ | ✅ | ✅ Device online | ✅ Device online |
| Create conversation | ✅ Project available | ✅ Project available | ✅ Online + providerExecution | ✅ Online + providerExecution |
| Send + stream | ✅ | ◐ Read/search tools only | ✅ | ◐ Read/search tools only |
| Interrupt (Stop) | ✅ | ✕ | ✕ | ✕ |
| Tool approval | ✅ | ✕ | ✕ | ✕ |
| Changes / Diff | ✅ | ✕ | ✕ | ✕ |
| Reasoning effort (at creation) | ✕ No options | ✅ Default / Low / Medium / High / Very high / Maximum | ✕ No options | ✅ Same as left |
| Model selection | ✕ | ✕ | ✕ | ✕ |
| Queue / steer while running | ✕ | ✕ | ✕ | ✕ |

Claude Code runs with `--tools Read,Glob,Grep --permission-mode dontAsk`, so it only reads and searches files, with no approvals or changes. Interrupt, approval, and Diff depend on machine + provider descriptor: Node and Claude adapters report false; only Codex on this computer reports true.

The UI reads only `supportsInterrupt / supportsApprovals / supportsDiff`, `models`, and `reasoningOptions` from the descriptor; do not hardcode the table. It only records verification of the current code; prototype `canInterrupt / canApprove / hasDiff` are simplified simulations.

Input while running: no queue / steer; sending again while running returns Host 409 `conversation_busy`. Replace the composer with “{AI tool name} is working · You can send the next message after this turn finishes”; include Stop if interruptible, otherwise add “Claude Code conversations do not support stopping yet” or “Conversations running on paired devices do not support stopping yet.”

Conversation organization (same as baseline): pin, rename, archive / unarchive. Archived conversations cannot be pinned; archiving clears the pin. Running or waiting-for-approval conversations cannot be archived. No conversation deletion API exists.

Remove and unpair (baseline rules; Host remains authoritative):

| Operation | Allowed when | Otherwise |
|---|---|---|
| Unpair device | No projects on this device | Dialog lists the projects and offers only “Got it” (`machine_has_project_locations`) |
| Remove project | No conversations, **including archived** (project-registry.ts:602) | “Cannot remove this project yet” dialog explains conversation count and archived count |
| Add project | Device online and able to run; if same path already exists on same device, open existing project | Disable offline devices; explain “You can add projects once the device is online again” |

- Baseline shows errors only after confirmation/submission (project-actions.ts:305 `projectErrorMessage`). v4 checks when opening the dialog: use existing `allProjectConversationsQueryOptions` (`archived: 'all'`) to count project conversations; no new API. Keep `projectErrorMessage` mapping after submission as well.
- With no conversation deletion API, the dialog can only say “Cannot remove yet,” not direct users to delete conversations. “Delete conversations” belongs in `#/roadmap`.

There is one connection flow: Add device `#/add` → Node pairing `#/add/node` (command, address or pairing link, 6-digit pairing code, verify confirmation code), without an account; after completion, go straight to Add project. Add Device also explains that Windows and other computers on the same account cannot currently be added.
## 6. Data Dependencies

| ID | Need | Current state | Interim solution |
|---|---|---|---|
| D1 | Sidebar device tree, project details | `GET /machines`, `GET /projects` (projects include locations), `GET /projects/:id/conversations` (`provider / status / archived` filters, `limit ≤ 100`, no cursor) | Attach projects under devices using each location's `machineId` on the frontend; no new API. Sidebar fetches only expanded projects. If a project exceeds 100 conversations, explain “Only the most recent 100 are shown” and direct users to project search. Do not assemble the full list with `GET /snapshot`: it contains only Host's in-memory conversations (host-service.ts:1889-1907) |
| D2 | Find conversations | Project-only search: titles + messages you sent, ≤160 characters, cursor; no cross-project search | Project search box enters `/projects/:id/search`. Ctrl K filters only loaded titles. Cross-project content search belongs in `#/roadmap` |
| D3 | Conversation and running counts on project cards / device pages | No counts API | Derive project counts from D1 lists; show “100+” at 100. Device details' Recent conversations uses the most recent 100 from `GET /machines/:id`. Hide counts if not fetched; never show 0 |
| D4 | Device last-online time | Verify whether MachineSummary includes last connection time | If absent, show only Offline, no time |
| D5 | Custom title bar | `decorations:true` | Optional: Tauri `decorations:false` + `titleBarStyle: overlay` (Mac). Alternatively retain native title bar and move breadcrumbs back into the content top bar |
| D6 | Open app on Devices | StartupGate redirects to `/hosts` (startup-gate.tsx:59) | Frontend changes target to `/devices` (open the project if one was selected during first-run setup) |
| D7 | Previous conversations | `GET /api/v1/projects/:pid/locations/:mid/provider-sessions` (`provider?`, `limit` default 50 max 100, `cursor`, `rescan`) returns `candidates[]{discoveryCandidateId, provider, title, createdAt?, lastActiveAt?, resumeStatus, alreadyAdopted, conversationId?}`, `providers[]{status, failureReason, candidateCount, corruptEntriesSkipped}`, `nextCursor`; `POST` same path `{actionId, discoveryCandidateId}` imports, returning `adopted / already_adopted`; expired candidate: 409 `provider_session_candidate_expired` (local-http-server.ts:415) | Use in Add Project step two and project page's Previous conversations; offer Load more beyond one page. Host scans codex and claude-code on this computer; paired devices scan through Node CodexSessionDiscovery / ClaudeSessionDiscovery (apps/node/src/provider-session-discovery.ts); offline returns `machine_offline`. Codex matches exact `thread.cwd` to project path; Claude matches the normalized project-path digest. Project cards' “N importable” needs scan results; suggest fetching only on project open or addition, not scanning every project on Devices |
| D8 | Expiration during import | Candidates expire | On 409 automatically rescan, retain selection (match title + time), and say “List updated” |
| D9 | Chinese copy and consistent terminology | `/hosts`, `/hosts/$hostId` almost entirely English; “My Hosts”; mixed Agent / Intelligent Agent / AI tool | Replace with new pages; standardize on AI tool, Device, Project, Waiting for approval (in Chinese in the product) |
| D10 | Theme preference | None (fixed dark) | Frontend localStorage + first-frame script; Desktop and browser store separately. Confirm scope (§0) |
| D11 | Inbox | `GET /attention`: approval, completed_review, failed | Use directly; sidebar badge and Inbox page share a source |
| D12 | Other desktop apps on same account (future) | Only `supervisor_read` issued; protocol and Host routes exist for `supervisor_control`, but it is not issued | Not connected in v4; to show these as paired devices under Devices, account service must issue control and add an approval flow; see `#/roadmap` |

## 7. Figma Authoring Plan (Canceled)

Figma has no longer been used since 2026-11-02; the plan below is historical only. Original plan: suggested file name `CodeTether · UX Redesign v4`; page and Frame names match PNGs:

- `00 · Page Inventory and Core Flows`: document 01's inventory table and README's 9 verification flows.
- `01 · Visual Specification and Components`: variable collections `CT/color` (Light / Dark modes), `CT/space`, `CT/radius`, `CT/type`, values from tokens.css. All §3 components, with variants (state, platform, size, theme); separate DeviceTree row-type components.
- `02 · All Desktop Pages`: png/02-01 … 02-40, 1440×900. 02-01…22 devices, projects, conversations; 02-23…29 add device and sign-in; 02-30…40 settings and first-run setup.
- `03 · Key Interaction States`: png/03-01 … 03-18, including loading / empty / partial error, device offline, inaccessible folder, cannot remove, cannot unpair, signed out, account service unconfigured, narrow desktop at width 1100.
- `04 · Tablet and Phone`: png/04-01 … 04-11, 1024 and 390.
- `05 · Roadmap`: png/05-01, separate from other pages; mark partially implemented (supervisor_control) separately from unimplemented.
- `06 · Dark Theme`: png/06-01 … 06-12. Generate by switching the same components to Dark mode, without duplicating dark components.

Authoring requirements: explicit scopes on variable collections; all containers use Auto Layout; Frame names match PNG names; prototype connections cover README verification flows; compare screenshots against PNGs after authoring each page.

## 8. Suggested Implementation Order

1. Tokens (light; add dark and Appearance settings after confirmation) and basic components: StatusTag, Button, Seg, SectionState, Notice. No route changes.
2. AppSidebar, DeviceTree, TitleBar: attach projects under devices by location `machineId` in workspace-sidebar-model.ts, pinned first, multiple expanded; route aliases (legacy URL redirects); StartupGate redirects to `/devices`. Add tests first.
3. Devices and device details: DeviceSection, ProjectCard; project list, recent conversations, AI tools, connection (update address, precheck unpairing) in device details.
4. Add project + Previous conversations: two-step AddProjectDialog, reuse createProject / createRemoteProject and PreviousConversationsStep actions; permanent Previous conversations section on project page.
5. Project details: merge `/projects/$id` and `/projects/$id/conversations`, archived view, filters, project search; precheck project removal.
6. New Conversation dialog: Project (grouped by device) → AI tool → Reasoning effort, descriptor-based visibility; preselection and fixed project for each entry point.
7. Conversation details: ContextBar, ComposerGate (Stop moves into explanation bar), FilesPanel; descriptor-based interrupt / approval / change visibility. Highest risk and value; add tests first.
8. Add device: reuse AddRemoteMachineDialog actions and parsers; change layout only to a 4-step page.
9. Inbox, Settings (Appearance / Account / Notifications / Background running / About and checks), Ctrl K; responsive layout: ≤1180 sidebar 224, ≤1000 panel overlay and single-column details, ≤600 bottom tabs and back-style breadcrumbs.

Preserve at every step: `actionId` idempotency, single trust-change lock, no archiving while running, no automatic resend, no conversation titles in notifications, local/remote gating.

## 9. Prototype Notes

- See [README.md](README.md) for opening instructions and URL parameters. All data comes from `data.js` (`NATIVE` holds demonstration candidates from each project folder); title bar's right side always displays a Demo data badge. Buttons only modify memory; they call no Host, authorization, deletion, or Agent execution API.
- Files: `tokens.css` (dual-theme tokens) · `base.css` (window, sidebar/device tree, title bar, buttons, inputs) · `components.css` (lists, cards, states, device sections, project cards) · `conversation.css` · `screens.css` (pages, dialogs, responsive layout); scripts: `core.js` (data access, gating, shell, device tree, shared fragments) · `devices.js` (devices, device details) · `projects.js` (project details, previous conversations, project search) · `inbox.js` (Inbox) · `add.js` (add device, sign-in) · `conv.js` · `more.js` (settings, first-run setup, Roadmap) · `router.js` (routes, overlays, add project, new conversation, shortcuts).
- `frame.html` exports phone screenshots: headless Chrome's minimum window is around 500px, so a fixed-size iframe loads `index.html`. `bash export-png.sh` re-exports all screenshots and `png/00-overview.png`; after adding/removing screenshots, update overview height at the end of the script.

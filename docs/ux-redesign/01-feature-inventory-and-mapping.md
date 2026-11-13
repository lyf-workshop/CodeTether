# 01 · Page and feature inventory / old-to-new mapping (v4)

Based on accepted product baseline **`bbcda690a081`** (both Mac and Windows), covering `apps/web/src` (routes, components, runtime/host, runtime/account), `packages/protocol`, `apps/host`, `apps/desktop/src-tauri`, and `apps/node`.
Status symbols are ✅ implemented, ◐ partial, ✕ absent.
This is the design-time inventory at `bbcda69`. "Current" means that baseline. Desktop v4 has since shipped as `v0.1.0-alpha.2`. Prototype Frame numbers map to `png/` and same-name `prototype/` pages. "Gap" marks existing capabilities omitted from prototypes that implementation must preserve.

v4 centers on **Account › Device › Project › Conversation**. After login users see their devices (this computer and CodeTether Node-paired devices), each containing its own projects. A project is one folder on one device (one ProjectLocation), used by Host as the AI tool working directory. Adding a project automatically discovers previous Codex/Claude Code conversations in that folder. There are no read-only devices.

## Key facts affecting design

| Topic | Actual code behavior | Source |
|---|---|---|
| Conversation ownership | ProjectRecord → ProjectLocation `{projectId, machineId, rootPath, availability}`, at most one location per project/device, no separate locationId. Creation sends `projectId + machineId` and Host uses location `rootPath` as cwd. Data supports multi-device locations, v4 uses one. Legacy multi-location handling is in 02 §0. | host-service.ts:5917-5933; protocol commands.ts:44-53 |
| Devices | Machines under the local Host comprise one `local` computer and up to 64 Node-paired `remote` devices. Both support browsing, creating, and sending. | protocol machines.ts |
| Node platforms | Linux x64/arm64 and macOS arm64, **not Windows**. Windows can only be the local computer. | apps/node release targets |
| Baseline frontend organization | Sidebar Project › Conversation, latest four per project, only one expanded project, no pin priority/device label. Project detail lacks conversations. `/projects/$id/conversations` groups by Agent. Startup opens English `/hosts` (My Hosts). | workspace-sidebar-model.ts:7; workspace-sidebar.tsx; startup-gate.tsx:59; conversations-page.tsx |
| Lists/search | Project-only `GET /api/v1/projects/:id/conversations` (`provider / status / archived` filters, `limit ≤ 100`, no cursor) and project search (title/user input, ≤160 characters, cursor). **No** cross-project list/global search. `GET /snapshot` contains in-memory conversations only, not a complete list. `GET /machines/:id` includes latest 100 on that device. | router.tsx; conversation-list-query.ts; conversation-search-query.ts; host-service.ts:1889-1907, 5025-5039 |
| Creation | `CreateConversationByProjectRequest {actionId, machineId, provider, projectId, model?, reasoning?}` has no initial message. Codex descriptors lack `models`/`reasoningOptions`. Claude offers low/medium/high/xhigh/max reasoning, no model list. Model/reasoning can be selected only at creation. | protocol providers.ts:113-125; claude-code-host-runtime.ts:81; host-service.ts:9560-9631 |
| Previous conversations | `GET/POST /api/v1/projects/:pid/locations/:mid/provider-sessions` discovers/imports native Codex/Claude sessions per location. Returns `candidates` (`resumeStatus`/`alreadyAdopted`), per-tool `status / failureReason` (`machine_offline`, `provider_session_discovery_unavailable`, `store_unreadable`, `format_unsupported`), `nextCursor`, and `rescan` support. Adoption yields `adopted / already_adopted`, expired candidates 409 `provider_session_candidate_expired`. **Local and paired devices both work**, with Node scanning remotely. Codex exactly matches `thread.cwd` to project path, Claude matches normalized-path digest. | local-http-server.ts:415; host-service.ts:2629,2657; apps/node/src/provider-session-discovery.ts; previous-conversations-step.tsx |
| Inbox | `GET /attention` includes approval/completed_review/failed, removed when handled. | attention-query |
| Account login | ✅ Supabase email OTP, `shouldCreateUser:false`, existing accounts only. Entry is English `/hosts` (My Hosts) only. Build fails without account configuration. | runtime/account/control-plane-client.ts; routes/host-directory-page.tsx |
| Other same-account Hosts (unused in v4) | Baseline `/hosts` finds other Desktop Hosts and requests `supervisor_read`. `supervisor_control` has protocol/Host tables/`POST /api/v1/supervisor/control/approve` but control plane never issues it and UI does not call it. No access-request revocation/notifications. Exclude read-only devices from new v4 navigation. Same-account Mac/Windows devices are roadmap. | host-directory-page.tsx; remote-supervisor.ts; apps/host supervisor routes |
| Node pairing | ✅ `codetether-node --pair`, `codetether-pairing://relay/v1`, six-digit code, independent of account. | add-remote-machine-dialog.tsx; apps/node |
| Remote execution | ✅ Remote Codex, ◐ remote Claude. Local/remote Claude uses `--tools Read,Glob,Grep --permission-mode dontAsk`, read/search only. | remote-machine-coordinator.ts; remote-claude-host-runtime.ts; claude-code-host-runtime.ts |
| Interrupt/approval/changes | Only local Codex supports `capabilities.interrupt`, approval, and Diff. Node remote `subscribeApprovals` is empty, Claude also unsupported. | remote-codex-host-runtime.ts; claude-code-host-runtime.ts |
| Input while running | ✕ No queue/steering. Host returns 409 `conversation_busy`. Baseline composer disabled, interrupt in top bar only. | conversation-controls.ts; composer.tsx; AGENTS.md |
| Startup/language | ✕ No launch-at-login/i18n. UI Chinese except English My Hosts. Tray/close-to-background exist without switches. | desktop tauri |
| Theme | Dark only, startup hardcodes `dataset.theme = 'dark'`. Proposed light default/dark/system is **new frontend scope** (02 §0, D10). | apps/web/src/main.tsx:15; packages/ui/README.md:7 |
| Imported history | `origin=adopted_native` native transcript is read-only, conversation can continue. | native-transcript.ts:72 |
| Unpair | Blocked while projects remain (`machine_has_project_locations`). Remove projects first. | unpair-machine-dialog.tsx; project-actions.ts:348 |
| Remove project | Deregisters without deleting files. Host rejects if any conversation exists, **including archived** (`has_conversations`). v4 preflights on dialog open with existing list counts (02 §5, D1/D3). | project-registry.ts:595-610; conversation-store.ts:2599; host-service.ts:10000-10041 |
| Delete conversation | ✕ Archive only. Projects containing conversations cannot be removed. Roadmap. | local-http-server.ts |

## Feature inventory

| # | Feature | Current entry | User goal | Main actions | Data source | Conditions | Source | Status | New design destination | Prototype Frame |
|---|---|---|---|---|---|---|---|---|---|---|
| F01 | Startup gate | `/` StartupGate | Open app | Five auto retries, Recheck | `getOnboarding` | Host connected | onboarding/startup-gate.tsx:18; startup-gate-recovery.ts:8 | ✅ | Retain, replace English `/hosts` destination (startup-gate.tsx:59) with **Devices** `/devices` (02 §6 D6) | — |
| F02 | Seven-step onboarding | `/setup` | Check computer/tools, select/import project, remote setup | welcome→computer_check→provider_check→project_setup→previous_conversations→remote_setup→ready | onboarding-query.ts (CAS revision) | — | onboarding-page.tsx:73-1032 | ✅ | Six **first-launch** screens, Welcome / Tools / Project / Previous conversations / Other devices / Ready. Other devices introduces Node, states Windows cannot pair yet. Ready shows Device › Project › Conversation. Preserve seven-step state machine. | 02-35…02-40 |
| F03 | Onboarding recovery | `/setup` | Recover errors | Reselect project, retry | — | — | onboarding-page.tsx:1232-1323 | ✅ | First-launch errors reuse notice err, no separate prototype | 03-04 style |
| F04 | Provider install/login guidance | Setup tool card | Install/login CLI | Official guidance | native providerGuidance | Desktop | provider-guidance-link.tsx | ✅ | First-launch View login instructions. **Gap**, device tool card omits guidance, retain provider-guidance-link | 02-36, 02-02, 02-03 |
| F05 | Doctor | Top bar Check status, `/doctor` | Diagnose | Recheck/settings/rerun setup | doctor-query.ts | — | doctor/doctor-page.tsx:184-760 | ✅ | **Settings › About and checks**, remove top-bar entry | 02-34 |
| F06 | Main navigation | Sidebar My Hosts/Inbox/Computers/project tree | Navigate | — | — | — | workspace-sidebar.tsx:138-167 | ✅ | **Inbox** count / **Devices** plus Add device, device tree, account/settings bottom. Remove My Hosts. Mobile bottom tabs Devices/Inbox/Settings. | All |
| F07 | Project tree/latest four | Sidebar | Quick access | Expand/new/show all | project-query, conversation-list-query | — | workspace-sidebar.tsx:157-437; workspace-sidebar-model.ts:7 | ✅ | **Device › Project › Conversation**, local first, multiple expansions, default four per project pinned first, current always visible, Show all N. Status dots for running/waiting/failed only. Device plus adds project, project plus creates conversation. | 02-01, 02-04, 02-15 |
| F08 | Collapse/resize sidebar | Top bar/drag | Space | Persist localStorage | — | — | workspace-sidebar-layout.ts | ✅ | **Gap**, prototype fixed width, only narrows to 224px at ≤1180, no collapse/drag. Preserve existing ability, supplement Figma. | 03-16…03-18 |
| F09 | Breadcrumbs | Top bar | Location | — | Detail queries | — | root-layout.tsx:212 | ✅ | Move to draggable **titlebar** Device › Project › Title. Conversation **context bar** Device › Project (hover path) · Tool | 02-15, 04-08 |
| F10 | Top-bar ⌘K/bell/avatar | Props | — | — | — | Unwired | top-bar.tsx:152 | ✕ | Ctrl K/mac ⌘K **command palette**, loaded-title search, device/project navigation, create/add project/add device/theme. Avatar bottom, notifications in Inbox. | 02-12, 06-09 |
| F11 | Project conversations | `/projects/$id/conversations` | Browse | Group by Provider | listProjectConversations | — | conversations-page.tsx:84 | ✅ | Merge into **project detail**, pins first then activity, no tool grouping or global list (no API) | 02-04 |
| F12 | Status/Agent filter | Filter menu | Narrow list | All/running/waiting/completed, Provider | Client-side | — | conversation-list-model.ts:6-91 | ✅ | Status segments All/Running/Waiting approval/Completed/Failed, tool dropdown, Active/Archived segments | 02-04, 02-06 |
| F13 | Title/user-input search | `?q=` | Find history | 25/page, Turn navigation | searchProjectConversations | Project scoped | conversation-search-query.ts:47 | ✅ project only | **Project search** `/projects/:id/search` via project field, explain scope/exclusions, merge same-conversation hits, Load more only when needed. Cross-project roadmap. | 02-07 |
| F14 | Pin/unpin | Row menu | Favorites | — | `/pin` `/unpin` | Not busy | conversation-organization-controls.tsx:157 | ✅ | Hover Pin and conversation-settings switch, priority in sidebar/project | 02-20, 02-04 |
| F15 | Rename | Row menu | — | — | renameConversation | — | controls.tsx:174 | ✅ | **Conversation settings** dialog (name/pin/archive) | 02-20 |
| F16 | Archive/restore | Row menu, `view=archived` | Organize | Confirm/restore | `/archive` `/unarchive` | Not running | controls.tsx:180-297 | ✅ | Hover Archive/settings switch disabled with explanation when running/waiting. Recover in project Archived. | 02-06, 02-20 |
| F17 | New conversation | Sidebar/project plus | Start work | Device/project/Agent/model/reasoning | createConversation; machine-query | available + projectAccess + providerExecution + location | new-conversation-dialog.tsx:80-205; new-conversation-provider-selection.ts | ✅ | **Project grouped by device → Tool → Reasoning** (Claude only). Project fixes device, unavailable projects explain why. No model or first message. Sidebar Ctrl N/project plus/detail/device entries. | 02-13, 02-14, 03-07, 04-11, 06-07 |
| F18 | Conversation header/status | `/conversations/$id` | Read | — | getConversation + SSE | — | conversation-header.tsx | ✅ | Title/status/**context bar** Device › Project · Tool · Reasoning | 02-15…02-19 |
| F19 | Timeline/tool groups/Markdown/Diff/Shell | Detail | Understand work | Expand | Detail/events | — | conversation-timeline.tsx; tool-grouping.ts | ✅ | Retain, reading width max 740 | 02-15 |
| F20 | Approval dock | Detail bottom | Approve risk | Allow once/Reject | `/approvals/:id/resolve` | connected && supportsApprovals, local Codex only | pending-action-dock.tsx | ✅ local Codex | Inline timeline card, local Codex only, omit on paired devices | 02-15, 06-03 |
| F21 | Composer send | Detail | Continue | Type/send | startTurn `{actionId, input}` | canCompose | composer.tsx; conversation-controls.ts:164 | ✅ | Show input only when sendable, otherwise **explanation + next action** for running/waiting/offline | 02-15, 02-18, 03-12 |
| F22 | Interrupt | Top bar | Stop | — | `/interrupt` | Local Codex only | conversation-chrome-actions.tsx | ◐ | Move Stop into composer status strip for local Codex only. Paired devices explain cannot stop, no button. | 02-15, 02-18 |
| F23 | Inspector files/changes/output | Top-bar toggle | Inspect | Resize | Detail | supportsDiff / supportsToolOutput | inspector-panel.tsx:420 | ✅ | Right panel Files/Changes/Output, changes local Codex only. Claude Files with explanation, overlay ≤1000 | 02-16, 02-17, 02-19, 04-03 |
| F24 | Same-project rail | Detail left | Switch | Filter/search/new | conversation-list-query | Same project | conversation-rail.tsx | ✅ unmounted | Unneeded, sidebar and Ctrl K suffice | — |
| F25 | Failure card/retry | Timeline | Recover | New Turn retry/device/project/details | Canonical failure | Some reasons not retryable | conversation-failure-card.tsx | ✅ | Retain with next-step copy | 03-12 |
| F26 | Imported native history | Detail | Read history | Load earlier | native-transcript | origin=adopted_native | conversation-detail-route.tsx:222 | ✅ | Context Imported from Codex/Claude Code | 03-13 |
| F27 | Demo adapter | Invalid ID | Development | — | Mocks | — | demo-conversation-adapter.ts | ✅ dev | Keep with Demo data marker. Production Not found. | — |
| F28 | Inbox/list/summary/filter | `/inbox` | Handle work | All/approval/completed/failed | attention-query | Connected | inbox-page.tsx; inbox-summary.tsx | ✅ | Counted segments, Device · Project third line, sidebar same source | 02-11, 03-11, 04-07 |
| F29 | Inbox approval | Approval row | Decide | Allow once/Reject | Resolve approval | Provider capability | inbox-item.tsx:148 | ✅ | Retain, unsupported explanation without buttons | 02-11 |
| F30 | Completed review/failure | Row | Review | View result/open/Got it | Resolve attention | — | inbox-actions.ts:34-52 | ✅ | Retain linked conversation | 02-11 |
| F31 | Read/unread/snooze | — | — | — | — | — | — | ✕ | No read state, handled entries leave. Roadmap. | 05-01 |
| F32 | System notifications | Desktop | Background alerts | Open conversation | attention-notification-coordinator.ts; attention_notifications.rs | Desktop, not showing affected page | desktop-notification-model.ts:109 | ✅ | Retain, Settings Notifications explains no conversation titles | 02-32 |
| F33 | Three preferences | `/settings` | Control alerts | Approval/completion/failure | notification-preferences.ts | Desktop | desktop-notification-settings.tsx:128 | ✅ | **Settings › Notifications**, three switches | 02-32 |
| F34 | Background explanation | `/settings` | Closing behavior | No switch | backgroundRuntime.available | Desktop | desktop-notification-settings.tsx:115 | ◐ explanation | **Settings › Background**, state only | 02-33 |
| F35 | Tray | System tray | Restore/exit | Open/Exit CodeTether | — | Desktop | system_tray.rs:38-59 | ✅ | Retain, explain in Background | 02-33 |
| F36 | Close-to-tray/first hint | Window X / Alt+F4 | Continue background | — | — | — | host_supervisor.rs:1326; system_tray.rs:100 | ✅ | Retain | — |
| F37 | Single instance | Reopen | Restore | — | — | — | host_supervisor.rs:1221 | ✅ | Retain | — |
| F38 | Native titlebar | Window | — | — | — | decorations:true, 1440×900, minimum 1100×700 | tauri.conf.json | ✅ | Optional **custom titlebar** with Mac traffic lights/Windows controls/drag area, decorations change (02 §6 D5) | All |
| F39 | Launch at login/deep link | — | — | — | — | — | — | ✕ | Roadmap, Background offers only Roadmap link, no switch | 05-01, 02-33 |
| F40 | Device list | `/machines` Computers | Find devices | Open/add | listMachines | Connected | machines-page.tsx:31-261 | ✅ | **Devices** start page, per-device name/state/OS/arch/transport/add project, project and add cards | 02-01, 03-01, 03-02, 04-01, 04-04 |
| F41 | Local detail | `/machines/$id` | Inspect | Providers/projects/recent | getMachine | — | machine-detail-page.tsx:269-511 | ✅ | **Device detail**, left projects/latest100, right tools/connection | 02-02 |
| F42 | Remote detail | Same | Inspect remote | Reconnect/refresh Provider | getMachine | Remote | machine-detail-page.tsx:545-1313 | ✅ no list | Also projects/conversations, offline notice/last seen (D4), independent project-read errors | 02-03, 03-03, 03-04, 04-05 |
| F43 | Pair remote computer | Device Add | Connect device | Address/link+code → verify → done | begin/confirm/cancelRemoteMachinePairing | One trust mutation at a time | add-remote-machine-dialog.tsx:50-506 | ✅ | **Add device** `/add` explains Windows/same-account computers unavailable → **Pair** `/add/node` Prepare/Input/Verify/Done, then Add project | 02-23…02-27 |
| F44 | Relay-assisted first pairing | Node link | Cross-network | — | Relay rendezvous | Automated only, no production claim | PHASE8D-RELAY-ASSISTED-FIRST-PAIRING.md | ◐ | Step-2 field accepts address/link with explanation | 02-25 |
| F45 | Update address | Device detail | Recover changed address | Verify/save | updateMachineConnectionAddress | Remote,recovery_required | update-machine-address-dialog.tsx | ✅ | Connection card dialog and offline-notice entry | 02-22, 03-03 |
| F46 | Unpair | Device detail | Revoke trust | Confirm | unpairMachine | No project locations | unpair-machine-dialog.tsx | ✅ | Connection card. Existing projects listed and no confirm, as baseline. | 02-21, 03-10 |
| F47 | Relay configure/enroll/retry/disconnect/remove | Device Relay | Internet access | Configure/token/retry/remove | relay-actions.ts:111-152 | Remote | machine-relay-section.tsx | ✅ | Connection card shows method/address/last seen/pairing. **Gap**, preserve omitted Relay config/token/retry/removal in Advanced. | 02-03 |
| F48 | Provider installation selection | Device detail | Select CLI | Select | selectMachineProviderInstallation | — | provider-installation-selector.tsx | ✅ | **Gap**, preserve selector absent in tool card | 02-02 |
| F49 | Install vs execution health | Device detail | Assess availability | — | providerDiscovery / executionHealth | current / last_known | machine-detail-page.tsx | ✅ | Tool health/last-known. **Gap**, separate install state needs Figma supplement. | 02-02, 02-03 |
| F50 | Project list | `/projects` | Browse | Open/remove | listProjects | — | projects-page.tsx; project-row.tsx | ✅ | Merge into **Devices**, redirect `/projects`. Cards show state/path/conversation/running/import counts. | 02-01, 03-05, 03-06 |
| F51 | Project detail/locations | `/projects/$id` | Manage | Conversations/new/location/remove | getProject | — | project-detail-page.tsx; project-locations-section.tsx | ✅ no list | **Device › Project detail**, list/filter/search/new/permanent Previous conversations/remove/unavailable guidance. No location on another device. | 02-04, 02-05, 03-05, 03-06, 04-02, 04-06 |
| F52 | Add local project | Projects | Register folder | Picker/path/name | createProject | Desktop picker | add-project-dialog.tsx | ✅ | **Add project** Device → Folder (native picker/manual local) → Name. Existing folder opens registered project. | 02-08, 04-09 |
| F53 | Add remote location | Project/paired detail | Register remote | Device/path | registerProjectLocation / createRemoteProject | Paired | add-project-location-dialog.tsx | ✅ | Same Add project, full path only (no Node browse API), fixed device when contextual. v4 uses createRemoteProject, no extra locations. | 02-09 |
| F54 | Remove project/location | Project detail | Clean | Confirm | deleteProject / removeProjectLocation | No conversations including archived | remove-project-*-dialog.tsx | ✅ | Remove dialog preflights conversation conflict, Got it only. No separate location removal with one location. Delete conversation roadmap. | 03-08, 03-09 |
| F55 | Import previous | Add/setup | Continue history | Multiselect/import | discover/adoptProviderSession | resumeStatus=supported | previous-conversations-step.tsx | ✅ local/paired | **Add project step 2 scans automatically**, grouped by tool, resumable preselected, Import selected/Skip. Permanent section supports rescan/more/open adopted/unsupported/offline. Same onboarding (D7/D8). | 02-05, 02-10, 02-38, 06-06 |
| F56 | Remote Node | `codetether-node` CLI | Allow connections | `--pair`, `service install` | — | Local | apps/node/src/main.ts; service-installation.ts | ✅ CLI Linux x64/arm64,macOS arm64 | Pair step 1 commands/platforms | 02-24 |
| F57 | Node controller recovery | CLI | Credential loss | `--controller` | — | Local interaction | local-controller-recovery.ts | ✅ CLI | Handoff docs only, no product control | — |
| F58 | Activity | `/activity` placeholder | — | — | — | — | router.tsx:93 | ✕ | Remove/redirect `/devices`, no navigation | — |
| F59 | Agents | `/agents` placeholder | — | — | — | — | router.tsx:126 | ✕ | Merge capability into Device tools, remove/redirect | — |
| F60 | Component showcase | Development | Visual check | — | — | — | showcase/component-showcase.tsx | ✅ | Update new light/dark components | components.css;00-overview |
| F61 | Theme/language | — | — | — | — | — | apps/web/src/main.tsx:15 `dataset.theme = 'dark'` | ✕ dark/Chinese only | **Settings › Appearance**, light/dark/system (new D10 scope), language Simplified Chinese only | 02-30, 06-01…06-12 |
| F62 | Email OTP login | English `/hosts` | Sign in | Send/verify/sign out | Supabase OTP | Account config | host-directory-page.tsx | ✅ | **Settings › Account** and Chinese `/signin`. Paired devices need no account. | 02-28,02-29,02-31,03-14,03-15 |
| F63 | Local Host capability | `/hosts` card | Same-account read access | Enable/setup | Local lifecycle | Signed in | host-directory-page.tsx | ✅ hardcoded macOS copy | Exclude from v4 read-only scope, roadmap same-account Mac/Windows | 05-01 |
| F64 | Other Hosts | My Hosts | Same-account discovery | Open/request/cancel/reapply/retry | listAuthorizedHosts / listOwnedHosts | Signed in | host-directory-page.tsx | ✅ | Exclude. Add device explains same-account unsupported. | 02-23,05-01 |
| F65 | Read-only remote Host | `/hosts/$hostId` | Read Machine/project/conversation | Browse/live | remote-supervisor (supervisor_read) | Authorized/online | remote-host-page.tsx | ✅ | Exclude read-only devices | — |
| F66 | Incoming access requests | `/hosts` PendingAccessRequestPanel | Allow/reject | Allow/reject | Control plane,30s polling | Local Host enabled | host-directory-page.tsx | ✅ no revoke/notify | Exclude, confirm baseline `/hosts` retirement (02 §0) | — |
| F67 | supervisor_control | `/hosts/$hostId` control only | — | — | `/api/v1/supervisor/control/approve` | Never issued | apps/host;remote-host-page.tsx:215,407 | ◐ backend/unreachable | Same-account Mac/Windows roadmap, partial | 05-01 |
| F68 | Windows pairing | — | Windows as paired device | — | — | — | Node release targets | ✕ | Roadmap, explain Add device/onboarding | 05-01,02-23 |

## Old entry → new entry

| Old entry | New entry | Notes |
|---|---|---|
| `/` → English `/hosts` My Hosts | `/` → **Devices** `/devices` | Selected onboarding project opens directly |
| Sidebar My Hosts | Remove, login/logout in **Settings › Account** | Other Hosts/requests excluded |
| Sidebar Inbox | **Inbox** `/inbox` | Count |
| Computers and one-open project tree | **Devices**, Device › Project › Conversation, multiple expansions, pins first | |
| `/projects` | Redirect `/devices` | Device grouping |
| `/projects/$id` without list + Agent-grouped `/projects/$id/conversations` | **Project detail** `/projects/:id` | Old URLs redirect |
| `?view=archived` | `/projects/:id?view=archived` | |
| `?q=` | Project search `/projects/:id/search?q=` | |
| Top-bar Check status | Settings › About and checks | |
| Top-bar interrupt | Composer status Stop, local Codex only | |
| Settings General/Notifications | Appearance/Account/Notifications/Background/About and checks | Separate `/roadmap` |
| Add remote computer dialog | **Add device** `/add` → four-step **Pair** `/add/node` | |
| `/machines`, `/machines/$id` | `/devices`, `/devices/:id` | Old URLs redirect |
| `/hosts`, `/hosts/$hostId` | Outside navigation, no read-only devices | Confirm retirement (02 §0) |
| `/agents`, `/activity` placeholders | Remove/redirect `/devices` | |
| `/conversations/$id` | Conversation detail (prototype `#/c/:id`) | Preserve URL |

## Frontend review (apps/web at bbcda69)

Method, read-only code review without production app, Tauri, or tests.

### 1. Friction in opening, selecting device/project, and starting/continuing

| # | Baseline | v4 handling | Backend needed? |
|---|---|---|---|
| 1 | English login-required My Hosts on startup (startup-gate.tsx:59) | Open Devices, remove My Hosts | No |
| 2 | Extra navigation from project to separate conversations route | List directly | No |
| 3 | Latest four, single expansion, no pins/device ownership | Device hierarchy, multi-expand, pins/current visible | No |
| 4 | 100-row cap and future-pagination message | Explain cap, direct to cursor-enabled project search | True pagination needs Host cursor |
| 5 | Runtime location follows project but silently filters it | Group projects by device, selection fixes device, reasons for unavailable | No |
| 6 | Import appears once in setup/add | Automatic step-2 scan, permanent rescan section | No |
| 7 | Inconsistent waiting/needs action, Agent/tool, computer/Host/Machine | Waiting approval, AI tool, device, project | No |
| 8 | Locked composer, top-bar interrupt | Composer explanation/Stop for local Codex | Queue/steering needs Host |
| 9 | No palette, unused search/bell/avatar props | Ctrl K loaded-title filter/navigation | Cross-project search needs Host |
| 10 | Remote folder full-path entry only | Preserve/explain, browsing roadmap | Node/Host needed |

### 2. Frontend entries without backend support or wiring

- `/activity` and `/agents` are placeholders (router.tsx:93,126), remove/redirect.
- Top-bar ⌘K/bell/avatar exist but app-shell passes no props, so absent.
- `ConversationRail` and `InboxFilters` exist but are unmounted.
- `/hosts/$hostId` create/composer require `session.control === 'control'` (remote-host-page.tsx:215,407), but control plane issues only supervisor_read. Omit in v4.
- Invalid conversation IDs show demo content (conversation-detail-route.tsx:135-156). Production must show Not found.

### 3. Supported backend features unused by frontend

- Node provider-session-discovery supports paired-device scanning, `rescan`/cursors, but baseline uses it only once after project addition.
- `GET /machines/:id` returns latest 100, baseline only local detail displays recent. v4 displays both.
- Host supports `status=failed`, baseline lacks Failed segment.
- Preflight removal with existing `allProjectConversationsQueryOptions` (`archived: 'all'`) rather than waiting for submission error.

## Corrections to v3

v3 organized Project › Folder (computer) › Conversation, allowing folders on multiple computers, same-account read-only Other Hosts, and access requests in Settings. User confirmed one project per device, without cross-Mac/Windows projects or read-only devices. v4 uses Device › Project › Conversation, removing other Hosts, access requests, Add folder on another computer, and Remove folder. Previous conversations become automatic project-add scanning and a persistent project section instead of one-time import.

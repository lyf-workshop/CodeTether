# 03 · Project plan (desktop · tablet · phone)

Date: 2026-10-19. References: accepted baseline `bbcda69`, v4 design (`34b8ee5`), completed v4 frontend implementation on `ux/v4-device-first` (`df91601`, unreviewed), docs/PRODUCT.md and docs/ROADMAP.md.

## 1. Product expectations

- Desktop is the workbench: AI tools run there, and projects, conversations, and configuration live there.
- Phone priority is talking to AI tools anywhere (create conversations, reply, full composer), followed by push alerts, approval, and Stop. Tablet is for reading/review, also supporting creation/replies. Both are native apps, using the same account to view/control computers, running no AI tools themselves, and absent from the Devices list. Closing the mobile app does not stop desktop work.
- Detailed requirements are authoritative in 04-requirements.md.
- Structure remains Account › Device › Project › Conversation. One project is one folder on one device.

| Feature | Desktop | Tablet | Phone |
|---|---|---|---|
| Recent conversations (all devices/projects) | Sidebar device tree | ✓ | ✓ Home |
| Conversation/reply (full composer) | ✓ | ✓ | ✓ |
| New conversation (existing project) | ✓ | ✓ | ✓ |
| Attention (approval / completion / failure) | ✓ | ✓ | ✓ |
| Approve / Deny, Stop | ✓ | ✓ | ✓ (unlock first) |
| Browse Device › Project › Conversation | ✓ | ✓ | ✓ Grouped by device |
| Changes | ✓ Line by line | ✓ Line by line | Summary only |
| Search within project | ✓ | ✓ | — |
| Add project, import previous conversations, remove project | ✓ | ✓ (B4) | — |
| Pin, rename, archive | ✓ | ✓ (B4) | Later |
| Pair new device, install/sign in to AI tools | ✓ | — | — |
| Settings / diagnostics / first launch | ✓ | Account, available computers, notifications, unlock confirmation, connection checks | Account, notifications, unlock confirmation |
| Notifications | System notifications (existing) | Push | Push |

### 1.1 Multi-device use (simplified, your decision 2026-11-03)

Goal: users need understand only Account, Device, Pairing, without knowing underlying identities or transport types.

- **Device**: a computer, phone, or tablet signed in to your account.
- **Add device**: sign in to the same account on the new device; on an existing computer open Devices › Add device to display a 6-digit pairing code; enter it on the new device. Done.
  - Computers and phones use the same flow/entry point.
  - Later, add easier approval: after a new device logs in, the computer asks Allow this device to use this computer? (E1).
- **One permission**: pairing permits viewing, creation, replies, approval, and Stop. Buttons depend only on AI-tool support; no View only tier.
- **Automatic connection**: direct on the same network, Relay otherwise. No address/token/environment-variable entry.
- **No manual renewal**: pair once; ongoing use keeps it valid.
- **Removal**: remove a device in Devices › Phones and tablets to disconnect immediately; pairing is required again. Device management stays on Devices, with no duplicate in Settings (details in 06).

Do not expose these UI terms: Host, Node, Machine, ProductDevice, Supervisor, Relay, authorization, grant, fingerprint. Put necessary troubleshooting details in Settings › About and checks.

## 2. Current state (verified in code)

- Desktop v4 accepted on Windows/Mac (15/15 each), merged to `main`, released as `v0.1.0-alpha.2` (`0f624ae`); review `docs/reviews/ux-v4-device-first.md`.
- Remote access (Supervisor transport, `packages/supervisor-transport`): TLS 1.3 + Host pinning + ProductDevice proof, direct or Relay.
  - Only 12 operations: `host.bootstrap`, `machine.list/get`, `project.list/get`, `conversation.list/get/history/live.read`, `action.get`, `conversation.create`, `conversation.turn.start`.
  - **No** Attention list, approval/denial, or Stop.
- Permissions: protocol has `supervisor_read` and `supervisor_control`. Account service issues read only; control has Host tables and `/api/v1/supervisor/control/approve`, but no UI caller and is unreachable out of the box.
- Backend after B0 deployment (2026-11-02): Control Plane runs `main` `454f414`, migration 0008; public Relay at `tls://relay.codetether.org:8443` (`relay_d41fc913a6e74e65b916467b97bc299b`, certificate expires 2027-01-01, requiring manual renewal/restart); Windows Host Relay presence online. Seven read-only Relay checks remain: existing Windows/Mac grants expired, v4 has no request UI, and you deferred them. Report `agenthub-archive/b0-report.md`. Old Mobile Supervisor (9B) in ROADMAP is marked superseded by M series.
- No push (APNs / FCM), phone client, or tablet client.
- Capability limits carry through to mobile: Stop, approval, and changes only for Codex local to the computer; Claude Code supports reading/search only.

## 3. Responsibilities

Every stage follows this process:

1. I design prototypes, screenshots, and handoff; backend stages include API/data specifications.
2. You approve the design.
3. I write the coding-agent prompt.
4. Coding agent implements in a separate branch/worktree, committing, pushing, deploying, and installing as required by the task.
5. I review diff, run typecheck / lint / test / build, compare design and §6 invariants, and write review. If needed, write a fix prompt and review again.
6. You accept on physical devices, then merge/release.

Actions requiring you: Apple developer/Google Play accounts, signing certificates/update-signing private key, store submission, final physical-device acceptance. Agents may deploy Control Plane, Relay, update files, and install new versions (your decision 2026-11-02).

## 4. Stages

| Stage | Scope | Dependencies | Responsibility |
|---|---|---|---|
| **D1 Desktop v4 completion** | Review `ux/v4-device-first`, fix, accept on physical devices, merge, release Windows/Mac versions | — | I review, agent fixes, you accept |
| ~~D2 Figma synchronization~~ | Deferred (your decision 2026-10-19). Designs come from `docs/ux-redesign` prototypes/screenshots/handoff. Every coding prompt states your temporary authorization overrides AGENTS.md's Figma-only rule. | — | — |
| **U1 Desktop one-click update** | Official Tauri updater: check/download/verify update signatures, run installer to replace previous version, preserve local data.<br>• Notify when available; update only after user clicks, never silently.<br>• Wait for active AI turn to finish without interruption.<br>• Back up local database before updating, permitting rollback after schema changes.<br>• You decide update hosting (own server/object storage; GitHub Releases may be unreliable in China). You keep the update-signing private key outside repo; agents never read it. Windows signing certificate/Mac notarization (paid Apple membership) may be deferred; test unsigned system warnings.<br>Android app stays outside stores; its in-app APK download/system installation is part of M series. | D1 merged | I design/write prompt/review; agent implements; you provide update hosting and signing key |
| **B0 Remote access go-live** | Complete Phase 10A / 10A.1: Control Plane migration 0008 and public Relay deployment, 9B.2 forced-Relay physical-device validation | — | I write deployment prompt/review; agent deploys and completes code |
| **B1 Pairing and remote control** | Simplified §1.1 flow (your decision 2026-11-03).<br>• Devices › Add device displays 6-digit code entered on new device; expires in 5 minutes, single-use, invalid after 5 wrong attempts.<br>• One Can use permission includes viewing, creating, replying, approving, stopping as supported by AI tool. Grant only through desktop UI; fix missing request-origin check in `/api/v1/supervisor/control/approve`.<br>• Automatically renew during use; removal disconnects immediately.<br>• Automatic Relay setup: bundle address/identity or fetch from account service, no manual environment variables.<br>• Add remote operations: recent conversations by computer, Attention, approval/denial, completion handling, Stop, changes; same gates as local.<br>• Rerun B0 Relay reads after B1. | B0 | I design/specify APIs/review; agent implements |
| **B2 Push** | No FCM (most Chinese phones lack Google services; vendor push requires store publication/business accounts). Phone/tablet foreground service maintains one Supervisor connection to computer in background (direct/Relay, reconnect on expiry); new desktop Attention travels over it and triggers local notifications. Add Attention-change subscription and verify Relay keeps long idle connections. Contents match desktop notifications, §6. | B1 | Same as above |
| **B3 Composer backend** | • Send speed first (your decision 2026-11-04): Host currently rechecks AI tool before every send (hashes 333 MB `codex.exe` twice, runs commands, starts temporary app-server), about 2 seconds here. Cache by path/size/mtime; full checks only on upgrade, previous launch failure, or Recheck. Accept missing replacements with identical size/mtime. Desktop inserts message immediately on Send, removes Sending message card; failures show Not sent · Retry and restore composer text. Align tablet/iPad in T1b/I1.<br>• Explain send failures: Supervisor maps most Host errors (computer/tool unavailable, archived conversation, etc.) to `internal` (`packages/supervisor-transport/src/server.ts:761-783`), so tablet/iPad see only uncertain outcome/Can retry without actual cause. Pre-execution failures need explicit codes (`unavailable`, `conflict`, etc.) and client explanations. Align tablet in T1b so explicit retry rejection exits pending confirmation. Also address two-step Host creation leaving empty conversations on second-step failure, and `action.get` missing creation actionId.<br>• Per-turn model/reasoning, available models, project-file listing, image input, assess usable slash commands; implement local API and Supervisor together. | B1 | Same as above |
| **B4 Remote management** | Let tablet perform all desktop operations (07 §6): browse folders, add/remove projects, scan/import previous conversations, project search, pin/rename/restore. Enforce permissions and checks identical to local. | B1 | I design/review; agent implements |
| **M0 Native technical validation** | Android Rust core connects to real Host for read-only browsing: ProductDevice key in Android Keystore (prefer StrongBox), TLS 1.3 + exporter proof, direct and Relay both work. Folded into T1a (2026-11-03). | B0 | Agent implements, I review, you validate on your Android phone |
| **M1 Phone: viewing** | Login, pairing code (§1.1), recent-conversation home/device pages grouped by device, read-only conversations, convergence after disconnect/background recovery | M0 + B1 | I design, agent implements |
| **M2 Phone: conversations and actions** | New conversation, full composer, replies, Attention, approval/denial, Stop, change summaries. Phone MVP. | M1 + B1 | Same as above |
| **M3 Phone: push** | Background connection, local notifications, click directly into conversation/approval; phone notification switches; brand-specific guidance for battery-optimization exemption, autostart, locking recent task | M2 + B2 | Same as above |
| **X1 Composer enhancements** | Desktop/tablet/phone together: per-turn model/reasoning, slash-command menu, @project files, image/file attachments (reference VS Code Claude Code extension) | M2 + B3 | Same as above |
| **T1 Tablet** | Android tablet, design in 07 (your decision 2026-11-03): every desktop capability without remote desktop, except new-device pairing and AI-tool installation/login stay on computer. Desktop-like sidebar, iPadOS-style layout, equally restrained colors, landscape/portrait, dark/light, external keyboard.<br>Tablet first (your decision 2026-11-03), two rounds (07 §8): T1a app shell, connection core including M0, login, pairing, all pages supported by current backend; T1b B4 remote management. | T1a: B1; T1b: T1a + B4 | Same as above |
| **E1 One computer, one device** | One CodeTether desktop app per computer; same account and phone-style pairing code, no separate Node installation/pairing (your decision 2026-10-20, simplified by §1.1 on 2026-11-03).<br>• Merge Node's remotely accessible role into desktop app on Windows/macOS/Linux; retain CLI login/pairing for headless Linux.<br>• Easier confirmation: when new device logs in, computer asks Allow this device to use this computer? Keep pairing codes too.<br>• Conversations belong only to the executing computer; others read/control them live without copies (your decision 2026-11-04). Currently Windows-initiated Node conversations executing on Mac live on Windows, Mac's own on Mac, mutually invisible. Desktop sidebar reads other computer's conversations directly (reuse `remote-supervisor.ts`). Acceptance: same conversation list on both ends.<br>• Pair within 3 seconds (your decision 2026-11-04): currently both sides poll every 2 seconds, then computer processes every grant, totaling 5–10 seconds. Use Control Plane long polling returning immediately on change; process only new device's grant; show progress. Same pairing flow across phone/tablet/desktop; update mobile waiting in T1b/I1/M1.<br>• Build new flow before migrating: existing Node pairings remain usable until ready; auto-migrate paired Nodes without losing projects/conversations, then remove Node, LAN addresses, Update address from UI. Covers E9/E10. | B1 | I design/specify APIs/review; agent implements; Mac physical tests need you to start an agent there |
| **P1 Multiple AI tools** | Add CLI AI tools beyond Codex/Claude Code (your decision 2026-11-02, after M2).<br>• Research each candidate's programmable CLI, output format, conversations/resumption, tool calls/approval, error format; exclude missing/unstable interfaces. Candidates/checks: `docs/MULTI-PROVIDER-STRATEGY.md`.<br>• Define integration contract/capability declarations; expose only supported capabilities (§6).<br>• Tool name plus custom neutral small icon matching app icon style, no vendor trademarks (your decision).<br>• Each subsequent tool gets its own stage. | M2 | I research/design/review; agent implements |
| **I1 iOS / iPadOS** | Reuse Rust core, SwiftUI. iPad first (your decision 2026-11-04): free Apple ID installation on your iPad, same first-round scope as T1a. iPhone layout/push/store later. | T1a + Mac; paid Apple membership for push/publication | I design, Mac Codex implements (`docs/reviews/i1-ipad-app-prompt.md`) |
| **L Later** | See §7 | — | — |

Order: D1/B0 may run together. U1 starts immediately after D1 merge, before M1, parallel with B0 (one-click updates require first installing an updater-enabled version; earlier implementation reduces manual reinstalls and lets desktop keep pace once phones connect). M1 can use current read-only operations. B1 merged (`9694895`, 2026-11-04); B2/B3/B4 may start together. Recommend B3/B4 together after T1a merge; B4 prerequisite for T1b, B3 starts with send speed. Tablet first (2026-11-03): `t1a/tablet-app` starts at `9694895`, absorbing M0; T1b waits for B4; phone layouts M1/M2 follow T1a. Critical path B0 → B1 → T1a (first Android UI), then T1b/M1/M2/M3/X1 according to dependencies. Design E1 account authorization with B1 pairing authorization; implementation can parallel M series after B1. P1 starts after M2 and may parallel M3/X1/T1. I1 first iPad round starts from `t1a/tablet-app` (2026-11-04), parallel with T1a review/B4, then rebases to `main` after T1a merges.

## 5. Native application approach (your decision needed before M0)

The hard part is connection, not UI: mobile needs the desktop-equivalent Supervisor client (TLS 1.3, Host pinning, TLS-exporter-bound device proof, Relay framing). Existing Node TypeScript cannot run directly on mobile.

| Option | Approach | Advantages | Disadvantages |
|---|---|---|---|
| **A (recommended)** | SwiftUI (iPhone/iPad) + Jetpack Compose (Android), shared Rust core (rustls + Supervisor/Relay, UniFFI Swift/Kotlin bindings) | Most native UI; security protocol implemented once; Rust matches Tauri | Two UI codebases |
| B | Tauri 2 mobile, reuse React UI + Rust core | Least code | Web-like experience conflicts with native-app goal |
| C | iOS/iPadOS only, Swift client | Fastest first release | Rewrite protocol for Android later |

Decided (2026-10-19): **Android phone/tablet first**, iOS/iPadOS later. Reasons:

- Installing/debugging on your Android phone is free (USB debugging, adb/Android Studio); only Google Play publication needs a one-time developer fee. No FCM; own connection for push (B2).
- vivo (OriginOS), Xiaomi (HyperOS), OPPO (ColorOS), Honor run Android/APKs; Huawei HarmonyOS 5 / NEXT cannot run APKs. Chinese brands aggressively clean background apps, requiring Settings exemptions (M3 guidance).
- Free Apple ID supports iPhone debugging without Apple Developer Program, but needs Mac/Xcode, expires after 7 days requiring reinstall, and lacks push. Push is central to phone, so iOS effectively awaits paid membership ($99/year).

Adapt A: Android Kotlin + Jetpack Compose, one phone/tablet app with two layouts; Rust connection core with UniFFI Kotlin bindings, reusable for later iOS. If M0 finds Rust Android integration too costly, assess pure Kotlin (Conscrypt supports TLS 1.3/exporter). Device keys in Android Keystore, prefer StrongBox.

Addendum (your decision 2026-11-04): start iPad with free Apple ID (I1). No notifications in first tablet round, so free account suffices; app expires after 7 days, rerun from Xcode. Push/formal distribution still need paid membership. SwiftUI UI, reuse T1a Rust crate, Secure Enclave device key.

## 6. Invariants for every stage (review checklist)

- Account, ProductDevice, Host, Relay, Machine identities/trust remain independent; never substitute one for another.
- Phones/tablets reach computers only through Supervisor, never directly through local port 4317.
- New devices added only through desktop UI (pairing code, later Allow click); other local programs cannot bypass it. Codes expire after 5 minutes, single-use, invalid after 5 wrong attempts. Removal disconnects immediately.
- Mobile app stopping, disconnecting, or logging out never affects running computer work; only Stop stops it.
- Remote operations retain local gates: idempotent `actionId`, no archive while running, no automatic resend after failure, busy returns 409, approval/Stop only for supporting AI tools.
- Push/system notifications omit conversation titles, prompts, commands, paths; lock screen shows type/count only; no approval directly from notifications. No third-party push services.
- UI exposes only genuine backend capabilities; unimplemented features appear only in Future plans.
- Credentials/keys (`.secrets/`, private keys, connection strings) never printed or included in repo/reports.
- Back up before deployment/installed-app replacement (database first), document rollback. us-vps-01 also hosts website/other projects; confirm destructive or potentially disruptive operations with you first.

## 7. Later

CC Switch-style API-service/model configuration switching (research first), cross-project search, conversation deletion, login startup, Stop/approval on paired computers, Claude Code editing/permission modes, in-app registration, account-wide revocation UI after phone loss, phone pin/rename/archive, vendor push after store publication, QR pairing.

## 8. Next steps

As of 2026-11-13, the order of work, the decisions taken (AD-1 to AD-11) and the task prompts are in `docs/reviews/2026-11-13-assessment-and-plan.md`; stage status is in `docs/ROADMAP.md`. The numbered items below are the earlier history.

1. D1 completed (`v0.1.0-alpha.2`).
2. U1 design ready (`05-desktop-update.md`), updates hosted on us-vps-01; awaiting your design review before coding prompt; you generate signing private key.
3. B0 deployed (2026-11-02), diagnostics merged `main` (`b59f911`). End-to-end Relay reads await valid authorization.
4. B1 Mac cross-device acceptance passed (2026-11-04, `agenthub-archive/b1-mac-check-windows.md`), fast-forwarded to `main` (`9694895`). Control Plane/Relay unchanged, no redeployment. Three nonblocking omissions: disconnect timing/reconnect errors (Mac session already disconnected at removal), unsupported-tool button visibility on Mac (Windows confirms capability false), Mac dev device name CodeTether Desktop.
5. Tablet design approved (2026-11-03), colors changed to desktop-like ink. T1a implemented/pushed (`t1a/tablet-app`, `f290602`, `agenthub-archive/t1a-report.md`). Review completed (no Rust Must fix; Kotlin `agenthub-archive/t1a-kotlin-review.md`); first fixes pushed (`a52605d`, `41dbf72`) and reviewed: mostly correct, two remaining issues (rotation cancels active operations; uncertain send/create remains stuck). Second fixes pushed (`b668e53`), approved and fast-forwarded `main` on 2026-11-04. B4 design can now begin.
6. iPad I1 first round assigned Mac Codex (2026-11-04), prompt `docs/reviews/i1-ipad-app-prompt.md`. First round pushed (`i1/ipad-app`, `d9ad373`); simulator/device builds pass, acceptance awaits iPad. r1 pushed (`82a1aff`), reviewed; remaining missing history turns and uncertainty classification/persistence fixes in `docs/reviews/i1-fix-prompt-r2.md`, still simulator-only validation. Your actions: Mac Xcode/Apple ID setup; USB iPad, Trust, Developer Mode, trust developer after first install; enter verification/pairing codes.
7. Test devices: vivo X60 confirmed Android 13; app minimum cannot exceed 13. No physical Android tablet currently, validate tablet layout on emulator. X60 is phone-sized and cannot validate tablet layout; its physical acceptance belongs to M1. Use your own iPad.

Stage table added atop `docs/ROADMAP.md` as v4 Product Stages (2026-11-02), authoritative for status. This document defines scope/responsibilities; update both together.

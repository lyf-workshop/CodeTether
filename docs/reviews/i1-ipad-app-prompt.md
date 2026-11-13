# Task: I1 iPad App, First Round

Run on Mac with Xcode and the user's free Apple ID. Match first-round Android tablet scope (T1a), using SwiftUI and the same Rust connection crate.

Design: `docs/ux-redesign/07-tablet.md` (§8 T1a row). Prototype: `docs/ux-redesign/tablet/`, screenshots `tablet/png/`, interactive `tablet/index.html`, already styled like iPadOS. Pairing/wording: `06-pairing-remote-control.md`. Technical approach: `03-project-plan.md` §5. Invariants: 03 §6.

Read these from `origin/ux/design` with `git show origin/ux/design:<path>`. They are absent from the task branch. For browser exploration, create a separate detached read-only worktree. Do not copy designs into the task branch.

The task branch's `apps/android` works against real backend services and may guide behavior. Its review is complete and defects are being fixed on Android. Do not copy those defects, listed below. Designs and TypeScript take precedence over conflicting Android behavior. Report differences.

Before starting, confirm this file has 4 second-level headings and the final section is "Report".

## Goals

Proceed in order, establishing the iOS Rust core before UI.

1. **Toolchain and simulator**:
   - Full Xcode/iOS platform is required, not merely command-line tools. If unavailable, stop and ask the user to install it, as below.
   - Add Rust targets `aarch64-apple-ios` and `aarch64-apple-ios-sim`.
   - Create an iPad simulator with `codetether` in its name, as close as possible to the user's model.
   - Installing other tools such as XcodeGen or SVG conversion is allowed. Report versions.
2. **Project skeleton**:
   - One SwiftUI app under `apps/ios`, iPad-only (`TARGETED_DEVICE_FAMILY = 2`). iPhone support comes later.
   - Bundle ID `org.codetether.app`, with a reported suffix if the free account cannot register it.
   - Deployment target no newer than the user's iPad OS. Check with `xcrun devicectl list devices` after connection.
   - Choose checked-in Xcode project or generation such as XcodeGen. Clean checkouts must build with one command.
3. **Integrate Rust core** (`packages/supervisor-mobile`):
   - Build static libraries for both targets, package as XCFramework, and generate Swift with the crate's `uniffi-bindgen` (`bindgen` feature). Regenerate artifacts by script rather than committing them.
   - Minimize crate changes and commit them separately for rebasing after T1a merge. Preserve Android builds.
   - Known change: `src/relay.rs:32` `BUILD_ID` hardcodes `android-`. Report the correct iOS platform.
   - `connect_supervisor`, `request`, and `disconnect` block synchronously. Keep them off the main thread.
   - **Interoperability**: Swift simulator tests call existing TypeScript fixtures (`tests/interop-fixture.mjs`) through UniFFI, with one read and one write over each direct/Relay path. TypeScript remains authoritative and unchanged.
4. **Identity, login, pairing**:
   - Non-exportable Secure Enclave P-256 key. `DeviceSigner` calls `SecKeyCreateSignature` with `.ecdsaSignatureMessageX962SHA256`, returning DER that Rust converts to r‖s. Private keys remain in Secure Enclave. Only DEBUG simulator builds may fall back to software keys, as Android does (`AndroidDeviceIdentity.kt:65`).
   - Existing-account email-code login. Store state in Keychain with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, excluding iCloud sync and restoration to other devices.
   - Registration uses `deviceType` set to `tablet` and `iPadOS-arm64` (`iPadOS-Simulator-arm64` on simulator). Use the model for the name. Since iPadOS 16, `UIDevice.current.name` returns only iPad, so obtain the specific model through system information and choose its display.
   - Enter the computer's 6-digit code (06 §3.1). Wrong/expired/used/invalidated copy follows 06 §1 and 01-03–01-05.
5. **Pages**, matching existing backend capabilities, prototypes, and T1a scope:
   - Login/first pairing (01-01–01-05).
   - Recent conversations/Inbox (02-01/02-02) with direct approve, reject, and mark reviewed.
   - Conversation (02-03–02-09): live updates, approval cards, stop, failure, imported sessions. More contains Archive only.
   - Changes (02-04): landscape right panel collapses sidebar, portrait overlays the conversation.
   - New Conversation (02-10/02-11), title search among loaded conversations (02-12).
   - Devices (03-01–03-03), without Add Project.
   - Project (03-04/03-05): conversations/status filter. Exclude content search, previous conversations, rename, and remove.
   - Settings (04-01–04-05): account/sign out, usable computers (remove/add by code), system/light/dark appearance, Connection Check with Relay-only option, Roadmap. Exclude notification/background/unlock settings.
   - Removed (04-06), portrait/dark (05-01–05-05).
   - Unimplemented features appear only in Settings › Roadmap (03 §6).
   - Use 07 §2 dimensions in pt. Narrow split-screen, Slide Over, or Stage Manager windows use portrait layout and full-width forms without squeezing content.
6. **Keyboard**: adapt 07 §2 to ⌘N New Conversation, ⌘K search, ⌘↩ send, Esc close. Include them in system hold-⌘ shortcut help.
7. **Physical-device verification**: simulator first, then the user's iPad. Fill the acceptance table.

## Known Facts

- **Base**: Rust crate is not merged into `main`. Run `git fetch origin` and branch `i1/ipad-app` from `origin/t1a/tablet-app`, currently `f290602`, in a worktree such as `~/agenthub-work/i1-ipad`. Preserve existing Mac worktrees/uncommitted changes. Rebase onto `main` after T1a merges.
- **Protocol references** (at `f290602`):
  - Rust already implements Supervisor/Relay, documented in its `README.md`. Swift primarily integrates the control service.
  - Android account code: `apps/android/app/src/main/java/org/codetether/app/account/` (`ControlPlane.kt`, `AccountSessions.kt`, `AccountHttp.kt`).
  - Original TypeScript:
    - Registration: `apps/web/src/runtime/account/control-plane-client.ts:415`, `:432`.
    - Directory: `:662`.
    - Pairing: `apps/web/src/runtime/account/pairing-client.ts:334`.
    - Self-unpair: `apps/control-plane/src/server.ts:1336`.
    - Email codes: `apps/web/src/runtime/account/account-auth-actions.ts:40`, `:52`.
  - Operation/result schemas: `packages/supervisor-transport/src/protocol.ts`.
- **Android real-backend observations also apply** (`D:/Projects/Software/agenthub-archive/t1a-report.md`, key points supplied by user):
  - Successful device-side `readClaim` returns only `sessionView`. Wait for usable control authorization in the directory.
  - Active-archive conflict is wire `conflict` without a numeric status. Present the reason as 409.
  - Actual frame limit is 16 KiB. Halve history/live batches on server `internal`. An oversized single record is a reported backend gap.
  - Foreground live polling uses 750 ms, matching Android (`RemoteSupervisor.kt:137`).
  - Display the default computer name CodeTether Host as This Computer (`ControlPlane.kt:245`).
  - When three Relay build values exist, validate them against the directory descriptor (`ControlPlane.kt:252`).
- **Android review defects** present at `f290602` on 2026-11-04, to avoid from the start:
  - Sign out clears local login before disconnecting and clearing UI.
  - Drafts survive rotation/background and clear only on explicit send success.
  - Close Create only after success. Preserve input on failure.
  - Merge refreshed post-Turn history with loaded history and update pagination boundaries. Android replaced everything with the latest 8 records, losing earlier Turns.
  - Identify changes by turnId/itemId/path, allowing multiple records for one path.
  - Allow cancelling while waiting for the computer to complete pairing.
  - Refresh once on control-service 401, returning to login if rejected again.
  - Foreground restoration rereads the current page, including projects, without showing loading as an empty list.
  - `DeviceSigner` callbacks throw only `MobileError`. Other errors panic because `MobileError` lacks conversion from unexpected UniFFI callback errors.
  - Generated `ConnectOptions` includes an access token. Never print it or include it in error messages.
  - Rotation, split screen, and Stage Manager resizing do not constitute backgrounding. Preserve operations/connections until `scenePhase` becomes `.background`, not `.inactive`.
  - `action.get` cannot find creation actionIds (Host only looks up send actionIds). For uncertain results let the user retry original actionId/content, deduplicated by Host. Pending work blocks only its own conversation/project.
- **B1 retest observations**:
  - Old authorization can return `authorization_revoked` immediately after renewal. Reread the directory and retry the newest authorization before declaring removal.
  - Post-removal `request_failed` also describes ordinary connection failure. Show Removed only after directory confirmation of no effective authorization, otherwise show unreachable.
- **Capability gates**: use returned tool capabilities (`approvals`, `interrupt`), not hardcoded names. See `apps/web/src/dev/supervisor-operation-client.ts:233-266`. Match 07 §1, where only local Codex supports approval, stop, and diffs.
- **Build configuration**:
  - Same values as desktop: `VITE_CODETETHER_CONTROL_PLANE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `CODETETHER_SUPERVISOR_RELAY_ENDPOINT` / `_ID` / `_FINGERPRINT`.
  - Read only these 6 from `~/agenthub-work/v4-build.env` into an untracked xcconfig/generated file. Do not load the whole file into `xcodebuild` environment. Escape URL `//`, which xcconfig interprets as comments.
  - The publishable key is intentionally bundled but must not be committed/printed. Keep signing Team ID in untracked local configuration too.
  - Without the three Relay values, rely on the Rust core's signed-descriptor validation, matching Android.
- **Free Apple ID**, user decision 2026-11-04:
  - The installed iPad app expires in 7 days. Rerun from Xcode. At most 3 self-signed apps per device.
  - Push, App Groups, and iCloud capabilities are unavailable and unnecessary. Omit their entitlements.
- **Lifecycle**: iOS suspends background apps. Disconnect/cancel on background, then reread directory, reconnect, and refresh on foreground, matching Android. Request no background mode.
- **Local network**: include `NSLocalNetworkUsageDescription` in `Info.plist`. Denial causes direct failure and Automatic Relay fallback, explained in Connection Check. Control service/Supabase use HTTPS. No ATS relaxation.
- **Peer computer is this Mac**:
  - Installed app lacks B1. Use the development app in this worktree, whose desktop code matches `main`.
  - Launch as in B1 cross-device testing:
    - Build shell loads `set -a; . ~/agenthub-work/v4-build.env; set +a`, without printing.
    - Set `CODETETHER_CONTROL_PLANE_URL=https://api.codetether.org` and point `CODETETHER_DATA_DIR` at a new isolated directory.
    - In `apps/desktop`, run `node scripts/run-tauri.mjs dev --config src-tauri/tauri.dev.conf.json`.
  - Build sidecar with checksum-verified official Node, same version as Mac round 8 in `~/agenthub-archive/v4-acceptance-report-mac.md`. Round 7's `/tmp` Node 25.5.0 produced a Host that would not start.
  - Both installed/development apps use 4317. Ask before quitting installed. Until confirmed, work independently. Quit with `osascript -e 'quit app "CodeTether"'`. After testing, quit development, reopen with `open -a /Applications/CodeTether.app`, and verify online.
  - Development origin is `http://127.0.0.1:5173`, normally denied by control service. Temporarily allow it before login/pairing-code generation, restoring afterward.
  - New isolated login may register another test computer. List it and remove through UI if supported.
  - Use a dedicated small test project and short prompts consuming real Codex/Claude Code quota. Real Codex verifies approve/stop/line-diff/incremental text, absent from T1a synthetic coverage. Claude verifies unsupported controls stay hidden.
  - If real tools cannot reliably wait for approval, create an uncommitted synthetic Provider fixture under `~/agenthub-work`, referring to `startLocalCodexHostWithRuntime` at `apps/host/src/api/local-codex-host.ts:403`.
  - If Mac development cannot work, stop with reasons. The fallback is user-started Windows B1 development/fixtures.
- **Wait for the user**:
  - Install full Xcode from App Store, launch it for components/license, then sign in at Xcode › Settings › Accounts.
  - Connect iPad by USB, trust Mac, join the same Wi-Fi, enable Settings › Privacy & Security › Developer Mode and reboot, then trust the developer under Settings › General › VPN & Device Management after first installation.
  - Quit installed Mac app.
  - Temporarily allow development origin, performed by user on Windows.
  - The user enters email/pairing codes on iPad, or supplies them for simulator without logging. Generate pairing code at desktop Devices › Add Device › Add Phone or Tablet.
  - Accept first local-network permission on iPad and Mac firewall dialogs.
- Renewal/re-signing is already production-verified in B1 R1. Do not retest or change production database.

## Precautions

- Do not change Host, control service, Relay, B1, or `apps/android`. Limit crate changes to iOS requirements and report backend gaps.
- **Credentials**:
  - Keep Supabase keys, login tokens, email/pairing codes, private keys, and Apple ID data out of console, repository, logs, Xcode output, and reports.
  - Do not read `.secrets/`, other `.env`, credentials, `~/.codex/auth.json`, or `~/.claude.json`. Load `v4-build.env` only as above.
  - Do not print environment or save full `xcodebuild -showBuildSettings`. A T1a cargo-ndk crash logged inherited database credentials. Use environment allowlists for scripts/subprocesses and disable Run Script environment logging.
- Preserve installed Mac data and app. Use only the newly created simulator. Delete no other Xcode/simulator resources.
- **Visuals**, following prototypes and 07 §3:
  - SwiftUI grouped lists, large titles, translucent bars, and forms match the design. Use them directly.
  - Replace default blue accents with ink `#1c1c1e` (dark `#f2f2f7`) for main/send/selected/switch controls. Reserve blue for links (`#135e9c` / `#7cc0f2`) and running (`#1a7fd0` / `#3c9be3`). Tokens in `tablet/tablet.css`.
  - Minimum 44 pt targets for iPadOS, versus Android's 48 dp in 07 §3. Follow larger prototype targets.
  - Export `docs/ux-redesign/icon/final/codetether-app.svg` as opaque 1024×1024 PNG. System applies corner rounding.
  - Preserve native permission, keyboard, and share UI.
- **Wording** follows prototypes. Host, Node, Machine, ProductDevice, Supervisor, Relay, authorization, grant, and fingerprint appear only in Settings › Connection Check (03 §1).
- Preserve 03 §6 invariants:
  - iPad accesses computers only through Supervisor.
  - iPad exit, disconnection, death, and backgrounding do not stop computer work.
  - `actionId` idempotency, no automatic resend, explanatory 409 for active archive.
- **Gates**:
  - Rust `cargo test --locked`, including interoperability after building TypeScript fixture dependencies per crate `README.md`.
  - Both Rust iOS targets and XCFramework scripts.
  - Simulator `xcodebuild test` unit/interoperability/key-flow UI tests.
  - Device build (`generic/platform=iOS`).
  - Preserve `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
  - Without Android toolchain, omit Gradle on Mac, report this, and request Windows verification.
- Choose commit breakdown and push when complete.

## Report

Write `~/agenthub-archive/i1-report.md`, with long outputs in `i1-logs/` and screenshots in `i1-shots/`.

Include:

- Work for each goal and differences from 07/prototypes/Android with reasons.
- Xcode/iOS SDK/Swift/Rust/UniFFI versions, iPad model/OS, deployment target, Bundle ID.
- Crate files/commits for Android build verification on Windows.
- Direct/Relay interoperability.
- Simulator/iPad identity security, Secure Enclave or software.
- Acceptance table with results/evidence:
  1. Simulator/iPad pairing, correct names/platforms under desktop Phones and Tablets.
  2. Direct/Relay-only recent, Inbox, devices/projects, reads/live updates, Changes, and real Codex diff/incremental text.
  3. Create/reply/approve/reject/mark reviewed/stop once each and active-archive 409.
  4. Unsupported tools hide approve/stop.
  5. Computer work survives iPad disconnection, exit, death, and backgrounding.
  6. Removal disconnects within seconds, shows Removed, then re-pairing works.
  7. Network/foreground recovery agrees with computer state.
  8. Orientation, themes, split screen/Stage Manager narrow windows, keyboard.
  9. Free-ID physical install, login/pairing, local-network permission, direct/Relay reads and writes.
- Every page's numbered simulator landscape/portrait/dark screenshots plus split-screen examples and several device shots. Distinguish synthetic and real scenes.
- Backend gaps/issues.
- List and finally remove test pairings/computers.
- Branch/commits/push status and signature-expiry date.
- Unfinished work and reasons.

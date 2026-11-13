# Task: T1a Tablet App, First Round (Android)

Run on this Windows computer. The design is in `docs/ux-redesign/07-tablet.md` (§8 defines this round), the prototype in `docs/ux-redesign/tablet/` (screenshots in `tablet/png/`, interactive in browser through `tablet/index.html`), pairing and wording in `06-pairing-remote-control.md`, technical approach in `03-project-plan.md` §5, and invariants in 03 §6.

These design documents are on `origin/ux/design`, absent from the task branch. Read `D:/Projects/Software/agenthub/docs/ux-redesign/` directly without modifying that worktree, or use `git show origin/ux/design:<path>`. Do not copy them into the task branch.

Before starting, confirm this file has 4 second-level headings and the final section is "Report".

## Goals

Proceed in order. The connection core carries the greatest risk. Establish interoperability before implementing UI.

1. **Toolchain and emulator**: install Android NDK, Rust targets `aarch64-linux-android` and `x86_64-linux-android`, and `cargo-ndk`. Create a tablet emulator named with `codetether`, using Pixel Tablet at 1280×800 dp and the installed `android-36` `google_apis` `x86_64` image.
2. **Project skeleton**:
   - `apps/android`: one Kotlin/Jetpack Compose application, applicationId `org.codetether.app`, minSdk no higher than 33 (vivo X60 runs Android 13).
   - Put the reusable Rust connection core in a separate crate outside `apps/android` for future iOS use. Generate Kotlin interfaces through UniFFI and package into the APK using cargo-ndk.
   - Choose names/directories and document them in the report.
3. **Connection core (M0)**:
   - Implement the same Supervisor client as desktop: TLS 1.3, pinned Host fingerprint, and device proof bound to the TLS exporter.
   - Support direct and Relay paths. Relay uses outer TLS to Relay with its pinned fingerprint and Relay frames, wrapping inner TLS to Host.
   - Cover all remote operations in `protocol.ts`.
   - **Interoperability**: run local fixtures using the existing TypeScript server and Relay, testing Rust over direct and Relay. TypeScript is authoritative and must remain unchanged. Add fixed vectors for canonical JSON, signatures, and exporters.
   - If Android Rust-core cost is clearly too high (03 §5), stop and report reasons and an estimate for pure Kotlin. Do not change approach independently.
4. **Device identity, login, pairing**:
   - Device key: non-exportable ES256/P-256 in Android Keystore, preferring StrongBox then TEE. Rust requests Kotlin signing through a callback. The private key stays in Keystore.
   - Login: desktop-compatible email codes, existing accounts only. Encrypt persisted login state with a Keystore key and exclude it from backups.
   - Device registration: platform `Android-arm64` / `Android-x64`, with the system model name.
   - Pairing: enter the computer's 6-digit code (06 §3.1). Follow 06 §1 and prototypes 01-03–01-05 for wrong, expired, used, and invalidated codes.
5. **Pages**: implement all currently backed capabilities, following prototypes/screenshots and 07 §8 T1a:
   - Login and first pairing (01-01–01-05).
   - Recent conversations and Inbox (02-01, 02-02), with approve/reject/mark reviewed directly in Inbox.
   - Conversation (02-03–02-09): live updates, approval cards, stop, failure cards, imported conversations. More contains only Archive.
   - Changes (02-04): landscape right panel automatically collapses the sidebar, portrait overlays the conversation.
   - New Conversation (02-10, 02-11), Ctrl K title search among loaded conversations (02-12).
   - Devices (03-01–03-03), without Add Project.
   - Project (03-04, 03-05): conversations/status filters. Exclude project-content search, previous conversations, rename, and removal.
   - Settings (04-01–04-05): account/sign out, usable computers (remove or enter another pairing code), appearance (system/light/dark), Connection Check with Relay-only mode, and Roadmap. Exclude notifications, background connectivity, and unlock confirmation.
   - Removed (04-06), portrait/dark (05-01–05-05).
   - Unimplemented features appear only in Settings › Roadmap (03 §6).
   - Initially reuse tablet portrait layout on phones, with full-width forms. Login, pairing, and Connection Check must work. Dedicated phone layout comes later.
6. **Keyboard**: Ctrl N New Conversation, Ctrl K search, Ctrl Enter send, Esc close dialog (07 §2).
7. **Physical-device verification**: follow the final Known Facts entries and fill the report's acceptance table.

## Known Facts

- **Base**: B1 was fast-forwarded into `main` (`9694895`, 2026-11-04). Run `git fetch origin` and rebase `t1a/tablet-app` onto `origin/main` in `D:/Projects/Software/agenthub-t1a-tablet`. Because the merge was a fast-forward, this should be a no-op. Otherwise stop and report rather than forcing conflict resolution.
- **Protocol references** (line numbers at `9694895`):
  - `packages/supervisor-transport/src`:
    - TLS/exporters in `tls.ts`. Label `EXPORTER-CodeTether-Supervisor-v1` (`constants.ts:9`), Host ECDSA P-256 certificate.
    - Direct `client.ts:398`, Relay inner TLS `client.ts:431`, outer TLS `relay.ts:423`.
    - Canonical JSON/JWS ES256 in `crypto.ts`. Keystore returns DER signatures, requiring conversion to 64-byte r‖s.
    - Operation/result schemas in `protocol.ts`.
  - Relay framing/authentication: `packages/relay-protocol/src` (`framing.ts`, `supervisor.ts`, `auth-transcript.ts`).
  - Complete new-device flow:
    - Host as client to another computer: `beginRemote`:1001 and `authenticateRemote`:1156 in `apps/host/src/api/supervisor-transport-manager.ts`.
    - Development diagnostics: `apps/web/src/dev/supervisor-check-client.ts`, pairing at `:54`, directory reads at `:118`.
  - Control-service APIs:
    - Device registration: `apps/web/src/runtime/account/control-plane-client.ts:415`, `:432`.
    - Directory: `:662`.
    - Pairing: `apps/web/src/runtime/account/pairing-client.ts:334`.
    - Self-unpair: `apps/control-plane/src/server.ts:1336`.
    - Email codes: `apps/web/src/runtime/account/account-auth-actions.ts:40`, `:52`.
- **Capability gates**: derive approval, stop, and line-diff availability from returned capabilities (`approvals`, `interrupt`) rather than hardcoded tool names. See `apps/web/src/dev/supervisor-operation-client.ts:233-266`. Outcomes must match 07 §1: only Codex local to the computer supports these capabilities.
- **Build configuration**: use the desktop's control-service address, Supabase address/publishable key, and Relay address/ID/fingerprint (`VITE_CODETETHER_CONTROL_PLANE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `CODETETHER_SUPERVISOR_RELAY_*`). Use the same sources as the B1 development retest, read from environment or untracked local configuration at build time, never committed.
- **Two B1 retest observations** (`D:/Projects/Software/agenthub-archive/b1-fix-report-r1.md`) require client handling:
  - Immediately after renewal, reconnecting with old authorization returns `authorization_revoked`. New authorization succeeds. Reread the directory and retry with its newest authorization before concluding removal.
  - Reconnecting after removal yields `request_failed`, indistinguishable from ordinary connection failure. Show Removed only when the control service confirms no effective authorization. Otherwise show the ordinary unreachable-computer message.
- **This computer's test environment**:
  - Installed `v0.1.0-alpha.2` lacks B1. Pair against the B1 development app only. Launching, isolated data, and synthetic approval/running-Turn/unsupported-tool fixtures are described under "Windows retest" in the B1 retest report and `agenthub-archive/b1-logs/windows-dev-launch.mjs`. Run the development app in `D:/Projects/Software/agenthub-b1-pairing` without changing its code.
  - Both installed and development apps use 4317. B1 Mac cross-device acceptance finished on 2026-11-04, removing that conflict. Still ask the user before startup to confirm the installed app may quit. Until confirmed, work on independent parts.
  - Quit the installed app from the tray before use. After testing, quit development, reopen installed, and confirm it is online.
  - Android is native, so control-service CORS needs no change.
- **Wait for the user at these points**:
  - The user supplies the email login code.
  - The user generates the pairing code in development Devices › Add Device › Add Phone or Tablet.
  - The user connects vivo X60 over USB and enables debugging.
- Renewal/re-signing was already production-tested in B1 R1. Do not retest it or change the production database.

## Precautions

- Do not change Host, control service, Relay, or B1 code in this round. Report backend gaps/issues.
- Keep credentials out of console, repository, logs, logcat, and reports: `.secrets/`, Supabase keys, login tokens, email/pairing codes, and private keys. Disable app backup through `allowBackup` and extraction rules, and disallow cleartext networking.
- Use only the emulator created for this task. Leave `anju_api36` and other Android SDK contents alone. Installing NDK, Rust targets, cargo-ndk, or emulator images is allowed. Report versions. Do not install/replace the CodeTether desktop application.
- **Visuals**: follow prototypes and 07 §3.
  - Grouped lists, large titles, rounded forms, monochrome ink buttons/selections (white in dark mode), and blue only for links/running states.
  - Avoid Material 3 defaults and wallpaper-derived colors. Touch targets are at least 48 dp.
  - Build an adaptive icon from `docs/ux-redesign/icon/final/codetether-app.svg`.
- **Wording** follows the prototype. Host, Node, Machine, ProductDevice, Supervisor, Relay, authorization, grant, and fingerprint are allowed only in Settings › Connection Check (03 §1).
- Preserve 03 §6 invariants, especially:
  - Tablets access computers only through Supervisor.
  - Tablet exit, network loss, or process death does not affect computer work.
  - `actionId` idempotency, no automatic resend after failure, and an explanatory 409 when archiving active work.
- **Gates**:
  - Rust `cargo test`, including interoperability.
  - `gradlew` unit tests, lint, and `assembleDebug`.
  - Compose UI tests for key emulator flows.
  - Existing `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` must not regress.
- Choose commit breakdown independently and push the completed branch.

## Report

Write `D:/Projects/Software/agenthub-archive/t1a-report.md`. Put long outputs in `t1a-logs/` and screenshots in `t1a-shots/`.

Report contents:

- Work for each goal and differences from 07/prototypes with reasons.
- Toolchain/dependency versions (Rust TLS library, UniFFI, Compose, etc.), crate/directory names.
- Direct/Relay interoperability and fixed-vector results.
- Emulator and vivo X60 Keystore level: StrongBox, TEE, or software.
- Acceptance table with result and evidence links for each row:
  1. Emulator pairing succeeds and the tablet appears under Phones and Tablets on desktop with correct name/platform.
  2. Recent conversations, Inbox, devices, projects, conversation reads/live updates, and Changes work over direct and Relay-only paths.
  3. Create, reply, approve/reject, mark reviewed, and stop once each. Active archive shows 409.
  4. Unsupported tools expose no approve/stop actions.
  5. Computer work continues when tablet networking disconnects, the app exits, or its process is killed.
  6. Desktop removal disconnects the tablet within seconds and shows Removed. Re-pairing succeeds.
  7. After network or foreground recovery, state agrees with the computer.
  8. Landscape/portrait, light/dark, and external-keyboard shortcuts.
  9. vivo X60 installation, login, pairing, and reads/writes over direct and Relay.
- Each page's landscape, portrait, and dark screenshots, named with prototype page numbers.
- Backend gaps/issues discovered.
- List all test pairings and remove them on the computer at completion.
- Branch, commits, push status, and debug APK path.
- Unfinished work and reasons.

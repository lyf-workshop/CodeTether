# Task: Phone Shows the Computer Offline (vivo X60 Diagnosis)

**Where it runs.** On Windows, with the vivo X60 connected over `adb` and the Pixel Tablet emulator `codetether_t1a_pixel_tablet_api36`. The phone and the emulator are paired with this computer's installed CodeTether desktop.

**Branch and worktree.** Start after task 1 (the `v0.1.0-alpha.3` release) has installed the tag's build on this computer (fetch first). Diagnose without a branch. If a code change is needed, create `fix/android-phone-offline` from the current `origin/main` in worktree `D:/Projects/Software/agenthub-work/fix-android-phone-offline`.

**Why this task exists.** On 2026-11-15 the T1a re-check passed all nine items on the emulator. On the vivo X60, the app showed the Windows computer online for a moment and then offline, in both Auto and internet-only modes, and it stayed that way. The same APK kept a live session on the emulator against the same desktop. So the phone could not be used for conversations, and nobody knows why. A phone that cannot hold a connection breaks the mobile product's core loop.

**References** (read with `git show origin/ux/design:<path>`):

- `docs/reviews/fix-t1a-tablet-fidelity.md`, "Round 4: Owner device re-check"
- `docs/ux-redesign/06-pairing-remote-control.md` (pairing, connection and their copy)
- `docs/ux-redesign/03-project-plan.md` §6 (invariants)

Local evidence, not in the repository:

- `E:/Projects/Software/agenthub/acceptance-945c849/VIVO-X60-ACCEPTANCE.md` and `EMULATOR-ACCEPTANCE.md`, with their logs and screenshots in the same folder
- `D:/Projects/Software/agenthub-archive/release-v0.1.0-alpha.3-r2-report.md` (the release's Android debug APK and its SHA-256)

Before starting, confirm this file has 4 second-level headings and that the last one is "Report".

## Goals

**Must:**

1. **Record the starting state before changing anything.** Recovering first would destroy the evidence.
   - **The phone:** the installed build (SHA-256 if you can get it), Connection Check in Auto and in the Debug internet-only mode, and what Home and Devices show.
   - **The desktop:** its device list, and the authorizations the Host holds for the phone and for the emulator: safe labels, issued and revoked times, scope. Show at most the first 8 characters of any identifier or fingerprint.
   - **The 2026-11-15 re-pair attempt:** whether it created a new authorization for the phone and revoked the old one (see Known facts).
2. **Find the failing step.** For one connection attempt in each mode on the phone, find where it stops:
   - name resolution and TCP
   - the TLS handshake and Host pinning
   - device proof and authorization
   - session open
   - the first directory read

   Use `adb logcat` for the app and the Host's own logs and diagnostics at the same timestamps. If neither side records the stage, add debug-only logging (`BuildConfig.DEBUG` on Android) that names the stage and the error class, on the fix branch, and install a debug APK built from it.

3. **Separate the possible causes** with these checks, and report each result:
   - **a. The internet route.** On the emulator, with the alpha.3 debug APK, stay online for 10 minutes in Auto, then 10 minutes in the Debug internet-only mode. If internet-only fails on the emulator too, the problem is the Relay route, not the phone.
   - **b. A stale authorization.** Does the authorization the phone presents match one the Host accepts?
   - **c. vivo restrictions on the app.** The earlier TCP checks ran from the `adb` shell, which vivo does not restrict the way it restricts an app. Record the app's network permission (WLAN and mobile data), its battery and background settings, and any network acceleration or dual-network setting. Test reachability from inside the app, not from the shell.
   - **d. Upgrading over old data.** The emulator was signed in and paired fresh; the phone kept data from an earlier build. Find the build the phone had before, from `D:/Projects/Software/agenthub-archive/t1a-report.md` or `adb shell dumpsys package org.codetether.app`. On the emulator, install that build, sign in and pair, then upgrade in place to the alpha.3 debug APK. Does it stay online?
4. **State the root cause** with its evidence, and which part owns it: the Android app, the Rust core, the Host, Relay, the Control Plane, or the phone's settings. Also explain why the phone showed the computer online briefly before showing it offline.
5. **Fix it, if the cause is in the Android app or the Rust core**, on the fix branch, with tests that fail before the fix. If the cause is elsewhere, stop after goal 4 and report the proposed fix and the part that owns it.
6. **Finish the phone checks the re-check could not do.** Once the phone holds a connection, after the fix or after a recovery the Owner approves, check on the vivo X60:
   - it stays online for 10 minutes in Auto
   - a live conversation in a scratch project: send a message and get a reply
   - the Changes panel on a conversation that has changes
   - New Conversation creates a conversation
   - `adb shell am kill` while the app is in the background, then restore it from Recents
7. **Quality gate, if code changed:**
   - the Gradle gate: `testDebugUnitTest lint assembleDebug assembleDebugAndroidTest`
   - `cargo test` in `packages/supervisor-mobile` if the Rust core changed
   - `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test` if TypeScript changed
   - `pnpm format:check` for changed files

**Should:**

8. **A pairing that fails halfway leaves the phone recoverable.** If Desktop accepted the code but the phone never stored the new authorization, say whether the phone was left holding a revoked one. Propose a fix so the phone either completes the pairing or tells the user to enter a new code; implement it if it is Android-only.
9. **Say what went wrong.** Today every failure reads "暂时连不上，请检查网络后重试。" or "这台电脑现在连不上，请确认它开着并且联网。". Where the failing stage is known, show a plain, distinct message, for example that the computer no longer recognizes this phone and a new pairing code is needed. Use no technical terms (06 and the T1a wording rules).
10. **The instrumentation crash.** The vivo instrumentation run ended with "Process crashed" (`vivo-approval-test.log`). Say whether the app or only the test process crashed. If it was the app, include the stack trace with identifiers redacted.

## Known facts

- **Builds.**
  - The re-check used a `945c849` debug build made with the public client configuration (Control Plane `https://api.codetether.org` and the Supabase project) by `E:/Projects/Software/agenthub/acceptance-945c849/build-configured.ps1`.
  - A build without that configuration cannot sign in. Do not print its values.
  - The release built the alpha.3 debug APK from the tag with the same configuration: `E:/Projects/Software/agenthub/release-alpha3-android-build/CodeTether_v0.1.0-alpha.3_debug.apk`, SHA-256 `1645aa1fc2dd8450baa03d5164c963d75a32d9b9cd2afcae77323f91600879c9`. Use it as the build under test.
  - The alpha.3 APK has `versionCode` 2; every earlier build, including `945c849`, has 1. Going back to an earlier build over alpha.3 needs `adb install -r -d`. If a downgrade fails on stored data, say so; don't clear data to get past it.
- **The phone.**
  - vivo X60 (`V2046A`), Android 13, arm64-v8a, 1080×2376 px at 480 dpi.
  - The system font scale is 1.54; leave it.
  - Its app data and pairing come from an earlier build and were kept on install (`adb install -r`).
- **The network.**
  - The phone's Wi-Fi and Windows were on the same network.
  - From the phone's shell, TCP connections succeeded to the Host's direct endpoint (port 4318), to `relay.codetether.org:8443`, to the account service and to the Control Plane. This proves TCP reachability from the shell only.
  - The desktop's online publisher reported 2xx updates with no failures.
- **The symptom.**
  - Home showed the computer online with its conversations, then offline.
  - Connection Check reported it offline in Auto and in internet-only, also after "重新检查".
  - Restarting the app did not help.
  - The Debug connection mode is in-memory and returns to Auto when the app restarts (`TabletState.kt:64` on `945c849`).
- **The re-pair attempt.**
  - A new pairing code was claimed on Desktop, but the phone showed a generic network error.
  - In the Control Plane, finishing a pairing for a device revokes that device's other authorizations: `supersedeOtherDeviceAccess` in `apps/control-plane/src/persistence/host-pairing-repository.ts`, called from `apps/control-plane/src/services/host-pairing-service.ts` (around line 849 on `4801ef1`). So the phone may now hold a revoked authorization.
  - The phone was already offline before this attempt, so it does not explain the first failure.
- **Not a device limit.** A computer accepts up to 64 active devices (`supervisorTransportLimits.maximumActivations`), so pairing the emulator did not push the phone out.
- **The emulator.**
  - Same APK, freshly signed in and paired with the same desktop on 2026-11-15.
  - A live conversation worked, including Changes and restoring after process death.
  - Which route it used, direct or Relay, was not recorded.
- **Production Relay** runs `e4bdd57`. This task does not redeploy it.
- **Other agents** may be working on this computer at the same time. Do not restart or replace the installed desktop without asking.

## Boundaries

- **Decide yourself:**
  - how to diagnose
  - debug-only logging
  - installing debug builds on the vivo X60 and the emulator with `adb install -r`; this prompt is the Owner's approval for that
  - Android and Rust-core fixes, with tests
  - Chinese copy within the product's existing tone
  - commit splitting
- **Ask the Owner first:**
  - clearing the app's data, uninstalling it, removing the phone from Desktop, or re-pairing. Each of these destroys evidence, so finish goal 1 first.
  - any change to the Host, Relay, the Control Plane or the Supervisor wire format
  - restarting or replacing the installed desktop
  - changing the phone's system settings
- **Do not:**
  - query the production Control Plane database or use any administrative access
  - read or print credentials, keys, tokens, pairing codes or full identifiers
  - deploy Relay or the Control Plane
  - push `main`, merge or tag
  - edit `AGENTS.md` or `docs/`

If you created `fix/android-phone-offline`, push it to `origin`.

## Report

Write to `D:/Projects/Software/agenthub-archive/android-phone-offline-report.md`, with logs and screenshots in `D:/Projects/Software/agenthub-archive/android-phone-offline/`:

- **Starting state:** goal 1, before anything changed.
- **Checks:** each check in goal 3 and its result.
- **Root cause:** the cause, the part that owns it, the evidence, and why the computer showed online briefly first.
- **Fix:** what changed, the main files, and the tests that failed before the fix. If the cause is outside Android and the Rust core, the proposed fix and its owner instead.
- **Phone checks:** each item in goal 6, pass or fail.
- **Gates:** results for each check, with failures quoted verbatim.
- **Commits:** your commits and the pushed remote commit.
- **Status:** anything not done and why, and the completion level reached.

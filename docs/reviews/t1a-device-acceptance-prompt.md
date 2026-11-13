# Task: T1a Android Physical-Device Acceptance (vivo X60)

Run on Windows, where the T1a toolchain and `adb` are installed. This round is acceptance testing only. Do not change repository code or commit.

References: `docs/reviews/t1a-tablet-app-prompt.md` and `docs/ux-redesign/07-tablet.md` on `origin/ux/design`, read with `git show`. Historical T1a results are in `D:/Projects/Software/agenthub-archive/t1a-report.md`.

Before starting, confirm this file has 4 second-level headings and the final section is "Report".

## Goals

Verify the T1a Android app on a physical vivo X60, connecting to CodeTether on Mac over both direct and Relay paths. Use application commit `b668e53` from `origin/main`, identical to `b668e53` on `t1a/tablet-app`.

T1a was previously tested only on an emulator. This round supplies results that require a physical device. Record each checklist item as Passed, or Failed with symptoms and errors:

1. **Installation and launch**: install the debug APK on the phone and launch to the login page.
2. **Device-key security level**: the app stores its device key in Android Keystore, trying StrongBox, TEE, then software. Record the actual vivo X60 level from settings/logs, or use adb/existing diagnostics if it is not visible.
3. **Login and pairing**: sign in to the same account using an email code. Pair with the Mac's 6-digit code from Add Device › Add Phone or Tablet. Verify the phone appears on the Mac device page with the correct name and platform (`Android-arm64`).
4. **Direct** (Settings › Connection Check, Automatic): recent conversations, Inbox, existing history and live updates, replies, new conversation and response, changed-file list and line-by-line diff, approve, reject, stop, mark reviewed, archive, search, devices, and projects.
5. **Relay** (Relay only): repeat item 4. When the Mac disconnects or quits, the phone still reaches Relay and shows the computer offline. Continue over Relay after Mac recovery.
6. **Real content**: run a real Codex or Claude Code task on Mac that changes files. Emulator acceptance used synthetic fixtures and did not verify real line-by-line diffs or incremental text. Verify both now.
7. **Removal**: keep a connected conversation while removing this phone on the Mac device page. Measure seconds from Remove to the phone's Removed page using a stopwatch or log timestamps. T1a previously obtained only a 13.69-second upper bound including automation overhead. Verify Mac work continues, re-pair with a new code, confirm connectivity, then remove the phone on Mac to leave no test authorization.
8. **Layout and input**: portrait, landscape, light, and dark. In-flight drafts and pending confirmations survive rotation. If a Bluetooth or OTG keyboard is available, test Ctrl+N for New Conversation, Ctrl+K for search, Ctrl+Enter for send, and Esc for close. Otherwise record Not tested.

## Known Facts

- **OS version**: the app's `minSdk` is 31, Android 12. vivo X60 shipped with Android 11/Funtouch OS 11.1 and has an official Android 12 update. Check the phone's version first. Below 12, installation is impossible until the user upgrades. Stop and inform the user.
- **Layout is the narrow phone version**: the wide layout with sidebar and right Changes panel requires at least 900dp width and landscape orientation (`BoxWithConstraints` in `apps/android/app/src/main/java/org/codetether/app/ui/TabletApp.kt`). X60 landscape width likely remains below 900dp. Check with `adb shell wm size` and `wm density`. This round verifies functionality, connection, and physical-device behavior. The report must state "Tablet wide layout has not been verified on a physical device" (`07-tablet.md` §7 item 3).
- **Mac**: its installed application was updated to an `origin/main` build, is online, and has pairing. iPad acceptance also uses this Mac, and simultaneous pairing is supported. The user must generate the Mac pairing code and provide it.
- **Control-service allowed origins**: only browser cross-origin checks use them. Native apps omit `Origin`, so no allowlist change or server action is needed.
- **Network**: direct connectivity requires phone and Mac on the same LAN. Automatic uses Relay otherwise.
- **APK**: `D:/Projects/Software/agenthub-t1a-tablet/apps/android/app/build/outputs/apk/debug/app-debug.apk` is built from `b668e53`, 37,688,888 bytes, SHA-256 `3099dbffd9cac0b154bdab908a68703cfd8547e53e88b869850738eb455838c1`. Reuse it or rebuild, verifying the corresponding commit either way.
- **vivo installation restrictions**: developer options may separately require permission for USB installation or unknown apps. Investigate this if installation fails.
- **Expected issues**:
  - An oversized history record may produce server `internal`. The app retries with half the page size. Record continued failure as a backend gap.
  - After pairing, `readClaim` may return only a session view without an authorization object. Wait for usable control authorization in the directory.

## Boundaries

- **Decide independently**: installation/connection methods, timing and Keystore inspection, environment issues including adb drivers and port forwarding, temporary files under `D:/Projects/Software/agenthub-archive`, diagnosis and retries. Record acceptance issues and continue other items.
- **Ask the user first**:
  - Personal actions: USB-debugging permission, installation confirmation, OS upgrade, email code, generating a Mac pairing code, removing the device on Mac, or disconnecting Mac networking.
  - Repository changes needed to continue.
  - Production control-service, Relay, or server configuration, including over SSH.
  - Clearing other phone apps' data or uninstalling them.
- **Do not**:
  - Read/print credentials from `.secrets/`, other `.env` files, `~/.codex/auth.json`, or `~/.claude.json`. Preserve error lines beginning `[codetether:` when sanitizing logs.
  - Touch the production Mac `com.codetether.node` service or data directory.
  - Commit, push, or tag.

Use only user-prepared test targets for writes.

## Report

Append "Physical-device acceptance (vivo X60)" to `D:/Projects/Software/agenthub-archive/t1a-report.md`:

- Phone OS version, screen dimensions/density, actual Keystore level, tested commit, and APK SHA-256.
- Installation issues and solutions.
- Results for checklist items 1–8.
- Removal timing and measurement method.
- Real line-by-line diff and incremental-text results.
- Portrait, landscape, and dark screenshots, capturing only the phone screen.
- Unfinished work and reasons, explicitly stating "Tablet wide layout has not been verified on a physical device".

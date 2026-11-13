# Task: T1a Android Tablet Physical-Device Acceptance

Run on Windows, where the T1a toolchain and `adb` are installed. This round is acceptance testing only. Do not change repository code or commit.

References: `docs/ux-redesign/07-tablet.md`, tablet prototype `docs/ux-redesign/tablet/` (39 screenshots in `docs/ux-redesign/tablet/png/`, named by prototype page number), and `docs/reviews/t1a-device-acceptance-prompt.md`, all on `origin/ux/design`, read with `git show`. Prior results are in `D:/Projects/Software/agenthub-archive/t1a-report.md`, under "Physical-device acceptance (vivo X60)" and its "fd1d905 retest" subsection.

Before starting, confirm this file has 4 second-level headings and the final section is "Report".

## Goals

Verify T1a on a physical Android tablet against the installed Windows app (`git-fd1d90540450`). vivo X60 already verified phone connection, reads/writes, real diffs, incremental text, revocation, and re-pairing. Focus on tablet-only coverage and a core-flow regression.

Record each item as Passed, or Failed with symptoms and errors:

1. **Installation and device information**: install and launch to login. Record model, Android version, screen dimensions/density, landscape and portrait width in dp, and actual Keystore level (StrongBox, TEE, or software).
2. **Wide layout**: landscape shows the sidebar, main content, and right Changes panel. Compare page by page with prototype `02-01` Home, conversation pages from `02-03`, `02-0x` Changes, devices/projects from `03-01`, and settings from `04-01`. Capture each page and describe layout, spacing, color, wording, missing, or extra-element differences without changing code.
3. **Wide/narrow transitions**: rotate both ways and change width through split screen or multi-window. Preserve edited drafts, open conversation, selected change, and pending sends.
4. **Rotation while confirmation is pending**: rotate after Send or Create while its result is pending. The pending state remains, with one submission only. This state was not captured on the phone. Reproduce it using a slower peer response or a network interruption.
5. **Mark reviewed**: act on one completed-review Inbox item under direct and Relay connections. The phone run could not identify a unique card among similar items. Create a uniquely titled test item first.
6. **External keyboard**: ask whether the user has a Bluetooth keyboard or keyboard case. If available, test Ctrl+N, Ctrl+K, Ctrl+Enter, and Esc. Otherwise record Not tested.
7. **Core regression**: perform representative direct and Relay cases without repeating every phone detail. Cover recent conversations, history/live updates, reply, approve or reject, stop, archive, line-by-line Changes, search, devices, and projects.
8. **Removal and re-pairing**: remove the tablet on Windows, verify its Removed page, pair with a fresh code, verify connection, then remove it again to leave no test authorization.

## Known Facts

- **Wide-layout condition**: at least 900dp width and landscape (`apps/android/app/src/main/java/org/codetether/app/ui/TabletApp.kt:165`). Calculate landscape width first with `adb shell wm size` and `wm density`. If below 900dp, stop and inform the user.
- **OS version**: `minSdk` is 31 (Android 12). Stop and inform the user if the OS is older.
- **APK**: reuse the `b668e53` acceptance build, SHA-256 `3099dbffd9cac0b154bdab908a68703cfd8547e53e88b869850738eb455838c1`, from the same source as vivo acceptance. Rebuilding is allowed with commit verification.
- **Known issues to record without blocking acceptance**:
  - **Creating through Relay**: vivo retesting stayed at "Result awaiting confirmation". After retry, Windows had no corresponding conversation. Another task is investigating. Attempt once, record time and wording, then skip. Direct creation works.
  - Long individual diffs and imported native conversations are truncated after the B1 fix without a separate truncation indicator. Native history on a computer accessed through Node reads one record per request. Record observations.
- **Test target**: use only the isolated Windows project `T1a vivo X60 acceptance` (`D:/Projects/Software/agenthub-archive/t1a-vivo-x60-scratch-20261106-e2945b18`) for writes. Reuse it or create an adjacent tablet-specific project.
- **Reusable vivo procedures**: installation, ADB observation, screenshot, timing, and cleanup scripts are in `D:/Projects/Software/agenthub-archive/t1a-logs/vivo-x60/`.
- **Origins**: native apps omit `Origin`. No allowlist change is required.

## Boundaries

- **Decide independently**: installation, observation, screenshots, synthetic test data, environment diagnosis, and retries. Record issues and continue other cases.
- **Ask the user first**:
  - Personal actions: tablet USB-debugging/installation permission, email code, Windows pairing-code generation, Windows device removal, or keyboard connection.
  - Repository changes.
  - Production-service configuration changes.
  - Clearing other tablet apps' data or uninstalling them.
- **Do not**:
  - Read or print credentials.
  - Touch installed Windows app data, remote machines, or Node.
  - Commit, push, or tag.

## Report

Append "Physical-device acceptance (Android tablet)" to `D:/Projects/Software/agenthub-archive/t1a-report.md`:

- Tablet model, OS, dimensions/density, landscape/portrait width, Keystore level, and APK SHA-256.
- Results for items 1–8.
- Page-by-page wide-layout comparison with prototype, including screenshots and differences identified by page number.
- Relay-creation observations.
- Unfinished work and reasons.

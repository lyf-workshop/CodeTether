# Review Record: v0.1.0-alpha.3 Release (Round 2)

**Task:** `docs/reviews/release-alpha3-prompt-r2.md`. **Report:** `D:/Projects/Software/agenthub-archive/release-v0.1.0-alpha.3-r2-report.md`. **Reviewed:** 2026-11-15.

**Result:**

- `origin/main` = `0bf8cba`.
- The annotated tag `v0.1.0-alpha.3` (`5038c39`) points to the same commit.
- The release branch was merge `fe82249` plus `0bf8cba`, with no rewritten history.
- Completion level: released.
- **Required follow-up:** one, the update source (below).

## Checked, no problem

- **Merge `fe82249`.**
  - Conflicts were only in `apps/android/.../remote/RemoteModels.kt` and `RemoteSupervisor.kt`, both in the expected area.
  - The resolution keeps `main`'s specific failure `reason` messages and its Host-side `active`/`archived` filter, and the fix branch's `definitiveMutationFailure`.
  - The project directory now asks for `archived: "all"`. The Supervisor protocol accepts that value (`packages/supervisor-transport/src/protocol.ts:560`, `packages/supervisor-mobile/src/wire.rs:941`). The default is `active`, so without it the tablet would have miscounted archived conversations.
  - Not blocking: the resolved `projectConversations` drops the client-side `archived` check that `main` kept, and relies on the Host's filter, which every alpha.3 Host applies.
- **Version.** Android is now `0.1.0-alpha.3`, `versionCode` 2. The changelog is plain Chinese with no stage codes.
- **Gates.**
  - All passed.
  - `cargo test` in `apps/desktop/src-tauri` first needed the Host sidecar to be built.
  - It also failed once when D: ran out of space (0.24 GB free).
  - No code changed to pass a check.
- **Windows install.**
  - Build ID went from `git-fd1d90540450` to `git-0bf8cbae7101`.
  - The data was backed up with checksums, and the database was unchanged by the install.
  - Health checks passed after 60 seconds, and the Owner confirmed the window.
- **Android APK.** Built from the tag with the public client configuration; SHA-256 `1645aa1f…79c9`. Not installed on any device.
- **Cleanup.**
  - 10 local branches and 9 worktree registrations were removed.
  - 21 merged remote branches were deleted after the Owner approved the list.
  - Protected branches were kept.
  - Three folders were left behind: the partial checkout `D:/Projects/Software/agenthub-t1a-tablet` (5.7 GB, no `.git`), and two empty folders that a process held open. They are safe to delete.

## Required follow-up

1. **Built without the update source.**
   - The Windows build, and the Mac build if it had followed the handoff, lack `CODETETHER_UPDATE_BASE_URL` and `CODETETHER_UPDATE_PUBKEY`. So alpha.3 reports "automatic updates are not configured" and cannot update itself to alpha.4. That breaks the plan in 05 §6.
   - The agent followed its instructions. The release prompt framed U1 only as "upload update files or skip". Claude Code's question to the Owner said the updater would start working from alpha.4. Neither said that alpha.3 itself must carry the two public settings.
   - **Remedy:** `docs/reviews/release-alpha3-update-source-prompt.md` rebuilds the same tag with both settings, after the Owner generates the key pair.

## Notes for the next release prompt

- Under "Installed builds", list `CODETETHER_UPDATE_BASE_URL` and `CODETETHER_UPDATE_PUBKEY` as required build inputs for every desktop build, separate from producing and uploading update files.
- The alpha.4 changelog should correct alpha.3's line that the installer has no update source.
- Check free space on D: before the gates. Release builds can use the E: build directory.

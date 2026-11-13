# Task: Release v0.1.0-alpha.3 (Round 2)

**Where it runs.** On Windows.

**Why round 2.** Round 1 (`release-alpha3-prompt.md`) was never run, and its starting point is gone. Since then `main` moved from `e4bdd57` to `4801ef1`, gaining B4a, D2.1 and U1. The two Android fix branches can no longer be fast-forwarded. The iPad app (`i1/ipad-app`) is no longer part of this release: its r4 round has a must-fix (`docs/reviews/i1-ipad-app.md`), and it merges separately once it is accepted.

**Branch and worktree.** Work on branch `release/v0.1.0-alpha.3`, in worktree `D:/Projects/Software/agenthub-work/release-v0.1.0-alpha.3`.

**References** (read with `git show origin/ux/design:<path>`):

- `docs/DEVELOPMENT-PROCESS.md` §3 and §7
- `docs/reviews/2026-11-13-assessment-and-plan.md` §3
- `docs/reviews/windows-install-update-prompt.md`
- `docs/reviews/mac-install-update-prompt.md`
- `docs/ux-redesign/05-desktop-update.md` (U1 publishing layout)

Before starting, confirm this file has 4 second-level headings and that the last one is "Report".

## Goals

Two Android fix branches go into this release:

| Branch                               | Tip       | State                                                                                                                         |
| ------------------------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `fix/android-retry-explicit-failure` | `aeac893` | Reviewed with no must-fix (`docs/reviews/fix-android-retry-explicit-failure.md`)                                              |
| `fix/t1a-tablet-fidelity`            | `945c849` | Contains `aeac893`. All rounds reviewed with no must-fix; items 4–9 on 2026-11-13 (`docs/reviews/fix-t1a-tablet-fidelity.md`) |

Both are pushed and behind `main`.

**Two preconditions.** Confirm both with the Owner at the start. If either is missing, stop and ask.

- The Owner has re-checked `fix/t1a-tablet-fidelity` items 1–9 on a device and accepts it.
- U1, B4a and D2.1, which reached `main` on 2026-11-09, count as accepted.

Release `v0.1.0-alpha.3` from the current `main` plus those two branches. Do not merge `i1/ipad-app`.

**Must:**

1. **Release branch.**
   - Create the branch from the current `origin/main`. Fetch first and use the commit you actually find.
   - Merge `fix/t1a-tablet-fidelity` with a merge commit. It contains `aeac893`. Do not rebase pushed branches.
   - Resolve conflicts yourself only in the expected areas:
     - the Android Supervisor layer and UI, where B4a also added tablet organization operations
     - documentation
   - Explain every resolution in the report.
2. **Version and changelog.**
   - Root `package.json` and `apps/desktop/src-tauri/Cargo.toml` already say `0.1.0-alpha.3`.
   - The Android `versionName` is still `0.1.0-alpha.0` and `versionCode` is `1`. Bring Android in line with the release version, and raise `versionCode` so an installed debug build upgrades in place.
   - Create `CHANGELOG.md` with a `v0.1.0-alpha.3` entry: user-visible changes since `v0.1.0-alpha.2`, in Simplified Chinese, with no internal stage codes. Examples:
     - one-click desktop update
     - the computer list grouped by computer
     - the larger input box with draft saving
     - a tablet that can organize projects and conversations and matches its design
     - Relay creation no longer getting stuck
     - send failures that state the reason
3. **Quality gate on the release branch:**
   - `pnpm typecheck`, `pnpm lint`, `pnpm build`, then `pnpm test`, in that order.
   - The Android Gradle gate: `testDebugUnitTest lint assembleDebug assembleDebugAndroidTest`.
   - `cargo test` in `packages/supervisor-mobile`.
   - `cargo test` in `apps/desktop/src-tauri`.
   - Then push the release branch.
4. **`main` and the tag.**
   - Once the gates pass and the Owner agrees, fast-forward `main` to the release branch and push it.
   - Create and push the annotated tag `v0.1.0-alpha.3`.
5. **Installed builds.**
   - **Windows:** replace the installed build with the tag's build, following `windows-install-update-prompt.md`.
   - **Mac:** have the Owner relay `mac-install-update-prompt.md`, with the tag as the target.
   - **Android:** build a debug APK from the tag and record its SHA-256. Ask before installing it on any device.

**Should:**

6. **U1 update files.** This is the first release that contains the updater.
   - Build the signed update artifacts and `latest.json` exactly as 05 describes.
   - Upload them to `https://codetether.org/updates/alpha/` only after the Owner approves. That server also hosts the website.
   - If the Owner holds the signing key and does not want to provide it now, skip this step and say so.
7. **Clean up.** After `main` is pushed:
   - List every branch whose commits are all in `main`, both local and remote.
   - List every worktree under `D:/Projects/Software/` that sits on a merged branch or on a detached merged commit.
   - Delete local branches and worktrees that belong to merged work. Leave any worktree that has uncommitted changes and report it.
   - Delete remote branches only after the Owner confirms the list.
   - Never delete `ux/design`, `docs/english`, `i1/ipad-app`, `feat/d2-*`, `spike/*`, `archive/*` or `phase8d/*` branches in this task.

## Known facts

- **Installed builds.** Both computers run `fd1d905`.
  - `main` adds no SQLite migration after `fd1d905`; the latest is version 25, and neither branch adds one. Rolling back to `fd1d905` is therefore possible. Verify this on the release branch.
  - Back up the data directory before installing anyway, as the install prompts require.
- **Builds without the updater.** Builds installed before U1, including `fd1d905`, cannot update themselves. This release is installed manually on both computers. After that, U1 can deliver `alpha.4`.
- **Tests on a fresh worktree.** `pnpm test` fails with `ERR_MODULE_NOT_FOUND` for `@codetether/agent-core/dist/index.js` unless `pnpm build` ran first. `agent-core` has no `test` script, so `pnpm -r test` never builds it. The hygiene task fixes this; here, just build first.
- **Flaky Relay test.** The fingerprint rate-limit test in `apps/relay/test/relay-service.test.mjs` was stabilized on `main` (`7616956`). If it still fails intermittently, rerun it and note it in the report.
- **Production Relay.** It runs `e4bdd57`, and this release does not redeploy it. If the merge changes `apps/relay`, say so; do not deploy.
- **Pitfalls from earlier installs.** See `D:/Projects/Software/agenthub-archive/windows-install-fd1d905-report.md` and, on the Mac, `~/agenthub-archive/mac-install-b1-report.md`.
- **Docs.** `ux/design` is the source for `docs/`. Do not merge it here and do not edit `docs/` or `AGENTS.md` on the release branch.

## Boundaries

- **Decide yourself:**
  - merges and conflict resolution in the expected areas
  - the Android version fields
  - CHANGELOG wording
  - how to build and install
  - how to diagnose and retry build problems
- **Ask the Owner first:**
  - pushing `main`; creating or pushing the tag
  - uploading update files to `codetether.org`
  - conflicts outside the expected areas, or code changes needed to pass a check
  - deleting remote branches
  - installing on the tablet or phone
- **Do not:**
  - force-push, rebase pushed branches, or rewrite history
  - read or print credentials, including the update-signing private key and its password
  - deploy the Relay or the Control Plane

## Report

Write to `D:/Projects/Software/agenthub-archive/release-v0.1.0-alpha.3-r2-report.md`:

- **Release branch:** its commits, the conflicts you hit and how you resolved each.
- **Version and changelog:** the Android version change, and the full `CHANGELOG.md` entry.
- **Gate results:** for each check, with any failures pasted verbatim.
- **After pushing:** the remote commits for `main` and the tag.
- **Windows install:** the build id before and after.
- **Android:** the APK's SHA-256.
- **U1 update files:** uploaded or skipped, and why.
- **Cleanup:** the branches and worktrees deleted, and those kept, with reasons.
- **Status:** anything left undone and why, and which completion level the work reached.

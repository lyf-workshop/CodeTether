# Task: release v0.1.0-alpha.3

Run mainly on Windows. Mac handles iOS builds/tests (goal 3). Reference: sections 3 and 7 of `docs/DEVELOPMENT-PROCESS.md` (read with `git show` from `origin/ux/design`).

Before starting, confirm that this file has four second-level headings and that the final section is "Report".

## Goals

The user has accepted the physical-device tests. Merge this round's fixes and iPad app into `main`, tag `v0.1.0-alpha.3`, and update both installed desktop builds to that tag.

Branches to include (all reviewed):

- A linear chain: `main` is already at `e4bdd57` (including `fd1d905` Supervisor frame budgets and `e4bdd57` Relay ack race). Fast-forward through `fix/android-retry-explicit-failure` (`aeac893`) to `fix/t1a-tablet-fidelity`. Each builds on its predecessor. Run `git fetch` first and use the actual `main` commit as the authority.
- `i1/ipad-app` diverged from older `f290602`; `main` contains three Android commits absent there. It is already pushed, so merge with a merge commit instead of rebasing. It changes `packages/supervisor-mobile`, the Rust core also used by Android.

Required outcomes:

1. **Release branch**: create `release/v0.1.0-alpha.3` from latest `fix/t1a-tablet-fidelity`, then merge `i1/ipad-app` with a merge commit. Resolve conflicts independently only in expected shared Rust-core and documentation areas, explaining resolutions in the report.
2. **Version and changelog**:
   - Root `package.json` still says `0.1.0-alpha.0` despite tags `v0.1.0-alpha.1` and `v0.1.0-alpha.2`. Investigate how those releases handled versions and follow the same approach; ask the user if unclear.
   - Create `CHANGELOG.md` for `v0.1.0-alpha.3` in Chinese, describing user-visible changes (tablet/iPad reading and controlling computers, Relay creation no longer stuck, tablet UI aligned with design, etc.) without internal codenames.
3. **Quality checks**: run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; Android Gradle `testDebugUnitTest lint assembleDebug assembleDebugAndroidTest`; and `cargo test` in `packages/supervisor-mobile`. Push the release branch, then ask the user to relay to Mac that iOS unit tests/build must run at the same commit (`apps/ios/Scripts/test.sh`, `build.sh device`).
4. **Main and tag**: after Mac iOS checks pass and the user agrees, fast-forward `main` to the release branch and push it. Create/push annotated `v0.1.0-alpha.3`.
5. **Installed builds**:
   - Windows: follow `docs/reviews/windows-install-update-prompt.md`, targeting the tag's commit with all other requirements intact.
   - Mac: have the user relay the update procedure from `docs/reviews/mac-install-update-prompt.md`, targeting the tag.
   - Android: build a debug APK from the tag and record SHA-256. Ask before installing on the tablet.
6. **Remove merged branches/worktrees**: after `main` pushes successfully, remove merged fix branches and worktrees per process. List remote branches for user confirmation before deleting them.

## Known facts

- Build/install pitfalls are in `D:/Projects/Software/agenthub-archive/windows-install-fd1d905-report.md` for Windows and `~/agenthub-archive/mac-install-b1-report.md` for Mac.
- Both computers currently run `fd1d905`. Updating to the tag can be rolled back if merging introduces no migration. Check for new migrations first and report any, with backups per install prompts.
- Full `pnpm test` intermittently fails Relay fingerprint rate limiting (`apps/relay/test/relay-service.test.mjs:1164`), passing alone. Rerun and record if encountered.
- Production Relay already runs `e4bdd57`, so this release needs no redeployment. Report any new `apps/relay` changes after merge without deploying independently.
- `ux/design` is authoritative for `docs/`; design maintains ROADMAP. Do not merge `ux/design` in this release.

## Boundaries

- **Decide independently**: expected-area merges/conflicts, version handling following past releases, CHANGELOG wording, build/install approach.
- **Ask the user first**:
  - Pushing `main`, creating/pushing tags;
  - Conflicts outside expected areas or code changes required for checks;
  - Unclear version handling;
  - Remote branch deletion;
  - Installing new builds on tablet or iPad.
- **Do not**: force-push, rebase pushed branches, rewrite history; read/print credentials; deploy Relay or the control service.

## Report

Write `D:/Projects/Software/agenthub-archive/release-v0.1.0-alpha.3-report.md`.

- Release commit, merge conflicts, and resolutions;
- Version approach and evidence; CHANGELOG contents;
- Quality-check results with failures verbatim; Mac iOS results relayed by user;
- Remote commits after main/tag pushes;
- Installed Windows build IDs before/after; Android APK SHA-256;
- Removed branches/worktrees;
- Incomplete work and reasons.

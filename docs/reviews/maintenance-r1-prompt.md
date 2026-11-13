# Task. Maintenance (find pnpm in build scripts and retain installed-build diagnostics)

Run on Windows. This round changes code. Create `chore/maintenance-r1` from `origin/main`, with the worktree at `D:/Projects/Software/agenthub-work/chore-maintenance-r1`. References are suggestion 1 in `docs/reviews/fix-relay-create-uncertain.md` and `docs/DEVELOPMENT-PROCESS.md` (read from `origin/ux/design` with `git show`).

Before starting, confirm this file has four second-level headings and the last section is "Report".

## Goals

Three independent small tasks, each in one or more commits.

1. **Build scripts find pnpm themselves.**
   - `runPnpm` in `apps/desktop/scripts/build-sidecar.mjs` and `apps/node/scripts/build-node.mjs` (around :130) hardcode `$PNPM_HOME/node_modules/pnpm/bin/pnpm.mjs`, defaulting to the Node executable directory if `PNPM_HOME` is unset. This Windows layout makes `pnpm desktop:build` fail on macOS and Linux when following the `README`. It already failed twice on Mac.
   - When pnpm starts a script (such as `pnpm desktop:build`), locate that same pnpm through information it passes to child processes, such as `npm_execpath`. When invoked directly with `node`, fall back to current rules. If neither succeeds, explain the remedy instead of showing only `MODULE_NOT_FOUND`.
   - Fix equivalent patterns in other build scripts, including `apps/relay/scripts/build-relay.mjs` and `apps/distribution/src/*.mjs`.
   - Test entry resolution for pnpm invocation, `PNPM_HOME`, and neither available, without performing real builds.
2. **Retain Supervisor diagnostics in installed builds.**
   - Since `fd1d905`, Supervisor records per-request diagnostics (`supervisor.read` on success, `supervisor.read.failed` on failure, `supervisor.read.frame_too_large` on oversize), with operation, transport, error code, exception class, bytes, and duration. These could not be found afterward in the installed Windows build, preventing attribution of the vivo failure.
   - First determine where they go today (Host stderr, desktop collection, and files).
   - The installed Host must write these diagnostics to a bounded local rotating log in the data directory (for example, a few MiB total), with timestamps and allowlisted fields only. Preserve development behavior.
   - Reuse existing logging where possible.
   - Exclude request/response contents, paths, conversation titles, tokens, and device identities.
   - Add the log location to local-data documentation in `docs/DEVELOPMENT.md`.
   - Test rotation, size bounds, and exclusion of non-allowlisted fields.
3. **Log Relay channel-close reasons.**
   - Production Relay sends errors such as `flow_control_violation` to both channel endpoints when closing, but does not log them. This prevented attribution of vivo Relay creation failure (`D:/Projects/Software/agenthub-archive/relay-deploy-e4bdd57-report.md`).
   - In `apps/relay`, log each channel close or failure with event name, reason code, channel roles, lifetime, forwarded chunk count, and byte count. Exclude content, device/Host identifiers (use opaque numbers only), and paths.
   - Follow existing Relay logging and rate-limit against client log flooding.
   - Test multiple close reasons and verify content exclusion.
   - This server change takes effect on the next deployment. **Do not deploy Relay yourself.** Deployment will have a separate prompt.

## Known facts

- Item 1 changes pnpm discovery only, not artifacts. Run `pnpm desktop:sidecar` once on Windows afterward to check regressions.
- Item 2 data directories are `%LOCALAPPDATA%\CodeTether` on Windows and `~/Library/Application Support/CodeTether` on macOS (`docs/DEVELOPMENT.md`).
- Quality checks are `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`. Full `pnpm test` sometimes fails the Relay fingerprint rate-limit case (`apps/relay/test/relay-service.test.mjs:1164`) although isolated execution passes. Rerun and record if encountered.

## Boundaries

- **Decide independently.** Implementation, log filenames, rotation sizes/counts, tests, and commit breakdown.
- **Ask the user first.** Changes to Protocol v1 or database persistence, replacement of installed production builds, or production configuration changes.
- **Do not do.** Read or print credentials, push `main`, merge, tag, or force-push.

Push the branch to `origin` without merging.

## Report

Write to `D:/Projects/Software/agenthub-archive/maintenance-r1-report.md`.

- Item 1 scripts changed, three resolution-test outcomes, and actual `pnpm desktop:sidecar` result.
- Item 2 previous and new diagnostic destinations, rotation rules, and a redacted sample.
- Item 3 close reasons recorded, redacted sample, and rate limits.
- Change commits and remote commit after pushing.
- Quality results, including failures verbatim.
- Remaining work, reasons, and completion level.

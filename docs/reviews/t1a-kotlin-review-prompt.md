# Task. Review Kotlin code in the T1a Android tablet app

Run on this Windows computer. Review only, without code changes.

Review `apps/android` at pushed `f290602` on `t1a/tablet-app` (base `origin/main` `9694895`). Rust connection core `packages/supervisor-mobile` was reviewed separately. Treat its UniFFI interface as a black box and assess Kotlin usage only.

Before starting, confirm this file has four second-level headings and the last section is "Report".

## Goals

Find issues causing incorrect results, data loss, credential leakage, or stuck UI, ranked by severity. Focus on these areas and report other findings too.

1. **Credentials.** Check logs, exception messages, `toString`, and UI for login tokens, OTPs, pairing codes, and private keys. Confirm BuildConfig from `app/build.gradle.kts` contains public values only (control-service/Supabase addresses, publishable key, Relay address/ID/fingerprint) and native-build environment allowlists exclude credentials. Verify backups and cleartext networking are disabled, and Manifest has no unnecessary exports/deep links. Locate the report's test-only "debug input window" that injects OTPs/pairing codes and verify production excludes it.
2. **Device keys.** Nonexportable P-256, StrongBox → TEE → software fallback, and mandatory production rejection of software keys (around `AndroidDeviceIdentity.kt:65`). Examine key loss after reinstall, data clearing, or lock-screen changes.
3. **Login.** Existing accounts only, encrypted persistence, and cleanup on refresh failure/sign-out.
4. **Pairing.** Six-digit-code errors, bounded wait for control authorization after pairing, and cancellation.
5. **Removal vs unreachability.** Apply both B1 supplementary-test rules in "Known facts". Ordinary network loss must not look like removal, and real removal must not remain unreachable forever.
6. **Concurrency/lifecycle.** Coroutine scope/cancellation, backgrounding, rotation, process restoration. Check overlap in foreground polling (750 ms conversations, 5 s directory), connection reuse, and approximate per-minute Relay/computer connections and requests.
7. **UniFFI boundary.** Synchronous calls off the main thread, disposal of native objects such as `SupervisorSession`, and Rust receipt of `DeviceSigner` callback failures.
8. **Mutations.** One actionId per user action, no automatic resends, duplicate taps, uncertainty UI, and explanatory running-archive conflict text instead of raw 409/error codes.
9. **Capability gates.** Approval, stop, and line diffs must follow returned capabilities rather than hardcoded tool names.
10. **Copy.** Host, Node, Machine, ProductDevice, Supervisor, Relay, authorization, grant, and fingerprint may appear only under Settings › Connection check. Unimplemented features appear only in Settings › Roadmap.
11. **Design comparison.** Sidebar, pages, Ctrl N / K / Enter and Esc, and narrow layout. Report obvious mismatches only. The user decides visual details.
12. **Tests.** Identify covered failure paths and missing critical cases.

## Known facts

- **Worktree.** Another agent is active in `D:/Projects/Software/agenthub-t1a-tablet` with uncommitted changes. Do not touch or review those changes. Use `git show f290602:<path>`, or create a detached worktree from `f290602` (for example `D:/Projects/Software/agenthub-t1a-review`) and remove it after review.
- **References** (read-only on the ux/design branch in `D:/Projects/Software/agenthub`).
  - Task `docs/reviews/t1a-tablet-app-prompt.md`.
  - Design `docs/ux-redesign/07-tablet.md`.
  - Pairing, renewal, removal `docs/ux-redesign/06-pairing-remote-control.md`.
  - Copy rules `docs/ux-redesign/03-project-plan.md` §§1 and 1.1, invariants §6.
- **Coding agent report.** `D:/Projects/Software/agenthub-archive/t1a-report.md`. Verify claims against code instead of accepting them uncritically.
- **Two B1 supplementary-test findings** (`D:/Projects/Software/agenthub-archive/b1-fix-report-r1.md`).
  - Just after renewal, reconnecting with old authorization returns `authorization_revoked`. Reread the directory and retry with latest authorization before treating it as removal.
  - Connecting after removal yields `request_failed`, indistinguishable from ordinary unreachability. Show Removed only when the control service confirms no valid authorization. Otherwise show "This computer cannot currently be reached…".
- **Original TypeScript implementation** (line numbers at `f290602`).
  - Device registration `apps/web/src/runtime/account/control-plane-client.ts:415`, `:432`, directory `:662`.
  - Pairing `apps/web/src/runtime/account/pairing-client.ts:334`.
  - Device self-unpair `apps/control-plane/src/server.ts:1336`.
  - Capabilities `apps/web/src/dev/supervisor-operation-client.ts:233-266`.
  - Operation/result schemas `packages/supervisor-transport/src/protocol.ts`.
- Do not repeat known backend gaps. Single history records/events over 16 KiB cannot be sent, and project availability is inferred from device state.

## Notes

- Read-only. No code changes, commits, or pushes.
- Do not read `.secrets/`, `.env`, keys, or credentials, or print environment variables. Do not read `agenthub-archive/t1a-logs/`, whose logs previously contained credentials.
- Do not access production online, run an emulator (the T1a agent may use it), or run Gradle tasks triggering Rust native builds. Code reading suffices.
- Check callers and related code before confirming an issue. Timeouts, locks, and mappings often live elsewhere.

## Report

Write `D:/Projects/Software/agenthub-archive/t1a-kotlin-review.md` in Chinese, approximately 1,500 Chinese characters or fewer.

- Rank findings as Required / Recommended / Notes. For each include the following.
  - File and line at `f290602`.
  - Concrete failing input/state and user-visible result.
  - Confirmed or suspected status.
  - One or two sentences suggesting a fix.
- One line each for important checks confirmed clean.
- End with unreviewed areas.

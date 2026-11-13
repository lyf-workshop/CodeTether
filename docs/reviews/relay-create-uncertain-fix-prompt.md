# Task: Relay conversation creation stuck at "Outcome unconfirmed"

Run on Windows. This round changes code. Branch `fix/relay-create-uncertain` from `fd1d905` (`origin/fix/b1-supervisor-internal`, also the installed commit on both computers), worktree `D:/Projects/Software/agenthub-work/fix-relay-create-uncertain`. References: "fd1d905 retest" in `D:/Projects/Software/agenthub-archive/t1a-report.md`, and `docs/DEVELOPMENT-PROCESS.md` (read from `origin/ux/design` with `git show`).

Before starting, confirm that this file has four second-level headings and that the final section is "Report".

## Goals

Symptom: vivo X60 creates a conversation through Relay in the test project and displays "Outcome unconfirmed". Clicking Retry once with the original actionId still creates no corresponding Windows conversation. Direct creation on the same phone works, as do Relay reply, stop, approve, and archive.

Required outcomes:

1. **Establish the root cause**: first determine whether Host received the request, then what happened. Reproduce with the repository's Supervisor test client or development diagnostics page, without using the phone.
2. **Fix the root cause**, preserving frame shape, protocol version, and frame limits.
3. **Allow recovery**: uncertain creation must resolve to a conversation after retry or an explicit failure reason, rather than remaining stuck indefinitely.
4. **Regression tests** covering this root cause.
5. **Validation**: create several conversations with the test client over direct and Relay connections. Each attempt adds exactly one Host conversation and sends the first message once.

Push the branch afterward without merging. Phone and tablet retesting is outside this round; tell the user when finished.

## Known facts

- **Host diagnostics**: since `fd1d905`, every Supervisor request records `supervisor.read` on success or `supervisor.read.failed` on failure, with operation, transport, error code, and exception class. Windows ran `fd1d905` during retest. First find that creation's Host log record (time in the retest report), then choose the next investigation.
- **Unconfirmed hypotheses**:
  - **The request never reached Host**: a Relay frame may have been lost, or the phone failed before sending and misclassified it as uncertain.
  - **Host failed before creation but returned `internal`**: clients treat `internal` as uncertain. Host's idempotency cache retains failures (`apps/host/src/api/action-idempotency-cache.ts`), so the same actionId repeatedly retrieves that failure and stays unconfirmed.
  - **Host cancels after client timeout**: Rust waits at most eight seconds for `conversation.create` (`MESSAGE_TIMEOUT` in `packages/supervisor-mobile/src/wire.rs`; its `wait_ms` is 0). Creating the conversation, launching the AI tool, and sending the first message can exceed this through Relay. If a timeout disconnects the phone and creation is tied to connection/request cancellation, Host may cancel it.
  - **The write response exceeds the frame limit**: `fd1d905` skips writes in pre-send budget checks (recommended item 1 in `docs/reviews/fix-b1-supervisor-internal.md`). This is lower priority because a conversation should already exist on Host, unlike the observed symptom.
- **`action.get` cannot look up creates**: it queries send actionIds only (`getTurnForStartAction` in `apps/host/src/api/supervisor-transport-manager.ts`). Creation actionIds always return `not_found`, leaving resubmission with the same actionId as the only option. B3 plans this improvement (`docs/ux-redesign/08-remote-management.md` section 5). Include create lookup if the fix requires it, and explain in the report.
- **Client classification**: Android `uncertainErrors` in `apps/android/app/src/main/java/org/codetether/app/remote/RemoteSupervisor.kt`; iPad `apps/ios/Sources/CodeTether/SupervisorClient.swift` on `origin/i1/ipad-app`. Ask the user first if the root cause requires client changes.
- **Reproduction environment**: perform write reproduction outside the installed Windows build. Prefer an isolated Host data directory and port plus an isolated Relay, as in the previous fix (`D:/Projects/Software/agenthub-archive/b1-supervisor-internal-report.md`). Tablet acceptance may be using the installed Windows build; leave 4317 free.
- **Quality checks**: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. Full `pnpm test` occasionally fails the Relay fingerprint-rate-limit case (`apps/relay/test/relay-service.test.mjs:1164`), which passes alone. Rerun if encountered and record it.

## Boundaries

- **Decide independently**: diagnostics, fix, tests, commit boundaries, and build-environment problems.
- **Ask the user first**:
  - Android, iOS, or Rust-core changes needed for the root cause;
  - Frame-shape/version/limit changes or a database migration;
  - User actions on phone, tablet, or Windows;
  - Changes to the installed Windows build;
  - Production service configuration changes;
  - Pushing `main` or tagging.
- **Do not**:
  - Read or print credentials; logs/reports must exclude tokens, keys, connection strings, and message content;
  - Force-push or rewrite pushed history.

## Report

Write `D:/Projects/Software/agenthub-archive/relay-create-uncertain-report.md`.

- Root cause and evidence, including the original creation's Host log and reproduction;
- Changed commits and remote commit after push;
- Quality-check results with failures verbatim;
- Direct/Relay creation results: Host conversation count and first-message turn count for each attempt;
- Incomplete work and reasons, and the level of completion reached.

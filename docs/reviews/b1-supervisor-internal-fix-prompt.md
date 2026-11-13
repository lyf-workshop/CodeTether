# Task. Fix B1 internal errors when Supervisor responses exceed the frame limit

Run on Windows. This round changes code. Create branch `fix/b1-supervisor-internal` from `main`, with the worktree at `D:/Projects/Software/agenthub-work/fix-b1-supervisor-internal`. References are the "Physical-device acceptance (vivo X60)" section of `D:/Projects/Software/agenthub-archive/t1a-report.md`, the iPad physical-device results in `~/agenthub-archive/i1-report.md` on the Mac (key points copied into "Known facts"), and `docs/DEVELOPMENT-PROCESS.md` (read from `origin/ux/design` with `git show`).

If work already began under the previous revision of this prompt, read this revision and continue with its updated goals and facts. Do not restart from scratch.

Before starting, confirm this file has four second-level headings and the last section is "Report".

## Goals

Symptom. Android (vivo X60 connected to Windows) and iPad (connected to Mac) both logged in and paired successfully, but reading computer contents returns Supervisor `internal` in both automatic and "Relay only" modes, preventing workspace loading. Previous emulator acceptance passed with synthetic single-machine data. This run uses real data.

The iPad investigation found one cause. Projected Supervisor `machine.get` on Mac is approximately 17,148 bytes, exceeding the actual 16,384-byte frame limit. The send failure becomes `internal`. Windows has three machines and real Codex projects, likely causing the same issue, but confirm independently.

Required outcomes follow.

1. **Confirm the root cause.** With real Windows Host data, use the repository's Supervisor test client or development diagnostic page (`#/dev/supervisor-check`) without a phone to identify every read returning `internal` and why. Investigate beyond `machine.get`.
2. **Fit every read response into a frame.** Every Supervisor read response sent to a device must fit in a 16 KiB frame. Large real data must not fail because of size. Cover at least `host.bootstrap`, `machine.list`, `machine.get`, `project.list`, `project.get`, `conversation.list`, `conversation.get`, `conversation.history`, `conversation.recent`, `attention.list`, and change reads.
3. **Make oversize responses diagnosable.** Before sending, the Host must detect responses that exceed the limit. Record an existing `onDiagnostic` event with operation, transport, and byte count, without content. For other failures, likewise record operation, transport, error code or exception class, and duration, excluding request or response contents, paths, and conversation titles.
4. **Regression tests.** Use sufficiently large data with multiple AI tools, installation locations, machines, and long titles and paths for every operation in item 2. Assert each response stays within the frame limit and preserves fields clients need.
5. **Verification.** Run every operation in item 2 against real Windows Host data through both direct and Relay test-client connections, all successfully.

Phone and iPad retests require updating installed Mac and Windows builds and are outside this round. Tell the user when finished.

## Known facts

- **The actual frame limit is 16 KiB.**
  - `packages/supervisor-transport/src/server.ts:9` uses `FramedMachineConnection` from `@codetether/machine-transport`, whose limit is `machineTransportLimits.maximumFrameBytes`, 16 KiB (`packages/machine-transport/src/constants.ts`).
  - `supervisorTransportLimits.maximumFrameBytes` says 256 KiB (`packages/supervisor-transport/src/constants.ts:12`), but that value is not the effective production limit.
  - The phone and tablet Rust core also reads 16 KiB frames (`packages/supervisor-mobile/src/wire.rs:13`, `:373`).
  - The installed Android and iPad applications use that core. **Do not raise the frame limit.** Reduce Host responses instead.
- **`machine.get` is unbounded.** `apps/host/src/api/supervisor-transport-manager.ts:273-287` forwards `machine`, `providers`, `providerLifecycles`, `connection`, `providerDiscovery`, and `relay` from local `getMachine` unchanged. In contrast, `conversation.recent` and `attention.list` use `boundedRows` (`apps/host/src/api/supervisor-operations.ts:20-97`, 12 KiB).
- **Send failures become `internal`.** Sending occurs inside `try`. On an oversized frame, `FramedMachineConnection` throws and `catch` (`server.ts:645-659`) classifies it as `internal` through `supervisorReadErrorCode` (`server.ts:803`), then sends a small failure frame that succeeds. The failure path has no diagnostic, leaving both Host logs and devices without the reason.
- **Consumers of these responses.**
  - Android `apps/android/app/src/main/java/org/codetether/app/remote/RemoteSupervisor.kt` (`machine.get` at :70, :193, :293).
  - iPad `apps/ios/Sources/CodeTether/SupervisorClient.swift` (on `origin/i1/ipad-app`, `machine.get` at :217, :579, :674).
  - Desktop remote computer reads through `apps/web/src/runtime/account/remote-supervisor.ts` use the same Supervisor transport and face the same limit.
  - Development diagnostic page `apps/web/src/dev/supervisor-check-model.ts`.
- **Response reduction rules.**
  - First identify the fields these clients actually consume from `machine.get` and other responses. Preserve consumed fields and their meaning. Unused fields may be omitted.
  - Bound arrays.
  - If still oversized, truncate in a deterministic order and expose truncation to clients. Adding fields inside `data` is compatible. Android uses `org.json`, and neither iOS nor the Rust core rejects extra `data` fields.
  - Apply the `boundedRows` approach to lists and supply a continuation cursor at truncation.
  - Choose the exact rules and document them for every operation.
- **Another known gap.** A single oversized history record or event also returns `internal` (the T1a report's "Backend gaps"). Item 2 includes `conversation.history`. If one record cannot fit, truncate its contents with an indicator instead of failing the entire page.
- **Other potential failures.** The Windows Host has three machines, and Node-connected remote devices may be offline. iPad also saw `computer_unavailable` from another computer, without a root cause. After confirming frame size as the main cause, check whether an unreachable machine can fail the whole page. Fix it if present, otherwise state its absence in the report.
- **Network layers already ruled out.** Phone TCP access to control service 443, Relay 8443, and Windows 4318 succeeds. Windows-to-Relay TLS 1.3 works. The Host holds a Relay connection that received `supervisor.ready(role=host)`. Local HTTP detail GETs succeed for all three machines.
- **Relationship to B4.** B4 design (`docs/ux-redesign/08-remote-management.md` §3.2) plans error reasons in failure `data.reason`. This round keeps production failure frames unchanged and adds only Host diagnostics. This round's frame rules govern §3.6. Document them in the report.
- **Frozen boundaries.** Preserve Protocol v1, persistence, frame shape, and Rust core `Response` structure (`deny_unknown_fields`). Do not change Android or iOS code.
- **Test data.** The installed Windows build is `git-b668e53f2c79`. The isolated test project is `D:/Projects/Software/agenthub-archive/t1a-vivo-x60-scratch-20261106-e2945b18`.
- **Quality checks.** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. The full `pnpm test` occasionally fails the Relay fingerprint rate-limit case (`apps/relay/test/relay-service.test.mjs:1164`) although isolated execution passes. Rerun if encountered and record it.

## Boundaries

- **Decide independently.** Diagnostic approach, response reduction rules and implementation, diagnostic fields, tests, commit breakdown, and build environment issues.
- **Ask the user first.**
  - Personal action on the phone, iPad, or Windows computer.
  - Changes to frame shape, protocol version, frame limit, Android, iOS, or Rust core code.
  - Removal of a field currently consumed by a client.
  - Replacement of the installed Windows production build with the fixed build. Prefer a data copy and isolated instance for real-data verification, preserving the production data directory.
  - Production service configuration changes.
  - Pushing `main` or tagging.
- **Do not do.**
  - Read or print credentials, or include tokens, keys, or connection strings in logs or reports.
  - Touch the installed production data directory or production Mac services.
  - Force-push or rewrite pushed history.

Push the branch to `origin` without merging into `main`. The user will decide after review.

## Report

Write to `D:/Projects/Software/agenthub-archive/b1-supervisor-internal-report.md`.

- Root cause and evidence, including oversized operations, real response byte counts, and other causes if any.
- Reduction rules per operation and the fields each client consumes.
- Change commits and the remote commit after pushing.
- Quality check results, with failures reproduced verbatim.
- Real-data test-client results separately for direct and Relay, including response bytes for every operation.
- Remaining work, reasons, and the current completion level.

# Review: `fix/w0f-runtime-diagnostics` (2026-11-19)

**Branch.** Pushed at `c85f06c`. It starts from `main` at `13fa6b8`.

- Task prompt: `w0f-runtime-diagnostics-prompt.md`.
- Report: `D:/Projects/Software/agenthub-archive/w0f-runtime-diagnostics-report.md`.
- `73ab206` adds the Host log. `c85f06c` adds the desktop log.
- 15 files, about 2,200 lines, half of them tests. No Protocol, web or Android change.

**Gates (as reported):**

- typecheck, lint, build and `pnpm test` passed, including 616 of 616 Host tests
- `cargo test` in `apps/desktop/src-tauri`: 90 unit tests and 3 integration tests; `cargo fmt --check` passed
- Prettier passed on the changed files
- An earlier full run failed one class-name test while edits overlapped; the report quotes it.
- The repository-wide `pnpm format:check` fails on 1,028 files in a Windows checkout. That is the line-ending baseline, not this branch (carried item 5).

**Verdict.** Accepted, no must-fix.

- It merges into `main` now and ships in alpha.5.
- The 2026-11-19 failure did not reproduce in 15 runs. The next occurrence will leave a record.

## Checked in this review

- **What the logs keep.**
  - `logs/host-diagnostics.jsonl` and `logs/desktop.jsonl` sit next to the database, beside `host-presence.jsonl`. Each is capped at 256 KiB × 8 files, with rotation and a per-minute limit on records.
  - A record holds:
    - fixed event names
    - the AI tool and computer kind
    - opaque Machine and Turn IDs
    - the canonical reason
    - allowlisted error class names and codes
    - exit code and signal
    - at most four causes
    - at most 20 stack frames
    - Zod issue codes with allowlisted paths
  - No Error message is stored.
- **Stack frames** (`projectStackFrame`).
  - A frame keeps a function name, a file base name, a line and a column.
  - It is kept only for CodeTether's own `apps/host` or `packages/*` sources, or for the packaged bundle `codetether-host.mjs`.
  - In the installed app, frames read `<bundle>` at a line and column of `codetether-host.mjs`. That file ships in the installer, so a position can be looked up in the installed copy.
- **Failure handling is unchanged.**
  - Every logging call in `host-service.ts` is wrapped so a failed write is ignored.
  - `#handleRuntimeFailure` records before its existing early return, so a failure that was ignored before still leaves a record.
  - When the failure came from handling a Provider event, the record names that event's type and item kind.
  - `uncaughtExceptionMonitor` only observes.
  - The new `unhandledRejection` handler exits with code 1, which matches Node's default crash for an unhandled rejection.
- **Host startup output.** The former catch in `serve.ts` printed `error.message`; it now prints a fixed `STARTUP_FAILURE` marker. The structured error goes to the Host log instead.
- **The desktop log.**
  - It records the Host's spawn, ready and exit, with the exit code, whether the exit was expected, and the elapsed time. It also records which dialog was shown.
  - It keeps Host output only from CodeTether's own prefixes, rebuilt from fixed strings and truncated.
  - If the Host exits before it is ready, it keeps the last 40 stderr lines, each filtered the same way.
- **The diagnostic build profile** (`build.rs`).
  - It is compile-time only: port 4320, an isolated data folder and an isolated WebView2 folder. It turns on only when `CODETETHER_W0F_HOST_PORT=4320` and `CODETETHER_W0F_DATA_DIR` are set at build time.
  - A normal build keeps 4317. The `--desktop-smoke-exit-after-ready` argument it used existed before this branch.
- **Tests re-run.** The nine Host diagnostics tests pass in the branch's worktree.
- **Merges.** `git merge-tree` into `main` is clean. W0e has not pushed yet; both edit `host-service.ts` in different places.

## Behavior changes to record

1. **Isolated Hosts no longer join the production Relay.** `serve.ts` now gives any Host started on a port other than 4317 a dynamic Supervisor listener and no production Relay registration. Before, only port 0 did. The installed app is unaffected, and an isolated Host is safer this way. ARCHITECTURE records it.
2. **Host startup errors** no longer print their message to stderr. They print a fixed marker and leave a structured record in the Host log.

## Carried items

1. **Not reproduced.** If "运行时执行失败" happens again, read `%LOCALAPPDATA%/CodeTether/logs/host-diagnostics.jsonl` for the `runtime.failure` record. It names the throw site, and the event type if a Provider event caused it.
2. **The alpha.5 release prompt:**
   - Before the signed build, assert that `CODETETHER_W0F_HOST_PORT` and `CODETETHER_W0F_DATA_DIR` are unset.
   - After the update, check that both logs appear in the installed app's `logs` folder.
   - Spot-check that they hold no paths, prompts or messages.
3. **One failure fails every Turn.** The report's analysis stands: confining a translation failure to one Turn needs exact event-to-Turn identity, proof that the stream is healthy, and a separate failure policy. Revisit only if the log shows translation failures recurring.
4. **The diagnostic build profile stays** for later isolated desktop checks. `DEVELOPMENT-PROCESS.md` could describe it when it is next edited.
5. **Line endings in a Windows checkout.** The repository-wide `pnpm format:check` cannot pass in a Windows checkout, so only changed files are checked. A `.gitattributes` rule (for example `* text=auto eol=lf`) would fix the baseline. Backlog.

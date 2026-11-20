# Task: W0f Runtime Failure Diagnostics (A Local Diagnostic Log, Then Find "运行时执行失败")

**Where it runs.** On Windows. The Owner develops only on Windows for now (AD-13).

- Never stop, replace or reconfigure the installed app or its Host on `127.0.0.1:4317`, and never open its live database.
- Run any development build with its own Host port, `CODETETHER_DATA_DIR`, database and WebView2 data folder.

**Branch and worktree.** Start from the current `origin/main`, at `13fa6b8` or later (fetch first). Create branch `fix/w0f-runtime-diagnostics` in worktree `D:/Projects/Software/agenthub-work/fix-w0f-runtime-diagnostics`. W0e runs at the same time and also edits `apps/host/src/api/host-service.ts`, in other places. If W0e merges first, merge `main` into your branch.

**Why this task exists.** On the installed alpha.4 on 2026-11-19, a simple Codex Turn failed inside CodeTether. Nothing on the computer can say why.

- **The failure.**
  - The Turn ran for about 51 s and seven commands, then ended with "运行时执行失败".
  - It was recorded as `runtime_unavailable`, with reason `runtime_error` and source "CodeTether 运行时".
  - The next message in the same conversation worked.
- **No record of the cause.**
  - The Host keeps no diagnostic log.
  - The desktop app sends everything the Host prints to a console that does not exist.
- **The same gap elsewhere.** The release agent's two start failures ("本地服务意外退出") also left nothing to read.

This task adds a small, private, local diagnostic log, then uses it to find this failure.

**References** (read with `git show origin/ux/design:<path>`):

- `docs/reviews/2026-11-19-alpha4-hands-on-ui-review.md`, finding 1, with screenshots `24-sent-40s.png` to `26-failure-details.png` in `D:/Projects/Software/agenthub-archive/ui-review-2026-11-19/`
- `docs/reviews/release-v0.1.0-alpha.4.md`, "Left over": the start failures
- `docs/reviews/w0-11-windows-sandbox.md`: how an agent's shell environment broke Codex's sandbox before
- `docs/ARCHITECTURE.md`: the canonical failure model and Provider execution health
- `docs/FROZEN-BOUNDARIES.md`: what may never be logged or persisted (no durable Provider-event log)

Before starting, confirm this file has 4 second-level headings and that the last one is "Report".

## Goals

**Must:**

1. **A bounded Host diagnostic log.**
   - **Where:** in the `logs` folder next to the database, the same folder as `host-presence.jsonl`, for example `host-diagnostics.jsonl`.
     - Use fixed caps: a size per file, a number of files, and rotation, like `HostPresenceDiagnostics`.
     - Two writers now need the same bounded append, so extracting it into a small shared module is allowed.
     - A failed write never changes what the product does.
   - **What:** one JSON line per event, each with a timestamp, the Host's version and build, and an event name. At least these events:
     - **A Provider runtime failure,** local or remote: every call of `#handleRuntimeFailure`, `#handleMachineRuntimeFailure` and `#handlePersistenceFailure`. Record:
       - the AI tool, and whether the computer is local or remote
       - the canonical reason and source
       - the IDs of the Turns it failed
       - the Error's class name and its structured fields: `failureReason`, `code`, exit code, signal, and an operating-system error code such as `ENOENT`
       - the cause chain, as names and codes, at most four deep
       - a stack: function names, file base names and line:column, at most 20 frames
       - for a `ZodError`, the issue codes and paths only
       - if the failure came from handling a Provider event, that event's type and item kind
     - **The Codex App Server's lifecycle:** started (process ID and version), exited (code, signal, and whether CodeTether asked it to stop), and restarted.
     - **The Host process:** start (version, build and port), clean shutdown, and any uncaught exception or unhandled rejection, recorded with the same fields before the process exits.
   - **Never record:**
     - prompts, model output, tool output, or file contents
     - paths inside the user's projects
     - command lines, environment variables, or URLs with query strings
     - tokens, keys, credentials, account names, or email addresses
     - Provider stderr. It stays suppressed, as today.
     - Error messages. If a message is truly needed, propose an allowlist of CodeTether's own constant messages, and ask first.
   - **Bursts:** a burst of identical records is capped, for example by counting repeats per minute.
   - **Tests:**
     - each event type
     - the caps and rotation
     - a failure record built from an Error whose message, cause and ZodError input hold a fake secret and a fake project path; neither appears in the file
     - a write failure that changes nothing
2. **The desktop app keeps what it now loses.**
   - **Today:** the desktop app forwards every line the Host prints with `eprintln!`, and the installed app has no console. It records the Host's exit code only in memory.
   - **Change:** write a bounded log in the same folder, for example `desktop.jsonl`, with the same rules as goal 1. It records:
     - the Host's spawn, ready and exit, with the exit code
     - whether the exit was expected, and the time since start
     - which startup or exit dialog the user was shown
   - **Host output:**
     - Keep only lines that start with CodeTether's own prefixes, such as `[codetether:` and `[codex:failure]`. Truncate each to a fixed length, rate-limit them, and drop everything else.
     - **The exception:** if the Host exits before it reports ready, also keep the last 40 lines of its stderr, each truncated. No conversation exists at that point. Before relying on this, check what the Host can print during startup; if any of it can contain a credential, filter it out and report how.
   - **Tests (Rust):** the prefix filter, truncation, the rate limit, rotation, and the before-ready exception.
3. **Find the failure.** Use your instrumented development build:
   - **Setup:** an isolated Host, the desktop app or the web development UI, and a copy of the W0 scratch project `ta-budget-app` (Known facts).
   - **Repeat the Turn** that failed at least ten times. The prompt asked Codex, in Chinese, to list the project's files and run `node --test`, changing nothing. Allow its Approval for `node --test` once.
   - **Also try:**
     - two conversations running at the same time
     - a run while another Codex client uses the same `~/.codex`, for example a second isolated Host
     - a Turn with long command output
   - **Record each run:** whether it passed, how long it took, and its log lines.
   - **If it reproduces:**
     - Name the throw site from the log.
     - If the fix is small and inside CodeTether's handling of Provider events or persistence, fix it, with a regression test built from a synthetic event of the same shape and no real content.
     - Otherwise, report the cause and stop.
   - **If it does not reproduce,** say so. The log then explains the next occurrence in alpha.5.
4. **Quality gate:**
   - `pnpm typecheck`, `pnpm lint`, `pnpm build` and `pnpm test`
   - `cargo test` in `apps/desktop/src-tauri`
   - `pnpm format:check` for the files you changed

**Should:**

5. **The start failure.**
   - Build the desktop app locally, unsigned.
   - Start it once the way the release agent did, through COM `Shell.Application` from your own shell, and once from Explorer.
   - Report what `desktop.jsonl` records in each case.
   - Do not touch the installed app.
6. **Analysis only: one failure fails every Turn.**
   - Today, an exception while handling one conversation's Provider event fails every running local Turn of that AI tool, and marks the tool unavailable.
   - Report whether the failure could be confined to the one Turn, and what that would take. Change nothing here.

## Known facts

Line numbers are at `13fa6b8`.

- **The recorded failure.** In the installed app's database, the Turn's error is:
  - code `runtime_unavailable`, message "Codex runtime failed", reason `runtime_error`, source runtime
  - at `2026-11-19T17:40:06.700Z`
  - in the conversation "看一下这个项目有哪些文件" in `ta-budget-app`
  - Execution health for local Codex turned "unavailable" at the same moment.
  - Do not open that database. These facts are all you need from it.
- **How a local runtime failure is handled:**
  - `#handleRuntimeFailure` (`apps/host/src/api/host-service.ts:7757`) classifies the Error with `classifyCanonicalFailure(failure, timestamp, 'runtime_error')`.
  - It then fails every running local Turn of that AI tool, records execution health, and keeps the Error only in memory.
- **What `runtime_error` means.**
  - It is the fallback for an Error that carries no structured `failure`, `failureReason` or legacy `code` (`apps/host/src/api/canonical-failure.ts:25`).
  - The Codex adapter's own errors all carry a reason. For example, the App Server exiting is `CodexProcessExitError` with `provider_crashed` (`packages/adapter-codex/src/errors.ts:32`, raised at `transport.ts:93`).
  - So this failure was most likely an exception in CodeTether's own code, not Codex exiting.
- **Paths that end in `runtime_error`:**
  - **Provider events.** `#subscribeRuntime` (`host-service.ts:8633`) catches any exception thrown while `#acceptProviderEvent` handles a Provider event, and calls `fail(toError(error))`.
  - **Persistence.** `#handlePersistenceFailure` (`host-service.ts:6977`) does the same for a persistence failure.
  - **The runtime's own `#fail`** in `apps/host/src/api/codex-host-runtime.ts:454`, which notifies its failure listeners.
- **Existing logging:**
  - `HostPresenceDiagnostics` (`apps/host/src/api/host-presence-diagnostics.ts`) writes `logs/host-presence.jsonl` with 256 KiB × 8 files (lines 71–73 and 112). It is the only file in the installed app's `logs` folder.
  - The Codex adapter writes `[codex:failure]` lines with only a variant, an HTTP status and a reason (`packages/adapter-codex/src/logging.ts`).
  - The Host suppresses Codex's own stderr on purpose (`codex-host-runtime.ts:190`), because it may contain prompts, paths or credentials.
- **The desktop side:**
  - The Host's output loop is in `apps/desktop/src-tauri/src/host_supervisor.rs`, about lines 333–380. Stdout lines that are not signing requests and all stderr lines go to `eprintln!`.
  - `CommandEvent::Terminated` records the exit code in memory and raises the "本地服务意外退出" surface (`startup_error.rs:28`).
- **Concurrent use at the time.** During the same hour, another agent ran its own isolated Host and Codex App Server for the model-catalog fix. That agent is itself a Codex client sharing `~/.codex`. This is a possible factor, not an established one.
- **The W0 scratch project** `ta-budget-app` is at `E:/Projects/Software/agenthub/w0-audit/fixtures/windows-desktop-audit-scratch-projects-for-timing-and-path-display/ta-budget-app`. Work in a copy.

## Boundaries

- **Decide yourself:**
  - file names, the record format and the caps
  - whether to extract a shared bounded writer
  - how to reproduce, within goal 3
  - test design and commit splitting
- **Ask the Owner first:**
  - recording any message text
  - changing how failures are classified, which Turns fail, or what the user sees
  - confining a failure to one Turn
  - a Settings entry that opens the logs folder ("Open in Explorer" is out of scope)
  - replacing the installed desktop build
- **Do not:**
  - send, upload or sync logs anywhere
  - record content, or stop suppressing Provider stderr
  - add a durable Provider-event log
  - use the installed app, its Host or its live database
  - edit `AGENTS.md` or `docs/`
  - force-push, merge to `main`, or tag
  - read or print credentials

Push `fix/w0f-runtime-diagnostics` to `origin`.

## Report

Write to `D:/Projects/Software/agenthub-archive/w0f-runtime-diagnostics-report.md`:

- **The log:**
  - files, caps and format
  - what each field can contain, and why none of it is private
  - sample records from real runs
- **The desktop log:** the same, plus what the startup check in goal 2 found.
- **Reproduction:**
  - a table of runs
  - the cause, if found, with the throw site and the fix and its test
  - otherwise, what was ruled out
- **The start failure:** what each start method recorded.
- **One failure, every Turn:** the analysis from goal 6.
- **Gates:** results for TypeScript and Rust, with any failures verbatim.
- **Commits:** your commits and the pushed remote commit.
- **Docs:** documentation changes you think are needed. ARCHITECTURE should describe the logs.
- **Status:** anything left undone and why, and which completion level the work reached.

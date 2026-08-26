# Host

Phase 2A adds a deliberately small development harness for the local Codex App
Server. `apps/host` owns the spike lifecycle and terminal runner; provider wire
details remain in `@codetether/adapter-codex`.

From the repository root:

```text
pnpm codex:spike
```

The command prepares the ignored `.tmp/codetether-codex-spike/` workspace,
checks the local Codex executable, launches one long-running App Server process,
performs the initialize handshake, starts one ephemeral Thread and Turn, prints
normalized events, handles one-shot approvals with `y`/`n`, summarizes the run,
and shuts the process down.

There is no HTTP/WebSocket/SSE API, persistence, browser integration, or general
machine-host service in this phase.

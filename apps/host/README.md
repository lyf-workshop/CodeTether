# Host

`apps/host` owns the development harness lifecycle and the Phase 2B local Host
API. Provider wire details remain in `@codetether/adapter-codex`; clients use
`@codetether/protocol` over HTTP commands and SSE events.

From the repository root:

```text
pnpm codex:spike
pnpm host:serve -- --workspace <absolute-path>
pnpm host:integration
```

The spike command prepares the ignored `.tmp/codetether-codex-spike/` workspace,
checks the local Codex executable, launches one long-running App Server process,
performs the initialize handshake, starts one ephemeral Thread and Turn, prints
normalized events, handles one-shot approvals with `y`/`n`, summarizes the run,
and shuts the process down.

The server binds only `127.0.0.1`, requires its exact loopback `Host` authority,
accepts explicit allowed workspace roots and Origins, and keeps all identities,
snapshots, replay events, and recent action results in memory. SSE replay is
bounded to 2,048 events / 8 MiB; each live client is independently bounded and
disconnected on sustained lag. It has no React integration, WebSocket
transport, persistence, authentication, LAN exposure, or general production
machine-host behavior.

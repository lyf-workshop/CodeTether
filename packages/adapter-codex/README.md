# Codex Adapter

`@codetether/adapter-codex` contains the Phase 2A runtime spike for the local
Codex App Server. It owns the Codex child process, newline-delimited JSON-RPC
transport, the small protocol subset used by the spike, approval dispatch, and
translation into `@codetether/agent-core` events.

The implementation is based on schemas generated locally from
`codex-cli 0.149.1`:

```text
codex app-server generate-json-schema --out <directory>
codex app-server generate-ts --out <directory>
```

Generated schemas are development evidence, not a runtime dependency. Unknown
provider notifications are reported and ignored so a forward-compatible event
does not crash the long-running process.

This package does not expose a browser transport, persistence, UI state, or a
speculative multi-provider adapter hierarchy.

# Agent Core

`@codetether/agent-core` contains the smallest normalized runtime event contract
needed by the Phase 2A Codex App Server spike.

The contract is intentionally Codex-only for this phase. It describes the
conversation, turn, message, tool, file-change, approval, and completion events
that the runtime harness can observe without exposing Codex JSON-RPC payloads as
the primary API. Adapters may attach the original provider method and payload as
optional diagnostic metadata.

This package does not define a provider adapter interface, persistence, UI
state, browser transport, or speculative Claude Code/OpenCode behavior. The
Codex wire protocol and process lifecycle belong to `@codetether/adapter-codex`.

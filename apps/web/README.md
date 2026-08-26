# @codetether/web

React web/PWA surface for CodeTether.

The accepted Phase 1 visual surface is frozen. `/conversations/demo` continues to use Mock data, while Phase 2C.1 allows a valid `/conversations/conv_*` route to consume a read-only Host projection through the application-scoped `HostRuntime`.

The development Host URL defaults to `http://127.0.0.1:4317` and can be overridden once with `VITE_CODETETHER_HOST_URL`. Bootstrap, Snapshot, and projection records use TanStack Query. One SSE runtime owns reconnect and the browser-memory cursor; components do not parse SSE, sequence numbers, provider IDs, or Codex JSON-RPC.

Live controls are intentionally read-only in Phase 2C.1. Inbox and Conversations remain Mock data. The Snapshot does not contain historical messages, Tools, terminal output, file changes, completed Turns, or user input, so a live route must be open before a development helper starts the Turn to observe the full Timeline.

`/__ui` remains a development-only component showcase rather than a product route.

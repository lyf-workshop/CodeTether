# @codetether/web

React web/PWA surface for CodeTether.

The accepted Phase 1 visual surface is frozen. `/conversations/demo` continues to use Mock data, while a valid `/conversations/conv_*` route consumes the Host projection and Phase 2C.2 control boundary through the application-scoped `HostRuntime`.

The development Host URL defaults to `http://127.0.0.1:4317` and can be overridden once with `VITE_CODETETHER_HOST_URL`. Bootstrap, Snapshot, and projection records use TanStack Query. One SSE runtime owns reconnect and the browser-memory cursor; components do not parse SSE, sequence numbers, provider IDs, or Codex JSON-RPC.

On a live route, the existing Composer starts text Turns, pending Approval rows resolve one-shot `accept` or `decline` decisions by exact Host identity, and the Header interrupts the exact active Turn. The controller never creates an optimistic canonical User message and waits for Host events before treating Approval or Turn terminal state as final. Unsupported quick actions, model/reasoning/permission changes, and Stop remain disabled. Inbox and Conversations remain Mock data, and all runtime history is process-local rather than persistent.

`/__ui` remains a development-only component showcase rather than a product route.

# Client-to-Host Protocol

`@codetether/protocol` is the runtime-validated source of truth for the
CodeTether Client ↔ Host Protocol v1. Zod schemas define the wire boundary and
export inferred TypeScript types for clients and the Host.

The package contains identifiers, records, mutation requests and responses,
event envelopes, and replay-cursor helpers. It contains no HTTP/SSE server or
client implementation, provider wire payloads, persistence, React code, or
Codex adapter logic.

`ConversationId` is the CodeTether routing identity. Provider Thread IDs remain
private Host state and are not exported as Client-to-Host wire fields or used in
browser routes.

Emitted events use positive Host-global sequence numbers. A snapshot may be
formatted as `<epoch>:0` before the first event so a client can connect without
leaving a snapshot-to-stream race; sequence zero is a cursor, never an emitted
regular event. A connection-local `stream.reset` control reuses the current
snapshot cursor, does not allocate a new global sequence, and is never stored in
replay or broadcast to other observers.

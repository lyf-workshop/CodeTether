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
regular event. An invalid reconnect cursor receives a connection-local
`stream.reset` control that reuses the current snapshot cursor and is not stored
in replay. Runtime-history compaction instead publishes a sequenced,
replayable `stream.reset` boundary so every current or reconnecting observer
replaces its projection from the same bounded Snapshot.

Protocol v1 also permits an additive `conversationRuntimes` member on a Host
Snapshot. Older Phase 2B snapshots without that member remain valid. When the
member is present, it contains one bounded runtime record per Conversation:
retained Turns (including the Host-owned text input), Agent messages, Tools,
file changes, a recent terminal tail, and explicit eviction/truncation metadata.
Pending Approvals remain in the Snapshot's single top-level collection and are
validated against the retained active Turn rather than duplicated into runtime
history.

Command Tool events and runtime records use a stable bounded `name` for
presentation identity and may carry the bounded raw command separately in
`command`. This additive field keeps provider executable wrappers out of UI
titles while preserving command details for lexical presentation and the
terminal tail.

The wire schema has defensive ceilings of 64 Turns, 2,048 messages, 2,048
Tools, 2,048 file changes, and 128 KiB of UTF-8 terminal text per Conversation.
The Host uses smaller runtime-memory limits where appropriate. These records are
process-memory recovery state, not persistence or a durable event store.

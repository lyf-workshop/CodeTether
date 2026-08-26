# CodeTether Client

`@codetether/client` is the small non-React consumer for Client-to-Host
Protocol v1. It validates bootstrap, snapshot, mutation, error, and SSE event
payloads through `@codetether/protocol`.

The client supports caller-controlled `Last-Event-ID` reconnect and exposes
`stream.reset` without hiding it behind automatic retries. It does not own
React state, persistence, authentication, provider protocols, or a reconnect
policy. Inbound data is bounded independently of the Host: HTTP JSON defaults
to 16 MiB and one SSE frame defaults to 10 MiB; exceeding either limit cancels
the body and raises a protocol error.

# CodeTether Phase 9B.4 Remote Conversation Read REAL Closure

## Scope and lineage

Phase 9B.4 closes the remote Conversation read surface on top of the accepted
Phase 9B.3 directory baseline `604c233c4bba1edb02c8dd8c5440d1e186cbdf17`.
The implementation and REAL validation completed at
`8753735822d0e1bcc907a8bcb3411828ec908600`.

Phase 9B.4 is read-only. Remote Send, native Provider resume, new
Conversation creation, and a REAL Provider Turn are intentionally deferred to
Phase 9B.5.

## Historical transcript pagination

The Host exposes bounded historical Conversation pages through the existing
Supervisor protocol. The deterministic completeness validation covered 130
Turns and 260 supported entries. All 260 identities were unique, chronology
was preserved, no ranges were skipped, and pagination was complete only after
the true beginning was reached.

The REAL validation used the accepted Conversation
`conv_a44149833df74147991be42e732f86cf`, bound to the accepted Host and
Machine, with the `codex` Provider and an adopted native Conversation.

## Direct REAL

The Direct Supervisor path completed three bounded history pages and returned
the complete supported transcript. It used the authenticated inner Supervisor
TLS channel, bypassed the local 4317 product-data path, and remained read-only.

## Relay REAL

The forced Relay path returned the same Conversation pages and count as Direct
through the opaque Relay transport and inner Supervisor TLS. The local 4317
path and Direct 4318 data path were unused. Relay did not see transcript
content or authorize the read.

## Live read and ordering

The live read path reused the stable event identity, watermark, deduplication,
and gap-recovery machinery. The deterministic pipeline observed 130 incremental
events, recovered a deliberate gap, preserved ordering, and observed the
terminal state. A slow observer remained bounded.

The live validation was intentionally a Host event-pipeline validation. It did
not create a REAL Provider Turn. The observer created zero Provider sessions
and caused zero additional Provider executions.

## Cold-read boundary

Opening Host, Machine, Project, Conversation, history, or live-read surfaces
did not hydrate a Provider or start Codex/Claude processes. Direct and Relay
cold-read process deltas were zero.

## Read-only enforcement

The accepted remote read allowlist is:

- `conversation.history`
- `conversation.live.read`

Send, resume/start, create, cancellation, Provider start, tool approval,
shell, and filesystem mutation remained denied. No REAL write was performed.

## Privacy and authority boundaries

Control Plane stored no transcript bodies. The Relay application layer had no
transcript visibility. Native Provider session identifiers remained private to
the Host/Provider boundary and were not exposed to Web. Receipt and manifest
metadata contain no transcript content.

The ProductDevice remained separate from Controller/Machine trust. The Host
remained the product read authority, while the Machine/Node remained the
execution authority. No remote control action was admitted in this phase.

## REAL evidence

Receipt:

`apps/control-plane/.tmp/phase9b4-remote-conversation-read/evidence/phase9b4-remote-conversation-read-2026-09-25T030834488Z.json`

Manifest:

`apps/control-plane/.tmp/phase9b4-remote-conversation-read/evidence/phase9b4-remote-conversation-read-2026-09-25T030834488Z.json.sha256`

Receipt SHA-256:

`5e416704131e9c5b4e515c1237406936ebecc87c23491477259568b694b4e496`

## Gates

The accepted REAL receipt records protocol, Supervisor transport, Web, Host,
typecheck, lint, test, build, formatting, and diff checks as passing.

## Deferred boundary

Phase 9B.5 begins from this closure and adds explicit remote control: Send to
an existing Conversation, native resume, new Conversation creation, and one
REAL Provider Turn observed through this read path. Remote tool approval,
remote Turn cancellation, shell, filesystem mutation, and Mobile remain out of
scope.

Status: `PHASE9B4_REMOTE_CONVERSATION_READ_REAL_PASS`

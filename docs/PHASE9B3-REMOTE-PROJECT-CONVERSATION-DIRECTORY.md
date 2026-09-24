# Phase 9B.3 Remote Project / Conversation Directory

## Scope

Phase 9B.3 extends the authenticated Phase 9B.2 Host Supervisor read session
from Host and Machine state to bounded Project and Conversation metadata. It
does not expose transcripts or any Provider, Agent, shell, filesystem, or
approval mutation.

The accepted Phase 9B.2 closure commit
`00d9771fdebbc383f9812d6af936f573f3a84737` is the implementation baseline.

## Authority and transport

Project, ProjectLocation, and Conversation directory truth remains in the
Host SQLite store. The Control Plane remains an account, admission, Host
directory, and rendezvous service; it stores no Project or Conversation
product state. Direct and Relay carry the same end-to-end authenticated
Supervisor protocol. Relay cannot inspect application metadata or authorize a
ProductDevice.

The explicit Supervisor read allowlist is:

- `host.bootstrap`
- `machine.list`
- `machine.get`
- `project.list`
- `project.get`
- `conversation.list`
- `conversation.get`

Conversation history, send/resume/create, Provider start, shell, and
filesystem operations are not protocol members.

## Directory semantics

`project.list` is scoped to the exact selected Machine and returns only safe
display metadata, timestamps, and a Machine-scoped Conversation count. It
does not return Project paths. `project.get` requires the exact
Project/Machine location pair.

`conversation.list` and `conversation.get` require the exact immutable
Project and Machine bindings. They return title, title source, provenance,
Provider, durable status, timestamps, archive state, and only a boolean/safe
classification for the native session binding. Native session identifiers,
working directories, transcript content, Tool data, and source code do not
cross the Supervisor boundary.

Both lists use bounded keyset pagination ordered by descending activity time
and ascending durable ID as a stable tie-breaker. Cursors are versioned and
bound to their Machine, and Conversation cursors are additionally bound to
their Project. Reusing a cursor in another scope fails closed.

## Cold-read and UI behavior

The queries read only durable SQLite metadata. They do not scan native
Provider storage, hydrate transcript history, resume a native session, or
start Codex or Claude Code. Local browsing continues through the existing
local Host routes. Direct and Relay browsing use one common remote view model
and the same Host-side read services.

The Desktop Host page now supports:

```text
Host -> Machine -> Projects -> Conversations -> metadata
```

It distinguishes loading, empty, disconnected/stale, and unavailable states
and offers explicit pagination. The Conversation detail is metadata-only.

## Schema

No SQLite or Control Plane migration is required. Existing Project,
ProjectLocation, Conversation, Machine, Provider, and native-binding columns
already contain the required durable metadata.

## Validation boundary

Automated coverage includes multi-Machine and multi-Project isolation,
multi-page Project and Conversation fixtures, adopted and CodeTether-created
Conversations, Provider metadata, Direct and Relay protocol reads, and
representative write-operation denial. A validation-only environment switch
may auto-open the specified authorized Host and select the first safe
Machine/Project/Conversation so the existing REAL Direct and Relay harnesses
can collect read-only evidence without mutating user data.

Phase 9B.3 ends at Conversation metadata. Full transcript reads, live Agent
streaming, send/resume/create, and Mobile remain outside this phase.

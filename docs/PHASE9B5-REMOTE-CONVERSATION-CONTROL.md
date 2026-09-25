# CodeTether Phase 9B.5 Remote Conversation Control

Phase 9B.5 starts from the Phase 9B.4 read closure at
`715f24bb9f562c6c3e3edc1b9c8378752be904ad`. The implementation branch is
`phase9/remote-conversation-control`.

This phase adds the narrow remote control surface required to send a text
message to an existing Conversation and to create a new Conversation with an
explicit Project, Machine, and Provider. Both operations call the existing
Host `startTurn` and `createConversation` paths. They do not introduce a
Provider protocol or a ProductDevice-to-Node path.

## Authorization

The existing Control Plane authorization remains `supervisor_read`. It is not
silently upgraded. A local Host owner must explicitly approve the exact
materialized authorization before a Supervisor session reports
`control: "control"`. The approval is stored in Host SQLite migration 021,
`host_supervisor_control`, and survives Host restart. Until approval,
directory, history, and live-read operations continue to work while
`conversation.turn.start` and `conversation.create` return
`operation_not_allowed`.

The fixed control union contains only:

- `conversation.turn.start` for an immutable existing Conversation;
- `conversation.create` for a new Conversation plus its first text Turn.

Shell, filesystem mutation, Provider switching, Machine switching, tool
approval, Turn cancellation, and Host administration are not part of this
surface.

## Admission and execution

The Supervisor server validates the authenticated Host, ProductDevice, grant,
and local control approval before dispatch. Host service validation then checks
the exact Machine, Project, ProjectLocation, Conversation, Provider
availability, native session binding, and one-active-Turn invariant. Existing
Provider adapters perform native create or resume and retain their established
Machine/Node execution boundary. A successful response is returned only after
the normal Host durable Turn admission path returns its safe action/Turn
result.

`conversation.turn.start` reuses the durable `turn_start_actions` relation and
the existing Host action idempotency cache. Reusing an action ID with a
different Conversation or message is rejected. `action.get` is a bounded
Supervisor read backed by the durable Turn action relation and returns only
`not_found`, `accepted`, `running`, `completed`, or `failed`, with public
Conversation/Turn identities when known. A response-loss client reads this
state after reconnect and never automatically resends the message.

New Conversation creation selects the Project and Machine from the validated
remote directory context and admits the first message through the ordinary
Turn path. The native Provider session remains private to Host/Provider
execution.

## Desktop behavior

The remote Conversation view remains fully readable for a read-only session.
It shows a Composer only after the authenticated Supervisor session reports
local Host-approved control. A running or waiting Conversation disables the
Composer and does not queue a second Turn. The Project context exposes a
bounded Provider selector and first-message form for explicit Conversation
creation. Response-loss handling reads `action.get`; it does not replay an
uncertain action.

The Phase 9B.4 history and live-read machinery remains the sole observer. It
does not create a second Provider session or execution. Provider approval
states remain observable only; there are no remote Approve/Deny controls.

## Boundaries and privacy

Prompt and Provider content remain on the existing end-to-end Supervisor and
Host execution path. Control Plane stores authorization and rendezvous
metadata only. Relay forwards opaque inner Supervisor TLS records and cannot
authorize or inspect actions. ProductDevice authentication remains separate
from Controller/Machine trust. Cold reads still do not start a Provider;
Provider startup or resume occurs only after explicit Send/Create control.

No REAL control action has been run in this implementation step. The exact
owner gate is therefore the following local action after review of the
automated results:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:4317/api/v1/supervisor/control/approve `
  -ContentType 'application/json' `
  -Body '{"authorizationId":"hauth_f00a74aff9b14c2d92c9c8193515b08d"}'
```

This command contains no JWT, OTP, private key, or database credential. It
approves only the already materialized authorization on the local Host; it
does not create a new account, re-enroll the ProductDevice, or change Machine
trust. REAL Direct/Relay control validation remains an Owner-gated step.

Status before that action: `PHASE9B5_OWNER_CONTROL_APPROVAL_REQUIRED`.

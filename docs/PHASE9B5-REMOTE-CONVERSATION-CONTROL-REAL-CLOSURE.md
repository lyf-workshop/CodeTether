# CodeTether Phase 9B.5 Remote Conversation Control REAL Closure

## Lineage

Phase 9B.5 closes on the accepted Phase 9B.4 closure
`715f24bb9f562c6c3e3edc1b9c8378752be904ad` and the REAL implementation
baseline `9f8ef77daea987869d64e807984556a11227d5ee`.

The accepted implementation and validation completed at
`1451c8129ef7f65287cd4b62a46c1551037f362c`.

## Accepted REAL evidence

- Existing Conversation remote Send completed through forced Direct.
- Native Provider resume retained the existing session binding.
- New Conversation creation completed through forced Relay.
- Persistent native Provider sessions were created and retained.
- One active Turn remained enforced.
- Durable `actionId` idempotency rejected changed prompt and Conversation
  bindings, and deterministic uncertainty recovery used read state without
  automatic replay.
- A REAL Codex Provider Turn produced live output and durable completion.
- Direct and Relay control paths each verified Host identity, ProductDevice
  control authorization, exact admission, execution, live state, terminal
  state, and history.
- The live observer created zero additional Provider executions or native
  sessions.
- ProductDevice identity remained separate from Controller/Machine trust.
- Cold reads created zero Codex or Claude Code executions.
- Read-only authorization continued to allow reads while denying Send/Create.
- Control Plane stored no prompt, response, transcript, or execution payload.
- Relay remained opaque to inner Supervisor application payloads.
- Claude adapter coverage passed; Claude REAL remained deferred.

## REAL receipt

Receipt SHA-256:

`5f4bfcda99935039536d85628f7d66c656c8e85762ff644efbb1333e03095b3d`

The privacy-safe receipt and SHA-256 manifest are retained under the ignored
Phase 9B.5 evidence directory.

## Gates

Typecheck, lint, full workspace tests, build, changed-file Prettier, and
`git diff --check` passed. The focused control-boundary regressions cover
read-only Conversation Create denial and action-id Conversation binding
conflicts.

## Deferred boundary

Remote Turn cancellation, remote tool approval, shell, filesystem mutation,
Mobile, and Claude REAL remain outside Phase 9B.5.

Status: `PHASE9B5_REMOTE_CONVERSATION_CONTROL_REAL_PASS`

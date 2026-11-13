# Task. D2 remote model switching (Supervisor protocol extension)

Run on Mac or Windows. Continue from `main` (currently `4801ef1`). Extend the Supervisor protocol to switch models and reasoning effort within remote conversations, giving tablet/iPad access to remote Codex/Claude the same experience as the native app. Push commits to `feat/d2-remote-model-switching`, without pushing `main`, merging, or tagging.

References (read each with `git show`).

- `docs/ux-redesign/10-desktop-improvements.md` §I3 (Composer model switching).
- `docs/reviews/d2-protocol-model-switching-prompt.md`, the local model-switching design (implemented in `feat/d2-model-switching` @ `c9ba712`, while this round covers remote support).
- `docs/ux-redesign/08-remote-management.md` §3.1, Supervisor operation extension rules.
- `packages/supervisor-transport/src/protocol.ts`, the current protocol structure.
- `packages/supervisor-transport/src/server.ts`, operation dispatch.

Before starting, confirm this file has four second-level headings and the last section is "Report".

## Background

Local model switching is implemented in `feat/d2-model-switching`.
- New `PATCH /api/v1/conversations/:id/model` endpoint.
- `current_model` and `current_reasoning` fields in `conversations` (migration 026).
- `availableModels` in `ProviderDescriptor`.
- `currentModel` and `currentReasoning` in `ConversationSummary`.
- Composer model-selection controls for local conversations.

Expose the same capability to remote devices (tablet/iPad) through the Supervisor protocol this round.

## Goals

**Required.**

1. **Add Supervisor operation `conversation.updateModel`.**
   - Request fields are `conversationId`, `actionId`, optional `model`, and optional `reasoning`.
   - Require control permission and include it in `isSupervisorControlOperation`.
   - Call existing local model-switching logic (the relevant `host-service.ts` method).
   - Return the updated `ConversationSummary`, including `currentModel` and `currentReasoning`.
   - Idempotency returns the first result when the same `actionId` is resent.
   - Provider switching is forbidden. Codex cannot become Claude. Only model and reasoning effort may change.

2. **Return `currentModel` and `currentReasoning` from `conversation.list` and `conversation.detail`.**
   - Add `currentModel?` and `currentReasoning?` to `SupervisorConversationDirectoryItem`.
   - Read both fields in `listSupervisorConversations`.
   - Include them in Supervisor conversation detail too.
   - Return them only for supported Providers (both Codex and Claude support this).

3. **Include `availableModels` in `machine.get` Provider descriptors.**
   - `ProviderDescriptor` includes `availableModels` when device detail is retrieved through Supervisor.
   - Use the local API format, `Array<{ id: string; name: string; description?: string }>`.
   - Clients render model-selection UI from this list.

4. **Rust core methods.**
   - Add `conversation_update_model` to `packages/supervisor-mobile/src/lib.rs`, exposed through UniFFI.
   - Request fields are `conversationId`, `actionId`, optional `model`, and optional `reasoning`.
   - Return the updated `ConversationSummary`.
   - Add the corresponding Kotlin call in `apps/android/`.
   - No iOS Swift repository currently exists. Document the interface signature in the report only.

5. **Frame-size checks.**
   - A long `availableModels` list may exceed 16 KiB.
   - Truncate `availableModels` with `_truncated: true` if oversized.
   - Measure actual Codex and Claude model-list sizes and record them.

**Expected where feasible.**

6. **SSE events.**
   - Emit `conversation.updated` after a successful model switch.
   - Include `currentModel` and `currentReasoning`.
   - Tablet/iPad clients update Composer on receipt.

## Known facts

- Local model switching is implemented (`feat/d2-model-switching` @ `c9ba712`), but that branch has not merged into `main`.
- Start from `main` (`4801ef1`), without depending on `feat/d2-model-switching`.
- Both branches will eventually merge, so implement only Supervisor support here without duplicating the local endpoint.
- Before `feat/d2-model-switching` merges, necessary schema changes may be cherry-picked from it.

- The current Supervisor protocol is version 1 (`packages/supervisor-transport/src/protocol.ts`).
- B4a added `reason` and six remote operations. Add `conversation.updateModel` on that foundation.
- The Rust core (`packages/supervisor-mobile/`) already has B4a operations. Extend it further.

## Boundaries

**Decide independently.**
- Whether to cherry-pick schemas from `feat/d2-model-switching` or define them again.
- `availableModels` truncation threshold (50 is suggested, above realistic model counts).
- Implementation and commit breakdown.

**Ask the user first.**
- Supervisor protocol version changes.
- Changes to frozen Phase boundaries.
- Infrastructure changes outside `main`.

**Do not do.**
- Implement iOS Swift calls (the repository has no iOS app).
- Implement frontend integration (D2.1b handles it).
- Push `main`, merge, or tag.

## Report

Append a "Remote model switching" section to `~/agenthub-archive/d2-protocol.md`.

- New Supervisor operation request/response formats.
- Measured `availableModels` frame sizes, model counts and bytes for Codex and Claude.
- Whether `feat/d2-model-switching` schemas were cherry-picked or redefined.
- Rust function signature for later iOS implementation.
- Kotlin call-layer changes.
- Test results (typecheck / lint / Rust / Android / build).
- Commit hash and pushed remote branch.
- Remaining work and reasons.

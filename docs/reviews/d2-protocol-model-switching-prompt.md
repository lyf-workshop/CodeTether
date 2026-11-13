# Task: D2 protocol extension - model switching within conversations

Run on Mac or Windows. Reference: the Q3 decision for I3 (Composer) in `docs/ux-redesign/10-desktop-improvements.md`. The goal is to make Codex/Claude usage in CodeTether consistent with their native apps.

Before starting, confirm that this file has four second-level headings and that the final section is "Report".

## Goals

Extend Protocol v1 to switch models and reasoning effort within an existing conversation without creating another conversation.

**Required changes**:

1. **Add `conversation.updateModel` or an equivalently named endpoint**:
   - Path: `PATCH /api/v1/conversations/:conversationId/model`
   - Request body:
     ```json
     {
       "model": "gpt-4o",           // Optional model switch
       "reasoning": "high"           // Optional reasoning-effort switch (Claude)
     }
     ```
   - Response: updated `ConversationSummary`
   - Permission: the conversation's Machine must be online and the caller must have control permission
   - Restrictions:
     - Provider cannot change (Codex cannot become Claude, or vice versa)
     - Only models supported by that Provider may be selected
     - Return `operation_not_allowed` if the Provider cannot switch models

2. **Add current model and reasoning fields to `ConversationSummary`**:
   - `currentModel?: string`: currently used model ID (e.g. `"gpt-4o"`, `"claude-opus-5-5"`)
   - `currentReasoning?: string`: current reasoning effort (e.g. `"high"`, `"medium"`)
   - Return these fields only for Providers that support switching

3. **Add available models to `ProviderDescriptor`**:
   - `availableModels?: Array<{ id: string; name: string; description?: string }>`
   - Example Codex response:
     ```json
     [
       { "id": "gpt-4o", "name": "GPT-4o", "description": "The latest optimized GPT-4 version" },
       { "id": "gpt-4", "name": "GPT-4" },
       { "id": "o1-preview", "name": "o1 Preview", "description": "Deep reasoning model" }
     ]
     ```
   - Example Claude response:
     ```json
     [
       { "id": "claude-opus-5-5", "name": "Opus 5.5" },
       { "id": "claude-sonnet-5-5", "name": "Sonnet 5.5" },
       { "id": "claude-haiku-5-5", "name": "Haiku 5.5" }
     ]
     ```
   - Leave the field empty or omit it if the Provider offers no model list

4. **Host implementation**:
   - Codex adapter:
     - Read Codex's available models if exposed
     - Call its model-switching interface if supported
     - Return `operation_not_allowed` if in-conversation switching is unsupported
   - Claude adapter:
     - Return the fixed Claude model list (Opus/Sonnet/Haiku)
     - Change the next Turn's model parameter when switching
     - Map reasoning effort to Claude's `--effort`
   - Database: add nullable `current_model` and `current_reasoning` to `conversations`
   - SQLite migration: add migration 015 (`conversation_model_switching`)

5. **SSE events**:
   - After successful switching, emit `conversation.updated` with new `currentModel` and `currentReasoning`
   - Update the Composer when the frontend receives it

6. **Remote conversations**:
   - Support model switching for remote Codex/Claude conversations too
   - Implement the same switching logic in Node adapters
   - Carry switch requests through the Supervisor protocol

**Constraints**:

- **Provider stays fixed**: no Codex-to-Claude switching or vice versa
- **History stays intact**: switching affects only the next Turn; historical Turns retain their models
- **Failure behavior**: unsupported switching or unavailable models return explicit errors while preserving the conversation
- **Permission checks**: only clients with control permission may switch

## Known facts

- Provider, model, and reasoning are currently fixed on creation, with no in-conversation switching
- `ConversationSummary` has `provider` but no `currentModel`
- `ProviderDescriptor` has `capabilities` but no `availableModels`
- Native Codex/Claude Code CLI support for in-conversation switching requires verification
  - If unsupported natively, implement it ourselves through session recreation or adjusted parameters

## Boundaries

- **Decide independently**:
  - Endpoint path/name (`updateModel`, `switchModel`, or `setModel`)
  - Database field names
  - How to determine Provider switching support
  - Adapter implementation when native CLI support is absent
- **Ask the user first**:
  - Changes to protocols other than Protocol v1 (such as Supervisor)
  - Changes to frozen Phase boundaries
  - User-supplied Codex/Claude test accounts or keys
- **Do not**:
  - Switch automatically; users choose manually
  - Recommend models; list available models only
  - Add custom models; use only Provider-supplied models

## Report

Write `~/agenthub-archive/d2-protocol.md` afterward.

- Endpoint paths and request/response formats
- Database migration contents
- Codex/Claude adapter approach (native interface or our own implementation)
- Tests for local Codex switching, local Claude model/effort switching, and remote switching
- Implementation details where native CLI support is absent
- Commit hash and pushed remote branch

Branch `feat/d2-model-switching`; push to `origin`, without merging into `main`.

# Task: X1a Remaining Context in the Composer

**Where it runs.** On Windows. It needs this computer's installed Codex and Claude Code for real Turns.

**Windows-only scope (Owner, 2026-11-18; AD-13).** Goals 6 (conversations on another computer) and 7 (tablet and iPad) are postponed until the Windows focus ends. Skip them, and say so in the report.

**Branch and worktree.** Start from the current `origin/main` after task 5 (D2 model-control integration) has been merged (fetch first). Create branch `feat/x1a-context-usage` in worktree `D:/Projects/Software/agenthub-work/feat-x1a-context-usage`.

**Why this task exists.**

- The Composer shows "剩余上下文" with no value.
- The Owner wants the feature, not its removal (AD-12): the user should see how much of the model's context window the conversation has used, as Codex and Claude Code show natively.
- Both Providers already report token usage. CodeTether drops it.

**References** (read with `git show origin/ux/design:<path>`):

- `docs/reviews/2026-11-13-assessment-and-plan.md`, AD-2 (revised) and AD-12
- `docs/reviews/2026-11-13-desktop-ui-review.md`, finding 3
- `docs/ux-redesign/10-desktop-improvements.md` §3.3 ("Provider information bar": remaining context as a progress indicator and percentage, shown only when a Provider reports real usage)
- `docs/ux-redesign/04-requirements.md` W4 and W13
- `docs/ux-redesign/03-project-plan.md` §6 (invariants)
- `docs/ARCHITECTURE.md` (normalized event model; Provider details stay behind adapters)

Before starting, confirm this file has 4 second-level headings and that the last one is "Report".

## Goals

**Must:**

1. **Normalize context usage in both local adapters.** Turn each Provider's usage report into one Provider-neutral event carrying:
   - tokens currently in the context
   - the model's context window
   - the model it was measured for
   - the observation time

   Raw Provider payloads stay inside the adapters.

2. **The Host keeps the latest observation per conversation.**
   - Keep it durably, so a cold conversation shows its last known value. Use one migration with the next free number; task 5 uses 026.
   - Expose it on the conversation detail read and in `conversation.updated` (or the existing low-frequency event that fits) as an optional field.
   - Reading it never hydrates a conversation or starts a Provider.
3. **The Composer shows it** (10 §3.3).
   - **Where and what:** in the Provider information bar, a small progress indicator with the remaining percentage, "剩余 N%", replacing today's empty "剩余上下文" label.
   - **Tooltip:** "已用 X / Y tokens", plus the observation time when the value is last known rather than from the current session.
   - **Tone:** the warning tone at or below 20% remaining; the danger tone at or below 10%.
   - **Shown only when it is true:**
     - no value is known
     - the window is unknown
     - the conversation's current model (task 5) differs from the model the value was measured for

     In any of these cases, nothing is shown: no label, no empty bar.
4. **The number matches the native tools.**
   - For the same Codex thread, the percentage equals what the Codex CLI shows, within one point.
   - For Claude Code, it matches what Claude Code reports for the same session.
   - Report how you compared, with the numbers.
5. **Quality gate:**
   - `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`
   - `pnpm format:check` for changed files
   - tests for:
     - each adapter's normalization from a recorded fixture
     - the Host's persistence across restart
     - the migration on a copy of an existing database
     - the hide rules in goal 3
     - the percentage formula

**Should:**

6. **Conversations on another computer.** When the existing read path for a paired computer's conversation can carry the optional field without a new Supervisor operation, show it there too. Otherwise, leave it out and report what it would take.
7. **Tablet and iPad.** If the shared Rust and Kotlin layers already decode the conversation detail with unknown-field tolerance, nothing breaks. Check it, and report whether showing the value there would be a small follow-up.

## Known facts

- **Codex.**
  - Codex's App Server sends `thread/tokenUsage/updated` notifications. The local Codex normalizer does not handle them; see the method list in `packages/adapter-codex/src/normalizer.ts:398-407`. The remote Node runner validates and discards them (`apps/node/src/remote-codex-runner.ts:1114-1119`).
  - The installed Codex can generate its own App Server schema. Take field names from that schema for the installed version, not from memory. The payload includes the totals, the last request's usage and the model's context window, which can be null.
  - Codex's own TUI computes "context left" with its own formula, which subtracts a fixed baseline. That formula is in codex-rs, in the token-usage type's "percent of context window remaining". Use the same formula, so the numbers match (goal 4).
- **Claude Code.**
  - stream-json `assistant` messages carry the request's `usage`:
    - `input_tokens`
    - `cache_creation_input_tokens`
    - `cache_read_input_tokens`
    - `output_tokens`
  - The `result` message carries per-model usage, including the context window.
  - `result.usage` sums every API call in the Turn, so it overstates the current context. The last assistant request's input-side tokens are the closer measure.
  - Today the Claude normalizer reads none of these; `packages/adapter-claude/src/normalizer.ts:116` handles `result` for the terminal state only.
  - Verify the field names against the installed Claude Code.
- **Model.** Task 5 adds the conversation's current model (migration 026, `current_model`) and per-Turn model changes. A context window belongs to a model, which is why goal 3 hides a value measured for another model.
- **Migrations.** `main`'s latest migration before task 5 is 25.
  - The Phase 6D health table (migration 013) is a precedent: one bounded latest observation, no history.
  - Do not store raw Provider payloads.
- **Frozen remote profiles.** The Phase 6 Node's remote Codex and Claude message families are frozen (FROZEN-BOUNDARIES). Adding usage to them needs the Owner.
- **The Composer today.** On `4801ef1`, `apps/web/src/components/conversation/composer.tsx:268-276` renders the model name and an empty "剩余上下文" label. Task 5 rewrites this bar for the model control. Build on its version.
- **Schemas.** Protocol schemas are `.strict()`. A new optional field on a read is the D2 precedent: `ProviderDescriptor.availableModels` on `feat/d2-model-switching`. An older desktop reading a newer Host's strict schema rejects unknown fields, so check how that precedent handled it and do the same.

## Boundaries

- **Decide yourself:**
  - the normalized event's name and shape
  - the table or column layout of the migration
  - which existing event carries the update
  - the progress indicator's look within the tokens and 10 §3.3
  - test changes and commit splitting
- **Ask the Owner first:**
  - a second migration
  - any change to the Phase 6 Node message families
  - a new Supervisor operation
  - polling a Provider for usage (the value comes only from Turns the user runs)
  - replacing the installed desktop app
- **Do not:**
  - show an estimate when no Provider value exists
  - edit `AGENTS.md` or `docs/`
  - push `main`, merge or tag
  - read or print credentials

Push `feat/x1a-context-usage` to `origin`.

## Report

Write to `D:/Projects/Software/agenthub-archive/x1a-context-usage-report.md`, with screenshots in `D:/Projects/Software/agenthub-archive/x1a-context-usage/`:

- **Data:** the fields read from each Provider (quoted from the installed versions' schema or output), and the formula.
- **Comparison:** CodeTether's value against the native value for one Codex thread and one Claude Code session, at two points in each conversation.
- **Contract:** the protocol, event and migration changes, and what an older client does with them.
- **Screenshots:** the Composer with a high value, a warning value and no value, in light and dark themes.
- **Remote and tablet:** findings for goals 6 and 7.
- **Gates:** results for each check, with failures quoted verbatim.
- **Commits:** your commits and the pushed remote commit.
- **Status:** anything not done and why, and the completion level reached.

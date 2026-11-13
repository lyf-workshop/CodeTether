# Task: B3a Send Speed (Desktop)

**Where it runs.** On Windows. The slow path is the real, roughly 333 MB `codex.exe` on this machine, so measure there.

**Branch and worktree.** Start from the current `origin/main` after `feat/d2-model-control` has merged (fetch first). Both tasks change the Composer and the Turn start path. Create branch `feat/b3a-send-speed` in worktree `D:/Projects/Software/agenthub-work/feat-b3a-send-speed`.

**References** (read with `git show origin/ux/design:<path>`):

- `docs/ux-redesign/03-project-plan.md` §4, B3 row, first and second bullets (Owner decision 2026-11-04)
- `docs/ux-redesign/03-project-plan.md` §6 (invariants: no automatic resend, `actionId` idempotency, `409` when busy)
- `docs/reviews/2026-11-13-assessment-and-plan.md` AD-10

Before starting, confirm this file has 4 second-level headings and that the last one is "Report".

## Goals

**Must:**

1. **Stop re-checking the AI tool on every send.**
   - Today, every local conversation create and every Turn start runs the full local Provider lifecycle refresh. For Codex that means:
     1. hash the whole executable
     2. run the probes
     3. hash it again
   - Change it to what the Owner decided in 03 B3: cache the check result, keyed by the installation's resolved path, size and modification time. Run the full check only when:
     - the key changed: upgrade, replacement or path change
     - the previous start on that Provider failed
     - the user explicitly asks for a re-check (the existing "重新检查" actions)
     - the Host just started and has no result yet
   - A missing or unreadable executable must still be detected on the next send. A cheap `stat` is fine; a full hash is not.
   - A file replaced with the same size and modification time going undetected is accepted (Owner decision).
2. **Run at most one check for create plus first send.**
   - Creating a conversation and sending its first message must not run the check twice.
   - After this task, a send on an unchanged installation runs no hash and no probe at all.
3. **Keep the safety properties.**
   - The full check still guards against an installation changing between probe and execution (the "stable observation" before/after fingerprint).
   - Execution-ownership uncertainty still latches as it does now.
   - The per-Provider in-flight coalescing stays.
   - Failure classification and execution-health records are unchanged.
   - Remote computers are not affected.
4. **Optimistic send on the desktop** (03 B3, first bullet).
   - When the user sends, the message appears in the conversation immediately.
   - The "正在发送消息" gate card goes away; it comes from `conversation-gate-presentation.ts`.
   - If the start fails:
     - the message is marked "未发送 · 重试"
     - the text goes back into the Composer
     - the failure reason is shown with the existing presentation
   - Retry is an explicit user action with a fresh `actionId`. Nothing is resent automatically.
   - A failure known to be uncertain must not offer Retry, under the existing Phase 6D rules.
5. **Measure it.** Measure the time from clicking send to the Host accepting the Turn on this machine's real Codex:
   - before and after
   - for a first send in a new conversation and for a follow-up send
   - for the create step itself

   Use the median of at least 5 runs each.

**Should:**

6. **Verify the failure-reason fixes, and fix them if still broken.** 03 B3, second bullet, lists three problems:
   - Supervisor reporting Host errors as `internal`
   - a two-step create leaving an empty conversation when step two fails
   - `action.get` not finding a create's `actionId`

   `main` has since added `supervisorFailureFromError` (`packages/supervisor-transport/src/failure.ts`) and a durable create-action record (`getConversationCreateAction`). Confirm with tests that all three are resolved. Fix only what is still wrong.

7. **Small Composer fixes:**
   - Drafts stored under `composer-draft-<conversationId>` are never deleted. Remove a draft when its conversation is archived, or when it is older than 30 days at startup.
   - `writeComposerSendShortcut` has no try/catch, so a storage failure throws. Make it tolerate unavailable storage.

## Known facts

All line numbers refer to `main` at `4801ef1`; they will have moved after the D2 merge.

- **The refresh.** `#refreshLocalProviderForExplicitStart` (`apps/host/src/api/host-service.ts:7182`) is called from:
  - `createConversation` (call at `:3438`)
  - `startTurn` (call at `:3842`)
  - `discoverLocalProvidersOnStartup`, `refreshMachineProviders` and `selectMachineProviderInstallation` (`:1456`, `:1490`, `:1631`)

  It returns early only when the Provider has an active Turn.

- **The hashing.** `local-provider-lifecycle-coordinator.ts` `#stableCodexObservation` (around line 650) calls `fingerprintCodexInstallation` before and after the observation (`:655`, `:667`). That function (`packages/adapter-codex/src/installation.ts:163`) hashes the entire executable with SHA-256. `packages/adapter-codex/src/compatibility.ts:159` also fingerprints.
- **The cost.** The Owner measured about 2 seconds per send on this machine. A new conversation pays it twice: once at create, once at the first Turn.
- **Where new code goes.** `host-service.ts` is about 10,000 lines. Put the readiness cache in its own module next to the lifecycle coordinator, not inside `HostService` (AD-10).
- **Other devices.** The tablet and iPad align their send UI in T1b and I1. This task changes only the desktop web UI and the Host.

## Boundaries

- **Decide yourself:**
  - the cache's shape and module
  - how the web keeps the optimistic message (TanStack Query state; never Zustand or storage for Host-owned records)
  - test design
  - commit splitting
- **Ask the Owner first:**
  - changing Protocol v1 or Supervisor wire shapes
  - adding a migration
  - weakening any check listed in goal 3
  - replacing the installed desktop build
- **Do not:**
  - add automatic resend
  - cache across Host restarts
  - edit `AGENTS.md` or `docs/`
  - force-push, merge to `main`, or tag
  - read or print credentials

Push `feat/b3a-send-speed` to `origin`.

## Report

Write to `D:/Projects/Software/agenthub-archive/b3a-send-speed-report.md`:

- **Cache:** the design; when a full check runs, with the test for each case.
- **Create plus first send:** how the double check was removed.
- **Safety:** each property in goal 3 and the test that keeps it.
- **Optimistic send:** the behavior; screenshots of sending, failed ("未发送 · 重试") and retried.
- **Measurements:** before and after, as medians, with the raw numbers.
- **Goal 6:** what was already fixed, and what you changed.
- **Composer fixes:** the draft cleanup and storage hardening.
- **Gate results:** with any failures verbatim.
- **Commits:** your commits and the pushed remote commit.
- **Docs:** documentation changes you think are needed.
- **Status:** anything left undone and why, and which completion level the work reached.

# Task: B3a Send Speed (Desktop)

**Where it runs.** On Windows. The slow path is the real, roughly 333 MB `codex.exe` on this machine, so measure there.

- Never stop, replace or reconfigure the installed app or its Host on `127.0.0.1:4317`. Measure "before" and "after" on development builds, each with its own Host port, `CODETETHER_DATA_DIR` and database.
- Another task may be running on this computer. Take timing samples only while no other build or test runs, and record the system load as W0b did.

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

   Also measure a follow-up send in an existing conversation after the app restarts (a cold resume).

   Before changing anything, break the "before" time down by stage:
   - the lifecycle check
   - starting the App Server and the thread, or resuming it
   - the model-list refresh that task 5 runs when a conversation opens, if it overlaps the send
   - the Host's write
   - the UI drawing your message

   W0 and W0b measured far more than two 2-second checks (see Known facts), so find where the rest goes. Fix what is in this task's scope. List any other large stage in the report with its cause; do not fix it here.

6. **An empty conversation survives a restart** (W0-18).
   - **Today:** W0b created a conversation and sent nothing, quit through the tray, started the app again, then sent the first message. The Turn failed within about 8 seconds as `provider_session_lost`, marked not retryable. Codex had never written the thread (`materialized=0`), so resuming it found nothing.
   - **Change:** the first send in such a conversation works. Choose one of two ways and explain the choice:
     - start the native session at the first send instead of at create. This may also remove most of the create time in goal 5.
     - at the first send, start a new native session when the Host can prove that the conversation has no Turns and its native session was never written.
   - **Rules:**
     - A conversation with any Turn keeps today's rule: it resumes its own native session or fails as it does now. A native session with history is never replaced.
     - The Provider, the Machine and the project stay the same.
     - The model shown before the first send stays truthful (task 5, goal 7). If the native session now starts later, the model shown is the conversation's chosen model or the Provider catalog's default, never a guess.
     - This prompt authorizes replacing the native-session binding of a conversation that has no Turns. Nothing else about native-session bindings changes.
   - **Tests:**
     - create, restart the Host, then the first send succeeds; use a fake runtime whose resume of an unwritten thread fails
     - a conversation with one Turn still fails as today when its native session is lost
   - **Real device:** repeat W0b's sequence on a development build: create, quit normally, relaunch, first send.

**Should:**

7. **Verify the failure-reason fixes, and fix them if still broken.** 03 B3, second bullet, lists three problems:
   - Supervisor reporting Host errors as `internal`
   - a two-step create leaving an empty conversation when step two fails
   - `action.get` not finding a create's `actionId`

   `main` has since added `supervisorFailureFromError` (`packages/supervisor-transport/src/failure.ts`) and a durable create-action record (`getConversationCreateAction`). Confirm with tests that all three are resolved. Fix only what is still wrong.

8. **Small Composer fixes:**
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
- **W0's baseline** (installed alpha.3, 2026-11-17, timed from the window; `D:/Projects/Software/agenthub-archive/w0-windows-desktop-audit-report.md`, finding W0-02):
  - creating a conversation, until the editor is usable: 13.95 and 14.60 seconds
  - first send until your own message appears: median 7.49 seconds (6.83, 7.49, 7.70)
  - those Turns failed on the model (W0-01), so the time to a finished Turn is not a baseline
- **W0b's numbers** (installed alpha.3, 2026-11-18, working Turns, timed from the window, samples taken only while no build or test ran; `D:/Projects/Software/agenthub-archive/w0b-windows-desktop-audit-report.md`, "计时和系统负载"). These are newer than W0's; use them as the baseline.

  | Measure                                             | Samples                                                                                             |  Median |
  | --------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------: |
  | Create, until the editor is usable                  | one sample                                                                                          | 10.50 s |
  | First send, until your own message appears          | 6.51, 6.29, 6.99 s                                                                                  |  6.51 s |
  | First send, until the Turn ends                     | 25.64, 22.28, 12.54 s                                                                               | 22.28 s |
  | Follow-up send, until your own message appears      | 11.71 s after a native import, 0.57 s while another Codex Turn was running, 17.15 s after a restart | 11.71 s |
  | Approval click, until the UI shows it running again | 418.6, 445.4, 438.4 ms                                                                              |  438 ms |

  The 0.57-second sample matters. `#refreshLocalProviderForExplicitStart` returns early while the Provider has an active Turn, so that send skipped the lifecycle check. This suggests the check dominates a warm send, and that the two slow follow-ups add the cost of resuming the native session cold.

- **W0-18's code** (line numbers at `0bf8cba`):
  - `apps/host/src/api/host-service.ts:5421` chooses between starting and resuming a native session.
  - `apps/host/src/api/codex-host-runtime.ts:455` calls `thread/resume` on the local path, and `:474` maps its failure to "native session unavailable".
  - `packages/agent-core/src/failures.ts:207` makes that failure not retryable.
  - Evidence: `w0b-windows-desktop-audit/measurements/w0b-first-after-restart-failure.json`.
- **Task 5's model list.** Task 5 refreshes the model list once when a local conversation opens (`use-live-conversation-controls.ts`); for Codex that calls the App Server's `model/list`.
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
- **Empty conversation:** the approach chosen for goal 6, its tests, and the real-device sequence.
- **Goal 7:** what was already fixed, and what you changed.
- **Composer fixes:** the draft cleanup and storage hardening.
- **Gate results:** with any failures verbatim.
- **Commits:** your commits and the pushed remote commit.
- **Docs:** documentation changes you think are needed.
- **Status:** anything left undone and why, and which completion level the work reached.

# Review: `feat/b3a-send-speed` (2026-11-18)

**Branch.** Pushed at `25ea943`. Base `3a97f6f` (`main` after task 5). Task prompt: `b3a-send-speed-prompt.md`. Report: `D:/Projects/Software/agenthub-archive/b3a-send-speed-report.md`.

- `d75c272` changes the Host and the Codex adapter: the readiness cache, the empty-conversation recovery, and the Supervisor create rollback.
- `25ea943` changes the desktop web UI: optimistic send, the draft cleanup and the storage hardening.

**Gates (as reported, not re-run in this review):**

- typecheck, lint and build passed
- `pnpm test`: 2,520 passed, 14 skipped, 0 failed
- Prettier passed on the 35 changed files. The repository-wide check reports 55 untouched files (with automatic line endings); those belong to the postponed hygiene task.

**Verdict.** Accepted, no must-fix.

## Results

Medians of five runs each, timed on this Windows computer with real Codex and isolated development builds:

| Operation                 | Host accepts it, before |  After | Your message appears, after |
| ------------------------- | ----------------------: | -----: | --------------------------: |
| Create a conversation     |                  7.49 s | 4.11 s |                           — |
| First send                |                  6.40 s |  40 ms |                       12 ms |
| Follow-up send            |                  6.91 s | 525 ms |                       12 ms |
| Follow-up after a restart |                 12.35 s | 713 ms |                       15 ms |

After the change, all 20 measured creates and sends used the cached check. None ran a full check or a probe.

## Checked in this review

- **Scope.** The diff against `main` changes nothing under `docs/`, `AGENTS.md`, `packages/protocol`, the Supervisor or Machine transports, or the migrations.
- **The cache has its own module** (`apps/host/src/api/local-provider-readiness.ts`, AD-10).
  - It is keyed by the installation's path, size and modification time.
  - A full check runs when that key changes, when the file cannot be read, after a failed start, on an explicit re-check, and when the Host has just started.
  - The before-and-after fingerprint around a full check stays.
- **The empty conversation after a restart (W0-18)** uses the second approach in goal 6: replace the native session only when it provably never existed.
  - The adapter recognizes the exact case: `thread/resume`, JSON-RPC code `-32600`, and a message that starts with "no rollout found for thread id". The native error text is not stored.
  - The store replaces the binding only when all of these hold: a local Codex conversation created in CodeTether, not archived, never written by Codex, with exactly one Turn, still starting and not yet acknowledged, and the old binding still matches.
  - The new binding is saved before the prompt is sent. A conversation with history keeps today's rule, and a test proves it.
- **The two-step Supervisor create** now rolls back only the empty conversation that the same action created, when the first Turn fails before it is admitted. An existing conversation, or one with an admitted Turn, is never removed. This is the fix goal 7 asked for, not a general delete.
- **Merging.** The branch merges into `main` without conflicts, and also merges cleanly with `fix/w0-11-windows-sandbox`.

## Carried items (not blocking)

1. **Creating a conversation still takes about 4 seconds.** Codex's App Server start plus `thread/start` take a median of 3.42 s, and up to 8.4 s. Before this change, that cost was hidden inside the full check. A later step could start the App Server in the background, when the Host starts or when the New Conversation dialog opens. Not scheduled; decide after the Owner has used alpha.4.
2. **A follow-up send still takes about 0.5 s on the Host.** About 465 ms of it passes before the cache is consulted, and the current timing marks cannot attribute it. Your own message already appears after about 12 ms, so the user does not wait for it.
3. **Two of the five cold resumes took about 7 s,** inside Codex's `thread/resume`. That is on Codex's side.
4. **A misleading message in a rare case.** While another conversation's Turn runs on the same AI tool, a start that misses the cache returns `conversation_busy`. A miss there only happens after the installation changed or a start failed. Refusing is safe, but the message says that this conversation is busy, which is not true. Fix it when failure wording is next touched.
5. **The desktop shell was not retested.** The Tauri shell always uses port `4317`, so the agent could not run it without touching the installed app. It measured the same web build in a browser instead. alpha.4 acceptance covers the shell and the tray.
   - **Backlog:** a development-only port for the desktop shell, so agents can test tray flows safely.

## Docs

Applied on `ux/design` with this review: the ROADMAP B3 row, and ARCHITECTURE's Provider lifecycle section.

## Next

Merged into `main` on 2026-11-18 (`8bedb8b`), with the Owner's approval.

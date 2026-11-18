# Task: Integrate D2 Model Control (Desktop, Remote Computers, Tablet)

**Where it runs.** On whichever computer is free first and has the Android toolchain (Gradle, the NDK and the Rust targets the Android build uses). If that is Windows, the Owner relays an iOS build check to the Mac (goal 6).

**Branch and worktree.** Start from the current `origin/main` after `fix/w0-local-execution` has merged (fetch first). That branch adds the `provider_model_unavailable` failure that goal 7 builds on. If you started before it merged, merge `main` into your branch. Create branch `feat/d2-model-control` in worktree `<agenthub-work>/feat-d2-model-control`.

**Why this task exists.** Two branches implement the same feature. This task produces the single version to merge and makes both old branches obsolete (AD-1).

**References** (read with `git show origin/ux/design:<path>`):

- `docs/reviews/2026-11-13-assessment-and-plan.md` AD-1, AD-2, AD-7
- `docs/reviews/d2-protocol-model-switching-prompt.md` and `docs/reviews/d2-remote-model-switching-prompt.md` (the two original prompts)
- `docs/ux-redesign/10-desktop-improvements.md` §3.3 (Composer; AD-2 as revised on 2026-11-14)
- `docs/ux-redesign/08-remote-management.md` §3.1 (rules for extending Supervisor operations)
- `docs/ux-redesign/03-project-plan.md` §6 (invariants)

Before starting, confirm this file has 4 second-level headings and that the last one is "Report".

## Goals

**Must:**

1. **Bring in the canonical implementation.**
   - Merge `origin/feat/d2-model-switching` (`f1f6f8c`) into the new branch with a merge commit. Do not rebase or cherry-pick it apart.
   - It was branched from `b668e53`, before B4a and U1, so expect conflicts. Resolve them in favor of `main`'s B4a/U1 behavior plus this branch's model control. In particular, keep `main`'s stabilized Relay rate-limit test (`7616956`) over this branch's version (`c9ba712`).
2. **Port only the unique parts of the remote-only branch.**
   - From `origin/feat/d2-remote-model-switching`, bring over only what `feat/d2-model-switching` lacks:
     - the mobile layer in `183c534`: the Rust `conversation_update_model` / model-refresh UniFFI functions and wire types in `packages/supervisor-mobile`, their interop tests, and the Android Kotlin `RemoteModels`, `RemoteProjection` and `RemoteSupervisor` changes with their instrumented tests
     - the `machine.get` model-list cap from `bec19e3` in `apps/host/src/api/supervisor-machine-reads.ts`: at most 50 models per Provider, plus the byte-budget fallback
   - Do **not** bring over its host-side model logic (`485e3b3`, and the rest of `bec19e3`). It duplicates the canonical branch with less protection.
   - When the two disagree on a wire field or operation shape, the canonical branch wins. Adapt the Rust and Kotlin layers to it, and keep the interop test proving that TypeScript and Rust agree.
3. **No docs on the code branch** (AD-7).
   - The integrated branch's diff against `main` must not change `AGENTS.md` or anything under `docs/`.
   - The canonical branch edited AGENTS.md, ARCHITECTURE, PRODUCT, ROADMAP and 03. Leave those edits out, and paste their substance into the report; Claude Code will apply it on the docs branch.
4. **Replace the model placeholder** (AD-2, revised 2026-11-14).
   - In `apps/web/src/components/conversation/composer.tsx`, the disabled "模型" button (title "模型切换功能开发中") is replaced by the real model control from goal 1. Update the tests that asserted it.
   - Leave the "附件" and "语音" buttons and the "剩余上下文" label as they are. The Owner wants those features built, not removed. Tasks X1a, X1b and X1c replace each one with a working control (AD-12).
5. **Behavior to verify, end to end.** A change applies to the **next** Turn of the same conversation only:
   - The Provider, the Machine, the native session, and earlier Turns never change.
   - A change during an active Turn is refused with `409`, including a Turn admitted while the model catalog was being fetched.
   - Archived conversations refuse both the change and the catalog refresh.
   - The Supervisor operations require control permission and are idempotent by `actionId`.
   - `conversation.updated` carries the new selection to every client.
6. **Quality gate:**
   - `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test` and `pnpm format:check` for the files you changed
   - `cargo test` in `packages/supervisor-mobile`
   - the Android gate: `testDebugUnitTest lint assembleDebug assembleDebugAndroidTest`
   - the iOS app (merged in alpha.3) shares the Rust core, so `apps/ios/Scripts/build.sh` must still pass. Run it yourself on the Mac, or ask the Owner to relay it from Windows.
7. **Models the account cannot use** (W0, added 2026-11-18). W0 found that a conversation can store a model the account cannot use, and then every Turn fails. See Known facts. The desktop must make this visible and easy to fix:
   - **In the model control:** when a conversation's current model is not in the Provider's catalog, say so ("不在此账号的可用模型中") and let the user choose another before sending. Do not hide it, and do not replace it silently.
   - **For a new conversation:** the user can see which model it will use before the first send, with the same warning when that model is not in the catalog. Do not override the Provider's own default configuration.
   - **After a `provider_model_unavailable` failure:** the failure card's action opens the model control instead of "view details". Choosing a model and sending again uses the new model for that Turn. Nothing is resent automatically.
   - **Tests:** a fake catalog plus the exact App Server rejection used by `fix/w0-local-execution`'s classifier tests.
   - A catalog that cannot be read is not evidence that a model is unavailable. In that case, show no warning.

**Should:**

8. **Real-device checks** on this computer's installed CLIs, with a development build; do not replace the installed app:
   - switch the model on a local Codex conversation
   - switch the reasoning effort on a local Claude Code conversation
   - if a paired remote computer is reachable, switch the model on a conversation there
   - record what the Turn actually ran with
   - on Windows, if possible: a conversation storing a model the account cannot use fails with "所选模型不可用", and switching the model makes the next Turn succeed (goal 7)
9. **Tablet check.** On the Android emulator, connected to this computer's Host, change the model through the tablet and see the desktop update.

## Known facts

- **`feat/d2-model-switching`** at `f1f6f8c`: 7 commits, 91 files, +4087/−201. It provides:
  - Protocol v1 `PATCH /api/v1/conversations/:id/model` and a models-refresh route
  - migration 026 `conversation_model_switching`: `current_model` and `current_reasoning`, backfilled for local conversations
  - `ProviderDescriptor.availableModels`
  - a Node transport request `provider.models.list` (Codex reads its catalog from the App Server; Claude Code exposes fixed aliases)
  - Supervisor operations `conversation.updateModel` and `conversation.models.refresh`
  - the desktop Composer model control and the web remote-supervisor routes

  Its host code re-checks for an active Turn after awaiting the catalog. Its Prettier formatting is incomplete.

- **`feat/d2-remote-model-switching`** at `183c534`: 3 commits on `4801ef1`, 59 files. Its migration 026 is byte-identical to the canonical one. Its host code is a reduced copy of the canonical branch's:
  - it refuses remote computers with `operation_not_allowed`
  - it has no re-check for a Turn admitted during the catalog fetch
  - its refresh has no archived check
- **Overlap.** The two branches change 50 of the same files. Most conflicts will be in:
  - `host-service.ts`, `conversation-store.ts`, `supervisor-transport-manager.ts`
  - `packages/protocol`, `packages/supervisor-transport`
  - the persistence test fixtures
- **Migrations.** `main`'s latest migration is 25, so 026 stays 026. Neither the alpha.3 release nor B4a added a migration.
- **Line numbers.** `host-service.ts` is over 10,000 lines. If your merge adds a self-contained model-catalog helper there, you may move it into its own module (AD-10). Do not refactor anything else.
- **Rust interop test.** `cargo test` in `packages/supervisor-mobile` runs `tests/interop.rs` against `tests/interop-fixture.mjs`. It is the only automatic check that the TypeScript and Rust encodings match.
- **W0's model failure** (`D:/Projects/Software/agenthub-archive/w0-windows-desktop-audit-report.md`, "W0 诊断"):
  - The Owner's Codex configuration chose a model that this account's catalog does not list. Both the CLI and the App Server rejected it with `model_not_found`, and the same Turn succeeded with a listed model.
  - alpha.3 creates a local conversation without a model, stores the model the App Server returns, and sends that stored model with every Turn. So every Turn of those conversations failed, and the user could not change the model.
  - `fix/w0-local-execution` (`19d634f`) classifies that exact rejection as `provider_model_unavailable` ("所选模型不可用") and keeps the Provider's execution health intact. Remote computers still report it as `provider_error`, because the frozen machine-transport reason list is unchanged. Keep it that way here.

## Boundaries

- **Decide yourself:**
  - conflict resolution within the rules above
  - how to adapt the Rust and Kotlin code to the canonical wire shape
  - test changes
  - commit splitting after the merge commit
- **Ask the Owner first:**
  - a protocol shape that differs from both branches
  - a second migration
  - any change to the frozen Claude Code restrictions beyond model and effort selection
  - replacing an installed desktop, tablet or iPad build
  - pushing `main`
- **Do not:**
  - edit `AGENTS.md` or `docs/`
  - delete either old branch (the Owner does that after merge)
  - force-push, merge to `main`, or tag
  - read or print credentials

Push `feat/d2-model-control` to `origin`.

## Report

Write to `<agenthub-archive>/d2-model-control-report.md`:

- **Merge:** the merge commit; each conflict and how you resolved it.
- **Ported:** exactly what came from the remote-only branch (files and hunks) and what you left out.
- **Docs:** the doc edits from the canonical branch that you left out, quoted, for the docs branch.
- **Placeholders:** the model placeholder replaced, the tests updated, and confirmation that the other three were left in place.
- **Behavior:** the goal 5 checks, each with the test that proves it.
- **Unavailable models:** goal 7, each case with its test and a screenshot of the warning and of the failure card's action.
- **Gates:** results for every gate (TypeScript, Rust, Android, iOS), with failures verbatim.
- **Devices:** real-device and emulator results, if done.
- **Commits:** your commits and the pushed remote commit.
- **Status:** anything left undone and why, and which completion level the work reached.

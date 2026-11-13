# Task: I1 iPad Fixes (Round 5)

**Where it runs.** On the Mac.

**Branch.** Continue on `i1/ipad-app`, currently at `3084164`. Change only `apps/ios`. Commit and push to `i1/ipad-app`.

**Scope.** This round is deliberately narrow:

- one must-fix and two should-fix items from the r4 review
- no fidelity or feature work

**Why a fifth round.** It goes past the two-round limit (AD-11 in `docs/reviews/2026-11-13-assessment-and-plan.md`). The Owner approves dispatching it.

**References** (read with `git show origin/ux/design:<path>`):

- `docs/reviews/i1-ipad-app.md`, section "r4 (`3084164`, reviewed 2026-11-13)"
- `docs/reviews/i1-fix-prompt-r4.md`, item 8 (failures from background work never raise alerts)

Before starting, confirm this file has 4 second-level headings and that the last one is "Report".

## Goals

**Must:**

1. **No repeated alert while restoring offline.**
   - An iPad launched without network must not show the "操作未完成" alert again every 10 seconds while it retries the session restore.
   - Retried restores, triggered from foreground polling, report their state inline on the screen the user sees, for example a notice on the sign-in or Home screen. The notice clears when a restore succeeds.
   - At most the first, launch-time failure may raise the alert.
   - Restore must still retry, and must still stop retrying once the user starts an explicit sign-in.
   - An expired session (`signInRequired`) still signs out as it does now.
   - Add a test using the real `TabletAppModel` with a fake account service:
     - restore fails with a network error several times, then succeeds
     - `errorMessage` is set at most once
     - the app ends up authenticated

**Should:**

2. **Register project targets only for devices that were read successfully.** In `readWorkspace`, register a device's `projectTargets` only after all of that device's reads succeed. A device shown as unavailable must leave no targets behind.
3. **Keep uncertain sends across session expiry for the same account.**
   - When the session expires (not an explicit sign-out), keep `pendingActions` whose outcome is uncertain, keyed by account ID.
   - When the same account signs in again, show them again with the existing "使用原请求重试" control.
   - Drop them on explicit sign-out, or when a different account signs in.
   - Nothing is resent automatically.
   - Add a test for each case.
4. **Fix the indentation** of the misaligned line in `loadConversation`'s catch block (`AppModel.swift:536`).

## Known facts

- `taskDidStart()` starts polling at launch, before sign-in (`AppModel.swift:193-195`).
- `pollForeground()` calls `start()` every 10 seconds while `bootstrapped` is false (`AppModel.swift:871-873`).
- `start()` ends a failure in `show(error)`. `errorMessage` is presented as an alert (`TabletViews.swift:376-382`).
- `expireAccountSession()` currently clears `pendingActions` and `conversationDrafts` along with everything else.
- The uncertain/definite classification of write failures is settled and shared with Android; it must not change:
  - definite: `invalid_request`, `not_found`, `conflict`, `operation_not_allowed`, `unsupported`
  - everything else is uncertain
- Tests must go through `TabletAppModel` and `SupervisorClient` with fake connections, as in r4.

## Boundaries

- **Decide yourself:**
  - where the inline restore notice appears and its wording, which follows 06 §1: no technical terms
  - how uncertain actions are stored per account (in memory or in the existing local store)
  - test design
  - commit splitting
- **Ask the Owner first:**
  - any change outside `apps/ios`
  - any change to the failure classification
  - showing something that is not in the prototype
- **Do not:**
  - push `main`, merge or tag
  - force-push
  - read or print credentials

## Report

Append a new section "r5 fixes" to `~/agenthub-archive/i1-report.md`:

- **Per item:** what changed and in which commit, plus the pushed remote commit.
- **Item 1:** the test and its result; a screenshot of the inline notice in Airplane Mode on the simulator or the iPad.
- **Items 2 and 3:** the tests and their results.
- **Gates:** the result of `apps/ios/Scripts/test.sh` and `apps/ios/Scripts/build.sh device`, with any failures pasted verbatim.
- **Status:** anything left undone and why, and which completion level the work reached.

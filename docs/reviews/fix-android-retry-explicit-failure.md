# Review record. fix/android-retry-explicit-failure

Date 2026-11-07. Reviewed `aeac893` on `origin/fix/android-retry-explicit-failure` against `e4bdd57`, five files, all in `apps/android`. Task is `docs/reviews/android-retry-explicit-failure-fix-prompt.md`. Execution report is "Definitive retry failure fix" in `D:/Projects/Software/agenthub-archive/t1a-report.md`.

## Round 1

Conclusion. No required changes. Ready to merge or to serve as the base for tablet fixes.

Verified without issues.

- **Correct root cause.** The old exception branch in `TabletController.executeMutation` used `retrying || …`, returning every retry failure to `Unknown`. It now calls `RemoteSupervisor.isUncertainMutationFailure(failure, retrying)`. Only an explicit rejection of the write request itself inside `RemoteSupervisor.mutate` (or a Rust pre-send check failure) receives `definitiveMutationFailure`.
- **`action.get` `not_found` is classified correctly.** Pre-retry reads throw `RemoteFailure("not_found")` without this marker, so the retry remains uncertain. `actionNotFoundAndUncertainRetriesKeepTheOriginalSendUntilOneSuccess` specifically covers this and asserts only one logical execution throughout.
- **Both paths and process recovery are covered.** Compose tests cover definitive send and creation failures, and controller tests cover definitive failure after serialization/restoration.
- **Recovery after definitive failure.** Clear pending confirmation, show the reason, preserve draft and create form, and use a new actionId on resubmission. Tests assert distinct `actionId` values.
- **Refresh.** Read the original conversation or project once after failure (`refreshRejectedMutation`), only in foreground with the same client. `outcome` now reports whether the result was actually recorded, avoiding refresh after the pending action was replaced.

Suggested changes (nonblocking).

1. **Two codes were silently added to `uncertainErrors`.** `protocol_error` and `unavailable`. `protocol_error` is reasonable and matches iPad round 2. `unavailable` changes behavior. Previously an initial `unavailable` was failure, now pending confirmation.
   - The conservative rationale is valid. Host maps cases such as `machine_unreachable` to `unavailable`, including writes that may already have reached the peer. Treating these as failed may lead to duplicate prompts.
   - Record the cost too. Host deduplication caches failures (`apps/host/src/api/action-idempotency-cache.ts`), including pre-execution failures such as `runtime_unavailable`. Retrying the same actionId only returns the same error, leaving the user to abandon pending confirmation and resubmit.
   - Decision. Align both platforms with Android's current classification. The iPad round-4 prompt now states this. The fundamental Host fix is to avoid caching transient pre-execution failures, tracked under B3.
   - The report did not explain these additions. Document the rationale for future classification changes.
2. **`internal` remains uncertain.** This matches the agreement, but Host currently uses `internal` for all unclassified errors, including pre-execution failures. Revisit the classification when B4a failure reasons (`data.reason`) let clients distinguish more cases.
3. The report only says "Real controller and Compose paths covered" without naming tests. I reviewed the added and changed test code. Coverage matches the description, but I did not check assertions one by one.

## Follow-up

This branch is linear. Create `fix/t1a-tablet-fidelity` on top. At release, fast-forward in order through `fd1d905`, `e4bdd57`, this branch, and `fix/t1a-tablet-fidelity`.

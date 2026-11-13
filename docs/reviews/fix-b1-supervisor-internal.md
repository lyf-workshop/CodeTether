# Review record. fix/b1-supervisor-internal

Date 2026-11-07. Reviewed `origin/fix/b1-supervisor-internal` (`46f2e81`, `fd1d905`) against `b668e53` on `main`. Task is `docs/reviews/b1-supervisor-internal-fix-prompt.md`. Execution report is `D:/Projects/Software/agenthub-archive/b1-supervisor-internal-report.md`.

## Round 1

Conclusion. No required changes. Ready to merge. The suggestions below belong in later tasks and do not block merging.

Review scope covered transport (`server.ts`, `constants.ts`), budgets (`supervisor-read-budget.ts`, `supervisor-machine-reads.ts`), two persistence directory queries and history pagination, and remote history/live reads in `host-service.ts`. Only identity-field sections of `supervisor-transcript-budget.ts` were reviewed. Test scope was reviewed without checking every test.

Verified without issues.

- Read response sizes are calculated before sending for the complete frame including envelope. Over 16 KiB records `supervisor.read.frame_too_large` and fails before sending. `supervisorTransportLimits.maximumFrameBytes` now references machine-transport's 16 KiB value, used only by `server.ts` throughout the repository.
- Diagnostics include only operation, transport, bytes, error code, and exception class (`supervisorReadErrorFields` in `server.ts`), without content.
- `machine.get` no longer forwards `providerLifecycles`. Android, iPad, and desktop remote reads do not consume it.
- Project and conversation directories derive cursors from the last actually returned row, and `hasMore` from actual returned counts, preventing skips and duplication. The project cursor's `updatedAt` is the `sort_at` ordering key (`supervisorProjectDirectoryItemFromRow`).
- Desktop parsers for the new `truncated` field (`remote-supervisor.ts:965`, `:1004`) validate individual fields, tolerating an extra field.
- Persistence changes affect reads only, with no migrations or database writes. `readDurableConversationHistoryPage` is called only by remote history (`host-service.ts:2079`, `:2193`), leaving local UI history unaffected.
- Live reads return `resetRequired: true` if even the first event cannot fit. Android (`RemoteProjection.kt:216`) and iPad (`SupervisorClient.swift:255`) both handle it.

Suggested changes.

1. **Writes lack a pre-send check** (`server.ts` skips control operations when calculating `responseBytes`). Oversized write responses still become `internal` without diagnostics. Resending the same actionId returns the same oversized result forever as "Result uncertain". At least add diagnostics and tests asserting bounded write responses.
2. **Clients cannot detect truncated machine lists or reasoning options.** `supervisorMachineList` and `supervisorMachineDetail` use a `Symbol` marker excluded from JSON because some clients strictly validate machine data. When machines exceed 12 KiB, some disappear without explanation. Track the limitation, then tolerate extra fields in those clients before adding JSON indicators.
3. **Imported native conversations on Node-connected computers read one history record at a time** (`host-service.ts` fixes remote nonlocal native-history `limit` at 1). Results are correct, but paging backward one record at a time is slow. Check the experience during device retesting.
4. **Truncated entries lose `terminal.itemId`** (`supervisor-transcript-budget.ts:153-156`). Truncated diff text (:225) only receives an ellipsis without a separate indicator. Clients may display truncated diffs as complete. Inspect the changes panel during physical-device retesting.

## Follow-up

With user approval, merge to `main`, update installed Mac and Windows builds to the new `main`, and retest iPad and Android. Record results in this review's "Acceptance" section.

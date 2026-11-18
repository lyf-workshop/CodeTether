# Review: `feat/d2-model-control` (2026-11-18)

**Branch.** Pushed at `cfeecbf`. Base `9cb3e5b` (`main` after W0a). Task prompt: `d2-model-control-integration-prompt.md`. Report: `D:/Projects/Software/agenthub-archive/d2-model-control-report.md`.

- `78f2043` merges `origin/feat/d2-model-switching` (`f1f6f8c`). Its parents are `9cb3e5b` and `f1f6f8c`, so it is a real merge, not a rebase.
- `cfeecbf` adds the Windows recovery behavior (goal 7), the conflict corrections, the `machine.get` cap, formatting and regression tests.

**Gates (as reported, not re-run in this review):**

- typecheck, lint and build passed
- `pnpm test`: 2,504 passed, 14 skipped, 0 failed
- Prettier passed on the 90 changed files
- `cargo test` in `packages/supervisor-mobile`: 8 unit tests and 4 interop tests passed
- Android gate: `BUILD SUCCESSFUL`

**Verdict.** Accepted, with one must-fix before the merge into `main`.

## Checked in this review

- **No docs on the code branch.** The diff against `main` changes nothing under `AGENTS.md` or `docs/`.
- **No new protocol shape.** In `cfeecbf`, the changes to `packages/protocol` and to the Supervisor protocol are formatting only. Ignoring whitespace, they come to 12 lines, with no change to the schemas.
- **Only the cap came from the remote-only branch.**
  - `supervisor-machine-reads.ts` caps each Provider at 50 models and falls back to a compact response within the frame budget.
  - When it truncates, the response carries `_truncated: true`. The Android app reads `machine.get` as untyped JSON, so the extra key is harmless to the phone already in use.
- **The placeholder is replaced.** The model button is now the real control. "附件", "语音" and "剩余上下文" are still in place, and a test asserts them.
- **The warning cannot fire on Claude Code aliases.** A local Claude Code conversation stores `opus`, `sonnet`, `haiku` or no model, and the catalog lists those same aliases.
- **The failure card.** It offers "选择可用模型" only for `provider_model_unavailable`. Remote computers still receive `provider_error` over the frozen wire, so they never show it.

## Must-fix: refresh the model list once per opened conversation

**Problem.**

- `cfeecbf` adds this effect to `use-live-conversation-controls.ts`:

  ```ts
  useEffect(() => {
    void refreshModels()
  }, [refreshModels])
  ```

- `refreshModels` depends on `capabilities.canCompose`. That value is false while a Turn runs or the event stream is disconnected (`conversation-controls.ts:187`). So the effect runs when a conversation opens, and again whenever a Turn ends or the stream reconnects.
- Each run calls `POST /api/v1/conversations/:id/models/refresh`:
  - for a local Codex conversation, the App Server's `model/list`
  - for a remote conversation, a request to the remote computer's Node
- Each run also clears the catalog first (`setModelCatalog(undefined)`). The warning disappears during the request and comes back afterwards, so it flickers after every Turn.

**Why it matters.**

- It reverses a rule the canonical branch wrote itself, in the ARCHITECTURE text quoted in the report: "ordinary Conversation reads never start a Provider process". Goal 7 needs one read when a conversation opens, not one after every Turn.
- It adds Provider traffic at the moments B3a measures: create, first send, and just after a Turn.
- Remote work is postponed, yet every opened remote conversation would now contact its computer.

**Change.**

- **Opening a local conversation:** refresh the list automatically once per opened conversation, and only when it can compose. Do not refresh again after a Turn ends or when the stream reconnects.
- **Remote conversations:** no automatic refresh. The explicit refresh when the picker opens stays as it is.
- **Opening the picker:** keeps its explicit refresh.
- **During a refresh:** keep showing the last catalog, so the warning does not flicker.
- **After a failed refresh:** show no warning. A catalog that cannot be read is still not evidence (goal 7).

**Tests:**

- one refresh when a local conversation opens
- none when a Turn ends, and none on reconnect
- none for a remote conversation
- opening the picker still refreshes
- the warning stays visible while the picker refreshes

**Optional, in the same round.** The failure card opens the picker by sending a synthetic `ArrowDown` key event to the trigger. The `Select` is already controlled (`open={modelOpen}`). Set that state and call the refresh directly instead.

## Carried to alpha.4 acceptance

- **Goal 7 on the installed app.**
  - Unarchive one of W0's scratch conversations that still stores `gpt-6.2-sol`. An archived conversation refuses both the change and the refresh, so it cannot show the warning.
  - Check that the warning appears, then use the failure card's action and switch to `gpt-6.1-sol`.
  - Check that the next Turn runs with `gpt-6.1-sol`.
- **No false warning on older conversations.** Open a Codex conversation and a Claude Code conversation that were created before alpha.4, including an imported one, and check that no warning appears.
- **Docs.** The report quotes the canonical branch's doc edits. Claude Code applies them on `ux/design` after the merge, with two changes:
  - the automatic refresh as fixed here
  - the Windows-only acceptance scope

## Next

1. **Round 2:** make the must-fix on the same branch and re-run the gates, then push.
2. **Review:** Claude Code reviews round 2.
3. **Merge:** merge into `main` with a merge commit, with the Owner's approval to push `main`. B3a then starts from that `main`.

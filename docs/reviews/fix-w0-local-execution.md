# Review: `fix/w0-local-execution` (2026-11-18)

**Branch.** Local only, not pushed. Base `0bf8cba` (`main`, the alpha.3 release). Two commits:

- `19d634f` fix(codex): report model rejection at the turn boundary
- `e648a3a` fix(windows): admit the verified Claude Code 2.1.327 runtime

**Origin.** The Owner had the W0 agent fix the two execution blockers that W0's diagnosis found (W0-01, W0-03). There was no separate task prompt; this review record stands in for it, and the scope document lists both under group A.

**Gates (as reported by the agent, not re-run in this review):** typecheck, lint, build, and format of the changed files passed. `pnpm test`: 2,474 passed, 14 skipped, 0 failed. Real-device check on this Windows computer: Claude Code `2.1.327` ran Read, Glob and Grep, and a restarted Host resumed the same session. That evidence is not yet in a report file.

**Verdict.** `19d634f` is accepted. `e648a3a` has one must-fix before merge.

## `19d634f`: rejected model (W0-01). Accepted

- **Narrow classifier.** It matches only App Server's exact `invalid_request_error` / `model_not_found` envelope inside `TurnError.message`, when `codexErrorInfo` is `other`. The message is capped at 4,096 characters, and the upstream body is never copied into CodeTether's error.
- **New reason.** `provider_model_unavailable` ("所选模型不可用"), retry after a user action. It does not mark the Provider's execution health as failed, so the next Turn with another model is not blocked. A Host test proves this.
- **Remote computers are unchanged.** The remote runner reports the new reason as `provider_error`, because the frozen machine-transport reason list is not extended.
- **The gap is task 5's to close.** The guidance tells the user to choose another model, but alpha.3 has no working model control. Task 5 goal 7 (added 2026-11-18) closes that gap: a warning in the model control, and a failure-card action that opens it. Nothing else needs to change here.

## `e648a3a`: Claude Code admission (W0-03). One must-fix

- **New-conversation reasons: accepted.** The disabled Claude Code option now says why: no installation, an unconfirmed installation, an incompatible runtime, missing capabilities, sign-in needed, misconfigured, or the service unavailable. This replaces the single "请在设备详情检查" line. D3a goals 1 and 2 must keep this wording when they align tool status across pages.
- **The restriction itself is unchanged.** Every Claude Code run still passes:
  - `--tools Read,Glob,Grep`
  - `--allowedTools Read,Glob,Grep`
  - `--permission-mode dontAsk`

  The normalizer still fails shell closed. Admission decides only whether CodeTether trusts this CLI's command-line contract. It never widens what Claude Code may do.

### Must-fix: replace the exact version with a floor

- **Problem.**
  - The change admits only `version === '2.1.327'`.
  - The native Claude Code installation updates itself. The tested list ends at `2.1.268`, and this computer already runs `2.1.327`.
  - The first update after this merge would block Claude Code again, with the same W0-03 symptom, probably before alpha.4 is installed.
- **Change.**
  - Keep every other condition as written:
    - the Windows local Host
    - a native launcher
    - a first-party backend
    - all other help-text checks passing
    - `Read` declared under `--tools`
  - Replace the exact version with: any `2.1.x` at or above `2.1.327`.
  - Such a version is admitted as `compatible_unverified`, never `verified`.
  - `2.2.0` and later, and anything below `2.1.327` that is not on the tested list, stay blocked until verified.
- **Tests.** Cover:
  - `2.1.326`: blocked
  - `2.1.327` and `2.1.400`: admitted as unverified
  - `2.2.0`: blocked
  - the same version on a non-Windows target: blocked
- **Not part of this fix:**
  - Adding versions to `CLAUDE_CODE_TESTED_VERSIONS`. That list means a full verification and stays as it is.
  - Making the rule apply on macOS. Mac acceptance resumes after the Windows focus (AD-13).

## Next steps for the branch

1. **Make the must-fix.** Re-run the gates. Then repeat the Windows real-device check with the CLI that is installed at that time.
2. **Write the report** to `D:/Projects/Software/agenthub-archive/w0-local-execution-report.md`:
   - the commits
   - the gates, with the test counts
   - the real-device evidence: the version, Read, Glob and Grep, and restart plus resume
   - how the development Host ran without disturbing the installed one
3. **Push** `fix/w0-local-execution` to `origin`.
4. **Merge** into `main` with a merge commit once the Owner approves pushing `main`. This is not a release, so there is no tag or version change. Task 5 then starts from that `main`.

No documentation changes are needed on the code branch. Claude Code updates group A and the task queue on `ux/design`.

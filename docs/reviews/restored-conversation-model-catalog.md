# Review: `codex/fix-restored-conversation-model-catalog` (2026-11-19)

**Branch.** Pushed at `7f24e03`. It starts from `main` at `6283aa0` (`v0.1.0-alpha.4`).

- **Authorization.** The alpha.4 release agent proposed the fix in `D:/Projects/Software/agenthub-archive/release-v0.1.0-alpha.4/acceptance-findings.md`. The Owner approved it as a separate fix with no release ("批准独立修复，暂不发布").
- **Report.** `D:/Projects/Software/agenthub-archive/fix-restored-conversation-model-catalog-report.md`, with evidence in `fix-restored-conversation-model-catalog/`.
- **Scope.** One commit with two files: `use-live-conversation-controls.ts` (14 changed lines) and `model-catalog-refresh.test.mjs` (10 new cases, 16 in all). No Host, Protocol, Rust, Android, docs or version change.

**Gates (as reported):**

- typecheck, lint and build passed
- `pnpm test`: 2,541 passed, 14 skipped, 0 failed
- Prettier and `git diff --check` passed on the two files
- The first focused run passed every assertion but exited with 1. A Radix timer fired after the test had restored Node's `Event`. The report quotes the error. The fix is in the test fixture only.

**Verdict.** Accepted, no must-fix.

- It merged into `main` on 2026-11-19 as `13fa6b8`, right after D2.5 (`9932e70`), and was released in alpha.5 on 2026-11-21 (`release-v0.1.0-alpha.5.md`). The installed app passed this check there.
- It fixes the one failed alpha.4 acceptance check in code. The installed check comes with alpha.5.
- The catalog refresh is removed from W0e.

## Checked in this review

- **The change matches the cause in the release review.** In alpha.4, the automatic catalog request was marked as started while the Host rejected it, and nothing retried after the restore. Now:
  - While a conversation is archived, the hook makes no catalog request, either automatically or from the picker. It clears the catalog, the loading state and the error, and it resets the one automatic request per opening.
  - After the restore, a local conversation requests the catalog once, automatically. A remote one still waits for the picker, as before.
  - Archiving drops a request that is still in flight. Its success, failure and cleanup each check their own token, so a late answer cannot overwrite a newer one.
- **Existing rules are kept.**
  - No automatic retry after a Turn completes, after a reconnect, or after an ordinary failed catalog read.
  - No automatic read for a remote or unknown computer.
  - The Host still rejects requests for archived conversations.
- **Tests re-run.** The 16 catalog tests pass in the branch's worktree: Node exits with 0 and reports no uncaught errors.
- **Merges.** `git merge-tree` is clean into `main` and into `feat/d2-5-timeline`. D2.5 does not touch either file.
- **Dev UI evidence.** The agent used an isolated Host on a copy of the pre-update backup with no credentials copied, plus the Vite dev UI.
  - Opening the archived W0 conversation made no catalog request.
  - "恢复会话" made exactly one.
  - The Composer then showed "gpt-6.2-sol 不在此账号的可用模型中" without the old archived error (`screenshots/04-stable-restored-warning.png`).
  - No Turn was sent, and the installed app was not changed.
  - In that screenshot the two remote computers read "身份验证失败". That is because their credentials were deliberately not copied; it is not a finding.

## Carried items

1. **Installed check at alpha.5.** For alpha.4 the check stays recorded as failed. alpha.5's acceptance repeats the restore on the installed app.
2. **`canCompose` ignores archiving.** The shared capability is true for an archived conversation. The archived state is enforced by the Composer's gate presentation and, now, by this hook. Nothing is wrong today, but any new code that relies on `canCompose` alone must add the archived check. If D3a or D3b changes the Composer gate, merge the two into one rule.
3. **Dev checks against real data need their own Host.** The installed Host accepts only the desktop origin; a dev port gets 403. So the agent started `startLocalCodexHost` on its own port, which supports the backlog item for a dev-only port.

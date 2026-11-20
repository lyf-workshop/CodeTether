# Review: release `v0.1.0-alpha.4` (2026-11-19)

**Release.** Task prompt: `release-alpha4-prompt.md`. Report: `D:/Projects/Software/agenthub-archive/release-v0.1.0-alpha.4-report.md`, with evidence in `release-v0.1.0-alpha.4/`.

**Verdict.** Released, and the first real one-click update worked. Acceptance passed in part: one confirmed defect and two checks not covered, listed below. Nothing was rewritten to pass a check, and the tag stands.

## What was done

- **W0d merge.** `fix/w0-small-fixes` at `27c759a` merged into `main` as `814cb50`, without conflicts. The gates passed on the merge commit, and `main` was pushed.
- **Release commit.** `6283aa0` sets the version to 0.1.0-alpha.4 and adds the Chinese `CHANGELOG.md` entry.
  - Seven files changed. Android stays at alpha.3.
  - The only new migration since alpha.3 is 026.
- **Remote state.** `main` and `release/v0.1.0-alpha.4` are both at `6283aa0`. The annotated tag `v0.1.0-alpha.4` (`717ee83`) points there too.
- **History.** Since alpha.3 there are exactly five first-parent merges: W0a, task 5, B3a, the W0-11 fix and W0d. D2.5 is not included.
- **Gates.** All passed:
  - pnpm: typecheck, lint, build, and test (2,531 passed, 14 skipped)
  - Rust: supervisor-mobile, the sidecar, and the desktop (83 + 3)
  - Android Gradle: BUILD SUCCESSFUL
  - Prettier on the changed files
  - A full-repository `pnpm format:check` was also run, beyond the gate. It fails on nine generated Android HTML files and on existing CRLF warnings. The report quotes the failure and does not count it as passed.
- **Signing.**
  - The Owner typed the password once. It is stored with DPAPI for the Owner's account.
  - The key was not opened, copied or regenerated.
  - The reusable scripts are `agenthub-archive/release-tools/build-signed.ps1` and `setup-signing.ps1`.
  - The first signed build signed correctly, but its own guard stopped on a line-ending change in `Cargo.toml`. The rebuild passed.
- **Build checks.**
  - Build `git-6283aa0e1ab9`.
  - Key ID `39A9367FBD7A5F67` for both the public key and the signature, and a separate Ed25519 check passed.
  - Installer SHA-256 `fb554c34…a2bd31`.
- **Upload and HTTPS.**
  - The Owner approved one Caddy route, `handle_path /updates/*` to `/opt/codetether/updates`. The config was backed up and validated before Caddy was reloaded.
  - Nothing else on the server changed.
  - `latest.json`, the installer and its `.sig` return 200 over HTTPS, and their checksums match. Owner action 8 is closed.
- **The update.**
  - The app was started from the Start menu. The update ran through Settings › About & checks with a single click, and no manual fallback was needed.
  - The new build started eight seconds after the old one exited, and stayed healthy for 70 s.
  - Migration 026 is in place, and the counts are unchanged at 17 projects, 55 conversations and 113 Turns.
  - The Host's own pre-update backup is a single valid database file. The Owner accepted that; the prompt had expected three files.

## Prompt errors and deviations, accepted by the Owner

1. **The platform key.**
   - The prompt said `latest.json` lists `windows-x86_64`. The code (`apps/distribution/src/update-manifest.mjs`) writes `windows-x86_64-nsis`, which Tauri checks first.
   - The prompt was wrong; the agent kept the code's key, with the Owner's approval.
2. **The web route.** The site is a Next.js standalone server, so files placed in its `public/` folder at runtime are not served. A static Caddy route was needed, with the Owner's approval.
3. **The Host's pre-update backup** is one checkpointed database file, not three files.

## Acceptance

**Passed:**

- choosing a model and continuing
- no false warning on an old or imported Codex conversation
- the Claude effort change persisting
- instant sending and the follow-up
- reopening from the tray
- the first send in an empty conversation after a restart
- Windows sandbox commands and tests, with one Approval for `node --test` as declared before W17
- the file-change Approval wording, and declining it
- the Host-stop dialog and its restart: the counts stayed the same, so W0d's carried item 1 is done
- the offline group on the devices page and in the sidebar, with the Owner's two computers
- the current Claude Code version being accepted

**Failed:**

- **An unavailable model after restoring a conversation.** If you restore an archived conversation from inside its workspace, the model catalog is not requested again.
  - So the "不在此账号的可用模型中" warning does not appear, and the old "该会话已归档" error stays.
  - Opening the model picker refreshes it.
  - The cause, from the source: the automatic catalog request is keyed only by conversation ID and is marked as started before it runs. The Host rejects it while the conversation is archived, and nothing retries it after the restore.
  - The fix scope is in `release-v0.1.0-alpha.4/acceptance-findings.md`. The Owner approved it as a separate fix with no release. It came back the same day on `codex/fix-restored-conversation-model-catalog` (`7f24e03`) and was accepted (`restored-conversation-model-catalog.md`). It ships in alpha.5, whose acceptance repeats this check on the installed app.

**Not covered:**

- The failure card that opens the model picker (`provider_model_unavailable`). No real failed Turn of that kind exists: the Host rejects the old model before it creates a Turn.
- No false warning on an old Claude Code conversation, because W0 has no such fixture.

## Left over

- **Cleanup.**
  - `git worktree remove` failed with `Filename too long`, and the follow-up `Remove-Item` was refused by policy.
  - `E:/Projects/Software/agenthub/release-v0.1.0-alpha.4` and the local `release/v0.1.0-alpha.4` branch remain.
  - Merged remote branches are listed in the report, and none was deleted.
- **A Claude conversation "你好"** appeared in `read-only-preflight` at 17:06 UTC. The agent says it did not create it, and it was left as found.
- **The start failure.**
  - Twice, alpha.3 showed "CodeTether 启动失败 / 本地服务意外退出" when the agent started it through COM `Shell.Application` from its own environment.
  - Started from the Explorer Start menu, it ran normally.
  - This is not counted as a defect, but the Host left no log that could explain it. See finding 1 of `2026-11-19-alpha4-hands-on-ui-review.md`.

## Notes for the next release prompt

- `latest.json` lists `windows-x86_64-nsis`.
- Reuse the static root `/opt/codetether/updates`: upload the installer and `.sig` first, then `latest.json` through a temporary name.
- The signing scripts in `agenthub-archive/release-tools/` are ready.
- Allow for Windows' path-length limit when removing the release worktree, for example by removing the large `node_modules` folders with `robocopy /MIR` from an empty folder. Or keep the worktree and list it.

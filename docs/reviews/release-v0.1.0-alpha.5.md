# Review: release `v0.1.0-alpha.5` (2026-11-21)

**Release.** Task prompt: `release-alpha5-prompt.md`. Report: `D:/Projects/Software/agenthub-archive/release-v0.1.0-alpha.5-report.md`, with evidence in `release-v0.1.0-alpha.5/`.

**Verdict.** Released. The second real one-click update worked, and every gate passed. Two acceptance checks stayed open, and neither is a defect in alpha.5:

- The Devices page right after the update was only partly captured. A later cold start covered the same transition in New Conversation.
- The log access check failed because the prompt's criterion was wrong; see "Acceptance". It did surface a real finding about Codex's sandbox.

Nothing was rewritten to pass a check, and the tag stands.

## What was done

- **D3a merge.**
  - `feat/d3a-desktop-consistency` at `6f3dc65` merged into `main` as `eb5d44f`, with parents `6553480` and `6f3dc65`.
  - Its tree is `6f3dc65`'s (`ec8061c`); Claude Code checked this.
  - **Gates on the merge commit (as reported):**
    - typecheck, lint, build, and test: 2,634 passed, 14 skipped
    - the sidecar, and the desktop's `cargo test` (90 + 3)
  - `main` was pushed.
- **Release commit.** `5aa8ae5` sets the version to 0.1.0-alpha.5 and adds the Chinese `CHANGELOG.md` entry.
  - Seven files changed. Android stays at alpha.3.
  - No migration was added since alpha.4, so 026 is still the latest.
- **Remote state.** `main` and `release/v0.1.0-alpha.5` are both at `5aa8ae5`. The annotated tag `v0.1.0-alpha.5` (`a93f14b`) points there too. Claude Code checked all three.
- **History.** Since alpha.4 there are exactly six first-parent merges:
  - D2.5 (`9932e70`)
  - the restored-conversation catalog fix (`13fa6b8`)
  - W0f (`745c701`)
  - UA (`6fb9dd3`)
  - W0e (`6553480`)
  - D3a (`eb5d44f`)
- **Gates on the release commit.** All passed:
  - pnpm: typecheck, lint, build, and test (2,634 passed, 14 skipped)
  - Rust: supervisor-mobile (8 + 4), the sidecar, and the desktop (90 + 3)
  - Android Gradle: BUILD SUCCESSFUL
  - Prettier on the changed files
- **Signing.**
  - All six of W0f's build variables were unset before the build.
  - Build `git-5aa8ae5adffc`, with a clean tree.
  - The key ID is `39A9367FBD7A5F67` for both the public key and the signature.
  - A separate Ed25519 check passed, and it rejected a tampered payload and a tampered comment.
  - The installer is 27,887,901 bytes, SHA-256 `6e434f46…a992f`.
- **Upload and HTTPS.**
  - The installer and its `.sig` went up first, then `latest.json` through a temporary name. All three files are under `/opt/codetether/updates`.
  - All three return 200 over HTTPS, and their checksums match.
  - The Caddyfile's checksum is unchanged, and alpha.4's files are kept.
- **Backup before the update.**
  - An online SQLite backup, with the integrity check `ok` and a folder only the Owner's account can read.
  - Counts: 17 projects, 60 conversations, 124 Turns and 3 computers.
  - The rollback installer is alpha.4's `fb554c34…a2bd31`.
- **The update.**
  - One click in 关于与检查, at 11:17:23 UTC.
  - The old app exited at 11:18:04. The new one opened at 11:18:13, and its Host reported `git-5aa8ae5adffc` a second later.
  - A second check read "版本 0.1.0-alpha.5 · 已是最新版本". No retry or manual install was needed.
  - The Host stayed healthy for 65 s. The counts were unchanged, migration 026 was in place, and `quick_check` returned `ok`.
  - The Host's own pre-update backup is again one database file.
- **Deviation, accepted.** The first offline dependency install stopped on a tarball missing from the store: `refractor` 5.0.0, which D2.5 added. A second install with the frozen lockfile in prefer-offline mode fetched it, and the version check and gates then passed.

## Acceptance

**Passed:**

- **Cold start, quitting from the tray and restarting from the Start menu:**
  - New Conversation was opened 2.5 s after the window appeared.
  - Both local tools read "正在检查…".
  - Claude Code read "可用" after 11.9 s, and Codex could be chosen after 15.0 s, in the same dialog. These times are upper bounds from UI Automation polling.
  - "暂时不可用" never showed.
- **The first message right after the cold start** completed, with no "CodeTether 暂时无法连接".
- **The default model.**
  - The Owner's Codex default, `gpt-6.2-astra`, is not in the list.
  - CodeTether chose GPT-6.1 Terra and said so in the notice.
  - Sending worked, and the notice stayed until the model was switched.
- **A restored conversation** warned by itself that `gpt-6.2-sol` is not available. The old "该会话已归档" error did not stay. This is the check that failed in alpha.4.
- **The timeline,** through one Approval:
  - The tool row read "等待批准".
  - The command title had no PowerShell wrapper.
  - The reply's code was highlighted.
  - The first sandboxed `node --test` failed with `spawn EPERM`, as expected with the `unelevated` sandbox before W17.
- **The message box,** measured with UI Automation at the Owner's window size, 150 % scaling:
  - empty: 73 px
  - five lines: 195 px
  - just after sending, while running, after typing one character, and after the Turn: 73 px each time
  - The model menu fits its content.
- **Status words:**
  - The local tools read "可用" on 设备, the computer page, 关于与检查 and New Conversation.
  - The two paired computers that are not connected show the neutral "已安装，待确认". Their dated note is neutral too.
- **关于与检查 with no project** reads "CodeTether 可以使用".
- **The offline group** opens and closes on 设备 and in the sidebar.
- **The dark title bar** follows the theme. The Owner's theme was restored.
- **The diagnostic logs** exist next to the database, and the spot checks found no paths, prompts or message text. Claude Code re-read both afterwards:
  - **The Host log:** 6 records (start, ready, Codex started, shutdown).
  - **The desktop log:** 28 records. Besides spawn, ready and exit, it holds 23 Host output lines. All carry CodeTether's own prefixes, and their details are redacted.
  - Neither holds a path, an account name or a token.
- **Codex trust entries:** none were added or removed. The test folder was already trusted.
- **Clean-up after acceptance:**
  - 待处理 was not acknowledged.
  - The final counts are 17 projects, 61 conversations and 126 Turns. The difference is one acceptance conversation with two Turns, now archived.

**Open:**

1. **Devices right after the update.**
   - The observer opened 设备 0.35 s after the new window appeared.
   - It then stopped with "The exact installed target window is no longer visible", so the transition was not sampled continuously.
   - Its frames show both local tools reading "正在检查…" at 2.4 s and "可用" later, with no red badge in either.
   - The Start-menu cold start above covered the same transition in New Conversation.
   - **Closed by Claude Code's hands-on check** (`2026-11-21-alpha5-hands-on-ui-review.md`). After a quit from the tray and a start from the Start menu, 设备 was sampled continuously:
     - Both local tools read "正在检查…" from 1.3 s.
     - Claude Code read "可用" at 9.3 s and Codex at 11.1 s.
     - No badge turned red.
2. **Who can read the logs.**
   - **The criterion was wrong.** This prompt asked that only the Owner's account can read the logs, but W0f never required it. W0f required logs that hold nothing private, and they don't.
   - **Where the access comes from.** The logs take their access list from `AppData`, like every other file under it. Claude Code read the access lists:
     - `AppData\Local` and `AppData\Roaming` carry explicit entries that give `CodexSandboxUsers` and an unresolved account SID Modify access. They are also inherited from `AppData` itself.
     - Everything in `%LOCALAPPDATA%\CodeTether` inherits these entries: the database, `machine-credentials`, `backups`, the logs, and the two executables.
     - CodeTether does not set these entries. Their names point to Codex's Windows sandbox setup on this computer.
   - **Not a release defect.** The logs are no more exposed than the database beside them, and they hold nothing private. No screenshot of the Security tab is needed; the access lists are the evidence.
   - **The real finding.** By these access lists, commands that Codex runs in its sandbox may change CodeTether's executables, its database and the Machine credentials. They may also write to the Startup folder under `AppData\Roaming`. This was read from the access lists, not tested. It goes to:
     - the W17 design note, which decides the sandbox backend (`2026-11-17-windows-completion-scope.md`, "W0b's input to W17")
     - a backlog decision: whether CodeTether gives its own folder its own access list (plan, backlog)

## Clean-up

- **Removed:**
  - The six merged task worktrees and their local branches: D2.5, the catalog fix, W0f, UA, W0e and D3a.
    - Each was checked as clean and contained in `main`.
    - The agent first removed the 9,170 pnpm links themselves, then ran `git worktree remove`.
    - A first `git branch -d` failed outside a `main` checkout, and succeeded from one. `-D` was never used.
  - The leftover alpha.4 release folder on E:, after it was compared with the alpha.4 tag. This closes alpha.4's clean-up item.
- **Kept:**
  - all remote branches
  - the local `release/v0.1.0-alpha.4` branch
  - the active alpha.5 release worktree
  - the `docs-english` and `review-detail-main` worktrees
  - every other worktree, including two on F: with uncommitted changes
  - the alpha.4 installer and archives, and both backups

## Notes for the next release prompt

- **The log check:** ask that the logs have no wider access than the database beside them, or drop the check once the backlog decision on the folder's access list is made.
- **New dependencies:** add a release's new dependencies to the store before the offline install.
- **The cold-start observer** should keep sampling when the window is briefly hidden.
- **Clean-up:** removing the pnpm links before `git worktree remove` worked, and can be reused.
- **The window's rectangle** (D3b goal 13): set a non-default size and position before the update, then check that the updated app opens with it and stays hidden until the Host is ready (`d3b-desktop-usability.md`, decision 5).

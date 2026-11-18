# Task: W0-11 Codex Commands in the Windows Sandbox (Diagnose and Fix)

**Where it runs.** On Windows. The Owner develops only on Windows for now (AD-13).

- Never stop, replace or reconfigure the installed app or its Host on `127.0.0.1:4317`.
- Run any development Host on its own port, with its own `CODETETHER_DATA_DIR` and database, as `fix/w0-local-execution` did.
- Use scratch Git projects under `E:/Projects/Software/agenthub/w0-11-sandbox/`. Never use the CodeTether repository itself for Turns that run commands or edit files.
- Another task may be running on this computer. Before you time anything, check that no build or test is running.

**Branch and worktree.** Start from the current `origin/main` (fetch first). Create branch `fix/w0-11-windows-sandbox` in worktree `D:/Projects/Software/agenthub-work/fix-w0-11-windows-sandbox`. If `feat/d2-model-control` merges while you work, merge `main` into your branch.

**Why this task exists.** W0b (2026-11-18) ranked this the biggest obstacle to daily coding on Windows. In a project's own folder, Codex's commands and file writes fail to start in the sandbox. Every step then needs an Approval to run outside the sandbox, and without Approvals nothing gets done. The Windows Terminal CLI fails the same way, so the cause may lie in Codex or in this computer's setup rather than in CodeTether. Find out which, and fix what can be fixed safely.

**References** (read with `git show origin/ux/design:<path>`):

- `docs/reviews/2026-11-17-windows-completion-scope.md`, group A (W0-11, W0-12) and group C (W17 permission modes)
- `docs/reviews/2026-11-13-assessment-and-plan.md` AD-13
- `docs/ux-redesign/03-project-plan.md` §6 (invariants)
- `docs/FROZEN-BOUNDARIES.md`: the Codex execution profile and the Approval rules

Before starting, confirm this file has 4 second-level headings and that the last one is "Report".

## Goals

**Must:**

1. **Reproduce it with the smallest case.** In a fresh scratch Git project, with the installed Codex, use a prompt that does exactly three things:
   - runs one harmless command inside the project, such as `node --version`
   - writes one file inside the project through a command
   - makes one file change through Codex's own patch tool

   Run it in two places, both under `workspace-write` with `on-request` Approvals:
   - **(a)** the Codex CLI in Windows Terminal. Also use the CLI's own sandbox test command if it has one (check `codex --help` and `codex sandbox --help`).
   - **(b)** a development Host, through the product's HTTP and SSE path.

   For each operation, record:
   - whether it started
   - its exit code
   - the exact sandbox error text, with personal paths and identifiers replaced
   - whether the same operation succeeds once approved to run outside the sandbox

2. **Find the cause.** Decide, with evidence, which of these it is:
   - **Codex itself:** a known limit or bug of its Windows sandbox in this version
   - **This computer's setup:** for example a one-time sandbox setup step, a Windows feature or policy, the account's rights, or permissions on drive `E:` compared with `C:`
   - **How CodeTether starts Codex:** for example the environment, `PATH`, working folder, user profile or arguments the Host gives the App Server

   Use Codex's public documentation and release notes for the installed version. Search the web only for public material, and never send names, paths or other identifiers from this computer. If (a) and (b) fail differently, treat them as two causes.

3. **Fix what is in reach, without weakening the sandbox.**
   - **CodeTether's own cause:** fix it in the Codex adapter or the Host's Codex runtime, with tests.
   - **A documented Codex setting:** CodeTether may pass a documented per-conversation setting on `thread/start`, if commands still stay inside the project's sandbox with `on-request` Approvals. Explain the setting in the report.
   - **An Owner action:** if the fix is a step the Owner must take, such as running a setup command with administrator rights, changing the global Codex configuration, or enabling a Windows feature, do not do it yourself. Write the exact steps and their effect in the report.
   - **A Codex limitation with no supported workaround:** say so with the evidence, and list the options for the Owner. The W17 design note covers permission modes, so do not implement one here.
4. **Tell the two failures apart.** W0b's J13 showed two rows that both read "命令执行失败":
   - one was a command that never started, because the sandbox failed
   - the other was a test that ran and failed

   Make the first kind distinguishable in the normalized data, so the timeline can say the sandbox could not start the command:
   - Use only machine-readable fields or the exact recognized error, never the model's prose.
   - Use existing fields if they suffice. If the shared protocol needs a new field, ask the Owner first.
   - The timeline's visual treatment belongs to D2.5. Here, only the plain-text label of that row changes.

5. **Check it on the real device.** After the fix, run the goal 1 prompt again in both places. If the fix depends on an Owner action, run it after the Owner has taken that action.
   - Commands and file changes inside the project complete without any Approval.
   - A command that reaches outside the project still asks for one.
6. **Quality gate:**
   - `pnpm typecheck`, `pnpm lint`, `pnpm build` and `pnpm test`
   - `pnpm format:check` for the files you changed

**Should:**

7. **W0b's original tasks.** Once goal 5 passes, run TA and TB again (`w0-windows-desktop-audit-prompt.md`, the copies W0b used) in the CLI and in the development desktop. Report whether each delivers working code, with an independent test run.

## Known facts

- **W0b's evidence** (`D:/Projects/Software/agenthub-archive/w0b-windows-desktop-audit-report.md`, finding W0-11; files under `w0b-windows-desktop-audit/measurements/`):
  - **J13** (`j13-tool-labels.json`, `j13-test-allow.json`): the first command failed with a Windows sandbox start error. After the Owner approved the same command in the same folder, the test ran and produced its TAP result.
  - **TA in the desktop:** the first Turn changed no files. The follow-up Turn needed Approvals for the three-file patch and for the test command. The Approval's details read `command failed; retry without sandbox?` (`j3-ta-test-allow.json`, screenshot `j3-recovery-dock.png`).
  - **CLI TA and TB** (`cli-ta.json`, `cli-tb.json`): each command item completed with `commandExit: -1`, within about 0.1 seconds of starting. The process exited with 0 and delivered no change. The receipts keep no error text.
  - The scratch projects were on drive `E:`.
- **How CodeTether starts a thread:** `apps/host/src/api/codex-host-runtime.ts` `startConversation` passes `approvalPolicy: 'on-request'` and `sandbox: 'workspace-write'` to `thread/start` (about line 216 at `0bf8cba`). There is no other choice today; W17 will add one.
- **Codex version:** task 5's device check found Codex `0.162.1`. Read the installed version again; it updates itself.
- **The Owner's Codex configuration** is `%USERPROFILE%\.codex\config.toml`. Its default model was changed on 2026-11-18 (Owner action 9). Read only the keys that concern the sandbox or Windows, and do not change the file. Experiment with the CLI's per-invocation overrides (`-c key=value`) or with per-thread settings instead.
- **File-change Approvals show no paths** (W0-12). An Approval record carries `kind: 'file-change'` and an `itemId`. The patch itself is not shown before the decision. That is for the W17 design note, not this task.
- **Codex's normalizer** projects commands, their success flag and the output summary at `packages/adapter-codex/src/normalizer.ts:195`. Approval summaries are at `:428`.

## Boundaries

- **Decide yourself:**
  - the diagnostic method and scratch prompts
  - the fix, within goal 3's rules
  - test design
  - commit splitting
- **Ask the Owner first:**
  - changing the global Codex configuration
  - anything that needs administrator rights
  - installing software or enabling Windows features
  - a new field in Protocol v1 or the Supervisor wire
  - replacing the installed desktop build
- **Do not:**
  - use `danger-full-access`, `approvalPolicy: 'never'`, or any flag that bypasses the sandbox or Approvals
  - edit `AGENTS.md` or `docs/`
  - force-push, merge to `main`, or tag
  - read or print credentials, including Codex's sign-in files

Push `fix/w0-11-windows-sandbox` to `origin`.

## Report

Write to `D:/Projects/Software/agenthub-archive/w0-11-windows-sandbox-report.md`. Keep the evidence in `D:/Projects/Software/agenthub-archive/w0-11-windows-sandbox/`.

- **Reproduction:** goal 1's results for (a) and (b), each operation with the sanitized error text.
- **Cause:** the finding, with the evidence for it and against the other candidates.
- **Fix:** what changed and the tests for it; or the Owner action, with exact steps; or why no supported fix exists, with the options.
- **Failure label:** how a sandbox start failure is now told apart, and the test.
- **Device check:** goal 5's results, and goal 7's if it ran.
- **Gates:** results, with any failures verbatim.
- **Commits:** your commits and the pushed remote commit.
- **Docs:** documentation changes you think are needed, including anything the W17 design note should take into account.
- **Status:** anything left undone and why, and which completion level the work reached.

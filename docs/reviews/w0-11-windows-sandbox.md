# Review: `fix/w0-11-windows-sandbox` (2026-11-18)

**Branch.** Pushed at `a40b033`. Base `9cb3e5b`, with `main` at `3a97f6f` (task 5) merged in. Task prompt: `w0-11-windows-sandbox-prompt.md`. Report: `D:/Projects/Software/agenthub-archive/w0-11-windows-sandbox-report.md`.

- `0c88e0f` keeps one environment variable away from the Codex App Server that CodeTether starts.
- `5feea09` labels the resulting failure in the timeline.

Against `main`, the branch changes only five files.

**Gates (as reported, after merging `main`):** typecheck, lint, build and test passed. Prettier passed on the changed files. `cargo test --locked` in `packages/supervisor-mobile` passed.

**Verdict.** Accepted, no must-fix.

## The cause

- **The marker.** The coding agents run inside the OpenAI desktop app, whose environment carries `CODEX_WINDOWS_REGISTERED_CORE=1`. That marker makes Codex 0.162.1 select the desktop app's packaged runtime, and then require a Windows package identity. A stand-alone `codex.exe` or App Server has none, so the sandbox fails before the command starts: "registered Core process has no package identity".
- **How it reached CodeTether.** W0b started the installed CodeTether with `Start-Process` from the agent's own PowerShell (`E:/Projects/Software/agenthub/w0b-audit/start-desktop.ps1`), and the CLI from a Terminal that inherited the same environment. The marker is set neither for the Windows user nor for the system.
- **What that means for the Owner.**
  - CodeTether started from the Start menu very likely never had the problem.
  - W0b's sandbox failures, most of its sandbox Approvals, and the undelivered TA and TB came from how the audit started the programs.
  - After the fix, the CLI delivered both TA and TB (3/3 tests each), and the development desktop delivered TA.
- **The fix is still right.** CodeTether already strips the parent's Codex control variables from the App Server's environment. Adding this marker keeps CodeTether working even when it is started from such an environment, for example from a terminal inside the OpenAI desktop app. The `workspace-write` sandbox and `on-request` Approvals are unchanged.
- **Proof.** A command outside the project is still refused, and an Approval is still requested. Re-injecting the marker brings the error back.

## Checked in this review

- **The change** adds one name to `PARENT_CODEX_CONTROL_VARIABLES` (`packages/adapter-codex/src/process.ts`). A test covers mixed-case spellings and keeps `PATH` and the sign-in environment.
- **The label** "Windows 沙箱无法启动命令" appears only for a failed command whose whole output is that exact error.
  - The fix itself removes that error, so in practice the label will rarely appear.
  - Matching the Provider's error text in the web layer follows the existing `summarizeToolFailure` practice. D2.5 keeps it.
- **No sandbox weakening.** The task used no `danger-full-access`, no `never` Approval policy, and changed no global setting.
- **The Owner's Codex configuration.**
  - Codex itself added eight trust entries for the scratch folders. The agent removed only those, with the Owner's permission.
  - The sandbox setting stayed `unelevated`.
  - The installed app was not touched.

## Carried items

1. **Tests that start child processes still need an Approval.**
   - The Owner's Codex uses the `unelevated` Windows sandbox. In that mode, a program that starts child processes is refused with `spawn EPERM`. That includes `node --test` by default and most test runners.
   - The same tests pass with `--test-isolation=none`, and with Codex's MXC sandbox probe.
   - **The W17 design note** evaluates the sandbox backend for the Codex that CodeTether starts: `elevated`, which needs a one-time administrator setup, or MXC. No global change without the Owner.
2. **Adding a project trusts it in Codex.**
   - When CodeTether starts a Codex thread in a new folder, Codex writes a trust entry for that folder into the Owner's global Codex configuration.
   - Adding a project to CodeTether therefore also marks it trusted for the Codex CLI.
   - **The W17 design note** decides whether the UI must say so, or whether CodeTether should avoid it.
   - Until then, every agent task that runs Turns in scratch folders records the trust entries it causes and removes them with the Owner's permission.
3. **Audits must start the app the way the Owner does.**
   - W2 and alpha.4 acceptance start the installed app from the Start menu or through Explorer, not with `Start-Process` from an agent's shell.
   - If they must start it from a script, they first remove every `CODEX_*` variable from that environment.
4. **TB in the development UI** was stopped partway through, after the trust entries were noticed. The CLI delivered it. W2 repeats it in the app.

## Next

Merge into `main` with a merge commit, with the Owner's approval to push `main`. It merges cleanly with `feat/b3a-send-speed`.

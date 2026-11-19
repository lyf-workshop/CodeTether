# Windows Desktop Completion Scope (2026-11-17)

**Owner's instruction (2026-11-17).** "Once Windows testing finishes, complete all Windows-side functionalities." This document defines that scope, its order, and when it is done. It extends AD-13 in `2026-11-13-assessment-and-plan.md`.

**Status.** Claude Code's recommended defaults apply until the Owner changes them. Section 4 lists the choices still open. Group A was filled in from the W0 report on 2026-11-18, and W0b added W0-11 to W0-18 the same day.

## 1. What counts as Windows-side

- **Windows-side** means everything a person does with CodeTether on one Windows computer, with no other device involved.
- **Not included:** pairing, phones, tablets, the iPad, the Relay, other computers, push notifications and E1.
- **Also postponed since 2026-11-18 (Owner):** macOS acceptance, CI and repository hygiene. Development itself also runs only on Windows for now.
- **Sources:**
  - the requirement inventory, `docs/ux-redesign/04-requirements.md` §4
  - `docs/ux-redesign/10-desktop-improvements.md`
  - the 2026-11-13 UI review
  - the AGENTS.md "Out of Scope" list
  - W0

## 2. Scope

**A. W0 findings.** Every Blocker and High finding, plus cheap Medium ones. Reviewed on 2026-11-18 (`D:/Projects/Software/agenthub-archive/w0-windows-desktop-audit-report.md`). W0 could not test the core loop because every Codex Turn failed (W0-01). W0b finished it on 2026-11-18 (`D:/Projects/Software/agenthub-archive/w0b-windows-desktop-audit-report.md`): the core loop works on alpha.3, with friction. Its verdict is to keep the CLI for daily coding for now.

| ID                | Severity     | Finding                                                                                                                                                                                                | Handled by                                                                                                                                                                                                                                                           |
| ----------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W0-01             | Blocker      | Every Codex Turn failed with a generic `provider_error`. The cause: the Owner's Codex configuration chose a model this account cannot use (`model_not_found`).                                         | "所选模型不可用": `fix/w0-local-execution`, merged into `main` on 2026-11-18 (`9cb3e5b`). Codex's default model: Owner action 9, done; W0b confirmed that Codex works. Picking a usable model and seeing a warning first: task 5 goal 7, accepted with one must-fix. |
| W0-02             | High         | Creating a conversation takes 10–14 s. Your own message appears 6.5 s after the first send, and after up to 17 s for a follow-up after a restart (W0b).                                                | Task 6 (B3a), with W0b's numbers as the baseline and a breakdown by stage                                                                                                                                                                                            |
| W0-03             | High         | Claude Code `2.1.327` is blocked: its help text no longer lists Glob and Grep. The dialog does not say why.                                                                                            | `fix/w0-local-execution`: Claude Code 2.1 from `2.1.327` on is admitted as `compatible_unverified`, and the dialog gives specific reasons. Merged into `main` on 2026-11-18 (`9cb3e5b`); it reaches the installed app with alpha.4.                                  |
| W0-04             | Medium       | For someone who uses only this computer, the account, remote devices and AI-tool health are mixed together                                                                                             | W0 small fixes, goal 4: this computer first, and offline remote computers in a closed group (the Owner, 2026-11-18)                                                                                                                                                  |
| W0-05, 06, 07, 10 | Medium / Low | Location shown three times; an irrelevant offline-computer hint; repeated archive links; copy that describes the implementation                                                                        | Already in D2.5 goal 8, D3a goal 5 and D3b goals 6, 7 and 9. W0's evidence is added to those tasks when they are dispatched.                                                                                                                                         |
| W0-08             | Medium       | Model, context, attachment and voice controls are placeholders                                                                                                                                         | Model: task 5. Context, attachments and voice: tasks 12–14.                                                                                                                                                                                                          |
| W0-09             | Medium       | When the Host stops while the app is open, the dialog is titled "CodeTether 启动失败" and the user must reopen the app by hand                                                                         | W0 small fixes (`w0-small-fixes-prompt.md`), goal 1                                                                                                                                                                                                                  |
| W0-11             | High         | Inside a project's own folder, Codex's commands and file writes fail to start in the Windows sandbox. Each step then needs an Approval to run outside it. The Windows Terminal CLI fails the same way. | New task `w0-11-windows-sandbox-prompt.md`: find the cause and fix it without weakening the sandbox                                                                                                                                                                  |
| W0-12             | High         | A file-change Approval shows neither the paths nor the patch, and the Composer calls it a command                                                                                                      | The wording: W0 small fixes, goal 3. The paths and patch before the decision: the W17 design note (group C).                                                                                                                                                         |
| W0-13             | High         | Timeline rows do not say which command ran. A command the sandbox never started and a test that ran and failed both read "命令执行失败".                                                               | D2.5 goal 2, with W0b's J13 as an acceptance sample. The W0-11 task supplies the data that tells them apart.                                                                                                                                                         |
| W0-14             | High         | Diffs use a proportional font, and at 1100 px long lines run out of view                                                                                                                               | D2.5 goal 3                                                                                                                                                                                                                                                          |
| W0-15             | Medium       | Every step of a Turn repeats the avatar, name, time and status                                                                                                                                         | D2.5 goal 4                                                                                                                                                                                                                                                          |
| W0-16             | Medium       | "文件" and "变更" list the same files; "变更" shows a red "-0" when nothing was deleted                                                                                                                | D2.5 goal 6                                                                                                                                                                                                                                                          |
| W0-17             | Medium       | On the first launch, there is no way to sign in before setup is finished (W0 §9, confirmed by W0b)                                                                                                     | W0 small fixes, goal 2                                                                                                                                                                                                                                               |
| W0-18             | High         | A conversation created and left empty before a restart fails on its first send (`provider_session_lost`, not retryable)                                                                                | B3a goal 6 (added 2026-11-18), because B3a changes the same create and first-send path                                                                                                                                                                               |

**B. Planned, prompt written.**

| Task       | Content                                                 |
| ---------- | ------------------------------------------------------- |
| 5          | Model and reasoning effort per Turn (W13)               |
| 6          | B3a send speed                                          |
| 8          | S1 local API session token (after the ADR is accepted)  |
| 9          | D2.5 timeline restyle                                   |
| 10, 11     | D3a consistency, D3b usability                          |
| 12, 13, 14 | X1a remaining context, X1b image attachments, X1c voice |

**C. In scope; needs a design note before its prompt.** Claude Code writes the design notes while groups A and B run, and the Owner approves each one.

| Item                                 | 04 ID    | Today                                                                                                                                               | Goal                                                                                                                                   |
| ------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Permission modes                     | W17      | Codex always runs with `on-request` approvals and a `workspace-write` sandbox (`packages/adapter-codex/src/client.ts:324-326`). There is no choice. | Per conversation: ask before changes, edit automatically, or plan only. Each mode is shown only where the Provider really supports it. |
| Claude Code edits and commands       | W12      | Read, Glob and Grep only: no edits, no shell, no Approvals                                                                                          | Edits and commands with Approvals and Stop, through Claude Code's own permission mechanism (the design note confirms which one)        |
| Messages while running               | W10      | Sending while busy is refused (409)                                                                                                                 | Queue the next message; also steer a running Turn, if the Provider supports it                                                         |
| "@" project files and slash commands | W15, W14 | Not available                                                                                                                                       | "@" picks project files. Only slash commands that work without an interactive terminal are offered.                                    |

**W0b's input to W17.** The W17 design note also decides what a file-change Approval shows before the decision (W0-12). It builds on the W0-11 task's findings about the Windows sandbox.

**D. In scope and small; prompt directly.**

| Item                                                                          | 04 ID | Notes                                                                          |
| ----------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------ |
| Launch at startup                                                             | O9    | Off by default; starts hidden in the tray                                      |
| Attention count on the taskbar icon and tray                                  | —     | Count of items that need you; no titles                                        |
| Open a changed file in the user's editor; open the project folder in Explorer | —     | Fixed-purpose native commands, not a general command runner                    |
| Drag a folder onto the window to add a project                                | —     | Uses the same validation as the folder picker                                  |
| Delete a conversation                                                         | C7    | Deletes the CodeTether record only, never project files; confirmation required |
| Search across projects                                                        | C6    | Same title and user-input search as within one project                         |
| Lists beyond 100 conversations                                                | P8    | Pagination in local lists                                                      |

**Boundaries.** Groups C and D lift items from the AGENTS.md "Out of Scope" list and from `FROZEN-BOUNDARIES.md`. Each task prompt names the boundary it extends, which AGENTS.md's source order allows. Claude Code updates AGENTS.md and FROZEN-BOUNDARIES as each item is accepted.

## 3. Order

At most two tasks run at once (AD-11), both on Windows: the Owner develops only on Windows for now.

1. **Start with W0.** Done on 2026-11-18, together with:
   - `fix/w0-local-execution`, merged into `main` (`9cb3e5b`)
   - W0b, which finished the core loop on alpha.3
   - task 5, accepted with one must-fix (`d2-model-control.md`)
2. **Now:** task 5's round 2 alongside the W0-11 sandbox task. Then B3a, which now includes W0-18, starts once task 5 has merged. The W0 small fixes take the next free slot.
3. **Release alpha.4** after task 5 and B3a. The W0-11 fix and the W0 small fixes join it if they are accepted by then; otherwise they ship in the next alpha. alpha.4 is the first real one-click update (U1), so every later batch ships the same way.
4. **Run group B with group A's fixes in between:** 9 ∥ 10, then 12 ∥ 11, then 13, then 14. D2.5 (task 9) carries four of W0b's findings, two of them High, so it goes first.
5. **Group C:**
   - W17 goes first, because it shapes Approvals, which W12 depends on.
   - Then W12, then W10, then W15 with W14.
6. **Group D** fills any free slot.
7. **S1 (task 8) comes before the final release,** because the local API should not stay open once more power is added.
8. **Release each batch** as an alpha through the one-click update.

**Done** when:

- every in-scope row is accepted on Windows, and
- a repeat of the W0 audit (W2) finds no Blocker or High findings, and
- the result is released.

The Owner then decides what resumes: Mac acceptance of the shared code, the phone, or remote work.

## 4. Choices still open (defaults apply until the Owner changes them)

| Choice                                                                                                                                      | Default                                            | Why                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Code signing for the installer and updates (Authenticode)                                                                                   | Later: before anyone besides the Owner installs it | It costs money every year. Until it is in place, Windows SmartScreen warns about an unknown publisher.       |
| A terminal inside the app                                                                                                                   | Out (04 §7)                                        | Opening files in the editor and the folder in Explorer covers reviewing work. A terminal is a large surface. |
| Attachments that are not images                                                                                                             | Later                                              | "@" covers project files (AD-12).                                                                            |
| A setting for what the close button does; recent folders; notification history; "remind later" and "needs your reply" in the Inbox (N6, N7) | Later                                              | Low value compared with their cost; reconsider if W0 shows a need                                            |
| A third Provider, such as OpenCode (P1)                                                                                                     | Later                                              | Not Windows-specific                                                                                         |
| Registering a new account in the app (A9)                                                                                                   | Later                                              | Only the Owner uses it for now                                                                               |

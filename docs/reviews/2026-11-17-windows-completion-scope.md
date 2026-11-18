# Windows Desktop Completion Scope (2026-11-17)

**Owner's instruction (2026-11-17).** "Once Windows testing finishes, complete all Windows-side functionalities." This document defines that scope, its order, and when it is done. It extends AD-13 in `2026-11-13-assessment-and-plan.md`.

**Status.** Claude Code's recommended defaults apply until the Owner changes them. Section 4 lists the choices still open. Group A is filled in after the W0 report is reviewed.

## 1. What counts as Windows-side

- **Windows-side** means everything a person does with CodeTether on one Windows computer, with no other device involved.
- **Not included:** pairing, phones, tablets, the iPad, the Relay, other computers, push notifications and E1.
- **Sources:**
  - the requirement inventory, `docs/ux-redesign/04-requirements.md` §4
  - `docs/ux-redesign/10-desktop-improvements.md`
  - the 2026-11-13 UI review
  - the AGENTS.md "Out of Scope" list
  - W0

## 2. Scope

**A. W0 findings.** Every Blocker and High finding, plus cheap Medium ones. These are listed after the W0 review.

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

At most two tasks run at once (AD-11). The Mac can implement shared desktop code; acceptance is on Windows.

1. **Start with W0.** Claude Code then reviews the report, fills in group A and re-ranks group B.
2. **Release alpha.4** after task 5, B3a and the W0 Blocker fixes. It is the first real one-click update (U1), so every later batch ships the same way.
3. **Run group B with group A's fixes in between:** 9 ∥ 10, then 12 ∥ 11, then 13, then 14.
4. **Group C:**
   - W17 goes first, because it shapes Approvals, which W12 depends on.
   - Then W12, then W10, then W15 with W14.
5. **Group D** fills any free slot.
6. **S1 (task 8) comes before the final release,** because the local API should not stay open once more power is added.
7. **Release each batch** as an alpha through the one-click update.

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

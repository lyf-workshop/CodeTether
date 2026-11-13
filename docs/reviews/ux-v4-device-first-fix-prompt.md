# Fix Prompt: ux/v4-device-first Round 1 Review

> Give the entire text below to the coding agent.

---

You are fixing findings from the first review of `ux/v4-device-first` in the CodeTether repository.

## Starting Point

- Workspace: `D:/Projects/Software/agenthub-ux-v4-device-first` (already exists; do not create another worktree).
- Branch: `ux/v4-device-first`, starting commit `df91601`. Before working, confirm `git rev-parse HEAD` starts with df91601 and the worktree is clean except for `docs/UX-V4-REVIEW-NOTES.md`; otherwise stop and report.
- Review record (required reading): `D:/Projects/Software/agenthub/docs/reviews/ux-v4-device-first.md`. All M* and S* IDs below refer to it.
- Requirements and design: `D:/Projects/Software/agenthub/docs/ux-redesign/04-requirements.md` (third revision), `02-dev-handoff.md`, and prototype pages.
- Authorization: while Figma synchronization is paused, requirements and prototypes in `docs/ux-redesign` are the user-authorized temporary UI reference (user decision on 2026-10-19). This task overrides AGENTS.md's “Figma is the only source” rule. Follow all other AGENTS.md rules normally.

## Work and Commits

One commit per step, with an English conventional commit message and this trailer:
`Co-Authored-By: Claude Code <noreply@anthropic.com>` (if you are not Claude Code, substitute your own name without changing the format).

1. **M1 Restore “Remove project from this device”** (`fix(web): restore per-device project removal`)
   - Offer “Remove from this device” on device-detail project cards and beside each project listed in a blocked unpairing dialog. Reuse `remove-project-location-dialog.tsx` and `runtime.removeProjectLocation`.
   - Enable only when this project has no conversations on this device (including archived); otherwise show the reason without an actionable button.
   - Recheck the unpairing dialog after removal; enable unpairing after all projects are removed.
   - Test: render-test the case “local conversations, folder on paired device” through to successful eligibility for unpairing.
2. **M3, M4, M5 Sidebar** (`fix(web): persist sidebar tree and gate add project`)
   - Store expanded/collapsed device and project IDs in `localStorage` (IDs only, `ct-` key prefix; validate reads, treat corrupt data as empty). Continue automatically expanding the current route.
   - Ctrl B (⌘B on Mac) collapses/expands the sidebar; ignore IME composition and input focus. Define alongside existing shortcuts.
   - Sidebar “+” uses `machineCanAddProject`; when unavailable, show the same reason as Devices.
3. **S1, S2, S16, S17 Composer and Creation** (`fix(web): keep composer focus and idempotent create`)
   - Keep the editor visible while sending (read-only is sufficient); return focus afterward if it had focus before sending.
   - Conversation creation: reuse actionId for the same selection when the previous failure was not an explicit Host rejection (not `CodeTetherResponseError`), following `live-conversation-actions.ts:137-139`.
   - Remove the demo branch at `composer.tsx:172`; make `controller` required.
   - Store drafts by conversation ID in `sessionStorage`; clear after successful send or archiving; do not use `localStorage`.
4. **M2, S19 Remove Dead Code** (`refactor(web): remove unreachable v3 modules`)
   - Delete the modules listed in review S19, plus `conversations-page.tsx` and `project-conversations-route.tsx`; delete or update tests existing only for them. Keep `remove-project-location-dialog.tsx` (used by step 1).
   - Verify import reachability from `main.tsx` before deletion; leave uncertain modules and report them.
5. **S3, S9, S15, S20 Copy** (`fix(web): chinese-only copy and roadmap link`)
   - Use document 04's Chinese terms for “AI tool,” “This computer,” “Folder,” etc. at the string source, without presentation-layer patches; translate English in `tool-presentation.ts`, `provider-presentation.ts`, and `message-markdown.tsx` into Chinese.
   - Add a `/roadmap` link after the account-page sentence about other computers.
   - Add a test scanning user-visible strings in `apps/web/src`, failing on the exact strings `智能体`, `推理后端`, `Provider`, or `此电脑` (allow Codex, Claude Code, Relay, Node).
6. **S4, S5 Lists** (`fix(web): recent projects first and server-side filters`)
   - Add a “Recently used” group to the New Conversation project list (at most 5, by `lastActivityAt`); group remaining projects by device.
   - Pass `status` and `provider` to `listProjectConversations` and include them in query keys. Host already supports them; do not modify Host.
7. **S7, S8, S10, S11, S12 Devices and Projects** (`fix(web): device page polish`)
   - Load project-card metrics when cards become visible (independent of hover).
   - For an add-project race, show the Chinese message “This folder was just added; the list has been updated” and refresh the list.
   - Replace native checkboxes with a `packages/ui` component (add one there if absent, with labels and keyboard support).
   - Consolidate breakpoints and dimension constants in one file or tokens.
   - Disable Unpair while Host is not ready and explain why.
8. **S14 Authorized Phones and Tablets** (`feat(web): read-only list of authorized mobile devices`)
   - Under Settings › Account, add a read-only “Phones and tablets allowed access” list: name, type, authorization time. Use grants already obtained by the existing coordinator; no new backend API, switches, or buttons. Hide the entire section if no grants exist.
   - Add “Removal will be available when pairing-code pairing launches,” linked to `/roadmap`.
9. **S23 / UX-V4-001 First-run Setup** (`fix(web): separate install runtime and service readiness`)
   - Follow `docs/UX-V4-REVIEW-NOTES.md`; edit only `onboarding-page.tsx` and `onboarding-model.ts`, splitting onboarding-page into smaller files as needed. Fulfill every acceptance item. Update the note's status to “Fixed, awaiting re-review” and include it in this commit.
10. **S18, S21, S22 and S6 Record** (`refactor(web): split large files and add behavior tests`)
    - Open Node documentation links using `provider-guidance-link.tsx`'s native mechanism.
    - Split `previous-conversations-step.tsx`, `workspace-sidebar.tsx`, `conversation-organization-controls.tsx`, and `add-project-dialog.tsx` to at most 400 lines each, without behavior changes.
    - Replace source-regex tests in `new-conversation-dialog.test.mjs` with render tests: double-click creates only once; missing first input or model prevents creation; 409 retains draft without resend; focus returns to composer after sending.
    - S6 (approval in the attention bar above the composer, deviating from W6) needs no code or doc change: this branch lacks `docs/ux-redesign`; the reviewer will record the deviation.

11. **M6, M7 Contrast** (`fix(ui): meet AA contrast for muted and warning text`)
    - `globals.css`: set light `--ct-text-3` to approximately `#706b64`, dark to approximately `#928e87` (reviewer calculated ≥4.5 on bg, surface, and inset). Then script all actual background combinations for `--text-muted`, `--status-idle-text`, and `--status-offline-text`; report results.
    - Replace every use of `text-warning`, `text-danger` as text colors with `text-warning-text`, `text-danger-text` (search all usages first; at minimum `inbox-page.tsx:228`, `inbox-item.tsx:113,154`).
    - Set window background at `apps/desktop/src-tauri/tauri.conf.json:26` to the light theme background (S32). This is the only permitted `apps/desktop` file change.
12. **M8, S24, S33, S34 Inbox** (`fix(web): attention actions and notification body`)
    - Add “Got it” (`resolveAttention`) to completed items awaiting review. If approval is unsupported on this device, explain why (e.g. “The AI tool on this device cannot approve here; open the conversation to handle it”); do not add “Got it”: Host returns 422 for approval items (`host-service.ts:3220-3225`); do not change Host.
    - “View result” opens the conversation even if `resolveAttention` fails, while showing the failure.
    - If Host is connected but the list query fails, use accurate copy such as “Cannot read the Inbox list right now; retry later.”
    - Add device name to system notification body: “Device · Project”; still exclude conversation titles, prompts, commands, and paths.
13. **S25–S30, S35 Components and Settings** (`fix(ui): settings and component accessibility`)
    - Use normal color or no dot for “Always on”; remove unused `backgroundRuntimeAvailable`.
    - Change `<main>` to `<section>` in `roadmap-page.tsx`.
    - `Notice` has no default `role`; errors retain `role="alert"`; review callers and explicitly request announcements where needed.
    - `CommandList`: keep titles/status outside listbox, move empty state outside, set `aria-expanded` to actual state.
    - Notification switches' `aria-describedby` points to their row's description.
    - Move `AttentionRow` buttons below body text on narrow screens.
    - Add a 30-second local cooldown for resending login codes, showing remaining seconds on the button.

Verify before changing: `packages/ui/src/tokens/statuses.ts` consistently labels `waiting` “Waiting for approval.” Determine whether Host `waiting` means approval only; otherwise restore a neutral label and report the conclusion.

Verify S13 (getMachine call count) first: if there is truly one request per device, consolidate into one; otherwise report the finding.

## Rules to Preserve

- Invariants in `docs/ux-redesign/03-project-plan.md` §6.
- UI shows only capabilities truly provided by the backend; unimplemented features appear only in `/roadmap`. No fake switches or “Coming soon.”
- Chinese-only UI (Codex, Claude Code, Relay, Node may remain English; the Chinese term for “AI tool” is allowed).
- No demo data; demos must never call real login, deletion, or AI tool execution APIs.
- Preserve local/remote gating: actionId idempotency, no archiving while running, no automatic resend after failures or 409, Stop and Approval only for supporting AI tools.
- Notifications exclude conversation titles, prompts, commands, and paths.
- AGENTS.md: no `style=`, no `!important`, token-only colors, no Zustand, shared components in `packages/ui`.
- Do not edit `apps/host`, `packages/protocol`, `packages/client`, Control Plane, or Relay; in `apps/desktop`, only the step 11 window background change is allowed. If completing a task requires changes there, stop and report.

## Prohibited Actions

- Do not read or write `.secrets/`, any `.env` or credential file; do not read `~/.claude.json`.
- No deployment, pushes (including `ux/v4-device-first` and main), merges, tags, or replacement of installed Mac/Windows apps.
- Do not touch untracked files in main workspace `D:/Projects/Software/agenthub` (`PHASE8D-*`, `demo-ui-*.html`, `ICON-COLLECTION-PLAN.md`, `docs/MULTI-PROVIDER-STRATEGY.md`, `packages/ui/src/assets/`).
- Never use `git add .`; stage by file. Do not change Git configuration or skip hooks.
- Do not print environment variable values in any output, log, or commit.

## Validation

Run sequentially from the workspace root:

```
pnpm typecheck
pnpm lint
pnpm test
pnpm build
npx prettier --list-different --end-of-line auto <files-changed-in-this-task>
```

- Known unrelated `pnpm test` failure: `packages/adapter-claude/test/detection.test.mjs:331` fails with this machine's ANTHROPIC_* variables. Run `env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_MODEL pnpm test` and document this. Do not modify that test.
- Repository-wide `pnpm format:check` fails on CRLF endings; ignore that and use the changed-file check above.
- Focus on: step 1 scenario test; step 5 copy scanner; expanded sidebar state after refresh; Ctrl B; focus after send; step 11 contrast calculation; step 12 test excluding titles from notification bodies.

For API 429 or 524, wait according to Retry-After before retrying, at most 3 retries per error type; log time and wait duration each time. If still failing after the third retry, stop and report the stopping point.

## Report Format (Chinese)

1. Each step: commit hash, changes, corresponding M/S IDs.
2. Check results: exit codes of the five commands; include failures verbatim (first replace token-like strings with `[REDACTED]`).
3. Unfinished work and reasons (including S13 verification and any work blocked by the prohibition on Host changes).
4. Deviations from requirements or prototype.
5. Completion level (see `D:/Projects/Software/agenthub/docs/DEVELOPMENT-PROCESS.md` §2). Passing all checks means “Code complete,” never claim “Review passed.”

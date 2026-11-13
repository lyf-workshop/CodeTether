# Fix prompt: ux/v4-device-first review round 2

> Give this entire prompt to the coding agent.

---

Fix the second-round `ux/v4-device-first` review issues in CodeTether. Keep the scope to the locations listed below.

## Starting point

- Existing worktree `D:/Projects/Software/agenthub-ux-v4-device-first`; do not create another.
- Branch `ux/v4-device-first`, starting `33f5b5d`. Before work verify `git rev-parse HEAD` begins 33f5b5d and the worktree is clean; otherwise stop/report.
- Review (read "Round 2"): `D:/Projects/Software/agenthub/docs/reviews/ux-v4-device-first.md`. R2-* identifiers refer to it.
- Requirements: `D:/Projects/Software/agenthub/docs/ux-redesign/04-requirements.md`.
- Authorization: while Figma synchronization is paused, docs/ux-redesign requirements/prototype are the temporarily authorized UI source (user decision 2026-10-19), overriding AGENTS.md's Figma-only rule for this task. Other AGENTS.md rules apply.
- Correction: step 10 of round one's prompt incorrectly forbade creation without first input/model. Follow 04 C1/W13: desktop creation has neither first message nor model selection, preserving current behavior. Cite C1 in the report rather than claiming user confirmation.

## Work and commits

One English conventional commit per step, ending with:
`Co-Authored-By: Claude Code <noreply@anthropic.com>` (if you are not Claude Code, use your own name with the same format).

1. **R2-1 retain focus while running** (`fix(web): keep composer mounted while turn runs`)
   - `composer.tsx:82`: keep editor mounted/read-only during `running`/`waiting`, with gating alongside instead of hiding it. Preserve `archived`/`unavailable` behavior.
   - Restore focus when editable only if input had focus before send and the user has not moved it.
   - Rendering test: focus never falls to body through submitting -> running -> idle; running input is read-only and cannot send.
2. **R2-2 success text contrast** (`fix(ui): success text contrast`)
   - Replace text-color `text-success` with `text-success-text`, searching all usages, at least `conversation-files-surface.tsx:54`, `inspector-panel.tsx:215`, `conversation-timeline.tsx:134`.
   - Add actual-background combinations for success-text/warning-text/danger-text to `token-contrast.test.mjs`. Test that `apps/web/src`/`packages/ui/src` no longer use `text-success`, `text-warning`, or `text-danger` for text colors, excluding `*-text`, `bg-*`, and `border-*`.
3. **R2-3/R2-9 copy** (`fix(web): rewrite mechanical copy replacements`)
   - Manually rewrite `machine-actions.ts:384,398,400,404,418,444`, e.g. "Device operation in progress; please wait", "This CodeTether version does not support this device operation", "Invalid pairing code; check the six digits displayed by Node". Add spaces between Chinese and English.
   - Search repository-wide for mechanical replacement leftovers such as "this computer operation", missing spacing around Node/display, and "on Node"; fix together.
   - Make `user-visible-copy.test.mjs` scan `packages/ui/src` too.
4. **R2-4 explain unavailable sidebar add** (`fix(web): explain why sidebar cannot add project`)
   - `workspace-device-section.tsx`: if online but `machineCanAddProject` is false, show the device-page reason, extracting copy from `machine-projects-section.tsx:109-114` into one shared function.
5. **R2-5/R2-6 narrow layouts** (`fix(web): narrow layout for attention rows and sheets`)
   - Remove `attention-body`, `attention-time`, `attention-actions` from `workspace-responsive.css` so classes added at 33f5b5d in `attention-row.tsx` work, or centralize them in CSS instead; keep one authority.
   - Add `translate: none; scale: none;` beside sheet `transform: none`.
   - Browser-check widths 390/600: Attention actions below content; Add project/New conversation sheets bottom-aligned and fully visible. Report method/results. Tests must at least check built CSS lacks `attention-actions` `grid-column: 3` and sheet rules contain `translate: none`.
6. **R2-7/R2-8 request counts** (`perf(web): load card metrics when visible and reuse cache`)
   - `machine-projects-section.tsx:131-134`: load metrics after card enters viewport (IntersectionObserver), loading immediately if unsupported.
   - `attention-notification-metadata.ts:30-34`: use `queryClient.getQueryData` for cached conversations first, requesting only on a miss, like machine reads at `:43-44`.
7. **R2-10/R2-11 tests and cleanup** (`test(web): end-to-end project location removal`)
   - Add M1 jsdom coverage: open blocked unpair dialog -> "Remove from this device" -> confirm -> updated Host device response -> unpair becomes enabled.
   - Delete test-only `defaultProviderControls`/`defaultProviderModel` (`new-conversation-provider-selection.ts:91-107`) and tests.

Outside this round: S18 native Node docs, notification "already on screen" logic, heading levels, other large-file splitting, adapter-claude environment isolation. Leave them untouched.

## Invariants

- Invariants in `docs/ux-redesign/03-project-plan.md` section 6.
- Expose only real backend capabilities; future work belongs only in `/roadmap`. No fake switches or "Coming soon".
- Chinese-only UI (Codex, Claude Code, Relay, Node may remain English; "AI tool" is acceptable terminology).
- No demo data.
- Preserve local/remote gates: actionId idempotency, no archive while running, no automatic failure/409 replay, Stop/Approval only on supported tools.
- Notifications exclude conversation titles, prompts, commands, and paths.
- AGENTS.md: no `style=` or `!important`; token-only colors; no Zustand; shared components in `packages/ui`.
- Preserve `apps/host`, `apps/desktop`, `apps/node`, `packages/protocol`, `packages/client`, Control Plane, and Relay. Stop/report if completion requires those changes.

## Prohibitions

- Do not read/write `.secrets/`, any `.env`, credential files, or read `~/.claude.json`.
- No deploy, push, merge, tag, or installed Mac/Windows replacement.
- Preserve untracked files in main worktree `D:/Projects/Software/agenthub`.
- Stage by file, never `git add .`; preserve Git configuration/hooks.
- Never print environment-variable values in output/logs/commits.

## Verification

Run from worktree root:

```
env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_MODEL pnpm typecheck
env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_MODEL pnpm lint
env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_MODEL pnpm test
env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_MODEL pnpm build
git diff --name-only --diff-filter=AM 33f5b5d..HEAD | xargs -n 40 npx prettier --list-different --end-of-line auto
```

(Batch Prettier files to avoid Windows command-line length limits.)

For API 429/524, wait per Retry-After and retry each error type at most three times, recording timestamps/waits. If still failing after the third, stop and report the step.

## Report format (Chinese)

1. Per step: commit hash, changes, corresponding R2 IDs.
2. Exit codes for all five commands; failures verbatim after replacing token-like strings with `[REDACTED]`.
3. Step-five browser method/results.
4. Unfinished work and reasons.
5. Completion level per `D:/Projects/Software/agenthub/docs/DEVELOPMENT-PROCESS.md` section 2. All checks passing means "Code complete", not "Review passed".

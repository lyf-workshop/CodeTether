# Review record: ux/v4-device-first

- Branch: `ux/v4-device-first`, worktree `D:/Projects/Software/agenthub-ux-v4-device-first`
- Review range: `bbcda69..df91601` (9 feature commits; 3562f12 is a platform-permission test outside this review)
- References: `docs/ux-redesign/04-requirements.md` (third edition), `02-dev-handoff.md`, prototype; AGENTS.md
- Current status: round 11 completed (835489d installed), all 15 Windows installed-app acceptance items pass. Review approved, ready to merge (see DEVELOPMENT-PROCESS §2).

## Round 1 (D1, 2026-10-19)

Method: four parallel read-only code reviews (shell/devices, conversations, settings/attention/components, global audit). I spot-checked every Must fix finding and reran quality checks. No hands-on testing in the desktop app or browser.

### Quality checks

| Check | Result | Notes |
|---|---|---|
| `pnpm typecheck` | Pass | |
| `pnpm lint` | Pass | |
| `pnpm build` | Pass | |
| `pnpm test` | 1 failure, predates this branch | `packages/adapter-claude/test/detection.test.mjs:331` expected a test token but read the real local `ANTHROPIC_AUTH_TOKEN`. Reran without ANTHROPIC_* environment variables: 12 tests, 0 failures. This branch does not change adapter-claude. Tests should clear inherited ANTHROPIC_* variables before starting (separate task). |
| `pnpm format:check` | 659 files fail, predates this branch | All caused by workspace CRLF endings. `prettier --list-different --end-of-line auto` produces no output for changed files. |

Logs are outside the repo at `D:/Projects/Software/agenthub-archive/d1-*.log` (tokens redacted; do not commit).

### Must fix (M)

| ID | Location | Issue | Basis |
|---|---|---|---|
| M1 | `apps/web/src/components/projects/project-detail-page.tsx`; `machines/unpair-machine-dialog.tsx:103-126,148-156` | The Remove project from this device entry is gone. `project-locations-section.tsx` and `remove-project-location-dialog.tsx` are unreferenced. When a project has folders on both the local and paired devices, with local conversations, the paired folder blocks unpairing and the dialog offers only Got it; the entire project cannot be deleted because it has conversations, including archived ones. This paired device can never be unpaired. | AGENTS.md requires explicit location removal before unpairing; 03 §6 invariants |
| M2 | `apps/web/src/components/conversations/conversations-page.tsx` (1045 lines); `project-conversations-route.tsx` | `/projects/$projectId/conversations` now points to `ProjectDetailRoute` (`router.tsx:115-120`), so this page is never rendered, yet this branch changes it +72/−17. Fixes would land in dead code. | Code consistency |
| M3 | `apps/web/src/components/app-shell/workspace-sidebar.tsx:122` | Device-tree expansion exists only in `useState` and is lost on refresh. | G1: persist expansion locally |
| M4 | `apps/web/src/components/app-shell/workspace-shortcuts.ts:33-36` | Missing Ctrl B (⌘B on Mac) to collapse the sidebar. | G2 |
| M5 | `apps/web/src/components/app-shell/workspace-sidebar.tsx:346-351` | Sidebar + uses its own conditions instead of `machineCanAddProject` (`device-project-model.ts:14`), omitting the AI-tool execution check and differing from device list/detail pages. | Expose only real capabilities |

### Suggested fixes (S)

Conversations:
- S1 Keyboard focus is lost after sending: `composer.tsx:131-135` sets `hidden` on the editor wrapper while submitting, moving focus to body; it never returns (`conversation-workspace.tsx:111-131` only tracks `archivedAt`). The baseline used read-only without hiding. Screen-reader and keyboard users must Tab back after every message. Treat this accessibility regression as Must fix.
- S2 Manual conversation-creation retry duplicates: `new-conversation-actions.ts:80-81` generates a new actionId every time. Follow `live-conversation-actions.ts:137-139`: reuse actionId for the same selection unless Host explicitly rejected the last attempt (already present in baseline).
- S3 Old Chinese terms for Agent and inference backend remain: `pending-action-dock.tsx:122`, `live-conversation-actions.ts:387,392`, `conversation-gate-presentation.ts:227` (bypasses replacement at line 181), `conversation-controls.ts:269,345`. Change source strings to AI tool in Chinese.
- S4 New-conversation project list does not put Recently used first: `new-conversation-selection.ts:58-60`. Follow 04 C1 and add a "Recently used" group using the already-loaded `lastActivityAt` values.
- S5 Status and AI-tool filtering happens client-side over at most 100 records: `project-workspace-model.ts:68-80`, `conversation-list-query.ts:38-42`. Pass `status` and `provider` to `listProjectConversations` and include them in the query key.
- S6 Approvals appear in the pending-action strip above the composer rather than timeline cards (W6, prototype approveCard): `conversation-timeline.tsx:270`, `conversation-workspace.tsx:159-167`. Gating is correct; deviation accepted and recorded here. Synchronize the prototype when next edited.

Shell, devices, and projects:
- S7 Project-card metrics load only on hover: `machine-projects-section.tsx:108-122`.
- S8 Add-project race throws an English Error and misleading feedback: `add-project-dialog.tsx:168-170`.
- S9 Old Chinese wording for This PC / Location / Provider: `machine-actions.ts:446`, `project-actions.ts:341`, `previous-conversations-step.tsx:555,810-819`.
- S10 Replace native checkbox with the packages/ui component: `previous-conversations-step.tsx:640-655`.
- S11 Scattered magic numbers and breakpoints: `use-workspace-sidebar-width.ts:16,83`, `top-bar.tsx:248`, `machine-detail-page.tsx:225`, `startup-gate.tsx:75`. Consolidate into tokens or one constants file.
- S12 Unpair button remains enabled before Host is ready: `machine-detail-page.tsx:404`.
- S13 (unverified) `/devices` calls getMachine separately for each device: `machines-page.tsx:47-52`.

Global:
- S14 Phones/tablets authorized before v4 still renew access every 60 seconds, with no desktop place to view or revoke it: `main.tsx:117`, `local-supervisor-presence.tsx:91-124` (`/hosts` redirects). Before B1, add a read-only Authorized phones and tablets list in Settings › Account, without switches. B1 will take ownership.
- S15 English copy: `tool-presentation.ts:210,216,223,230,241` (failed-tool row headings), `provider-presentation.ts:403,408,426` (Provider …), `message-markdown.tsx:88` (Agent code block).
- S16 Composer demo branch remains: `composer.tsx:172`, Send message (demo). Make `controller` required.
- S17 Drafts are memory-only (W4 requires local persistence): `composer.tsx:60`. Drafts are prompts; initially use conversation-scoped memory plus `sessionStorage`, never `localStorage`, and record the decision in 02.
- S18 (unverified) Node documentation links may not open in the desktop app: `node-setup-instructions.tsx:63-70`; follow native opening in `provider-guidance-link.tsx`.
- S19 Over 2000 lines of dead code: `components/hosts/*`, `runtime/account/remote-conversation-read-model.ts`, `conversation/conversation-rail*`, `conversation/demo-conversation-adapter.ts`, `mocks/*`, `conversations/{project-conversations-route,conversation-page-states,project-summary,new-conversation-presentation}`, `runtime/host/conversation-list-view-state.ts`, `projects/{projects-page,project-locations-section,add-project-location-dialog}`, `inbox/inbox-filters.tsx`, `app-shell/route-placeholder.tsx`. Delete and remove/update associated tests. Reuse `remove-project-location-dialog` for M1.
- S20 Account page mentions unimplemented features without linking to Future plans: `account-settings.tsx:89-92` (O8).
- S21 Split files enlarged in this branch: `previous-conversations-step.tsx` 859 lines, `workspace-sidebar.tsx` 745, `conversation-organization-controls.tsx` 714, `add-project-dialog.tsx` 555. Also split the 1283-line `onboarding-page.tsx` while fixing UX-V4-001.
- S22 Risk-path tests regex-match source: `new-conversation-dialog.test.mjs:23-91`, etc. Add rendering tests: double-click sends once, 409 retains draft without resend, focus after send.

First-time setup (from `docs/UX-V4-REVIEW-NOTES.md`, discovered during actual use):
- S23 UX-V4-001: AI service not verified is described as Tool not ready. Show Installation, Execution, and Service separately; primary button Continue setup. Change only `onboarding-page.tsx` and `onboarding-model.ts`; acceptance checklist is in that file.

### Findings ruled out after verification

- `use-conversation-inspector-style.ts` uses `adoptedStyleSheets`: minimum macOS is 13.5 (`tauri.macos.conf.json:8`), whose system WebKit 16.6 supports it.
- None found: fake switches, Coming soon copy, runtime demo data, new network calls, `style=`, `!important`, colors outside tokens, or Zustand. Notification contents already omit conversation titles.

### Settings, Attention, and components

This review encountered API 524 twice, waited Retry-After 120 seconds, and resumed (02:50:27, 02:55:01 UTC; second continuation completed). Internals of `product/*`, `dialog/input/select/textarea` changes, `workspace-responsive.css`, and notification deduplication were not reviewed; cover in round 2.

Must fix:

| ID | Location | Issue | Basis |
|---|---|---|---|
| M6 | `packages/ui/src/styles/globals.css:23` (light `--ct-text-3: #8c877f`), `:68` (dark `#7f7b74`) | Insufficient secondary-text contrast. My WCAG calculation: light 3.42 on background, 3.19 on inset; dark 3.77 on surface. Small text needs 4.5. Affects Attention times/context lines, page footnotes, and Idle/Offline labels. | WCAG AA 1.4.3 |
| M7 | `apps/web/src/components/inbox/inbox-page.tsx:228`, `inbox-item.tsx:154` | `text-warning` (#c98512) on `bg-warning-muted` gives 2.74. Existing `text-warning-text` gives 5.39. | WCAG AA 1.4.3 |
| M8 | `apps/web/src/components/inbox/inbox-item.tsx:192-243` | Approval items this device cannot approve show only Open conversation, without a reason; completed items lack Got it. Host `resolveAttention` rejects approval items (`host-service.ts:3220-3225`, 422), so they must explain the reason rather than offer Got it. | N2 |

Suggested fixes:
- S24 Notification body lacks device name: `desktop-notification-model.ts:84`, `main.tsx:87-92`. N4/N5 require type, Device · Project, and one explanatory sentence.
- S25 Always on is paired with a gray offline dot: `background-settings.tsx:18`; `backgroundRuntimeAvailable` in `desktop-notification-settings.tsx:35` is unused.
- S26 Nested `<main>`: `roadmap-page.tsx:69` nests one inside `main-content.tsx:9`.
- S27 `Notice` defaults to `role="status"` (`notice.tsx:39`), announcing static explanations on every mount. Omit by default; callers opt in when needed.
- S28 `command-list.tsx:116,166`: listbox contains `<h3>` and `role="status"`; `aria-expanded` is always true.
- S29 Notification switch lacks `aria-describedby`: `desktop-notification-settings.tsx:80`.
- S30 `attention-row.tsx:31,58`: two buttons squeeze out the title on narrow screens.
- S31 Hardcoded Settings breakpoints: `settings-page.tsx:36,61`, `appearance-settings.tsx:38` (merge into S11).
- S32 Desktop background is still dark blue `#07111f` (`apps/desktop/src-tauri/tauri.conf.json:26`), flashing at launch although light is now the default.
- S33 Attention says Local service temporarily unavailable even when Host is connected but the query fails: `inbox-page-states.tsx:35-37`.
- S34 View result navigates only if `resolveAttention` succeeds: `inbox-actions.ts:42`. Opening the conversation must work even on failure.
- S35 Resending login codes lacks a local cooldown: `sign-in-page.tsx:211`.
- S36 Settings tests mostly regex-match source: `settings-v4.test.mjs:157-221` (merge into S22).
- To verify: `statuses.ts` labels every `waiting` as Awaiting approval; other meanings would violate N1/N7. Claude badge white text on `#d97757` is about 2.9. Can the `index.html` theme initialization script execute under release CSP?

Ruled out after verification:
- Phone home grouping by device (C8, E11) is absent, but belongs to tablet/phone stages T1/M1. Desktop N1 calls for a flat filtered list, so current behavior is correct.
- Verified correct: notification settings persist and roll back on failure; one theme authority, default light; login uses `shouldCreateUser: false`, Chinese errors, no token leakage; Attention uses `listAttention`, with approval gated by device and AI-tool capabilities; Future plans has no controls; all Button/Badge variants used by `apps/web` remain.

### Conclusion

Do not merge. There are 8 Must fix findings (M1–M8) and 36 suggestions. Fix M1–M8, S1, and the suggestions listed in the prompt before round 2. Fix prompt: `ux-v4-device-first-fix-prompt.md`.

## Round 2 (2026-10-20, review df91601..33f5b5d, 13 commits)

Method: two read-only reviews (verify fixes individually; review deletions, splits, and round 1 omissions). I spot-checked every Fix needed item below. No hands-on desktop, Mac, or phone testing.

### Quality checks (rerun by me, without ANTHROPIC_* environment variables)

typecheck, lint, test, and build all exited 0. Tests: 2255 total, 2241 pass, 0 failures. Prettier passes for all 203 changed files (passing all 203 at once exceeded Windows command-line length; batched rerun exited 0). Logs: `D:/Projects/Software/agenthub-archive/d1r2-*.log`.

### Round 1 issue status

| ID | Status | Notes |
|---|---|---|
| M1 | Fixed | Device detail and unpair dialog both offer Remove from this device, gated on this device's conversations including archived ones, then preflight again. Test rerenders changed props instead of clicking the full flow. |
| M2, S19 | Fixed | Deleted modules in df91601 were referenced only by barrels changed in that same commit, not routes or `main.tsx`. |
| M3 | Fixed | `ct-workspace-tree-expansion` stores only strictly validated IDs; invalid data becomes empty. |
| M4 | Fixed | Ctrl B / ⌘B, suppressed during composition and in inputs. |
| M5 | Partial | Uses `machineCanAddProject`, but + simply disappears when an online device cannot add, without explaining why (`workspace-device-section.tsx:89-97`). |
| M6, M7 | Fixed | New light `#68635c`, dark `#96928b`; `token-contrast.test.mjs` reads actual CSS. |
| M8 | Fixed | Explains unavailable approval; completed items have Got it; approval items do not. |
| S1 | Partial | Read-only while submitting, but editor still hides during AI-tool `running`/`waiting` (`composer.tsx:82`), leaving focus on body for the entire run. |
| S2, S14, S17, S24 | Fixed | Notification body is Device · Project without title. |
| S6 | Deviation accepted | |
| S18 | Not done, justified | Native opening accepts only fixed Codex/Claude Code destinations; changing the native command is outside this round. Separate task. |
| Status labels | Verified correct | Host sets `waiting` only for approval requests (`approval-registry.ts:185`), so Awaiting approval is correct. |

New conversation: desktop creation now has no initial message or model selection, matching 04 C1 and W13. Round 1 prompt step 10 incorrectly required both before creation; C1 is authoritative. The coding agent's report says As confirmed by user; it should cite C1.

### Fix needed (round 3)

| ID | Location | Issue |
|---|---|---|
| R2-1 | `composer.tsx:82` | S1 incomplete: editor hides while running and loses focus. Keep mounted and read-only while running; test submitting → running → idle. Accessibility regression, mandatory fix. |
| R2-2 | `globals.css:40`; `conversation-files-surface.tsx:54`, `inspector-panel.tsx:215`, `conversation-timeline.tsx:134` | `text-success` as text gives 3.47 in light mode (my calculation), same class as M7. Use `text-success-text` and add success to contrast tests. |
| R2-3 | `machine-actions.ts:384,398,400,404,418,444` | Mechanical replacements produced malformed Chinese messages meaning This computer operation is in progress, This computer operation unsupported, and Check the six-digit code displayed by Node. |
| R2-4 | `workspace-device-section.tsx:89-97` | M5 incomplete: explain why adding is unavailable. |
| R2-5 | `workspace-responsive.css:91-105` | S30 ineffective: old rules outside CSS layers override new Tailwind classes, making narrow-screen buttons a third column. Test checks only class names. |
| R2-6 | `workspace-responsive.css:68-81` | At widths ≤ 600px, half the Add project/New conversation overlay is off-screen: only `transform` was reset, while Tailwind v4 `translate`/`scale` are independent properties. Desktop minimum width 1100 is unaffected. |
| R2-7 | `machine-projects-section.tsx:131-134` | S7 now loads every card's metrics at mount; load when visible instead. |
| R2-8 | `attention-notification-metadata.ts:30-34` | Every notification fetches up to 100 conversations again. Read cache first. |
| R2-9 | `apps/web/test/user-visible-copy.test.mjs:8,47` | Copy scan omits `packages/ui/src`. |
| R2-10 | `project-location-removal-ui.test.mjs:307-335` | Add a full click-through M1 test: remove → confirm → Host update → dialog allows unpairing. |
| R2-11 | `new-conversation-provider-selection.ts:91-107` | Delete `defaultProviderControls` and `defaultProviderModel`, now used only by tests. |

### Recorded without fixes (revisit after merging)

- N4 already on-screen judgment: Attention never notifies even when filters hide an item; project/device pages always notify.
- `ProjectCard`, `SessionItem`, `DeviceSection` hardcode heading levels; copy button changes role from status to alert after mount.
- 24 files in `apps/web/src` still exceed 400 lines (largest `control-plane-client.ts`, 1470); splitting was not requested this time.
- Stale IDs in tree expansion are not cleaned up; Ctrl B also works on Mac.
- S18 native Node documentation opening (separate task).
- adapter-claude tests do not isolate ANTHROPIC_* environment variables (separate task).

### Conclusion

Still cannot merge, but close to acceptance. No new Must fix findings; R2-1 and R2-2 are mandatory accessibility fixes; the rest are small. After R2-1 through R2-11, I will review only these changes in round 3, then move to your acceptance. Fix prompt: `ux-v4-device-first-fix-prompt-r2.md`.

## Round 3 (2026-10-20, review 33f5b5d..b1e1ccf, 7 commits, 38 files)

Method: I read all source changes directly. No hands-on desktop, Mac, or phone testing.

Quality checks (rerun by me without ANTHROPIC_* environment variables): typecheck, lint, test, build, and changed-file Prettier all exited 0. Tests: 2280 total, 2266 pass, 0 failures, 14 skipped. Logs: `D:/Projects/Software/agenthub-archive/d1r3-*.log`. Boundaries: no changes to `apps/host`, `apps/desktop`, `apps/node`, `packages/protocol`, `packages/client`, Control Plane, or Relay.

| ID | Result |
|---|---|
| R2-1 | Fixed. Editor hides only when archived or unavailable; remains mounted/read-only while running or awaiting approval (`composer.tsx:82,227`). |
| R2-2 | Fixed. Neither source tree still uses `text-success/warning/danger` as text colors. |
| R2-3, R2-9 | Fixed. One old term, Node address, remains (`update-machine-address-dialog.tsx:130`); grammatical, recorded without fixing. |
| R2-4 | Fixed. Sidebar and device page share `machineCannotAddProjectReason`. |
| R2-5 | Fixed. Old CSS removed; breakpoint uses `phone` variant (`globals.css:12`, ≤ 37.5rem). |
| R2-6 | Fixed. `translate: none` and `scale: none` are separately written inside `@supports` to prevent production minification merging them into `transform`. |
| R2-7 | Fixed. Metrics load after the card enters the viewport; observer disconnects during cleanup. |
| R2-8 | Fixed. Reads cache first. |
| R2-10, R2-11 | Fixed. |

Recorded without fixing: an extra `<div>` around project cards may make cards in the same row uneven; inspect during acceptance.

Conclusion: **review approved**. Current status: review approved, awaiting your acceptance.

## Acceptance (performed by you)

### Acceptance on the installed version

As requested (2026-10-20), the installed Windows version now comes from this branch:

- Source b1e1ccf. Unmerged and untagged; displayed version remains 0.1.0-alpha.0. This is an exception to the rule that installed versions come from main tags.
- Installer SHA256 starts CBD7BC93B7A40C61; unsigned.
- Verified while running: Host reports `hostVersion` `git-b1e1ccf123c7`, protocol 1. Exactly one Desktop and one Host run from the installation directory; this Host listens on 4317.
- Uninstall retained the database, pairing credentials, and WebView data, reused by the new version. First-time setup may therefore not appear; previous projects and paired devices remain.
- Previous version/data backup: `D:/Projects/Software/agenthub-archive/windows-install-backup-20261020-pre-v4`; rollback steps in its RESTORE.txt.
- Installation report: `D:/Projects/Software/agenthub-archive/v4-install-report-20261020.md`.

Open CodeTether from Start and use this checklist.

### Windows acceptance checklist

| # | Check | Basis | Result |
|---|---|---|---|
| 1 | First-time setup separates Installation, Execution, and Service; primary button Continue setup | UX-V4-001 | |
| 2 | Add a project, discover and import previous Codex / Claude Code conversations | P series | |
| 3 | Sidebar: expand/collapse devices/projects, retain after restart; Ctrl B collapses/expands | G1, G2 | |
| 4 | New conversation: choose project/AI tool without requiring an initial message; send first message afterward | C1 | |
| 5 | Continue typing after send without the mouse (composer is read-only while AI tool runs, but retains focus) | S1, R2-1 | |
| 6 | Local Codex: Stop, Allow once / Deny approval, and Changes panel work | W series | |
| 7 | Claude Code: no Stop or approval buttons; explanatory copy appears | Expose only real capabilities | |
| 8 | Attention contains all three categories; Failed/Completed have Got it; unavailable approval explains why | N1, N2, M8 | |
| 9 | System notification: Device · Project plus explanation, no conversation title; click opens conversation | N4, R4 | |
| 10 | Settings: Light/Dark/System switch, persist after restart, no dark-blue launch flash | O3, S32 | |
| 11 | Secondary text (times, footnotes) is legible | M6 | |
| 12 | Future plans lists only unimplemented features; no fake switches elsewhere | O8 | |
| 13 | Draft survives switching conversations and returning, but not closing the app | S17 | |
| 14 | No English sentences or the Chinese terms `智能体` and `此电脑` in the UI | Chinese UI | |
| 15 | Project cards have even heights | Round 3 record | |

With a paired Node, also verify that removing the project from that device permits unpairing (M1).

Item 1: retained data may suppress first-time setup. If Settings exposes AI-tool status, check the separate Installation/Execution/Service states there (I have not confirmed that entry exists). Otherwise retest later with an empty data directory.

### Mac

The Mac needs this branch, currently local and unpushed. Mac acceptance requires your approval to push `ux/v4-device-first` to GitHub, not main. Use the same checklist plus ⌘B and correct rendering on macOS 13.5.

### Acceptance results

First installed-app check (2026-10-20, agent inspected the installed window directly; installation report section 9):

- Pass:
  - Chinese UI, sidebar grouped by Device › Project;
  - Light/Dark switching;
  - Devices, Settings, Health check, Add device, and New conversation dialog (explains unavailable directory and disables Create);
  - Ctrl K opens search; Esc closes it and returns focus to the search button;
  - No obstruction or horizontal overflow around 1100×700.
- Codex 0.149.1 and Claude Code 2.1.251 detected. AI service shows Not checked, the correct unknown state.
- Two old projects are inaccessible because their registered directories no longer exist, unrelated to this installation.
- Fail: R4-1. Local Windows Add project example is `/Users/user/project`.
  - Cause: Host reports platform `Windows`, but frontend `add-project-fields.tsx:157-163` accepts only lowercase `windows` and `win32`. Lowercase fixtures hid the bug.
  - I verified source. This is the frontend's only case-sensitive platform comparison.
- Not tested:
  - Sidebar persistence after restart and Ctrl B;
  - Launch color flash;
  - Conversation creation and sending;
  - Codex Stop, approval, Changes;
  - Claude Code explanation;
  - Attention and system notifications;
  - Drafts;
  - Console errors.

Results after R4 follow.

## Round 4 (2026-10-20, review b1e1ccf..2d9ad41, 1 commit, 4 files)

Fix for R4-1. I reviewed the commit:

- Adds case-insensitive `machinePlatformFamily`, consistent with `machinePlatformLabel`.
- Local examples: Windows `C:\Projects\我的项目`, macOS `/Users/user/project`, other/remote devices `/home/user/project`.
- Fixtures now use Host's actual `Windows`; adds classification-function unit tests.
- All checks exit 0: 2307 tests, 2293 pass, 0 failures, 14 preexisting skips.

Conclusion: review approved. New installer SHA256 starts 34F4A788CD6F51DB; running `hostVersion` is `git-2d9ad41f7e38`. Report: `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r4.md`.

### Installed-app acceptance (second check, agent inspected installed window)

- R4-1: Pass.
- 8 pass: 3, 4, 5, 7, 11, 12, 13, 15.
- 1 fail: 14. Claude Code search step shows English `Search workspace`.
  - Fixed summary in `packages/adapter-claude/src/normalizer.ts`. Same function also has `Read file`, `Edit file`, `Run unavailable tool`, `Run tool`.
  - Codex approval-summary fallbacks are also English: `Codex requested command approval`, `Codex requested file or permission access` (`packages/adapter-codex/src/normalizer.ts:428`, `436`).
- 6 not tested:
  - 1, 2: no first-time setup reset or previous-conversation import, restricted by R4.
  - 6: first Codex turn failed with `provider_error`; test folder stayed empty, preventing Stop/approval/Changes tests. PATH now has 0.162.1; adapter tested 0.149.1, also shown at the first installation check. A clue, not a confirmed cause.
  - 8: no approval item, same reason as 6.
  - 9: no system notification within 90 seconds. Windows notification settings and Desktop stderr were not checked.
  - 10: approximately the first 1.4 seconds were missed.

Next: follow `ux-v4-device-first-fix-prompt-r5.md` for Chinese summaries, icons, and Codex diagnosis; reinstall once, then retest 1, 2, 6, 8, 9, 10, 14. Once accepted, merge into main and tag, asking you at each step.

## Round 5 (2026-10-21, review 2d9ad41..9de2279, 3 commits)

Report: `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r5.md`.

### Code

- 57a30ec `fix(adapters): use Chinese tool summaries`: Pass.
  - Claude Code summaries translated per R5 table; failure summary is <summary> failed in Chinese. Path summaries retain byte bounds; adds a 2000-character Chinese path test.
  - Codex approval fallbacks now request command execution or file/permission access in Chinese.
  - Fallback conversation titles now Claude conversation / Codex conversation in Chinese. Minor inconsistency: Codex joins time with ` — `, Claude with ` · `; standardize to ` · ` in R6.
- c350190: rejected kite icon, retained only as historical commit, no longer acceptance evidence.
- 9de2279 `feat(desktop): replace app icon with CodeTether stacked cards mark`: Pass.
  - `icons/source/*.svg` matches `docs/ux-redesign/icon/final/` byte for byte.
  - ICO has 6 layers, first 32 pixels (window/tray default to first layer); ICNS uses PNG types.
- All checks exit 0: 2314 tests, 2300 pass, 0 failures, 14 preexisting skips.
- Installer SHA256 starts 51A5EC704F84FD3C; running `hostVersion` is `git-9de227968aa7`.

### Installed-app acceptance (third check)

- 10 pass: 1, 2, 3, 4, 7, 10, 11, 12, 13, 15.
  - 1 tested with empty `CODETETHER_DATA_DIR`; normal launch afterward retained original data.
  - 10 sampling script launched the app; first frame had no dark blue.
- No failures.
- 5 not tested:
  - 5: successful send used a button, then minimized; keyboard attempt produced no turn.
  - 6, 8: selected Codex 0.149.1 still gave `provider_error`, no approvals/file changes. PATH 0.162.1 ran directly; key protocol structures match. Public API lacks raw `codexErrorInfo`; cause unresolved.
  - 9: app Enabled=1, system notifications on, DND off, no notification within 90 seconds, no `notification delivery failed` in Desktop stderr. Start shortcut AppID is `com.codetether.desktop`, yet `Get-StartApps` omits CodeTether.
  - 14: new summaries are Chinese. Old English history remains unmigrated; no verdict because acceptance boundary was undefined.
- Icons: stacked cards confirmed only in title bar. No new taskbar/tray/Start/Explorer screenshots. Kite version's taskbar still showed the old blue C, suggesting cache.

### My assessment of untested items

- Codex: all failure paths end at `provider_error`, hiding the category. Next log only original error type name and HTTP status to Host stderr, reproduce once, then decide. If old 0.149.1 itself is at fault, ask permission to select 0.162.1 in Settings.
- Notifications: Desktop logs failures only, not successful Windows calls, so frontend non-invocation and Windows non-display are indistinguishable. Windows may discard notifications for an AppID missing from `Get-StartApps`. Next send a native control notification with the same AppID, then add success logging and retest.
- 14: boundary is fixed text generated by the current version. Exclude old history, AI-tool original text, tool names, commands, paths, and Failure code values; list these in the report.
- 5: use a Claude Code turn with the window foregrounded and Enter to send.

Next: follow `ux-v4-device-first-fix-prompt-r6.md` to add diagnostics, standardize fallback titles, reinstall once, and retest 5, 6, 8, 9, 14 plus four icon locations. After acceptance, merge main and tag, asking you at each step.

## Round 6 (2026-10-21, review 9de2279..4f30416, 2 commits)

Report: `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r6.md`.

### Code

- a2f78db `fix(adapter-codex): log Codex failure variant`: Pass.
  - Failure stderr contains only type name, HTTP status, and canonical reason; type name has character/length limits; logging errors cannot affect the failure outcome.
  - Codex fallback title uses ` · `.
  - Classification unchanged, as required by R6.
- 4f30416 `fix(desktop): log attention notification delivery`: Pass.
  - Logs type/AppID after Windows accepts a notification, and skip reasons for deduplication. Tests verify no titles, body text, or identifiers.
  - One test import in each of two other Rust files fixes Windows test compilation; user approved.
- All checks exit 0: 2317 tests, 2303 pass, 0 failures, 14 preexisting skips. 69 Rust tests pass.
- Installer SHA256 starts 56A1841DDD8BCF93; running `hostVersion` is `git-4f30416e4307`.

### Installed-app acceptance (fourth check)

- 2 newly pass:
  - 5: third attempt used real Enter; focus stayed in the same read-only input while running, then keyboard typing worked directly. First two attempts never entered the input or produced turns; recorded accurately.
  - 14: checked Devices, Projects, Attention, five Settings pages, Conversation, Future plans, and First-time setup against the R6 boundary. Fixed product copy is Chinese, without prohibited terms.
- Cumulative 12 pass, 0 fail, 3 not tested (6, 8, 9).
- 6: reproduced `variant=other httpStatus=none reason=provider_error`. `other` is Codex protocol's own fallback category and reveals no cause. User chose the latest Codex.
- 8: Awaiting approval still absent; must wait until Codex works.
- 9: two Windows control notifications both returned `DisabledForApplication`; see below.
- Icons:
  - Title bar and Explorer show new stacked cards;
  - Taskbar still shows kite, an icon cache issue;
  - Tray screenshot not saved after window position changed;
  - Start cannot find app.

### Additional read-only notification investigation (no settings changed)

- The report says the Start shortcut existed, true only at reinstall time. Now `%APPDATA%\Microsoft\Windows\Start Menu\Programs\CodeTether.lnk` is absent, as is the global Start shortcut; only the desktop shortcut remains. Removal time/cause unknown. Start search failure and omission from `Get-StartApps` agree.
- PowerShell is not a valid control: its `Enabled=0` already disables notifications. Chrome, QQ, Claude, Codex, etc. return `Enabled`, so Windows notification infrastructure works; the issue concerns only CodeTether's app identity.
- CodeTether has `Enabled=1` but still returns `DisabledForApplication`. Last notification received on 2026-08-29.
- Local account is built-in Administrator; both CodeTether and Explorer run elevated. Recorded without evidence of a notification connection.

Next: follow `ux-v4-device-first-fix-prompt-r7.md` to select Codex 0.162.1 and retest 6/8, restore Start shortcut then investigate/retest 9, and capture tray/Start icons.

## Round 7 (2026-10-21, retest, HEAD still 4f30416, no new commits)

Report: `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r7.md`. Reinstalled once with the original R6 installer; data unchanged and `hostVersion` `git-4f30416e4307`.

### Installed-app acceptance (fifth check)

- 2 newly pass:
  - 6: four turns worked after selecting Codex 0.162.1. Stop yields interrupted and re-enables composer; approval appears in Attention and clears after Deny; new file appears in Changes and opens at the matching location.
  - 8: Awaiting approval 1, To review 13, Failed 11 visible together. Dismissed one completed item from this round with Got it; older items untouched.
- Cumulative 14 pass, 0 fail, 1 not tested (9).
- Icons: tray shows new stacked cards; no new taskbar screenshot; Start cannot find app.

### Two additional read-only findings

1. Cause of missing line diffs for added files found.
   - Codex sends full file content as `diff` for additions, rather than unified diff. Test file was 27 bytes; report `diffLength=27` matches exactly.
   - Frontend `parseUnifiedDiff` (`apps/web/src/runtime/host/conversation-projection.ts:1344`) recognizes only lines starting `+`, `-`, or space, so recognizes none of the full content and shows `+0` with No displayable diff provided.
   - Deletions likely behave similarly. Modifications use unified diff and are unaffected.
   - Item 6 only requires a usable Changes panel, so remains Pass, but +0 for additions is a real bug to fix in R8.
2. Start shortcut disappearance and disabled notifications likely result from installing inside the Codex desktop app.
   - Codex desktop is an MSIX Store app; installers it launches writing `%APPDATA%` are redirected to `%LOCALAPPDATA%\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Roaming\Microsoft\Windows\Start Menu\Programs\CodeTether.lnk`, timestamp 09:12:53 UTC, exactly the R7 installation time.
   - Inside Codex the agent sees a merged view, explaining nine checks finding the shortcut. The actual Start directory lacks it, so Windows never registers the app: `Get-StartApps` returns 0, Start cannot find it, notifications return `DisabledForApplication`, and Windows notification settings omit it.
   - NTFS journal has no CodeTether.lnk record in the real Start directory, while installed files have records, consistent with redirection. Desktop shortcut is on E: and unaffected.
   - Earlier `CodeTether-rollback` and `com.codetether.v4-preview` shortcuts share that redirected directory, indicating prior installs inside Codex.
   - `%LOCALAPPDATA%\CodeTether` and application data are real locations, unaffected.
   - Fix: installer and first launch must happen outside Codex desktop, by user double-click or ordinary terminal.

Next: follow `ux-v4-device-first-fix-prompt-r8.md` to fix added/deleted file diffs, package for user installation outside Codex, then retest 9, additions, and Start/taskbar icons.

## Round 8 (in progress)

Code review: `9800ae2 fix(adapter-codex): show added and deleted file content as diffs`, approved.

- Conversion occurs only in adapter-codex normalization: additions/deletions lacking unified-diff markers get an `@@` header and per-line `+`/`-`; missing final newline gets `\ No newline at end of file`. Modifications, renames, unknown types stay unchanged.
- Deduplication uses original Codex content; if conversion exceeds 4 MiB, only diff content is dropped, retaining path/type.
- Tests cover multiple/single lines, no trailing newline, Chinese, existing unified diffs, size boundaries; frontend adds one parser case.
- Minor, nonblocking: content lines starting `--- `, `+++ `, or `@@ -n +n @@` can be mistaken for existing unified diff and stay unconverted, showing `+0` again. CRLF content retains `\r`. Decide after hands-on testing whether to fix.

Packaging: Desktop packaging denied by tool policy; user ran `.tmp/v4-r8-desktop-build.sh` in ordinary PowerShell outside Codex. I reviewed the script: checks only presence of three environment variables without printing values, requires clean tree, redacts logs with sed, does not overwrite logs. R6 installer archived in `agenthub-archive/installers/4f30416/`, SHA256 matches R6.

Post-install checks (read-only verification by me):

- User ran installer outside Codex (Claude Code `!` command). Real Start has `CodeTether.lnk` (02:25), `Get-StartApps` lists `com.codetether.desktop`, running version `git-9800ae2f8b7d`. R7 Start failure confirmed caused by Codex redirection, now resolved.
- Desktop hash mismatch explained: equal-sized files differ by 3 bytes at `__TAURI_BUNDLE_TYPE_VAR_`: build has `UNK`, installed copy `NSS`. Tauri patches installer type into its bundled copy; expected, not a bug.
- Notification state: ordinary PowerShell `CreateToastNotifier(...).Setting` returns empty, an unreliable query no longer used for judgment. Registry `Notifications\Settings\com.codetether.desktop` has `Enabled=1`, no global disabling entry. Test item 9 directly instead.

Hands-on results (R8 report sections 16–21, verified by me):

- Added/deleted diffs pass: Codex creates 3-line file showing `+3` and all added lines, then deletion shows `-3` and all deleted lines. Screenshots `30-r8-diff-add.png`, `31-r8-diff-delete.png`.
- Icons pass: taskbar and Start search show new purple stacked cards (`icons-taskbar-01.png`, `icons-start-menu-visual-08.png`), without clearing cache. All five locations now confirmed: title bar, tray, Explorer, taskbar, Start.
- Item 9 mostly passes: logs show `notification shown type=completed_review` and `type=failed`, no skipped. Native history has 2 CodeTether notifications, Local computer · v4-accept-project plus explanation, no conversation title. Missing Start registration confirmed as pre-R7 delivery cause.
- Item 9 still lacks click verification: Claude Code failed with gateway `provider_service_unavailable`, generating a failure notification. UIAutomation could not identify one unique card, so no click or conversation navigation verified. Gateway failure is outside this branch; no code changes.
- Raw logs redacted/deleted after user exit; processes and port 4317 cleared. R5/R7 test files retained.

Next: follow `ux-v4-device-first-fix-prompt-r9.md` with 1 Codex turn to trigger completion notification and verify click routing. No code changes/reinstall.

## Round 9

Retest only, no code changes. Report: `v4-acceptance-report-r8.md` section 22.

- Read-only Codex turn sent 01:33, completed 01:35. Generated 1 `completed_review` Attention item and one additional history notification: CodeTether · Work completed / Local computer · v4-accept-project / AI tool completed this turn, without conversation title. Notification-copy half passes.
- Agent could not identify a unique card through Win+N and did not click. User clicked in Notification Center around 01:45. Across 23 subsequent samples, window stayed minimized and route remained `/c/conv_…`, without `turn` or `notification-N`. Item 9 fails.
- I read source: Windows clicks rely only on in-process `ToastNotification.Activated` (`attention_notifications.rs:336`). XML has no `launch`, shortcut no `ToastActivatorCLSID`, no COM activator. Click occurred 10 minutes after banner timeout on the retained Notification Center item. Microsoft docs do not guarantee an in-process event then; comment at `:354` assuming clicks work after timeout was untested.
- No `activated` log exists, so cannot distinguish absent callback from `show_main_window` failure (which logs `could not restore`, but R9 captured no logs).

Next: follow `ux-v4-device-first-fix-prompt-r10.md` to log activation/dismissal, reinstall, test banner/Notification Center clicks separately, then choose a fix.

## Round 10 (in progress)

Code review: `bb1d55b fix(desktop): log notification activation and dismissal`, approved. Only `attention_notifications.rs` changed: activation callback logs `notification activated type=… repeat=…` immediately before deduplication; dismissal logs `notification dismissed reason=…`. Neither includes title/body/identifiers, verified with test sentinels. Activation logic unchanged.

Installer `D210320D…A411`, 26,725,660 bytes, rechecked by me. Logs contain no key. R8 installer backed up in `installers/9800ae2/`, matching hash; missing SHA256SUMS.txt there is immaterial.

Hands-on results (`v4-acceptance-report-r10.md`, sanitized logs verified by me):

- Both Codex turns completed, each generating `completed_review`. Each logged `shown`, then `dismissed reason=TimedOut` about 6 seconds later; banner lasts approximately 6 seconds.
- Test A: user missed banner, no click, result unobserved.
- Test B: user clicked latest item in Notification Center after timeout. No `notification activated`, `main_window_restored`, or `could not restore`; window stayed minimized. Entire log contains 0 activated events.
- Conclusion: Notification Center click neither invokes in-process `Activated` nor relaunches app (single-instance plugin would restore window). Matches round 9 hypothesis and Microsoft's unpackaged-desktop documentation. Without A control, only Notification Center failure is proven, not banner success. Returning later and clicking Notification Center is the main use case, so fix regardless of A.
- Other: R10 full-repo `pnpm format:check` fails on 617 files; spot checks show Windows checkout CRLF, predating this round. Handle separately before merge.

Next: user selected `codetether://` registration instead of COM. Follow `ux-v4-device-first-fix-prompt-r11.md`, then test Notification Center, banner, and app-not-running clicks.

## Round 11 (in progress)

Code review: `835489d fix(desktop): activate notifications through protocol links`, approved. 17 files, no Host changes.

- Registration: official `tauri-plugin-deep-link` 2.4.9 and existing NSIS template, Windows-only in `tauri.windows.conf.json`. Single-instance plugin enables `deep-link` and is first. Development builds do not register at runtime.
- Parsing (`notification_links.rs`): strict prefix, no decoding/case conversion, IDs validated by `is_public_id(…, "attn_")`, length bounded. Anything other than 2 arguments is invalid; never assemble links from single-instance arguments. Invalid links only restore window. Logs contain only matched/unmatched/invalid.
- Activation: find in-memory intent by attention ID and use existing `activate_notification`; otherwise frontend checks open/resolved/expired lists once each (at most 100 per list), navigating only on one unique ID match. Attention-ID deduplication permits only one activation if callback and link both arrive.
- Cold start processes arguments after `desktop_ready`, correct ordering.
- Minor, nonblocking: frontend searches latest 100 only; older alerts restore window without navigation. Acceptable.

Installer `37712481…1589`, 26,739,086 bytes, rechecked by me. Logs contain no key. R10 installer backed up in `installers/bb1d55b/`, with SHA256SUMS.txt.

Hands-on results (`v4-acceptance-report-r11.md`, sanitized logs verified by me):

- Install/registration: `HKCU\Software\Classes\codetether` registered; open command is installed `codetether-desktop.exe "%1"`.
- Test B, Notification Center: `shown` → `dismissed reason=TimedOut` → `activated repeat=false` → `main_window_restored` (22 ms) → `link received result=matched`. Window foregrounded, route includes this turn and unique `notification-1`, exactly one navigation. Pass.
- Test C, app not running: after user exit, Desktop/Host both 0. Clicking retained notification launched new process (10:43:10), window visible/foregrounded, correct conversation/turn route, one navigation, unchanged data counts. Pass. No redirected logs on this launch, so no C log lines.
- Test A, banner: both turns used for B/C, untested. B proves click path works; A does not change conclusion.
- Link safety: `codetether://notification/attn_invalid` returns `unmatched`; `codetether://other` returns `invalid`. Both only restore window, leaving route/Attention state unchanged. Pass.
- Screenshots: B/C title bars not captured because window was already minimized when attempted. Functional conclusions rely on contemporaneous window state, route, and logs recorded by Codex; only screenshots are missing.
- Raw logs redacted and deleted.

Item 9 passes: copy verified in round 8; click-to-conversation verified now. All 15 Windows checklist items pass.

Formatting: full-repo `pnpm format:check` fails 617 files because local `core.autocrlf=true` yields CRLF working files and LF index. With `--end-of-line auto`, only 3 remain (`host-presence-diagnostics.ts`, `host-presence-publisher.ts`, `docs/PRODUCT.md`), already unformatted on main and untouched here. Not merge blockers; handle separately later.

Merge: `ux/v4-device-first` is 39 commits ahead of main and can fast-forward. With user approval, fast-forward local main to 835489d. Ask separately before pushing/tagging. Mac installed app not accepted yet; branch must be pushed first.

## Mac round 1

Report: Mac `~/agenthub-archive/v4-acceptance-report-mac.md` (user forwarded full contents; I cannot read Mac files directly).

- Build `git-835489dd3c9e`, `.dmg` SHA256 `c2d58c5f…24e0`, ad-hoc signed, not notarized. Complete previous-version/data backup, file counts/sizes matched.
- 9 pass: 3, 4, 7, 8, 11, 12, 13, 14, 15. 0 fail. 6 not tested: 1, 2, 5, 6, 9, 10; icons also unchecked.
- 3 `pnpm test` failures: Windows installer path tests treat Windows paths as relative on macOS. Cross-platform test issue, not product defect. Fix separately later; not blocking acceptance.
- Production data gained 1 test project/conversation (10/2/24 → 11/2/25). No conversation deletion feature, so retain. User may restore backup if unwanted.
- Risk: macOS activation looks up intent only in memory (`macos_notifications.rs:66-77`); after app exit, click might only open window without conversation. Windows fixed this with R11 links; Mac not yet. Test in round 2.
- Build configuration saved on Mac at `~/agenthub-work/v4-build.env` (mode 600), not requested by prompt. Contains publishable key; keep out of repo; user decides whether to delete.

Next: follow `ux-v4-device-first-mac-acceptance-prompt-r2.md` for remaining tests.

## Mac round 2

Report forwarded in full by user. 11 pass, 2 fail (5, 9), 2 not tested (6, 10).

- 1/2 pass: first-time setup with isolated data, imported 1 prior Codex conversation. Production data untouched, still 11/2/25.
- 6 partial: Stop works; added/deleted files show `+3`/`-3` and line content. No approval because `sleep` needs none in Codex default `workspace-write` sandbox (`packages/adapter-codex/src/client.ts:324-326`). Allow once/Deny untested.
- 5 fail is likely my incorrect criterion: round 2 prompt asked to type while running, an error by me. Design deliberately makes running composer `readOnly` plus `aria-disabled` (`composer.tsx:227-228`), so accessibility reports Disabled and typing cannot work. Checklist requires retained focus and typing directly after completion, the Windows pass criterion. Retest correctly in round 3.
- 9 fails, cause unknown: no CodeTether notification in Notification Center twice, no logs captured. Could lack macOS permission (requested only on first notification, `macos_notifications.rs:260-287`) or notification never sent. Investigate with logs in round 3, no fix yet.
- 10: System theme and restart persistence pass; first frame missed.
- Icons: About window and `icon.icns` show new icon; Dock/Launchpad/menu bar not captured.

Next: follow `ux-v4-device-first-mac-acceptance-prompt-r3.md` to diagnose notifications, retest 5/6, capture 10's first frame and icons.

## Mac round 3

User forwarded full report and sanitized logs. 13 pass, 1 fail (9), 1 not tested (10).

- 5 pass: focus remains in composer after both sends; typing `abc` directly after completion succeeds.
- 6 pass: writing outside project triggered approval; Deny created no file, Allow once created correct file.
- 9 fail: all three switches on; CodeTether appears in system Settings, but 55 seconds minimized awaiting approval produced no notification. Entire log lacks `notification shown`, `skipped`, `delivery failed`, `could not restore`. 37 `provider-unknown-notification` lines are Host suppression of unknown Codex events, unrelated to desktop notifications.
- My source-based assessment:
  - macOS successful sends are not logged (`macos_notifications.rs:289-310`). Windows added `notification shown` in 4f30416, macOS did not. Absence of logs cannot distinguish unsent from sent-but-hidden.
  - Another possibility: minimizing suspends WebView, preventing Host Attention delivery. By restoration, window is foregrounded and notification is intentionally suppressed (`desktop-notification-model.ts:115-129`). Windows uses Web Lock against suspension (`native-capabilities.ts:333-338` comment); effect on macOS WKWebView unverified.
- 10 and Dock/menu bar/Launchpad icons missed three rounds, likely because Mac terminal lacks Screen Recording permission and screenshots capture only desktop wallpaper.
- Other: unrelated changes appeared in original Mac workspace (`apps/site/.env.example`, `apps/site/components/site-analytics.tsx`), not made/touched by agent. Website area, outside this branch; user decides retention.

Next: follow `ux-v4-device-first-mac-acceptance-prompt-r4.md` for read-only system notification settings and usernoted logs comparing minimized/non-minimized. Identify cause before writing a fix prompt.

## Mac round 4

Full report/sanitized logs forwarded. Still 13 pass, 9 fails, 10 not tested.

- System: Allow notifications, Notification Center, Lock Screen enabled; Focus off; alert style not None. Thus not B (system hiding notification).
- Both obscured-but-not-minimized and minimized attempts showed nothing. Desktop log has no notification lines; usernoted log empty.
- My judgment: A (background webpage suspension) most likely. WKWebView defaults `inactiveSchedulingPolicy` to suspend when window is not foregrounded, matching both obscured/minimized results. Windows Web Lock (`native-capabilities.ts:333-338`) is ineffective on macOS. Tauri 2.11.5 supports `backgroundThrottling` window config (tauri-utils 2.9.3 `config.rs:2194-2200`), effective on macOS 14+, currently unset.
- Cannot rule out C: insufficient logs show whether native path was invoked. macOS logs no successful sends; webpage failures go only to WebView console.
- Old macOS notification code was written in Phase 8D, whose README explicitly said no physical Mac validation (`apps/desktop/README.md:298`). Previously unverified, not broken by this branch.
- Screenshot permission is fine. 10 and Dock/menu bar icons were omitted because my round 4 prompt required them only if permission was missing.

Next: follow `ux-v4-device-first-mac-fix-prompt-r5.md` on `fix/macos-notifications`: add notification logs, set `backgroundThrottling: disabled`, use ID lookup after exit; package/replace and test four scenarios, then 10/icons. I will review code.

## Mac round 5

Materials: user forwarded report, full diff, checks (`v4-mac-r5-review-materials.md` on Mac). Branch `fix/macos-notifications`, local commits `469f58a`, `0076c37`, based on 835489d, unpushed. macOS 27.0.

Code review: approved, 6 files +204 −5.
- Logs: `notification requested`, `authorization result=granted/denied/error`, startup `authorization status=…`, `notification shown … platform=macos`; type/status only, verified by sentinels. `requested` precedes validation/deduplication, so also logs rejected/skipped calls, useful diagnostically.
- `backgroundThrottling: "disabled"` in base config. Tauri/wry document Windows/Linux unsupported and ignored, matching Web Lock comment in `native-capabilities.ts`; Windows behavior unchanged.
- Post-exit click: look in memory first, then parse strict `codetether-attention-` prefix plus `is_public_id(…, "attn_")`, and use R11 `activate_notification_link` (cfg extended to macOS). Lookup Host only by ID, trusting no other notification content. Negative tests cover prefix/case/type/length/path/query/newline.
- Cargo enables only `UNNotificationSettings`; no new dependency.

Checks: clippy blocked by two preexisting main warnings, macOS-only code not compiled by Windows clippy, hence previously undetected.
- Manual `Default` in `attention_notifications.rs:161`: remaining fields derive Default in macOS non-test builds, but Windows/tests have `BoundedRegistry::new(MAX_…)` requiring explicit capacity. Following clippy's `#[derive(Default)]` would break Windows. Correct fix: `#[allow(clippy::derivable_impls)]` on this impl with explanation.
- `return` in cfg block at `product_device_key_store.rs:555`: remove return/semicolon, making both cfg blocks tail expressions, preserving both platforms.
- I approve these in a third commit. Outside part 2 scope but mechanical and behavior-preserving.
- `pnpm test` has two known failure classes: Windows installer paths on macOS; Claude tests because `/var` and `/private/var` alias. Rerun with canonical `TMPDIR` passes everything. Cross-platform test issues, not caused here, deferred.

Next: fix clippy on Mac, commit/push `fix/macos-notifications`, package/replace, test four cases. Once pushed, I will run Windows cargo check/clippy/test.

Result: 14 pass, 9 fails, 0 not tested.
- Third commit `a8abbec` changes only the two clippy items exactly as instructed. Pushed `fix/macos-notifications` (a8abbecc); no main push/tag.
- 10 passes: first light launch frame has no dark blue.
- 9 logs: `notification requested type=completed_review` → `authorization result=granted` → `notification shown … platform=macos`; restart shows `authorization status=authorized`.
  - Background suspension fixed: webpage now invokes notification while backgrounded, absent in rounds 3/4.
  - Still no banner/Notification Center item. Code never removes delivered notifications; contents only title/body. Remaining causes are system-side; see round 6 prompt.
- Round 4 `log stream` omitted `--level debug`, filtering usernoted info/debug, so empty logs do not prove system never received notifications.
- Windows compilation verification: branch pushed, but this session's permission service temporarily unavailable; fetch/cargo not run yet, follow up later.

Next: `ux-v4-device-first-mac-acceptance-prompt-r6.md`, system diagnosis only, no code changes:
- Signature and duplicate LaunchServices bundle-id registrations;
- CodeTether ncprefs;
- Suppression during screen sharing/mirroring;
- `osascript` control notification;
- Normal system launch via `open -a … --stderr`, retesting with debug usernoted logs;
- With user approval, unregister backup/build copies.

## Mac round 6

Full report forwarded. Still 14 pass, 9 fails.

- System: adhoc signature; 86 LaunchServices registrations for `com.codetether.desktop`, 17 old backup/build registrations removed with approval, 69 remain. User confirms no screen sharing/mirroring. `osascript` control appears. Normal `open -a` launch lets usernoted grant alert/badge/sound.
- First turn (obscured by Finder): Desktop requested/granted/shown; screen and Notification Center show notification, clicking returns to correct conversation. Native send/display/click path works. Round 5 likely failed because directly executing inside bundle from terminal bypassed LaunchServices identity, but this is inference without a control experiment.
- Later turns: Host creates new Attention (24 → 26), but no new `notification requested`, meaning webpage never reaches native command. Minimized attempt lacks reliable evidence of actual minimization; device-page attempt was foregrounded, where design should still send.
- My source assessment: every early return between SSE `attention.created` (`host-runtime.ts:821-822`) and coordinator (`attention-notification-coordinator.ts:174-297`) is unlogged. Permission (`native-capabilities.ts` `ensurePermission`), metadata, window state, `invoke` can hang/return silently; logs cannot distinguish them. Source alone cannot locate it; blind fixes are risky.

Next: `ux-v4-device-first-mac-fix-prompt-r7.md`, diagnostic-only commit on `fix/macos-notifications`: one stage/reason line at each coordinator step plus SSE disconnection/reconnection logs, then Mac package/test to locate cause. Fix next round.

## Mac round 7

- Diagnostic commit `aeb0b5f` completed locally, all checks pass, unpushed.
- Installed `git-aeb0b5fbd229` Host exits 1: logs contain only three `sse-unavailable`, no `sse-connected`. All three hands-on tests skipped per stop condition; CodeTether unusable now.
- Exit cause absent from sanitized logs. Host errors start `[codetether:host]` (`host_supervisor.rs:320-325`), but r7 retained only desktop/lifecycle/notification, discarding that line. Raw logs remain on Mac. My r7 rule omitted it.
- Unconfirmed hypothesis: no Host code changed, but packaging environment did. R7 used Node 25.5.0 from `/tmp`; round 1 used 26.4.0. App shrank 157.8 → 145.6 MB; 12 MB difference suggests embedded Node change. `build-sidecar.mjs:119-122` requires only Node 25.5+, without pinning.
- Repeated acceptance delays: real defects include background suspension and duplicate registrations, fixed/cleaned up; my prompts also allowed only one small step each round, requiring slow back-and-forth. I made three errors: round 2 focus criterion, round 4 omission of `--level debug`, round 7 log truncation.

Next: finish in one round using `ux-v4-device-first-mac-fix-prompt-r8.md`. Diagnose Host exit and restore a working version, then run diagnostics. If logs identify a webpage-path bug, fix directly within authorized files, fully accept item 9, push branch. User authorized greater Mac-agent autonomy: window switching, app exit/launch, downloading/verifying official Node, repeated packaging/replacement.

## Mac round 8

Result: installed `git-111f1b08e5f3`, all 15 pass. User forwarded only summary; I fetched branch to review myself.

Two new commits after a8abbec on `fix/macos-notifications`:
- `aeb0b5f`: r7-designed diagnostic logs.
- `111f1b0`: `fix(desktop): bound macOS notification native calls`.

13 files, +582 −30. Mac agent omitted Host exit cause from summary; I have not seen whether report includes it. No Host changes after a8abbec and app now starts, indicating packaging Node version change resolved it.

Code review approved, with follow-ups:
- Fix (`native-capabilities.ts`):
  - Native window-state/permission calls bounded to 1 second; coordinator to 5 seconds.
  - Window-state timeout falls back to webpage `document` (`readDocumentWindowState`).
  - macOS permission timeout/error assumes authorization and hands off to Rust queue; `macos_notifications.rs` requests actual permission and fails safely on denial.
  - Windows error behavior unchanged.
  - Root cause identified this round: Tauri notification plugin's JS permission call never returned, blocking all later notifications.
- Follow-up 1: macOS permission errors cache Authorized (`permissionResult = true`) until app restart. Cost is one extra Rust call, which safely fails if denied; acceptable.
- Follow-up 2: `document.hasFocus()` fallback may differ from native state. Misjudging a foreground window adds at most one notification, without missing any; acceptable.
- Follow-up 3: `detectMacOSRuntime` uses userAgent. macOS Tauri WebView contains `Macintosh`, so works; prefer native platform information later.
- Diagnostic logs retained. `log_notification_stage` accepts fixed stage names only; tests cover all stages and invalid values. Command list, permission list, `generate_handler!`, config tests, and `ARCHITECTURE.md` agree.
- Window events: minimize/restore logged only on state changes, focus gain/loss every time. Mac test had no `main_window_minimized`, perhaps minimization does not trigger `Resized` on macOS. Observability gap only, functionality fine; record for later.

Windows verification (worktree `agenthub-fix-macos-notifications`, HEAD `111f1b0`):
- cargo fmt passes; all 80 cargo tests pass.
- clippy reports only preexisting main warning `host_identity_key_store.rs:38`, untouched here.
- All 929 web tests and 26 desktop JS tests pass.
- Windows installed-app notifications untested. Coordinator is shared and adds Windows timeouts/`logStage`; test item 9 once on Windows before merge.

Next: package Windows `111f1b0`, user installs outside Codex, test item 9 B/C (Windows R11 method). If passed, merge main with user approval.

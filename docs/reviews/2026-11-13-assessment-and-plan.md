# Assessment and Plan (2026-11-13)

This covers a review of `main` at `4801ef1` and of the branches still in flight. On 2026-11-13 the Owner said to "follow your recommended approach", so the decisions below are recorded here. Claude Code does architecture, review and prompts. Coding agents on the Windows PC and the Mac do the implementation (DEVELOPMENT-PROCESS §1).

## 1. Where the project stands

`main` is healthy for an alpha:

- `pnpm typecheck`, `pnpm lint` and `pnpm build` pass.
- `pnpm test` runs 2,482 tests: 2,468 pass, 0 fail, 14 skipped. The skips are POSIX-only tests on Windows.
- Typing is strict: no `any` and no `@ts-ignore`.

The risks are in operations and process rather than code:

- **Docs disagree with what is merged.** The `ux/design` docs and AGENTS.md both lag behind `main`.
- **No CI.** Rust, Android and POSIX tests never run automatically.
- **Two branches implement the same feature.**
- **Two runtime deadlines.**
  - The Relay TLS certificate expires on 2027-01-01.
  - Every single-executable build (Desktop Host, Node, Relay) embeds Node 25, which reached end of life on 2026-06-01.

| Check on `main` `4801ef1` | Result                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| typecheck / lint / build  | pass (web build warns about two ~600 kB chunks)                                                                 |
| test                      | 2,482 tests, 2,468 pass, 0 fail, 14 skipped, ~6.5 min; **fails on a fresh clone unless `pnpm build` ran first** |
| format:check              | fails: 4 source files, 2 READMEs, about 50 docs files                                                           |

Stage status on `main`:

| Status               | Stages                                                              |
| -------------------- | ------------------------------------------------------------------- |
| Released             | D1                                                                  |
| Deployed             | B0                                                                  |
| Merged               | B1, T1a, B4a, D2.1, U1                                              |
| Reviewed, not merged | Android retry fix, T1a fidelity fix (Owner device re-check pending) |
| In fix round         | I1 iPad (r4 review left one must-fix; r5 prompt ready)              |
| Unmerged             | two model-switching branches                                        |
| Not started          | B2, the rest of B3, B4b, E1, M1–M3, P1, X1                          |

## 2. Decisions

### AD-1: One model-control implementation, based on `feat/d2-model-switching`

**Decision.** `feat/d2-model-switching` (`f1f6f8c`) is the implementation to keep. The mobile layer from `feat/d2-remote-model-switching` (`183c534` and its `machine.get` model cap) moves onto it. The remote-only branch is closed once the integrated branch merges.

**Why.** Both branches add the identical migration 026 and the same Supervisor operations (`conversation.updateModel`, `conversation.models.refresh`). The host code on the remote-only branch is a reduced copy of the first branch's code:

- It rejects conversations on remote computers outright (`operation_not_allowed`).
- After it awaits the model catalog, it does not re-check whether a Turn started in the meantime.
- It does not refuse a model refresh on archived conversations.

The first branch is a superset of the remote-only branch on the host side. It also adds the desktop Composer control and the Node transport. The remote-only branch's real additions are the Rust UniFFI functions, the Android Kotlin layer, and the cap of 50 models in `machine.get`.

**Prompt.** `d2-model-control-integration-prompt.md`

### AD-2: Show real capabilities only; no Composer placeholders

**Decision.**

- The 03 §6 invariant wins over `10-desktop-improvements.md` §3.3: the interface only shows what the backend really provides.
- The Composer drops the disabled "Attach" and "Voice" buttons and the "Remaining context" label that has no value.
- The disabled model button is replaced by the real model control from AD-1.
- These items come back only when X1, or a real context-usage source, provides them.

10 §3.3 is updated accordingly.

**Why.** AGENTS.md also says "unsupported Composer actions are hidden". A greyed control shown with "coming soon" is exactly what the invariant forbids, and the review in D2.1 already leaned toward hiding them.

**Revised 2026-11-14.** The Owner wants Attach, Voice and Remaining context built, not removed (AD-12). The principle stands: no control ships greyed out once its feature exists, and each new control is shown only where it works. What changes is the interim:

- Task 5 replaces only the model button.
- The other three placeholders stay on `main` until X1a, X1b and X1c replace each one with a working control.
- Removing them first and adding them back weeks later would churn the same code and tests twice.

### AD-3: Relay certificate renewal without restarts

**Facts.**

- Clients pin the Relay **application identity** (`relayFingerprint`), not the key of the public TLS certificate (`apps/relay/README.md`, "The CA TLS key may differ…").
- The public certificate (Caddy/ACME) expires on `2027-01-01T09:35:31Z`. Caddy will renew it around 2026-12-02.
- The Relay only reads its own copy of the certificate at startup.
- Restarting the Relay drops every live Host presence and Supervisor channel.
- The B0 sync script and timer exist only as unreviewed drafts in `agenthub-archive/b0-logs/`.

**Decision.**

1. The Relay reloads its TLS certificate and key on `SIGHUP` without dropping connections. The new pair goes through the same checks as at startup. If they fail, the old pair stays in use and a log line explains why.
2. Health and metrics report the certificate expiry date and the number of days left. The health check warns when fewer than 21 days remain.
3. A reviewed timer copies Caddy's renewed pair into `/etc/codetether-relay` and runs `systemctl reload codetether-relay`.

**Dates.**

| Step                                                                           | Date                     |
| ------------------------------------------------------------------------------ | ------------------------ |
| Code merged                                                                    | by 2026-11-27            |
| Deployed                                                                       | by 2026-12-10            |
| Fallback: manual swap and restart, per `relay-certificate-renewal-note-001.md` | no later than 2026-12-20 |

**Prompt.** `runtime-node26-relay-tls-prompt.md`. A separate deployment prompt follows its review.

### AD-4: Pin Node 26 LTS for every build

**Decision.**

- The repository pins one Node major version: Node 26 LTS. A `.node-version` file, the root `engines` field and the three single-executable build scripts must agree.
- Release builds refuse any other major version.
- The Relay is the internet-facing executable, so its next deployment ships Node 26 (with AD-3).
- Desktop and Node pick it up in their next release.

**Why.**

- `build-sidecar.mjs`, `build-node.mjs` and `build-relay.mjs` embed whatever Node runs the build. Today that is 25.x, which has had no security fixes since 2026-06-01.
- The root `engines` field still says `>=22.13.0`, which those scripts reject.

### AD-5: Authenticate the local Host API

**Decision.** The Desktop shell generates a random secret at each launch. The Host then requires it on every Protocol v1 request. Details are in `docs/adr/ADR-LOCAL-API-SESSION-TOKEN.md`.

**Status.** Proposed; the Owner accepts it before the S1 prompt is written.

**Why.** Today any local process, including another Windows user's or an agent CodeTether supervises, can call `127.0.0.1:4317` without an `Origin` header. That lets it read history, start Turns and resolve Approvals.

### AD-6: Short AGENTS.md; frozen history in its own file

**Decision.**

- AGENTS.md keeps only the product, the principles, the scope rules and the quality gate. It went from 60 KB to 15 KB.
- The frozen Phase 4–10 boundary text moves word for word to `docs/FROZEN-BOUNDARIES.md`.
- AGENTS.md no longer records stage status; ROADMAP does.
- AGENTS.md now has a precedence order: task prompt, then ROADMAP status, then PRODUCT/ARCHITECTURE, then the frozen file. This replaces "stop on any conflict", which the contradictory status lines made unavoidable.
- The new AGENTS.md reaches `main` through the hygiene task, because agents load it from their `main`-based worktree.

### AD-7: Keep docs on the docs branch

**Decision.**

- Feature branches do not edit `AGENTS.md` or `docs/`. Agents list the doc changes they think are needed in their report, and Claude Code applies them on `ux/design`.
- Scope extensions are recorded in the prompt and in ROADMAP, never by an agent editing AGENTS.md.

**Why.** `feat/d2-model-switching` changed AGENTS.md, ARCHITECTURE, PRODUCT, ROADMAP and 03 on a code branch. That guarantees conflicts with the docs branch.

### AD-8: Minimal CI on GitHub Actions

**Decision.**

| When                                                                                           | What runs                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every push                                                                                     | Full gate on Linux (typecheck, lint, build, test, format check) plus `cargo test` for `packages/supervisor-mobile`. Linux also exercises the POSIX process-group tests that Windows always skips. |
| Pushes to `main` and `release/*`, and tags                                                     | Windows and macOS jobs as well                                                                                                                                                                    |
| Pushes that change `apps/android/**` or `packages/supervisor-mobile/**`, plus pushes to `main` | Android Gradle job                                                                                                                                                                                |

CI is independent evidence alongside each agent's report. It does not replace the local gate. macOS runners stay off feature-branch pushes because they cost ten times the minutes on a private repository.

**Prompt.** `repo-hygiene-ci-prompt.md`

### AD-9: Quality gate order and a test command that works from a fresh clone

**Decision.**

- The gate order is typecheck, lint, build, test (AGENTS.md now says so, matching DEVELOPMENT.md).
- Separately, `pnpm test` must pass in a fresh clone even without a prior build. Today `@codetether/agent-core` is never built because it has no `test` script, and the adapter tests import its build output.
- The three test files that are never wired in must run:
  - `adapter-claude/test/macos-discovery.test.mjs`
  - `adapter-codex/test/macos-discovery.test.mjs`
  - `adapter-codex/test/probe-supervision.test.mjs`

### AD-10: Shrink `host-service.ts` gradually, not in one refactor

**Decision.**

- No dedicated refactor of `apps/host/src/api/host-service.ts` (10,144 lines; one class with about 60 fields).
- A task that would add more than about 100 lines to it moves the part it touches into its own module first. B3a does this for the provider-readiness cache.
- `conversation-store.ts` (6,710 lines) and `remote-machine-coordinator.ts` (4,206 lines) follow the same rule.

### AD-11: Work in progress and branch hygiene

**Decision.**

- At most two tasks run at once, one per machine.
- Every merged task gets its record at `docs/reviews/<branch>.md`.
- After two fix rounds, Claude Code escalates to the Owner instead of writing a third.
- Merged branches and worktrees are deleted after each release.

This restates DEVELOPMENT-PROCESS §3–§5, which practice had drifted from:

- 14 worktrees and about 25 merged remote branches are still around.
- The v4 desktop work had 13 fix rounds.

### AD-12: Build the Composer's attach, voice and context features now, desktop first (2026-11-14)

**Decision.** The Owner asked for UI-review finding 3 to be implemented. This pulls three X1 items forward, ahead of M2, for the desktop.

**X1a, remaining context.**

- Both local adapters normalize the usage Codex and Claude Code already report. The Host keeps the latest value per conversation, durably.
- The Composer shows "剩余 N%" only when the value is real and was measured for the current model.
- The number must match the native tool's.

**X1b, image attachments.**

- PNG, JPEG, WebP and GIF; up to 6 per Turn, 5 MiB each; text still required.
- Conversations on this computer only, with local Codex and local Claude Code.
- The Host stores the bytes in a CodeTether-owned folder. Durable Turn records keep metadata only. Nothing enters Search, logs or notifications.
- Retry resends the same attachments.
- **Later:** other computers, tablet, phone and iPad, and files that are not images. Project files will be referenced with "@" (W15).

**X1c, voice.**

- Hold to speak; the transcript goes into the draft and is never auto-sent.
- whisper.cpp in the Tauri shell, with a multilingual model downloaded once on first use against a pinned hash.
- Audio never leaves the computer and is never written to disk.
- Desktop only. The tablet and phone have the keyboard's voice typing (W4).

**Word count** ("字数") already works and stays. **The model button** is task 5.

**Why these choices.**

- **Images only.** Images are the common case: a screenshot of an error or a layout. Both Providers accept them. Other files raise questions of size and of how to store and index them, which the "@" reference avoids.
- **This computer first.** Remote execution goes through frozen transport and Supervisor contracts. Extending them is its own task.
- **Local whisper.cpp for voice.**
  - Windows dictation sends audio to Microsoft and needs a speech pack per language.
  - macOS recognition works on one locale at a time.
  - Neither handles mixed Chinese and English well, and WebView2 has no working Web Speech recognition.
  - Local Whisper is private, works on both platforms with one implementation, and handles mixed speech.
  - The cost is a one-time model download of roughly 150–500 MB.

**Owner checks before dispatch.** These are defaults the Owner can override:

- images only
- this computer only
- local whisper.cpp with a downloaded model
- hosting that model on `codetether.org` (needs the Owner's approval when X1c asks)

**Prompts.** `x1a-context-usage-prompt.md`, `x1b-image-attachments-prompt.md`, `x1c-voice-input-prompt.md`.

### AD-13: Windows desktop first (2026-11-17)

**Decision.** The Owner wants the Windows desktop to be useful, easy and convenient for daily work before the other platforms get more effort.

- **First, W0.** A hands-on audit of the installed Windows app, doing real work: `w0-windows-desktop-audit-prompt.md`. Claude Code turns its findings into the next desktop tasks, revising 6 and 9–14 where needed.
- **Continues:**
  - task 5, the gate for every desktop UI task, narrowed to the Windows desktop on 2026-11-18
  - the desktop tasks 6, 8 and 9–14, re-ranked after W0
- **Narrowed on 2026-11-18 (Owner): only the Windows app's functionality.**
  - **Postponed until the Windows focus ends:**
    - the Mac part of 1c
    - task 2 (repo hygiene and CI) and Owner action 4
    - every Mac, phone, tablet, iPad and remote-computer goal inside the remaining tasks; each prompt marks its own
  - **Code that is already built and shared** (for example, the remote and Supervisor parts of the model-control branch) is kept compiling and tested, but it is not extended or accepted now.
- **Paused:**
  - 1b, the phone. Its evidence and `fix/android-phone-offline` are kept.
  - 2a, iPad r5
  - 7, B4b
  - the E1 decisions
  - the M series
- **Deferred: tasks 3 and 4 (Relay).** Caddy renews the public certificate around 2026-12-02, and the Relay reads its copy only at startup. If task 4 has not shipped by 2026-12-15, a short operations task copies the renewed certificate and restarts the Relay before 2027-01-01.
- **The Mac's role.** None for now: since 2026-11-18 the Owner develops only on Windows. Every task is implemented and accepted on Windows. The two-task limit (AD-11) still applies, with two worktrees on this PC.
- **Exit (revised 2026-11-17).** The Owner asked that all Windows-side functionality be completed once W0 finishes. The scope, order and exit are in `2026-11-17-windows-completion-scope.md`.
  - alpha.4 ships early, after task 5, B3a and the W0 Blocker fixes. It is the first real one-click update (U1), and later batches ship the same way.
  - The focus ends when every in-scope item is accepted on Windows and a repeat audit (W2) finds no Blocker or High findings.

**Why.**

- The desktop is the primary environment (AGENTS.md). Remote and mobile use only matter if the desktop is worth keeping open.
- Two machines and a two-task limit (AD-11) spread thin across five platforms.
- The 2026-11-13 UI review was done in a browser with demo data; nobody has yet judged the real app doing real work.

## 3. Task queue

| #   | Task                                                                                                                                                                 | Prompt                                                                           | Runs on                               | Starts                                                                                   | Deadline                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------- |
| W0  | Windows desktop hands-on audit (AD-13)                                                                                                                               | `w0-windows-desktop-audit-prompt.md`                                             | Windows, with the Owner               | done 2026-11-18, partial: no Codex Turn could run (W0-01); group A in the scope document | —                               |
| W0a | W0 execution fixes: a clear message for a rejected model (W0-01), Claude Code `2.1.327` admitted (W0-03)                                                             | `fix-w0-local-execution.md` (review; one must-fix)                               | Windows                               | merged into `main` 2026-11-18 (`9cb3e5b`)                                                | —                               |
| W0b | Finish the W0 audit: coding, Approvals, change review, CLI comparison                                                                                                | `w0b-windows-desktop-audit-finish-prompt.md`                                     | Windows, with the Owner               | done 2026-11-18: the core loop works, with friction; W0-11 to W0-18 added to group A     | —                               |
| W0c | Codex commands in the Windows sandbox (W0-11): find the cause, fix it without weakening the sandbox                                                                  | `w0-11-windows-sandbox-prompt.md`                                                | Windows                               | merged into `main` 2026-11-18 (`49dcd89`)                                                | —                               |
| W0d | W0 small fixes: the Host-stop dialog (W0-09), sign-in on the first launch (W0-17), file-Approval wording (W0-12), offline remote computers in a closed group (W0-04) | `w0-small-fixes-prompt.md`                                                       | Windows                               | goals 1–3 accepted 2026-11-19 (`w0-small-fixes.md`); now round 2 for goal 4, alongside 9 | —                               |
| R4  | Release `v0.1.0-alpha.4`: task 5, B3a, W0c, W0d; the first real one-click update (U1)                                                                                | `release-alpha4-prompt.md`                                                       | Windows                               | after W0d is merged                                                                      | —                               |
| 1   | Release `v0.1.0-alpha.3` (round 2: merge the two reviewed Android fix branches onto the current `main`; I1 excluded)                                                 | `release-alpha3-prompt-r2.md`                                                    | Windows                               | done: released 2026-11-15 (`0bf8cba`)                                                    | —                               |
| 1b  | Phone shows the computer offline (vivo X60 diagnosis; finishes the T1a phone checks)                                                                                 | `android-phone-offline-diagnosis-prompt.md`                                      | Windows, with the phone               | paused 2026-11-17 (AD-13); resumes after the Windows focus                               | —                               |
| 1c  | Rebuild alpha.3 with the update source (05 §5.2) and reinstall                                                                                                       | `release-alpha3-update-source-prompt.md`                                         | Mac, then Windows after 1b            | Windows done 2026-11-16; Mac part postponed 2026-11-18 (AD-13)                           | —                               |
| 2a  | I1 iPad r5 (one must-fix from the r4 review)                                                                                                                         | `i1-fix-prompt-r5.md`                                                            | Mac                                   | paused (AD-13)                                                                           | —                               |
| 2   | Repo hygiene and CI baseline                                                                                                                                         | `repo-hygiene-ci-prompt.md`                                                      | Mac                                   | postponed 2026-11-18 (AD-13)                                                             | —                               |
| 3   | Node 26 pin and Relay TLS reload                                                                                                                                     | `runtime-node26-relay-tls-prompt.md`                                             | Windows                               | deferred (AD-13)                                                                         | fallback decision by 2026-12-15 |
| 4   | Relay deployment (Node 26 build, reload, certificate sync timer)                                                                                                     | written after review of 3                                                        | Windows → us-vps-01                   | deferred (AD-13)                                                                         | certificate before 2027-01-01   |
| 5   | D2 model control for the Windows desktop, plus unusable models (W0-01, goal 7); mobile and remote parts postponed                                                    | `d2-model-control-integration-prompt.md`                                         | Windows                               | merged into `main` 2026-11-18 (`3a97f6f`); Windows acceptance with alpha.4               | —                               |
| 6   | B3a send speed, plus an empty conversation that fails after a restart (W0-18, goal 6)                                                                                | `b3a-send-speed-prompt.md`                                                       | Windows (codex.exe is measured there) | merged into `main` 2026-11-18 (`8bedb8b`); Windows acceptance with alpha.4               | —                               |
| 7   | B4b folder browsing                                                                                                                                                  | `b4b-folder-browse-prompt.md` (existing; start commit refreshed when dispatched) | Mac                                   | paused (AD-13)                                                                           | —                               |
| 8   | S1 local API session token                                                                                                                                           | written after AD-5 is accepted                                                   | Windows                               | after 6                                                                                  | —                               |
| 9   | D2.5 timeline restyle (10 §3.4) plus UI-review findings 1, 2, 8 (conversation), 12 and 13                                                                            | `d2-5-timeline-restyle-prompt.md`                                                | Windows                               | now, alongside W0d; merges after the alpha.4 tag                                         | —                               |
| 10  | D3a desktop consistency (UI-review findings 4–8, 15, 16)                                                                                                             | `d3a-desktop-consistency-prompt.md`                                              | Windows                               | after 5 and W0d are merged                                                               | —                               |
| 11  | D3b desktop usability (UI-review findings 9–11, 14, 17, 18)                                                                                                          | `d3b-desktop-usability-prompt.md`                                                | Windows                               | after 10 is merged                                                                       | —                               |
| 12  | X1a remaining context (AD-12)                                                                                                                                        | `x1a-context-usage-prompt.md`                                                    | Windows                               | after 5 is merged                                                                        | —                               |
| 13  | X1b image attachments, this computer (AD-12)                                                                                                                         | `x1b-image-attachments-prompt.md`                                                | Windows (the Mac check is postponed)  | after 5 and 9 are merged                                                                 | —                               |
| 14  | X1c voice input, desktop (AD-12)                                                                                                                                     | `x1c-voice-input-prompt.md`                                                      | Windows (the Mac part is postponed)   | after 5 is merged; after 13 if 13 has merged by then                                     | —                               |

Claude Code reviews each branch as it comes back and writes `docs/reviews/<branch>.md`. On 2026-11-13 it reviewed `fix/t1a-tablet-fidelity` items 4–9 (no must-fix) and `i1/ipad-app` r4 (one must-fix). Neither had a review record, although `release-alpha3-prompt.md` treated both as reviewed and accepted. In parallel, Claude Code wrote the E1 design draft, `docs/ux-redesign/11-one-computer-one-device.md` (2026-11-13). It awaits the Owner's decisions D1–D6 before any E1 prompt is written. The desktop UI review (`docs/reviews/2026-11-13-desktop-ui-review.md`, 2026-11-13) feeds tasks 9–14. On 2026-11-14, its finding 3 became AD-12 (tasks 12–14), and its prompts were written ahead of the review of task 5. Each one starts from `main` after the merges listed above, so its line numbers may need refreshing when dispatched. Within the two-task limit (AD-11), the suggested order once 5 has merged is:

1. done on 2026-11-18: 5, 6 and W0c merged
2. now: W0d round 2 alongside 9
3. R4, the alpha.4 release, once W0d is merged; 9 merges after the alpha.4 tag
4. 10 when 9 or W0d frees a slot (10 starts after W0d)
5. 12 alongside 11
6. 13
7. 14

W0's report was reviewed on 2026-11-18; its findings are group A in `2026-11-17-windows-completion-scope.md`. W0a merged into `main` the same day (`9cb3e5b`), and W0b finished the audit on alpha.3. W0b found that the core loop works with friction, and added W0-11 to W0-18. Its two largest problems get their own work: the Windows sandbox (W0-11) becomes task W0c, and an empty conversation that fails after a restart (W0-18) joins B3a, which changes the same path. Three small fixes become W0d. The timeline findings (W0-13 to W0-16) go to D2.5, and the account and devices finding (W0-04) to W0d: on 2026-11-18 the Owner asked to stop showing the two offline remote computers, so W0d moves them into a closed group. Task 5 came back the same day and was accepted with one must-fix (`docs/reviews/d2-model-control.md`). Later the same day, task 5 merged into `main` (`3a97f6f`), and B3a and W0c were accepted (`b3a-send-speed.md`, `w0-11-windows-sandbox.md`). W0c found that W0-11 came from how the audits started the app, not from the app itself. The audits started it from an agent's shell inside the OpenAI desktop app, whose environment carries a marker that breaks Codex's sandbox. W2 and alpha.4 acceptance must therefore start the app from the Start menu. B3a and W0c merged into `main` that evening (`8bedb8b`, `49dcd89`). On 2026-11-19 W0d came back with goals 1–3 done, and they were accepted (`w0-small-fixes.md`). Goal 4 was missing, because it had been added to the prompt but not yet published to `ux/design`; round 2 adds it. The alpha.4 release prompt is ready (`release-alpha4-prompt.md`).

Task 1c's Windows part was done on 2026-11-16, and Claude Code accepted it. Its health check was incomplete because the Control Plane rejected the desktop's presence. That started before the rebuild (the Host binary is unchanged) and cleared after a re-login on 2026-11-17 at about 13:00 UTC. Task 1b pauses after a desktop-side analysis of that rejection; its starting state and the debug-logging commit `0ba1f1d` are kept.

### Owner actions

1. **Publish the docs.** Done on 2026-11-14: `ux/design` was fast-forwarded to `docs/english` and pushed. `docs/english` stays as the working branch for docs; fast-forward `ux/design` to it whenever new prompts are ready. Every prompt reads from `origin/ux/design`. A prompt reaches an agent only once it is published there: W0d missed its goal 4 because the amendment was still local (2026-11-19).
2. **Confirm acceptance of U1, B4a and D2.1.** They reached `main` on 2026-11-09 without review or acceptance records. Accepted with the alpha.3 release approval on 2026-11-15; the release message records it.

   - **Re-check the T1a fidelity fixes on a device**, items 1–9. Done on 2026-11-15: all nine pass on the emulator. The phone's live checks moved to task 1b (`fix-t1a-tablet-fidelity.md`, round 4).
   - **Decide on iPad r5.** It would be a fifth fix round, beyond the two-round limit, but it is narrow: one must-fix and two small should-fixes. After r5, finish the iPad acceptance with `i1-ipad-interaction-test-prompt.md`.

3. **Accept or amend** `docs/adr/ADR-LOCAL-API-SESSION-TOKEN.md`.
4. **Check repository visibility and Actions billing** for CI. If the repository is private, macOS minutes count ten times. Postponed with task 2 (AD-13, 2026-11-18).
5. **Release approvals** (2026-11-15):
   - Pushing `main` and the tag is pre-approved, once every gate passes and every conflict is in the expected areas.
   - Uploading the U1 update files is skipped for alpha.3.
   - Deleting the merged remote branches still needs approval when the task asks.
   - Done: 21 merged remote branches deleted with approval. Leftover folders are listed in `release-v0.1.0-alpha.3.md`.
6. **Generate the update signing key pair** (05 §7, decision 2). Done on 2026-11-15; the public key is `docs/release/codetether-update.key.pub`. Base URL: `https://codetether.org/updates` (decision 1).
7. **Relay:** deferred (AD-13). If task 4 has not shipped by 2026-12-15, approve a short task that copies the renewed certificate and restarts the Relay before 2027-01-01. Postponed with remote work (2026-11-18). If nothing is done, paired phones and remote computers stop connecting on 2027-01-01. Local use of the Windows app does not go through the Relay.
8. **Upload `latest.json`.** Copy `D:/Projects/Software/agenthub-archive/alpha3-update-source-windows/latest.json` to us-vps-01 so that it is served at `https://codetether.org/updates/alpha/latest.json`. Until then, "check for updates" shows an error on alpha.3. Superseded by R4: the release agent uploads alpha.4's `latest.json` instead (`release-alpha4-prompt.md`, goal 8).
9. **Codex's default model** (W0-01). Done on 2026-11-18: the Owner changed the Windows Codex configuration from `gpt-6.2-sol`, which this account cannot use, to `gpt-6.1-sol`, which W0 verified. W0b can start.
   - The Owner approved pushing `main` for W0a; it merged on 2026-11-18 (`9cb3e5b`).
10. **Releases without the Owner's hands** (2026-11-19). From alpha.4 on, the release agent signs, uploads to us-vps-01, runs the one-click update in the installed app and runs the acceptance checks. The Owner types the signing password once, the first time, into a window the agent opens; it is then stored encrypted for the Owner's Windows account (05 §7). The Owner still approves pushing `main` and the tag, and any web server change.

## 4. Backlog (not scheduled)

- A development-only port for the desktop shell and for its Supervisor listener, so that agents can test the tray and the shell beside the installed app. Today the shell is fixed to `4317`, and the development sidecar's Supervisor defaults to `4318`, which the installed app holds (`b3a-send-speed.md`, `w0-small-fixes.md`).
- Composer drafts in `localStorage` (`composer-draft-<id>`) are never deleted, and `writeComposerSendShortcut` has no try/catch. Listed as "should" in B3a.
- The Supabase refresh token is persisted in WebView `localStorage` (`persistSession: true`). Consider moving it to the platform key store alongside S1.
- `zustand` is declared in `apps/web` but never imported (removed in the hygiene task).
- Two web build chunks of about 600 kB. Consider route-level splitting when D2/B3 touch routing.
- The Control Plane has no deployment artifacts in the repository; only the Relay has a systemd unit. Add them with the next Control Plane change.
- The UI is Chinese-only with no message layer. That is fine until a second language is planned; decide before M1 if phones will ship outside China.
- The Rust core and TypeScript implement the Supervisor protocol twice. CI's `cargo test` interop run (AD-8) is the guard; a shared schema or code generation can wait until P1.
- `packages/agent-core` (868 lines) and `packages/ui` (3.6k lines) have no tests.

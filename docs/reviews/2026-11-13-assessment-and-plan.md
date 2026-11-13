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

## 3. Task queue

| #   | Task                                                                                                                 | Prompt                                                                           | Runs on                                          | Starts                                                      | Deadline             |
| --- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------- | -------------------- |
| 1   | Release `v0.1.0-alpha.3` (round 2: merge the two reviewed Android fix branches onto the current `main`; I1 excluded) | `release-alpha3-prompt-r2.md`                                                    | Windows                                          | after the Owner's device re-check of the T1a fidelity fixes | —                    |
| 2a  | I1 iPad r5 (one must-fix from the r4 review)                                                                         | `i1-fix-prompt-r5.md`                                                            | Mac                                              | now, if the Owner approves a fifth round (AD-11)            | —                    |
| 2   | Repo hygiene and CI baseline                                                                                         | `repo-hygiene-ci-prompt.md`                                                      | Mac                                              | after 2a                                                    | —                    |
| 3   | Node 26 pin and Relay TLS reload                                                                                     | `runtime-node26-relay-tls-prompt.md`                                             | Windows                                          | after 1                                                     | merged by 2026-11-27 |
| 4   | Relay deployment (Node 26 build, reload, certificate sync timer)                                                     | written after review of 3                                                        | Windows → us-vps-01                              | after 3                                                     | before 2026-12-10    |
| 5   | D2 model-control integration                                                                                         | `d2-model-control-integration-prompt.md`                                         | the next free machine with the Android toolchain | after 1                                                     | —                    |
| 6   | B3a send speed                                                                                                       | `b3a-send-speed-prompt.md`                                                       | Windows (codex.exe is measured there)            | after 5 is merged                                           | —                    |
| 7   | B4b folder browsing                                                                                                  | `b4b-folder-browse-prompt.md` (existing; start commit refreshed when dispatched) | Mac                                              | after 2                                                     | —                    |
| 8   | S1 local API session token                                                                                           | written after AD-5 is accepted                                                   | either                                           | after 6                                                     | —                    |

Claude Code reviews each branch as it comes back and writes `docs/reviews/<branch>.md`. On 2026-11-13 it reviewed `fix/t1a-tablet-fidelity` items 4–9 (no must-fix) and `i1/ipad-app` r4 (one must-fix). Neither had a review record, although `release-alpha3-prompt.md` treated both as reviewed and accepted. In parallel, Claude Code writes the E1 design: merging Node into Desktop changes identity, pairing and conversation ownership, and the remote-access work keeps building on the current model until that design exists.

### Owner actions

1. **Publish the docs.** Review `docs/english` and fast-forward `ux/design` to it, which brings in the translation and today's commits. Push `ux/design`, then delete `docs/english`. Every prompt reads from `origin/ux/design`.
2. **Confirm acceptance of U1, B4a and D2.1.** They reached `main` on 2026-11-09 without review or acceptance records. Release round 2 assumes they are accepted.

   - **Re-check the T1a fidelity fixes on a device**, items 1–9. This precondition gates the alpha.3 release.
   - **Decide on iPad r5.** It would be a fifth fix round, beyond the two-round limit, but it is narrow: one must-fix and two small should-fixes. After r5, finish the iPad acceptance with `i1-ipad-interaction-test-prompt.md`.

3. **Accept or amend** `docs/adr/ADR-LOCAL-API-SESSION-TOKEN.md`.
4. **Check repository visibility and Actions billing** for CI. If the repository is private, macOS minutes count ten times.
5. **When the release task asks:** approve pushing `main`, the tag, uploading the update files to `codetether.org/updates/alpha`, and deleting the merged remote branches.
6. **Pick a Relay deployment window** in the first week of December.

## 4. Backlog (not scheduled)

- Composer drafts in `localStorage` (`composer-draft-<id>`) are never deleted, and `writeComposerSendShortcut` has no try/catch. Listed as "should" in B3a.
- The Supabase refresh token is persisted in WebView `localStorage` (`persistSession: true`). Consider moving it to the platform key store alongside S1.
- `zustand` is declared in `apps/web` but never imported (removed in the hygiene task).
- Two web build chunks of about 600 kB. Consider route-level splitting when D2/B3 touch routing.
- The Control Plane has no deployment artifacts in the repository; only the Relay has a systemd unit. Add them with the next Control Plane change.
- The UI is Chinese-only with no message layer. That is fine until a second language is planned; decide before M1 if phones will ship outside China.
- The Rust core and TypeScript implement the Supervisor protocol twice. CI's `cargo test` interop run (AD-8) is the guard; a shared schema or code generation can wait until P1.
- `packages/agent-core` (868 lines) and `packages/ui` (3.6k lines) have no tests.

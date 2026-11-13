# README Rewrite Prompt (Bilingual, English Primary)

For the Codex agent on Windows. Reviewer: Claude Code.

## Background

The README at https://github.com/lyf-workshop/CodeTether remains an internal Phase 8C/8D development record: "CodeTether V2", lengthy Phase numbers, acceptance statuses, Historical Alpha capabilities, development commands taking half the page, and no screenshots/license. The product is now v4, organized Account › Devices › Projects › Conversations. Rewrite it as a public product page and add a license.

`docs/ux-redesign/` is the temporary design authority, overriding AGENTS.md's Figma-only rule. This round changes documentation only, without UI changes.

## Scope

Add or modify only:

- `README.md`: primary English version.
- `README.zh-CN.md`: Simplified Chinese, matching the English content.
- `LICENSE`: full license.
- `docs/DEVELOPMENT.md`: verified development/build instructions moved from the old README.
- Screenshots under `docs/assets/readme/`.
- Add only `"license": "SEE LICENSE IN LICENSE"` to `package.json`.

Do not publish a GitHub Release, tag, or change repository settings.

## Part 1: Preparation

1. In `D:/Projects/Software/agenthub`, run `git fetch origin`, then create `docs/readme-v4` from `origin/main`, expected `835489d`. Create the isolated worktree with `git worktree add D:/Projects/Software/agenthub-docs-readme -b docs/readme-v4 origin/main`. Do not switch the main worktree's branch. Stop and report if `origin/main` differs from `835489d`.
2. Read these before writing. Every product claim must be supported by these documents or `main` code:
   - `D:/Projects/Software/agenthub/docs/ux-redesign/01-feature-inventory-and-mapping.md` (read-only `ux/design` worktree).
   - `D:/Projects/Software/agenthub/docs/ux-redesign/03-project-plan.md` (read-only).
   - The new worktree's `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `package.json`, and `apps/node` release targets.
3. Omit unsupported claims. Put uncertainty under Pending Confirmation in the report instead of guessing.

## Part 2: License

Use **FSL-1.1-ALv2**, Functional Source License 1.1, converting to Apache 2.0 after two years.

1. Retrieve the original template from https://raw.githubusercontent.com/getsentry/fsl.software/refs/heads/main/FSL-1.1-ALv2.template.md and save it as `LICENSE`.
2. Replace only `${year}` with `2026` and `${licensor name}` with `lyf-workshop`. Leave every other word unchanged and untranslated.
3. On network, 429, or 524 failures, record status/time, honor `Retry-After`, and retry at most 3 times. If still unavailable, stop and report. Do not reconstruct the license from memory.
4. README License explains that source is available for reading, modification, internal use, and noncommercial education/research. Competing commercial products/services are prohibited. Each version converts to Apache 2.0 two years after release. Link `LICENSE` and https://fsl.software/. Use "source-available", not "open source", because FSL is not OSI-approved.

## Part 3: Screenshots

1. Start with these two, copying and renaming into `docs/assets/readme/`:
   - `D:/Projects/Software/agenthub-ux-v4-device-first/output/playwright/v4-installed-inspection/18-final-devices-light.png` → `devices-light.png`.
   - `D:/Projects/Software/agenthub-ux-v4-device-first/output/playwright/v4-installed-acceptance-r7/01-codex-selected-01621.png` → `conversation-codex.png`.
2. Optionally choose one or two dark screenshots from `v4-installed-inspection/`, such as `12-new-conversation-1100-dark.png` or `04-settings-dark.png`. At most 4 total.
3. Open each before inclusion. Reject email addresses, account IDs, token/key fragments, pairing codes, IPs, Windows usernames in paths such as `C:\Users\<name>`, and hostnames. Choose another image rather than editing/redacting it.
4. Each image must be at most 500 KB. Choose another if oversized instead of compressing/editing.
5. State that screenshots show the Windows alpha installed app, whose interface currently supports Simplified Chinese only.

## Part 4: README Structure

Below the first line, add a language switch to `README.md` and `README.zh-CN.md`: `English | [Simplified Chinese](README.zh-CN.md)`, reversed in Chinese.

Use the same structure in both:

1. Title `CodeTether`, without V2, and a one-sentence description of viewing/controlling Codex and Claude Code conversations across computers in one place.
2. Early-alpha status, no published installers yet, source builds required, and Simplified-Chinese-only UI.
3. Main `devices-light.png` screenshot.
4. Existing capabilities, organized Account › Devices › Projects › Conversations:
   - Devices: this computer and CodeTether Node-paired Linux x64/arm64 or macOS arm64 devices. Windows can currently serve only as This Computer.
   - Projects: one folder on a device. Adding finds prior Codex/Claude Code sessions for import/resumption.
   - Conversations: create, send, pin, rename, archive, and project search.
   - Local Codex: stop, Allow Once / Reject approval, and file changes. Clearly explain Claude Code lacks stop and approval.
   - Inbox: approval, completed, and failed categories, plus native desktop notifications.
   - Light/dark/system theme and Ctrl K (Mac ⌘K) command palette.
5. Conversation screenshot.
6. Platform table showing desktop and Node systems/status separately. macOS desktop is "Build from source, acceptance in progress", not formally supported.
7. Unavailable features: phone/tablet apps, other same-account computers as devices, paired Windows devices, one-click updates, and installer distribution. List only items in `03-project-plan.md` or 01 Roadmap, without dates.
8. Minimal source-build path: prerequisites and two or three commands, linking detailed `docs/DEVELOPMENT.md`.
9. Privacy/security: Host listens on 127.0.0.1, cross-device links use pairing. Include only verified code-backed claims and link `docs/ARCHITECTURE.md`.
10. License, as specified in Part 2.

Exclude Phase numbers, acceptance rounds, commit hashes, internal branches/status words such as frozen/accepted, the word "agent" in the Chinese version (use AI Tool or provider names), the not-yet-updated website link, star/download badges, and claims that planned functionality already exists.

Write the primary English version first, then natural Chinese rather than literal translation. Facts in every section must match. Avoid exclamation marks and excessive dashes in Chinese.

## Part 5: docs/DEVELOPMENT.md

1. Move prerequisites, commands, local data locations, `CODETETHER_DATA_DIR`, and local Host security notes from the old README.
2. Verify each command against the new worktree's `package.json`. Remove nonexistent commands. No need to add newly available commands omitted by the old README.
3. Take Node requirements from `package.json` `engines`, retaining Node 25.5+ for desktop sidecar builds.
4. Name and explain the four desktop build variables (`VITE_CODETETHER_CONTROL_PLANE_URL`, `VITE_CODETETHER_HOST_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) without values. Do not read `.env` or `.secrets/`. If purpose is unclear from code, flag it for confirmation.
5. Leave historical Phase 2–4, API endpoint inventories, and limitation lists in Git history rather than moving them.

## Part 6: Checks and Commit

1. Run `pnpm format:check`. Fix formatting only in files you changed. Report unrelated failures without changing them.
2. Verify README relative links and image paths point to existing files.
3. `grep -rn "chars omitted" README.md README.zh-CN.md docs/DEVELOPMENT.md LICENSE` must produce no output.
4. `git status --porcelain` must contain only scoped files. For another tracked modification, first run `git show :<file> | cmp - <file>`. Restore byte-identical files using `git checkout --`. Otherwise stop and report.
5. Make one commit, `docs: rewrite README for v4, add zh-CN and FSL-1.1-ALv2 license`, ending with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
6. Push `docs/readme-v4` to origin without force. Retry TLS/reset failures at most 3 times, recording each. Stop/report persistent failure.
7. **Do not merge or push main or open a PR.** Reviewer/user decides merging.

## Prohibited Actions

- Reading `.secrets/`, any `.env`, credentials, `~/.claude.json`, or `~/.codex/auth.json`.
- Touching untracked files in `D:/Projects/Software/agenthub`.
- Running installers, starting/quitting CodeTether, or accessing VPS.
- Deleting worktrees.

## Report

Write `D:/Projects/Software/agenthub-archive/readme-v4-report.md`:

- Branch, commit, and push result.
- One or two sentences per changed file.
- Selected screenshots, sensitive-information checks, and sizes.
- LICENSE source URL, retrieval time, and placeholders replaced.
- `format:check` result.
- Pending Confirmation: unsupported omitted features, uncertain claims, or unclear `VITE_*` purposes.

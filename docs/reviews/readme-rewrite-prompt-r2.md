# README rewrite prompt, round 2

For the Codex agent handling README work. Reviewer: Claude Code. Continue after round 1 (`6765d41` on `docs/readme-v4`). Scope, prohibitions, and commit rules in `docs/reviews/readme-rewrite-prompt.md` remain in effect.

## Review conclusions

- LICENSE matches the official FSL-1.1-ALv2 template except for the two placeholders. Passed.
- Text is accurate, has no Phase numbers or internal status, and both language versions agree on facts. Passed.
- Screenshots failed. Both show a test environment with inaccessible/offline/failure markers, test project/conversation names, and macOS username paths. The second is device detail despite being named `conversation-codex.png`. Retake with clean demo data.
- Two small text changes follow in part one.

This round has two steps. Do part one now. Wait for the user to confirm R12 testing is finished and CodeTether has exited from the tray before part two.

## Part one: text (do now)

Edit in `D:/Projects/Software/agenthub-docs-readme`, keeping both language versions synchronized.

1. Describe build configuration as "three required, one optional": `VITE_CODETETHER_CONTROL_PLANE_URL`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_PUBLISHABLE_KEY` are required and checked by desktop builds; `VITE_CODETETHER_HOST_URL` is optional with a local default. Change README's "Configure the four `VITE_*` build settings" and DEVELOPMENT.md's "Configure these four".
2. Add to README "Build from source" that desktop builds currently require an account service (the three settings above), and self-hosted account-service instructions are not yet available. Mirror in Chinese. Include no actual addresses or key values.
3. Remove the repeated "interface is currently Simplified Chinese only" from the screenshot description (the status notice on line 7 already says it). Describe the actual source after part two.

Leave these changes uncommitted until part two, then commit together.

## Part two: retake screenshots (wait for user notification)

Prerequisite: the user replies "R12 has finished; CodeTether has exited". Do not begin earlier: the installed build under testing occupies port 4317 and the single-instance slot.

1. Use browser mode with separate data, preserving production user data:
   - Demo data directory: `D:/Projects/Software/agenthub-archive/readme-demo/data`
   - Demo projects under `D:/Projects/Software/agenthub-archive/readme-demo/projects/`: `weather-cli` (a small Python CLI with `README.md` and `weather.py`) and `notes-web` (static `index.html` and `style.css`). Write a few dozen lines yourself; do not copy real projects.
   - Set `CODETETHER_DATA_DIR` in the same terminal, then run `pnpm host:serve -- --workspace D:/Projects/Software/agenthub-archive/readme-demo/projects` and `pnpm dev`.
   - Confirm port 4317 is free before starting. If occupied, stop and report instead of terminating its owner.
2. In the UI:
   - Complete first-time setup and add both projects;
   - Create a Codex conversation in `weather-cli` and send a file-changing request, such as "Add a Usage section to README explaining how to run weather.py". Choose "Allow once" when approval is needed. Wait for completion and confirm line-by-line changes in the inspector;
   - Create another conversation in `notes-web`, ask anything, and let it finish so the device page and sidebar have content.
3. Take Playwright screenshots at 1440x900 with `deviceScaleFactor` 1.5:
   - `devices-light.png`: devices page in light theme;
   - `conversation-codex.png`: the `weather-cli` Codex conversation with right changes panel open in dark theme;
   - Optional `attention-light.png`: Attention page, preferably with a completed item.
4. Apply round-one screenshot checks: no email, account ID, token, pairing code, IP, hostname, or path containing any system username (Windows or macOS). Paths may only appear under `D:\Projects\Software\agenthub-archive\readme-demo\...`. Each image must be at most 500 KB. Retake failed images; do not edit them.
5. Replace same-named files under `docs/assets/readme/` and remove unused images. Describe their actual source in README: development build in browser mode using demo projects.
6. Stop only the `host:serve` and `pnpm dev` processes you started. Retain the demo data directory.
7. Do not sign in or pair devices. Only "This computer" on the devices page is expected.

## Checks and commit

1. Apply items 1-4 of round-one part six (`format:check`, links/image paths, `chars omitted`, and scope-only `git status`).
2. New commit, without amend: `docs: retake README screenshots with demo data`, ending with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
3. Push `docs/readme-v4` without force, merging main, or opening a PR.

## Report

Append a new "Round 2" section to `D:/Projects/Software/agenthub-archive/readme-v4-report.md`.

- Sentences changed in part one;
- How demo projects and conversations were created, the Codex prompt, and any approval;
- Checks and size for every image;
- Commit hash and push result;
- Problems encountered and unmet requirements.

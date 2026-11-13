# Task: Apply the New CodeTether Icon (Stacked Cards)

Branch `ux/v4-device-first`, workspace `D:/Projects/Software/agenthub-ux-v4-device-first`.

**Prerequisite**: this file is part two of R5 (`ux-v4-device-first-fix-prompt-r5.md`). Continue after committing R5 part one, and perform only sections 1 and 2. Packaging, reinstallation, and installed-location checks belong in R5 parts four and five, sharing one reinstall with the R5 fixes. If executed alone, start from the latest ux/v4-device-first commit with a clean worktree.

The earlier direction A (white connections on blue) and kite are abandoned; do not use them. If you already generated icon files from the kite, regenerate from the new sources and overwrite them.

The reviewer finalized the icon design. Sources are in `D:/Projects/Software/agenthub/docs/ux-redesign/icon/final/`; see README.md there. UI and icons follow docs/ux-redesign, temporarily authorized by the user over AGENTS.md's “Figma is the only source.” Do not alter the artwork; report suspected drawing problems rather than fixing them yourself.

## 1. Generate Icon Files

Copy all three SVGs to `apps/desktop/src-tauri/icons/source/` and commit them for future regeneration.

Use the existing local Playwright Chromium (`C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1237/`) to render SVGs to transparent PNGs; install no new dependencies. Put temporary scripts in `.tmp/`, uncommitted.

| Output | Source |
|---|---|
| `icons/32x32.png` (if referenced by tauri.conf.json) | `codetether-app-small.svg` |
| `icons/128x128.png`, `icons/128x128@2x.png` (256), `icons/icon.png` (512) | `codetether-app.svg` |
| `icons/icon.ico`: six PNG-encoded layers, 16, 24, 32, 48, 64, 256 | `codetether-app-small.svg` for 16, 24, 32; `codetether-app.svg` for 48 and above |
| `icons/icon.icns`: 16, 32, 64, 128, 256, 512, 1024 (including @2x) | `codetether-app-macos.svg` |

- Do not generate everything in one `tauri icon` invocation: it downsizes every size from one image, losing the small variant. You may use it to generate icns first, then verify sizes.
- Write ico and icns containers in Node: ico has a 6-byte header and 16-byte directory entry per layer, with PNG image data; icns uses types `ic04`…`ic10`. Do not use external tools such as ImageMagick.
- Replace existing files without renaming. Modify `bundle.icon` in `tauri.conf.json` only when adding a reference.
- Add `apps/desktop/test/icons.test.mjs` (or extend existing desktop tests), checking:
  - `icon.ico` contains exactly the six layers at the correct sizes;
  - `icon.icns` contains the listed types;
  - PNG dimensions are correct;
  - all three SVGs exist in `icons/source/`.

## 2. Checks

- Remove ANTHROPIC_* environment variables, then run `pnpm typecheck`, `lint`, `test`, `build`; all must exit 0.
- Run prettier checks on changed files in batches (`xargs -n 40`).
- Assemble 16, 24, 32, 48, 256 results into one comparison image in `output/icon-check/` (uncommitted), one row each on light and dark backgrounds.
- Inspect it yourself and record whether the rear card, front card, and `>_` remain distinguishable at 16px. If unable to view images, sample pixel colors and explicitly describe that evidence.

One commit, e.g. `feat(desktop): replace app icon with CodeTether stacked cards mark`, ending with `Co-Authored-By: Claude Code <noreply@anthropic.com>`. No push, merge, or tag.

## 3. Package, Reinstall, and Check Real Installed Locations

Follow steps 3–7 of `docs/reviews/ux-v4-device-first-install-prompt.md`, as in R4 part two:

- Before packaging, copy the current installer into `D:/Projects/Software/agenthub-archive/installers/<first-12-characters-of-R4-commit>/`, with SHA256.
- Account configuration:
  - VITE_SUPABASE_URL is `https://qfktysdrytlaxvhzqpba.supabase.co`;
  - VITE_CODETETHER_CONTROL_PLANE_URL is `https://api.codetether.org`;
  - ask the user for the publishable key.
- Before uninstalling, ask the user to quit CodeTether from the tray. Preserve data.
- After installation, ask the user to launch with `! powershell.exe -NoProfile -Command "Start-Process -FilePath 'C:\Users\Administrator\AppData\Local\CodeTether\codetether-desktop.exe'"`.
- Confirm `hostVersion` is the new commit's first 12 characters.

Icon checks:
- Screenshot these locations: window title bar, taskbar (only its strip), tray region, CodeTether in Start, and the exe's Explorer icon in the installation directory.
- Windows caches icons; report old cached icons if present and do not clear the system icon cache.
- Save screenshots to `output/playwright/v4-icon-check/`.

## Report

Write `D:/Projects/Software/agenthub-archive/v4-icon-report.md`, including:
- Commit hash and check results;
- Icon file dimensions and layers;
- Comparison image and screenshot paths;
- Whether cards and `>_` are distinguishable at 16px;
- New installer SHA256 and `hostVersion`;
- Unconfirmed items, such as icon caching.

## Restrictions

- Edit only `apps/desktop/src-tauri/icons/` and corresponding tests, plus `bundle.icon` in `tauri.conf.json` if necessary. No Rust changes or macOS menu-bar template icons. Do not edit `docs/reviews/`.
- Do not read .secrets/, any .env, credential files, machine-credentials contents, or ~/.claude.json.
- Leave the main workspace's untracked files untouched.
- No `rm -rf`, deleting backups/old installers, or `git worktree remove`.
- Redact `sk-…` and `sb_publishable_…` in logs using sed.
- If permission is denied, do not bypass it; give the user the command as `! …`.
- API 429 or 524: wait per Retry-After, retry at most 3 times, record each time, then stop and report.
- Write the report in Chinese, without exclamation marks or em dashes.

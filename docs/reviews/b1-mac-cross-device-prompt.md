# Task: B1 cross-device acceptance (Mac as the new device)

Run on the Mac. Start after `b1-pairing-fix-prompt-r1.md` has been completed on Windows and `b1/pairing-remote-control` has been pushed to origin. References: the final item in `docs/ux-redesign/06-pairing-remote-control.md` section 4, and physical-device steps 2 and 3 in the Windows report `D:/Projects/Software/agenthub-archive/b1-report.md` (the user will pass along the relevant details).

Before starting, confirm that this file has four second-level headings and that the final section is "Report".

## Goals

Use Windows as the computer and the Mac development diagnostics page `#/dev/supervisor-check` as the new device. Verify the following.

1. **Pairing**: Windows generates a pairing code. Enter it on the Mac diagnostics page and confirm that it shows connected. This Mac appears under "Phones and tablets" on the Windows devices page with the correct name and platform (`macOS-arm64`).
2. **Relay only**: Select "Relay only" on the diagnostics page. All seven original reads, plus `conversation.recent`, `attention.list`, and `conversation.changes`, pass.
3. **Writes and capability gating**: After the user prepares a test Turn and a test Attention item on Windows, perform one `attention.resolve` and one `turn.interrupt` from the Mac. AI tools that do not support approval or stopping must not show those actions.
4. **Last used**: The "Last used" value for this Mac on the Windows devices page updates.
5. **Removal**: Keep a session connected on the Mac while the user removes this Mac from the Windows devices page. Record how many seconds disconnection takes, the error on reconnect, and whether the test work on Windows continues running.
6. **Pair again**: Pair once more with a new code after removal and confirm that connection succeeds. Finally remove the device on Windows so no test authorization remains.

## Known facts

- **Code**: Run `git fetch origin` and create a clean worktree from `origin/b1/pairing-remote-control`, for example `~/agenthub-work/b1-mac-check`. Preserve the Mac's existing worktrees and their uncommitted changes.
- **Development build**:
  - Load build configuration in the launching shell with `set -a; . ~/agenthub-work/v4-build.env; set +a`, without printing its contents.
  - Also set `CODETETHER_CONTROL_PLANE_URL=https://api.codetether.org` and `VITE_CODETETHER_SUPERVISOR_CHECK=1`. Point `CODETETHER_DATA_DIR` at a new isolated directory such as `~/agenthub-work/b1-mac-check-data`.
  - Launch from `apps/desktop` with `node scripts/run-tauri.mjs dev --config src-tauri/tauri.dev.conf.json`.
  - Build the Host sidecar with the official Node version whose SHA256 has been verified, using the same version as Mac round 8. The Host failed to start when round 7 used Node 25.5.0 from `/tmp`.
  - Both development and installed builds use 4317. First exit the installed build with `osascript -e 'quit app "CodeTether"'`. Reopen it after testing with `open -a /Applications/CodeTether.app`.
- **Device identity**: Sign into the same account using the Mac's existing device identity. If it has none, select registration in the main diagnostics window.
- **User actions on Windows** (stop at each relevant step, tell the user, and wait for a reply):
  - Exit the installed Windows build from its tray and launch the B1 development build with `windows-dev-launch.mjs`;
  - Temporarily allow `http://127.0.0.1:5173` on the control service (the Mac development build has the same origin), using `b1-logs/control-plane-test-origin*.py`, and restore it afterward;
  - Open "Add device > Add phone or tablet", provide the six-digit code, and keep the window open until it shows "Added";
  - Prepare the test Turn and Attention item, then perform removal at the end.
- Keep error lines beginning with `[codetether:host]` when redacting logs.

## Precautions

- Do not read `.secrets/`, other `.env` files, credential files, `~/.codex/auth.json`, or `~/.claude.json`. Load `v4-build.env` only as described above.
- Preserve the installed Mac build's data directory. Perform writes only against test targets prepared by the user.

## Report

Append a new "B1 cross-device" section to `~/agenthub-archive/v4-acceptance-report-mac.md`.

- Commit used, Node version, and its SHA256;
- Result and evidence for each goal 1 through 6 (logs or screenshots cropped to the CodeTether window);
- Seconds to disconnect after removal and the reconnect error;
- Incomplete work and its reasons.

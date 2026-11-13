# Task: B4 Mac folder-permission investigation

Run on the Mac. This is an empirical investigation before design, not the B4 implementation. Deliver only a report after testing; do not edit design documents or merge code.

Before starting, confirm that this prompt has four second-level headings and that the final section is "Report".

## Goals

Background: CodeTether's next stage (B4) will let a tablet browse computer folders remotely. Two processes read files on the Mac. macOS prompts for permission to protected folders such as Desktop, Documents, and Downloads. We do not yet know what happens to reads while that prompt is open, or which process receives permission. Results will determine B4's timeout, concurrency limits, and user-facing messages.

- **Host**: the Node SEA child launched by desktop `CodeTether.app` (identifier `com.codetether.desktop`, ad-hoc signed), used to browse this Mac's own folders.
- **CodeTether Node**: the separate user service `com.codetether.node` under launchd, executable `~/Library/Application Support/CodeTether/Node/bin/codetether-node`. It has no application bundle and is ad-hoc signed during the build. It browses this Mac from another computer. Permission is expected to be tracked by executable path.

Answer these seven questions. Test Host and Node separately, covering Desktop, Documents, and Downloads at least once each.

1. **Do metadata checks prompt?** Call `stat` and `access(R_OK | X_OK)` on the protected folder itself and a child folder, without `readdir` or opening it. Does a prompt appear, and do results indicate missing permission?
2. **Can reads block indefinitely?** Measure `readdir` from invocation to completion. Does the prompt appear before the call completes or afterward? If nobody responds, does the call remain blocked?
3. **Read again after denial**: immediately reread the same folder after clicking "Don't Allow". Does it fail immediately (record the error code), or prompt and block again?
4. **Where is permission recorded?** Is Host permission attributed to `com.codetether.desktop`? Does it survive process restart? Does rebuilding with a changed ad-hoc signature invalidate it? If invalidated, does it prompt again or reject immediately?
5. **Does blocking occupy worker threads?** While one read waits on a prompt, measure `fs.promises.stat('/tmp')` and `dns.promises.lookup('localhost')` in the same process. With four blocked reads, do these operations wait until the prompts are answered? (Node.js file operations and `dns.lookup` share the default four-thread pool; this verifies whether blocked reads delay other operations.)
6. **Does Node prompt?** (Node only.) When a launchd-started executable without an app bundle reads a protected folder, does it prompt (under what displayed name), reject immediately, or block indefinitely? Where in System Settings can permission be granted after denial?
7. **After updating Node** (Node only): replace the executable at the same path with different contents, changing its signature. Does prior permission survive? Does copying the identical executable to another path count as a new program?

Also run a control case: create a folder under `/tmp` with `chmod 000`, call `readdir`, and record the error code. Compare with question 3 to see whether privacy denial and ordinary filesystem permission denial can be distinguished.

## Test method

**The probe must run inside the process under test.** The system attributes permission to the responsible process. Children launched from Terminal are attributed to Terminal; this includes `tauri dev` and directly running the executable inside an `.app` from Terminal. Therefore:

- Host: add a probe only for this investigation inside Host. Launch the built `CodeTether.app` with `open`, letting it start Host normally. Verify identifier `com.codetether.desktop` in `Info.plist` and record CDHash with `codesign -dv`.
- Node: use `codetether-node` with the same probe, launched as a LaunchAgent by launchd rather than directly from Terminal.
- Use `fs.promises` through the process's normal thread pool. Record start/end times, duration, and result or error code (`EPERM`, `EACCES`, etc.). For question 5, simulate a timeout with a three-second `Promise.race`, then keep observing when the original call actually finishes.
- Decide how requests reach the probe. One option is to poll a request file in a test directory every 500 ms and write a result file after execution. Terminal writes only requests; file operations happen in the tested process. Place the test directory under `~/agenthub-work/b4-tcc/`, outside protected folders. Enable the probe only while this directory exists, and operate only on requested paths.

**Code**: run `git fetch origin`, create local branch `spike/b4-mac-folder-access` from `origin/main` (`b668e53`), and use worktree `~/agenthub-work/b4-mac-folder-access`. Preserve existing Mac worktrees and uncommitted changes. Do not push or merge. Save the changes afterward as `~/agenthub-archive/b4-mac-folder-access.patch`.

**Build**:

- Load configuration in the build shell with `set -a; . ~/agenthub-work/v4-build.env; set +a`, without printing its contents.
- Host: run `pnpm desktop:build` from the repository root. Output is `CodeTether.app` under `apps/desktop/src-tauri/target`. Build the sidecar with the official Node version whose SHA256 has been verified, matching previous Mac acceptance; other Node versions previously produced a Host that could not start.
- Node: run `pnpm node:sea`; output is under `apps/node/dist/sea/`. The build script performs ad-hoc signing (`apps/node/scripts/build-node.mjs`).

**Host isolation**:

- Keep `/Applications/CodeTether.app` in place. Launch the investigation app from the worktree.
- Never use production data at `~/Library/Application Support/CodeTether`. Either change the default in the spike or use `launchctl setenv CODETETHER_DATA_DIR ...` before `open` (read in `apps/desktop/src-tauri/src/system_tray.rs:180`). Run `launchctl unsetenv` afterward.
- Both versions use 4317. Exit the installed build first with `osascript -e 'quit app "CodeTether"'`, then reopen it after testing with `open -a /Applications/CodeTether.app`.

**Node isolation**:

- Preserve the production `com.codetether.node` service, executable, data directory, and pairing.
- Put the investigation Node at a new path, such as `~/agenthub-work/b4-tcc/node-r1/bin/codetether-node`, with its own data directory and label (for example `com.codetether.node.b4probe-r1`). Follow production plist arguments (template in `apps/node/src/service-installation.ts`: `--data-dir`, `--bind 127.0.0.1`, `--port 0`, and `RunAtLoad`) and start with `launchctl bootstrap gui/$(id -u)`. Pairing is unnecessary.
- Use a new path and label each round. A new path is expected to appear as a program with no system permission record, avoiding resets. Question 7 checks this assumption. If permission is not path-based, stop and tell the user instead of resetting an entire permission category.

**Reset old records**: for Host only, once before testing and once afterward. First tell the user this also clears installed CodeTether's permissions for these three folders, so the installed build will prompt again later.

```bash
tccutil reset SystemPolicyDesktopFolder com.codetether.desktop
tccutil reset SystemPolicyDocumentsFolder com.codetether.desktop
tccutil reset SystemPolicyDownloadsFolder com.codetether.desktop
```

**Sequence**: perform these steps separately for Host and Node.

1. Ask the user to create `~/Desktop/b4-probe/child`, `~/Documents/b4-probe/child`, and `~/Downloads/b4-probe/child` in Finder, with two empty subfolders `a` and `b` in each. Use Finder so Terminal does not prompt for its own permission.
2. Desktop (deny): run question 1, then `readdir` on `~/Desktop/b4-probe`. With only that read blocked, measure `stat` and `dns.lookup` for question 5. Issue one `readdir` each for `child`, `a`, and `b` to reach four blocked reads, then measure again. Ask the user to wait at least 20 seconds before clicking "Don't Allow" and record each call's actual completion time. Immediately read again (question 3).
3. Documents (allow): call `readdir ~/Documents/b4-probe`; ask the user to wait five seconds before clicking "Allow". Restart the tested process (close/reopen the investigation app for Host; use `launchctl kickstart -k` for Node), then read again (question 4).
4. Rebuild: make a small behavior-neutral change, rebuild, and confirm CDHash changed. Open the new Host app; replace Node at the same path and `kickstart`. Read Documents again (questions 4 and 7).
5. Node only: copy the executable allowed in step 3 unchanged to a new path and label, then read Documents again (question 7).
6. Downloads: repeat questions 1 and 2, click "Allow", and confirm consistency with Desktop and Documents.
7. Node only: record the name displayed in the prompt. After denial and allowance, ask the user to find the program in "System Settings > Privacy & Security > Files and Folders" and "Full Disk Access". Record where it appears and whether permission can be changed there (question 6).

**User actions** (stop at the relevant step, explain it, and wait for a reply): create test folders; before each prompt, specify the delay and button; check System Settings for questions 6 and 7.

**Cleanup**:

- `launchctl bootout` every investigation Node label and remove its plist, executable, and data directory. Remove investigation app build outputs.
- Run the `tccutil reset` commands again and reopen the installed build.
- Confirm production `com.codetether.node` remains running (`launchctl print gui/$(id -u)/com.codetether.node`) and ask the user to verify this Mac still appears online on the Windows devices page.
- Ask whether to remove test folders and leftover investigation-program entries in System Settings.

## Precautions

- Do not read `.secrets/`, other `.env` files, credential files, `~/.codex/auth.json`, or `~/.claude.json`. Load `v4-build.env` only as described above.
- Your commands must not directly read contents of `~/Desktop`, `~/Documents`, or `~/Downloads`, including Terminal `ls`. Otherwise permission is attributed to Terminal and the tested process's behavior cannot be measured. Inspect probe result files instead.
- `launchctl`, `open`, `tccutil`, and `codesign` require an unsandboxed environment. If blocked, stop and tell the user; do not bypass it.
- Do not directly read/write `TCC.db`, grant Terminal Full Disk Access, or run `tccutil reset` without an application identifier (which clears permissions for every program).
- Capture only permission prompts and the relevant System Settings section, excluding other windows.
- Keep probe code on the spike branch, outside any branch intended for merging.

## Report

Write `~/agenthub-archive/b4-mac-folder-access.md`.

- Commit used, `sw_vers` output, chip model, Node version and SHA256 for SEA, and each tested program's identifier and CDHash (before/after rebuilding).
- A table by question, process (Host / Node), and folder, with operation, result/error code, milliseconds, whether a prompt appeared, and when it appeared in each cell.
- Question 5 `stat` and `dns.lookup` durations with zero, one, and four blocked reads.
- Error code from the `chmod 000` control case.
- Prompt screenshots, displayed names, and System Settings locations for question 6.
- One conclusion per question, limited to observed behavior without design recommendations.
- Incomplete work and reasons, plus cleanup performed.

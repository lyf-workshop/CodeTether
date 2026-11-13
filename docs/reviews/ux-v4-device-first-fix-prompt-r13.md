# Task: fix idle Composer stuck reconnecting, then retest system notifications (R13)

Run on Windows. UI follows docs/ux-redesign under temporary authorization overriding AGENTS.md's "Figma is the only source" rule.

User requirements:
- The agent judges the installed UI using UIAutomation and CodeTether-only screenshots, without delegating UI judgments to the user.
- Perform computer operations directly. Give policy-denied commands to the user as `! …`, without bypassing.

Before starting, confirm eleven second-level headings ending in "Restrictions". Stop/report if incomplete.

## Background

- R12 item 9 stopped before B's send: twice after launches with logs, the conversation Composer stayed at "Cannot send messages now" and "Reconnecting CodeTether; wait for recovery"; it worked after one normal launch. Neither B nor C ran. Report `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r12.md`.
- Review identified this mechanism:
  - Conversation projection is stored under QueryClient `['host', 'conversation-projection']` by `replaceHostProjection` (`setQueryData`), using default five-minute gcTime;
  - Only `useHostProjection` (`apps/web/src/runtime/host/host-runtime-hooks.ts:28-39`) raises gcTime to infinity, and only `conversation-detail-route.tsx:261` uses it;
  - Staying at /devices without opening a conversation for five minutes lets projection be collected;
  - `conversation-gate-presentation.ts:40-43` presents connected-without-projection as reconnecting; `conversation-detail-route.tsx:296-301` returns early without projection;
  - HostRuntime detects missing projection and refetches only on the next Host event (`host-runtime.ts:814-818`). Idle sessions have no event, so Composer remains blocked.
- HostRuntime stays connected, matching `sse-connected` logs.
- `[codetether:http-error] AbortError` comes from cancelling native-record reads when leaving a conversation (`local-http-server.ts:1679-1683`, logged as internal by `http-boundary.ts:349-351`). It is noise, not the cause; leave it unchanged.
- Stderr redirection and working directory are ruled out: `host_supervisor.rs:253-274` sets no current_dir, and both logged launches had Host ready within 470 ms.
- R12 logs lack timestamps, so the installed build's over-five-minute idle condition is unverified. Reproduce first in part two.
- Fix: set infinite gcTime/staleTime defaults for this key in HostRuntime's constructor. query-core 5.102.2 `setQueryData` merges `getQueryDefaults(queryKey)`, so defaults apply to `replaceHostProjection` writes.

## Part one: preparation

1. Worktree `D:/Projects/Software/agenthub-fix-macos-notifications`, detached HEAD.
   - `git fetch origin`; verify HEAD and `origin/fix/macos-notifications` equal `111f1b08e5f398581f992212789654d802498795`. Stop if remote advanced; do not switch commits.
   - `git status --porcelain --untracked-files=no` must be empty.
   - Compare modified tracked files individually with index as in R12 (`git show :<file> | cmp - <file>`). Byte-identical CRLF false positives may be restored with `git checkout -- <file>`; otherwise stop/report.
   - Record `node --version`, requiring 25.5+.
2. Back up R12 installer before part four overwrites it:
   - Source `D:/Projects/Software/agenthub-fix-macos-notifications/apps/desktop/src-tauri/target/release/bundle/nsis/CodeTether_0.1.0-alpha.0_x64-setup.exe`;
   - Expected SHA256 `ADDFCD5015CE2E4076BB6689AF3A93EC49CD5066C4ABF8441737F9BA7C874E44`, size 26751389 bytes;
   - Copy to `D:/Projects/Software/agenthub-archive/installers/111f1b0/` with `SHA256SUMS.txt`;
   - Stop/report on mismatch.

## Part two: reproduce in installed build (pre-fix baseline)

Goal: confirm a normal launch staying outside conversations for over five minutes blocks Composer. Send no turns.

1. If running, exit normally through "Exit CodeTether" in the tray, without force. Confirm zero Desktop/Host processes three times at 500 ms intervals.
2. Ask user to launch normally from Start and reply "Opened". Agent Start-menu launch failed at R12's end, so user performs this step.
3. After reply, read-only record:
   - Desktop process start UTC to the second as timing origin;
   - `hostVersion` from `curl -H 'Origin: http://tauri.localhost' http://127.0.0.1:4317/api/v1/bootstrap`, expected `git-111f1b08e5f3`;
   - Current route, expected /devices. Already opening on a conversation invalidates baseline; note why and skip to part three.
4. Stay at /devices while waiting, without project/conversation pages, notification clicks, or closing the window.
5. Six minutes after startup, use existing project/conversation links to open test Codex in `v4-accept-project`, recording entry time. Read Composer through UIAutomation:
   - Presence of "Cannot send messages now" / "Reconnecting CodeTether";
   - Edit input and "Send message" button;
   - Capture Composer only.
6. If blocked, wait another 30 seconds and reread to exclude transient entry state.
7. Conclude only "Reproduced" or "Not reproduced". Nonreproduction does not block later steps. Note that this unlogged launch cannot establish whether Host events occurred during idle.
8. Tray-exit normally, confirming zero Desktop/Host three times. Keep closed during packaging.

## Part three: fix

Change only `apps/web/src/runtime/host/host-runtime.ts` and `apps/web/test/host-runtime.test.mjs`.

1. Add tests first using node:test mock timers (`t.mock.timers.enable({ apis: ['setTimeout'] })`) before QueryClient construction, because GC timers are scheduled at cache creation:
   - Test one: use existing `createQueryClient()`/`FakeHostClient` to create `HostRuntime` without `start()`, write projection through `queryClient.setQueryData(hostQueryKeys.projection, …)`, advance the clock with `t.mock.timers.tick(301_000)`, and assert `readHostProjection(queryClient)` still has data;
   - Control: QueryClient without HostRuntime, same write/tick, assert `undefined`. This proves timers drive GC and test one detects it;
   - Clean up through `t.after` like existing tests.
2. Before runtime changes, run `pnpm exec tsc -p tsconfig.test.json && node --test --test-concurrency=1 test/host-runtime.test.mjs` in `apps/web`. Record test-one failure and control success. If test one passes, repair the test before proceeding.
3. After constructor assignment `this.#queryClient = options.queryClient`, add:

   ```ts
   // The Conversation projection is runtime-owned state, not a disposable
   // cached read. Default gcTime would drop it after 5 minutes without a
   // mounted Conversation page and leave the composer gated as reconnecting.
   this.#queryClient.setQueryDefaults(hostQueryKeys.projection, {
     gcTime: Number.POSITIVE_INFINITY,
     staleTime: Number.POSITIVE_INFINITY,
   })
   ```

   `hostQueryKeys` is already imported from `./host-query.js`.
4. Preserve `conversation-gate-presentation.ts`, `conversation-detail-route.tsx`, `host-runtime-hooks.ts`, and AbortError logging.
5. Verify in `apps/web`:
   - `pnpm test`: all pass, two more tests;
   - `pnpm typecheck`: no errors;
   - `pnpm exec eslint src/runtime/host/host-runtime.ts test/host-runtime.test.mjs`: no new errors/warnings.
   Fix only those two files. Stop/report if unresolved.
6. `git diff --stat` must contain only these files. Commit directly on detached HEAD:

   ```text
   fix(web): keep Host projection cache alive while idle

   The Conversation projection used the default 5 minute gcTime unless a
   Conversation page was mounted. After it was collected the composer
   showed "reconnecting" until the next Host event arrived.

   Co-Authored-By: Claude Code <noreply@anthropic.com>
   ```
7. Fetch again before pushing; `origin/fix/macos-notifications` must remain `111f1b0`. Stop if advanced. Fast-forward push without force:
   `git push origin HEAD:refs/heads/fix/macos-notifications`
   If policy denies it, provide `! git -C D:/Projects/Software/agenthub-fix-macos-notifications push origin HEAD:refs/heads/fix/macos-notifications` to user, then continue packaging without waiting for push completion.
8. Record full new commit and first 12 characters. Below, `<new commit>` and `<new build ID>` mean that commit and `git-` plus its first 12 characters.

## Part four: packaging

1. Follow R12's scripts in `.tmp/v4-r13-desktop-build.sh` and `.tmp/v4-r13-desktop-build.mjs` in this worktree:
   - `.sh`: new log `D:/Projects/Software/agenthub-archive/v4-r13-desktop-build.log`, `task_expected_commit` = `<new commit>`, `task_expected_build` = `<new build ID>`, otherwise copy unchanged. Never overwrite logs;
   - `.mjs`: keep reading `.tmp/v4-r12-build-config.json` without copying/modifying/printing it; launch `.tmp/v4-r13-desktop-build.sh` and change R12 wording to R13.
2. Never set `CARGO_TARGET_DIR`.
3. Run `node .tmp/v4-r13-desktop-build.mjs`. Request required approval; if denied by policy, have user run outside Codex.
4. Verify:
   - `DESKTOP_BUILD_EXIT=0`, `REDACTION_EXIT=0`;
   - `<new build ID>` without `-dirty`;
   - Handle generated TOML/Cargo.toml as in part one, ending clean;
   - Installer path/size/SHA256, different from R12.

## Part five: installation and launch (user outside Codex)

Agent runs no installer/uninstaller. R7 showed Codex-launched installer Start-menu writes are redirected and Windows does not register CodeTether.

Continue launching with logs. R12's two failures used that launch, so passing under identical conditions also rules out stderr redirection.

Give the user these steps and wait:
1. Run in Claude Code (substitute part-four installer path):
   `! start "" "<new installer path>"`
   Install defaults; tray-exit if it opens automatically.
2. Launch with logs:
   `! powershell.exe -NoProfile -Command "Start-Process -FilePath 'C:\Users\Administrator\AppData\Local\CodeTether\codetether-desktop.exe' -RedirectStandardError 'D:\Projects\Software\agenthub-archive\v4-r13-desktop-stderr.raw'"`
3. Reply "Installed and launched with log command".

Then read-only verify:
- `hostVersion` = `<new build ID>`;
- One installed Desktop/Host; record Desktop start UTC to second;
- `HKCU\Software\Classes\codetether\shell\open\command` still points to installed `codetether-desktop.exe "%1"`;
- `notification stage=sse-connected` exists; otherwise stop before live testing;
- Counts match R12 (5 projects, 3 devices, 11 test turns); record mismatches without data changes;
- Current route /devices.

## Part six: live testing

Use the test Codex conversation in `v4-accept-project`.

Test A, idle Composer (no send):
1. Stay at /devices after startup, never opening projects/conversations.
2. At six minutes after Desktop start, open via existing links and record entry time.
3. UIAutomation confirms Edit/Send message and absence of cannot-send/reconnecting messages. Capture Composer only.
4. If blocked, reread after 30 seconds. If still blocked, capture and stop without B/C.

Follow R12 part four for B/C, sending "Reply only OK; do not read/write files" in the installed input each time. Prompt `D:/Projects/Software/agenthub/docs/reviews/ux-v4-device-first-fix-prompt-r12.md`. Differences:
- C step 5 expects `<new build ID>`;
- User still clicks Notification Center for "Clicked"; agent does not;
- Agent may tray-exit in C step 3, then confirm zero Desktop/Host three times.

Check R12 diagnostic stages: `received`, `window-state-start`, `window-state-done`, `metadata-start`, `metadata-done`, `permission-start`, `permission-done`, `deliver-start`, `deliver-done`, then `notification requested`/`notification shown`. Record `window-state-timeout`, `permission-timeout`, any `failed-…`, or minimized `skip-suppressed`. C's launch has no logs; judge window/route.

Item 9 passes if A passes, B/C open correct conversations, notification contains "Local computer / v4-accept-project" plus explanation without conversation title, and no `failed-…`. A `…-timeout` with delivery still passes if disclosed.

## Budget and stopping conditions

- At most two Codex turns, one each B/C, without retries. Zero Claude Code turns. Part two and A send nothing.
- Nonreproduction in part two: continue and report.
- Unresolved part-three checks: stop before packaging.
- A fails: stop without B/C or further code changes.
- Item 9 fails: identify stage/logs and stop; user decides whether to restore backed-up R12 installer.
- API 429/524: Retry-After, at most three retries with timestamps, then stop/report.

## Prohibitions

- Only two part-three files, one commit, fast-forward push only to `fix/macos-notifications` without force. No main merge/tag/PR or other branches.
- Agent runs no installers/uninstallers. Exit only through tray, never force.
- Preserve account, Provider selection, gateway, `~/.codex`; no pairing/unpairing/project add/remove.
- Preserve registry, notifications, shortcuts, icon cache.
- Preserve backups, old installers, `v4-firstrun-data`; no `git worktree remove`.

## Logs and report

- After logged process exits (C step 3, or agent tray-exit if A fails), process raw logs:
  - Redact `sk-…`, `sb_publishable_…`, Bearer with sed;
  - Keep `[codetether:desktop]`, `[codetether:lifecycle]`, `notification` lines and `[codetether:host]` error lines, excluding `provider-unknown-notification`;
  - Save `D:/Projects/Software/agenthub-archive/v4-r13-desktop-stderr.sanitized.log`, then delete only that `.raw`.
- Leave CodeTether open after testing (C's notification-launched instance); if closed, ask user to Start-menu launch normally.
- Write `D:/Projects/Software/agenthub-archive/v4-acceptance-report-r13.md`:
  - Worktree HEAD, Node version, R12 backup path/hash;
  - Part two start/entry times, Composer readings, screenshot, reproduced/not reproduced;
  - Part three pre-fix failure, final test count/typecheck/lint, commit, push result or user command;
  - Installer path/size/SHA256 and two build-log exits;
  - Running version, registry/data verification;
  - A startup/entry times, readings, screenshot;
  - B/C timelines (send, complete, shown, dismissed, click, activated/link, restore, route), stages, screenshots;
  - Notification copy;
  - Item 9 conclusion/cumulative checklist.
- Screenshots: `D:/Projects/Software/agenthub-fix-macos-notifications/output/playwright/v4-installed-acceptance-r13/`.
- Final Chinese reply includes baseline reproduction, A/item-9 outcomes, commit hash, installer SHA256.

## Restrictions

- Do not read .secrets/, any .env, credentials, machine-credentials contents, `~/.claude.json`, `~/.codex/auth.json`, or archived `phase9c-control-plane.env`.
- Never open/print `.tmp/v4-r12-build-config.json`; only launcher passes it to the build child.
- No `rm -rf`. Give policy-denied commands as `! …` without bypassing.
- Report in Chinese without exclamation marks/em dashes.

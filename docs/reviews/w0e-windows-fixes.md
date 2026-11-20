# Review: `fix/w0e-after-alpha4` (2026-11-20)

**Branch.** Pushed at `79d67eb`. It starts from `main` at `13fa6b8`.

- Task prompt: `w0e-windows-fixes-prompt.md`, with the goal 10 addendum from `2026-11-19-main-detail-pass.md`.
- Report: `D:/Projects/Software/agenthub-archive/w0e-windows-fixes-report.md`. Evidence: `D:/Projects/Software/agenthub-archive/w0e-evidence/`.
- Three commits:
  - `d8c5822`: Composer, menus, conversation states
  - `d49cd8b`: file references, inspector tabs, title bar
  - `79d67eb`: status check, 待处理
- 49 files, +1,572 / −166 lines.

**Gates (as reported):**

- `pnpm typecheck`, `pnpm lint`, `pnpm build` and `pnpm test` passed: Web 1,046 of 1,046, Host 608 of 608
- `cargo test` in `apps/desktop/src-tauri`: 83 unit tests and 3 integration tests
- `cargo test` in `packages/supervisor-mobile`: 8 unit tests and 4 interop tests. It was run because the phone reads the same filtered 待处理 list.
- Prettier passed on every changed file. The repository-wide `pnpm format:check` fails on the Windows line-ending baseline (W0f carried item 5).

**Status.** The first follow-up round (`74969a8`) fixed both must-fix items. Claude Code's live check then found the real cause of the cold-start error that goal 10 targeted, so a second short round follows; see "Follow-up round 1" at the end.

**Verdict (first review).** Accepted after one follow-up round.

- Goals 1–7 and 10 are met. Claude Code measured goals 6 and 7 again on its own build.
- Before merging, two must-fix items:
  1. Found today: a new Codex conversation cannot send when Codex's default model is missing from CodeTether's model list. It predates W0e but blocks the Owner now.
  2. The Composer collapses at the first keystroke after a multi-line message.
- Then W0e merges and alpha.5 follows.

## Checked hands-on

**Setup.**

- **Build.** W0e merged locally with current `main` (`745c701`, which includes W0f). `git merge-tree` was clean. The merge was built in Claude Code's review worktree and not pushed.
- **Runtime.** An isolated Host with its own port and a copy of the detail pass's data, plus the web UI from Vite on port 5392.
- **Browser.** Headless Chromium.
- **Evidence.** `D:/Projects/Software/agenthub-archive/w0e-review-2026-11-20/`:
  - screenshots in `shots/`
  - measurements in `live-w0e-1440.json`, `menus.json` and `probe-pages-all.json`

**The Composer through a live Codex Turn** at 1440 px. The prompt and Approval match the detail pass. Heights are in CSS px.

| State                | `main` (detail pass) | W0e |
| -------------------- | -------------------- | --- |
| Idle                 | 135                  | 135 |
| 300 ms after sending | 203                  | 135 |
| Running              | 203                  | 135 |
| Waiting for Approval | 203                  | 135 |
| Ended                | 135                  | 135 |

- **While running:**
  - The input stays editable: "下一条草稿" typed in.
  - Enter sends nothing and keeps the draft.
  - Stop replaces Send in the same 80 px slot.
  - The middle slot reads "Codex 正在工作", then "等你批准".
  - The hint line stays 18.69 px high.
- **Menus** at 1440, 1100 and 800 px:
  - The Codex model menu is 125 px wide for an 83 px button, one line per model.
  - The Claude model menu is 89 px wide for a 78 px button.
  - No check mark overlaps text.
  - The conversation's "…" menu and the command palette are unchanged.
  - Claude Code's probe counted wrapped items. These were false positives caused by the new block label; the screenshots show one line per item.
- **Goal 10:**
  - While a command waits for an Approval, its row reads "执行命令 node --test · 等待批准" with a pause icon.
  - The running placeholder reads "实时活动将在这里显示。" in muted text, with no border.
  - **The current sidebar row** is clearly visible in both themes:
    - light: `rgb(203,195,183)` on `rgb(243,241,237)`
    - dark: `rgb(57,54,49)` on `rgb(21,20,19)`
  - **Claude Code:** the hint reads "回车发送，Shift + 回车换行", and the placeholder reads "问 Claude 一个问题（只读取和搜索文件）…".
- **Goal 2:** 关于与检查 reads "CodeTether 可以使用 · 就绪" and "这台电脑至少有一个 AI 工具可用。选择项目后即可开始工作。"
- **Goal 5:** on the 失败 tab, "全部知道了" asks "将这 17 项标为'知道了'。会话和历史记录不会受到影响，等待批准的事项不会被清除。"
  - After confirming, 17 items cleared and the badge went from 57 to 40.
  - The page stayed on 失败, and the button hid at zero.
- **Page probes** (待处理, 关于与检查 and a conversation, at 1440 and 800 px in both themes): the same counts as on `main`. No new overflow or cut-off text.
- **Not checked again here:**
  - **The native title bar:** the report's screenshots
  - **Hiding archived items:** Host tests and the report's check on a database copy
  - **File links:** Codex answered with inline code this time, so the report's screenshot and tests stand.

## Code review notes

- **Select primitive.**
  - The menu is `w-max`, at least as wide as its button and at most as wide as the available space.
  - Items truncate and carry the full label as a tooltip.
  - Disabled items keep pointer events so their tooltip shows; Radix still blocks selecting them.
- **Composer.** Editing is allowed while running or waiting. Sending needs no gate.
- **Model list.** The automatic read stays quiet on failure. Opening the menu queues one explicit read.
- **待处理.**
  - One SQL filter serves both the list and the count. Approvals are exempt, and the records stay.
  - The web refetches on `conversation.updated`. The Host publishes that event only on organization changes (three call sites), so the cost is low.
- **Status check.** Without a project, the overall state comes from this computer's AI tools. Protocol validation is relaxed only for that case.
- **Inspector.**
  - A local Codex conversation always has 变更 and 工具输出.
  - Other conversations show 工具输出 once there is output. A remote Codex conversation therefore loses its empty 工具输出 tab until its first tool runs, which is acceptable.
- **Title bar.** Only `core:window:allow-set-theme` was added.

## Must-fix before merging

1. **A new Codex conversation cannot send when Codex's default model is not in CodeTether's model list.** This is a new finding; it exists on `main` and in alpha.4.
   - **What happened.**
     - At 06:49 today, a newer Codex wrote `model = "gpt-6.2-astra"` into the Owner's Codex config. `~/.codex/models_cache.json` records client 0.169.0.
     - CodeTether runs Codex CLI 0.162.1, whose model list has 8 models up to GPT-6.1 Terra and no GPT-6.2.
     - A new Codex conversation takes the configured default. The Composer warns "gpt-6.2-astra 不在此账号的可用模型中", but Send stays enabled.
     - Sending returns 400 `invalid_request` "The selected model is unavailable for this Agent" (`assertProviderConfiguration` in `host-service.ts`). The UI says "请求内容无效，请检查后重试。" and marks the message "未发送".
     - After the user picks a listed model, the red error stays until the next send.
   - **The installed alpha.4** has the same code and reads the same Codex config, so its new Codex conversations will likely fail the same way. Conversations that already exist keep their stored model.
   - **Required:**
     - A new Codex conversation can send its first message without the user knowing about this mismatch.
       - **Preferred:** when the configured default is not in the list, start with the list's default model, and say once in the Composer which model it uses and why.
       - Report how the default is resolved today, and what Codex's model list marks as default.
     - While the current model is known to be unlisted, Send is disabled, and its reason and the warning line both say to pick a model.
     - The Host's "model unavailable" error gets its own message, not "请求内容无效".
     - Changing the model clears an earlier send error.
     - Existing conversations keep their stored model.
   - **Tests:** one for each item above, plus a real check on an isolated Host. The Owner's Codex config reproduces this today. Do not change that config.
2. **The Composer collapses at the first keystroke after a multi-line message.**
   - **Measured:**
     - A six-line draft makes the Composer 238.63 px high, and it stays that high after sending.
     - The first keystroke of the next draft, while the Turn still runs, shrinks it to 135 px. That moves the timeline by 104 px.
   - **Rule:** goal 6's ≤ 1 px applies across a Turn's states with the same draft.
     - Sending clears the draft, so the Composer returns to its empty height at once, as in every chat app.
     - Its height depends only on the draft, never on the Turn's state or on what was sent before.
     - Remove the held height. 10 §3.3 now says this.
   - **Test:** send a multi-line draft. The Composer is at its empty height when sending finishes and stays there through the Turn.

## Should-fix in the same round

3. **The hint line flashes** "草稿会保留，CodeTether 不会自动重发消息。" for about 250 ms while a message submits. Keep the previous hint until the Turn is running.
4. **Remove the unreachable Stop button** in the archived and unavailable panel (`composer.tsx`, about line 642). Those states never allow interrupting.
5. **Optional: redundant tooltips.** Select items show a native tooltip even when the whole label is visible, so hovering a model shows its name again. Set `title` only when the label is cut off.

## Carried items

1. **Bulk "知道了" reads at most 100 items of a type,** because the read has no cursor (see the report). If more than 100 acknowledgements of one type fail, the rest stay open. A cursor needs a Protocol change. Backlog.
2. **The current sidebar row's surface contrast** is 1.55:1, below the 3:1 target for non-text indicators. It is also marked by font weight and `aria-current`, and it is clearly visible. Accepted; D3a can revisit the token.
3. **Docs.**
   - PRODUCT's Inbox rules were updated with this review: archived conversations' items are hidden, and each tab has "全部知道了".
   - 10 §3.3 now has the Composer's height rule.
   - ROADMAP status changes at release.
4. **Seen during this check, older than W0e, and routed:**
   - The timeline row shows Codex's command with doubled quotes (`"rg --files -g ""!node_modules"" -g ""!vendor"""`). This goes to D3b goal 9, with detail-pass finding 16.
   - The dock still says "审批" (D3a goal 4, already listed).

## Merge order

The UI/UX runtime audit branch (`ui-ux-runtime-audit.md`) is accepted and starts from current `main`, so it merges first. W0e's follow-up round then merges `main` and runs the gates again. `git merge-tree` of the two branches is clean; both touch `composer.tsx` on different lines.

## Follow-up round 1 (2026-11-20, `74969a8`)

**What changed.**

- `3d39ffa` holds the fixes, `885adf1` merges `main` (with the UI/UX runtime audit), and `74969a8` updates tests.
- Report: the same file, extended.
- **Gates (as reported) on the merged branch:**
  - typecheck, lint, build and test passed: Web 1,054 of 1,054, Host 623 of 623
  - desktop `cargo test`: 90 unit and 3 integration tests
  - the Android Gradle gates
  - Prettier on 64 changed files
- `git merge-tree` into `main` (`6fb9dd3`) is clean.

**Code read.**

- **The fallback model.**
  - When a new local Codex conversation has no explicit model, the Host reads only `model` from Codex's `config/read`.
  - If that model is not in `model/list`, the Host starts the thread with the list's default (`isDefault`), or else the list's first model.
  - The create response carries `modelFallback`. The web shows it once in the Composer.
  - If Codex returns a model that is not listed, or ignores the fallback, creating the conversation fails with `provider_model_unavailable` instead of a later send failing.
- **Sending with an unlisted model.**
  - While the current model is not listed, Send is disabled. Its reason and the warning say to pick a model first.
  - The Host's rejection carries `provider_model_unavailable`, now shown as "所选模型当前不可用。请选择列表中的可用模型后再发送。"
  - Changing the model clears an earlier send error.
- **The held height** is gone.
- **Smaller fixes.**
  - The hint keeps its text while a message submits.
  - The panel keeps Stop only for an unavailable conversation whose local Turn can still be interrupted, not for an archived one.
  - Select items set `title` only when the label is cut off or carries extra detail.

**Checked hands-on** on `74969a8` (isolated Host, same setup). Evidence: `w0e-review-2026-11-20/`, `live-w0e2-1440.json` and `cold-1.txt`.

- **Must-fix 1, met.**
  - A new Codex conversation started on GPT-6.1 Terra, and both Turns ran.
  - With the Host warm, the Composer said once: "Codex 配置的默认模型 gpt-6.2-astra当前不在模型列表中，CodeTether 已选择可用模型 gpt-6.1-terra。可在上方菜单切换模型。"
- **Must-fix 2, met.**
  - A six-line draft made the Composer 238.63 px high. It was 135 px 50 ms after sending, stayed 135 px while running and while waiting, and was still 135 px at the first new keystroke.
  - A one-line Turn with an Approval stayed 135 px throughout, as in the first review.
- **New: the cold-start error, found and explained.**
  - Right after the Host starts, a conversation created at once shows a red "CodeTether 暂时无法连接，请重试。" under the Composer, and no fallback notice. The error stays through later, successful Turns. Every request in that window succeeded.
  - Reproduced twice in two cold starts. It never showed with the Host warm.
  - **Cause.**
    - As the conversation opens, the Composer's model Select receives an untrusted `change` event from Radix's hidden native `<select>`, with value `""` and no options (recorded in `cold-1.txt`).
    - Radix passes this to `onValueChange("")`. The Composer then hides the fallback notice and calls `update({ model: "" })`.
    - The client's protocol check rejects the empty model before any request is sent. `mutationErrorMessage` shows any error that is not a Host response as "CodeTether 暂时无法连接，请重试。"
  - This is very likely the real cause of detail-pass finding 1 (W0-27). Goal 10's quiet model-list read was right but did not cover it.
- **New, pre-existing: the New Conversation dialog never refreshes Codex's availability.**
  - Opened 2 s after the Host started, it showed "Codex · 暂时不可用", and Codex could not be selected. It still said so after 60 s in the open dialog; no request was made.
  - Closing and opening the dialog again showed Codex available.
  - Someone who opens CodeTether and clicks 新建会话 at once sees Codex as unavailable until they reopen the dialog.

## Must-fix in follow-up round 2

1. **Never act on an empty Select change.**
   - Radix Select items cannot have the value `""`, so `onValueChange("")` never comes from a user's choice.
   - The shared `Select` in `packages/ui` ignores it, so every Select in the app is covered.
   - The Composer's model and reasoning handlers also do nothing when the value equals the current one.
   - **Tests:** the primitive drops `""`. The Composer neither updates the model nor hides the fallback notice on such an event.
   - **Real check:** a cold start, then creating a Codex conversation at once, 3 times. Each shows the fallback notice and no error.
   - Report whether this also explains W0-27.
2. **The New Conversation dialog shows each AI tool's current availability while it is open.**
   - While the Host is still checking an AI tool after starting, the option says "正在检查…", not "暂时不可用".
   - It becomes selectable as soon as the Host reports the tool ready, without reopening the dialog. Use the existing Host events or a bounded refetch while a tool is still being checked.
   - Report how long Codex takes to become available after the Host starts, and what the Host reports in between.

**Should-fix:** in the fallback notice, put a space before "当前", and name the selected model by its display name ("GPT-6.1 Terra"), as the menu above it does.

**Carried from round 1:**

- **Codex's own default.** The fallback applies only when Codex's config names a model. If no model is configured and Codex's own default is unlisted, creating the conversation fails, and the New Conversation dialog has no model field to work around it. That is unlikely today. If it happens, extend the fallback to that case.
- **`CreateConversationData`** has a new optional `modelFallback` field. The phone creates conversations through `createConversationWithFirstTurn`, which returns only the conversation and its first Turn. So the phone never receives the field, but its new Codex conversations still get the fallback model.

**Then W0e merges, and alpha.5 follows.**

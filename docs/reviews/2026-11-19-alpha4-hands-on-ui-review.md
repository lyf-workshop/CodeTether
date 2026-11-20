# Hands-on UI Review: Installed alpha.4 (2026-11-19)

Claude Code used the installed app itself after the alpha.4 release, at the Owner's request ("you should personally check the UI, the layouts of the various screens, and what it's actually like to use"). This complements the agents' screenshots; it does not replace acceptance.

## How it was checked

- **Build.** The installed `v0.1.0-alpha.4` (`git-6283aa0e1ab9`), started from the Start menu by the release agent, with the Owner's real data.
- **Window.**
  - Default: 1900 × 1250 px at 150 % scaling, which is about 1267 × 833 CSS px.
  - Also resized to 1100 and 800 CSS px.
  - Light and dark themes. The theme and the window size were restored afterwards.
- **Data.**
  - The Owner's projects and conversations were only looked at.
  - One real Codex conversation ran in the W0 scratch project `ta-budget-app`. It asked Codex to list the files and run `node --test`, without changing anything. One Approval for `node --test` was allowed.
  - That conversation was left unarchived. The menu could not be driven reliably once another app took the foreground.
- **Tools.**
  - Windows UI Automation and window screenshots, in `D:/Projects/Software/agenthub-archive/ui-review-2026-11-19/`.
  - Typed keys are unreliable through that path: the system's Chinese input method converts ASCII, and the Alt key used to bring the window forward swallows the next key. So keyboard-only behavior (for example Esc in the command palette) was not judged.
  - The tray was not re-checked; the release agent did.

## Overall

**The core loop works and feels quick:**

- The conversation was ready about 3 s after "创建会话".
- My message appeared at once, and "Codex 正在运行" showed straight away.
- Codex's first words arrived after about 10–20 s. That is model time, not CodeTether.
- The Approval dock is clear: it shows the command, "允许一次" and "拒绝", and the Composer says "等你批准一条命令".
- After one Turn failed, the next message in the same conversation ran normally.

**What hurts daily use, in order:**

1. **The timeline does not say what happened.**
   - Rows read "执行命令", followed by the last line of output: "duration_ms 82.4813", "}", "})", "A budget.test.mjs".
   - Each step repeats the header, and a message says "已完成" while its Turn is still running.
   - This is exactly W0-13 to W0-16. D2.5 fixes all of it, but it is not released yet.
2. **Codex's answers show raw Markdown file links,** with full absolute paths (finding 2).
3. **Noise everywhere else.**
   - 74 items in 待处理, most of them weeks old.
   - A sidebar full of test projects, with filler rows.
   - Warning boxes in normal states.
   - A diagnostics wall in Settings.
4. **One Turn failed inside CodeTether's runtime,** and nothing on this computer can say why (finding 1).

## New findings

| #   | Severity    | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Evidence                                                    | Where it goes                                                                       |
| --- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | High        | **A Turn failed with "运行时执行失败", and the cause cannot be found.** About 51 s into a simple Turn, after seven commands, the Turn ended with `runtime_unavailable` / `runtime_error` ("Codex runtime failed", source "CodeTether 运行时"). The card says only "请查看技术详情和当前执行状态", and its details are codes. The Host writes no diagnostic log; `%LOCALAPPDATA%/CodeTether/logs` holds only `host-presence.jsonl`. The local Codex health row now reads "unavailable" (17:40:06 UTC). The next message in the same conversation worked. The release agent's two start failures ("本地服务意外退出") also left nothing to read. | `24-sent-40s.png`, `25-later.png`, `26-failure-details.png` | W0f (diagnosis), below                                                              |
| 2   | High        | **Raw Markdown links in answers.** Codex wrote "[README.md](README.md)、[budget.mjs](E:/Projects/…/budget.mjs)". The safe Markdown renderer accepts only `http`, `https` and `mailto` links, so local-file links show as raw syntax with the full path. Most Codex answers that mention files look like this.                                                                                                                                                                                                                                                                                                                                  | `28-allowed-45s.png`                                        | W0e                                                                                 |
| 3   | Medium–High | **待处理 only grows.** 72 items when the check began (55 "待查看" back to October, 17 "失败"), 74 after one conversation. They include failures of the two offline computers ("无法访问"). Each item can be dismissed only one by one ("知道了"), so the badge stops meaning anything.                                                                                                                                                                                                                                                                                                                                                         | `01-inbox.png`                                              | W0e (Owner, 2026-11-19: "全部知道了" per tab; archived conversations' items hidden) |
| 4   | Medium      | **Settings › 关于与检查 reads "设置需要处理"** while this computer and both AI tools are ready. Most of the page repeats the two offline computers' last-known diagnostics ("远程访问", each with Codex and Claude Code rows). It also says Claude Code "此 AI 工具版本不受支持" for previous sessions, next to a Claude Code that works. W0d hid offline computers on the devices page and in the sidebar, but not here.                                                                                                                                                                                                                      | `00-as-found.png`, `17-about-grid.png`                      | W0e                                                                                 |
| 5   | Medium      | **After the runtime failure, the inspector lost its "变更" and "工具输出" tabs** and said "当前 AI 工具不报告文件差异，因此没有'变更'" for Codex. The tabs came back with the next Turn. D2.5 rewrote how the tabs are chosen, so check this after D2.5 merges.                                                                                                                                                                                                                                                                                                                                                                                | `25-later.png`, `27-followup-90s.png`                       | W0e (verify on `main` after D2.5)                                                   |
| 6   | Low–Medium  | **Dark mode keeps a light window title bar.** The app content turns dark, but the native title bar stays white.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `11-claude-conversation-dark.png`                           | W0e                                                                                 |
| 7   | Low         | **Filler rows in the sidebar.** Every expanded project without conversations shows "还没有会话" and "查看已归档会话". With 15 mostly test projects, the tree is mostly filler. D3b goal 7 removes only the second row.                                                                                                                                                                                                                                                                                                                                                                                                                         | `02-devices.png`                                            | D3b goal 7                                                                          |
| 8   | Low         | **Two words for one control.** The New Conversation dialog says "思考强度"; the Composer says "推理". The local computer is "本地电脑" in the tree and on cards, but "这台电脑" in sentences.                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `07-crop.png`, `11-claude-conversation-dark.png`            | D3a goal 4                                                                          |
| 9   | Low         | **Failure copy is generic and repeated.** Every failure reads "AI 工具未能完成本轮工作。 本轮工作可能不完整。已保存的会话历史仍可查看。", with a stray double space. Some failure cards say "请查看电脑详情中的执行状态后再继续" without a link to that page.                                                                                                                                                                                                                                                                                                                                                                                  | `01-inbox.png`, `05-conversation-codex-failed.png`          | D3b goal 9                                                                          |
| 10  | Low         | **Narrow windows cut short names first.** At 800 CSS px the breadcrumb reads "本… › v4-accep… › 只检查当前测试项目…". In the New Conversation dialog, the computer is "本…" next to a long path.                                                                                                                                                                                                                                                                                                                                                                                                                                               | `13-conversation-800css.png`, `21-created.png`              | D3b goal 8 (add the breadcrumb)                                                     |
| 11  | Low         | **An empty project's empty state** says "可以调整筛选条件" when no filter is set.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `03-project.png`                                            | D3b goal 3                                                                          |
| 12  | Low         | **"剩余上下文" shows no value.** It sits in every Composer as a label with nothing after it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `22-created-after.png`                                      | X1a (task 12); hide it until there is a value                                       |
| 13  | Low         | **"开机自动启动 — 目前还不支持"** is a permanent row in Settings › 后台运行. Starting with Windows is on the Out of Scope list, so building it needs a stage.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `15-settings-grid.png`                                      | Task 15 after alpha.5 (Owner, 2026-11-19); the row stays until then                 |
| 14  | High        | **Found by the Owner after this check: sending changes the Composer.** A panel ("Codex 正在工作 … 停止") appears under the input, the input locks, and the timeline jumps. This check saw the panel and called the feedback quick, but did not measure the layout.                                                                                                                                                                                                                                                                                                                                                                             | `owner-composer-running.png`                                | W0e goal 6; new design in 10 §3.3                                                   |
| 15  | High        | **Found by the Owner after this check: the model menu is as narrow as its button.** Codex model names wrap over three lines, and the check mark covers "Opus". This check never opened the model menu.                                                                                                                                                                                                                                                                                                                                                                                                                                         | `owner-codex-model-menu.png`, `owner-claude-model-menu.png` | W0e goal 7                                                                          |

**What this check missed, and how later checks avoid it.** Findings 14 and 15 were in plain sight. Later hands-on checks therefore also:

- open every menu, picker and popover at 1440, 1100 and 800 px, in both themes
- measure the Composer and the timeline across a send, a running Turn, an Approval and the end of the Turn, and treat any unplanned movement as a finding

## Confirmed still open on alpha.4, already in a task

- **D2.5 (merged after alpha.4 as `9932e70`; ships in alpha.5):**
  - tool rows that show the last output line
  - repeated Turn headers
  - "已完成" on a message while its Turn runs
  - the location shown three times in a conversation
  - the inspector opening on the duplicate "文件" tab
- **D3a:**
  - the advisory box in the New Conversation dialog when the tool is healthy ("执行正常 · 上次已知 … 首个明确轮次会重新验证"), on every new conversation (goal 2)
  - "状态检查" larger than its page heading (goal 3)
  - the devices page titled "电脑" under "设备" (goal 4)
  - "在线" twice on the computer card, and "返回设备" (goal 5)
- **D3b:**
  - "Codex 会话 — 2026-10-20T16:09:22.000Z" (goal 2)
  - an empty project showing every filter (goal 3)
  - "查看已归档会话" on every project (goal 7)
  - "本…" (goal 8)
  - "这里只匹配已加载的标题" (goal 9)
- **The release review:** restoring an archived conversation does not refresh the model catalog (`release-v0.1.0-alpha.4.md`). Fixed on a separate branch and accepted the same day (`restored-conversation-model-catalog.md`); it merges with D2.5.

## Recommended next steps

1. **Merge D2.5 now** (the alpha.4 tag exists), together with the separate model-catalog fix (`restored-conversation-model-catalog.md`), and ship them soon as alpha.5. It removes the most visible daily problem. Both merged the same day; `main` is at `13fa6b8`.
2. **W0e, Windows fixes after alpha.4:** findings 2, 4, 5 and 6. The release review's catalog refresh was fixed separately. The Owner approved finding 3 on 2026-11-19, so W0e includes it. Prompt: `w0e-windows-fixes-prompt.md`. Finding 4 has a Host cause too: without a project, `doctorOverallState` always returns "needs attention".
   - It is web plus one small desktop-shell change.
   - Start from `main` after D2.5, which also changes the inspector and the Markdown renderer.
   - It ships in alpha.5 with D2.5.
3. **W0f, runtime failure diagnosis (finding 1).** Prompt: `w0f-runtime-diagnostics-prompt.md`. Reading the code showed that `runtime_error` is the fallback for an error CodeTether's own code did not classify, so the failure was most likely in CodeTether, not in Codex.
   - A bounded local diagnostic log on the Host, recording why a Provider runtime or the Host itself stopped: exit code, signal, and the last lines of stderr. It never records prompts, outputs or credentials.
   - Then reproduce the failure with the scratch Turn.
   - It is a Host change and needs its own prompt.
4. **D3a and D3b** absorb findings 7 to 11 when they are dispatched.

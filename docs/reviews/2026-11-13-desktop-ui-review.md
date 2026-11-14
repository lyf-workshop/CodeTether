# Desktop UI Review: Usability and Visual Design

**Date:** 2026-11-13.

**Reviewed:**
- The web UI at `fe78b97`, which is `main` without the U1 Settings page.
- It ran in a browser against a Host with a copy of the README demo data (two local projects, two completed Codex conversations, two open Attention items).
- Screens were captured at 1440×900 and 1100×760, in light and dark themes.
- Code was checked on `main` (`4801ef1`).
- The comparison baseline is the prototype in `docs/ux-redesign/png/`.

**Not seen live:**
- running Turns, the Approval dock and failure cards
- remote computers and phones
- signed-in account pages
- the Tauri window

Those need a pass with real data before the prompts below are written.

## Verdict

| Question | Answer |
| --- | --- |
| Intuitive? | Mostly. The device › project › conversation model reads clearly in the sidebar, breadcrumbs and pages. The weak spot is the conversation itself: it does not say what the agent did (finding 1). |
| Easy to use? | For the core loop, yes: Ctrl+N, Ctrl+K, Enter to send, and an Inbox with one clear action per item. Friction comes from crowded project pages, primary actions placed at the bottom of pages, and technical status copy. |
| Visually appealing? | Calm and professional. The neutral palette, type scale and dark theme are solid. A few things make it look unfinished: disabled placeholder controls, raw timestamps, diffs in a proportional font, and ragged alignment in the AI-tool list. |
| Consistent? | The visual system is consistent: tokens are used throughout, and only 24 files use arbitrary Tailwind values, almost all of them `var()` tokens. Page structure and status wording are not consistent (findings 5–8). |

## What works

- **Shell.**
  - The sidebar tree, breadcrumb top bar and collapsible inspector are stable across screens.
  - The primary "新建会话" button is consistent.
  - Ctrl+N and Ctrl+K are discoverable from the palette.
- **Inbox.** This is the best screen:
  - filter tabs with counts
  - one primary action ("查看结果") and one secondary action ("知道了") per row
  - device and project context on every row
- **Appearance settings.** Clean, with real theme previews.
- **States.** Loading skeletons and empty states exist on every page checked. Dark mode keeps contrast and hierarchy on every screen checked.

## Findings

Severity:
- **High:** hurts the core task of supervising agent work.
- **Medium:** consistency or clear friction.
- **Low:** polish.

### High

1. **Command rows do not say what ran.**
   - **What you see.** On Windows almost every Codex step shows "执行命令". The right side shows the *last line of output*, such as "main()", "</html>" or "M README.md".
   - **Why.**
     - Compound or PowerShell-wrapped commands get no subtitle (`apps/web/src/components/conversation/tool-presentation.ts:44-46`).
     - The row's right side is `outputSummary` (`conversation-timeline.tsx:89-93`).
     - Rows are not expandable.
     - The command appears only in the "工具输出" panel, as the raw invocation including the bundled PowerShell runtime path.
   - **Fix.**
     - Show the unwrapped first command as the subtitle; `createToolCommandSubtitle` already exists (`tool-presentation.ts:104`).
     - Make rows expandable to show the command and its output.
     - Stop using the last line of output as the summary.
     - 10 §3.4 "Tool Cards" already specifies this.
2. **Diffs use a proportional font.**
   - `packages/ui/src/components/product/diff-card.tsx:83,85` sets `font-sans` on code lines, so indentation and alignment are lost. The prototype (02-16) and 10 §3.4 use monospace.
   - In dark mode, added lines get no row tint, only a green "+".
3. **The Composer on `main` shows controls that do nothing:**
   - "附件" and "语音" (disabled)
   - "模型" (disabled, tooltip "模型切换功能开发中", `composer.tsx:277-285`)
   - "剩余上下文" with no value

   "字数 N" was listed here at first, but it is a real live count and stays.

   **Disposition (revised 2026-11-14).** The Owner wants these built, not removed (AD-12):
   - "模型" becomes the real control in task 5.
   - "剩余上下文" is X1a, "附件" is X1b, and "语音" is X1c.
   - Until each lands, its placeholder stays.
4. **A healthy state is shown as a warning.**
   - The New Conversation dialog shows an amber box for a healthy Codex: "执行正常 · 上次已知。…这是最近一次观测；新会话的首个明确轮次会重新验证，不会重发任何旧请求。" (`new-conversation-provider-selection.ts:61`).
   - Amber color plus internal terms, at the moment the user starts work, reads as "something is wrong".
   - **Fix.** Show nothing for healthy or last-known-healthy. For degraded or unavailable, show one plain sentence without implementation terms (PRODUCT.md, Phase 4D).

### Medium: consistency

5. **One AI-tool state, four vocabularies.**
   - At the same moment:
     - Codex is "可用" on the computer card and the computer page, but "尚未检查" on Setup and on "关于与检查".
     - Claude Code is "版本不支持" on one screen and "需要处理" / "需要更新 CodeTether" on others.
   - There are four separate mappings:
     - `machine-summary-card.tsx:192-196`
     - `machine-providers-section.tsx:215`
     - `doctor-page.tsx:808-814`
     - `onboarding-model.ts:53-63`
   - The visual form also differs: plain text, a pill, or a chip.
   - **Fix.** Make `apps/web/src/provider/provider-presentation.ts` the only source of label and tone, and use one status component.
   - Related: Setup and Doctor copy uses internal concepts, for example "兼容的新版本，尚未完整验证 · AI 服务：上次检查：就绪".
6. **No shared page header.**
   - Each page hand-rolls its `h1`: `text-page` with `mt-5`, `mb-5` or `mb-6`, and also `text-xl` and `text-2xl`. The results:
     - The Inbox subtitle touches its title.
     - At 1440 px, content starts at x = 352 on Inbox, 356 on Devices, 396 on Settings and 496 on Add Device.
     - On "关于与检查", the subsection heading "状态检查" is larger than the page heading.
   - **Fix.** One `PageHeader` (title, description, actions) in `packages/ui`, and one content width per page type.
7. **Naming.**
   - The devices page is titled "电脑" (`machines-page.tsx:57`), while the sidebar, breadcrumb and button say "设备", and the page also lists "手机和平板".
   - The archived view's breadcrumb repeats the project: "本地电脑 › weather-cli › weather-cli".
8. **Duplicate navigation and location.**
   - Computer and project pages show both a "返回设备" link and a breadcrumb. On the project page, the back link skips the computer level.
   - The conversation view states the location three times: in the breadcrumb, in the chip row under the title, and in "weather-cli · 本地电脑" under the Composer.
   - The computer card says "在线" twice.

### Medium: usability

9. **Project paths are cut at the end** (`packages/ui/src/components/product/project-card.tsx:70`).
   - Both demo projects show the identical "D:\Projects\Software\agenthub-archive\re…", so the distinguishing folder is hidden.
   - **Fix.** Truncate in the middle or show the tail, with the full path on hover.
10. **The project page is crowded for the common case.**
    - **Filters.** For a project with one conversation, the page shows two stacked segmented controls, a search box with a separate "搜索" button, and a tool filter.
    - **Import section.** "以前的会话" stays as a large permanent section even when everything is already imported. In it:
      - the title is a raw ISO timestamp, "Codex 会话 · 2026-11-01T10:10:05.000Z", built inside the adapter (`packages/adapter-codex/src/session-discovery.ts:995`)
      - in-app "打开" uses an external-link icon
    - **Archived view.** It keeps the "运行中" and "等待批准" filters, which can never match an archived conversation.
    - **Fix.**
      - Hide the filters below a small count.
      - Collapse the import section to one line, "发现 N 个以前的会话", when nothing is new.
      - Format dates in the web layer.
11. **Primary actions are buried and activity is hidden.**
    - On a computer's page, "添加项目" and "配对新设备" sit at the bottom, below AI tools and connection details. The Projects heading has no add action.
    - The devices overview lacks the prototype's "N 件事需要你处理" banner and per-project activity (02-01). Cards show only "1 个会话" and a date, so you cannot see where work is happening without opening each card.
12. **Timeline chrome repeats.**
    - Each agent message and each tool group gets its own avatar, "Codex", "已完成" and time, so one Turn shows three identical headers.
    - Their avatars are 8 px out of alignment.
    - **Fix.** One header per Turn, with status shown once (10 §3.4 "Message Cards").
13. **The inspector tabs overlap.**
    - "文件" and "变更" list the same file, and the panel opens on "文件" although "变更" is the first tab.
    - Section titles repeat the tab name.
    - "-0" is shown as a red chip.
    - **Fix.** Merge "文件" into "变更", or default to "变更".
14. **The sidebar adds noise but not signal.**
    - Every project adds a "查看已归档会话" row.
    - The prototype's per-conversation status dots (waiting for approval, running) are missing, so the tree does not show where attention is needed.

### Low

15. Native `<details>` triangles ("会话信息", "查看详细状态", "技术详情") sit next to Lucide chevrons elsewhere.
16. The AI-tool list on the computer page is ragged: the version and status columns shift with the length of the tool name.
17. Short names are truncated before long paths ("本地…" in the New Conversation dialog).
18. Copy exposes implementation details:
    - the palette footer "这里只匹配已加载的标题"
    - the Add Project hint about offline computers, shown for the local computer

## Disposition

| Findings | Where |
| --- | --- |
| 3 | Model: task 5. Context, attachments and voice: AD-12, prompts `x1a-context-usage-prompt.md`, `x1b-image-attachments-prompt.md`, `x1c-voice-input-prompt.md` |
| 1, 2, 8 (conversation part), 12, 13 | **D2.5 Timeline** (10 §3.4), `d2-5-timeline-restyle-prompt.md`, after D2 integration, because both touch the conversation page. Map the hex colors in 10 §3.4 to tokens. |
| 4–8 (computer and project pages), 15, 16 | **D3a consistency**, `d3a-desktop-consistency-prompt.md`. Must: 4, 5, 6. |
| 9–11, 14, 17, 18 | **D3b usability**, `d3b-desktop-usability-prompt.md`, after D3a. Must: 9 and 10. Item 11's activity counts may use only real fields. |
| Not seen live | D2.5 starts by capturing running, approval and failure states with real Codex and Claude Code runs. |

The original "D3 consistency pass" was split into D3a and D3b on 2026-11-14 to keep each task under the size limit in DEVELOPMENT-PROCESS §4.

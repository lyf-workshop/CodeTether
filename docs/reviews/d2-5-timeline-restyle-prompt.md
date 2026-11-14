# Task: D2.5 Timeline Restyle

**Where it runs.** On Windows. Real Codex and Claude Code runs on this computer are needed for the before-and-after screenshots.

**Branch and worktree.** Start from the current `origin/main` after task 5 (D2 model-control integration) has been merged (fetch first). Create branch `feat/d2-5-timeline` in worktree `D:/Projects/Software/agenthub-work/feat-d2-5-timeline`.

**Why this task exists.** The conversation is the center of the product, but today it does not say what the agent did. Command rows show the last line of output instead of the command, diffs lose their indentation, and every Turn repeats its header three times. 10 §3.4 already designs the fix; the desktop UI review confirmed the problems on the running app.

**References** (read with `git show origin/ux/design:<path>`):

- `docs/reviews/2026-11-13-desktop-ui-review.md`, findings 1, 2, 8 (the conversation part), 12 and 13
- `docs/ux-redesign/10-desktop-improvements.md` §3.4 (Timeline Restyling) and §1 I2 (panel titles: "File Changes" for Codex, "Viewed Files" for Claude)
- `docs/ux-redesign/02-dev-handoff.md` and the prototype pages in `docs/ux-redesign/png/` for the conversation (02-16 shows the diff)
- `docs/ux-redesign/03-project-plan.md` §6 (invariants)
- `docs/FROZEN-BOUNDARIES.md` (tool grouping, safe Markdown, path shortening)

Before starting, confirm this file has 4 second-level headings and that the last one is "Report".

## Goals

**Must:**

1. **Baseline first.**
   - Before changing anything, capture the current conversation with real data in light and dark themes at 1440 and 1100 px wide:
     - a running local Codex Turn
     - the Approval dock
     - a failed Turn
     - a completed Turn with several commands and a diff
     - a Claude Code conversation that reads and searches files
   - The UI review could not see these states, so this is the first look at them. If a problem there is as serious as the findings below, fix it in this task if it is in the timeline, and report it either way.
2. **Command and tool rows say what ran** (finding 1, 10 §3.4 "Tool Cards").
   - **Collapsed row:** the type icon, the kind ("执行命令", "读取", "编辑", "搜索") and a one-line subject:
     - for a command, the command itself with the PowerShell wrapper removed; for a compound command, its first command plus "等 N 条" or an equivalent
     - for a read, the path
     - for an edit, the path and the changed-line count
     - for a search, the query, plus the result count when the event carries one
   - **Right side:** status, and duration or exit code when they are real fields. Never the last line of output.
   - **Expanding:** every row expands with the mouse and the keyboard and shows the full unwrapped command and its bounded output. A failed row starts expanded and shows the error.
   - **Colors:** type colors come from tokens (see goal 7), never hex.
   - **Grouping:** keep the frozen rule (FROZEN-BOUNDARIES): runs of at least three adjacent routine completed tools collapse into a group, while failed, active, test, Approval-linked and diff-producing work stays visible.
     - A group of one kind is titled like "读取 3 个文件"; a mixed group keeps "已完成 N 个操作".
     - Expanding a group shows every original row.
3. **Diffs use a monospace font** (finding 2).
   - Diff code lines use the monospace font.
   - Added and removed lines get a row tint in both themes, using tokens.
   - Indentation and alignment survive horizontal scrolling.
4. **One header per Turn** (finding 12, 10 §3.4 "Message Cards").
   - One Turn shows the Provider avatar, name, status and time once. Its later agent messages and tool groups follow without repeating that header.
   - Avatars and text columns line up on one grid; today they differ by 8 px.
5. **Message and code-block styling** (10 §3.4).
   - **Message cards:** User and agent messages, and system cards (approval, failure, running) styled as specified.
   - **Width:** the reading width grows from 740 to 800 px.
   - **Fenced code in agent messages** uses the shared `CodeBlock` from `packages/ui` with:
     - a language label
     - Copy on hover and on keyboard focus
     - line numbers
     - syntax highlighting for the ten languages listed in §3.4
     - no wrapping
     - blocks over 30 lines collapsed to the first 10 and last 5 lines, with "展开 N 行"
   - Remembering the expanded state in `localStorage` is a Should.
6. **The inspector stops repeating itself** (finding 13).
   - For a Provider that reports diffs, there is one "变更" tab listing changed files, and selecting a file opens its diff. The separate "文件" tab, which lists the same files, goes away.
   - For a Provider without diffs (Claude Code), the file tab is "已查看文件". It lists paths from that conversation's read and search tool events, when the projection has them. Otherwise the tab is absent; do not show an empty explanation tab in its place.
   - The panel opens on its first tab that has content.
   - Section titles do not repeat the tab name.
   - A zero count is not shown as a colored chip ("-0", "+0").
7. **Tokens, not hex.**
   - 10 §3.4 gives hex colors. Map each one to an existing token in `packages/ui`, or add a named token for both themes. No hex or arbitrary color values in components.
   - The visual result must match the intent of §3.4 in both themes.
8. **The conversation location is shown once** (finding 8, conversation part).
   - The breadcrumb already says device › project. The chip row under the title and the "weather-cli · 本地电脑" line under the Composer repeat it.
   - Keep the breadcrumb, and keep one compact context line in the title area for Provider, model and reasoning effort (04 W2). Remove the other repetition.
9. **Quality gate:**
   - `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`
   - `pnpm format:check` for changed files
   - new or updated tests for:
     - command subtitle extraction (wrapped, compound and plain commands)
     - row expansion and auto-expanded failures
     - the grouping rules
     - the one-header-per-Turn projection
     - the inspector tab selection
     - code-block collapse

**Should:**

10. **Scrolling** (10 §3.4 "Scrolling and Navigation").
    - "跳到最新" and `?turn=` focus already exist. Add only what is missing:
      - the two-second highlight on the focused Turn
      - the sticky, translucent title bar
    - Respect reduced motion.
11. **Bundle size.** Load the highlighter's languages lazily so the conversation chunk does not grow by more than about 60 kB gzip. Report the before and after sizes.

## Known facts

Line numbers refer to `4801ef1`; task 5 will have moved some of them.

- **Command subtitles.**
  - `apps/web/src/components/conversation/tool-presentation.ts:39-48`: a command with compound syntax is titled "执行命令" and gets no subtitle. Most Codex commands on Windows are PowerShell-wrapped, and many are compound, so nearly every row reads "执行命令".
  - `createToolCommandSubtitle` (`tool-presentation.ts:104-107`) already strips the PowerShell wrapper but is not used for these rows.
- **Row metadata.**
  - `conversation-timeline.tsx:89-93` passes `tool.outputSummary` as the row's right-side metadata. That is why rows show "main()", "</html>" or "M README.md".
  - `conversation-timeline.tsx:96-103` renders an action button when `tool.actionLabel` is set, but the button has no handler, and nothing ever sets `actionLabel` (`conversation-view-model.ts:37` only declares it). Remove it, or wire it to the expansion.
- **The command today** is visible only in the "工具输出" inspector panel, as the raw invocation including the bundled PowerShell runtime path.
- **Diffs.** `packages/ui/src/components/product/diff-card.tsx:70,83,85` sets `font-sans` on the path and code lines. In dark mode, added lines get only a green "+" and no tint.
- **Code blocks.**
  - `message-markdown.tsx:84-93` renders fenced code as a plain `<pre>`, with no language, Copy, line numbers or highlighting.
  - `packages/ui/src/components/product/code-block.tsx` (`CodeBlock`, with line numbers and a `language` prop) and `command-block.tsx` already exist. The Markdown renderer does not use them.
  - `apps/web/package.json` has no highlighter dependency. 10 §3.4 names Prism.js or highlight.js.
  - The build already has two chunks of about 600 kB.
- **Markdown is a frozen safety boundary:** no raw HTML, no image loading, no `dangerouslySetInnerHTML`. A highlighter that returns HTML strings would break it. Choose one that produces tokens React can render, or render its output without injecting HTML.
- **Reading width:** `--read-w: 740px` (`packages/ui/src/styles/globals.css:137`).
- **Inspector.**
  - `inspector-panel.tsx:352` defaults to `'files'`, although "变更" is the first tab (`:395-410`).
  - The "文件" tab renders `conversation-files-surface.tsx`, which lists the same `changes.files` that "变更" shows.
  - For Claude Code (no diff), "文件" shows "当前 AI 工具未提供文件变更信息".
- **Repeated headers.** On a completed Turn, each agent message and each tool group renders its own avatar, "Codex", "已完成" and time. Screenshot `05-conversation` in the review shows three identical headers in one Turn.
- **Repeated location.** The breadcrumb, the chip row in `conversation-header.tsx` (around `:35` and `:81`), and the context line under the Composer each state device and project.
- **Demo data.** The README demo data gives two completed Codex conversations only. Running, approval and failure states need real runs. Use a scratch project, never the CodeTether repo itself, for Turns that edit files.
- **The Composer** belongs to task 5 and the X1 tasks; this task does not change it, except for removing the repeated location line under it.

## Boundaries

- **Decide yourself:**
  - component structure, and whether new shared parts go to `packages/ui`
  - the highlighter, pinned to an exact version and lazily loaded
  - token names and values
  - how the first command of a compound command is chosen
  - Chinese copy within the product's existing tone
  - test changes and commit splitting
- **Ask the Owner first:**
  - changing which kinds of work the grouping rule keeps visible
  - any Host, Protocol or adapter change; this task is web and `packages/ui` only
  - a layout that departs from 10 §3.4 or the prototype beyond what this prompt states
  - replacing the installed desktop app
- **Do not:**
  - change the Composer's controls
  - edit `AGENTS.md` or `docs/`
  - push `main`, merge or tag
  - read or print credentials

Push `feat/d2-5-timeline` to `origin`.

## Report

Write to `D:/Projects/Software/agenthub-archive/d2-5-timeline-report.md`, with screenshots in `D:/Projects/Software/agenthub-archive/d2-5-timeline/`:

- **Baseline:** the before screenshots, and anything found in the states the review had not seen.
- **Changes:** per goal, what changed and the main files.
- **After:** the same screens as the baseline, in light and dark themes, at 1440 and 1100 px wide.
- **Tokens:** each hex value from 10 §3.4 and the token it became.
- **Bundle:** chunk sizes before and after.
- **Gates:** results for each check, with failures quoted verbatim.
- **Commits:** your commits and the pushed remote commit.
- **Status:** anything not done and why, and the completion level reached.

# Task: D3b Desktop Usability (Project Page, Computer Page, Sidebar)

**Where it runs.** On Windows or the Mac, whichever is free. This is web-only work, except for the small adapter change in goal 2.

**Branch and worktree.** Start from the current `origin/main` after D3a (`feat/d3a-desktop-consistency`) has been merged (fetch first); this task builds on D3a's `PageHeader` and status vocabulary. Create branch `feat/d3b-desktop-usability` in worktree `<agenthub-work>/feat-d3b-desktop-usability`. That is `D:/Projects/Software/agenthub-work/` on Windows and `~/agenthub-work/` on the Mac.

**Why this task exists.** The core loop works, but the pages around it make the user work harder than they should:

- Two projects look identical because their paths are cut at the end.
- The project page shows filters and an import section that rarely apply.
- The main actions on a computer's page sit at the bottom.
- Nothing outside the Inbox shows where work is happening.

**References** (read with `git show origin/ux/design:<path>`):

- `docs/reviews/2026-11-13-desktop-ui-review.md`, findings 9, 10, 11, 14, 17 and 18
- the prototype pages in `docs/ux-redesign/png/`: `02-01-devices` (attention banner, per-project activity), `02-02-device-local`, `02-04-project-detail`, `02-05-project-previous`, `02-06-project-archived`, `02-07-project-search`, `02-08-add-project`, `02-14-new-session-project`
- `docs/ux-redesign/02-dev-handoff.md`, row D1 (which reads the sidebar and devices pages may use, and the limit of 100 conversations)
- `docs/ux-redesign/03-project-plan.md` §6 (invariants)

Before starting, confirm this file has 4 second-level headings and that the last one is "Report".

## Goals

**Must:**

1. **Paths that tell projects apart** (finding 9).
   - Long paths keep their distinguishing tail. Truncate in the middle, for example "D:\Projects\…\weather-cli", or show the tail. The full path is available on hover and to screen readers.
   - Apply this to:
     - the project card (`packages/ui/src/components/product/project-card.tsx:70`)
     - the project page header
     - the New Conversation dialog
     - the computer page's project list
   - One shared helper or primitive does it, not one copy per surface.
2. **No raw timestamps** (finding 10).
   - Imported Codex sessions without a native title are named "Codex 会话 · 2026-11-01T10:10:05.000Z" (`packages/adapter-codex/src/session-discovery.ts:990-995`).
   - The user sees the date formatted in the web layer, in local time, for example "Codex 会话 · 11月1日 18:10".
   - Decide where the fallback title is composed, with one constraint: the adapter stops putting an ISO string into a title. Already adopted conversations whose durable title holds the ISO form are displayed formatted, without rewriting their stored titles.
   - No other user-visible surface shows an ISO timestamp. Check every place that renders a date, and report each one.
3. **A calmer project page** (finding 10).
   - **Filters:**
     - The search box submits as you type. The 250 ms debounce already exists, so the separate "搜索" button goes.
     - Until a project has more than 5 conversations in the current view, the segmented filters and the tool filter are hidden. Search remains available whenever there is at least one conversation.
     - The two stacked segmented controls become one row.
   - **"以前的会话"** (native sessions not yet imported):
     - When nothing new is waiting to import, it collapses to one line, "发现 N 个以前的会话", which expands on demand.
     - When something new is waiting, it shows as today, but below the conversation list.
     - In-app "打开" uses an in-app icon, not the external-link icon.
   - **Archived view:** its status filters exclude "运行中" and "等待批准", which can never match an archived conversation.
4. **Primary actions where the eye starts** (finding 11).
   - On a computer's page, "添加项目" sits in the Projects section header, and "配对新设备" in the page header actions (D3a `PageHeader`). Neither stays at the bottom of the page.
   - On the devices overview, when open Attention exists, a banner reads "N 件事需要你处理" and links to the Inbox (02-01). It uses the Attention summary the sidebar badge already reads; there is no new request.
5. **Quality gate:**
   - `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`
   - `pnpm format:check` for changed files
   - tests for:
     - path truncation (Windows and POSIX paths, a short path, a path whose tail alone is too long)
     - fallback-title formatting
     - the filter-visibility threshold
     - the collapsed import section
     - the archived filter set
     - the attention banner
   - if the adapter test in `packages/adapter-codex` covers the fallback title, update it

**Should:**

6. **Activity where work happens** (findings 11 and 14).
   - Devices-overview project cards show running and waiting-for-approval counts instead of only "1 个会话" and a date.
   - The sidebar tree shows a status dot on each conversation that is running or waiting for approval (02-01).
   - Use only fields the existing reads already return. If a count would need one extra request per project, or more than the 100-conversation index provides, leave that count out and report it. Do not add a Host endpoint.
7. **A quieter sidebar** (finding 14). Remove the per-project "查看已归档会话" row; the project page's archived view is the way in. Keep a link to it on the project page next to the conversation list.
8. **Short names stay visible** (finding 17). In the New Conversation dialog and elsewhere, a short name such as the computer name is not truncated ("本地…") while a long path beside it keeps its full width. The path gives way first.
9. **No implementation detail in copy** (finding 18).
   - The command palette footer "这里只匹配已加载的标题" becomes user language, or goes.
   - The Add Project hint about offline computers appears only when the selected computer is a paired remote computer that can be offline, not for this computer.

## Known facts

Line numbers refer to `4801ef1`.

- **Path truncation.** `project-card.tsx:70` truncates at the end with CSS. Both demo projects then show the identical "D:\Projects\Software\agenthub-archive\re…". Display-only path shortening of Project-contained paths is a frozen behavior (FROZEN-BOUNDARIES, Phase 4D): never change the stored canonical path.
- **Fallback title.**
  - `session-discovery.ts:990-995` (`boundedTitle`): when the native session has no title, the adapter returns `Codex 会话 · ${timestampToIso(createdAt)}`.
  - Discovery and adoption are a frozen Phase 8A boundary: no auto-import, and adoption keeps native identity. Changing only how a missing title is presented is within it.
- **Project page.**
  - Today a project with one conversation shows:
    - two stacked segmented controls (active or archived; status)
    - a search box with a separate "搜索" button
    - a tool filter
  - Search is the Phase 4F.2 durable search: a 250 ms debounce, aborts stale requests, Load More in pages of 25. Keep that behavior.
- **"以前的会话"** stays a large permanent section even when everything is already imported. Its in-app "打开" uses Lucide's external-link icon.
- **Sidebar.**
  - `apps/web/src/components/app-shell/workspace-project-section.tsx:194` renders "查看已归档会话" under every expanded project.
  - The sidebar fetches only expanded projects (02 handoff, D1).
  - The conversation index returns a public `ConversationSummary` that includes execution status.
- **Attention summary.** The Attention summary (`totalOpen` and per-type counts) is already read for the sidebar Inbox badge.
- **Computer page.** "添加项目" and "配对新设备" are at the bottom, below the AI tools and the connection details. The Projects heading has no action.
- **Demo data.** The README demo data gives two local projects, one conversation each, all completed, and two open Attention items. To check counts and dots, create running and waiting states with a real local Codex run in a scratch project.
- **The review's screenshots** are in `C:\Users\Administrator\AppData\Local\Temp\claude\f1eed4d30b5bb503\60ba83ab-1cea-4a54-a949-667ddf3e701e\scratchpad\ui-review\shots\` on the Windows PC (02-devices, 03-device-local, 04-project, 09b-new-conversation-project, 19-archived, 31-add-project). That folder is temporary; capture your own baseline.

## Boundaries

- **Decide yourself:**
  - truncation technique and helper shape
  - where the fallback title is composed, within goal 2's constraint
  - the exact layout of the filter row and the collapsed import line
  - Chinese copy within the product's tone
  - test changes and commit splitting
- **Ask the Owner first:**
  - a new Host or Protocol field or endpoint
  - rewriting any stored title
  - changing search, import or adoption behavior beyond presentation
  - a layout that departs from the prototype pages listed above
- **Do not:**
  - change the conversation page (D2.5) or the Composer (X1 tasks)
  - edit `AGENTS.md` or `docs/`
  - push `main`, merge or tag
  - read or print credentials

Push `feat/d3b-desktop-usability` to `origin`.

## Report

Write to `<agenthub-archive>/d3b-desktop-usability-report.md` (`D:/Projects/Software/agenthub-archive/` on Windows, `~/agenthub-archive/` on the Mac), with screenshots in a `d3b-desktop-usability/` folder next to it:

- **Changes:** per goal, what changed and the main files.
- **Dates:** every place that renders a date or time, and its format now.
- **Counts:** which activity counts and dots you showed, from which fields, and any left out because they would need a new request.
- **Screenshots:** before and after for Devices (with Attention open), computer detail, project (one conversation and more than five), archived view, sidebar with a running conversation, and the New Conversation dialog, in the light theme, plus dark for Devices.
- **Gates:** results for each check, with failures quoted verbatim.
- **Commits:** your commits and the pushed remote commit.
- **Status:** anything not done and why, and the completion level reached.

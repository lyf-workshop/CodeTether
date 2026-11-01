# README 改版提示词（中英双语，英文为主）

给 Windows 上的 Codex 智能体。审核方：Claude Code。

## 背景

GitHub 主页 https://github.com/lyf-workshop/CodeTether 的 README 还是 Phase 8C/8D 时期的内部开发记录：标题叫 “CodeTether V2”，大段 Phase 编号、验收状态和 “Historical Alpha” 能力清单，开发命令占了一半篇幅，没有截图，没有许可证。产品已经是 v4：账号 › 设备 › 项目 › 会话。这一轮把 README 改成给外部访问者看的产品主页，并加上许可证。

`docs/ux-redesign/` 是当前设计的临时依据，覆盖 AGENTS.md 里 “Figma 是唯一来源” 的规定，这一轮只改文档，不改界面。

## 范围

只新增或修改下面这些文件，别的已跟踪文件一律不动：

- `README.md`：英文，主版本
- `README.zh-CN.md`：简体中文，内容和英文版一一对应
- `LICENSE`：许可证全文
- `docs/DEVELOPMENT.md`：开发和构建说明（从旧 README 移过来并核实）
- `docs/assets/readme/` 下的截图
- `package.json` 里加一行 `"license": "SEE LICENSE IN LICENSE"`，只改这一行

不发 GitHub Release，不打 tag，不改 GitHub 仓库设置。

## 第一部分：准备

1. 在 `D:/Projects/Software/agenthub` 运行 `git fetch origin`，从 `origin/main`（应为 `835489d`）新建分支 `docs/readme-v4`。用 `git worktree add D:/Projects/Software/agenthub-docs-readme -b docs/readme-v4 origin/main` 建一个单独的工作区，在里面做。不要切换主工作区的分支。`origin/main` 不是 `835489d` 就停下报告。
2. 写之前先读这些文件，README 里的每一条产品说法都要能在这些文件或 `main` 的代码里找到依据：
   - `D:/Projects/Software/agenthub/docs/ux-redesign/01-feature-inventory-and-mapping.md`（ux/design 分支上的工作区，只读）
   - `D:/Projects/Software/agenthub/docs/ux-redesign/03-project-plan.md`（只读）
   - 新工作区里的 `docs/ARCHITECTURE.md`、`docs/ROADMAP.md`、`package.json`、`apps/node` 的发布目标
3. 找不到依据的功能不写。拿不准的写进报告的“待确认”，不要猜。

## 第二部分：许可证

用 **FSL-1.1-ALv2**（Functional Source License 1.1，两年后转为 Apache 2.0）。

1. 从 https://raw.githubusercontent.com/getsentry/fsl.software/refs/heads/main/FSL-1.1-ALv2.template.md 取模板原文，存为 `LICENSE`。
2. 只替换两个占位符：`${year}` 填 `2026`，`${licensor name}` 填 `lyf-workshop`。其余文字一个字都不改，不翻译。
3. 拿不到模板原文（网络失败、429、524）：每次失败记下状态码和时间；有 `Retry-After` 就按它等，最多重试 3 次，还失败就停下报告，不要凭记忆写许可证全文。
4. README 里的 License 一节写：源码可见，可以阅读、修改、内部使用、非商业教育和研究使用；不允许拿去做和 CodeTether 竞争的商业产品或服务；每个版本发布满两年后转为 Apache 2.0。链接到 `LICENSE` 和 https://fsl.software/ 。不要写 “open source” 或 “开源”，FSL 不是 OSI 认可的开源许可证，写 “source-available” 或 “源码可见”。

## 第三部分：截图

1. 从下面两张开始，复制到 `docs/assets/readme/`，改名：
   - `D:/Projects/Software/agenthub-ux-v4-device-first/output/playwright/v4-installed-inspection/18-final-devices-light.png` → `devices-light.png`
   - `D:/Projects/Software/agenthub-ux-v4-device-first/output/playwright/v4-installed-acceptance-r7/01-codex-selected-01621.png` → `conversation-codex.png`
2. 可以再从 `v4-installed-inspection/` 里挑一到两张深色主题的（比如 `12-new-conversation-1100-dark.png` 或 `04-settings-dark.png`），总数不超过 4 张。
3. 放进去之前逐张打开检查，不能出现：邮箱、账号 ID、令牌或密钥片段、配对码、IP 地址、带 Windows 用户名的路径（如 `C:\Users\<名字>`）、机器主机名。有就换一张，不要自己打码或编辑图片。
4. 每张图不超过 500 KB。超过就换一张，不要压缩改图。
5. README 里写一句截图来自 Windows 上的 alpha 安装版，界面目前只有简体中文。

## 第四部分：README 结构

`README.md` 和 `README.zh-CN.md` 第一行下面放语言切换：`English | [简体中文](README.zh-CN.md)`，中文版反过来。

两个版本用同样的结构：

1. 标题 `CodeTether`（去掉 “V2”）和一句话说明：在一个地方查看和控制多台电脑上的 Codex 和 Claude Code 会话。
2. 状态提示：早期 alpha，目前没有发布安装包，需要从源码构建；界面目前只有简体中文。
3. 一张主截图（`devices-light.png`）。
4. 它能做什么：按 账号 › 设备 › 项目 › 会话 组织，每条只写已经实现的。参考依据：
   - 设备：这台电脑，加上用 CodeTether Node 配对的设备（Linux x64 / arm64、macOS arm64）；Windows 电脑目前只能作为“这台电脑”。
   - 项目：设备上的一个文件夹；添加时自动找出这个文件夹里以前的 Codex / Claude Code 会话，可以导入继续。
   - 会话：新建、发送、置顶、重命名、归档、项目内搜索。
   - 这台电脑上的 Codex：停止、批准 “允许一次 / 拒绝”、查看文件变更。Claude Code 会话没有停止和批准，写清楚。
   - 待处理：需要批准、已完成、失败三类；桌面系统通知。
   - 浅色 / 深色 / 跟随系统主题，Ctrl K（mac ⌘K）命令面板。
5. 第二张截图（会话页）。
6. 支持的平台：一个表格，列出桌面应用和 Node 各自支持的系统和当前状态。macOS 桌面版写 “从源码构建，验收中”，不要写成已正式支持。
7. 还没有的功能：手机和平板应用、同一账号下其他电脑作为设备、Windows 作为配对设备、一键更新、安装包发布。只列 `03-project-plan.md` 或 01 文档 “后续规划” 里有的，不写时间。
8. 从源码构建：只写最短路径（前置条件 + 两三条命令），详细的链到 `docs/DEVELOPMENT.md`。
9. 隐私和安全：Host 只监听 127.0.0.1；跨设备连接用配对；能写的只写代码里确实有的，链到 `docs/ARCHITECTURE.md`。
10. 许可证（见第二部分）。

不要写的：Phase 编号、验收轮次、提交哈希、内部分支名、“frozen”“accepted” 这类内部状态、“智能体”这个词（中文版用 “AI 工具” 或直接写 Codex / Claude Code）、官网链接（官网内容还没更新，先不放）、星标徽章或下载徽章、任何没实现的功能写成已有。

英文版是主版本，先写英文，再写中文。中文版不是逐句直译，用自然的中文，但每一节的事实必须一样。中文版不用感叹号，少用破折号。

## 第五部分：docs/DEVELOPMENT.md

1. 把旧 README 里的前置条件、命令列表、本地数据目录、`CODETETHER_DATA_DIR`、Host 的本地安全说明移到这里。
2. 每条命令都对照新工作区的 `package.json` 核实，`package.json` 里没有的命令删掉，有但旧 README 没写的不用补。
3. Node 版本按 `package.json` 的 `engines` 写；桌面 sidecar 构建要求 Node 25.5 以上，这一条保留。
4. 写明桌面构建需要四个 `VITE_*` 环境变量（`VITE_CODETETHER_CONTROL_PLANE_URL`、`VITE_CODETETHER_HOST_URL`、`VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`），只写名字和用途，不写任何值，不读 `.env` 或 `.secrets/` 去找值。用途在代码里查不清楚的，写进“待确认”。
5. 旧 README 里 Phase 2 到 4 的 “Historical” 内容、API 端点清单和限制清单不搬，git 历史里留着。

## 第六部分：检查和提交

1. `pnpm format:check`。只有你改的文件格式不对才修，别的文件报错不管，写进报告。
2. 检查 README 里的相对链接和图片路径都指向存在的文件。
3. `grep -rn "chars omitted" README.md README.zh-CN.md docs/DEVELOPMENT.md LICENSE` 没有输出。
4. `git status --porcelain` 只有范围内的文件。有别的已跟踪文件显示修改时，先 `git show :<文件> | cmp - <文件>`：逐字节相同的用 `git checkout --` 恢复；不同的就停下报告。
5. 一个提交，信息：`docs: rewrite README for v4, add zh-CN and FSL-1.1-ALv2 license`，末尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
6. 推送 `docs/readme-v4` 到 origin（不 force）。推送遇到 TLS 或连接重置可以重试，最多 3 次，每次记录，还失败就停下报告。
7. **不要合并到 main，不要推送 main，不开 PR。** 合并由审核方和用户决定。

## 不要做的事

- 不读 `.secrets/`、任何 `.env`、凭据文件、`~/.claude.json`、`~/.codex/auth.json`。
- 不动主工作区 `D:/Projects/Software/agenthub` 里未跟踪的文件。
- 不运行安装程序，不启动或退出 CodeTether，不碰 VPS。
- 不删除 worktree。

## 报告

写到 `D:/Projects/Software/agenthub-archive/readme-v4-report.md`：

- 分支和提交哈希、推送结果；
- 每个文件改了什么，一两句话；
- 用了哪几张截图，每张的检查结果（有没有敏感信息、大小）；
- LICENSE 的来源 URL 和取到的时间，替换了哪两个占位符；
- `format:check` 结果；
- “待确认”：找不到依据而没写的功能、拿不准的说法、`VITE_*` 用途不清的地方。

# README 改版第 2 轮提示词

给做 README 的 Codex 智能体。审核方：Claude Code。接着第 1 轮（`docs/readme-v4` 的 `6765d41`）做，第 1 轮提示词 `docs/reviews/readme-rewrite-prompt.md` 里的范围、不要做的事和提交规则继续有效。

## 审核结论

- LICENSE 已核对：和官方 FSL-1.1-ALv2 模板只差两个占位符，通过。
- 文字准确，没有 Phase 编号和内部状态，中英两版事实一致，通过。
- 不通过的是截图。两张都是测试环境：有“无法访问”“离线”“失败”标记、测试用的项目名和会话名、macOS 用户名路径；第二张是设备详情，文件名却叫 `conversation-codex.png`。这一轮用干净的演示数据重拍。
- 两处文字小改，见第一部分。

这一轮分两步。第一部分现在做；第二部分要等用户告诉你 R12 测试结束、CodeTether 已从托盘退出后再做。

## 第一部分：文字（现在做）

在 `D:/Projects/Software/agenthub-docs-readme` 里改，中英两版同步：

1. 构建配置的说法改成“三项必填，一项可选”：`VITE_CODETETHER_CONTROL_PLANE_URL`、`VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY` 必填，桌面构建会校验；`VITE_CODETETHER_HOST_URL` 可选，有本机默认值。README 的 “Configure the four `VITE_*` build settings” 和 DEVELOPMENT.md 的 “Configure these four” 都要改。
2. README 的 “Build from source” 加一句：桌面构建目前需要一个账号服务（上面三项），自建账号服务的说明还没有。中文版对应写。不要写任何地址或密钥的值。
3. 截图说明那句去掉重复的 “interface is currently Simplified Chinese only”（第 7 行的状态提示已经写了）。具体说明等第二部分拍完再按实际来源写。

改完先不提交，等第二部分一起提交。

## 第二部分：重拍截图（等用户通知再做）

前提：用户回复 “R12 已结束，CodeTether 已退出”。没有这句不要开始，因为 4317 端口和单实例都被正在测试的安装版占着。

1. 用浏览器模式和一份单独的数据，不碰用户的正式数据：
   - 演示数据目录：`D:/Projects/Software/agenthub-archive/readme-demo/data`
   - 演示项目文件夹放在 `D:/Projects/Software/agenthub-archive/readme-demo/projects/` 下，建两个：`weather-cli`（一个小的 Python 命令行程序，有 `README.md` 和 `weather.py`）和 `notes-web`（一个只有 `index.html` 和 `style.css` 的静态页）。内容自己写，几十行就够，不要拷贝真实项目。
   - 在同一个终端里设置 `CODETETHER_DATA_DIR`，然后 `pnpm host:serve -- --workspace D:/Projects/Software/agenthub-archive/readme-demo/projects` 和 `pnpm dev`。
   - 启动前确认 4317 没有被占用，被占用就停下报告，不要结束占用它的进程。
2. 在界面里：
   - 完成首次设置，添加这两个项目；
   - 在 `weather-cli` 里新建一个 Codex 会话，发一句会改文件的话，比如“给 README 加一节使用说明，写清楚怎么运行 weather.py”。需要批准时选“允许一次”。等它完成，变更面板里能看到逐行差异；
   - 在 `notes-web` 里再建一个会话，随便问一句，让它完成，让设备页和侧栏看起来不是空的。
3. 用 Playwright 截图，视口 1440×900，`deviceScaleFactor` 1.5：
   - `devices-light.png`：浅色主题的设备页；
   - `conversation-codex.png`：`weather-cli` 的 Codex 会话，打开右侧变更面板，深色主题；
   - 可选第三张 `attention-light.png`：待处理页，里面最好有一条“已完成”。
4. 截图检查和第 1 轮一样：不能有邮箱、账号 ID、令牌、配对码、IP、主机名、带任何系统用户名的路径（Windows 和 macOS 都算）。路径里只能出现 `D:\Projects\Software\agenthub-archive\readme-demo\...`。每张不超过 500 KB。不合格就重拍，不要编辑图片。
5. 覆盖 `docs/assets/readme/` 里的同名文件，删掉不再用的图。README 的图片说明按实际写：截图来自浏览器模式下的开发版本，用的是演示项目。
6. 结束时停掉你启动的 `host:serve` 和 `pnpm dev`，只停你自己启动的进程。演示数据目录留着，不删。
7. 不登录账号，不配对设备。设备页只有“这台电脑”是预期的。

## 检查和提交

1. 第 1 轮第六部分的第 1 到 4 条照做（`format:check`、链接和图片路径、`chars omitted`、`git status` 只有范围内的文件）。
2. 一个新提交，不要 amend：`docs: retake README screenshots with demo data`，末尾 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
3. 推送 `docs/readme-v4`，不 force。不合并 main，不开 PR。

## 报告

追加到 `D:/Projects/Software/agenthub-archive/readme-v4-report.md`，新开一节“第 2 轮”：

- 第一部分改了哪几句；
- 演示项目和会话是怎么建的，Codex 会话发了什么、有没有批准；
- 每张图的检查结果和大小；
- 提交哈希和推送结果；
- 遇到的问题和没做到的地方。

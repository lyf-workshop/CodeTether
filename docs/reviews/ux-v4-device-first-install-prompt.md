# 任务：把 Windows 上已安装的 CodeTether 换成 ux/v4-device-first（b1e1ccf）的安装版

用户已明确同意删除当前安装的版本，改装这个分支打出的新版本。原话：“已安装的版本可以帮我删除，安装新版本，因为本身我现在还没有使用这个做开发”。只动这台 Windows 电脑，Mac 不动。

这次装的是还没合并、没打标签的提交，和 DEVELOPMENT-PROCESS 里“安装版来自 main 的标签”不一致。这是用户这次给的授权，照做，并在报告里写明。界面以 docs/ux-redesign 原型为准，这是用户的临时授权，优先于 AGENTS.md 里“Figma 是唯一来源”的规定。本任务不改代码。

## 现状

- 工作区是 `D:/Projects/Software/agenthub-ux-v4-device-first`，分支 `ux/v4-device-first`。HEAD 必须是 `b1e1ccf123c7adb8344720633e7726d5312e2030`，工作树必须干净，否则停下报告。
- 已安装的版本：
  - CodeTether 0.1.0-alpha.0，来自 main bbcda69。
  - 装在 `C:\Users\Administrator\AppData\Local\CodeTether`。这个目录同时也是数据目录，里面有 codetether.sqlite3、logs、machine-credentials 等。
  - WebView 数据在 `C:\Users\Administrator\AppData\Local\com.codetether.desktop`。
- 备份已经做好，在 `D:/Projects/Software/agenthub-archive/windows-install-backup-20261020-pre-v4`。里面有两个目录的完整副本、旧安装包和它的 SHA256，以及 RESTORE.txt。RESTORE.txt 里记了文件数和字节数。这份备份不要改动，也不要删除。
- 上次的 `pnpm desktop:build` 在网页构建前的检查就失败了，缺三项配置：VITE_SUPABASE_URL、VITE_SUPABASE_PUBLISHABLE_KEY、VITE_CODETETHER_CONTROL_PLANE_URL。Host 本身已经能打出来，buildId 是 `git-b1e1ccf123c7`。
- 用静默方式卸载（/S）只删程序文件。Tauri 的卸载脚本只在勾选“删除应用数据”时才删 `com.codetether.desktop`，安装目录里的数据库和凭据也会留下。新版本会接着用这些数据。

## 步骤

1. 按上面的要求检查工作区和 HEAD。
2. 拿到三项账号配置。
   - 它们是公开的应用配置（见 apps/web/README.md），但只能由用户提供。请用户给出当前已安装版本用的那一组值，或者请用户自己用 `!` 运行第 3 步的命令，跑完从第 4 步继续。
   - 不要去任何文件、注册表、环境变量存储或旧程序里找这些值。
   - 格式见 `apps/web/scripts/check-desktop-account-config.mjs`：
     - 两个地址只写到域名和端口；
     - 控制服务地址可以是 https，也可以是 http 的 localhost 或 127.0.0.1；
     - key 以 `sb_publishable_` 开头。
   - 必须作为环境变量传入。桌面程序在编译时用 `option_env!` 写入控制服务地址（host_supervisor.rs:267），放在 .env 文件里不够。也不要写任何 .env 文件。
3. 打包。耗时可能超过 10 分钟，放到后台跑，等完成通知。
   ```bash
   cd D:/Projects/Software/agenthub-ux-v4-device-first && export VITE_SUPABASE_URL='…' VITE_SUPABASE_PUBLISHABLE_KEY='…' VITE_CODETETHER_CONTROL_PLANE_URL='…' && env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_MODEL pnpm desktop:build 2>&1 | sed -E 's/sk-[A-Za-z0-9_-]+/sk-REDACTED/g' > D:/Projects/Software/agenthub-archive/v4-desktop-build-20261020.log; echo "exit ${PIPESTATUS[0]}"
   ```
   - 成功的标志：退出码为 0，并且 `apps/desktop/src-tauri/target/release/bundle/nsis/CodeTether_0.1.0-alpha.0_x64-setup.exe` 是刚生成的。记下它的大小、修改时间和 SHA256。
   - 再看一下 `git status`。如果构建改了受版本管理的文件，就报告出来，不要提交，也不要还原。
   - 失败就停下，不卸载。把日志里的报错（已脱敏）交给用户。
4. 卸载前检查。
   - CodeTether 没有在运行：没有 codetether-desktop.exe 和 codetether-host.exe 进程，4317 端口也没人监听。如果在运行，请用户从托盘退出。如果 4317 被别的程序占用，停下报告。
   - 安装目录和 WebView 目录的文件数、字节数要和 RESTORE.txt 里记的一致。
     - 不一致说明备份之后旧版本又运行过。这时按同样的结构另做一份新备份，放到 `D:/Projects/Software/agenthub-archive/windows-install-backup-<时间>-pre-v4b`。
     - 核对新备份的数量和字节，再继续。
     - machine-credentials 里的文件只复制，不打开。
5. 卸载。
   - 运行 `C:\Users\Administrator\AppData\Local\CodeTether\uninstall.exe /S`。NSIS 卸载程序会先把自己复制到临时目录再运行，所以命令会马上返回。
   - 等到以下都满足才算卸载完，最多等 2 分钟：
     - codetether-desktop.exe 和 uninstall.exe 已经从安装目录消失；
     - 注册表 `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall` 下 CodeTether 的项已经没了。
   - 然后确认数据还在：codetether.sqlite3、logs、machine-credentials 和 `com.codetether.desktop` 都还在。如果数据被删了，停下报告，等用户决定是否按 RESTORE.txt 恢复。
6. 安装。
   - 运行第 3 步打出的安装包，加 `/S`。
   - 装完确认：
     - 注册表里 DisplayVersion 是 0.1.0-alpha.0，InstallLocation 是 `C:\Users\Administrator\AppData\Local\CodeTether`；
     - codetether-desktop.exe 和 codetether-host.exe 是新文件：修改时间是今天，SHA256 和备份里的旧文件不同。
   - 报告开始菜单里有没有快捷方式。
7. 启动和确认。
   - 启动 `C:\Users\Administrator\AppData\Local\CodeTether\codetether-desktop.exe`，等 127.0.0.1:4317 开始监听，最多等 60 秒。
   - 确认只有一个 codetether-host.exe，它的路径在安装目录下，并且是它在监听 4317。
   - 确认 Host 的 buildId 是 `git-b1e1ccf123c7`。
     - 可以请求 `http://127.0.0.1:4317/api/v1/bootstrap`。需要 Origin 时，用 host_supervisor.rs 里 `desktop_origin()` 发布版的取值。只打印 build 和 version 相关的字段，不要打印整个响应。
     - 如果请求被拒，只记下状态码，不要绕过。改为在 logs 目录最新的日志里只搜 buildId 那几行，结果先脱敏。
   - 请用户看一眼窗口，确认是新版界面：侧栏按 设备 › 项目 分组，界面是中文。
   - 确认完让应用继续运行，交给用户验收。
8. 把报告写到 `D:/Projects/Software/agenthub-archive/v4-install-report-20261020.md`，包括：
   - 每一步的结果、命令和退出码；
   - 安装包的路径、大小、SHA256 和来源提交；
   - 卸载后留下了哪些数据，有没有另做备份；
   - 新安装的注册表信息、进程和端口、buildId；
   - 账号配置只写两个地址的主机名，不写 key；
   - 被拒绝的操作，以及交给用户运行的 `!` 命令；
   - 和流程不一致的地方：装的是未合并、未打标签的 b1e1ccf。

## 限制

- 不改代码，不提交、不推送、不合并、不打标签。不改 `docs/reviews/`，审核记录由审核方更新。
- 不读以下内容：
  - .secrets/；
  - 任何 .env 文件；
  - 凭据文件和 machine-credentials 里的内容；
  - ~/.claude.json；
  - agenthub-archive 里的 phase9c-control-plane.env。
- 主工作区 `D:/Projects/Software/agenthub` 里的这些未跟踪文件一律不动：.secrets/、PHASE8D-*.json、PHASE8D-*.txt、demo-ui-*.html、ICON-COLLECTION-PLAN.md、docs/MULTI-PROVIDER-STRATEGY.md、packages/ui/src/assets/。
- 不结束任何进程，需要退出时请用户从托盘退出。
- 不用 `rm -rf` 删数据目录。不删任何备份，也不删 phase10 工作区里的旧安装包。不运行 `git worktree remove`。
- 所有日志和输出里的 `sk-…` 都用 sed 脱敏，不要回显。
- 某个操作被权限拒绝时，不要换别的办法绕过。把要运行的命令写成 `! …` 交给用户。
- 遇到 API 429 或 524 时，按 Retry-After 等待，最多重试 3 次，每次都记下时间。3 次之后停下报告。
- 环境：
  - Windows 上的 Git Bash；
  - Node 是 D:\DevTools\Miniconda\node.exe（v25.8.2）；
  - cargo 1.98.0 在 ~/.cargo/bin，打包脚本会自己把它加进 PATH。
- 报告用中文，不用感叹号和破折号。

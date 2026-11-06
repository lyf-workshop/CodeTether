# 任务：Mac 安装版换成 B1 之后的构建

在 Mac 上运行。这是安装，不是开发：不改仓库代码，不提交，不推送，不打标签。

开始前确认这份文件有 4 个二级标题，最后一节是"报告"。

## 目标

背景：Mac 上的安装版 `/Applications/CodeTether.app` 是 B1 之前的构建（`git-111f1b08e5f3`，对应提交 `111f1b0`，2026-10-29），没有"添加设备 › 添加手机或平板"。正式数据目录已经被更新的版本升级到 schema 24（B1 引入的迁移），这个旧版本一启动就报 `Unsupported SQLite schema migration 24` 后退出。排查记录在 `~/agenthub-archive/b4-mac-folder-access.md` 的"安装版退出排查"一节。

目标：把安装版换成 `origin/main` 的构建，让它：

1. 用现有的正式数据启动，并保持运行；
2. 有"添加设备 › 添加手机或平板"，供 iPad 配对；
3. 不影响正式的 `com.codetether.node` 服务。

打包后的桌面应用的网页来源，控制服务已经允许，所以不需要放开任何来源，也不需要用户在 Windows 上做事。

## 怎么做

按顺序，每步记命令和结果。

1. **开始前检查**（只读）：
   - `pgrep -fl -i codetether` 记现有进程；`lsof -nP -iTCP:4317 -sTCP:LISTEN` 确认 4317 空闲；`launchctl print gui/$(id -u)/com.codetether.node` 记 Node 服务的状态和 PID，结束后要一致。
   - 记安装版的 `CFBundleShortVersionString`、`CFBundleVersion`、build id（`git-111f1b08e5f3`）、`codesign -dv` 的 CDHash。
   - 记正式数据目录 `~/Library/Application Support/CodeTether` 下 `codetether.sqlite3` 及 `-wal`、`-shm` 的大小和修改时间。不读内容。
   - 有 CodeTether 桌面应用的进程在运行就停下来告诉用户，不要自己杀进程。
2. **备份数据**（改任何东西之前）：
   - 备份目录 `~/agenthub-archive/mac-install-backup-<日期>/`，权限 700。
   - 用 `rsync -a --exclude Node/` 把正式数据目录复制进去。它的子目录 `Node/` 是 Node 服务的状态目录，里面有 Node 的私钥，不动也不备份。
   - 用 `shasum -a 256` 核对备份的 `codetether.sqlite3` 和原件一致。不打印文件内容。
3. **构建**，在新的独立工作区里，不动 Mac 已有的工作区和它们的未提交改动：
   - `git fetch origin`，在 `~/agenthub-work/mac-install-main` 检出 `origin/main`，记提交（应是 `b668e53` 或更新）。
   - 构建配置用 `set -a; . ~/agenthub-work/v4-build.env; set +a` 在构建的 shell 里加载，不打印内容。
   - 桌面 sidecar 用核对过 SHA256 的官方 Node 26.4.0（位置 `~/agenthub-work/i1-node-26.4.0`，SHA256 记在 `~/agenthub-archive/b4-mac-folder-access.md` 的"环境与范围"一节），放在 `PATH` 最前面。不要用 Homebrew 的 Node：B4 实测里用它打出的 Host 起不来。
   - `pnpm install --frozen-lockfile`，然后 `pnpm desktop:build`。
   - 构建失败就贴出报错，停下来告诉用户。不要自己换 Node 版本，也不要改代码。
   - 记产物 `CodeTether.app` 的路径（在 `apps/desktop/src-tauri/target/` 下的 bundle 目录）、大小、`codesign -dv` 的 CDHash、build id。
4. **安装**：
   - 再确认一次没有 CodeTether 桌面应用的进程。
   - 把旧的 `/Applications/CodeTether.app` 用 `mv` 移到备份目录里，命名为 `CodeTether-pre-B1.app`（不要用 `rm`）。
   - 用 `ditto` 把新的 `CodeTether.app` 复制到 `/Applications/CodeTether.app`，然后 `open -a /Applications/CodeTether.app`。
5. **验证**：
   - 等 60 秒，应用仍在运行；数据目录里的日志和应用 stderr 里没有 `Unsupported SQLite schema`；4317 的监听进程来自 `/Applications/CodeTether.app` 下。
   - 如果应用在 1 秒内退出，直接运行 `/Applications/CodeTether.app/Contents/MacOS/` 里的主程序捕获 stderr，贴出错误行。
   - 然后停下来告诉用户，请用户看：窗口能打开；按提示登录或已登录；"这台电脑"在线；设备页里有"添加设备 › 添加手机或平板"。等用户回复再继续。
   - `launchctl print gui/$(id -u)/com.codetether.node` 的 PID 和步骤 1 一致。
   - 正式数据库修改时间变了是预期的（新版本启动会写），记下新值。
6. **失败怎么办**：旧版本无法打开 schema 24 的数据，所以不要回滚到旧的 App。验证失败就停下来，把现象和错误告诉用户。不要自己恢复数据，也不要重试多次启动。

## 注意事项

- 不读 `.secrets/`、其他 `.env`、凭据文件、`~/.codex/auth.json` 和 `~/.claude.json`。`v4-build.env` 只按上面的方法加载。
- 不读数据库内容，只看文件的大小、修改时间和校验和。
- 不动 `com.codetether.node` 服务、它的程序和 `~/Library/Application Support/CodeTether/Node/`。
- 这只是一次本地安装：不打标签，不写 CHANGELOG，不推送。版本号和发布由用户另定。
- 新构建的 CDHash 变了，第一次读桌面、文稿、下载里的内容时会再弹一次授权窗口，这是预期的（B4 实测结论）。
- 安装版是 ad-hoc 签名，`spctl --assess` 会拒绝，但应用能被正常启动。

## 报告

写到 `~/agenthub-archive/mac-install-b1-report.md`：

- 安装前后的 build id、`CFBundleVersion`、CDHash；构建用的提交、Node 版本和 SHA256；
- 备份目录、备份的校验结果；
- 构建命令的退出码；
- 验证结果：运行了多久、4317 的监听者路径、日志里有没有 schema 报错、用户确认的界面情况；
- `com.codetether.node` 的 PID 前后是否一致；
- 没做完的事和原因。

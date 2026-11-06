# 任务：Mac 安装版换成 B1 之后的构建

在 Mac 上运行。这是安装，不改仓库代码，不提交，不推送，不打标签。

开始前确认这份文件有 4 个二级标题，最后一节是"报告"。

## 目标

把 `/Applications/CodeTether.app` 换成 `origin/main` 的构建（`b668e53` 或更新），做到：

1. 用现有的正式数据启动，并保持运行；
2. 有"添加设备 › 添加手机或平板"（B1），供 iPad 配对；
3. 正式的 `com.codetether.node` 服务不受影响，PID 前后一致。

完成标准：新应用启动后保持运行 60 秒以上，日志里没有 `Unsupported SQLite schema`，4317 的监听进程来自 `/Applications/CodeTether.app`，用户确认窗口能打开、"这台电脑"在线、有"添加手机或平板"。

## 已知情况

- **背景**：现在的安装版是 B1 之前的构建（`git-111f1b08e5f3`，提交 `111f1b0`）。正式数据目录 `~/Library/Application Support/CodeTether` 已被更新的版本升级到 schema 24（B1 引入），旧版本一启动就报 `Unsupported SQLite schema migration 24` 后退出，排查见 `~/agenthub-archive/b4-mac-folder-access.md` 的"安装版退出排查"。所以失败时不能回滚到旧 App。
- **备份**：改任何东西之前，把正式数据目录备份到 `~/agenthub-archive/mac-install-backup-<日期>/`，权限 700，排除子目录 `Node/`（里面是 Node 服务的私钥），并核对数据库的校验和。已有 `mac-install-backup-2026-11-06-210423/` 且校验一致的，直接用。旧的 `.app` 用 `mv` 移进备份目录，不要删除。
- **构建**：
  - 在新的独立工作区里构建，不动 Mac 已有的工作区。工作区要干净：构建脚本把未提交的改动记成 `dirty` 写进 build id，build id 带 `dirty` 说明不干净。
  - 用核对过 SHA256 的官方 Node 26.4.0（`~/agenthub-work/i1-node-26.4.0`，SHA256 记在 `~/agenthub-archive/b4-mac-folder-access.md`）。不要用 Homebrew 的 Node，B4 实测里用它打出的 Host 起不来。
  - 构建配置在 `~/agenthub-work/v4-build.env`，用 `set -a; . …; set +a` 在构建的 shell 里加载，不打印内容。
  - `apps/desktop/scripts/build-sidecar.mjs` 的 `runPnpm` 假设 pnpm 在 `$PNPM_HOME/node_modules/pnpm/bin/pnpm.mjs`（没设 `PNPM_HOME` 时在 Node 可执行文件所在的目录），这是 Windows 的目录布局。官方 Node 的压缩包里没有 pnpm，直接构建会报 `MODULE_NOT_FOUND`（2026-11-06 第一次执行时遇到）。pnpm 版本用仓库记录的 `11.20.0`。怎么提供这个入口由你决定，不改仓库代码，不改 Node 目录。
- **来源**：控制服务已经允许打包后的桌面应用的来源，不需要放开任何来源，也不需要用户在 Windows 上做事。
- **授权弹窗**：新构建的 CDHash 变了，第一次读桌面、文稿、下载里的内容时会再弹一次授权窗口，这是预期的（B4 实测）。安装版是 ad-hoc 签名，`spctl --assess` 会拒绝，但应用能被正常启动。

## 边界

- **自己决定**：怎么提供 pnpm 入口；构建失败后的诊断和重试；安装和验证的具体做法。
- **先问用户**：
  - 需要用户看窗口确认（验证的最后一步）；
  - 有 CodeTether 桌面应用的进程在运行，需要杀掉；
  - 要改仓库代码才能构建；
  - 新应用启动失败。不要自己恢复数据，也不要回滚旧 App。
- **不做**：
  - 读 `.secrets/`、其他 `.env`、凭据文件、`~/.codex/auth.json`、`~/.claude.json`；
  - 读数据库内容，只看大小、修改时间和校验和；
  - 动 `com.codetether.node` 服务、它的程序和 `Node/` 目录；
  - 提交、推送、打标签。版本号和发布由用户另定。

## 报告

写到 `~/agenthub-archive/mac-install-b1-report.md`：

- 安装前后的 build id、`CFBundleVersion`、CDHash；构建用的提交、Node 版本和 SHA256；
- 备份目录和校验结果；
- 构建时遇到的问题和你怎么解决的；
- 验证结果：运行了多久、4317 监听者的路径、日志里有没有 schema 报错、用户确认的界面情况；
- `com.codetether.node` 的 PID 前后是否一致；
- 没做完的事和原因。

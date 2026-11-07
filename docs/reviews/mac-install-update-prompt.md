# 任务：Mac 安装版更新到 fd1d905

在 Mac 上运行。这是安装，不改仓库代码，不提交，不推送，不打标签。

开始前确认这份文件有 4 个二级标题，最后一节是"报告"。

## 目标

把 `/Applications/CodeTether.app` 从现在的 `origin/main` 构建（`b668e53`）更新到 `fd1d905`。`fd1d905` 是 Supervisor 帧预算修复（`origin/fix/b1-supervisor-internal`）。用户同意合并后，`origin/main` 也会快进到这个提交，两边是同一个提交、同一个 build id。

完成标准：

1. 新应用启动后保持运行 60 秒以上，build id 是 `git-fd1d905` 开头，不带 `dirty`；
2. 4317 的监听进程来自 `/Applications/CodeTether.app`，日志里没有 `Unsupported SQLite schema`；
3. 用户确认窗口能打开，"这台电脑"在线，设备页"手机和平板"里还有那台 iPad；
4. 正式的 `com.codetether.node` 服务没受影响，PID 前后一致。

## 已知情况

- **上次安装**：怎么构建、怎么解决 pnpm 入口、用的哪个 Node，记在 `~/agenthub-archive/mac-install-b1-report.md`，照着来。要点：用核对过 SHA256 的官方 Node 26.4.0（`~/agenthub-work/i1-node-26.4.0`），不用 Homebrew 的；`apps/desktop/scripts/build-sidecar.mjs` 假设 pnpm 在 `$PNPM_HOME/node_modules/pnpm/bin/pnpm.mjs`；构建配置在 `~/agenthub-work/v4-build.env`，用 `set -a; . …; set +a` 加载，不打印内容。
- **没有新迁移**：`fd1d905` 只改读取路径，数据目录的 schema 还是 24。所以这次可以回退：新版本起不来时，换回现在的 `b668e53` 构建就能用原来的数据启动。
- **备份**：替换前，把现在的 `/Applications/CodeTether.app` 用 `mv` 移到备份目录，作为回退用的上一版。数据目录 `~/Library/Application Support/CodeTether` 在应用退出后备份一次，权限 700，排除子目录 `Node/`（Node 服务的私钥），核对数据库的校验和。备份放 `~/agenthub-archive/mac-install-backup-<日期>/`。
- **退出现在的应用**：应用常驻托盘，关窗口只是隐藏。用正常退出（托盘菜单或 `osascript -e 'quit app "CodeTether"'`），确认 4317 空闲后再替换。
- **iPad 的配对**：iPad 已经和这台 Mac 配对，正在等这次更新后继续验收。配对记在数据目录里，更新不会影响，但不要在设备页上移除或重新配对。
- **授权弹窗**：新构建的 CDHash 变了，以后第一次读桌面、文稿、下载里的内容时会再弹一次授权窗口，这是预期的。
- **来源**：控制服务已经允许打包后的桌面应用的来源，不需要放开任何来源。

## 边界

- **自己决定**：构建和安装的做法；构建环境问题；失败后的诊断和重试。新版本起不来时，自己回退到上一版并确认能启动，再告诉用户。
- **先问用户**：
  - 需要用户看窗口确认（完成标准第 3 项）；
  - 应用正常退出不了，需要杀进程；
  - 要改仓库代码才能构建。
- **不做**：
  - 读 `.secrets/`、其他 `.env`、凭据文件、`~/.codex/auth.json`、`~/.claude.json`；
  - 读数据库内容，只看大小、修改时间和校验和；
  - 动 `com.codetether.node` 服务、它的程序和 `Node/` 目录；
  - 在设备页上移除或配对设备；
  - 提交、推送、打标签。

## 报告

追加到 `~/agenthub-archive/mac-install-b1-report.md`，新开一节"更新到 fd1d905"：

- 更新前后的 build id 和 CDHash；构建用的提交、Node 版本和 SHA256；
- 备份目录和校验结果；
- 构建和安装时遇到的问题和你怎么解决的；
- 完成标准四项的结果；
- 有没有回退，为什么；
- 没做完的事和原因。

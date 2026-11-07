# 任务：Windows 安装版更新到 fd1d905

在 Windows 上运行。这是安装，不改仓库代码，不提交，不推送，不打标签。

开始前确认这份文件有 4 个二级标题，最后一节是"报告"。

## 目标

把 Windows 上的 CodeTether 安装版从 `git-b668e53f2c79` 更新到 `fd1d905`。`fd1d905` 是 Supervisor 帧预算修复（`origin/fix/b1-supervisor-internal`）。用户同意合并后，`origin/main` 也会快进到这个提交，两边是同一个提交、同一个 build id。

完成标准：

1. 新版本启动后保持运行，build id 是 `git-fd1d905` 开头，不带 `dirty`；
2. 4317 的监听进程来自安装目录，父进程是同目录的桌面程序；
3. 电脑身份没变，三台机器都还在，Host 的在线发布返回 2xx，Relay 连接收到 `supervisor.ready(role=host)`；
4. 用户确认窗口能打开，"这台电脑"在线，有"添加设备 › 添加手机或平板"。

## 已知情况

- **安装位置**：程序在 `C:/Users/Administrator/AppData/Local/CodeTether`，数据在同一目录的 `codetether.sqlite3`（`%LOCALAPPDATA%\CodeTether`）。只有这一套正式安装。
- **上次更新的做法**：2026-11-06 vivo 验收时，从 `git-5edcbbf31a02` 原位更新到 `b668e53`，过程都在 `D:/Projects/Software/agenthub-archive/t1a-logs/vivo-x60/`：
  - `windows-upgrade.json`：托盘正常退出、确认 4317 空闲、用 NSIS 安装包 `/S /UPDATE` 原位更新；
  - `windows-b668e53/`：构建脚本、构建回执、`nsis-safety-review.md`（`/UPDATE` 保留数据的审阅）、`verify-installed-desktop.py`；
  - `t1a-report.md` 的"证据与复测边界"一节记了当时的坑：`CI=1` 会被 Tauri 拒绝，要用 `CI=true`；托盘退出脚本在当前 PowerShell 下要补集合程序集引用；Tauri 构建会临时改写 18 个 TOML 的换行，不恢复会让工作区不干净、build id 带 `dirty`；安装后的桌面程序和构建产物只差 3 个字节的 BundleType 标记（`UNKNOWN` → `NSIS`），这是正常的。
  - 可以复用这些脚本，复用前确认它们针对的是新的提交和路径。
- **没有新迁移**：`fd1d905` 只改读取路径，所以这次可以回退：新版本起不来时，用上一版安装包 `windows-b668e53/CodeTether_0.1.0-alpha.0_x64-setup.exe` 原位装回去就能用原来的数据启动。
- **备份**：替换前，在应用退出后把数据目录里的数据文件（`codetether.sqlite3` 及 `-wal`、`-shm`）备份到 `D:/Projects/Software/agenthub-archive/windows-install-backup-<日期>/`，只给当前用户访问权限，核对校验和，不读内容。三个程序文件照上次那样另存一份。
- **构建**：在新的独立工作区里构建，例如 `D:/Projects/Software/agenthub-work/windows-install-fd1d905`，不动 `fix-b1-supervisor-internal` 等已有工作区。构建子进程沿用上次的环境变量白名单，不读 `.env`。
- **现在的状态**：没有配对的手机或平板（vivo 的测试授权已移除）。两台经 Node 的远程机器保持原样。
- **来源**：控制服务已经允许打包后的桌面应用的来源，不需要放开任何来源。

## 边界

- **自己决定**：构建和安装的做法；复用哪些上次的脚本；构建环境问题；失败后的诊断和重试。新版本起不来时，自己回退到上一版并确认能启动，再告诉用户。
- **先问用户**：
  - 需要用户看窗口确认（完成标准第 4 项）；
  - 托盘正常退出不了，需要杀进程；
  - 要改仓库代码才能构建；
  - 改生产服务的配置。
- **不做**：
  - 读取或打印凭据：`.secrets/`、`.env`、令牌、密钥、连接串；
  - 读数据库内容，只看大小、修改时间和校验和；
  - 动远程机器、Node 和它们的配对；
  - 提交、推送、打标签。

## 报告

写到 `D:/Projects/Software/agenthub-archive/windows-install-fd1d905-report.md`：

- 更新前后的 build id，以及桌面和 Host 程序的 SHA-256；安装包的大小和 SHA-256；
- 备份目录和校验结果；
- 构建和安装时遇到的问题和你怎么解决的；
- 完成标准四项的结果；
- 有没有回退，为什么；
- 没做完的事和原因。

# 任务：U1 电脑端一键更新

在 Windows 或 Mac 上运行。接着在 `main` 上做（当前是 `b668e53`，v0.1.0-alpha.2）。让 Windows 和 macOS 桌面版在 设置 › 关于与检查 里一键更新到新版本，本机项目、会话、凭据都保留。这轮做完整的一键更新功能，包括检查、下载、安装、备份、回退、版本号管理、发布脚本。提交推送到 `feat/u1-desktop-update`，不推 `main`、不合并、不打标签。

依据（都用 `git show` 读）：

- `docs/ux-redesign/05-desktop-update.md`：完整的设计（7 节）
- `docs/ux-redesign/03-project-plan.md` §4 的 U1 行
- `docs/ux-redesign/04-requirements.md` §6 的"发布"
- `docs/ROADMAP.md`：U1 的范围和 v0.1.0-alpha.3 的目标

开始前确认这份文件有 4 个二级标题，最后一节是"报告"。

## 目标

**必须完成**：

1. **Rust 更新逻辑**（05 §5.1）：
   - 集成 `tauri-plugin-updater`（精确版本，和 tauri 2.11.5 兼容）
   - 4 个应用命令：`update_state`、`update_check`、`update_download`、`update_install`
   - 状态机在 Rust 里（05 §4 的 11 种状态）
   - 定时检查：启动后约 1 分钟、之后每 6 小时
   - 重启用 Tauri 核心的 `AppHandle::restart`

2. **更新地址和公钥**（05 §5.2）：
   - 编译时从环境变量读入：`CODETETHER_UPDATE_BASE_URL`、`CODETETHER_UPDATE_PUBKEY`
   - 两个都有才启用更新，缺任何一个就是"这个版本没有配置自动更新"
   - 检查地址固定为 `<base>/alpha/latest.json`
   - 正式版只接受 https；http 只在 debug 构建里给本地测试用

3. **安装顺序**（05 §5.3）：
   - 网页确认没有 `running` / `waiting` 的会话，再调用 `update_install`
   - Rust 用现有的 `shutdown_owned_host`（12 秒）正常关闭 Host
   - Host 已经停了，再调用插件的安装：
     - Windows 用 `passive` 模式，NSIS 显示进度条后自动重新打开
     - macOS 替换 .app 后调用 `restart`

4. **更新前备份数据库**（05 §5.4）：
   - Host 在打开数据库之前，比较数据目录里的 `host-product-version` 标记和自己的产品版本号
   - 两者不同，并且数据库已存在：
     - 把 `codetether.sqlite3` 和 `-wal`、`-shm` 原样复制到 `backups/<UTC 时间>-<旧版本>/`，先 fsync 再继续
     - 只保留最近 3 份
     - 迁移成功后再写新的标记
   - 复制失败就不启动，给出明确原因，不碰原数据库
   - 只备份数据库文件，不复制 `machine-credentials` 和其他凭据

5. **回到旧版本时**（05 §5.5）：
   - Host 发现数据库里有它不认识的迁移，用一个专用退出码退出（不再是 1），stderr 写一行固定的原因
   - Desktop 增加对应的启动失败类型，文案："这份本机数据来自更新版本的 CodeTether，当前版本不能打开。请安装更新的版本，或按说明恢复更新前的备份。"
   - 恢复步骤写进 `apps/desktop/README.md`

6. **版本号管理**（05 §5.6）：
   - 根目录 `package.json` 是唯一来源
   - `PRODUCT_VERSION` 改成构建时注入，不再手写
   - 加一个设置版本号的脚本，同步改 `Cargo.toml`、`Cargo.lock`、`apps/desktop/package.json`，并加测试检查它们一致
   - U1 的版本定为 `0.1.0-alpha.3`

7. **发布文件和托管**（05 §5.7）：
   - 发布脚本只在这 4 个环境变量都存在时才生成更新文件：
     - `TAURI_SIGNING_PRIVATE_KEY`
     - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
     - `CODETETHER_UPDATE_BASE_URL`
     - `CODETETHER_UPDATE_PUBKEY`
   - 每个平台输出安装包、`.sig` 签名，以及一份只含本平台的 `update-<平台>.json`
   - `release:update-manifest` 把各平台的片段合成 `latest.json`
   - 目录结构：`<base>/alpha/latest.json`，安装包放在 `<base>/alpha/<版本>/`

8. **关于页版本行**（05 §4）：
   - 版本行放在关于页最上面那张卡片里，CodeTether 名称下方
   - 11 种状态（已是最新、检查中、有新版本、下载中、已下载、正在更新、失败等）
   - 更新说明只当纯文本显示，不解析 HTML 或 Markdown 链接，超过 2000 字截断
   - 进行中的数量按本机会话里状态为 `running` 或 `waiting` 的会话来数

9. **Web API 接口**（05 §5.1）：
   - 不装网页端的 `@tauri-apps/plugin-updater`，不给网页任何 `updater:*` 权限
   - 网页通过 4 个应用命令调用

**不在这轮**：
- 静默更新
- Linux
- Node 配对设备上的更新
- Android（放在 M 系列）
- 一键回退按钮
- 代码签名证书和 Mac 公证（先不买，系统警告要实测）

## 已知情况

- 现状：`main` `b668e53`（v0.1.0-alpha.2）
  - Tauri `=2.11.5`，插件只有 dialog、notification、shell、single-instance，Windows 另有 deep-link
  - 打包：Windows 是 NSIS `currentUser`；macOS 是 app + dmg，ad-hoc 签名
  - Windows 上安装目录和数据目录是同一个 `%LOCALAPPDATA%\CodeTether`
  - Host 停止：Desktop 往 stdin 写 `shutdown`，最多等 12 秒
  - 数据库迁移：`schema_migrations` 表，遇到不认识的已应用迁移会抛 `Unsupported SQLite schema migration`，Host 以退出码 1 退出
  - 关于页不显示版本号
  - 发布：`apps/distribution/src/build.mjs` 要求干净的 HEAD，安装包放到 `output/release/<commit>/`

- 更新地址：`https://codetether.org/updates`（已定，2026-11-01）
  - 检查地址：`https://codetether.org/updates/alpha/latest.json`
  - 安装包放在 `https://codetether.org/updates/alpha/<版本>/`

- 更新签名私钥：由用户在自己电脑上用 Tauri CLI 的 `tauri signer generate` 生成，放在仓库外，设好密码；公钥给你写进发布说明

- 真机验收：编码和审核完成后，用户手动装 alpha.3，再发布 alpha.4，在 Windows 和 Mac 上各点一次更新

## 边界

**自己决定**：
- 实现方式（状态机设计、Rust 模块拆分、定时任务实现）
- 提交怎么拆（每项一个或几个提交，带测试）
- 测试和截图的方法
- 版本号脚本的实现（Node.js 或 Bash/PowerShell）
- 发布脚本的改动范围

**先问用户**：
- 需要改 `apps/host` 以外的 Node.js/TypeScript 代码
- 需要改数据库 schema（备份功能只读写文件，不改 schema）
- 需要用户本人操作（生成签名密钥、上传更新文件、真机验收）
- 需要读取或打印凭据、私钥

**不做**：
- 读取或打印凭据、私钥
- 推送 `main`、合并、打标签
- 强制推送
- 上传更新文件到 VPS（用户自己上传）
- 生成签名密钥（用户自己生成）

## 报告

追加到 `~/agenthub-archive/u1-report.md`（新文件），写这几节：

- 起点：分支从哪个提交开始，确认 05 的 7 节都读过
- 1 到 9 每一项改了什么、对应的提交
- Rust 测试结果（单元测试、集成测试）
- Web 测试结果（类型检查、lint、构建）
- 版本号脚本的测试结果
- 发布脚本的测试结果（生成测试密钥、构建、检查输出文件）
- 测试密钥已删除的确认
- 推送后的远端提交
- 没做完的事和原因，以及在"完成"的哪一级

所有凭据、私钥、密码都不进报告。

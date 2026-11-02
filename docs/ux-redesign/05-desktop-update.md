# 05 · 电脑端一键更新（U1）

日期：2026-11-01。依据：`main` 0f624ae（v0.1.0-alpha.2）、03-project-plan.md 的 U1 一行、04-requirements.md §6“发布”。

## 1. 目标和范围

- Windows 和 macOS 桌面版在 设置 › 关于与检查 里一键更新到新版本，本机项目、会话、凭据都保留。
- 有新版本只提示，用户点了才更新；有会话正在运行或等待批准时先等它结束。
- 更新前备份本机数据库；新版本改了数据库结构、需要回到旧版本时，旧版本能看懂发生了什么，并能用备份恢复。
- 不做：静默更新、Linux、Node 配对设备上的更新、Android（放在 M 系列）、一键回退按钮、代码签名证书和 Mac 公证（先不买，系统警告要实测）。

## 2. 现状（在 main 上核实）

- Tauri `=2.11.5`，插件只有 dialog、notification、shell、single-instance，Windows 另有 deep-link。没有 updater 和 process 插件；`apps/desktop/test/security-config.test.mjs:301` 禁止 `tauri_plugin_process::init`。
- 打包：Windows 是 NSIS `currentUser`；macOS 是 app + dmg，ad-hoc 签名。`tauri.conf.json` 没有 `plugins.updater`，也没有 `createUpdaterArtifacts`。
- Windows 上安装目录和数据目录是同一个 `%LOCALAPPDATA%\CodeTether`：`codetether-desktop.exe`、`codetether-host.exe` 和 `codetether.sqlite3`（WAL 模式，带 `-wal` / `-shm`）、`machine-credentials` 放在一起。
- 版本号：根目录 `package.json` 还是 `0.1.0-alpha.0`，tag 已经到 alpha.2；`build.rs` 检查 Cargo 版本和它一致；`apps/web/src/runtime/account/control-plane-client.ts:9` 手写了 `PRODUCT_VERSION`。Control Plane 只把 `appVersion` 当长度受限的文本，不做版本门槛。
- Host 停止：Desktop 往 stdin 写 `shutdown`，最多等 12 秒（`host_supervisor.rs` 的 `shutdown_owned_host`）；Windows 上 Host 在 Job Object 里，Desktop 进程退出时会被直接结束。没跑完的回合在下次打开时记成 `host_restart`，不会无声丢失。
- 数据库迁移：`schema_migrations` 表，每个迁移在 `BEGIN IMMEDIATE` 里执行。遇到不认识的已应用迁移会抛 `Unsupported SQLite schema migration`（`migrations.ts:206`），Host 以退出码 1 退出，Desktop 只显示笼统的“本地服务意外退出”。没有任何备份逻辑。
- 进行中：会话状态是 `running` 或 `waiting`（等待批准）时一定有 `activeTurnId`（`packages/protocol/src/records.ts:172`）。快照里的 `activeTurns` 只算 `running`，不含等待批准。
- 关于页 `apps/web/src/components/settings/about-settings.tsx` 不显示版本号。
- 发布：`apps/distribution/src/build.mjs` 要求干净的 HEAD，安装包放到 `output/release/<commit>/`，没有更新签名。

## 3. 用户流程

1. 启动后约 1 分钟检查一次，之后每 6 小时检查一次；关于页可以手动“检查更新”。
2. 有新版本时，设置导航的“关于与检查”旁边出现一个小圆点，关于页顶部的版本行显示新版本号和更新说明。不发系统通知。
3. 用户点“更新到 x”：
   - 下载，显示进度，校验更新签名；
   - 这时没有进行中的会话：关闭本地服务，安装，重新打开 CodeTether；
   - 有进行中的会话：停在“已下载，等会话结束”，按钮在会话都结束后才可用，用户再点一次“重新启动并更新”。
4. 重新打开后，关于页显示“已更新到 x”。正在运行的 AI 工具不会被更新打断；手机和平板以后接入时，更新期间只会短暂断开。

## 4. 关于页版本行

版本行放在关于页最上面那张卡片里，CodeTether 名称下方。

| 状态                 | 左侧文字                                                                | 右侧按钮                 |
| -------------------- | ----------------------------------------------------------------------- | ------------------------ |
| 这个版本没有配置更新 | 版本 0.1.0-alpha.3 · 这个版本没有配置自动更新                           | 无                       |
| 已是最新             | 版本 x · 已是最新版本 · 上次检查 3 分钟前                               | 检查更新                 |
| 检查中               | 版本 x · 正在检查更新…                                                  | 检查更新（不可用）       |
| 有新版本             | 有新版本 y（当前 x）+ 下面一段更新说明，纯文本，最多 6 行，可展开       | 更新到 y                 |
| 下载中               | 正在下载 y · 42%                                                        | 无                       |
| 已下载，有会话进行中 | 已下载 y。有 2 个会话正在运行或等待批准，结束后才能更新，不会打断它们。 | 重新启动并更新（不可用） |
| 已下载，可以更新     | 已下载 y。更新时 CodeTether 会关闭几秒再自动打开。                      | 重新启动并更新           |
| 正在更新             | 正在关闭本地服务并安装 y…                                               | 无                       |
| 检查失败             | 暂时无法检查更新，请稍后再试                                            | 重试                     |
| 下载失败             | 下载 y 没有完成，请重试                                                 | 重试                     |
| 签名不对             | 下载的文件没有通过校验，没有安装。请稍后再试，多次失败请联系我们。      | 重试                     |
| 安装失败             | 没有完成更新，当前版本继续可用                                          | 重试                     |

- 更新说明只当纯文本显示，不解析 HTML 或 Markdown 链接，超过 2000 字截断。
- 进行中的数量按本机会话里状态为 `running` 或 `waiting` 的会话来数，不只看 `activeTurns`。

## 5. 技术方案

### 5.1 更新逻辑放在 Rust 层

- 用 `tauri-plugin-updater`（精确版本，和 tauri 2.11.5 兼容），只在 Rust 里调用。不装网页端的 `@tauri-apps/plugin-updater`，不给网页任何 `updater:*` 权限。
- 新增 4 个应用命令，网页不能传地址、公钥或路径：
  - `update_state`：返回当前状态，即 §4 那张表；
  - `update_check`；
  - `update_download`：只带一个 Channel，用来回传进度；
  - `update_install`。
- 状态机在 Rust 里。下载好的安装包只留在内存里，重启 CodeTether 后要重新下载。
- 定时检查放在 Rust 的后台任务里，不依赖网页是否被挂起（macOS 窗口最小化时网页会被挂起）。
- 不用 process 插件；重启用 Tauri 核心的 `AppHandle::restart`。

### 5.2 更新地址和公钥

- 编译时从环境变量读入，和 Control Plane 地址的做法一样（`option_env!`）：
  - `CODETETHER_UPDATE_BASE_URL`；
  - `CODETETHER_UPDATE_PUBKEY`。
- 两个都有才启用更新，缺任何一个就是“这个版本没有配置自动更新”。所以平时的 `desktop:build` 和开发版不受影响。
- 检查地址固定为 `<base>/alpha/latest.json`。正式版只接受 https；http 只在 debug 构建里给本地测试用。
- 请求里只带版本号、平台和架构，不带账号令牌，也不带任何项目或会话信息。

### 5.3 安装顺序

1. 网页确认没有 `running` / `waiting` 的会话，再调用 `update_install`。
2. Rust 用现有的 `shutdown_owned_host`（12 秒）正常关闭 Host。关不掉就放弃这次更新，重新启动 Host，状态变成“安装失败”。
3. Host 已经停了，再调用插件的安装：
   - Windows 用 `passive` 模式，NSIS 显示进度条后自动重新打开；
   - macOS 替换 .app 后调用 `restart`。
4. 剩下的竞态：第 1 步和第 2 步之间如果刚好有新回合开始，它会和今天退出 CodeTether 时一样，下次打开时记成 `host_restart`，不会丢失。这一点写进说明。

### 5.4 更新前备份数据库（Host 负责）

- Host 在打开数据库之前，比较数据目录里的 `host-product-version` 标记和自己的产品版本号。这里用的是语义版本号，不是 git 构建号。
- 两者不同，并且数据库已存在：
  - 把 `codetether.sqlite3` 和 `-wal`、`-shm` 原样复制到 `backups/<UTC 时间>-<旧版本>/`，先 fsync 再继续；
  - 只保留最近 3 份；
  - 迁移成功后再写新的标记。
- 复制失败就不启动，给出明确原因（比如磁盘空间不够），不碰原数据库。
- 只备份数据库文件，不复制 `machine-credentials` 和其他凭据。
- 这样不管是一键更新、手动重装还是 Mac 替换 app，只要换了版本就会先备份。

### 5.5 回到旧版本时

- Host 发现数据库里有它不认识的迁移，用一个专用退出码退出（不再是 1），stderr 写一行固定的原因。
- Desktop 增加对应的启动失败类型，文案：“这份本机数据来自更新版本的 CodeTether，当前版本不能打开。请安装更新的版本，或按说明恢复更新前的备份。”
- 恢复步骤写进 `apps/desktop/README.md`：退出 CodeTether，把备份里的 3 个文件复制回数据目录，再打开旧版本。

### 5.6 版本号

- 根目录 `package.json` 是唯一来源。
- `PRODUCT_VERSION` 改成构建时注入，不再手写。
- 加一个设置版本号的脚本，同步改 `Cargo.toml`、`Cargo.lock`、`apps/desktop/package.json`，并加测试检查它们一致。
- U1 的版本定为 `0.1.0-alpha.3`。更新插件按语义版本比较，所以以后每次发布都必须先升版本号。

### 5.7 发布文件和托管

- 发布脚本只在这 4 个环境变量都存在时才生成更新文件；只检查有没有，不打印内容：
  - `TAURI_SIGNING_PRIVATE_KEY`；
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`；
  - `CODETETHER_UPDATE_BASE_URL`；
  - `CODETETHER_UPDATE_PUBKEY`。
- 每个平台输出安装包、`.sig` 签名，以及一份只含本平台的 `update-<平台>.json`：
  - Windows 用 NSIS 安装包；
  - macOS 用 `.app.tar.gz`。
- `release:update-manifest` 把各平台的片段合成 `latest.json`。某个平台还没上传时，`latest.json` 里就没有它，那个平台显示“已是最新”，不报错。
- 目录结构：`<base>/alpha/latest.json`，安装包放在 `<base>/alpha/<版本>/`。由你上传，编码智能体不上传。

### 5.8 不变量

- 签名私钥只在你的电脑上，不进仓库、不进 `.secrets/` 以外的任何地方被智能体读取；智能体测试时自己生成一把一次性的测试密钥，放在仓库外，用完删除。
- 网页不能触发任意地址的下载或安装；没有校验通过的签名就不安装。
- 不读写 `.secrets/` 和凭据文件；编码智能体不部署、不上传、不替换已安装的版本。

## 6. 风险和要实测的

- Windows 安装目录就是数据目录：要从 tauri-bundler 的 NSIS 模板确认，更新安装和卸载都不会删除数据库、`backups/` 和 `machine-credentials`；卸载时“删除应用数据”勾选框删除的是哪个目录。
- Windows 安装包没有代码签名：从应用里下载运行时有没有 SmartScreen 提示，要实测并截图。
- macOS ad-hoc 签名每次构建都不同：更新后通知权限是否还在、LaunchServices 会不会多一条注册，要在你的 Mac 上实测。
- 第一次只能手动装：已经装好的 alpha.1 / alpha.2 没有更新功能，alpha.3 要手动装一次；之后发布 alpha.4，才能真正测到一键更新。

## 7. 需要你定

1. 更新文件放在哪里：已定（2026-11-01）放在 us-vps-01。地址暂定 `https://codetether.org/updates`，所以检查地址是 `https://codetether.org/updates/alpha/latest.json`。官网源码只在 VPS 上，这个目录由你上传和维护，编码智能体不登录 VPS。具体路径你可以改，它只决定 `CODETETHER_UPDATE_BASE_URL` 的值。
2. 更新签名私钥：你在自己电脑上用 Tauri CLI 的 `tauri signer generate` 生成，放在仓库外，设好密码；公钥给我写进发布说明。编码智能体会在报告里给出这台电脑上能直接运行的命令。
3. 真机验收：编码和审核完成后，你手动装 alpha.3，再发布 alpha.4，在 Windows 和 Mac 上各点一次更新。

# 任务：B0 远程访问上线（部署 Control Plane 迁移 0008 和公网 Relay，做强制 Relay 验证）

在这台 Windows 电脑上运行，通过 SSH 操作 us-vps-01。依据：`docs/ROADMAP.md` 顶部的 B0、`docs/ux-redesign/03-project-plan.md` §4 和 §6、`docs/PHASE10A1-MULTI-DEVICE-SUPERVISOR-TRANSPORT.md`、`docs/PHASE9B2-REMOTE-HOST-SUPERVISOR.md`、`apps/control-plane/README.md`、`apps/relay/README.md`。

开始前确认这份文件有 5 个二级标题，最后一节是“报告”。

## 目标

1. us-vps-01 上的 Control Plane 更新到 `main`，数据库迁移到 0008。
2. 公网 Relay 部署好并能从外网连上。
3. 这台 Windows 上的 Host 配好 Relay，Relay presence 在线。
4. 有一个开发用的诊断页，能做强制 Relay 的只读验证。Mac 上的跨设备验证另写一份提示词，不在这次范围内。

怎么做、按什么顺序做，由你根据服务器上的实际情况判断。部署、改服务器配置、提交和推送分支都可以做。

## 已知情况

- **桌面版不用重新打包。** Phase 10A 和 10A.1 的代码已经在 `main`（`454f414`）。已装的 `v0.1.0-alpha.2`（`0f624ae`）包含 Control Plane、Relay 和 Host 的全部相关改动，之后这几个应用的代码没有变。
- **迁移 0008**（`apps/control-plane/migrations/0008_host_supervisor_presence.sql`）：
  - 只新增表 `control_plane.host_supervisor_presence` 和一个索引，没有回退脚本，旧代码不受这张表影响。
  - 迁移由 `runMigrations` 在启动时自动执行，也可以单独运行 `migrate`。它在事务里执行，记录每个文件的 SHA-256，文件内容和记录不一致时拒绝执行。
  - 文档只记录到 0006 上线，0007 很可能已经上线。
- **Control Plane 的运行方式要到服务器上查。** 它只监听回环地址，默认端口 4320，由反向代理对外提供 api.codetether.org。仓库里没有它的部署配置。
- **Relay 不能放在 HTTP 反向代理后面。** 它是原生 TLS，ALPN 是 `codetether-relay/1`。
  - 如果 443 已经被官网或 api 占用，可选的办法：
    - 单独的公网 IP；
    - 单独的端口，比如 8443；
    - 在现有入口前按 SNI 做四层分流。这会改动官网和 api 的入口，选它之前先和用户确认。
  - 仓库里有 systemd 单元 `apps/relay/deploy/codetether-relay.service` 和配置模板 `relay.config.public-ca.example.json`。
  - 管理端口 `127.0.0.1:9443` 不要对外开放。
  - Relay 第一次启动时生成随机身份。状态目录 `/var/lib/codetether-relay` 删了，身份就变了，所以要备份。
  - 证书续期后要重启 Relay。
- **Host 在运行时读 Relay 配置。** 3 个环境变量要么都设，要么都不设：`CODETETHER_SUPERVISOR_RELAY_ENDPOINT`、`CODETETHER_SUPERVISOR_RELAY_ID`、`CODETETHER_SUPERVISOR_RELAY_FINGERPRINT`（`apps/host/src/api/supervisor-transport-manager.ts:1197`）。要确认 Desktop 启动 Host 时会把它们传过去（`apps/desktop/src-tauri/src/host_supervisor.rs`）。
- **强制 Relay 的开关已经不在了。** `8ddf668` 删除 v3 界面时把它一起去掉了。
  - 网页里已经没有代码调用 `connectRemoteSupervisor`（`apps/web/src/runtime/account/remote-supervisor.ts:408`）。
  - Host 的 `/api/v1/remote-supervisor/connections` 仍然接受 `forceRelay`（`apps/host/src/api/local-http-server.ts:154`）。
- **旧 Relay 不清楚。** 以前阿里云上有一台 Relay（构建 `git-2b1a67606f24`），现在还在不在不清楚。查到了就在报告里说明，不用处理。
- **SSH。** 这台电脑上应该已经配好了访问 us-vps-01 的 SSH。需要密码或口令时，把命令写成 `! …` 交给用户执行。

## 诊断页

- 在新分支上实现，比如 `b0/relay-go-live`，工作区放在 `D:/Projects/Software/agenthub-b0-relay-go-live`。
- 页面只在开发构建里出现，例如 `#/dev/supervisor-check`，正式构建里不要带上。
- 复用 `connectRemoteSupervisor`。用户选一台同账号的 Host，再选“自动”或“只走 Relay”。
- 依次只读调用 `host.bootstrap`、`machine.list`、`machine.get`、`project.list`、`conversation.list`、`conversation.get`、`conversation.history`。
- 每一步显示是否成功、走的是 direct 还是 relay、耗时和错误类型。会话标题、提示词和路径不显示。
- 这个页面只读：不新建会话、不发消息、不申请 `supervisor_control`。
- 门禁：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`。

开发版和安装版都用 4317 端口。用开发版测试时先退出安装版，并用独立的数据目录，例如 `CODETETHER_DATA_DIR=D:/Projects/Software/agenthub-work/b0-check-data`。

## 注意事项

- **备份。** 改动之前先备份，并写清怎么回退：
  - Control Plane 的 `control_plane` schema；
  - 当前的代码目录和进程配置；
  - Relay 的状态目录和配置。

  备份复制一份到 `D:/Projects/Software/agenthub-archive/b0-backups/`。Relay 的状态备份里有私钥，只放在这个目录里。

- **凭据。** 数据库连接串、Supabase 密钥和证书私钥不要打印，也不要写进仓库、日志或报告。`relayId` 和 `relayFingerprint` 是公开信息，可以写。
- **服务器上的其他项目。** us-vps-01 上还有官网和其他项目。会影响它们的操作，比如改官网或 api 的入口、重启它们的服务，或者删除数据，先和用户确认。部署完确认它们和部署前一样正常。
- **授权。** 现有的授权 `hauth_e6c2bb245dac4a12820a66237b30a093` 和 Host 身份保持不变。验证时发现身份、授权代际或 scope 和预期不一致，先停下来查原因。
- **Phase 9C 的临时 LAN 助手。** 退役步骤在 `docs/PHASE10A-CROSS-NETWORK-HOST-AUTHORIZATION.md:24-39`。在报告里列出这台电脑上还残留的部分，由用户决定什么时候清理。

## 报告

写到 `D:/Projects/Software/agenthub-archive/b0-report.md`。很长的命令输出放到 `D:/Projects/Software/agenthub-archive/b0-logs/`；整理日志时去掉凭据，但保留报错的行。

报告内容：

- 服务器上的实际情况：Control Plane 怎么运行、部署前迁移到了哪一版、443 被谁占用；
- 选了哪个 Relay 端口方案，为什么；
- 每一步做了什么，用什么命令验证，结果如何；
- 备份放在哪里、SHA-256，以及回退方法；
- Relay 的 `relayId`、`relayFingerprint`、地址和证书到期时间；
- Windows 上 Relay presence 的状态，诊断页跑出的结果；
- 分支名和提交列表；
- 没做完的事和原因。

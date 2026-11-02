# 任务：B0 远程访问上线（部署 Control Plane 迁移 0008 和公网 Relay，做强制 Relay 验证）

在 Windows（这台电脑）上运行，通过 SSH 操作 us-vps-01。依据：`docs/ROADMAP.md` 顶部的 B0、`docs/ux-redesign/03-project-plan.md` §4 和 §6、`docs/PHASE10A1-MULTI-DEVICE-SUPERVISOR-TRANSPORT.md`、`docs/PHASE9B2-REMOTE-HOST-SUPERVISOR.md`、`apps/control-plane/README.md`、`apps/relay/README.md`。

这份提示词明确授权部署，范围只限下面“授权范围”一节。部署规则见 03 §6：先备份，写清回退方法，每一步都要验证；不可逆或会影响服务器上其他项目的步骤，先停下来问用户。

开始前确认这份文件有 11 个二级标题，最后一节是“限制”。不完整就停下报告。

## 背景

- Phase 10A 和 10A.1 的代码已经合入 `main`（`454f414`）。已安装的 Windows / Mac 桌面版 `v0.1.0-alpha.2`（`0f624ae`）已经包含 Control Plane、Relay 和 Host 的全部相关改动；`0f624ae` 之后这几个应用的代码没有变，所以不用重新打包桌面版。
- 迁移 0008（`apps/control-plane/migrations/0008_host_supervisor_presence.sql`）只新增表 `control_plane.host_supervisor_presence` 和一个索引，没有回退脚本。
  - 迁移由 `runMigrations` 执行：在启动时自动跑，事务内完成，带 advisory lock，记录每个文件的 SHA-256，文件内容和记录不一致时会拒绝执行。
  - 文档只记录到 0006 上线，0007 很可能已上线，以第一部分查到的为准。
- Control Plane 只监听回环地址，默认端口 4320，由反向代理对外提供 api.codetether.org。仓库里没有它的部署配置（没有 Dockerfile、systemd 单元或代理配置），线上怎么运行，要在第一部分查清。
- Relay 不是 HTTP 服务，是 ALPN 为 `codetether-relay/1` 的原生 TLS，HTTP 反向代理挡在前面它就不能用。
  - 仓库里有 systemd 单元 `apps/relay/deploy/codetether-relay.service`，配置模板有两份：`relay.config.public-ca.example.json`（公网证书）和 `relay.config.example.json`（固定身份）。
  - 公网只开放一个 TLS 端口；管理端口 `127.0.0.1:9443` 绝不对外。
  - 第一次启动时生成随机身份。之后不能删除状态目录，删了身份就变了，已有客户端都要重新配置。
- Host 在运行时从环境变量读取 Relay，三个变量要么都设，要么都不设：`CODETETHER_SUPERVISOR_RELAY_ENDPOINT`、`CODETETHER_SUPERVISOR_RELAY_ID`、`CODETETHER_SUPERVISOR_RELAY_FINGERPRINT`（`apps/host/src/api/supervisor-transport-manager.ts:1197`）。Mac 客户端从 Host 签名的描述里得到 Relay 地址。
- 强制 Relay 验证用的开关（`VITE_CODETETHER_FORCE_RELAY`、`?forceRelay=1`）已经在 `8ddf668` 删除界面时一起去掉了。
  - 现在网页里没有代码调用 `connectRemoteSupervisor`（`apps/web/src/runtime/account/remote-supervisor.ts:408`）。
  - Host 的 `/api/v1/remote-supervisor/connections` 仍然接受 `forceRelay`（`local-http-server.ts:154`）。
  - 所以要先做一个只在开发版里出现的验证入口，见第四部分。
- 以前有一台阿里云上的 Relay（Phase 7A / 8D，构建 `git-2b1a67606f24`），现在还在不在不清楚。

## 授权范围

可以做：

- 在 us-vps-01 上：
  - 只读调查；
  - 备份 Control Plane 数据库里的 `control_plane` schema；
  - 把 Control Plane 更新到 `main` 当前提交，应用迁移（到 0008 为止）；
  - 安装并启动 Relay（新用户 `codetether-relay`，新目录 `/etc/codetether-relay`、`/var/lib/codetether-relay`），以及它的 systemd 单元；
  - 按第一部分结论和用户确认的方案，为 Relay 开放一个公网 TLS 端口。
- 在这台 Windows 电脑上：
  - 在分支 `b0/relay-go-live`（工作区 `D:/Projects/Software/agenthub-b0-relay-go-live`，从 `main` `454f414` 新建）上写验证入口的代码并按步骤提交；
  - 经用户同意后，设置上面 3 个用户级环境变量，并请用户重新启动 CodeTether。

先问用户才能做：

- 改 DNS、申请或更换证书；
- 改反向代理（Caddy / nginx）配置或防火墙规则；
- 重启 Control Plane 以外的任何服务；
- 停掉或改动旧的阿里云 Relay；
- 设置环境变量；
- 任何删除操作。

## 第一部分：只读调查（不改任何东西）

1. 用这台电脑上已经配置好的 SSH 访问 us-vps-01：先看 `~/.ssh/config` 里有没有对应的主机别名。只读别名，不读私钥。找不到或者连不上就停下，把 `! ssh …` 这样的命令交给用户，不要自己找密码或密钥。
2. 查清 Control Plane 怎么运行：
   - 进程管理方式（systemd / pm2 / docker / 其他）；
   - 代码目录和当前提交；
   - Node 版本；
   - 环境变量放在哪个文件里（只记文件路径和变量名，不打印值）；
   - 反向代理怎么配置的，哪个程序占着 443。
3. 只读查询 `control_plane.schema_migrations`，看已经应用到哪一个迁移。数据库连接串从服务器上的环境文件里读，不打印、不写进日志、不写进报告。
4. 查清 443 和其他候选端口的占用情况、防火墙（ufw / iptables / 云厂商安全组能看到多少就记多少）、服务器有几个公网 IP、`relay.codetether.org` 现在的 DNS 解析。
5. 查清 Node 25.5 或以上能不能在服务器上用（构建 Relay SEA 需要），或者在这台 Windows 上交叉构建 linux-x64 是否可行（`pnpm relay:sea` 的平台参数见 `scripts/build-relay.mjs`）。
6. 写第一份报告（路径见“日志和报告”），然后**停下等用户和审核方回复**。报告里给出 Relay 端口方案的比较和你的推荐，候选方案：
   - A：单独的公网 IP 上用 443；
   - B：单独端口（例如 8443），只需要多开一个防火墙端口；
   - C：在现有代理前面按 SNI 做四层分流（nginx `stream` + `ssl_preread`，或 Caddy layer4），让 relay.codetether.org 也用 443。这会改动官网和 api 的入口，风险最大。
   - 每个方案写清：要改什么、影响哪些现有服务、证书怎么续期、怎么回退。

## 第二部分：部署 Control Plane

用户确认第一份报告后再做。

1. 备份：
   - 用服务器上已有的 `pg_dump`（或同等工具）只导出 `control_plane` schema，存到服务器上的备份目录，再复制一份到 `D:/Projects/Software/agenthub-archive/b0-backups/`；
   - 记录文件大小和 SHA-256；
   - 同时备份当前代码目录（或者记下当前提交）和进程配置。
2. 在本机或服务器上构建 `apps/control-plane`（`pnpm build`），和线上的部署方式保持一致。迁移文件的内容不能改，校验和不一致时运行器会拒绝执行。
3. 先在服务器上单独运行一次 `node dist/migrate-cli.js`（`migrate` 脚本），确认应用到 0008，再按原来的方式重启 Control Plane。
4. 验证：
   - 本机回环 `GET /healthz` 和 `/readyz`；
   - 公网 `https://api.codetether.org/healthz`；
   - `pnpm --filter @codetether/control-plane smoke:supabase-postgres`（不写入数据，见 README）；
   - `schema_migrations` 最新一条是 0008；
   - 已安装的 Windows 桌面版仍然能登录，设备页正常。
5. 回退：0008 只新增一张表，新代码起不来时，切回备份的代码和进程配置就能回退；这张表留着不影响旧代码。不要删除这张表，也不要动 `schema_migrations`。

## 第三部分：部署公网 Relay

按用户在第一份报告后选定的端口方案做。

1. 在 Linux x64（Node ≥ 25.5）上运行 `pnpm relay:sea` 构建，然后运行 `pnpm relay:smoke`。
2. 按 `apps/relay/README.md` 的步骤安装：
   - 二进制放到 `/usr/local/bin`；
   - 创建系统用户 `codetether-relay`；
   - 用 `relay.config.public-ca.example.json` 作模板写 `/etc/codetether-relay/relay.json`，`listen` 用选定的端口；
   - 证书路径指向用户确认后的证书，权限只给 `codetether-relay` 读；
   - 安装 systemd 单元。
3. 证书：
   - 申请或复用证书之前先问用户；
   - 证书续期后要重启 Relay（README），把续期钩子一起写好，写之前问用户。
4. 第一次启动后运行 `codetether-relay identity --state-dir /var/lib/codetether-relay`，记下 `relayId` 和 `relayFingerprint`。这两个值是公开信息，可以写进报告。
5. 验证：
   - 回环 `http://127.0.0.1:9443/healthz`、`/readyz`；
   - 从这台 Windows 电脑做 TLS 握手，确认证书链、SNI 和 ALPN `codetether-relay/1`；
   - 确认 9443 在公网上访问不到；
   - 确认官网、api.codetether.org 和服务器上其他服务的状态和部署前一样。
6. 备份 `/var/lib/codetether-relay` 和 `/etc/codetether-relay`（README 的 Backup 一节），复制一份到 `D:/Projects/Software/agenthub-archive/b0-backups/relay/`。这个备份里有 Relay 私钥：只放在那个目录里，不进仓库，不复制到别处，报告里只写路径。

## 第四部分：强制 Relay 验证工具

在 `b0/relay-go-live` 上实现，单独一个提交。

1. 加一个只在开发构建里出现的诊断页 `#/dev/supervisor-check`。
   - 用 `import.meta.env.DEV` 和 `VITE_CODETETHER_SUPERVISOR_CHECK=1` 双重门控；
   - 正式构建里路由、组件、文案都不能出现，加测试检查打包产物里没有这个页面的标识。
2. 页面复用现有的 `connectRemoteSupervisor`。
   - 用户在页面上选一台同账号的 Host，选择“自动”或“只走 Relay”（`forceRelay: true`）。
   - 依次只读调用 `host.bootstrap`、`machine.list`、`machine.get`、`project.list`、`conversation.list`、`conversation.get`、`conversation.history`。
   - 每一步只显示结果是否成功、用了哪种连接方式（direct / relay）、耗时和错误类型；不显示会话标题、提示词或路径。
3. 页面上不能有任何写操作。
   - 不调用 `conversation.create`、`conversation.turn.start`；
   - 不申请 `supervisor_control`；
   - 不新建授权。
4. 门禁：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build` 全部通过。

## 第五部分：Windows 端配置和验证

1. 经用户同意后，在 Windows 上设置 3 个用户级环境变量：
   - `CODETETHER_SUPERVISOR_RELAY_ENDPOINT`：`tls://relay.codetether.org:<端口>`，或者第一部分选定方案对应的地址；
   - `CODETETHER_SUPERVISOR_RELAY_ID`；
   - `CODETETHER_SUPERVISOR_RELAY_FINGERPRINT`。
2. 请用户退出并重新打开已安装的 CodeTether。
3. 先确认 Desktop 启动 Host 时会把这几个变量传过去：看 `apps/desktop/src-tauri/src/host_supervisor.rs` 启动 Host 时有没有清空环境。没有传过去就停下报告，不要改桌面版代码。
4. 在 Host 上验证：
   - `GET /api/v1/supervisor/presence/diagnostics` 显示 Relay 已配置、Host 的 Relay presence 在线；
   - 重启 CodeTether 之后仍然在线；
   - 没有重连循环；
   - 没有启动任何 Codex / Claude 进程。
5. 在 Windows 上用开发版打开 `#/dev/supervisor-check`，连本机这台 Host，跑一次“自动”。这只验证工具本身能用；真正的跨设备强制 Relay 验证在 Mac 上做，审核方会另写一份 Mac 提示词。
   - 开发版和安装版都用 4317 端口。先退出安装版，再用独立数据目录 `CODETETHER_DATA_DIR=D:/Projects/Software/agenthub-work/b0-check-data` 运行 `pnpm desktop:dev`。
   - 如果开发版要求同账号登录，并且需要用户输入，交给用户来做。
6. Phase 9C 的临时 LAN 助手（`docs/PHASE10A-CROSS-NETWORK-HOST-AUTHORIZATION.md:24-39`）只能由用户退役。在报告里列出这台电脑上还残留的部分（4331 防火墙规则、助手进程和文件），不要自己删。

## 停止条件

出现下面任何一种情况就停下，写报告：

- SSH 连不上，或者需要密码、私钥口令；
- 迁移运行器报校验和不一致，或者线上的迁移记录有本地没有的条目；
- 部署后 Control Plane `/readyz` 失败超过 5 分钟：先按第二部分第 5 步回退，再停；
- 官网、api 或服务器上其他服务的状态出现任何变化；
- Host 身份、授权代际、grant 或 scope 和预期不一致。不要新建或改动授权 `hauth_e6c2bb245dac4a12820a66237b30a093`；
- 任何需要删除数据、改 DNS 或证书、改代理或防火墙、重启其他服务，但还没得到用户同意的步骤。

预算：构建 Relay 最多 3 次，部署 Control Plane 最多 2 次。

## 不要做的事

- 不读写 `.secrets/`、`.env`、私钥和凭据文件。
- 不打印数据库连接串、Supabase 密钥、证书私钥，也不写进日志或报告。
- 不改迁移文件，不删表，不改 `schema_migrations`。
- 不动官网源码、官网的服务，以及服务器上的其他项目。
- 不重新打包、不替换已安装的桌面版。
- 不申请或签发 `supervisor_control`，不新建授权，不启动 AI 回合。
- 不推送分支。
- 不删除 Relay 状态目录。

## 日志和报告

- 第一份报告：`D:/Projects/Software/agenthub-archive/b0-report-1-survey.md`。
- 最终报告：`D:/Projects/Software/agenthub-archive/b0-report-2-deploy.md`。
- 命令输出很长时写到 `D:/Projects/Software/agenthub-archive/b0-logs/`，报告里只放关键行。日志要去掉连接串、密钥和令牌，但保留错误行，包括 `[codetether:host]` 开头的行。
- 报告写：
  - 每一步做了什么、结果、验证命令和关键输出；
  - 备份文件的路径和 SHA-256；
  - Relay 的 `relayId`、`relayFingerprint`、端口和证书到期时间；
  - 回退方法；
  - 还没做的事和原因；
  - `b0/relay-go-live` 上的提交列表。

## 限制

- 这份提示词只授权上面列出的部署。B1（远程控制）、`supervisor_control` 和 Mac 端的验证都不在这次范围内。
- 被策略拒绝的命令不要绕过，写成 `! …` 交给用户执行。
- 出现文件里没写到的情况，停下来问，不要自己找折中的办法。

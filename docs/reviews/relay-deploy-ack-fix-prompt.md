# 任务：生产 Relay 更新到 e4bdd57（Supervisor 确认竞态修复）

在 Windows 上运行，通过 SSH 操作服务器。这是部署，不改仓库代码，不提交。依据：修复报告 `D:/Projects/Software/agenthub-archive/relay-create-uncertain-report.md`、审核记录 `docs/reviews/fix-relay-create-uncertain.md`（在 `origin/ux/design` 上），以及 B0 报告 `D:/Projects/Software/agenthub-archive/b0-report.md`（现有部署方式、备份和回退的做法）。

开始前确认这份文件有 4 个二级标题，最后一节是"报告"。

## 目标

把 us-vps-01 上的 `codetether-relay.service` 换成 `e4bdd57` 构建的 Relay，让经 Relay 的新建会话不再卡在"结果待确认"。

完成标准：

1. 服务用新程序运行，build id 以 `git-e4bdd57` 开头，不带 `dirty`；
2. Relay 的身份不变：公开探针看到的 Relay ID 和指纹与部署前相同；
3. Windows 和 Mac 的 Host 重新连上 Relay：收到 `supervisor.ready(role=host)`，在线发布返回 2xx；
4. 服务器上其他服务（Caddy、官网、Control Plane、anju-cloud-pivot、anju-competition、cloudcli、xray）的 PID 前后不变；
5. 回退办法写清楚，并且已经准备好。

真机上经 Relay 新建会话的复测不在这一轮，由平板验收做。

## 已知情况

- **现在的部署**（B0 报告"公网 Relay"一节）：程序 `/usr/local/bin/codetether-relay`（SEA），服务 `codetether-relay.service`，8443 原生 TLS，管理地址 `127.0.0.1:9443`。B0 时程序的 SHA-256 是 `fe18675d58e1a3e0f6617e839537d6b76d68c3370dfd6e41f19dd24ac9a84cd3`。先核对现在跑的还是不是它。
- **身份**：Relay 的身份在 `--state-dir` 指定的状态目录里，客户端都固定了它的 ID 和指纹。只换程序文件，不动状态目录、启动参数和配置，不运行 enroll 等会改身份的命令。状态目录只备份，不读里面的私钥。
- **构建**：
  - `pnpm relay:sea`（`apps/relay/scripts/build-relay.mjs`）需要 Node 25.5 以上，按当前平台生成产物，不能在 Windows 上交叉构建。
  - 服务器的系统 Node 是 v22，不要升级它。
  - 怎么得到和服务器同架构的 Linux 产物，由你定。比如在服务器的临时目录里用一份独立的官方 Node 构建，或者用 WSL、容器。
  - 从干净的 `e4bdd57` 构建，用 `apps/relay/scripts/sea-smoke.mjs` 冒烟。
- **部署前先查一次**：看生产 Relay 的日志里，vivo 复测那段时间（`t1a-report.md` 的"fd1d905 复测"）有没有通道因 `flow_control_violation` 关闭。只看事件类型和时间。有就写进报告，用来给原事件归因。
- **备份和回退**：照 B0 的做法。备份放 `/var/backups/codetether/<日期>-relay-ack/`，包括旧程序、单元文件和状态目录；本机也留一份旧程序。回退就是换回旧程序再重启服务。
- **重启的影响**：重启时，所有经 Relay 的连接都会断开几秒，包括两台电脑的 Host、配对的手机和平板、经 Relay 的 Node。客户端会自己重连；进行中的任务不会自动重发。
- **SSH**：之前几次 SSH 在 banner 阶段超时（`t1a-report.md`）。连接不稳时不要做到一半：先把新程序和备份都准备好，再用一次连接完成换文件和重启。
- 控制服务的来源名单和 Control Plane 都不用改。

## 边界

- **自己决定**：构建方式；备份和切换的具体做法；冒烟和检查的方法；SSH 不稳时的重试。新程序起不来或身份变了，自己回退到旧程序，确认恢复后再告诉用户。
- **先问用户**：
  - 重启服务之前（用户可能正在用平板或 iPad 做经 Relay 的验收）；
  - 要升级系统 Node 或安装系统包；
  - 要改 Relay 的配置、启动参数、证书、DNS、防火墙，或动其他服务；
  - 要改仓库代码。
- **不做**：读取或打印私钥、令牌、证书私钥；动 Control Plane 和数据库；推送、打标签。

## 报告

写到 `D:/Projects/Software/agenthub-archive/relay-deploy-e4bdd57-report.md`：

- 部署前后程序的 SHA-256 和 build id；构建环境；冒烟结果；
- 日志里 vivo 那段时间有没有 `flow_control_violation`；
- 备份位置和回退步骤；
- 完成标准五项的结果，其他服务 PID 的前后对比；
- 有没有回退，为什么；没做完的事和原因。

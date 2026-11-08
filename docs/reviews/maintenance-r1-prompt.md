# 任务：维护（构建脚本找 pnpm、安装版保留诊断）

在 Windows 上运行。这轮要改代码：从 `origin/main` 开出分支 `chore/maintenance-r1`，工作区放 `D:/Projects/Software/agenthub-work/chore-maintenance-r1`。依据：`docs/reviews/fix-relay-create-uncertain.md` 的建议改第 1 项，`docs/DEVELOPMENT-PROCESS.md`（在 `origin/ux/design` 上，用 `git show` 读）。

开始前确认这份文件有 4 个二级标题，最后一节是"报告"。

## 目标

三件独立的小事，各自一个或几个提交。

1. **构建脚本自己找到 pnpm**：
   - `apps/desktop/scripts/build-sidecar.mjs` 的 `runPnpm` 和 `apps/node/scripts/build-node.mjs`（:130 附近）把 pnpm 入口写死成 `$PNPM_HOME/node_modules/pnpm/bin/pnpm.mjs`，没设 `PNPM_HOME` 时用 Node 可执行文件所在的目录。这是 Windows 的目录布局，在 macOS 和 Linux 上照 `README` 运行 `pnpm desktop:build` 一定失败，Mac 已经碰到过两次。
   - 改成：由 pnpm 运行脚本时（`pnpm desktop:build` 等），用 pnpm 传给子进程的信息（例如 `npm_execpath`）找到正在用的那个 pnpm；直接用 `node` 运行脚本时，再按现在的规则找；都找不到时，报一句说明怎么办的错误，不要只报 `MODULE_NOT_FOUND`。
   - 仓库里其他构建脚本（`apps/relay/scripts/build-relay.mjs`、`apps/distribution/src/*.mjs` 等）有同样写法的，一起改。
   - 测试：覆盖三种情况（pnpm 运行、`PNPM_HOME`、都没有）的入口解析，不需要真的构建。
2. **安装版保留 Supervisor 诊断**：
   - `fd1d905` 起，Supervisor 对每个请求记诊断（成功 `supervisor.read`，失败 `supervisor.read.failed`，超限 `supervisor.read.frame_too_large`），带操作名、传输方式、错误码、异常类名、字节数和耗时。但 Windows 安装版上，事后找不到这些记录，vivo 那次失败因此没法归因。
   - 先查清这些诊断现在去了哪里（Host 的 stderr、桌面程序有没有收集、有没有落到文件）。
   - 改成：安装版的 Host 把这几类诊断写到数据目录下的一个本地日志里，按大小轮转，总量有上限（例如几个 MiB），只写白名单字段，带时间。开发版的行为不变。
   - 现有的日志机制能用就用，不要另起一套。
   - 不记请求或响应的内容、路径、会话标题、令牌和设备身份。
   - 在 `docs/DEVELOPMENT.md` 的本地数据目录说明里加一句这个日志的位置。
   - 测试：轮转和上限；白名单以外的字段不会写进去。
3. **Relay 记录通道关闭的原因**：
   - 生产 Relay 在通道因违反流控（`flow_control_violation`）等原因被关闭时，把错误帧发给通道两端，但不写服务日志。所以 vivo 那次经 Relay 新建失败，事后查不出原因（`D:/Projects/Software/agenthub-archive/relay-deploy-e4bdd57-report.md`）。
   - 在 `apps/relay` 里，通道因任何原因关闭或失败时，记一条日志：事件名、原因码、通道里的角色、存活时长、已转发的块数和字节数。不记内容，不记设备或主机的标识（只用不透明的编号），不记路径。
   - 沿用 Relay 现有的日志方式；限速，避免客户端刷满日志。
   - 测试：几种关闭原因都有日志，而且日志里没有内容。
   - 这一项改的是 Relay 服务端，要到下一次部署才生效。**不要自己部署 Relay**，部署另外写提示词。

## 已知情况

- 第 1 项不改构建产物，只改找 pnpm 的方式。改完在 Windows 上实际跑一次 `pnpm desktop:sidecar`，确认没有回归。
- 第 2 项的数据目录：Windows 是 `%LOCALAPPDATA%\CodeTether`，macOS 是 `~/Library/Application Support/CodeTether`（`docs/DEVELOPMENT.md`）。
- 质量检查：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`。完整的 `pnpm test` 里 Relay 指纹限流用例（`apps/relay/test/relay-service.test.mjs:1164`）偶尔失败，单跑能过；遇到就重跑并在报告里记一笔。

## 边界

- **自己决定**：实现方式；日志的文件名、轮转的大小和份数；测试怎么写；提交怎么拆。
- **先问用户**：要改 Protocol v1、持久化（数据库）；要替换电脑上的正式安装版；改生产服务的配置。
- **不做**：读取或打印凭据；推送 `main`、合并、打标签；强制推送。

推送分支到 `origin`，不合并。

## 报告

写到 `D:/Projects/Software/agenthub-archive/maintenance-r1-report.md`：

- 第 1 项：改了哪些脚本，三种情况的测试结果，`pnpm desktop:sidecar` 的实跑结果；
- 第 2 项：诊断原来去了哪里，现在写到哪里，轮转的规则，一条脱敏后的样例记录；
- 第 3 项：记录哪些关闭原因，一条脱敏后的样例记录，限速的规则；
- 改动的提交和推送后的远端提交；
- 质量检查的结果，失败的原样贴出；
- 没做完的事和原因，以及在"完成"的哪一级。

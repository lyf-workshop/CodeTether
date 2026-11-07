# 任务：B1 修复，手机读取电脑内容返回 internal

在 Windows 上运行。这轮要改代码：分支从 `main` 开出，命名 `fix/b1-supervisor-internal`，工作区放 `D:/Projects/Software/agenthub-work/fix-b1-supervisor-internal`。依据：`D:/Projects/Software/agenthub-archive/t1a-report.md` 的"真机验收（vivo X60）"一节，`docs/DEVELOPMENT-PROCESS.md`（在 `origin/ux/design` 上，用 `git show` 读）。

开始前确认这份文件有 4 个二级标题，最后一节是"报告"。

## 目标

现象：vivo X60 登录、配对都成功（Windows 设备页出现 `V2046A`、`Android-arm64`），之后读取电脑内容，自动模式和"只走 Relay"都收到 Supervisor 的 `internal`，工作区加载不出来。T1a 之前在模拟器上对 B1 开发版加合成数据（单台机器）全部通过；这次对的是 Windows 上的安装版（`git-b668e53f2c79`）和真实数据（三台机器、一个真实 Codex 项目）。

要做到：

1. **定位**：用仓库里的 Supervisor 测试客户端或开发诊断页（`#/dev/supervisor-check`），不用手机，找出哪个操作返回 `internal`，以及 Host 里抛出的是什么异常。
2. **修复根因**。不改帧的形状，不改协议版本。
3. **让这类失败以后能定位**：Host 在失败时记录操作名、传输方式、错误码或异常类名、耗时，沿用现有的 `onDiagnostic` 机制。不记录请求或响应的内容、路径、会话标题。
4. **回归测试**：复现这个情况。根因如果是"某台机器不可达时整页读取失败"，测试就覆盖那种情况。
5. **验证**：对 Windows Host 的真实数据，用测试客户端经直连和经 Relay 把 B1 的读取操作各跑一遍（`host.bootstrap`、`machine.list`、`machine.get`、`project.list`、`project.get`、`conversation.list`、`conversation.get`、`conversation.history`、`attention.list`、变更读取），全部成功。

手机的复测要用户重新配对，用户暂时不想复配，这轮不做。完成后告诉用户，由用户决定何时复测。

## 已知情况

- **失败路径没有任何记录**：`packages/supervisor-transport/src/server.ts:645-659` 的 `catch` 把异常丢掉，只回一个 code。成功路径有 `onDiagnostic('supervisor.read')`，失败路径没有。所以 Host 日志和手机上都看不到原因。
- **错误被压成 `internal`**：`supervisorReadErrorCode`（`server.ts:803`）只认六个码名，加上 `runtime_unavailable`、`provider_unavailable`，其余一律 `internal`，包括 Host 已有的 `machine_unreachable`、`machine_connection_failed`、`project_unavailable`。
- **首要怀疑**：Windows Host 里有三台机器（本机加两台经 Node 的），其中的远程设备可能不在线。某个读取操作碰到不可达的远程机器，异常被压成 `internal`，整页读取失败。这是怀疑，不是结论。
- **已排除的网络层**：手机到控制服务 443、Relay 8443、Windows 4318 的 TCP 可达；Windows 到 Relay 的 TLS 1.3 正常；Host 持有已收到 `supervisor.ready(role=host)` 的 Relay 连接；本机 HTTP 的三台机器详情 GET 都成功。
- **另一个已知缺口**：单条过大的历史记录会让服务端返回 `internal`（机器连接帧上限 16 KiB，T1a 报告的"后端缺口"）。如果这次是它，一并处理，或者明确记下。
- **和 B4 的关系**：B4 的设计（`docs/ux-redesign/08-remote-management.md` §3.2）打算把错误原因放进失败响应的 `data.reason`。这轮不做，只做 Host 端的记录，线上帧不变。修复的方式要和 §3.2 的映射思路兼容。
- **冻结边界**：Protocol v1、持久化、Rust 核心里 `Response` 的结构（`deny_unknown_fields`）不变。
- **测试数据**：Windows 安装版已更新到 `b668e53`。测试用的独立项目在 `D:/Projects/Software/agenthub-archive/t1a-vivo-x60-scratch-20261106-e2945b18`。
- **质量检查**：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`。完整的 `pnpm test` 里 Relay 指纹限流用例（`apps/relay/test/relay-service.test.mjs:1164`）偶尔失败，单跑能过；遇到就重跑并在报告里记一笔。

## 边界

- **自己决定**：诊断的方法；修复方式；日志记什么；测试怎么写；提交怎么拆；构建环境问题。
- **先问用户**：
  - 需要用户在手机或 Windows 上本人操作；
  - 要改帧的形状或协议版本；
  - 用修复后的构建替换 Windows 上的正式安装版（要在真实数据上验证时，优先用只读的数据副本和独立实例，不动正式数据目录）；
  - 改生产服务的配置；
  - 推送 `main`、打标签。
- **不做**：
  - 读取或打印凭据，日志和报告里不出现令牌、密钥、连接串；
  - 动正式安装版的数据目录和 Mac 上的正式服务；
  - 强制推送、改写已推送的历史。

分支推送到 `origin`，不合并到 `main`，审核通过后由用户决定。

## 报告

写到 `D:/Projects/Software/agenthub-archive/b1-supervisor-internal-report.md`：

- 根因和证据：哪个操作、什么异常、为什么手机上看到的是 `internal`；
- 改动的提交和推送后的远端提交；
- 质量检查的结果，失败的原样贴出；
- 测试客户端对真实数据的验证结果，直连和 Relay 各一份；
- 没做完的事和原因，以及在"完成"的哪一级。

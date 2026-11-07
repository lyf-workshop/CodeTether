# 任务：B1 修复，Supervisor 响应超过帧上限时返回 internal

在 Windows 上运行。这轮要改代码：分支从 `main` 开出，命名 `fix/b1-supervisor-internal`，工作区放 `D:/Projects/Software/agenthub-work/fix-b1-supervisor-internal`。依据：`D:/Projects/Software/agenthub-archive/t1a-report.md` 的"真机验收（vivo X60）"一节、Mac 上 `~/agenthub-archive/i1-report.md` 的 iPad 真机结果（要点抄在"已知情况"里）、`docs/DEVELOPMENT-PROCESS.md`（在 `origin/ux/design` 上，用 `git show` 读）。

如果你已经按这份提示词的上一版开始了，读完这一版，按新的目标和已知情况继续，不用从头来。

开始前确认这份文件有 4 个二级标题，最后一节是"报告"。

## 目标

现象：安卓（vivo X60 连 Windows）和 iPad（连 Mac）都已登录、配对成功，但读取电脑内容时，自动模式和"只走 Relay"都收到 Supervisor 的 `internal`，工作区加载不出来。之前的模拟器验收只用单台机器的合成数据，全部通过；这次对的是真实数据。

iPad 那边已经定位到一处：Mac 上 `machine.get` 的响应按 Supervisor 的投影算约 17,148 字节，超过实际 16,384 字节的帧上限，发送失败被压成 `internal`。Windows 上有三台机器和真实的 Codex 项目，很可能是同一个原因，但要你自己确认。

要做到：

1. **确认根因**：对 Windows Host 的真实数据，用仓库里的 Supervisor 测试客户端或开发诊断页（`#/dev/supervisor-check`），不用手机，找出哪些读取操作返回 `internal`，以及原因。不只看 `machine.get`。
2. **所有读取响应放进帧里**：Supervisor 返回给设备的每个读取操作的响应，都要放得进 16 KiB 的帧。真实数据再大也不能因为超限而失败。至少覆盖 `host.bootstrap`、`machine.list`、`machine.get`、`project.list`、`project.get`、`conversation.list`、`conversation.get`、`conversation.history`、`conversation.recent`、`attention.list` 和变更读取。
3. **超限时能看出来**：Host 在发送前就能发现响应会超限。这时通过现有的 `onDiagnostic` 记一条，带操作名、传输方式、字节数，不带内容。其他失败也一样记操作名、传输方式、错误码或异常类名、耗时，不记请求和响应的内容、路径、会话标题。
4. **回归测试**：用足够大的数据（多个 AI 工具、多个安装位置、多台机器、很长的标题和路径）覆盖第 2 项的每个操作，断言响应在帧上限内，并且客户端要的字段还在。
5. **验证**：对 Windows Host 的真实数据，用测试客户端经直连和经 Relay 把第 2 项的操作各跑一遍，全部成功。

手机和 iPad 的复测要更新 Mac 和 Windows 的安装版，这轮不做。完成后告诉用户。

## 已知情况

- **实际的帧上限是 16 KiB**：
  - `packages/supervisor-transport/src/server.ts:9` 用的是 `@codetether/machine-transport` 的 `FramedMachineConnection`，它的上限是 `machineTransportLimits.maximumFrameBytes`，16 KiB（`packages/machine-transport/src/constants.ts`）。
  - `supervisorTransportLimits.maximumFrameBytes` 写的是 256 KiB（`packages/supervisor-transport/src/constants.ts:12`），但不是线上真正生效的值。
  - 手机和平板的 Rust 核心读帧也按 16 KiB（`packages/supervisor-mobile/src/wire.rs:13`、`:373`）。
  - 已经装到设备上的安卓和 iPad 应用都是这个核心，所以**不提高帧上限**，在 Host 这边把响应收小。
- **`machine.get` 没有限制大小**：`apps/host/src/api/supervisor-transport-manager.ts:273-287` 把本机 `getMachine` 的 `machine`、`providers`、`providerLifecycles`、`connection`、`providerDiscovery`、`relay` 原样转出去。对比之下，`conversation.recent` 和 `attention.list` 用了 `boundedRows`（`apps/host/src/api/supervisor-operations.ts:20-97`，12 KiB）。
- **发送失败被压成 `internal`**：响应在 `try` 里发送，帧超限时 `FramedMachineConnection` 抛错，`catch`（`server.ts:645-659`）用 `supervisorReadErrorCode`（`server.ts:803`）把它归成 `internal`，再发一个很小的失败帧，这个能发出去。失败路径没有诊断，所以 Host 日志和设备上都看不到原因。
- **谁在读这些响应**：
  - 安卓 `apps/android/app/src/main/java/org/codetether/app/remote/RemoteSupervisor.kt`（`machine.get` 在 :70、:193、:293）；
  - iPad `apps/ios/Sources/CodeTether/SupervisorClient.swift`（在 `origin/i1/ipad-app` 上，`machine.get` 在 :217、:579、:674）；
  - 桌面经 `apps/web/src/runtime/account/remote-supervisor.ts` 远程读另一台电脑，走的是同一个 Supervisor 传输，所以电脑之间远程读取也会碰到这个上限；
  - 开发诊断页 `apps/web/src/dev/supervisor-check-model.ts`。
- **收小的规则**：
  - 先查清这几个客户端实际用到 `machine.get` 等响应的哪些字段。客户端用到的字段和含义不能变，客户端没用到的字段可以不发。
  - 数组要有上限。
  - 还放不下时，按固定顺序截断，并让客户端看得出被截断了（`data` 里加字段是兼容的，安卓用 `org.json`、iOS 和 Rust 核心对 `data` 都不检查多出来的字段）。
  - 列表沿用 `boundedRows` 的思路，在截断处给续读的游标。
  - 具体怎么收由你定，报告里写清楚每个操作的规则。
- **另一个已知缺口**：单条过大的历史记录或事件也会超限，同样返回 `internal`（T1a 报告的"后端缺口"）。`conversation.history` 在第 2 项里，一起处理：单条放不下时截断这一条的内容并标出来，不能让整页失败。
- **其他失败原因**：Windows Host 有三台机器，其中经 Node 连的远程设备可能不在线；iPad 也看到另一台电脑报 `computer_unavailable`，原因没查。确认帧超限是主因后，顺带看一下有没有"一台机器不可达导致整页读取失败"的情况，有就一起修，没有就在报告里写明。
- **已排除的网络层**：手机到控制服务 443、Relay 8443、Windows 4318 的 TCP 可达；Windows 到 Relay 的 TLS 1.3 正常；Host 持有已收到 `supervisor.ready(role=host)` 的 Relay 连接；本机 HTTP 的三台机器详情 GET 都成功。
- **和 B4 的关系**：B4 的设计（`docs/ux-redesign/08-remote-management.md` §3.2）打算把错误原因放进失败响应的 `data.reason`。这轮不做，线上的失败帧不变，只做 Host 端的诊断。§3.6 的帧预算以这轮的规则为准，报告里写清楚。
- **冻结边界**：Protocol v1、持久化、帧的形状、Rust 核心里 `Response` 的结构（`deny_unknown_fields`）不变；不改安卓、iOS 的代码。
- **测试数据**：Windows 安装版是 `git-b668e53f2c79`。测试用的独立项目在 `D:/Projects/Software/agenthub-archive/t1a-vivo-x60-scratch-20261106-e2945b18`。
- **质量检查**：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`。完整的 `pnpm test` 里 Relay 指纹限流用例（`apps/relay/test/relay-service.test.mjs:1164`）偶尔失败，单跑能过；遇到就重跑并在报告里记一笔。

## 边界

- **自己决定**：诊断的方法；收小的规则和实现；诊断记什么；测试怎么写；提交怎么拆；构建环境问题。
- **先问用户**：
  - 需要用户在手机、iPad 或 Windows 上本人操作；
  - 要改帧的形状、协议版本、帧上限，或者要改安卓、iOS、Rust 核心的代码；
  - 删掉某个客户端正在用的字段；
  - 用修复后的构建替换 Windows 上的正式安装版（要在真实数据上验证时，优先用数据副本和独立实例，不动正式数据目录）；
  - 改生产服务的配置；
  - 推送 `main`、打标签。
- **不做**：
  - 读取或打印凭据，日志和报告里不出现令牌、密钥、连接串；
  - 动正式安装版的数据目录和 Mac 上的正式服务；
  - 强制推送、改写已推送的历史。

分支推送到 `origin`，不合并到 `main`，审核通过后由用户决定。

## 报告

写到 `D:/Projects/Software/agenthub-archive/b1-supervisor-internal-report.md`：

- 根因和证据：哪些操作超限、真实数据下各多少字节，有没有其他原因；
- 每个操作的收小规则，以及哪个客户端用到哪些字段；
- 改动的提交和推送后的远端提交；
- 质量检查的结果，失败的原样贴出；
- 测试客户端对真实数据的验证结果，直连和 Relay 各一份，带每个操作的响应字节数；
- 没做完的事和原因，以及在"完成"的哪一级。

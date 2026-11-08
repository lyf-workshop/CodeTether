# 任务：B4a 远程管理第一轮（错误原因、项目、会话整理、项目内搜索）

在 Windows 上运行。这轮要改代码：从 `origin/main` 开出分支 `feat/b4a-remote-organization`；`main` 还没快进到 `e4bdd57` 的话，就从 `e4bdd57` 开出。工作区放 `D:/Projects/Software/agenthub-work/feat-b4a-remote-organization`。

依据：`docs/ux-redesign/08-remote-management.md`（B4 的设计），以及 `docs/DEVELOPMENT-PROCESS.md`（都在 `origin/ux/design` 上，用 `git show` 读）。08 里的行号以 `main` 的 `b668e53` 为准，`fd1d905` 之后有变动的以实际代码为准。

开始前确认这份文件有 4 个二级标题，最后一节是"报告"。

## 目标

B4 分三轮做（08 §7）。这一轮只做后端和 Rust 核心，不做平板和 iPad 的界面（那是 T1b 和 I1 的事）。

要做的，具体规则都在 08 里：

1. **失败响应带原因**（08 §3.2）：失败响应的 `data` 里带 `reason`，取 `HostErrorCode`；`code` 按 Host 错误码归类，照 §3.2 的映射表；通用码时回退到 `failure.reason`。这套映射单独放一处，B3 的发送失败以后也用它（§3.2 最后一条）。线上帧的字段不变。
2. **会话列表**（08 §3.1 末尾）：`conversation.list` 每一项加 `pinnedAt`，新增可选的 `archived` 过滤，**默认 `all`**（已装的安卓版依赖这个默认值）；排序改成置顶在前、按置顶时间倒序，其余按最近活动倒序。
3. **新的远程操作**（08 §3.1 的表，这一轮只做下面六个）：
   - `project.create`、`project.remove`；
   - `conversation.pin`、`conversation.rename`、`conversation.restore`；
   - `conversation.search`。
   - 请求和返回的字段、actionId 的作用域、权限都照 §3.1。
   - **权限**：`conversation.search` 只要查看权限（08 §6 第 3 项按建议）；其余五个要控制权限。
4. **重发安全**（08 §3.1 的"没收到结果时怎么办"）：每个写操作再执行一次都安全，结果照那一节。`conversation.restore` 对未归档的会话要返回成功和当前会话；本机接口如果报错，在 Supervisor 这一层处理，不改本机接口。
5. **帧大小**（08 §3.6）：这一轮新增和改动的每个操作，响应都放得进 16 KiB 的帧；列表和搜索在截断处给续读的游标。另外，`fd1d905` 的发送前检查跳过了写操作（`docs/reviews/fix-b1-supervisor-internal.md` 的建议改第 1 项），这一轮让写操作也做同样的检查和诊断。
6. **Rust 核心**（08 §3.8）：`packages/supervisor-mobile/src/wire.rs` 的 `Operation` 加上这六个操作和 `conversation.list` 的 `archived` 字段，UniFFI 接口暴露对应的方法；`MobileError::Failure` 能带出 `data.reason`。返回的 `data` 仍然不在 Rust 里解释。
7. **验收**（08 §4 里和这一轮有关的项）：权限、添加和移除、置顶重命名恢复、搜索、错误映射、帧大小、重发。用测试客户端或开发诊断页，经直连和 Relay 各跑一遍，不依赖平板界面。

**不在这一轮**：`folder.list` 和电脑上的浏览入口（B4b）；查找和导入以前的会话（B4c）；平板和 iPad 的界面。

## 已知情况

- **现在的代码**：B1 的远程操作在 `packages/supervisor-transport/src/protocol.ts` 的 `supervisorB1OperationSchema`，执行在 `apps/host/src/api/supervisor-operations.ts`；控制权限的判断在 `server.ts` 的 `isSupervisorControlOperation`。`fd1d905` 把读取的帧预算放在 `apps/host/src/supervisor-read-budget.ts`，沿用它。
- **兼容**：已装的安卓应用和 iPad 应用用旧的 Rust 核心。帧的字段不能变，`data` 里加字段可以。旧核心发不出新操作和新字段，这是预期的。
- **本机已有的实现**：项目的增删、置顶、重命名、恢复、搜索在本机都有，08 §2 列了函数和位置，复用它们。
- **测试数据**：不要在 Windows 的正式安装版上做写操作。用独立数据目录和独立端口的 Host 实例，加上隔离的 Relay，和之前两个修复任务的做法一样（`D:/Projects/Software/agenthub-archive/b1-supervisor-internal-report.md`）。
- **规模**：这一轮预计超过 30 个文件。超过约 3000 行（不算测试）时，先做 1、2、5、6 加上 `conversation.pin`、`rename`、`restore` 并推送，再做 `project.create`、`project.remove`、`conversation.search`，报告里说明。
- **质量检查**：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`，加上 `packages/supervisor-mobile` 的 `cargo test`，以及安卓 Gradle 门禁（Rust 核心改了，安卓要能编过）。完整的 `pnpm test` 里 Relay 指纹限流用例偶尔失败，单跑能过；遇到就重跑并在报告里记一笔。

## 边界

- **自己决定**：实现方式；测试怎么写；提交怎么拆；08 里没写清楚的细节，选和本机行为一致的做法，并在报告里写明。
- **先问用户**：
  - 08 的规则和代码实际情况冲突，或者照 08 做会破坏已装的客户端；
  - 要改帧的形状、协议版本、帧上限，或者加数据库迁移；
  - 要改平板或 iPad 的界面代码；
  - 动电脑上的正式安装版；改生产服务的配置。
- **不做**：读取或打印凭据；推送 `main`、合并、打标签；强制推送。

推送分支到 `origin`，不合并。

## 报告

写到 `D:/Projects/Software/agenthub-archive/b4a-report.md`：

- 1 到 7 每一项改了什么、对应的提交，推送后的远端提交；
- 错误映射的最终表，和 08 §3.2 不一样的地方及原因；
- 每个操作的帧预算规则；
- 08 和代码不一致、你按本机行为处理的地方；
- 质量检查的结果，失败的原样贴出；
- 直连和 Relay 的验证结果；
- 没做完的事和原因，以及在"完成"的哪一级。

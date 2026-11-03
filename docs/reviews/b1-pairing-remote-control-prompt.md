# 任务：B1 配对和远程控制

在这台 Windows 电脑上运行。设计在 `docs/ux-redesign/06-pairing-remote-control.md`，依据 03 §1.1 和 §4 的 B1、04 的 A3–A6。

开始前确认这份文件有 4 个二级标题，最后一节是“报告”。

## 目标

按 06 实现：

1. 配对码配对（06 §3.1）：电脑上“添加设备 › 添加手机或平板”显示 6 位码，新设备输入后配对成功，电脑上自动用 Host 密钥签名。
2. 只有一种权限（§3.2）：新授权是 `supervisor_control`，包含读；删掉本机的 `/api/v1/supervisor/control/approve` 和 `host_supervisor_control` 这条路。
3. 自动续期和补签（§3.3）。
4. 移除后立刻断开（§3.4），包括控制服务新增的、由 Host 签名的撤销接口。
5. Relay 自动配置（§3.5）。
6. 新增远程操作（§3.6）。门控、幂等和 409 和本机一致。
7. 设备页的“手机和平板”一节和添加设备窗口（§1），以及设备平台的修正（§3.7）。
8. 开发诊断页 `#/dev/supervisor-check` 加“输入配对码”，用来当新设备测试。

做完部署到 us-vps-01：控制服务和迁移 0009。B0 的报告里有部署方式和回退方法（`D:/Projects/Software/agenthub-archive/b0-report.md`），这次照着做。

工作区和分支：从 `main` 新建，比如分支 `b1/pairing-remote-control`，工作区 `D:/Projects/Software/agenthub-b1-pairing`。怎么拆提交、要不要推送，由你决定。

## 已知情况

- 控制服务不签任何东西。授权和 grant 都由 Host 密钥签名，网页通过 Tauri `host_identity_key_sign` 来签（`apps/web/src/runtime/account/control-plane-client.ts:822-856`、`remote-supervisor.ts:352-388`）。新流程沿用这一点。
- 数据库 CHECK 只允许 `supervisor_read`（迁移 0001:185、0007）。控制服务的 schema 也把 scope 写死了（`host-identity-service.ts:125`、`:924`、`:1285`）。
- Host 判断能不能控制，现在只看本机表（`supervisor-transport-manager.ts:296-298`），连接时不看 grant 里的 scope（`packages/supervisor-transport/src/server.ts:667-677`）。
- 有效期常量 `AUTHORIZATION_LIFETIME_MS`（`host-identity-service.ts:143`），现在没有续期。
- 每 60 秒的清理循环在 `local-supervisor-presence.tsx:23`，`activations/prune` 会关掉连接（`server.ts:286-293`）。续期和补签放在这个循环里。
- 本机可以复用的函数都在 `apps/host/src/api/host-service.ts`：`archiveConversation`:3137、`interruptTurn`:4167、`resolveApproval`:4278、`resolveAttention`、`listAttention`:3186。
- Node 配对码的生成和常量可以复用（`packages/machine-transport/src/pairing-code.ts`、`constants.ts:31-33`）。校验要放在控制服务、存在 Postgres 里，见 06 §3.1。
- Relay 的值见 06 §3.5，照 `host_supervisor.rs:265-271` 传控制服务地址的做法传给 Host。要确认 `build.rs` 在这几个变量变化时会重新编译。
- 桌面版的平台写死在 `control-plane-client.ts:396-402`。
- Windows 和 Mac 现有的只读授权都已经过期，不用迁移，留着当历史记录。
- 开发版和安装版都用 4317 端口。用开发版测试时先退出安装版，并用独立的数据目录。

## 注意事项

- 凭据（数据库连接串、Supabase 密钥、私钥）不打印，也不进仓库和报告。
- 部署前备份 `control_plane` schema，并写清回退方法。0009 只放开 CHECK、新增配对会话表，回退时切回旧代码，表留着。
- 配对码不明文存储；失败次数限制、单次使用和过期都由服务端判断，并写测试覆盖。
- 删掉旧的授予接口以后，要确认网页里没有别的地方还在调用它。
- 门禁：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`，加上 desktop 的 `cargo test`。
- 界面文案按 06 §1，不出现内部名词。

## 报告

写到 `D:/Projects/Software/agenthub-archive/b1-report.md`。很长的输出放到 `b1-logs/`。

报告内容：

- 每项目标做了什么；
- 迁移和部署的过程、备份的位置、回退方法；
- 06 §4 每一项验收的结果，Windows 这边能做的都做；Mac 那一步列出需要的操作，我另写提示词；
- 分支和提交列表；
- 没做完的事和原因；
- 实现中和 06 不一样的地方，以及为什么不一样。

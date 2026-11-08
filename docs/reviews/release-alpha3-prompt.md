# 任务：发布 v0.1.0-alpha.3

主要在 Windows 上运行；iOS 的构建和测试由 Mac 做（见"目标"第 3 项）。依据：`docs/DEVELOPMENT-PROCESS.md` 的 §3 和 §7（在 `origin/ux/design` 上，用 `git show` 读）。

开始前确认这份文件有 4 个二级标题，最后一节是"报告"。

## 目标

用户已经在真机上验收通过。把这一轮的修复和 iPad 应用合进 `main`，打 `v0.1.0-alpha.3` 标签，两台电脑的安装版换成这个标签的构建。

要合进去的（都已审核通过）：

- 一条线性的提交链：`main`（`b668e53`）→ `fd1d905`（Supervisor 帧预算）→ `e4bdd57`（Relay 确认竞态）→ `fix/android-retry-explicit-failure` → `fix/t1a-tablet-fidelity`。后一个都是在前一个的基础上开的，可以直接快进。
- `i1/ipad-app`：从更早的 `f290602` 分出来，`main` 上有 3 个它没有的安卓提交。这个分支已经推送，不能变基，用合并提交合进来。它改了 `packages/supervisor-mobile`，安卓也用这个 Rust 核心。

要做到：

1. **发布分支**：从 `fix/t1a-tablet-fidelity` 的最新提交开出 `release/v0.1.0-alpha.3`，再把 `i1/ipad-app` 合进来（合并提交）。冲突只在预期的地方（安卓和 iOS 共用的 Rust 核心、文档）时自己解决，并在报告里写清楚怎么解决的。
2. **版本号和更新记录**：
   - 根 `package.json` 的版本现在写的是 `0.1.0-alpha.0`，但已经有 `v0.1.0-alpha.1`、`v0.1.0-alpha.2` 两个标签。先查清前两次发布是怎么处理版本号的，照同样的做法；查不清就问用户。
   - 新建 `CHANGELOG.md`，写 `v0.1.0-alpha.3` 这一版：用户能感受到的变化（平板和 iPad 能读取和操作电脑、经 Relay 新建会话不再卡住、平板界面按设计修正等），中文，不写内部代号。
3. **质量检查**：在发布分支上跑 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`；安卓 Gradle 门禁 `testDebugUnitTest lint assembleDebug assembleDebugAndroidTest`；`packages/supervisor-mobile` 的 `cargo test`。推送发布分支，然后告诉用户：Mac 上要用同一个提交跑 iOS 的单元测试和构建（`apps/ios/Scripts/test.sh`、`build.sh device`），由用户转给 Mac。
4. **合进 main 和打标签**：Mac 的 iOS 检查通过、用户同意后，把 `main` 快进到发布分支，推送 `main`；打附注标签 `v0.1.0-alpha.3`，推送标签。
5. **安装版**：
   - Windows：照 `docs/reviews/windows-install-update-prompt.md` 的做法，把安装版换成标签的构建。目标提交改成标签对应的提交，其余不变。
   - Mac：告诉用户，照 `docs/reviews/mac-install-update-prompt.md` 的做法换成标签的构建，由用户转给 Mac。
   - 安卓：用标签构建 debug APK，记下 SHA-256。装到平板之前先问用户。
6. **删掉已合并的分支和工作区**：`main` 推送成功后，已经合并的修复分支和它们的工作区按流程删除。删除远端分支之前，列出来请用户确认。

## 已知情况

- 构建环境和安装的坑都记在之前的报告里：Windows 的在 `D:/Projects/Software/agenthub-archive/windows-install-fd1d905-report.md`，Mac 的在 `~/agenthub-archive/mac-install-b1-report.md`。
- 两台电脑现在装的是 `fd1d905`。这一轮的合并没有数据库迁移的话，换成标签构建可以回退。合并后先确认有没有新迁移，有就在报告里写明，并照安装提示词做好备份。
- 完整的 `pnpm test` 里 Relay 指纹限流用例（`apps/relay/test/relay-service.test.mjs:1164`）偶尔失败，单跑能过；遇到就重跑并在报告里记一笔。
- 生产 Relay 已经是 `e4bdd57`，这次发布不用重新部署 Relay。合并后如果 `apps/relay` 有新的改动，告诉用户，不要自己部署。
- `docs/` 下的文档以 `ux/design` 分支为准，ROADMAP 由设计那边更新，这次发布不合并 `ux/design`。

## 边界

- **自己决定**：合并和冲突的处理（限于预期的地方）；版本号的改法（照前两次的做法）；CHANGELOG 的写法；构建和安装的做法。
- **先问用户**：
  - 推送 `main`、打标签、推送标签；
  - 冲突出现在预期以外的地方，或者需要改代码才能通过检查；
  - 版本号的做法查不清；
  - 删除远端分支；
  - 把新构建装到平板或 iPad 上。
- **不做**：强制推送、变基已推送的分支、改写历史；读取或打印凭据；部署 Relay 或控制服务。

## 报告

写到 `D:/Projects/Software/agenthub-archive/release-v0.1.0-alpha.3-report.md`：

- 发布分支的提交，合并时的冲突和解决办法；
- 版本号的做法和依据；CHANGELOG 的内容；
- 各项质量检查的结果，失败的原样贴出；Mac 的 iOS 检查结果（用户转回来的）；
- `main` 和标签推送后的远端提交；
- Windows 安装版更新前后的 build id；安卓 APK 的 SHA-256；
- 删除了哪些分支和工作区；
- 没做完的事和原因。

# 任务：I1 iPad 真机验收

在 Mac 上运行。这轮只验收，不改仓库代码，不提交。

依据：`docs/reviews/i1-ipad-app-prompt.md`、`docs/reviews/i1-fix-prompt-r1.md`、`docs/reviews/i1-fix-prompt-r2.md`（在 `origin/ux/design` 上，用 `git show` 读）。

开始前确认这份文件有 4 个二级标题，最后一节是"报告"。

## 目标

让 iPad 应用在真机上连上 Mac 上的 CodeTether，直连和经 Relay 都通，并逐项验收。验收的提交是 `origin/i1/ipad-app` 的 `90cd7f5`，它包含 r1 的修复（`82a1aff`）、r2 的修复（`7fbff25`）和真机构建用的 `Info.plist`。分支最新提交如果不是它，先告诉用户。

前置条件由你自己搞定：

1. iPad 已连上 Mac（`xcrun devicectl list devices`），开发者模式和信任已开，系统版本不低于 `apps/ios/project.yml` 的 `deploymentTarget`（现在是 16.0）。
2. Mac 上的安装版是 `origin/main` 的构建，即 build id 不是 `git-111f1b08e5f3`。不是的话，按 `docs/reviews/mac-install-b1-prompt.md` 先换。
3. 从分支构建 iPad 应用，用免费 Apple ID（Personal Team）签名，装到 iPad 并启动。

验收清单，每项记"通过"，或"失败"加现象和错误：

1. **启动和权限**：应用能启动；iPadOS 第一次访问本地网络时弹权限窗口，点"好"。
2. **登录和配对**：用邮箱验证码登录同一个账号，没有设备身份时勾选"注册为新设备"；用 Mac 上"添加设备 › 添加手机或平板"的 6 位码配对。Mac 设备页"手机和平板"里出现这台 iPad，名称和平台（`iPadOS-arm64`）正确。
3. **直连**（设置 › 连接检查 选"自动"）：
   - 最近的会话能刷新，能看到几台设备和各自的项目；
   - 已有会话的历史和实时更新；回复；
   - 新建会话（项目、AI 工具、推理强度只有 Claude Code）并能看到回复；
   - 变更面板的文件列表和逐行 diff；
   - 待处理里批准、拒绝、处理完成；
   - 归档、恢复、按标题搜索、设备列表、项目列表。
4. **经 Relay**（选"只走 Relay"）：重复 3 的全部项目。Mac 断网或退出应用时，iPad 仍连得上 Relay 并看到电脑离线；Mac 恢复后，iPad 经 Relay 继续操作。
5. **被移除**：Mac 保持一条已连接的会话，在 Mac 设备页移除这台 iPad。记下几秒断开、iPad 再连时的错误、Mac 上正在运行的工作是否继续；iPad 显示"被移除"页并说明怎么重新配对。
6. **重新配对**：用新配对码再配一次，能连上；最后在 Mac 上移除，不留测试授权。
7. **外观和布局**：
   - 横屏、竖屏下侧栏、变更面板、表单窗口按设计显示；
   - 浅色、深色、跟随系统；
   - 外接键盘：⌘N 新建会话，⌘K 搜索，⌘↩ 发送，Esc 关闭；按住 ⌘ 时系统的快捷键列表里能看到它们。

电脑上准备一个能实际执行的测试项目，用真实的 Codex 或 Claude Code。这样能测出真实的 diff 和文字增量，Android 那轮只用了合成夹具。

## 已知情况

- **Mac**：测试用 Mac 上的安装版，数据目录是真实的 `~/Library/Application Support/CodeTether`，里面有真实的项目。不要改用开发版：开发版的网页来源 `http://127.0.0.1:5173` 要用户通过 SSH 临时改生产控制服务的来源配置，之前几次因为 SSH 超时没成功，是否这样做由用户决定。
- **控制服务的来源名单**：它只管浏览器的跨域检查（`apps/control-plane/src/server.ts`），没有 `Origin` 头的请求不会被拦。打包后的桌面应用的来源控制服务已经允许，iPad 应用是原生程序、不设 `Origin` 头，所以这轮不需要放开任何来源。
- **iPad 构建**：
  - 仓库的构建入口是 `bash apps/ios/Scripts/build.sh device`（见 `apps/ios/README.md`）。它需要 `~/agenthub-work/i1-node-26.4.0` 的官方 Node、Rust 的 iOS 目标和 XcodeGen，模拟器那轮已经装好。
  - 登录配置由脚本直接读 `~/agenthub-work/v4-build.env`（`VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`、`VITE_CODETETHER_CONTROL_PLANE_URL`，以及可选的三项 Relay 配置），写进 `apps/ios/Config/Local.xcconfig`，再由 `Info.plist` 嵌进应用。脚本用干净的环境启动，shell 里导出的变量传不进去。控制服务地址的主机名应是 `api.codetether.org`。
  - 脚本结束会打印 `optional Relay settings: absent` 或 `complete`。是 `absent` 时，先看应用的"只走 Relay"能不能用。不能用的话，需要用户在 `v4-build.env` 里补三项 Relay 配置，不要自己编这三个值。
  - 脚本默认不签名（`CODE_SIGNING_ALLOWED=NO`），也不传 `DEVELOPMENT_TEAM` 和 `-allowProvisioningUpdates`。免费账号怎么走通签名，由你决定：脚本的环境变量 `CODETETHER_IOS_CODE_SIGNING_ALLOWED`、`CODETETHER_IOS_CODE_SIGN_IDENTITY`，`xcodebuild` 自带团队 ID，或在 Xcode 里打开生成的 `apps/ios/CodeTether.xcodeproj` 选 Personal Team。团队 ID 只放在本机命令行或 Xcode 里，不写进仓库。
  - 免费账号：每个 Bundle ID（`org.codetether.app`）最多绑 3 台设备，安装 7 天后过期；iPad 上要先在 设置 › 通用 › VPN 与设备管理 里信任开发者证书，否则应用打不开；之前装过同 Bundle ID 的版本先删掉。
- **本地网络权限**：`Info.plist` 里有 `NSLocalNetworkUsageDescription`，没有 `NSBonjourServices`；直连用的是地址，不是 Bonjour 发现，通常用不上。弹窗在第一次访问局域网地址时出现，只走了 Relay 就不会弹。
- **预期问题**：
  - 配对成功后，iPad 这边 `readClaim` 可能只返回 `sessionView`，没有授权对象，要等目录里出现可用的控制授权。
  - 控制服务返回 401 时，应用会刷新一次，还被拒绝才回登录页。
  - 单条历史记录太大时，服务端可能返回 `internal`，应用会减半重试。还不行就记下来，这是后端的缺口。
- 日志脱敏时保留 `[codetether:` 开头的报错行。

## 边界

- **自己决定**：构建、签名、安装的做法和命令；构建环境问题（工具装在 `~/agenthub-work` 下、只对当次有效的环境变量）；失败后的诊断和重试；验收中遇到的问题记进报告，继续验收其余项。
- **先问用户**：
  - 需要用户本人操作：邮箱验证码、iPad 上的信任和弹窗、Xcode 里登录 Apple ID、系统设置里的授权；
  - 要改仓库代码才能继续；
  - 删除或覆盖用户数据，杀掉不是你启动的进程；
  - 改生产服务的配置（控制服务来源名单、Relay、服务器），包括通过 SSH；
  - 只有付费开发者账号才能解决的签名问题。
- **不做**：
  - 读 `.secrets/`、其他 `.env`、凭据文件、`~/.codex/auth.json`、`~/.claude.json`，`v4-build.env` 只由构建脚本读取，不打印；
  - 动正式的 `com.codetether.node` 服务和它的数据目录，直接读写安装版的数据库；
  - 提交、推送、打标签。

写操作只用用户准备的测试目标。

## 报告

追加到 `~/agenthub-archive/i1-report.md`，新开一节"真机验收"：

- iPad 型号、系统版本、UDID（脱敏后 8 位就够）；验收的提交；
- 构建和安装过程：Bundle ID、签名用的方式、Relay 配置是 `absent` 还是 `complete`、遇到的问题和你怎么解决的；
- Mac 安装版的 build id，项目和 AI 工具是什么；
- 本地网络权限有没有正常弹窗；
- 验收清单 1 到 7 每一项的结果；
- 被移除的断开秒数和再连时的错误；
- 外观和布局的截图（横屏、竖屏、浅色、深色各一张，只截 iPad 屏幕）；
- 控制服务有没有拒绝过 iPad 的请求（状态码）；
- 没做完的事和原因。

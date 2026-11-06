# 任务：I1 iPad 真机验收

在 Mac 上运行，验收范围和 I1 实现一样：iPad 应用的登录、配对、最近的会话、待处理、会话、新建会话、变更、归档、设备、项目、设置；直连和经 Relay 都通。这轮只做验收，不改代码。

依据：`docs/reviews/i1-ipad-app-prompt.md`、`docs/reviews/i1-fix-prompt-r1.md`、`docs/reviews/i1-fix-prompt-r2.md`（在 `origin/ux/design` 上，用 `git show` 读）；设计文件在 `origin/ux/design`。

开始前确认这份文件有 4 个二级标题，最后一节是"报告"。

## 目标

按顺序验收。代码在 `origin/i1/ipad-app`，验收的提交是 `90cd7f5`：它包含 r1 的修复（`82a1aff`）、r2 的修复（`7fbff25`），以及真机构建要用的登录配置嵌入（`90cd7f5` 新增 `apps/ios/Config/Info.plist`）。`git fetch` 以后如果这个分支的最新提交不是 `90cd7f5`，停下来告诉用户，等用户回复。

1. **iPad 连上 Mac**：
   - 用 `xcrun devicectl list devices` 确认 iPad 已连上，能看到型号、系统版本、UDID。记下版本号，项目最低版本要不高于它。
   - iPad 上已经开发者模式（设置 › 隐私与安全性 › 开发者模式），Mac 上信任了这台设备。
2. **从分支构建并安装**：
   - `git fetch origin`，在一个新的独立工作区里检出 `90cd7f5`，例如 `~/agenthub-work/i1-acceptance`，不动 Mac 已有的工作区和未提交的改动。
   - 如果已经有 `~/agenthub-archive/i1-report.md`，读一下模拟器验收的结果，记下哪些测试通过、哪些要在真机上重点看。没有就跳过。
   - 确认 `apps/ios/project.yml` 里的 `deploymentTarget` 和 `IPHONEOS_DEPLOYMENT_TARGET`（现在是 16.0）不高于 iPad 的系统版本。
   - 构建按 `apps/ios/README.md` 的流程，用 `bash apps/ios/Scripts/build.sh device`。脚本需要 `~/agenthub-work/i1-node-26.4.0` 里的官方 Node、Rust 的 iOS 目标和 XcodeGen，模拟器那轮已经装好；缺了就停下来告诉用户。
   - 登录配置：脚本直接读 `~/agenthub-work/v4-build.env` 里的 `VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`、`VITE_CODETETHER_CONTROL_PLANE_URL`，以及可选的三项 Relay 配置（`CODETETHER_SUPERVISOR_RELAY_ENDPOINT`、`_ID`、`_FINGERPRINT`），写进 `apps/ios/Config/Local.xcconfig`，再由 `Info.plist` 嵌进应用。脚本用干净的环境启动，shell 里导出的变量传不进去，所以这里不用 `set -a` 加载 `v4-build.env`，也不用另外设 `CODETETHER_CONTROL_PLANE_URL`。
   - 不打印 `v4-build.env` 的内容。只读 `VITE_CODETETHER_CONTROL_PLANE_URL` 这一项，核对主机名是 `api.codetether.org`；不是就停下来告诉用户。
   - 脚本结束时会打印 `optional Relay settings: absent` 或 `complete`。是 `absent` 时，先看应用的设置 › 连接检查里"只走 Relay"能不能用；用不了就记下来，告诉用户需要在 `v4-build.env` 补三项 Relay 配置后重新构建，不要自己编这三个值。
   - 签名：脚本默认不签名（`CODE_SIGNING_ALLOWED=NO`），装到真机必须签名。用免费 Apple ID（Personal Team），Xcode 里先登录这个 Apple ID。可以用环境变量 `CODETETHER_IOS_CODE_SIGNING_ALLOWED=YES` 和 `CODETETHER_IOS_CODE_SIGN_IDENTITY` 让脚本签名。脚本不传 `DEVELOPMENT_TEAM` 和 `-allowProvisioningUpdates`，签名报缺团队时，改用 `xcodebuild` 自己带这两项，或者在 Xcode 里打开脚本生成的 `apps/ios/CodeTether.xcodeproj`，选 Personal Team 后直接在 iPad 上运行。团队 ID 等签名设置只在本机命令行或 Xcode 里设，不写进仓库文件，不提交。
   - 免费账号每个 Bundle ID（`org.codetether.app`）最多绑 3 台设备、安装 7 天后过期，验收用一次就够。如果之前装过同 Bundle ID 的其他版本，先在 iPad 上删掉。
   - 安装：可以用 `xcrun devicectl device install app --device <UDID> <CodeTether.app 的路径>`，或者 Xcode 里选 iPad 直接运行。免费账号的开发者证书第一次要在 iPad 上信任（设置 › 通用 › VPN 与设备管理 › 开发者 App），没信任应用打不开。记录构建和安装过程。
3. **Mac 测试电脑**：
   - 先试 Mac 的已有安装版（`/Applications/CodeTether.app`）：用 `osascript -e 'quit app "CodeTether"'` 退出，`open -a /Applications/CodeTether.app` 重新打开，看应用是否正常启动、Node 服务状态。如果启动正常、有真实的项目和 AI 工具（Codex 或 Claude Code），就用它。
   - 如果安装版不行，用 Mac 的 B1 开发版（见"已知情况"）。
   - 电脑上准备一个测试项目，能实际执行的，有真实的 Codex 或 Claude Code。这样能测出真实的 diff 和文字增量，比 Android 那轮的合成夹具覆盖得更完整。
4. **本地网络权限**：
   - iPad 第一次访问局域网地址时，iPadOS 会弹"CodeTether 想要查找并连接到本地网络上的设备"。这是 iOS 14 以后的要求。
   - 点"好"。之后可以在 设置 › CodeTether › 本地网络 里改。
   - 没弹窗的话，先看 设置 › CodeTether 里有没有"本地网络"开关，再看应用有没有真的去连局域网地址（只走了 Relay 就不会弹）。不改代码，把现象记进报告。`90cd7f5` 的 `Info.plist` 里有 `NSLocalNetworkUsageDescription`，没有 `NSBonjourServices`；直连用的是地址，不是 Bonjour 发现，通常用不上。
5. **登录和配对**：
   - iPad 上启动应用，用邮箱验证码登录同一个账号。没有设备身份时勾选"注册为新设备"。
   - Mac 电脑上打开"添加设备 › 添加手机或平板"，把 6 位配对码给 iPad，iPad 输入，显示"已连接"。
   - Mac 设备页"手机和平板"里出现这台 iPad，名称和平台（`iPadOS-arm64`）正确。
6. **直连验收**：设置 › 连接检查 里选"自动"（默认），验证：
   - 最近的会话列表能刷新，能看到几台设备、各有几个项目。
   - 进入一个已有会话，历史和实时更新都正常。
   - 发一条消息（回复），能实时看到电脑的状态变化。
   - 新建会话，选项目、AI 工具、推理强度（只有 Claude Code），发第一条消息，能进入新会话，能看到回复。
   - 打开变更面板，能看到文件列表和逐行 diff。
   - 有待处理时（等待批准、已完成待查看、失败），在待处理页能批准、拒绝、处理完成。
   - 归档、恢复、搜索会话（只按标题）、设备列表、项目列表都通。
   - 记下每一项的结果，成功就记"通过"，失败记现象和错误。
7. **Relay 验收**：设置 › 连接检查 里选"只走 Relay"，重复上面 6 里的全部项目。Mac 电脑断网或退出应用，iPad 应该仍然能连上 Relay、看到电脑离线；Mac 重新上线后，iPad 能经 Relay 继续操作。
8. **被移除**：Mac 电脑保持一条已连接的会话，在 Mac 设备页移除这台 iPad。记下几秒断开、iPad 再连时的错误，以及 Mac 上正在运行的工作是否继续。iPad 显示"被移除"页，说明是哪台电脑移除的、怎么重新配对。
9. **重新配对**：用新的配对码再配一次，能连上。最后在 Mac 上移除，不留测试授权。
10. **外观和布局**：
    - 横屏和竖屏切换，侧栏、变更面板、表单窗口按设计显示。
    - 浅色、深色、跟随系统都正常。
    - 外接键盘：⌘N 新建会话，⌘K 搜索会话，⌘↩ 发送，Esc 关闭窗口；按住 ⌘ 时系统的快捷键列表里能看到它们。

## 已知情况

- **代码**：`origin/i1/ipad-app` 的 `90cd7f5`，包含 r1（`82a1aff`）和 r2（`7fbff25`）的修复，以及真机构建用的 `Info.plist`（`90cd7f5`）。r2 和 `Info.plist` 之后还没有在真机上跑过。
- **Mac B1 开发版**（如果安装版不行才用）：
  - 构建配置用 `set -a; . ~/agenthub-work/v4-build.env; set +a` 在启动的 shell 里加载，不打印内容。
  - 另外设 `CODETETHER_CONTROL_PLANE_URL=https://api.codetether.org`，`CODETETHER_DATA_DIR` 指向一个新的独立目录，例如 `~/agenthub-work/b1-mac-test-data`。
  - 启动：`apps/desktop` 下 `node scripts/run-tauri.mjs dev --config src-tauri/tauri.dev.conf.json`。
  - 开发版和安装版都用 4317。先用 `osascript -e 'quit app "CodeTether"'` 退出安装版，测完用 `open -a /Applications/CodeTether.app` 重新打开。
- **控制服务的来源名单**：它只管浏览器的跨域检查（`apps/control-plane/src/server.ts`），没有 `Origin` 头的请求不会被拦。iPad 应用是原生程序，代码里不设 `Origin` 头，所以正常情况下不需要放开任何来源，也不需要用户在 Windows 上做事。如果登录或配对时控制服务真的拒绝了请求（比如 `403 origin_not_allowed`），记下状态码和响应内容，停下来告诉用户，等用户回复再继续。不要自己改控制服务的配置。用户如果在 Windows 上放开了来源，会告诉你放开的是什么，测完由用户恢复。
- **预期问题**：
  - 配对成功后，iPad 这边 `readClaim` 可能只返回 `sessionView`，没有授权对象，要等目录里出现可用的控制授权。
  - 控制服务返回 401 时，应用会刷新一次，还被拒绝才回登录页。
  - 单条历史记录太大时，服务端可能返回 `internal`，应用会减半重试。如果还不行，记下来就行，这是后端的缺口。
  - 本地网络权限第一次可能没弹窗，看"目标"第 4 项。
- 日志脱敏时保留 `[codetether:` 开头的报错行。

## 注意事项

- 不读 `.secrets/`、其他 `.env`、凭据文件、`~/.codex/auth.json` 和 `~/.claude.json`。`v4-build.env` 只按上面的方法读，不打印内容。
- 不动 Mac 安装版的数据目录。写操作只用用户准备的测试目标。
- 这轮只做验收，不改仓库里的代码，也不提交任何文件。发现问题记进报告，重大问题可以先告诉用户。
- 不改控制服务的配置。

## 报告

追加到 `~/agenthub-archive/i1-report.md`，新开一节"真机验收"：

- iPad 型号、系统版本、UDID（脱敏后 8 位就够）；验收的提交；
- 构建和安装过程：Bundle ID、构建配置、签名用的方式（脚本还是 Xcode）、Relay 配置是 `absent` 还是 `complete`、是否需要改 `deploymentTarget`；
- 本地网络权限有没有正常弹窗；
- 目标 5 到 10 每一项的结果：通过 / 失败（记现象和错误）；
- Mac 测试电脑用的是安装版还是开发版，项目和 AI 工具是什么；
- 被移除的断开秒数和再连时的错误；
- 外观和布局的截图（横屏、竖屏、浅色、深色各一张，只截 iPad 屏幕）；
- 控制服务有没有拒绝过 iPad 的请求（状态码）；如果用户放开过来源，放开了什么、什么时候恢复的；
- 没做完的事和原因。

# 任务：I1 iPad 真机验收

在 Mac 上运行，验收范围和 I1 实现一样：iPad 应用的登录、配对、最近的会话、待处理、会话、新建会话、变更、归档、设备、项目、设置；直连和经 Relay 都通。这轮只做验收，不改代码。

依据：`docs/reviews/i1-ipad-app-prompt.md`、`docs/reviews/i1-fix-prompt-r1.md`、`docs/reviews/i1-fix-prompt-r2.md`（在 `origin/ux/design` 上，用 `git show` 读）；设计文件在 `origin/ux/design`。

开始前确认这份文件有 4 个二级标题，最后一节是"报告"。

## 目标

按顺序验收。代码在 `origin/i1/ipad-app`（现在是 `82a1aff`）。

1. **iPad 连上 Mac**：
   - 用 `xcrun devicectl list devices` 确认 iPad 已连上，能看到型号、系统版本、UDID。记下版本号，项目最低版本要不高于它。
   - iPad 上已经开发者模式（设置 › 隐私与安全性 › 开发者模式），Mac 上信任了这台设备。
2. **从分支构建**：
   - `git fetch origin`，checkout `origin/i1/ipad-app`，在一个新的独立工作区里做，例如 `~/agenthub-work/i1-acceptance`，不动 Mac 已有的工作区和未提交的改动。
   - 如果已经有 `~/agenthub-archive/i1-report.md`，读一下模拟器验收的结果，记下哪些测试通过、哪些要在真机上重点看。没有就跳过。
   - 确认 `apps/ios/project.yml` 里的 `deploymentTarget` 和 `IPHONEOS_DEPLOYMENT_TARGET` 不高于 iPad 的系统版本。
   - 用免费 Apple ID（Personal Team）真机构建。免费账号每个 Bundle ID 最多绑 3 台设备、安装 7 天后过期，但验收用一次就够。如果之前装过同 Bundle ID 的其他版本，先在 iPad 上删掉。
   - 构建设置用 `set -a; . ~/agenthub-work/v4-build.env; set +a`，不打印内容。另外设 `CODETETHER_CONTROL_PLANE_URL=https://api.codetether.org`。
   - 安装到 iPad：`xcodebuild -scheme CodeTether -destination "id=<UDID>" install`，或 Xcode 里选 iPad 设备直接跑。记录构建和安装过程。
3. **Mac 测试电脑**：
   - 先试 Mac 的已有安装版（`/Applications/CodeTether.app`）：用 `osascript -e 'quit app "CodeTether"'` 退出，`open -a /Applications/CodeTether.app` 重新打开，看应用是否正常启动、Node 服务状态。如果启动正常、有真实的项目和 AI 工具（Codex 或 Claude Code），就用它。
   - 如果安装版不行，用 Mac 的 B1 开发版（见"已知情况"）。
   - 电脑上准备一个测试项目，能实际执行的，有真实的 Codex 或 Claude Code。这样能测出真实的 diff 和文字增量，比 Android 那轮的合成夹具覆盖得更完整。
4. **本地网络权限**：
   - iPad 第一次连接时，iPadOS 会弹"CodeTether 想要查找并连接到本地网络上的设备"。这一步是 iOS 14 以后的要求，没有这个权限就发现不了电脑。
   - 点"好"。之后可以在 设置 › CodeTether › 本地网络 里改。
   - 没弹窗的话，检查 `Info.plist` 里有没有 `NSLocalNetworkUsageDescription` 和 `NSBonjourServices`；没有就补上，重新构建。
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

- **代码**：`origin/i1/ipad-app` 的 `82a1aff`。经过两轮审核修复，模拟器上的已知问题都修完了。
- **Mac B1 开发版**（如果安装版不行才用）：
  - 构建配置用 `set -a; . ~/agenthub-work/v4-build.env; set +a` 在启动的 shell 里加载，不打印内容。
  - 另外设 `CODETETHER_CONTROL_PLANE_URL=https://api.codetether.org`，`CODETETHER_DATA_DIR` 指向一个新的独立目录，例如 `~/agenthub-work/b1-mac-test-data`。
  - 启动：`apps/desktop` 下 `node scripts/run-tauri.mjs dev --config src-tauri/tauri.dev.conf.json`。
  - 开发版和安装版都用 4317。先用 `osascript -e 'quit app "CodeTether"'` 退出安装版，测完用 `open -a /Applications/CodeTether.app` 重新打开。
- **控制服务来源**：iPad 用免费 Apple ID 安装时，来源写成 `http://localhost`（Xcode 本地运行）或 `urn:codetether:apps:ios:personal-team`（真机安装后的标识）。控制服务要临时放开这个来源，测完恢复。用户会在 Windows 上做，到这一步时停下来告诉用户，等用户回复。Windows 上用 `b1-logs/control-plane-test-origin*.py`。
- **预期问题**：
  - 配对成功后，iPad 这边 `readClaim` 可能只返回 `sessionView`，没有授权对象，要等目录里出现可用的控制授权。
  - 控制服务返回 401 时，应用会刷新一次，还被拒绝才回登录页。
  - 单条历史记录太大时，服务端可能返回 `internal`，应用会减半重试。如果还不行，记下来就行，这是后端的缺口。
  - 本地网络权限第一次可能没弹窗，看"目标"第 4 项。
- 日志脱敏时保留 `[codetether:` 开头的报错行。

## 注意事项

- 不读 `.secrets/`、其他 `.env`、凭据文件、`~/.codex/auth.json` 和 `~/.claude.json`。`v4-build.env` 只按上面的方法加载。
- 不动 Mac 安装版的数据目录。写操作只用用户准备的测试目标。
- 这轮只做验收，不改代码。发现问题记进报告，重大问题可以先告诉用户。

## 报告

追加到 `~/agenthub-archive/i1-report.md`，新开一节"真机验收"：

- iPad 型号、系统版本、UDID（脱敏后 8 位就够）；
- 构建和安装过程：Bundle ID、构建配置、是否需要改 `deploymentTarget`；
- 本地网络权限有没有正常弹窗；
- 目标 5 到 10 每一项的结果：通过 / 失败（记现象和错误）；
- Mac 测试电脑用的是安装版还是开发版，项目和 AI 工具是什么；
- 被移除的断开秒数和再连时的错误；
- 外观和布局的截图（横屏、竖屏、浅色、深色各一张，只截 iPad 屏幕）；
- 控制服务来源是什么，用户怎么临时放开的；
- 没做完的事和原因。

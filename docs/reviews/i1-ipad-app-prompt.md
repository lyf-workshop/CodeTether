# 任务：I1 iPad 应用第一轮

在 Mac 上运行，用 Xcode 和用户的免费 Apple ID。范围和 Android 平板第一轮（T1a）一样，界面用 SwiftUI，连接核心用 T1a 的同一个 Rust crate。

设计在 `docs/ux-redesign/07-tablet.md`（§8 的 T1a 那一行是本轮范围），原型在 `docs/ux-redesign/tablet/`（截图 `tablet/png/`，浏览器打开 `tablet/index.html` 可以点，原型本来就是 iPadOS 式），配对和文案在 `06-pairing-remote-control.md`，技术方案在 `03-project-plan.md` §5，不变量在 03 §6。

这几份设计文件在 `origin/ux/design` 上，任务分支里没有。用 `git show origin/ux/design:<路径>` 读；要在浏览器里点原型，另开一个 detached 的只读工作区。不要把它们复制进任务分支。

任务分支里的 `apps/android` 是已经对真实后端跑通的 Android 版，行为可以照它做。它的审核还没结束，和设计文件或 TypeScript 实现不一致时，以后两者为准，并写进报告。

开始前确认这份文件有 4 个二级标题，最后一节是“报告”。

## 目标

按顺序做。先让 Rust 核心在 iOS 上跑通，再做界面。

1. **工具链和模拟器**：
   - 要完整的 Xcode 和 iOS 平台，只有命令行工具不够。没有就停下来请用户装（见“已知情况”）。
   - Rust 加 `aarch64-apple-ios` 和 `aarch64-apple-ios-sim` 目标。
   - 新建一个 iPad 模拟器，名字带 `codetether`，型号尽量接近用户的 iPad。
   - 别的开发工具（XcodeGen、SVG 转 PNG 之类）可以装，版本写进报告。
2. **项目骨架**：
   - `apps/ios`：SwiftUI，单个应用，只支持 iPad（`TARGETED_DEVICE_FAMILY = 2`），iPhone 以后再加。
   - Bundle ID 用 `org.codetether.app`；免费账号注册不了就加后缀，写进报告。
   - 最低系统版本不高于用户 iPad 上的版本（iPad 连上后用 `xcrun devicectl list devices` 查）。
   - 用 Xcode 工程文件还是 XcodeGen 之类生成，由你定。干净的检出要能用一条命令构建。
3. **接入 Rust 核心**（`packages/supervisor-mobile`）：
   - 为两个 iOS 目标编出静态库，打成 XCFramework，用 crate 自带的 `uniffi-bindgen`（feature `bindgen`）生成 Swift 接口。构建产物不进 Git，用脚本重新生成。
   - crate 尽量少改，改动单独提交，方便 T1a 合并后变基。不能影响 Android 的构建。
   - 已知要改一处：`src/relay.rs:32` 的 `BUILD_ID` 写死了 `android-`，iOS 上要报自己的平台。
   - `connect_supervisor`、`request`、`disconnect` 是同步阻塞的，不在主线程上调用。
   - **互通测试**：模拟器上的 Swift 测试经 UniFFI 连 crate 现有的 TypeScript 夹具（`tests/interop-fixture.mjs`），直连和经 Relay 各做一次读取和一次写操作。以 TypeScript 为准，不改它。
4. **设备身份、登录、配对**：
   - 设备密钥：Secure Enclave 里不可导出的 P-256。`DeviceSigner` 用 `SecKeyCreateSignature` 和 `.ecdsaSignatureMessageX962SHA256` 签名，出来是 DER，crate 会转成 r‖s。私钥不出 Secure Enclave。模拟器上用不了 Secure Enclave 时，只有 DEBUG 构建在模拟器上可以用软件密钥，和 Android 的规则一样（`AndroidDeviceIdentity.kt:65`）。
   - 登录：和电脑一样用邮箱验证码，只能登录已有账号。登录状态放 Keychain，用 `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`，不同步 iCloud，不随备份恢复到别的设备。
   - 设备注册：`deviceType` 用 `tablet`，平台写 `iPadOS-arm64`（模拟器写 `iPadOS-Simulator-arm64`）。名称用设备型号；iPadOS 16 起 `UIDevice.current.name` 只返回“iPad”，具体型号从系统信息里取，怎么显示由你定。
   - 配对：输入电脑上的 6 位码（06 §3.1）。输错、过期、用过、作废的提示按 06 §1 和原型 01-03 至 01-05。
5. **页面**：后端现在有的都做，照原型和截图。范围和 T1a 一样：
   - 登录、第一次配对（01-01 至 01-05）。
   - 最近的会话、待处理（02-01、02-02）：待处理里能直接批准、拒绝、处理完成。
   - 会话（02-03 至 02-09）：实时更新、审批卡、停止、失败卡、导入的会话。更多菜单只放“归档”。
   - 变更面板（02-04）：横屏在右边打开，侧栏自动收起；竖屏盖在会话上面。
   - 新建会话（02-10、02-11），搜索会话（02-12，只按标题，在已读取的会话里找）。
   - 设备（03-01 至 03-03）：不放“＋ 添加项目”。
   - 项目（03-04、03-05）：会话列表和状态筛选。项目内搜索、以前的会话、重命名、移除不做。
   - 设置（04-01 至 04-05）：账号和退出登录、可以使用的电脑（移除、输入配对码加另一台）、外观（跟随系统 / 浅色 / 深色）、连接检查（可以选“只走 Relay”）、后续规划。通知、后台保持连接、解锁确认不做。
   - 被移除（04-06），竖屏和深色（05-01 至 05-05）。
   - 本轮没做的功能不出现在界面上，只列在 设置 › 后续规划 里（03 §6）。
   - 07 §2 的尺寸按 pt 用。分屏、侧拉、台前调度把窗口变窄时，用竖屏的布局，表单窗口占满宽度，不能挤坏。
6. **键盘**：07 §2 的快捷键在 iPad 上用 ⌘：⌘N 新建会话，⌘K 搜索会话，⌘↩ 发送，Esc 关闭窗口。按住 ⌘ 时系统的快捷键列表里要能看到它们。
7. **实机验证**：先模拟器，再用户的 iPad，结果填报告里的验收表。

## 已知情况

- **起点**：Rust crate 还没合进 `main`。`git fetch origin`，从 `origin/t1a/tablet-app`（现在是 `f290602`）新建分支 `i1/ipad-app`，工作区例如 `~/agenthub-work/i1-ipad`。不动 Mac 上已有的工作区和它们的未提交改动。T1a 合并以后再变基到 `main`。
- **协议参考**（行号以 `f290602` 为准）：
  - Supervisor 和 Relay 的协议 Rust 核心已经实现了，crate 的 `README.md` 有说明。Swift 这边主要接控制服务。
  - Android 的对应代码在 `apps/android/app/src/main/java/org/codetether/app/account/`（`ControlPlane.kt`、`AccountSessions.kt`、`AccountHttp.kt`）。
  - TypeScript 原版：
    - 设备注册：`apps/web/src/runtime/account/control-plane-client.ts:415`、`:432`；
    - 目录：`:662`；
    - 配对：`apps/web/src/runtime/account/pairing-client.ts:334`；
    - 设备自己退出配对：`apps/control-plane/src/server.ts:1336`；
    - 邮箱验证码：`apps/web/src/runtime/account/account-auth-actions.ts:40`、`:52`。
  - 操作和结果的 schema 在 `packages/supervisor-transport/src/protocol.ts`。
- **Android 在真实后端上遇到的，iPad 也要照样处理**（`D:/Projects/Software/agenthub-archive/t1a-report.md`，用户会把要点转给你）：
  - 配对成功后，设备这边的 `readClaim` 只返回 `sessionView`，没有授权对象。要从目录里等到可用的控制授权。
  - 运行中归档的冲突在 wire 上是 `conflict`，没有数值状态，按 409 提示原因。
  - 连接帧上限实际是 16 KiB。历史和实时读取遇到服务端 `internal` 时把批次减半重试；单条记录太大是后端的缺口，写进报告就行。
  - 实时更新用前台轮询，间隔和 Android 一样 750 ms（`RemoteSupervisor.kt:137`）。
  - 电脑的默认名“CodeTether Host”显示成“这台电脑”（`ControlPlane.kt:245`）。
  - 构建配置里有 Relay 的三个值时，要和目录里的 Relay 描述核对（`ControlPlane.kt:252`）。
- **B1 补测里看到的两件事**，客户端要处理：
  - 续期刚完成时，用旧授权重连会收到 `authorization_revoked`。先重新读一次目录、用最新的授权重试，不要直接判断为被移除。
  - 移除以后再连，分类是 `request_failed`，和普通连不上分不开。只有控制服务确认已经没有有效授权时才显示“被移除”页，其他情况显示“这台电脑现在连不上……”。
- **能力门控**：批准、停止、逐行变更只看 AI 工具返回的能力（`approvals`、`interrupt`），不按工具名写死。读法见 `apps/web/src/dev/supervisor-operation-client.ts:233-266`。结果应该和 07 §1 一致：只有电脑本机上的 Codex 能批准、停止、看逐行变更。
- **构建配置**：
  - 和电脑构建用同一组值：`VITE_CODETETHER_CONTROL_PLANE_URL`、`VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`、`CODETETHER_SUPERVISOR_RELAY_ENDPOINT` / `_ID` / `_FINGERPRINT`。
  - 来源是 `~/agenthub-work/v4-build.env`。只把这 6 个值取出来，写进不进 Git 的本地 xcconfig 或生成文件给 Xcode 用；不要把整个文件加载进 `xcodebuild` 的环境。xcconfig 里 `//` 会被当成注释，URL 要处理。
  - Supabase publishable key 会打进应用包，这是它的设计用途；但不进仓库，也不打印。签名用的 Team ID 也放本地文件，不进仓库。
  - 没有 Relay 的三个值时，和 Android 一样只靠 Rust 核心核对签名的描述。
- **免费 Apple ID**（2026-11-04 用户的决定）：
  - 装到 iPad 上的应用 7 天后失效，用 Xcode 重新运行一次就好；一台设备最多 3 个自签应用。
  - 推送、App Groups、iCloud 这些能力用不了，本轮也不需要，不加进 entitlements。
- **前后台**：iOS 会挂起后台的应用。进后台时断开连接、取消请求；回到前台时重新读目录、重连、刷新，和 Android 一样。不申请后台模式。
- **本地网络**：直连要访问局域网，`Info.plist` 要有 `NSLocalNetworkUsageDescription`。用户拒绝时直连失败，自动走 Relay，原因显示在连接检查里。控制服务和 Supabase 都是 HTTPS，ATS 不用放宽。
- **测试用的电脑：这台 Mac**：
  - 安装版没有 B1，配对只能对开发版做。`i1/ipad-app` 里电脑这边的代码和 `main` 一样，直接用这个工作区的开发版。
  - 启动方法和 B1 跨设备验收时一样：
    - 在启动的 shell 里 `set -a; . ~/agenthub-work/v4-build.env; set +a`，不打印内容；
    - 另外设 `CODETETHER_CONTROL_PLANE_URL=https://api.codetether.org`，`CODETETHER_DATA_DIR` 指向一个新的独立目录；
    - `apps/desktop` 下 `node scripts/run-tauri.mjs dev --config src-tauri/tauri.dev.conf.json`。
  - Host sidecar 用核对过 SHA256 的官方 Node 打，版本和 Mac 第 8 轮相同（见 `~/agenthub-archive/v4-acceptance-report-mac.md`）。第 7 轮用 `/tmp` 里的 Node 25.5.0 打过，Host 起不来。
  - 开发版和安装版都用 4317。启动前先问用户，确认安装版可以退出；没确认就先做不需要电脑的部分。退出用 `osascript -e 'quit app "CodeTether"'`。测完退出开发版，用 `open -a /Applications/CodeTether.app` 重新打开，并确认它重新上线。
  - 开发版的页面来源是 `http://127.0.0.1:5173`。控制服务默认不放行它，登录和生成配对码前要临时放开，测完恢复。
  - 用新数据目录登录开发版，账号下可能多出一台测试电脑。列进报告，能在界面上移除的最后移除。
  - 测试会话放在一个专门的小测试项目里，提示词尽量短，用的是用户真实的 Codex 和 Claude Code 额度。真实的 Codex 用来验证批准、停止、逐行变更和连续的文字输出（T1a 的合成夹具没覆盖到）；Claude Code 用来验证不支持的工具不出现批准和停止。
  - 真实工具很难稳定地停在“等待批准”时，可以参考 `apps/host/src/api/local-codex-host.ts:403` 的 `startLocalCodexHostWithRuntime` 写一个合成 Provider 夹具，放在 `~/agenthub-work` 里，不进仓库。
  - Mac 开发版这条路走不通时，停下来告诉用户原因。备选是用户在 Windows 上启动 B1 开发版和合成夹具当电脑。
- **要停下来等用户的地方**：
  - Xcode：没装完整的 Xcode 时，用户从 App Store 装，打开一次装好组件，接受许可；然后在 Xcode › Settings › Accounts 登录 Apple ID。
  - iPad：用 USB 连上 Mac 并点“信任”，和 Mac 连同一个 Wi-Fi；打开 设置 › 隐私与安全性 › 开发者模式（会重启）；第一次安装后在 设置 › 通用 › VPN 与设备管理 里信任开发者。
  - 退出 Mac 安装版。
  - 临时放开控制服务的开发来源。这一步由用户在 Windows 上做。
  - 邮箱验证码和配对码：iPad 上由用户自己输入；模拟器上用户告诉你，不写进日志和报告。配对码要用户在开发版的设备页上点“添加设备 › 添加手机或平板”生成。
  - iPad 第一次直连时的本地网络权限，以及 Mac 防火墙的提示，由用户点允许。
- 续期和补签在 B1 R1 已经在生产环境验证过，这轮不测，也不改生产数据库。

## 注意事项

- 这轮不改 Host、控制服务、Relay、B1 和 `apps/android` 的代码。crate 只做 iOS 需要的小改动。发现后端缺什么或有问题，写进报告。
- **凭据**：
  - 不打印，也不进仓库、日志、Xcode 控制台输出和报告：Supabase key、登录 token、验证码、配对码、私钥、Apple ID 账号信息。
  - 不读 `.secrets/`、其他 `.env`、凭据文件、`~/.codex/auth.json` 和 `~/.claude.json`。`v4-build.env` 只按上面的方法加载。
  - 不打印环境变量，也不保存 `xcodebuild -showBuildSettings` 的完整输出。T1a 时 cargo-ndk 崩溃，把继承的整个环境（里面有数据库连接凭据）写进了日志。构建脚本和子进程用环境变量白名单；Xcode 的 Run Script 关掉“在构建日志里显示环境变量”。
- 不动 Mac 安装版的数据目录，不装、不替换 CodeTether 安装版。只用自己建的模拟器，Xcode 和模拟器里别的东西不删。
- **视觉**：照原型和 07 §3。
  - SwiftUI 自带的分组列表、大标题、半透明导航栏、表单窗口正好对上原型，直接用。
  - 颜色是墨色单色。用墨色替换系统默认的蓝色强调色：主按钮、发送、选中、开关打开用 `#1c1c1e`（深色 `#f2f2f7`）。蓝色只用于链接（`#135e9c` / `#7cc0f2`）和运行中（`#1a7fd0` / `#3c9be3`）。Token 在 `tablet/tablet.css`。
  - 点击区域不小于 44 pt（iPadOS 的要求，07 §3 的 48 dp 是 Android 的），原型画得更大的照原型。
  - 应用图标用 `docs/ux-redesign/icon/final/codetether-app.svg`，导出 1024×1024、不透明的 PNG，圆角由系统加。
  - 系统自己的界面（权限弹窗、键盘、分享）保持原样。
- **文案**照原型。Host、Node、Machine、ProductDevice、Supervisor、Relay、授权、grant、指纹，只能出现在 设置 › 连接检查 里（03 §1）。
- 守住 03 §6 的不变量，尤其是：
  - iPad 只通过 Supervisor 访问电脑；
  - iPad 退出、断网、被杀掉、切到后台都不影响电脑上正在运行的工作；
  - `actionId` 幂等，失败后不自动重发，运行中归档返回 409 时提示原因。
- **门禁**：
  - Rust crate 的 `cargo test --locked`，包括互通测试（先按 crate 的 `README.md` 构建 TypeScript 夹具的依赖）；
  - 两个 iOS 目标的 Rust 构建和 XCFramework 脚本；
  - 模拟器上的 `xcodebuild test`：单元测试、互通测试、关键流程的 UI 测试；
  - 真机构建（`generic/platform=iOS`）；
  - 仓库原有的 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build` 不能变坏；
  - 这台 Mac 没有 Android 工具链时不跑 Gradle，在报告里说明，Windows 那边复核。
- 怎么拆提交由你定。做完推送分支。

## 报告

写到 `~/agenthub-archive/i1-report.md`。很长的输出放到 `i1-logs/`，截图放到 `i1-shots/`。

报告内容：

- 每项目标做了什么；和 07、原型、Android 版不一样的地方，以及为什么。
- 工具链和主要依赖的版本（Xcode、iOS SDK、Swift、Rust、UniFFI），iPad 的型号和系统版本，最低系统版本，Bundle ID。
- crate 改了什么（文件和提交），方便 Windows 那边复核 Android 构建。
- 互通测试结果（直连、经 Relay）。
- 设备密钥在模拟器和 iPad 上分别是 Secure Enclave 还是软件。
- 验收表，每行写结果和证据链接：
  1. 模拟器和 iPad 配对成功，电脑设备页“手机和平板”出现它们，名称和平台正确；
  2. 直连和“只走 Relay”下，最近的会话、待处理、设备、项目、会话读取和实时更新、变更都正常；真实 Codex 的逐行变更和连续文字输出；
  3. 新建会话、回复、批准和拒绝、处理完成、停止各一次；运行中归档提示 409；
  4. 不支持的 AI 工具不出现批准和停止；
  5. iPad 断网、退出、被杀掉、切到后台时，电脑上的工作继续运行；
  6. 在电脑上移除这台 iPad：几秒内断开，显示被移除页；重新配对能用；
  7. 断网恢复、切到后台再回来，状态和电脑一致；
  8. 横竖屏、深浅色、分屏和台前调度的窄窗口、外接键盘的快捷键；
  9. iPad 真机：用免费 Apple ID 安装、登录、配对，本地网络权限，直连和经 Relay 都能读写。
- 每个页面的截图（模拟器横屏、竖屏、深色，加几张分屏），文件名用原型的编号，方便对照。合成数据和真实场景分开标注，真机至少几张。
- 发现的后端缺口或问题。
- 这轮建的测试配对和测试电脑，最后都移除；列出来。
- 分支、提交、是否推送，iPad 上这次安装的签名哪天失效。
- 没做完的事和原因。

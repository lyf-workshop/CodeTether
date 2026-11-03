# 任务：T1a 平板应用第一轮（Android）

在这台 Windows 电脑上运行。设计在 `docs/ux-redesign/07-tablet.md`（§8 是本轮范围），原型在 `docs/ux-redesign/tablet/`（截图 `tablet/png/`，浏览器打开 `tablet/index.html` 可以点），配对和文案在 `06-pairing-remote-control.md`，技术方案在 `03-project-plan.md` §5，不变量在 03 §6。

这几份设计文件在 `origin/ux/design` 上，任务分支里没有。直接读 `D:/Projects/Software/agenthub/docs/ux-redesign/`（只读，不改那个工作区），或者 `git show origin/ux/design:<路径>`。不要把它们复制进任务分支。

开始前确认这份文件有 4 个二级标题，最后一节是“报告”。

## 目标

按顺序做。连接核心风险最大，先做通再做界面。

1. **工具链和模拟器**：装 Android NDK、Rust 的 `aarch64-linux-android` 和 `x86_64-linux-android` 目标、`cargo-ndk`。新建一个平板模拟器（Pixel Tablet 配置，1280×800 dp，用已装的 `android-36` `google_apis` `x86_64` 镜像），名字带 `codetether`。
2. **项目骨架**：
   - `apps/android`：Kotlin + Jetpack Compose，单个应用。applicationId 用 `org.codetether.app`，minSdk 不高于 33（vivo X60 是 Android 13）。
   - Rust 连接核心单独一个 crate，放在 `apps/android` 外面，以后 iOS 也要用。用 UniFFI 生成 Kotlin 接口，用 cargo-ndk 打进 APK。
   - 名字和目录由你定，写进报告。
3. **连接核心（M0 的内容）**：
   - 实现和电脑上一样的 Supervisor 客户端：TLS 1.3、固定 Host 指纹、绑定 TLS 导出密钥的设备证明。
   - 直连和经 Relay 都要通。经 Relay 时，外层是到 Relay 的 TLS（固定 Relay 指纹）加 Relay 帧，里面再套一层到 Host 的 TLS。
   - 覆盖 `protocol.ts` 里的全部远程操作。
   - **互通测试**：用仓库里现有的 TypeScript 服务端和 Relay 起本地夹具，Rust 客户端连上去跑直连和经 Relay 两种。以 TypeScript 为准，不改它。规范 JSON、签名、导出密钥另加固定向量测试。
   - 如果 Rust 核心在 Android 上成本明显过高（03 §5），停下报告原因和纯 Kotlin 的估算，不要自己换方案。
4. **设备身份、登录、配对**：
   - 设备密钥：Android Keystore 里不可导出的 ES256（P-256），优先 StrongBox，没有就用 TEE。Rust 通过回调让 Kotlin 签名，私钥不出 Keystore。
   - 登录：和电脑一样用邮箱验证码，只能登录已有账号。登录状态用 Keystore 密钥加密保存，不进备份。
   - 设备注册：平台写 `Android-arm64` / `Android-x64`，名称用系统给的型号名。
   - 配对：输入电脑上的 6 位码（06 §3.1）。输错、过期、用过、作废的提示按 06 §1 和原型 01-03 至 01-05。
5. **页面**：后端现在有的都做，照原型和截图。范围按 07 §8 的 T1a：
   - 登录、第一次配对（01-01 至 01-05）。
   - 最近的会话、待处理（02-01、02-02）：待处理里能直接批准、拒绝、处理完成。
   - 会话（02-03 至 02-09）：实时更新、审批卡、停止、失败卡、导入的会话。更多菜单只放“归档”。
   - 变更面板（02-04）：横屏在右边打开，侧栏自动收起；竖屏盖在会话上面。
   - 新建会话（02-10、02-11），搜索会话 Ctrl K（02-12，只按标题，在已读取的会话里找）。
   - 设备（03-01 至 03-03）：不放“＋ 添加项目”。
   - 项目（03-04、03-05）：会话列表和状态筛选。项目内搜索、以前的会话、重命名、移除不做。
   - 设置（04-01 至 04-05）：账号和退出登录、可以使用的电脑（移除、输入配对码加另一台）、外观（跟随系统 / 浅色 / 深色）、连接检查（可以选“只走 Relay”）、后续规划。通知、后台保持连接、解锁确认不做。
   - 被移除（04-06），竖屏和深色（05-01 至 05-05）。
   - 本轮没做的功能不出现在界面上，只列在 设置 › 后续规划 里（03 §6）。
   - 窄屏（手机）先用平板竖屏的布局，表单窗口占满宽度，能登录、配对、连接检查就行。手机布局以后做。
6. **键盘**：Ctrl N 新建会话，Ctrl K 搜索会话，Ctrl Enter 发送，Esc 关闭窗口（07 §2）。
7. **实机验证**：见“已知情况”最后几条，结果填报告里的验收表。

## 已知情况

- **起点**：B1 还没合并。`git fetch origin`，从 `origin/b1/pairing-remote-control`（`9694895`）新建分支 `t1a/tablet-app`，工作区 `D:/Projects/Software/agenthub-t1a-tablet`。B1 合并到 `main` 后用户会告诉你，到时候再 rebase 到 `main`。
- **协议参考**（行号以 `9694895` 为准）：
  - `packages/supervisor-transport/src`：
    - TLS 和导出密钥在 `tls.ts`。标签是 `EXPORTER-CodeTether-Supervisor-v1`（`constants.ts:9`），Host 证书是 ECDSA P-256；
    - 直连 `client.ts:398`，经 Relay 时内层 TLS 在 `client.ts:431`，外层在 `relay.ts:423`；
    - 规范 JSON 和 JWS ES256 在 `crypto.ts`（Keystore 签出来是 DER，要转成 64 字节 r‖s）；
    - 操作和结果的 schema 在 `protocol.ts`。
  - Relay 帧和认证：`packages/relay-protocol/src`（`framing.ts`、`supervisor.ts`、`auth-transcript.ts`）。
  - 新设备那一侧的完整流程：
    - Host 里作为客户端连别的电脑：`apps/host/src/api/supervisor-transport-manager.ts` 的 `beginRemote`:1001、`authenticateRemote`:1156；
    - 开发诊断页：`apps/web/src/dev/supervisor-check-client.ts`，配对在 `:54`，读目录在 `:118`。
  - 控制服务接口：
    - 设备注册：`apps/web/src/runtime/account/control-plane-client.ts:415`、`:432`；
    - 目录：`:662`；
    - 配对：`apps/web/src/runtime/account/pairing-client.ts:334`；
    - 设备自己退出配对：`apps/control-plane/src/server.ts:1336`；
    - 邮箱验证码：`apps/web/src/runtime/account/account-auth-actions.ts:40`、`:52`。
- **能力门控**：批准、停止、逐行变更只看 AI 工具返回的能力（`approvals`、`interrupt`），不按工具名写死。读法见 `apps/web/src/dev/supervisor-operation-client.ts:233-266`。结果应该和 07 §1 一致：只有电脑本机上的 Codex 能批准、停止、看逐行变更。
- **构建配置**：控制服务地址、Supabase 地址和 publishable key、Relay 的地址 / ID / 指纹，和电脑构建用同一组值（`VITE_CODETETHER_CONTROL_PLANE_URL`、`VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`、`CODETETHER_SUPERVISOR_RELAY_*`）。值的来源和 B1 补测时启动开发版用的一样，构建时从环境变量或不进 Git 的本地文件读，不写进仓库。
- **B1 补测里看到的两件事**（`D:/Projects/Software/agenthub-archive/b1-fix-report-r1.md`），客户端要处理：
  - 续期刚完成时，用旧授权重连会收到 `authorization_revoked`，拿到新授权后正常。收到它时先重新读一次目录、用最新的授权重试，不要直接判断为被移除。
  - 移除以后再连，分类是 `request_failed`，和普通连不上分不开。只有控制服务确认已经没有有效授权时才显示“被移除”页，其他情况显示“这台电脑现在连不上……”。
- **这台电脑上的测试环境**：
  - 安装版是 `v0.1.0-alpha.2`，没有 B1，所以配对只能对 B1 开发版做。启动方法、独立数据目录和合成 Provider 夹具（待批准项、运行中的 Turn、不支持批准和停止的工具），见 B1 补测报告的“Windows 补测”一节和 `agenthub-archive/b1-logs/windows-dev-launch.mjs`。用 B1 工作区 `D:/Projects/Software/agenthub-b1-pairing` 的开发版，只运行，不改那里的代码。
  - 开发版和安装版都用 4317 端口。B1 的 Mac 跨设备验收也要用这台电脑上的开发版。启动之前先问用户 Mac 那边做完没有；没做完就先做不需要电脑的部分。
  - 用的时候先从托盘退出安装版。测完退出开发版，重新打开安装版，并确认它重新上线。
  - Android 应用不是浏览器，控制服务的 CORS 不用动。
- **要停下来等用户的地方**：
  - 登录时用户要把收到的邮箱验证码告诉你；
  - 配对码要用户在开发版的设备页上点“添加设备 › 添加手机或平板”生成；
  - vivo X60 要用户用 USB 连上并打开 USB 调试。
- 续期和补签在 B1 R1 已经在生产环境验证过，这轮不测，也不改生产数据库。

## 注意事项

- 这轮不改 Host、控制服务、Relay 和 B1 的代码。发现后端缺什么或有问题，写进报告。
- 凭据不打印，也不进仓库、日志、logcat 和报告：`.secrets/`、Supabase key、登录 token、验证码、配对码、私钥。应用关闭备份（`allowBackup` 和数据提取规则），不允许明文网络。
- 只用自己建的模拟器。`anju_api36` 是别的项目的，不动；Android SDK 里别的东西也不删。开发工具（NDK、Rust 目标、cargo-ndk、模拟器镜像）可以装，版本写进报告。不装、不替换 CodeTether 安装版。
- **视觉**：照原型和 07 §3。
  - 分组列表、大标题、圆角表单；颜色是墨色单色，主按钮和选中用墨色（深色模式下是白色），蓝色只用于链接和运行中。
  - 不用 Material 3 默认外观，不跟随壁纸取色。点击区域不小于 48 dp。
  - 应用图标用 `docs/ux-redesign/icon/final/codetether-app.svg` 做自适应图标。
- **文案**照原型。Host、Node、Machine、ProductDevice、Supervisor、Relay、授权、grant、指纹，只能出现在 设置 › 连接检查 里（03 §1）。
- 守住 03 §6 的不变量，尤其是：
  - 平板只通过 Supervisor 访问电脑；
  - 平板退出、断网、被杀掉都不影响电脑上正在运行的工作；
  - `actionId` 幂等，失败后不自动重发，运行中归档返回 409 时提示原因。
- **门禁**：
  - Rust crate 的 `cargo test`，包括互通测试；
  - `gradlew` 的单元测试、lint、`assembleDebug`；
  - 模拟器上关键流程的 Compose UI 测试；
  - 仓库原有的 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build` 不能变坏。
- 怎么拆提交由你定。做完推送分支。

## 报告

写到 `D:/Projects/Software/agenthub-archive/t1a-report.md`。很长的输出放到 `t1a-logs/`，截图放到 `t1a-shots/`。

报告内容：

- 每项目标做了什么；和 07、原型不一样的地方，以及为什么。
- 工具链和主要依赖的版本（Rust 的 TLS 库、UniFFI、Compose 等），crate 和目录的名字。
- 互通测试结果（直连、经 Relay），固定向量测试结果。
- 设备密钥在模拟器和 vivo X60 上分别是 StrongBox、TEE 还是软件。
- 验收表，每行写结果和证据链接：
  1. 模拟器上配对成功，电脑设备页“手机和平板”出现这台平板，名称和平台正确；
  2. 直连和“只走 Relay”下，最近的会话、待处理、设备、项目、会话读取和实时更新、变更都正常；
  3. 新建会话、回复、批准和拒绝、处理完成、停止各一次；运行中归档提示 409；
  4. 不支持的 AI 工具不出现批准和停止；
  5. 平板断网、退出、被杀掉时，电脑上的工作继续运行；
  6. 在电脑上移除这台平板：几秒内断开，显示被移除页；重新配对能用；
  7. 断网恢复、切到后台再回来，状态和电脑一致；
  8. 横竖屏、深浅色、外接键盘的快捷键；
  9. vivo X60：安装、登录、配对，直连和经 Relay 都能读写。
- 每个页面的截图（模拟器横屏、竖屏、深色），文件名用原型的编号，方便对照。
- 发现的后端缺口或问题。
- 这轮建的测试配对，最后都在电脑上移除；列出来。
- 分支、提交、是否推送、debug APK 的位置。
- 没做完的事和原因。

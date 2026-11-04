# 任务：审核 T1a Android 平板应用的 Kotlin 代码

在这台 Windows 电脑上运行。只审核，不改代码。

审核对象是 `t1a/tablet-app` 分支已推送的提交 `f290602`（基点 `origin/main` `9694895`）里的 `apps/android`。Rust 连接核心 `packages/supervisor-mobile` 已经单独审过：把它的 UniFFI 接口当黑盒，只看 Kotlin 有没有用错它。

开始前确认这份文件有 4 个二级标题，最后一节是“报告”。

## 目标

找出会让用户看到错误结果、丢数据、泄露凭据或卡住的问题，按严重程度排好。重点看下面这些，看到别的问题也写：

1. **凭据**：登录 token、验证码、配对码、私钥有没有进日志、异常信息、`toString`、界面。`app/build.gradle.kts` 写进 BuildConfig 的是不是只有公开的值（控制服务地址、Supabase 地址和 publishable key、Relay 地址 / ID / 指纹）；传给原生构建的环境变量白名单会不会带上凭据。备份和明文网络是不是关了，Manifest 有没有多余的导出组件或深链接。T1a 报告提到测试时有“调试输入窗口”直接传验证码和配对码，找到它，确认发布版里没有。
2. **设备密钥**：P-256 不可导出，StrongBox → TEE → 软件的回退；发布版是否一定拒绝软件密钥（`AndroidDeviceIdentity.kt:65` 附近）。重装、清数据、改锁屏以后密钥丢了会怎样。
3. **登录**：只登录已有账号；登录状态加密保存；刷新失败和退出登录时清掉。
4. **配对**：6 位码各种错误的提示；配对成功后等待控制授权的过程有没有上限、能不能取消。
5. **被移除和连不上**：按 B1 补测的两条规则（见“已知情况”），普通断网会不会显示成“被移除”，真的被移除会不会一直停在“连不上”。
6. **并发和生命周期**：协程作用域、取消、切到后台、旋转屏幕、进程被杀后恢复。前台轮询（会话 750 ms，目录 5 s）会不会叠在一起、会不会每次都新建连接；估一下每分钟给 Relay 和电脑带来多少连接和请求。
7. **UniFFI 边界**：同步调用是否都不在主线程；`SupervisorSession` 等原生对象有没有释放；`DeviceSigner` 回调里出错时 Rust 那边能不能收到。
8. **修改操作**：`actionId` 是不是每次用户操作生成一次；有没有自动重发；连点会不会发两次；结果不确定时界面怎么处理；运行中归档的冲突给用户看的文字是原因，不是裸的“409”或错误码。
9. **能力门控**：批准、停止、逐行变更是不是只看 AI 工具返回的能力，没有按工具名写死。
10. **文案**：Host、Node、Machine、ProductDevice、Supervisor、Relay、授权、grant、指纹只能出现在 设置 › 连接检查 里。没做的功能不出现在界面上，只在 设置 › 后续规划 里。
11. **和设计对照**：侧栏结构、页面、快捷键（Ctrl N / K / Enter、Esc）、窄屏布局。只报明显的不一致，视觉细节由用户定。
12. **测试**：已有测试覆盖了上面哪些失败路径，缺哪些关键的。

## 已知情况

- **工作区**：`D:/Projects/Software/agenthub-t1a-tablet` 里另一个智能体还在工作，有未提交的改动，不要碰，也不要审这些改动。用 `git show f290602:<路径>` 读，或者自己从 `f290602` 建一个 detached 的工作区（例如 `D:/Projects/Software/agenthub-t1a-review`），审完删掉。
- **依据**（在 `D:/Projects/Software/agenthub` 的 ux/design 分支上，只读）：
  - 任务提示词 `docs/reviews/t1a-tablet-app-prompt.md`；
  - 设计 `docs/ux-redesign/07-tablet.md`；
  - 配对、续期、移除 `docs/ux-redesign/06-pairing-remote-control.md`；
  - 文案规则 `docs/ux-redesign/03-project-plan.md` §1 和 §1.1，不变量 §6。
- **编码智能体的报告**：`D:/Projects/Software/agenthub-archive/t1a-report.md`。里面的说法要对照代码核实，不要直接采信。
- **B1 补测里看到的两件事**（`D:/Projects/Software/agenthub-archive/b1-fix-report-r1.md`）：
  - 续期刚完成时，用旧授权重连会收到 `authorization_revoked`。客户端应该先重新读目录、用最新的授权重试，不直接判断为被移除。
  - 移除以后再连，分类是 `request_failed`，和普通连不上分不开。只有控制服务确认已经没有有效授权时才显示“被移除”页，其他情况显示“这台电脑现在连不上……”。
- **TypeScript 原版**（行号以 `f290602` 为准）：
  - 设备注册 `apps/web/src/runtime/account/control-plane-client.ts:415`、`:432`，目录 `:662`；
  - 配对 `apps/web/src/runtime/account/pairing-client.ts:334`；
  - 设备自己退出配对 `apps/control-plane/src/server.ts:1336`；
  - 能力的读法 `apps/web/src/dev/supervisor-operation-client.ts:233-266`；
  - 操作和结果的 schema `packages/supervisor-transport/src/protocol.ts`。
- 已知的后端缺口不用再报：单条超过 16 KiB 的历史记录或事件发不出来；项目是否可用是从设备状态推出来的。

## 注意事项

- 只读：不改代码，不提交，不推送。
- 不读 `.secrets/`、`.env`、密钥和凭据文件，不打印环境变量。不读 `agenthub-archive/t1a-logs/`，那里有一批日志曾经含有凭据。
- 不联网访问生产服务。不跑模拟器（T1a 的智能体可能在用），也不跑会触发 Rust 原生构建的 Gradle 任务。读代码就够了。
- 判定一个问题之前，先看调用方和相关代码：超时、锁、错误映射常常在别的文件里。

## 报告

写到 `D:/Projects/Software/agenthub-archive/t1a-kotlin-review.md`，中文，大约 1500 字以内：

- 问题分三级：必须修 / 应该修 / 备注。每条写：
  - `f290602` 上的文件和行号；
  - 具体的失败场景（什么输入或状态，用户看到什么）；
  - 已核实还是只是怀疑；
  - 建议怎么改，一两句。
- 查过、确认没问题的重点项，每项一行。
- 最后写没查的部分。

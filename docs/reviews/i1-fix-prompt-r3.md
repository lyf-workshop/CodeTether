# 任务：I1 真机构建的登录配置修复（第 3 轮）

在 Mac 上运行，接着做 iPad 真机验收。分支 `i1/ipad-app`，现在是 `90cd7f5`。这轮要改代码，改完提交并推送到 `i1/ipad-app`，不推 `main`、不合并、不打标签。依据：`docs/reviews/i1-ipad-acceptance-prompt.md`、`docs/reviews/i1-fix-prompt-r2.md`（在 `origin/ux/design` 上，用 `git show` 读）。

开始前确认这份文件有 4 个二级标题，最后一节是"报告"。

## 目标

修复 `90cd7f5` 在真机构建里登录配置没有生效的问题，然后继续真机验收。

现象：真机构建装到 iPad 后启动，提示"此版本还没有配置登录服务"。这条提示来自 `apps/ios/Sources/CodeTether/Configuration.swift` 的 `IpadConfiguration.init`：它从 `Info.plist` 读 `CodeTetherControlPlaneURL`、`CodeTetherSupabaseURL`、`CodeTetherSupabasePublishableKey`（必填，两个 URL 必须是 `https` 的来源）和三项 Relay 配置（要么全有，要么全无），任何一项不满足都抛 `configurationMissing`。

要做到：

1. **根因和修复**：找出配置没生效的原因并修复。改动限在 `apps/ios`（脚本、`project.yml`、`Config/`、源码、测试）。
2. **构建后自检**：构建脚本在产物生成后检查 `.app` 里最终的 `Info.plist`，上面六个键不满足 `IpadConfiguration` 的要求就让构建失败，防止再发生。检查输出只能写"存在、形状正确"和两个 URL 的主机名，不打印密钥和 Relay 指纹的值。
3. **回归测试**：覆盖"配置生成 → 最终 `Info.plist` 的值"这条链路。怎么测由你决定。
4. **真机复验**：重新构建，安装到 iPad，启动后进入登录页，不再出现配置错误。
5. **继续验收**：然后按 `docs/reviews/i1-ipad-acceptance-prompt.md` 的清单继续。那份里的 `90cd7f5` 以你的修复提交为准。我会在验收进行的同时审核你的改动。

## 已知情况

- **首要怀疑**：xcconfig 把 `//` 当成注释，加引号也不保护。`apps/ios/Scripts/generate-local-config.mjs` 的 `xcconfigValue` 写出 `SUPABASE_URL = "https://…"`，值可能在 `//` 处被截断，`validOrigin` 就会判为无效，症状正好吻合。常见的写法是把 `//` 写成 `/$()/`。这只是怀疑，用构建产物验证：`xcodebuild -showBuildSettings` 和 `.app` 里的 `Info.plist`。
- **其他可能**：
  - `Config/Base.xcconfig` 里的 `#include? "Local.xcconfig"` 是可选包含，文件不存在或路径不对时不会报错，只会让值全空。
  - `Config/Info.plist` 的 `$(VAR)` 名字和 xcconfig 里的变量名对不上。
  - 这次构建没有走 `Scripts/build.sh`，`Local.xcconfig` 没有重新生成。
- **为什么模拟器那轮没发现**：模拟器的测试用夹具，没有走真实的配置读取。
- **保持不变的方向**：`90cd7f5` 改用显式的 `Config/Info.plist` 加 `$(VAR)` 替换，目的是让配置进入真机包，这个方向保持，不要改回 `INFOPLIST_KEY_*`。
- 构建、签名、安装的做法，以及 iPad 上的开发者信任，前面的会话已经走通，沿用。过程记在 `~/agenthub-archive/i1-report.md`。重新安装会覆盖 iPad 上现在这个有问题的版本。

## 边界

- **自己决定**：根因诊断的方法；修复方式；自检和回归测试怎么做；提交怎么拆；构建环境问题。
- **先问用户**：
  - 需要改 `apps/ios` 以外的代码（Rust、TypeScript、Host）；
  - 需要用户本人操作：验证码、iPad 上的信任和弹窗、Xcode 里的 Apple ID；
  - 改生产服务的配置；
  - 推送 `main`、打标签。
- **不做**：
  - 读取或打印凭据：`v4-build.env` 只由构建脚本读取，不打印；构建检查和报告里不出现密钥和 Relay 指纹的值；
  - 把配置的实际值写进仓库里的文件（`Config/Local.xcconfig` 已被 `.gitignore` 忽略，保持）；
  - 强制推送；动正式的 `com.codetether.node` 服务和它的数据目录。

## 报告

追加到 `~/agenthub-archive/i1-report.md`，新开一节"r3 修复"：

- 根因和证据（构建设置或最终 `Info.plist` 的实际情况，脱敏）；
- 改动的提交和推送后的远端提交；
- 构建后自检的输出（脱敏）和回归测试的结果；
- 真机复验：启动后是否进入登录页；
- 没做完的事和原因。

验收清单的结果继续写进同一份报告的"真机验收"一节。

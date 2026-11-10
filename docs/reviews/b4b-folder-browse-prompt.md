# 任务：B4b 文件夹浏览（远程管理第 2 轮）

在 Mac 上运行。接着在 `main` 上做（当前是 `4801ef1`）。B4b 实现 `folder.list` 操作，让平板和 iPad 能浏览远程电脑的文件夹，从而添加项目时可以选择文件夹而不是输入路径。提交推送到 `feat/b4b-folder-browse`，不推 `main`、不合并、不打标签。

依据（都用 `git show` 读）：

- `docs/ux-redesign/08-remote-management.md` §3.3（folder.list 详细设计）、§3.5（经由电脑访问的设备）、§3.7（电脑上的浏览入口）、§6 第 4 项（Windows 隐藏文件夹和盘符）
- `docs/ux-redesign/06-pairing-remote-control.md` §1：文案规则

开始前确认这份文件有 4 个二级标题，最后一节是"报告"。

## 目标

**必须完成**：

1. **Host 侧实现 `folder.list`**：
   - 新增 Supervisor 操作 `folder.list`（只读，但要求控制权限）
   - 请求：`machineId`、可选 `path`（不传时列用户目录）、可选 `cursor`、可选 `includeHidden`（默认 false）
   - 返回：`path`、`status`（`readable`/`access_denied`/`timeout`）、可选 `parent`、可选 `drives`（Windows 根目录时带）、`readable` 时带 `folders`、`skipped`、可选 `nextCursor`、`access_denied` 时可带 `systemPrivacy`
   - 超时：3 秒，超时返回 `status: timeout`，不让请求失败
   - 权限不足：返回 `status: access_denied`，macOS `EPERM` 时带 `systemPrivacy: true`
   - 隐藏文件夹：名字以 `.` 开头，或在固定名单（`$Recycle.Bin`、`System Volume Information`、`$WinREAgent`、`Config.Msi`、`Recovery`、用户目录下的 `AppData`）；`includeHidden` 为 true 时返回并标 `hidden: true`
   - 一层最多返回 200 个文件夹，同时按字节截断（先到哪个算哪个）；单个名字超 255 字节跳过并计数到 `skipped`
   - 符号链接：需要 `stat` 才知道是否是文件夹，算一次读取
   - **不打开子文件夹**：只列当前层，每个文件夹不带能不能打开

2. **限流（防止卡住 libuv 线程池）**：
   - Host 和 Node 各自同时最多 2 个未返回的浏览读取
   - 同一个规范化路径已有未返回的读取时，直接返回 `status: timeout`（不等第二个）
   - 名额占满时新请求立刻失败，`code: unavailable`、`reason: runtime_unavailable`
   - 见 08 §3.3"不能拖住其他读写"的完整分析

3. **游标**：
   - 格式 `fld_` 加一段，对应路径和 `includeHidden` 参数
   - 游标只在同一次列表里有效，不长期保存状态
   - 过期后重新从这一层开头列

4. **帧大小**：
   - 返回给手机和平板时，行数据 ≤ 12 KiB
   - 返回给 Node 再转回电脑时，整帧 ≤ 16 KiB（`path` 和 `parent` 各可到 4096 字节，外壳另计）
   - 两个预算分开算，不能照搬 12 KiB

5. **Windows 盘符**（08 §6 第 4 项）：
   - 列根目录时带 `drives`，每项是 `letter`（如 `C:`）和可选 `label`
   - 不能逐个 `stat` A-Z（断开的网络盘会卡线程）
   - 用一次有时限的系统命令取盘符，不经过线程池；命令由你选，在报告里说明
   - `label` 能顺带拿到就带，拿不到就不带

6. **Windows 隐藏文件夹**（08 §6 第 4 项）：
   - `fs.Stats` 不带 Windows 文件属性，没有现成接口
   - 只按名字判断：以 `.` 开头，或在固定名单里（见第 1 项）
   - 少数用户自己设成隐藏的文件夹会显示出来，这是可以接受的

7. **经由电脑访问的设备**（08 §3.5）：
   - 平板/iPad 请求 `folder.list` 时，如果 `machineId` 是远程设备的，请求要经由那台电脑的 Node 转发
   - Node 侧实现 `folder.list` 操作（和 Host 侧逻辑相同）
   - 电脑作为中间人，把平板的请求转发给 Node，把 Node 的响应转回平板

8. **Rust 核心方法**：
   - `packages/supervisor-mobile/src/lib.rs` 增加 `folder_list` 函数（通过 UniFFI 暴露）
   - Kotlin 调用层增加对应调用
   - iOS Swift 层目前无仓库，只在报告里说明接口签名

9. **文案规则**（06 §1、08 §1）：
   - 界面上不出现 Host、Node、Machine、Supervisor、Relay 等技术术语
   - 错误文案按 08 §1 的规定，例如：
     - macOS 被系统拒绝（`systemPrivacy: true`）："没有权限打开这个文件夹。请在 Mac 的'系统设置 › 隐私与安全性 › 文件和文件夹'里，允许 CodeTether 访问，然后重试。"
     - macOS 超时："Mac 上可能弹出了授权窗口。请在 Mac 上点'允许'，然后重试。"
     - 普通权限不足："没有权限打开这个文件夹。"
     - 超时（其他系统）："这个文件夹读取超时，可能是网络盘。可以重试。"
     - 名额占满："这台电脑正在等其他文件夹的授权或读取，请稍后再试。"

**应该完成**：

10. **电脑上的浏览入口**（08 §3.7）：
    - 桌面端给配对设备添加项目时，改为可以浏览文件夹（和本机一样）
    - 手动输入路径保留作为浏览的补充
    - 位置：`apps/web/src/components/projects/add-project-fields.tsx:193`

## 已知情况

- 现在配对设备只能输入完整路径（`add-project-fields.tsx:193`）
- Node 侧只有单个路径的校验 `project_location.validate`，没有列目录的能力
- libuv 线程池默认 4 个线程，整个进程共用（详见 08 §3.3"不能拖住其他读写"）
- macOS TCC 授权：Host 是桌面应用的 sidecar，Node 是 launchd 单独启动的服务，授权分开记（08 §3.3）
- 这轮在 Mac 上运行，可以实测 macOS 的授权弹窗行为

## 边界

**自己决定**：
- Windows 盘符的获取命令（`wmic`、`Get-PSDrive`、`vol` 或其他；在报告里说明）
- 游标的具体实现（内存缓存还是 HMAC）
- 经由电脑访问的设备的转发实现方式

**先问用户**：
- 需要改 `main` 以外的基础设施
- 需要改已冻结的 Phase 边界

**不做**：
- `provider-sessions.discover`、`provider-sessions.adopt`（B4c）
- T1b 和 iPad 的添加项目界面（B4 三轮都合进 `main` 以后做）
- 读取或打印凭据
- 推送 `main`、合并、打标签

## 报告

追加到 `~/agenthub-archive/b4b-report.md`（新文件）：

- 1 到 10 每一项改了什么、对应的提交
- Windows 盘符的获取命令选择和理由
- macOS TCC 授权的实测结果（哪些文件夹会触发弹窗、Node 是否单独授权）
- 帧大小实测（12 KiB 预算下每层最多几个文件夹、Windows 盘符列表的大小）
- 限流的实现方式（计数器在哪里、怎么释放）
- Rust 函数签名（方便 iOS 后续实现）
- Kotlin 调用层改动
- typecheck / lint / Rust / Android / build / test 结果
- 推送后的远端提交
- 没做完的事和原因

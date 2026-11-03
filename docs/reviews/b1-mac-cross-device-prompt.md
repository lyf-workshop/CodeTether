# 任务：B1 跨设备验收（Mac 当新设备）

在 Mac 上运行。等 Windows 上的 `b1-pairing-fix-prompt-r1.md` 做完、`b1/pairing-remote-control` 推送到 origin 以后再开始。依据：`docs/ux-redesign/06-pairing-remote-control.md` §4 最后一项，Windows 报告 `D:/Projects/Software/agenthub-archive/b1-report.md` 的“实机步骤”2、3（用户会把要点转给你）。

开始前确认这份文件有 4 个二级标题，最后一节是“报告”。

## 目标

Windows 当电脑，Mac 用开发诊断页 `#/dev/supervisor-check` 当新设备，验证：

1. **配对**：Windows 生成配对码，Mac 在诊断页输入，显示已连接。Windows 设备页“手机和平板”出现这台 Mac，名称和平台（`macOS-arm64`）正确。
2. **只走 Relay**：诊断页选“只走 Relay”，原来 7 项读取和 `conversation.recent`、`attention.list`、`conversation.changes` 都通过。
3. **写操作和能力门控**：用户在 Windows 上准备一个测试 Turn 和一个测试待处理后，Mac 做一次 `attention.resolve` 和一次 `turn.interrupt`。不支持的 AI 工具不出现批准和停止。
4. **上次使用**：Windows 设备页里这台 Mac 的“上次使用”更新了。
5. **移除**：Mac 保持一条已连接的会话，用户在 Windows 设备页移除这台 Mac。记下几秒断开、Mac 再连时的错误，以及 Windows 上的测试工作是否继续运行。
6. **重新配对**：移除后用新的配对码再配一次，能连上。最后在 Windows 上移除，不留测试授权。

## 已知情况

- **代码**：`git fetch origin`，在 `origin/b1/pairing-remote-control` 上新建一个干净的工作区，例如 `~/agenthub-work/b1-mac-check`。不动 Mac 上已有的工作区和它们的未提交改动。
- **开发版**：
  - 构建配置用 `set -a; . ~/agenthub-work/v4-build.env; set +a` 在启动的 shell 里加载，不打印内容。
  - 另外设 `CODETETHER_CONTROL_PLANE_URL=https://api.codetether.org`、`VITE_CODETETHER_SUPERVISOR_CHECK=1`，`CODETETHER_DATA_DIR` 指向一个新的独立目录，例如 `~/agenthub-work/b1-mac-check-data`。
  - 启动：`apps/desktop` 下 `node scripts/run-tauri.mjs dev --config src-tauri/tauri.dev.conf.json`。
  - Host sidecar 用核对过 SHA256 的官方 Node 打，版本和 Mac 第 8 轮相同。第 7 轮用 `/tmp` 里的 Node 25.5.0 打过，Host 起不来。
  - 开发版和安装版都用 4317。先用 `osascript -e 'quit app "CodeTether"'` 退出安装版，测完用 `open -a /Applications/CodeTether.app` 重新打开。
- **设备身份**：Mac 用自己现有的设备身份登录同一账号。没有的话，在诊断页主窗口勾选注册。
- **要用户在 Windows 上做的**（到这一步时停下来告诉用户，等用户回复）：
  - 从托盘退出 Windows 安装版，用 `windows-dev-launch.mjs` 启动 B1 开发版；
  - 让控制服务临时放开 `http://127.0.0.1:5173`（Mac 开发版也是这个来源），用 `b1-logs/control-plane-test-origin*.py`，测完恢复；
  - 打开“添加设备 › 添加手机或平板”，把 6 位码告诉你，并保持窗口开着直到显示“已添加”；
  - 准备测试 Turn 和测试待处理，最后做移除。
- 日志脱敏时保留 `[codetether:host]` 开头的报错行。

## 注意事项

- 不读 `.secrets/`、其他 `.env`、凭据文件、`~/.codex/auth.json` 和 `~/.claude.json`。`v4-build.env` 只按上面的方法加载。
- 不动 Mac 安装版的数据目录。写操作只用用户准备的测试目标。

## 报告

追加到 `~/agenthub-archive/v4-acceptance-report-mac.md`，新开一节“B1 跨设备”：

- 用的提交、Node 版本和它的 SHA256；
- 目标 1 到 6 每项的结果和依据（日志或只截 CodeTether 窗口的截图）；
- 移除的断开秒数和再连时的错误；
- 没做完的事和原因。

# 任务：B4 Mac 文件夹授权实测

在 Mac 上运行。这是设计前的实测，不是 B4 的实现：测完只交报告，不改任何设计文档，不合并代码。

开始前确认这份提示词有 4 个二级标题，最后一节是“报告”。

## 目标

背景：CodeTether 的下一步（B4）要让平板远程浏览电脑上的文件夹。在 Mac 上读文件的进程有两个，macOS 对“桌面”“文稿”“下载”这类受保护的文件夹会弹授权窗口，现在不知道弹窗时读取会怎样，也不知道授权记在哪个进程名下。要实测，结果决定 B4 怎么设计超时、限流和提示文案。

- **Host**：桌面应用 `CodeTether.app`（标识 `com.codetether.desktop`，ad-hoc 签名）拉起的 Node SEA 子进程。浏览这台 Mac 自己的文件夹时用它。
- **CodeTether Node**：launchd 单独启动的用户服务 `com.codetether.node`，程序在 `~/Library/Application Support/CodeTether/Node/bin/codetether-node`，没有应用包，构建时 ad-hoc 签名。从别的电脑浏览这台 Mac 时用它。预计授权按程序路径记录。

回答下面 7 个问题。Host 和 Node 各测一遍，桌面、文稿、下载至少各测一次。

1. **只看属性会不会弹窗**：对受保护的文件夹本身和它里面的子文件夹做 `stat` 和 `access(R_OK | X_OK)`，不 `readdir`、不打开。有没有弹窗；结果里能不能看出没有权限。
2. **读取会不会一直阻塞**：`readdir` 从调用到返回多久；弹窗是在调用还没返回时出现，还是返回后才出现；不点的话会不会一直不返回。
3. **拒绝后再读**：点“不允许”后立刻再读同一个文件夹，是马上失败（记下错误码），还是又弹一次、又阻塞。
4. **授权记在哪里**：Host 的允许是不是记在 `com.codetether.desktop` 上；进程重启后还在不在；重新构建（ad-hoc 签名变了）后会不会失效，失效时是再弹窗还是直接拒绝。
5. **卡住时占不占线程**：一个读取卡在弹窗上时，同一进程里 `fs.promises.stat('/tmp')` 和 `dns.promises.lookup('localhost')` 要多久；4 个读取同时卡住时，这两个是不是停到点完弹窗才返回。（Node.js 的文件操作和 `dns.lookup` 共用默认 4 个线程的线程池，这一项验证卡住的读取会不会拖住其他操作。）
6. **Node 会不会弹窗**（只测 Node）：launchd 启动、没有应用包的程序读受保护的文件夹时，是弹窗（窗口上写的名字是什么）、直接拒绝，还是一直阻塞。拒绝后，在系统设置的哪里能重新允许。
7. **Node 更新后**（只测 Node）：同一路径换成内容不同的程序（签名跟着变）后，之前的允许还在不在。同一个程序复制到另一个路径，算不算新程序。

另做一个对照：在 `/tmp` 下建一个 `chmod 000` 的文件夹，`readdir` 记下错误码，用来和问题 3 的错误码对比，看授权拒绝和普通权限不足能不能区分。

## 怎么测

**探针必须跑在被测的进程里。** 系统按“负责的进程”记授权：终端拉起的进程算终端的，`tauri dev` 和从终端直接运行 `.app` 里的程序也算终端的。所以：

- Host：在 Host 进程里加一个只用于这次实测的探针。用构建好的 `CodeTether.app`，通过 `open` 打开，让应用照常拉起 Host。确认 `Info.plist` 里的标识是 `com.codetether.desktop`，`codesign -dv` 记下 CDHash。
- Node：用加了同一探针的 `codetether-node`，由 launchd 作为 LaunchAgent 启动，不从终端运行。
- 文件操作用 `fs.promises`，走进程正常的线程池。每次记开始和结束时间、耗时、结果或错误码（`EPERM`、`EACCES` 等）。问题 5 的“卡住”用 3 秒 `Promise.race` 模拟超时，超时后继续观察那次调用实际什么时候返回。
- 怎么把操作交给探针，你自己定。建议探针每 500 ms 看一次一个测试目录下的请求文件，执行后写结果文件，这样终端只写请求，文件操作发生在被测进程里。测试目录放在 `~/agenthub-work/b4-tcc/` 下，不放进受保护的文件夹。探针只在测试目录存在时启用，只操作请求里给的路径。

**代码**：`git fetch origin`，从 `origin/main`（`b668e53`）新建本地分支 `spike/b4-mac-folder-access`，工作区 `~/agenthub-work/b4-mac-folder-access`，不动 Mac 上已有的工作区和它们的未提交改动。不推送，不合并。测完把改动存成 `~/agenthub-archive/b4-mac-folder-access.patch`。

**构建**：

- 构建配置用 `set -a; . ~/agenthub-work/v4-build.env; set +a` 在构建的 shell 里加载，不打印内容。
- Host：在仓库根目录运行 `pnpm desktop:build`，产物是 `apps/desktop/src-tauri/target` 下的 `CodeTether.app`。Host sidecar 用核对过 SHA256 的官方 Node 打，版本和之前 Mac 验收时相同；用别的 Node 版本打过 Host 起不来。
- Node：`pnpm node:sea`，产物在 `apps/node/dist/sea/`，构建脚本会做 ad-hoc 签名（`apps/node/scripts/build-node.mjs`）。

**Host 的隔离**：

- 不替换 `/Applications/CodeTether.app`。实测的 app 放在工作区里打开。
- 实测的 app 不能用正式数据目录 `~/Library/Application Support/CodeTether`。可以在 spike 里改默认目录，或者用 `launchctl setenv CODETETHER_DATA_DIR ...` 后再 `open`（桌面应用在 `apps/desktop/src-tauri/src/system_tray.rs:180` 读这个变量），测完 `launchctl unsetenv`。
- 两个版本都用 4317 端口。先用 `osascript -e 'quit app "CodeTether"'` 退出安装版，测完用 `open -a /Applications/CodeTether.app` 重新打开。

**Node 的隔离**：

- 不动正式的 `com.codetether.node` 服务、它的程序、数据目录和配对。
- 实测的 Node 放在新路径，例如 `~/agenthub-work/b4-tcc/node-r1/bin/codetether-node`，用自己的数据目录和标签（例如 `com.codetether.node.b4probe-r1`），plist 照正式那份的参数写（见 `apps/node/src/service-installation.ts` 的 plist 模板：`--data-dir`、`--bind 127.0.0.1`、`--port 0`，`RunAtLoad`），用 `launchctl bootstrap gui/$(id -u)` 启动。它不需要配对。
- 每测一轮换一个新路径和新标签。新路径对系统来说是没有记录的新程序，这样不用清系统的授权记录。问题 7 会检验这个假设；如果发现授权不按路径记录，停下来告诉用户，不要改用清整类授权的办法。

**清旧记录**：只对 Host 用，开始前和测完各跑一次。先告诉用户这会同时清掉已安装的 CodeTether 对这三个文件夹的授权，以后安装版会再问一次。

```bash
tccutil reset SystemPolicyDesktopFolder com.codetether.desktop
tccutil reset SystemPolicyDocumentsFolder com.codetether.desktop
tccutil reset SystemPolicyDownloadsFolder com.codetether.desktop
```

**顺序**：Host 和 Node 各按下面走一遍。

1. 请用户在访达里建好 `~/Desktop/b4-probe/child`、`~/Documents/b4-probe/child`、`~/Downloads/b4-probe/child`，再各建两个空子文件夹 `a`、`b`。用访达建，免得终端自己弹授权窗口。
2. 桌面（拒绝）：问题 1，然后对 `~/Desktop/b4-probe` 做 `readdir`。先只让这一个卡着，量问题 5 的 `stat` 和 `dns.lookup`；再对 `child`、`a`、`b` 各发一个 `readdir`，凑满 4 个，再量一次。请用户至少等 20 秒再点“不允许”，记下各个调用实际返回的时间。然后立刻再读一次（问题 3）。
3. 文稿（允许）：`readdir ~/Documents/b4-probe`，请用户等 5 秒后点“允许”。然后重启被测进程（Host 退出再打开实测 app；Node 用 `launchctl kickstart -k`）再读（问题 4）。
4. 重新构建：做一个不影响行为的小改动重新构建，确认 CDHash 变了。Host 换成新 app 打开；Node 在同一路径换上新程序后 `kickstart`。再读文稿（问题 4、7）。
5. 只测 Node：把第 3 步被允许过的那个程序原样复制到新路径、新标签，再读文稿（问题 7）。
6. 下载：再走一遍问题 1 和问题 2，点“允许”，确认和桌面、文稿一致。
7. 只测 Node：记下弹窗上写的名字。拒绝和允许之后，请用户在“系统设置 › 隐私与安全性 › 文件和文件夹”和“完全磁盘访问权限”里找这个程序，记下在哪里能看到、能不能在那里改（问题 6）。

**要用户做的**（到这一步时停下来告诉用户，等用户回复）：建测试文件夹；每次弹窗前说清楚要等几秒、点哪个按钮；问题 6、7 去系统设置里看。

**收尾**：

- `launchctl bootout` 所有实测的 Node 标签，删掉它们的 plist、程序和数据目录；删掉实测 app 的构建产物。
- 再跑一次上面的 `tccutil reset`，重新打开安装版。
- 确认正式的 `com.codetether.node` 仍在运行（`launchctl print gui/$(id -u)/com.codetether.node`），并请用户确认 Windows 设备页上这台 Mac 仍在线。
- 测试文件夹和系统设置里残留的实测程序条目，问用户要不要删。

## 注意事项

- 不读 `.secrets/`、其他 `.env`、凭据文件、`~/.codex/auth.json` 和 `~/.claude.json`。`v4-build.env` 只按上面的方法加载。
- 你自己的命令不要直接读 `~/Desktop`、`~/Documents`、`~/Downloads` 里的内容，也不要用终端 `ls` 它们。否则授权记到终端名下，测不出被测进程的行为。需要看结果时读探针写出的结果文件。
- `launchctl`、`open`、`tccutil`、`codesign` 需要在不受沙箱限制的环境运行。如果被拦住，停下来告诉用户，不要绕开。
- 不直接读写 `TCC.db`，不给终端开完全磁盘访问权限，不跑不带应用标识的 `tccutil reset`（那会清掉所有程序的授权）。
- 截图只截授权窗口和系统设置里相关的那一栏，不截其他窗口。
- 探针代码只在 spike 分支上，不进入任何要合并的分支。

## 报告

写到 `~/agenthub-archive/b4-mac-folder-access.md`：

- 用的提交、`sw_vers` 的输出、芯片型号、打 SEA 用的 Node 版本和 SHA256、每个被测程序的标识和 CDHash（重新构建前后各一个）。
- 一张表：问题 × 进程（Host / Node）× 文件夹，每格写操作、结果或错误码、耗时（毫秒）、有没有弹窗和弹窗出现的时刻。
- 问题 5 的 `stat` 和 `dns.lookup` 耗时：没有卡住时、卡住 1 个时、卡住 4 个时。
- `chmod 000` 对照的错误码。
- 弹窗截图和弹窗上的名字，问题 6 在系统设置里的位置。
- 每个问题一句结论，只写看到的现象，不写设计建议。
- 没做完的事和原因，收尾做了哪些。

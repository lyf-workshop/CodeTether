# CodeTether UX 重设计 v2（设计交付）

状态：设计提案，按已验收基线 `bbcda690a081` 校正。v2 换成**浅色为主、深色可切换**的主题，并重做了全部页面。**尚未写入 Figma**（会话中没有 Figma 写入工具，见 02 文档开头），未开始生产前端重构。

| 文件 | 内容 |
|---|---|
| [01-feature-inventory-and-mapping.md](01-feature-inventory-and-mapping.md) | 关键事实、功能盘点 F01–F68、旧入口 → 新入口 → 原型截图 → 源码 |
| [02-dev-handoff.md](02-dev-handoff.md) | 信息架构、视觉规范（浅色/深色 Token）、组件、状态表达、能力门控、数据依赖、待确认事项、Figma 写入计划、实现顺序 |
| [overview.html](overview.html) | 81 张截图总览（`png/00-overview.png` 为整页图） |
| `prototype/index.html` | 本地可点击原型（浏览器直接打开；演示数据，不调用任何真实接口） |
| `export-png.sh` | 重新导出 `png/`（需要 Chrome，约 1 分钟） |

## 打开原型

直接用浏览器打开 `prototype/index.html`（file://，不访问网络）。URL 参数：

- `?theme=light|dark|system`：主题，默认浅色；也可以在 设置 › 外观 或 Ctrl K 里切换，选择会记在 localStorage。
- `?os=win|mac`：标题栏样式（Windows 窗口控制 / mac 红绿灯）与平台文案。
- `?modal=new|palette|rename:c3|unpair:m-mac|addr:m-mac|addloc|addproj`：直接打开某个浮层。
- 快捷键：Ctrl K 命令面板，Ctrl N 新建会话，Esc 关闭浮层。

## 检查流程（hash 路由）

1. 首次启动 → 首页：`#/onboarding?step=welcome` … `step=ready` → `#/home`
2. 首页 → 处理审批 → 会话：`#/home` 的“需要你处理” → `#/c/c1`（等待批准）→ `#/c/c1?panel=files&tab=changes`
3. 找回会话：`#/sessions`（筛选）→ `#/search`（项目内搜索）→ 会话；或 Ctrl K
4. 我的电脑 → 电脑详情 → 新建会话：`#/computers` → `#/computers/m-mac` → “新建会话”（预选这台电脑）
5. 其他主机（仅查看）：`#/computers/h-studio` → `#/c/rc1`（没有输入框，底部说明）
6. 添加电脑：`#/add` → `#/add/desktop`（登录并申请查看）或 `#/add/node?step=1` … `step=4`（配对服务器）
7. 设置：`#/settings/appearance` · `account` · `notify` · `background` · `about`；`#/roadmap` 为后续规划（与当前功能隔离）

状态演示参数：`#/home?state=loading|empty|error`、`#/inbox?f=none`、`#/sessions?view=archived`、`#/computers?account=out`、`#/computers?scroll=more`、`#/computers/m-linux`（离线）、`#/computers/m-mac?proj=error`、`#/computers/h-office`（无法连接）、`#/computers/h-lab`（等待批准）、`#/c/rc1?live=disconnected`、`#/c/c4`（离线且失败）、`#/c/c5`（导入的会话）、`#/signin?step=email|code|unconfigured`、`#/settings/account?host=disabled|enabled_unclaimed|claimed`。

旧路由（`#/devices`、`#/hosts`、`#/pair`、`#/connect`、`#/account`、`#/doctor`）会重定向到新路由。

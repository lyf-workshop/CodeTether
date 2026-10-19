# CodeTether UX 重设计 v4（设计交付）

状态：设计提案，按已验收基线 `bbcda690a081` 校正。v4 把信息架构改成 **账号 › 设备 › 项目 › 会话**：登录后看到自己的设备，每台设备列出它上面的项目，一个项目就是那台设备上的一个文件夹。只画后端已经支持的能力；浅色为主、深色可切换的视觉沿用 v2。**尚未写入 Figma**（会话中没有 Figma 写入工具，见 02 文档开头），未开始生产前端重构。

| 文件 | 内容 |
|---|---|
| [01-feature-inventory-and-mapping.md](01-feature-inventory-and-mapping.md) | 关键事实、前端审核、功能盘点 F01–F68、旧入口 → 新入口 → 原型截图 → 源码 |
| [02-dev-handoff.md](02-dev-handoff.md) | 信息架构、视觉规范（浅色/深色 Token）、组件、状态表达、能力门控、数据依赖、待确认事项、Figma 写入计划、实现顺序 |
| [overview.html](overview.html) | 82 张截图总览（`png/00-overview.png` 为整页图） |
| `prototype/index.html` | 本地可点击原型（浏览器直接打开；演示数据，不调用任何真实接口） |
| `export-png.sh` | 重新导出 `png/`（需要 Chrome，约 1 分钟） |

## v4 相对 v3 的变化

v3 让一个项目挂多台电脑上的文件夹（项目 › 文件夹 › 会话），还有“其他主机 · 仅查看”。这不是现在的目标，v4 改为：

- **设备优先**：侧栏和起始页 `#/devices` 按设备列出，设备下面是它的项目，项目下面是会话。一个项目只属于一台设备（`ProjectRecord` + 那台设备上唯一的 `ProjectLocation`），界面上不再有“文件夹”这一层，也不能给项目再加另一台设备上的位置。
- **不做只读设备**：去掉“其他主机 · 仅查看”、访问申请、“允许其他电脑查看这台电脑”。设备只有两种，都能完整使用：这台电脑，和用 CodeTether Node 配对的设备。
- **选文件夹就找回以前的会话**：添加项目后立即扫描这个文件夹里的 Codex / Claude Code 会话（`provider-sessions`），在同一个弹窗里勾选导入；项目页也有“以前的会话”一节，可以重新扫描。这台电脑和 Node 配对的设备都支持。
- 同一账号下的其他 Mac / Windows 桌面版、Windows 配对，后端目前做不到完整控制，放到 `#/roadmap`，不在主流程里出现。

## 打开原型

直接用浏览器打开 `prototype/index.html`（file://，不访问网络）。URL 参数：

- `?theme=light|dark|system`：主题，默认浅色；也可以在 设置 › 外观 或 Ctrl K 里切换，选择会记在 localStorage。
- `?os=win|mac`：标题栏样式（Windows 窗口控制 / mac 红绿灯）与平台文案。
- `?modal=…`：直接打开某个浮层。
  - `addproj`：添加项目（选设备）；`addproj:m-mac` 固定设备；`addproj:m-local:found` 直接看“找到以前的会话”这一步。
  - `new`：新建会话；`new~p-web` 预选项目（侧栏按钮、Ctrl N 的行为），`new:p-web` 固定项目，`new@m-mac` 预选这台设备上第一个可用的项目。
  - `rmproj:p-docs` 移除项目（有会话时只说明原因）；`unpair:m-mac` 取消配对（设备上还有项目时只说明原因）；`addr:m-mac` 更新地址。
  - `palette`、`rename:c3`。
- 快捷键：Ctrl K 命令面板，Ctrl N 新建会话（预选当前项目），Esc 关闭浮层。

## 检查流程（hash 路由）

1. 首次启动：`#/onboarding?step=welcome` … `step=project`（选文件夹）→ `step=previous`（找到以前的会话）→ `step=ready` → `#/devices`
2. 看到所有设备：`#/devices`，每台设备一节，列出它的项目卡片（会话数、进行中、可导入数）
3. 添加项目并找回以前的会话：设备节或侧栏设备行的“+” → 选文件夹 → “已添加 …，找到 N 个以前的会话” → 导入所选 → 进入项目
4. 项目里的以前的会话：`#/projects/p-web` 底部“以前的会话” → 勾选 → 导入所选；也可以重新扫描
5. 在项目里新建会话：侧栏项目行的“+”或项目页“新建会话” → 选 AI 工具 → 创建后进入会话
6. 处理审批：`#/inbox` → `#/c/c1`（等待批准）→ `#/c/c1?panel=files&tab=changes`
7. 找回会话：`#/projects/p-api/search?q=重试`（标题和你发送过的内容，只在一个项目里）；`#/projects/p-api?view=archived`；或 Ctrl K 按标题
8. 添加设备：`#/add` → `#/add/node?step=1` … `step=4`（Node 配对，完成后添加项目）
9. 设置：`#/settings/appearance` · `account` · `notify` · `background` · `about`；`#/roadmap` 为后续规划（与当前功能隔离）

状态演示参数：`#/devices?state=loading|empty`、`#/devices/m-linux`（离线）、`#/devices/m-local?proj=error`（项目列表读取失败）、`#/projects/p-docs`（文件夹无法访问）、`#/projects/p-ml`（设备离线）、`#/inbox?f=none`、`#/c/c4`（离线且失败）、`#/c/c5`（导入的会话）、`#/settings/account?account=out`、`#/signin?step=email|code|unconfigured`。

旧路由（`#/home`、`#/sessions`、`#/search`、`#/projects`、`#/computers`、`#/computers/:id`、`#/hosts`、`#/pair`、`#/connect`、`#/add/desktop`、`#/account`、`#/doctor`）会重定向到新路由。

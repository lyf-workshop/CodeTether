# CodeTether UX 重设计（设计交付）

状态：设计提案，按已验收基线 `bbcda690a081` 校正。**尚未写入 Figma**（会话中没有 Figma 写入工具，见 02 文档开头），未开始生产前端重构。

| 文件 | 内容 |
|---|---|
| [01-feature-inventory-and-mapping.md](01-feature-inventory-and-mapping.md) | 关键事实、功能盘点 F01–F68、旧入口 → 新入口 → 原型 Frame → 源码 |
| [02-dev-handoff.md](02-dev-handoff.md) | 信息架构、组件复用、状态表达、能力门控、三条连接流程、数据依赖 D1–D10、Figma 写入计划、实现顺序 |
| [overview.html](overview.html) | 64 张页面截图总览（`png/00-overview.png` 为整页图） |
| `prototype/index.html` | 本地可点击原型（浏览器直接打开；演示数据，不调用任何真实接口） |
| `export-png.sh` | 重新导出 `png/` |

## 6 条检查流程（原型 hash 路由）

1. 首次进入 → 找到设备 → 查看会话：`#/onboarding` → `#/devices` → `#/devices/m-mac` → `#/c/c2`
2. 会话首页 → 搜索/筛选 → 打开会话：`#/sessions` → `#/search` → `#/c/c3`
3. 本地会话 ↔ 远程只读会话：`#/c/c1` ↔ `#/hosts/h-studio/c/rc1`
4. 多 Machine 切换 → 项目 → 会话：`#/devices/m-local` 顶部 Machine 切换 → `#/projects/p-web` → 会话；其他主机：`#/hosts/h-studio?m=hm-2`
5. 待处理 → 对应页面：`#/inbox` → 会话
6. 设备连接与设置：`#/connect`（Desktop 主机 / Node / 已在列表）→ `#/pair?step=1`；`#/settings/account` → `#/account`

状态演示参数：`#/devices?account=out`、`#/hosts/h-office`、`#/hosts/h-studio/c/rc1?live=disconnected`、`#/account?step=unconfigured`、`#/sessions?state=error`、`#/roadmap`。

// 平板原型的演示数据。字段含义对齐 packages/protocol（MachineSummary / ProjectRecord / ConversationSummary / Attention）。
// 平板是遥控端：它配对过两台电脑；build-server 是 Windows 台式机用 Node 配对的设备，经由台式机访问。
window.DEMO = {
  account: { email: 'lin@example.com' },
  tablet: { name: 'Pixel Tablet', platform: 'Android 15' },
  // link：same_network 同一网络直连，internet 经互联网（Relay，界面上不出现这个词）
  machines: [
    { id: 'm-win', name: 'Windows 台式机', icon: 'monitor', os: 'Windows 11 · x64', conn: 'online', link: 'same_network', paired: '10月21日', used: '刚刚',
      tools: { codex: 'ok', claude: 'ok' } },
    { id: 'm-linux', name: 'build-server', icon: 'server', os: 'Ubuntu 24.04 · x64', conn: 'online', via: 'm-win',
      tools: { codex: 'ok', claude: 'missing' } },
    { id: 'm-mac', name: 'MacBook Pro', icon: 'laptop', os: 'macOS 15 · arm64', conn: 'offline', seen: '2 小时前', link: 'internet', paired: '10月22日', used: '昨天',
      tools: { codex: 'ok', claude: 'login' } },
  ],
  projects: [
    { id: 'p-web', name: 'CodeTether', m: 'm-win', path: 'D:\\Projects\\Software\\agenthub' },
    { id: 'p-scripts', name: 'scripts', m: 'm-win', path: 'D:\\Projects\\scripts' },
    { id: 'p-ml', name: 'model-eval', m: 'm-linux', path: '/srv/work/model-eval' },
    { id: 'p-api', name: 'payments-api', m: 'm-mac', path: '/Users/lin/work/payments-api' },
  ],
  // status：idle | running | waiting（等待批准）| completed | failed。ago 只用来排序（分钟）
  conversations: [
    { id: 'c1', title: '修复会话列表在窄窗口下的截断问题', agent: 'codex', p: 'p-web', status: 'waiting', at: '刚刚', ago: 0 },
    { id: 'c8', title: '给备份脚本加上失败重试', agent: 'codex', p: 'p-scripts', status: 'running', at: '刚刚', ago: 1, step: '正在编辑 backup.ps1', elapsed: '已运行 4 分钟' },
    { id: 'c12', title: '分析评测流水线的显存峰值', agent: 'codex', p: 'p-ml', status: 'running', at: '2 分钟前', ago: 2, step: '正在运行 python profile.py', elapsed: '已运行 9 分钟' },
    { id: 'c9', title: '把设置页拆成独立路由', agent: 'codex', p: 'p-web', status: 'completed', at: '1 小时前', ago: 60, pinned: true },
    { id: 'c2', title: '评审 Webhook 重试的退避策略', agent: 'claude', p: 'p-api', status: 'completed', at: '2 小时前', ago: 120 },
    { id: 'c3', title: '重构支付回调签名校验', agent: 'codex', p: 'p-api', status: 'failed', at: '2 小时前', ago: 125, failure: 'provider_exited' },
    { id: 'c11', title: '整理备份脚本的参数说明', agent: 'claude', p: 'p-scripts', status: 'completed', at: '3 小时前', ago: 180 },
    { id: 'c5', title: '梳理 AI 工具安装检测的文档缺口', agent: 'claude', p: 'p-web', status: 'idle', at: '昨天', ago: 1600, imported: true },
    { id: 'c13', title: '训练日志的字段说明', agent: 'codex', p: 'p-ml', status: 'completed', at: '昨天', ago: 1700 },
    { id: 'c6', title: '升级 TanStack Router 并处理类型告警', agent: 'codex', p: 'p-web', status: 'completed', at: '10月14日', ago: 4000 },
    { id: 'c7', title: '旧版 CI 迁移草稿', agent: 'codex', p: 'p-web', status: 'completed', at: '9月30日', ago: 20000, archived: true },
  ],
  attention: [
    { id: 'a1', type: 'approval', c: 'c1', at: '1 分钟前', cmd: 'pnpm --filter @codetether/web test' },
    { id: 'a2', type: 'completed_review', c: 'c11', at: '3 小时前' },
    { id: 'a3', type: 'failed', c: 'c3', at: '2 小时前' },
  ],
};
window.FAIL = {
  provider_exited: ['Codex 在运行中退出了', '可以重试。重试是新的一轮，不会重复执行已经做过的操作。'],
};
// 会话时间线。没有列出的会话用 DEFAULT_MSGS
window.MSGS = {
  c1: [
    { u: '会话列表在窗口宽度小于 1000 的时候，标题被截断得太早，右边的时间也换行了。帮我修一下。' },
    { a: '我先看一下列表行的布局和窄窗口下的样式。', tools: [['file', '读取', 'conversation-row.tsx'], ['file', '读取', 'workspace-responsive.css']] },
    { a: '原因是时间列用了固定宽度，标题列没有设置 min-width: 0，所以在 flex 布局里不能收缩。我改了两处，接下来跑一下 web 的测试。',
      tools: [['edit', '修改', 'conversation-row.tsx', '+6 −2'], ['edit', '修改', 'workspace-responsive.css', '+3 −1']] },
  ],
  c8: [
    { u: 'backup.ps1 在网络盘断开的时候直接失败了。加上重试，最多 3 次，每次间隔翻倍。' },
    { a: '好的。我先读一下现在的脚本。', tools: [['file', '读取', 'backup.ps1']] },
    { a: '正在给复制步骤加上重试和退避……', tools: [['edit', '修改', 'backup.ps1', '进行中']] },
  ],
  c12: [
    { u: '评测流水线跑到第三个数据集时显存会涨到 22 GB，帮我找出是哪一步。' },
    { a: '我先跑一遍带显存采样的版本。', tools: [['terminal', '运行', 'python profile.py --sample-memory']] },
  ],
  c3: [
    { u: '把支付回调的签名校验改成常量时间比较，并补上过期时间戳的测试。' },
    { a: '我先找一下现在的校验代码。', tools: [['search', '搜索', 'verifySignature']] },
  ],
  c5: [
    { imported: 'Claude Code' },
    { u: '看一下 AI 工具安装检测的文档，有哪些情况没写到？' },
    { a: '一共有 3 处缺口：没写 Claude Code 装在 nvm 目录时的检测方式；没写检测超时的处理；“能运行”和“已登录”的区别没有说明。' },
  ],
};
window.DEFAULT_MSGS = [
  { u: '帮我看一下这里的实现。' },
  { a: '已经看完了，结论写在下面。这一轮已完成。' },
];
window.DIFF = [
  { f: 'apps/web/src/components/conversation-row.tsx', add: 6, del: 2, lines: [
    ['at', '@@ -18,9 +18,13 @@'], ['', '  return ('], ['d', '    <div className="row">'], ['a', '    <div className="row min-w-0">'],
    ['a', '      <span className="title truncate">{title}</span>'], ['d', '      <span className="title">{title}</span>'],
    ['a', '      <time className="shrink-0 tabular-nums">'], ['a', '        {formatTime(at)}'], ['a', '      </time>'], ['', '    </div>'] ] },
  { f: 'apps/web/src/styles/workspace-responsive.css', add: 3, del: 1, lines: [
    ['at', '@@ -42,6 +42,8 @@'], ['', '@media (max-width: 1000px) {'], ['d', '  .row time { width: 96px; }'],
    ['a', '  .row time { width: auto; }'], ['a', '  .row .title { min-width: 0; }'], ['a', '  .row { gap: 8px; }'], ['', '}'] ] },
];
// 添加项目时浏览 Windows 台式机上的文件夹（新的远程操作：只列一层文件夹名，只在允许的根目录里）
window.FOLDERS = {
  crumbs: ['D:', 'Projects', 'Software'],
  items: [{ name: 'agenthub', project: 'p-web' }, { name: 'landing-page' }, { name: 'agenthub-archive' }, { name: 'notes' }],
  pick: 'landing-page',
};
// 文件夹里以前的 Codex / Claude Code 会话（provider-sessions 扫描结果）
window.NATIVE = {
  'p-web': [
    { id: 'n1', agent: 'codex', title: '给 Host 快照加回放测试', at: '10月12日' },
    { id: 'n2', agent: 'codex', title: '排查 Windows 安装包签名失败', at: '10月8日' },
    { id: 'n4', agent: 'claude', title: '总结 Relay 协议各版本的差异', at: '9月21日', unsupported: true },
  ],
  new: [
    { id: 'n6', agent: 'codex', title: '初始化项目脚手架和 CI', at: '10月15日' },
    { id: 'n7', agent: 'codex', title: '接入登录页的表单校验', at: '10月11日' },
    { id: 'n8', agent: 'claude', title: '解释现有的路由结构', at: '10月9日' },
  ],
};
window.ROADMAP = [
  ['切换 AI 工具用的服务', '像 CC Switch 那样，在电脑上切换 Codex 和 Claude Code 用的 API 服务和模型配置，平板上也能切。需要先调查再设计'],
  ['在平板上登录 AI 工具', '现在要在电脑上登录 Codex 和 Claude Code'],
  ['输入框增强', '每一轮选模型和推理强度、斜杠命令、@文件、图片（X1，三端一起做）'],
  ['跨项目搜索', '现在只能在一个项目里搜索'],
  ['删除会话', '现在只能归档'],
  ['运行中追加指令', '现在要等这一轮结束再发送'],
  ['Claude Code 修改文件和执行命令', '现在只读取和搜索'],
  ['配对设备上的停止和批准', '经由电脑访问的设备上，Codex 现在只能对话'],
];

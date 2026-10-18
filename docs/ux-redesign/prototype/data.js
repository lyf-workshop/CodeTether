// 演示数据 — 仅用于原型。字段名对齐 packages/protocol（MachineSummary / ConversationSummary / Attention）与
// apps/web/src/runtime/account（基线 bbcda69）。不调用任何真实 Host、授权、删除或 Agent 执行接口。
window.DEMO = {
  account: { signedIn: true, email: 'lin@example.com', name: '林', localHost: 'claimed' }, // localHost: disabled | enabled_unclaimed | claimed
  // 本机主机下的电脑：这台电脑 + 通过 Node 配对的电脑（完整访问）
  machines: [
    { id: 'm-local', name: '工作站', kind: 'local', icon: 'monitor', platform: 'Windows 11', arch: 'x64', conn: 'local', transport: 'direct',
      providers: [{ id: 'codex', label: 'Codex', inst: 'available', health: 'healthy' }, { id: 'claude', label: 'Claude Code', inst: 'available', health: 'unknown' }],
      caps: { projectAccess: true, providerExecution: true }, observed: 'current' },
    { id: 'm-mac', name: 'MacBook Pro', kind: 'remote', icon: 'laptop', platform: 'macOS 15', arch: 'arm64', conn: 'online', transport: 'relay', relay: 'connected',
      providers: [{ id: 'codex', label: 'Codex', inst: 'available', health: 'healthy' }, { id: 'claude', label: 'Claude Code', inst: 'available', health: 'degraded' }],
      caps: { projectAccess: true, providerExecution: true }, observed: 'current', addr: '192.168.1.42:4318', lastSeen: '刚刚' },
    { id: 'm-linux', name: 'build-server', kind: 'remote', icon: 'server', platform: 'Ubuntu 24.04', arch: 'x64', conn: 'offline', transport: 'unavailable', relay: 'offline',
      providers: [{ id: 'codex', label: 'Codex', inst: 'available', health: 'unknown' }],
      caps: { projectAccess: true, providerExecution: false }, observed: 'last_known', lastSeen: '2 小时前', addr: '10.0.0.8:4318' },
  ],
  projects: [
    { id: 'p-web', name: 'CodeTether', locations: [{ m: 'm-local', path: 'D:\\Projects\\Software\\agenthub', ok: true }, { m: 'm-mac', path: '/Users/lin/code/agenthub', ok: true }] },
    { id: 'p-api', name: 'payments-api', locations: [{ m: 'm-mac', path: '/Users/lin/work/payments/services/payments-api-gateway', ok: true }] },
    { id: 'p-ml', name: 'model-eval', locations: [{ m: 'm-linux', path: '/srv/workspaces/research/model-eval-pipeline', ok: true }] },
    // 还没有会话：演示可以移除的项目和文件夹；MacBook Pro 上的文件夹演示「无法访问」（ok 对应 location availability）
    { id: 'p-docs', name: 'docs-site', locations: [{ m: 'm-local', path: 'D:\\Projects\\docs-site', ok: true }, { m: 'm-mac', path: '/Users/lin/code/docs-site', ok: false }] },
  ],
  // ago：分钟数，仅用于原型排序。会话通过 p（projectId）+ m（machineId）绑定到项目在这台电脑上的文件夹。
  // status 与 ConversationRecord 一致：idle | running | waiting（等待批准）| completed | failed
  conversations: [
    { id: 'c1', title: '修复会话列表在窄窗口下的截断问题', agent: 'codex', p: 'p-web', m: 'm-local', status: 'waiting', at: '刚刚', ago: 0,
      step: '等待你批准：运行测试', elapsed: '已运行 6 分钟' },
    { id: 'c9', title: '把设置页拆成独立路由', agent: 'codex', p: 'p-web', m: 'm-local', status: 'completed', at: '1 小时前', ago: 90 },
    { id: 'c8', title: '为 Relay 连接添加往返延迟统计', agent: 'codex', p: 'p-web', m: 'm-mac', status: 'running', at: '刚刚', ago: 1,
      step: '正在编辑 relay-connection.ts', elapsed: '已运行 12 分钟' },
    { id: 'c2', title: '评审 Relay 重连的退避策略', agent: 'claude', p: 'p-web', m: 'm-mac', status: 'completed', at: '3 分钟前', ago: 3, pinned: true },
    { id: 'c3', title: '重构支付回调签名校验，并补齐幂等键的边界测试用例（含超长标题演示）', agent: 'codex', p: 'p-api', m: 'm-mac', status: 'completed', at: '26 分钟前', ago: 26 },
    { id: 'c4', title: '分析评测流水线的显存峰值', agent: 'codex', p: 'p-ml', m: 'm-linux', status: 'failed', at: '昨天 18:40', ago: 1200, failure: 'machine_offline' },
    { id: 'c5', title: '梳理 AI 工具安装检测的文档缺口', agent: 'claude', p: 'p-web', m: 'm-local', status: 'idle', at: '昨天 10:12', ago: 1600, origin: 'adopted_native' },
    { id: 'c6', title: '升级 TanStack Router 并处理类型告警', agent: 'codex', p: 'p-web', m: 'm-local', status: 'completed', at: '10月14日', ago: 4000 },
    { id: 'c10', title: '解释 Host 快照的增量合并逻辑', agent: 'claude', p: 'p-web', m: 'm-local', status: 'completed', at: '10月10日', ago: 6000 },
    { id: 'c7', title: '旧版 CI 迁移草稿', agent: 'codex', p: 'p-api', m: 'm-mac', status: 'completed', at: '9月30日', ago: 20000, archived: true },
  ],
  attention: [
    { id: 'a1', type: 'approval', kind: 'command', c: 'c1', at: '1 分钟前', cmd: 'pnpm --filter @codetether/web test', open: true },
    { id: 'a2', type: 'completed_review', c: 'c2', at: '3 分钟前', text: 'Claude Code 已完成评审，等你查看结果', open: true },
    { id: 'a3', type: 'failed', c: 'c4', at: '昨天 18:40', text: '电脑离线，这一轮没有开始', reason: 'machine_offline', open: true },
  ],
};
// 账号下的其他主机（Host）。access: authorized | pending | denied | cancelled | expired | none；presence: checking | online | unreachable
// 远程主机授权只有 supervisor_read（只读）；control 级别没有授予入口。
DEMO.hosts = [
  { id: 'h-studio', name: 'Studio Mac', icon: 'monitor', platform: 'macOS 15', access: 'authorized', presence: 'online', transport: 'relay', control: 'read',
    machines: [{ id: 'hm-1', name: 'Studio Mac', kind: 'local', icon: 'monitor', platform: 'macOS 15' }, { id: 'hm-2', name: 'gpu-box', kind: 'remote', icon: 'server', platform: 'Linux' }],
    projects: [{ id: 'hp-1', name: 'design-system', m: 'hm-1', path: '/Users/studio/code/design-system' }, { id: 'hp-2', name: 'train-pipeline', m: 'hm-2', path: '/data/train-pipeline' }],
    providers: [{ id: 'codex', label: 'Codex', inst: 'available' }, { id: 'claude', label: 'Claude Code', inst: 'available' }] },
  { id: 'h-office', name: '办公室 Windows', icon: 'monitor', platform: 'Windows 11', access: 'authorized', presence: 'unreachable', lastSeen: '昨天 19:02', machines: [], projects: [] },
  { id: 'h-lab', name: '实验室 Mac', icon: 'laptop', platform: 'macOS', access: 'pending' },
  { id: 'h-home', name: '家里的 iMac', icon: 'monitor', platform: 'macOS', access: 'denied' },
  { id: 'h-new', name: '新 MacBook', icon: 'laptop', platform: 'macOS', access: 'none' },
];
// 其他主机上的会话：只读查看（host 字段标记来源）
DEMO.hostConversations = [
  { id: 'rc1', host: 'h-studio', title: '迁移按钮组件到新的 Token 体系', agent: 'codex', p: 'hp-1', m: 'hm-1', status: 'running', at: '刚刚', ago: 2, live: 'live',
    step: '正在编辑 Button.tsx', elapsed: '已运行 8 分钟' },
  { id: 'rc2', host: 'h-studio', title: '为训练流水线添加断点续跑', agent: 'codex', p: 'hp-2', m: 'hm-2', status: 'completed', at: '1 小时前', ago: 60, live: 'idle' },
];
// 本机作为主机时收到的访问申请（PendingAccessRequestPanel）
DEMO.accessRequests = [{ id: 'ar1', device: 'MacBook Air', platform: 'macOS', fp: 'SHA256:9c:41:…:7e', expires: '23 小时后过期', open: true }];
// 状态词表：[样式, 文案]
window.STATUS = { running: ['run', '运行中'], waiting: ['warn', '等待批准'], completed: ['ok', '已完成'], failed: ['err', '失败'], idle: ['off', '空闲'] };
window.CONN = {
  local: ['ok', '这台电脑'], online: ['ok', '在线'], connecting: ['warn', '连接中'], offline: ['off', '离线'],
  recovery_required: ['warn', '需要更新地址'], authentication_failed: ['err', '身份验证失败'], incompatible: ['err', '版本不兼容'],
};
window.ACCESS = {
  authorized: ['ok', '已授权 · 仅查看'], pending: ['warn', '等待对方批准'], denied: ['err', '对方已拒绝'],
  cancelled: ['off', '申请已取消'], expired: ['off', '申请已过期'], none: ['off', '尚未申请'],
};
window.PRESENCE = { checking: ['warn', '检查中'], online: ['ok', '在线'], unreachable: ['off', '无法连接'] };

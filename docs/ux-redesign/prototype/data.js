// 演示数据 — 仅用于原型。字段名对齐 packages/protocol（MachineSummary / ConversationSummary / Attention）。
// 不调用任何真实 Host、授权、删除或 Agent 执行接口。
window.DEMO = {
  machines: [
    { id: 'm-local', name: '本地电脑', kind: 'local', platform: 'Windows 11', arch: 'x64', conn: 'local', transport: 'direct',
      providers: [{ id: 'codex', label: 'Codex', inst: 'available', health: 'healthy' }, { id: 'claude', label: 'Claude Code', inst: 'available', health: 'unknown' }],
      caps: { projectAccess: true, providerExecution: true }, observed: 'current' },
    { id: 'm-mac', name: 'MacBook Pro', kind: 'remote', platform: 'macOS 15', arch: 'arm64', conn: 'online', transport: 'relay', relay: 'connected',
      providers: [{ id: 'codex', label: 'Codex', inst: 'available', health: 'healthy' }, { id: 'claude', label: 'Claude Code', inst: 'available', health: 'degraded' }],
      caps: { projectAccess: true, providerExecution: true }, observed: 'current', addr: '192.168.1.42:4318' },
    { id: 'm-linux', name: 'build-server', kind: 'remote', platform: 'Linux', arch: 'x64', conn: 'offline', transport: 'unavailable', relay: 'offline',
      providers: [{ id: 'codex', label: 'Codex', inst: 'available', health: 'unknown' }],
      caps: { projectAccess: true, providerExecution: false }, observed: 'last_known', lastSeen: '2 小时前', addr: '10.0.0.8:4318' },
  ],
  projects: [
    { id: 'p-web', name: 'agenthub', locations: [{ m: 'm-local', path: 'D:\\Projects\\Software\\agenthub', ok: true }, { m: 'm-mac', path: '/Users/dev/code/agenthub', ok: true }] },
    { id: 'p-api', name: 'payments-api', locations: [{ m: 'm-mac', path: '/Users/dev/work/payments/services/payments-api-gateway', ok: true }] },
    { id: 'p-ml', name: 'model-eval', locations: [{ m: 'm-linux', path: '/srv/workspaces/research/model-eval-pipeline', ok: false }] },
  ],
  conversations: [
    { id: 'c1', title: '修复会话列表在窄窗口下的截断问题', agent: 'codex', p: 'p-web', m: 'm-local', status: 'running', at: '刚刚', pinned: true },
    { id: 'c2', title: '为 Relay 重连添加退避测试', agent: 'claude', p: 'p-web', m: 'm-mac', status: 'waiting', at: '3 分钟前', pinned: true, waitingReason: 'completed_review' },
    { id: 'c3', title: '重构支付回调签名校验，并补齐幂等键的边界测试用例（含超长标题演示）', agent: 'codex', p: 'p-api', m: 'm-mac', status: 'completed', at: '26 分钟前' },
    { id: 'c4', title: '分析评测流水线的内存峰值', agent: 'codex', p: 'p-ml', m: 'm-linux', status: 'failed', at: '昨天 18:40', failure: 'machine_offline' },
    { id: 'c5', title: '整理 Provider 安装检测文档', agent: 'claude', p: 'p-web', m: 'm-local', status: 'idle', at: '昨天 10:12', origin: 'adopted_native' },
    { id: 'c6', title: '升级 TanStack Router 并处理类型告警', agent: 'codex', p: 'p-web', m: 'm-local', status: 'completed', at: '10月14日' },
    { id: 'c7', title: '旧版 CI 迁移草稿', agent: 'codex', p: 'p-api', m: 'm-mac', status: 'completed', at: '9月30日', archived: true },
  ],
  attention: [
    { id: 'a1', type: 'approval', kind: 'command', c: 'c1', at: '1 分钟前', text: '运行 pnpm --filter @codetether/web test', open: true },
    { id: 'a2', type: 'completed_review', c: 'c2', at: '3 分钟前', text: 'Claude Code 已完成本轮工作，等待你查看结果。', open: true },
    { id: 'a3', type: 'failed', c: 'c4', at: '昨天 18:40', text: 'build-server 离线，本轮未能开始。', reason: 'machine_offline', open: true },
  ],
};
// 账号与主机（Host）：对齐 apps/web/src/runtime/account/control-plane-client.ts 与 remote-supervisor.ts（基线 bbcda69）
// access: authorized | pending | denied | cancelled | expired | none；presence: checking | online | unreachable
// 远程主机授权范围只有 supervisor_read（只读）；control 级别没有授予入口。
DEMO.account = { signedIn: true, email: 'dev@example.com', localHost: 'claimed' }; // localHost: disabled | enabled_unclaimed | claimed
DEMO.hosts = [
  { id: 'h-studio', name: 'Studio Mac', platform: 'macOS', access: 'authorized', presence: 'online', transport: 'relay', control: 'read',
    machines: [{ id: 'hm-1', name: 'Studio Mac', kind: 'local', platform: 'macOS 15' }, { id: 'hm-2', name: 'gpu-box', kind: 'remote', platform: 'Linux' }],
    projects: [{ id: 'hp-1', name: 'design-system', m: 'hm-1' }, { id: 'hp-2', name: 'train-pipeline', m: 'hm-2' }],
    providers: [{ id: 'codex', label: 'Codex', inst: 'available' }, { id: 'claude', label: 'Claude Code', inst: 'available' }],
    conversations: [
      { id: 'rc1', title: '迁移按钮组件到新的 Token 体系', agent: 'claude', p: 'hp-1', m: 'hm-1', status: 'running', at: '刚刚', live: 'live' },
      { id: 'rc2', title: '为训练流水线添加断点续跑', agent: 'codex', p: 'hp-2', m: 'hm-2', status: 'completed', at: '1 小时前', live: 'idle' },
    ] },
  { id: 'h-office', name: '办公室 Windows', platform: 'Windows', access: 'authorized', presence: 'unreachable' },
  { id: 'h-lab', name: '实验室 Mac', platform: 'macOS', access: 'pending' },
  { id: 'h-home', name: '家里的 iMac', platform: 'macOS', access: 'denied' },
  { id: 'h-new', name: '新 MacBook', platform: 'macOS', access: 'none' },
];
// 本机作为主机时收到的访问申请（PendingAccessRequestPanel）
DEMO.accessRequests = [{ id: 'ar1', device: 'MacBook Air', platform: 'macOS', fp: 'SHA256:9c:41:…:7e', expires: '23 小时后', open: true }];
window.ACCESS = {
  authorized: ['ok', '已授权 · 只读'], pending: ['waiting', '等待对方批准'], denied: ['failed', '已被拒绝'],
  cancelled: ['idle', '已取消'], expired: ['idle', '已过期'], none: ['idle', '需要申请访问'],
};
window.PRESENCE = { checking: ['reconnecting', '检查中'], online: ['online', '在线'], unreachable: ['offline', '无法连接'] };
window.STATUS = {
  running: ['running', '运行中'], waiting: ['waiting', '需要处理'], completed: ['ok', '已完成'], failed: ['failed', '运行失败'], idle: ['idle', '空闲'],
};
window.CONN = {
  local: ['online', '本机'], online: ['online', '在线'], connecting: ['reconnecting', '连接中'], offline: ['offline', '离线'],
  recovery_required: ['warn', '需要更新地址'], authentication_failed: ['err', '身份验证失败'], incompatible: ['err', '版本不兼容'],
};

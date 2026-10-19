// 演示数据 — 仅用于原型。字段名对齐 packages/protocol（MachineSummary / ProjectRecord / ConversationSummary / Attention）与
// apps/web/src/runtime/account（基线 bbcda69）。不调用任何真实 Host、授权、删除或 Agent 执行接口。
window.DEMO = {
  account: { signedIn: true, email: 'lin@example.com', name: '林' },
  // 设备：这台电脑 + 已配对的设备（完整使用：新建会话、发送、查看历史）
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
  // 一个项目 = 一台设备上的一个文件夹（ProjectRecord + 它唯一的 ProjectLocation）。ok 对应 location availability
  projects: [
    { id: 'p-web', name: 'CodeTether', m: 'm-local', path: 'D:\\Projects\\Software\\agenthub', ok: true },
    // 还没有会话、文件夹找不到：演示「无法访问」和可以移除的项目
    { id: 'p-docs', name: 'docs-site', m: 'm-local', path: 'D:\\Projects\\docs-site', ok: false },
    { id: 'p-api', name: 'payments-api', m: 'm-mac', path: '/Users/lin/work/payments/services/payments-api-gateway', ok: true },
    { id: 'p-ml', name: 'model-eval', m: 'm-linux', path: '/srv/workspaces/research/model-eval-pipeline', ok: true },
  ],
  // ago：分钟数，仅用于原型排序。会话属于一个项目，也就固定在那台设备的那个文件夹上（ConversationRecord 的 projectId + machineId）
  // status 与 ConversationRecord 一致：idle | running | waiting（等待批准）| completed | failed
  conversations: [
    { id: 'c1', title: '修复会话列表在窄窗口下的截断问题', agent: 'codex', p: 'p-web', status: 'waiting', at: '刚刚', ago: 0,
      step: '等待你批准：运行测试', elapsed: '已运行 6 分钟' },
    { id: 'c9', title: '把设置页拆成独立路由', agent: 'codex', p: 'p-web', status: 'completed', at: '1 小时前', ago: 90 },
    { id: 'c5', title: '梳理 AI 工具安装检测的文档缺口', agent: 'claude', p: 'p-web', status: 'idle', at: '昨天 10:12', ago: 1600, origin: 'adopted_native' },
    { id: 'c6', title: '升级 TanStack Router 并处理类型告警', agent: 'codex', p: 'p-web', status: 'completed', at: '10月14日', ago: 4000 },
    { id: 'c10', title: '解释 Host 快照的增量合并逻辑', agent: 'claude', p: 'p-web', status: 'completed', at: '10月10日', ago: 6000 },
    { id: 'c8', title: '为 Webhook 重试添加耗时统计', agent: 'codex', p: 'p-api', status: 'running', at: '刚刚', ago: 1,
      step: '正在编辑 webhook-retry.ts', elapsed: '已运行 12 分钟' },
    { id: 'c2', title: '评审 Webhook 重试的退避策略', agent: 'claude', p: 'p-api', status: 'completed', at: '3 分钟前', ago: 3, pinned: true },
    { id: 'c3', title: '重构支付回调签名校验，并补齐幂等键的边界测试用例（含超长标题演示）', agent: 'codex', p: 'p-api', status: 'completed', at: '26 分钟前', ago: 26 },
    { id: 'c7', title: '旧版 CI 迁移草稿', agent: 'codex', p: 'p-api', status: 'completed', at: '9月30日', ago: 20000, archived: true },
    { id: 'c4', title: '分析评测流水线的显存峰值', agent: 'codex', p: 'p-ml', status: 'failed', at: '昨天 18:40', ago: 1200, failure: 'machine_offline' },
  ],
  attention: [
    { id: 'a1', type: 'approval', kind: 'command', c: 'c1', at: '1 分钟前', cmd: 'pnpm --filter @codetether/web test', open: true },
    { id: 'a2', type: 'completed_review', c: 'c2', at: '3 分钟前', text: 'Claude Code 已完成评审，等你查看结果', open: true },
    { id: 'a3', type: 'failed', c: 'c4', at: '昨天 18:40', text: '设备离线，这一轮没有开始', reason: 'machine_offline', open: true },
  ],
};
// 这个文件夹里的 Codex / Claude Code 原生会话（provider-sessions 发现结果，DiscoverProviderSessionsResponse）。
// Host 按项目文件夹精确匹配（cwd 与 rootPath 相同）扫描那台设备；导入（adopt）不会启动 AI 工具。
// resume:false 对应 resumeStatus ≠ supported，不能导入；adopted 是已经在 CodeTether 中的会话
window.NATIVE = {
  'p-web': { items: [
    { id: 'n1', agent: 'codex', title: '给 Host 快照加回放测试', at: '10月12日 21:04', resume: true },
    { id: 'n2', agent: 'codex', title: '排查 Windows 安装包签名失败', at: '10月8日 15:30', resume: true },
    { id: 'n3', agent: 'claude', title: '梳理 AI 工具安装检测的文档缺口', at: '昨天 10:12', resume: true, adopted: 'c5' },
    { id: 'n4', agent: 'claude', title: '总结 Relay 协议各版本的差异', at: '9月21日 11:02', resume: false },
  ] },
  'p-api': { items: [{ id: 'n5', agent: 'codex', title: 'Webhook 签名密钥轮换方案', at: '10月3日 09:47', resume: true }] },
  'p-docs': { fail: 'unreadable' }, // 文件夹无法访问：扫描失败
  'p-ml': { fail: 'machine_offline' }, // 设备离线：两个 AI 工具都返回 machine_offline
  // 演示“添加项目”时新文件夹里找到的会话
  new: { items: [
    { id: 'n6', agent: 'codex', title: '初始化项目脚手架和 CI', at: '10月15日 20:31', resume: true },
    { id: 'n7', agent: 'codex', title: '接入登录页的表单校验', at: '10月11日 14:05', resume: true },
    { id: 'n8', agent: 'claude', title: '解释现有的路由结构', at: '10月9日 10:20', resume: true },
  ] },
};
// 状态词表：[样式, 文案]
window.STATUS = { running: ['run', '运行中'], waiting: ['warn', '等待批准'], completed: ['ok', '已完成'], failed: ['err', '失败'], idle: ['off', '空闲'] };
window.CONN = {
  local: ['ok', '这台电脑'], online: ['ok', '在线'], connecting: ['warn', '连接中'], offline: ['off', '离线'],
  recovery_required: ['warn', '需要更新地址'], authentication_failed: ['err', '身份验证失败'], incompatible: ['err', '版本不兼容'],
};

// CodeTether 原型 v2 — 公共层：数据访问、能力门控、主题、外壳（侧栏 / 顶栏 / 手机 Tab）。
// 所有操作只修改内存中的演示数据，不调用真实接口。
const D = window.DEMO;
const Q = new URLSearchParams(location.search);
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ui = { os: Q.get('os') || 'win', theme: Q.get('theme') || localStorage.getItem('ct-theme') || 'light', modal: null,
  f: { status: 'all', agent: 'all', pc: 'all', q: '' }, pq: '' };

/* ---------- 数据 ---------- */
const mach = (id) => D.machines.find((m) => m.id === id);
const proj = (id) => D.projects.find((p) => p.id === id);
const host = (id) => D.hosts.find((h) => h.id === id);
// 原型场景：由路由和状态参数推出，让侧栏、Tab 和页面显示同一种状态
function scene() {
  const r = routePath(), st = hq('state'), step = hq('step');
  const out = !D.account.signedIn || hq('account') === 'out' || (r === 'signin' && step !== 'unconfigured');
  return { out, unconfigured: r === 'signin' && step === 'unconfigured', empty: r === 'home' && st === 'empty', loading: r === 'home' && st === 'loading', noAttn: st === 'empty' || hq('f') === 'none',
    hostErr: r === 'home' && st === 'error' ? 'h-studio' : '', host: (r === 'settings/account' && hq('host')) || D.account.localHost };
}
const hostConvs = () => { const s = scene(); return s.out ? [] : D.hostConversations.filter((c) => host(c.host).access === 'authorized' && c.host !== s.hostErr); };
const conv = (id) => D.conversations.find((c) => c.id === id) || D.hostConversations.find((c) => c.id === id);
const isRO = (c) => !!c.host; // 其他主机上的会话：supervisor_read，只读
const cMach = (c) => isRO(c) ? host(c.host).machines.find((m) => m.id === c.m) : mach(c.m);
const cProj = (c) => isRO(c) ? host(c.host).projects.find((p) => p.id === c.p) : proj(c.p);
const allConvs = () => (scene().empty ? [] : [...D.conversations, ...hostConvs()].filter((c) => !c.archived).sort((a, b) => a.ago - b.ago));
const openAttn = () => { const s = scene(); return s.noAttn || s.loading ? [] : D.attention.filter((a) => a.open); };
const pendingApproval = (c) => D.attention.find((a) => a.c === c.id && a.type === 'approval' && a.open);
// 电脑所在位置的一行描述：“工作站”“Studio Mac › gpu-box”
function where(c) {
  if (!isRO(c)) return mach(c.m).name;
  const h = host(c.host), m = cMach(c);
  return m.name === h.name ? h.name : `${h.name} › ${m.name}`;
}
// 名称嵌进中文句子：英文名两侧留空格，中文名不留（“在工作站上”“在 MacBook Pro 上”）
// lead / trail：名称前、后是否紧接中文（句首或后接标点时传 false）
const nm = (s, lead = true, trail = true) => { const L = /[\x21-\x7e]/; s = String(s); return `${lead && L.test(s[0]) ? ' ' : ''}${esc(s)}${trail && L.test(s.at(-1)) ? ' ' : ''}`; };
const pcIcon = (x) => I(x.icon || 'monitor');
const agentName = (a) => (a === 'codex' ? 'Codex' : 'Claude Code');
const ag = (a, label = true, cls = '') => `<span class="ag ${a} ${cls}"><i>${I(a === 'codex' ? 'codex' : 'claude')}</i>${label ? agentName(a) : ''}</span>`;

/* ---------- 能力门控：与 conversation-controls.ts 一致 ---------- */
const canInterrupt = (c) => !isRO(c) && c.agent === 'codex' && mach(c.m).kind === 'local'; // 远程与 Claude Code 当前不支持中断
const canApprove = (c) => !isRO(c) && c.agent === 'codex' && mach(c.m).kind === 'local';   // 远程运行时没有审批原语
// 输入区四种状态：send（可发送）/ busy（运行中，无排队）/ wait（等待审批）/ readonly（只读）/ offline（离线）
function gate(c) {
  if (isRO(c)) return { kind: 'readonly' };
  const m = mach(c.m);
  if (m.kind === 'remote' && m.conn !== 'online') return { kind: 'offline', m };
  if (!m.caps.providerExecution) return { kind: 'offline', m };
  if (c.status === 'running') return pendingApproval(c) && canApprove(c) ? { kind: 'wait' } : { kind: 'busy' };
  return { kind: 'send' };
}
// 一个会话的显示状态（运行中但等待审批时显示为“等待批准”）
function cStatus(c) {
  if (c.status === 'running' && pendingApproval(c)) return ['warn', '等待批准'];
  return STATUS[c.status];
}
const status = (c) => { const [k, t] = cStatus(c); return `<span class="status ${k}">${t}</span>`; };
const dotFor = (c) => `<span class="dot ${cStatus(c)[0]}"></span>`;
// 电脑的连接状态与能做什么
function pcState(x) {
  if (x.kind) { // 本机主机下的电脑
    const [k, t] = CONN[x.conn];
    return { dot: k, text: x.conn === 'offline' ? `离线 · ${x.lastSeen}` : t, can: x.conn === 'offline' ? 'history' : 'work' };
  }
  if (x.access !== 'authorized') return { dot: ACCESS[x.access][0], text: ACCESS[x.access][1], can: 'none' };
  const [k, t] = PRESENCE[x.presence];
  return { dot: k, text: x.presence === 'unreachable' ? `无法连接 · ${x.lastSeen}` : t, can: x.presence === 'online' ? 'view' : 'none' };
}
const canPill = (can) => ({ work: `<span class="pill ok">${I('check')}可以继续工作</span>`, view: `<span class="pill line">${I('eye')}仅查看</span>`,
  history: `<span class="pill line">${I('clock')}可查看记录</span>`, none: '' }[can]);

/* ---------- 主题 ---------- */
function applyTheme() {
  const t = ui.theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : ui.theme;
  document.documentElement.dataset.theme = t;
}
window.setTheme = (t) => { ui.theme = t; localStorage.setItem('ct-theme', t); applyTheme(); render(); };

/* ---------- 外壳 ---------- */
const WINCTL = `<span class="winctl" aria-hidden="true"><span><svg viewBox="0 0 10 10"><path d="M0 5h10"/></svg></span><span><svg viewBox="0 0 10 10"><path d="M.5.5h9v9h-9z"/></svg></span><span><svg viewBox="0 0 10 10"><path d="M0 0l10 10M10 0 0 10"/></svg></span></span>`;
function sidebar(active, current) {
  const n = openAttn().length;
  const item = (href, ic, label, key, extra = '') => `<a class="nav-item" href="${href}" ${active === key ? 'aria-current="page"' : ''}>${I(ic)}<span class="trunc">${label}</span>${extra}</a>`;
  const recents = allConvs().slice(0, 8), s = scene();
  // 账号行的第二行与“账号与共享”页一致；文字保持短，224px 侧栏下不换行
  const me = s.unconfigured ? ['未登录', '未配置账号服务'] : s.out ? ['未登录', '本机功能不需要登录']
    : [esc(D.account.email), { claimed: '已登录 · 本机已共享', enabled_unclaimed: '已登录 · 共享未完成', disabled: '已登录 · 本机未共享' }[s.host]];
  return `<aside class="side" aria-label="主导航">
    <div class="side-top"><span class="brand">${MARK}<b>CodeTether</b></span><span class="sp"></span>
      <button class="btn ghost icon sm" title="搜索（Ctrl K）" onclick="openModal('palette')">${I('search')}</button></div>
    <div class="side-new"><button class="btn new" onclick="openModal('new')">${I('edit')}新建会话<kbd>Ctrl N</kbd></button></div>
    <div class="side-scroll">
      ${item('#/home', 'home', '首页', 'home')}
      ${item('#/inbox', 'inbox', '待处理', 'inbox', n ? `<span class="badge">${n}</span>` : '')}
      ${item('#/computers', 'monitor', '我的电脑', 'computers')}
      ${item('#/projects', 'folder', '项目', 'projects')}
      <div class="side-label">最近<a href="#/sessions">全部</a></div>
      ${s.loading ? [70, 55, 82, 62].map((w) => `<div class="recent"><span class="skel" style="width:${w}%"></span></div>`).join('')
        : recents.map((c) => `<a class="recent" href="#/c/${c.id}" ${current === c.id ? 'aria-current="page"' : ''} title="${esc(c.title)} · ${esc(where(c))}">${dotFor(c)}<span class="trunc grow">${esc(c.title)}</span>${isRO(c) ? `<span class="ro" title="仅查看">${I('eye')}</span>` : ''}</a>`).join('') || '<p class="side-empty">还没有会话</p>'}
    </div>
    <div class="side-foot">
      <a class="me" href="#/settings/account"><span class="avatar ${s.out || s.unconfigured ? 'anon' : ''}">${s.out || s.unconfigured ? I('user') : esc(D.account.name)}</span><span class="grow"><b class="trunc">${me[0]}</b><small class="trunc">${me[1]}</small></span></a>
      <a class="btn ghost icon sm" href="#/settings/appearance" title="设置" ${active === 'settings' ? 'aria-current="page"' : ''}>${I('settings')}</a>
    </div></aside>`;
}
function tabbar(active) {
  const n = openAttn().length;
  const t = (href, ic, label, key, extra = '') => `<a href="${href}" ${active === key ? 'aria-current="page"' : ''}>${I(ic)}${label}${extra}</a>`;
  return `<nav class="tabbar" aria-label="主导航">${t('#/home', 'home', '首页', 'home')}${t('#/inbox', 'inbox', '待处理', 'inbox', n ? `<span class="badge">${n}</span>` : '')}${t('#/computers', 'monitor', '电脑', 'computers')}${t('#/settings/appearance', 'settings', '设置', 'settings')}</nav>`;
}
// page = { active, current, crumbs, actions, body }
function shell(page) {
  return `<div class="window os-${ui.os}"><span class="traffic"><i></i><i></i><i></i></span>${sidebar(page.active, page.current)}
    <div class="main"><header class="topbar"><nav class="crumbs trunc grow" aria-label="位置">${page.crumbs || ''}</nav>${page.actions || ''}<span class="demo-pill" title="原型：所有操作只修改内存中的演示数据">演示数据</span>${WINCTL}</header>
      ${page.raw ? page.body : `<div class="scroll" id="main">${page.body}</div>`}</div>${tabbar(page.active)}</div>`;
}
// 手机宽度只显示「返回 + 当前标题」，返回到最近一个有链接的上级
const crumbs = (...xs) => {
  const up = xs.filter(Array.isArray).pop();
  const back = up ? `<a class="crumb-back" href="${up[1]}" title="返回${esc(up[0])}">${I('chev')}</a>` : '';
  return back + xs.map((x, i) => (Array.isArray(x) ? `<span class="crumb"><a href="${x[1]}">${esc(x[0])}</a>${I('chev')}</span>` : i === xs.length - 1 ? `<b class="trunc">${esc(x)}</b>` : `<span class="crumb">${esc(x)}${I('chev')}</span>`)).join('');
};

/* ---------- 常用片段 ---------- */
const note = (t) => `<div class="design-note"><b>设计注释</b>${t}</div>`;
const notice = (kind, ic, title, desc = '', acts = '') => `<div class="notice ${kind}">${I(ic)}<div class="grow"><b>${title}</b>${desc ? `<div class="d">${desc}</div>` : ''}</div>${acts ? `<div class="acts">${acts}</div>` : ''}</div>`;
const empty = (ic, title, desc, acts = '') => `<div class="empty"><span class="glyph">${I(ic)}</span><b>${title}</b><span>${desc}</span>${acts ? `<div class="acts">${acts}</div>` : ''}</div>`;
const skel = (n = 4) => `<div class="list">${Array.from({ length: n }, () => `<div class="item static"><span class="dot"></span><div class="grow col" style="gap:8px"><div class="skel" style="width:55%"></div><div class="skel" style="width:30%;height:9px"></div></div></div>`).join('')}</div>`;
const techErr = (code, src) => `<details class="tech"><summary>技术详情</summary><pre>code: ${code}\nsource: ${src}\nat: 2026-10-16 18:40</pre></details>`;
const retry = (label = '重试') => `<button class="btn sm" onclick="this.innerHTML='正在重试…'">${I('refresh')}${label}</button>`;
// 会话行（SessionItem）
function sessionItem(c, opt = {}) {
  const p = cProj(c);
  return `<a class="item" href="#/c/${c.id}">
    ${ag(c.agent, false)}
    <div class="grow"><div class="row"><span class="t trunc" title="${esc(c.title)}">${esc(c.title)}</span>${c.pinned && !opt.noPin ? `<span class="faint" title="已置顶">${I('pin')}</span>` : ''}</div>
      <div class="sub">${opt.hidePc ? '' : `${pcIcon(cMach(c))}<span class="trunc">${esc(opt.machOnly ? cMach(c).name : where(c))}</span><span class="faint">·</span>`}${I('folder')}<span class="trunc">${esc(p.name)}</span>${c.origin === 'adopted_native' ? '<span class="faint">·</span><span class="nowrap">从 Claude Code 导入</span>' : ''}${isRO(c) && !opt.noRO ? `<span class="faint">·</span><span class="ro-tag">${I('eye')}仅查看</span>` : ''}</div></div>
    <div class="end">${status(c)}<span class="when">${esc(c.at)}</span>
      ${isRO(c) ? '' : `<span class="acts" onclick="event.preventDefault();event.stopPropagation()"><button class="btn ghost icon sm" title="${c.pinned ? '取消置顶' : '置顶'}" onclick="togglePin('${c.id}')">${I('pin')}</button><button class="btn ghost icon sm" title="归档" ${c.status === 'running' ? 'disabled' : ''} onclick="toggleArchive('${c.id}')">${I('archive')}</button><button class="btn ghost icon sm" title="更多" onclick="openModal('rename:${c.id}')">${I('more')}</button></span>`}</div></a>`;
}
window.togglePin = (id) => { const c = conv(id); c.pinned = !c.pinned; render(); };
window.toggleArchive = (id) => { const c = conv(id); if (c.status !== 'running') c.archived = !c.archived; render(); };

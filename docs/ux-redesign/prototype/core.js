// CodeTether 原型 v4 — 公共层：数据访问、能力门控、主题、外壳（侧栏设备树 / 顶栏 / 手机 Tab）。
// 结构：设备 › 项目 › 会话。一个项目就是一台设备上的一个文件夹。所有操作只修改内存中的演示数据，不调用真实接口。
const D = window.DEMO;
const Q = new URLSearchParams(location.search);
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hq = (k) => new URLSearchParams(location.hash.split('?')[1] || '').get(k);
// open：侧栏中展开的设备和项目（设备默认展开）；more：已展开“显示全部”的项目
const ui = { os: Q.get('os') || 'win', theme: Q.get('theme') || localStorage.getItem('ct-theme') || 'light', modal: null,
  f: { status: 'all', agent: 'all', p: '' }, pq: '', open: new Set([...D.machines.map((m) => m.id), 'p-web', 'p-api']), more: new Set() };

/* ---------- 数据 ---------- */
const mach = (id) => D.machines.find((m) => m.id === id);
const proj = (id) => D.projects.find((p) => p.id === id);
const conv = (id) => D.conversations.find((c) => c.id === id);
const cProj = (c) => proj(c.p);
const cMach = (c) => mach(proj(c.p).m); // 会话 → 项目 → 设备
// 原型场景：由路由和状态参数推出，让侧栏、Tab 和页面显示同一种状态
function scene() {
  const r = routePath(), st = hq('state'), step = hq('step');
  const out = !D.account.signedIn || hq('account') === 'out' || (r === 'signin' && step !== 'unconfigured');
  return { out, unconfigured: r === 'signin' && step === 'unconfigured', empty: r === 'devices' && st === 'empty', loading: r === 'devices' && st === 'loading',
    noAttn: st === 'empty' || hq('f') === 'none' };
}
// mid：只取这台设备上的项目
const projects = (mid) => (scene().empty ? [] : D.projects.filter((p) => !mid || p.m === mid));
const allConvs = () => (scene().empty ? [] : D.conversations.filter((c) => !c.archived).sort((a, b) => a.ago - b.ago));
// 一个项目里的会话：置顶在前，其余按最近活动。归档的不在这里显示
const projConvs = (pid) => D.conversations.filter((c) => c.p === pid && !c.archived).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || a.ago - b.ago);
const machConvs = (mid) => D.conversations.filter((c) => !c.archived && proj(c.p).m === mid).sort((a, b) => a.ago - b.ago);
// 设备能做什么：离线时只能查看记录；不能运行 AI 工具时不能新建会话
function devState(m) {
  if (m.kind === 'remote' && m.conn !== 'online') {
    const [k, t] = CONN[m.conn];
    return { ok: false, k, text: m.conn === 'offline' ? '离线' : t, why: m.conn === 'offline' ? `${m.name} 离线 · 上次在线 ${m.lastSeen}` : `${m.name}：${t}` };
  }
  if (!m.caps.providerExecution) return { ok: false, k: 'off', text: '不能运行', why: `${m.name} 当前不能运行 AI 工具` };
  return { ok: true, k: 'ok', text: CONN[m.conn][1] };
}
// 项目能不能新建会话：先看设备，再看文件夹（location availability）
function projState(p) {
  const d = devState(mach(p.m));
  if (!d.ok) return d;
  if (!p.ok) return { ok: false, k: 'err', text: '无法访问', why: '找不到这个文件夹，或没有读取权限' };
  return { ok: true, k: 'ok', text: '可用' };
}
// 能不能在这台设备上添加项目：需要在线，且设备开放了项目访问（projectAccess）
const canAddProj = (m) => (m.kind === 'local' || m.conn === 'online') && m.caps.projectAccess;
const busy = (c) => c.status === 'running' || c.status === 'waiting'; // 有进行中的一轮：不能归档，也不能再发送
const openAttn = () => { const s = scene(); return s.noAttn || s.loading ? [] : D.attention.filter((a) => a.open); };
const pendingApproval = (c) => D.attention.find((a) => a.c === c.id && a.type === 'approval' && a.open);
// 名称嵌进中文句子：英文名两侧留空格，中文名不留（“在工作站上”“在 MacBook Pro 上”）
// lead / trail：名称前、后是否紧接中文（句首或后接标点时传 false）
const nm = (s, lead = true, trail = true) => { const L = /[\x21-\x7e]/; s = String(s); return `${lead && L.test(s[0]) ? ' ' : ''}${esc(s)}${trail && L.test(s.at(-1)) ? ' ' : ''}`; };
const pcIcon = (x) => I(x.icon || 'monitor');
const agentName = (a) => (a === 'codex' ? 'Codex' : 'Claude Code');
// Claude Code 的推理强度（provider-discovery.ts）；Codex 当前没有模型和推理强度选项
const REASON = [['', '默认'], ['low', '低'], ['medium', '中'], ['high', '高'], ['xhigh', '很高'], ['max', '最高']];
const reasonName = (r) => (REASON.find((x) => x[0] === r) || REASON[0])[1];
const ag = (a, label = true, cls = '') => `<span class="ag ${a} ${cls}"><i>${I(a === 'codex' ? 'codex' : 'claude')}</i>${label ? agentName(a) : ''}</span>`;

/* ---------- 能力门控：与 conversation-controls.ts 一致 ---------- */
const canInterrupt = (c) => c.agent === 'codex' && cMach(c).kind === 'local'; // 配对设备与 Claude Code 当前不支持中断
const canApprove = (c) => c.agent === 'codex' && cMach(c).kind === 'local';   // 在配对设备上运行时没有审批原语
// 输入区状态：send（可发送）/ busy（这一轮还没结束，Host 对新消息返回 409）/ wait（等待审批）/ offline（设备离线或不能运行）
function gate(c) {
  const m = cMach(c);
  if (!devState(m).ok) return { kind: 'offline', m };
  if (c.status === 'waiting' && pendingApproval(c) && canApprove(c)) return { kind: 'wait' };
  if (busy(c)) return { kind: 'busy' };
  return { kind: 'send' };
}
// 一个会话的显示状态：直接取 ConversationRecord.status（waiting 即等待批准）
const cStatus = (c) => STATUS[c.status];
const status = (c) => { const [k, t] = cStatus(c); return `<span class="status ${k}">${t}</span>`; };
const dotFor = (c) => `<span class="dot ${cStatus(c)[0]}"></span>`;
// 设备的连接状态一行：“这台电脑”“在线”“离线 · 2 小时前”
const devLine = (m) => { const [k, t] = CONN[m.conn]; return `<span class="status ${k}">${m.conn === 'offline' ? `离线 · ${esc(m.lastSeen)}` : t}</span>`; };

/* ---------- 主题 ---------- */
function applyTheme() {
  const t = ui.theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : ui.theme;
  document.documentElement.dataset.theme = t;
}
window.setTheme = (t) => { ui.theme = t; localStorage.setItem('ct-theme', t); applyTheme(); render(); };

/* ---------- 外壳 ---------- */
const WINCTL = `<span class="winctl" aria-hidden="true"><span><svg viewBox="0 0 10 10"><path d="M0 5h10"/></svg></span><span><svg viewBox="0 0 10 10"><path d="M.5.5h9v9h-9z"/></svg></span><span><svg viewBox="0 0 10 10"><path d="M0 0l10 10M10 0 0 10"/></svg></span></span>`;
/* ---------- 侧栏设备树：设备 › 项目（这台设备上的一个文件夹）› 会话 ---------- */
const SES_N = 4; // 每个项目默认显示的会话数
const sid = (s) => s.replace(/[^\w-]/g, '_');
window.twist = (k) => { ui.open.has(k) ? ui.open.delete(k) : ui.open.add(k); render(true); };
window.showMore = (k) => { ui.more.has(k) ? ui.more.delete(k) : ui.more.add(k); render(true); };
// 树里只给需要注意的会话显示圆点：运行中 / 等待批准 / 失败；其余留空位保持对齐
const HOT = ['running', 'waiting', 'failed'];
const treeDot = (c) => (HOT.includes(c.status) ? dotFor(c) : '<span class="dot none"></span>');
const treeConv = (c, current) => `<a class="tree-row ses" href="#/c/${c.id}" ${current === c.id ? 'aria-current="page"' : ''} title="${esc(c.title)}${HOT.includes(c.status) ? ' · ' + cStatus(c)[1] : ''}">${treeDot(c)}<span class="trunc grow">${esc(c.title)}</span>${c.pinned ? `<span class="tr-ic" title="已置顶">${I('pin')}</span>` : ''}</a>`;
// 一个项目下的会话：默认显示 4 个，当前打开的会话总是可见
function treeConvs(cs, key, current) {
  const all = ui.more.has(key), shown = all ? cs : cs.slice(0, SES_N);
  if (!all && cs.some((c) => c.id === current) && !shown.some((c) => c.id === current)) shown.push(cs.find((c) => c.id === current));
  if (!cs.length) return '<p class="tree-row none">还没有会话</p>';
  return shown.map((c) => treeConv(c, current)).join('')
    + (cs.length > SES_N ? `<button class="tree-row more" id="mo-${sid(key)}" onclick="showMore('${key}')">${all ? '收起' : `显示全部 ${cs.length} 个`}</button>` : '');
}
// 收起时只显示一个最需要注意的状态
function hotDot(cs) {
  const k = ['waiting', 'running', 'failed'].find((s) => cs.some((c) => c.status === s));
  return k ? `<span class="dot ${STATUS[k][0]}" title="有会话${STATUS[k][1]}"></span>` : '';
}
// 项目行：悬停显示路径；能新建会话时悬停出现“+”。文件夹不可用时显示原因（设备离线的原因已经写在设备行上）
function treeProj(p, pg) {
  const open = ui.open.has(p.id), cur = pg.proj === p.id && !pg.current, st = projState(p), cs = projConvs(p.id), dev = devState(mach(p.m)).ok;
  return `<div class="tree-row proj ${st.ok ? '' : 'dim'}" ${cur ? 'data-current' : ''}><button class="twist" id="tw-${p.id}" aria-expanded="${open}" aria-label="${open ? '收起' : '展开'} ${esc(p.name)}" onclick="twist('${p.id}')">${I('chev')}</button>
    <a class="grow row" href="#/projects/${p.id}" title="${esc(p.path)}" ${cur ? 'aria-current="page"' : ''}><span class="trunc">${esc(p.name)}</span>${open ? '' : hotDot(cs)}</a>
    ${st.ok ? `<button class="tr-add" id="np-${p.id}" title="在${nm(p.name)}中新建会话" onclick="openModal('new:${p.id}')">${I('plus')}</button>` : dev ? `<span class="tr-tag ${st.k}" title="${esc(st.why)}">${st.text}</span>` : ''}</div>
    ${open ? treeConvs(cs, p.id, pg.current) : ''}`;
}
// 设备行：图标 + 名称；在线时悬停出现“+”（添加项目），离线或连接有问题时显示状态
function treeDev(m, pg) {
  const open = ui.open.has(m.id), cur = pg.dev === m.id, st = devState(m), ps = projects(m.id);
  return `<div class="tree-row dev ${st.ok ? '' : 'dim'}" ${cur ? 'data-current' : ''}><button class="twist" id="tw-${m.id}" aria-expanded="${open}" aria-label="${open ? '收起' : '展开'} ${esc(m.name)}" onclick="twist('${m.id}')">${I('chev')}</button>
    <a class="grow row" href="#/devices/${m.id}" ${cur ? 'aria-current="page"' : ''}>${pcIcon(m)}<span class="trunc">${esc(m.name)}</span>${open ? '' : hotDot(machConvs(m.id))}</a>
    ${canAddProj(m) ? `<button class="tr-add" id="ap-${m.id}" title="在${nm(m.name)}上添加项目" onclick="openModal('addproj:${m.id}')">${I('plus')}</button>` : `<span class="tr-tag ${st.k === 'err' ? 'err' : ''}" title="${esc(st.why || '')}">${st.text}</span>`}</div>
    ${open ? (ps.map((p) => treeProj(p, pg)).join('') || `<p class="tree-row none">还没有项目</p>`) : ''}`;
}
// 侧栏按钮和 Ctrl N：预选当前所在的项目（~ 只预选，仍可改；树里的“+”用 : 固定项目）；在设备页时预选这台设备上的第一个可用项目（@）
const here = (pg = {}) => { const c = pg.current && conv(pg.current); return c ? `~${c.p}` : pg.proj ? `~${pg.proj}` : pg.dev ? `@${pg.dev}` : ''; };
// 打开项目、会话或设备时，在侧栏展开它所在的位置
function reveal() {
  const r = routePath(), mp = r.match(/^projects\/([\w-]+)/), mc = r.match(/^c\/([\w-]+)$/), md = r.match(/^devices\/([\w-]+)$/), c = mc && conv(mc[1]);
  const p = (mp && proj(mp[1])) || (c && cProj(c));
  if (p) { ui.open.add(p.m); ui.open.add(p.id); }
  if (md) ui.open.add(md[1]);
}
function sidebar(pg) {
  const n = openAttn().length, s = scene(), active = pg.active;
  const item = (href, ic, label, on, extra = '') => `<a class="nav-item" href="${href}" ${on ? 'aria-current="page"' : ''}>${I(ic)}<span class="trunc">${label}</span>${extra}</a>`;
  const tree = s.loading ? [62, 48, 70, 54].map((w, i) => `<div class="tree-row ${i % 2 ? 'proj' : 'dev'}"><span class="skel" style="width:${w}%"></span></div>`).join('')
    : D.machines.map((m) => treeDev(m, pg)).join('');
  // 账号行的第二行与“账号”页一致；文字保持短，224px 侧栏下不换行
  const me = s.unconfigured ? ['未登录', '未配置账号服务'] : s.out ? ['未登录', '本机功能不需要登录'] : [esc(D.account.email), '已登录'];
  return `<aside class="side" aria-label="主导航">
    <div class="side-top"><span class="brand">${MARK}<b>CodeTether</b></span><span class="sp"></span>
      <button class="btn ghost icon sm" title="搜索（Ctrl K）" onclick="openModal('palette')">${I('search')}</button></div>
    <div class="side-new"><button class="btn new" onclick="openModal('new${here(pg)}')">${I('edit')}新建会话<kbd>Ctrl N</kbd></button></div>
    <div class="side-scroll" id="side-scroll">
      ${item('#/inbox', 'inbox', '待处理', active === 'inbox', n ? `<span class="badge">${n}</span>` : '')}
      <div class="side-label"><a href="#/devices" ${active === 'devices' && !pg.dev && !pg.proj && !pg.current ? 'aria-current="page"' : ''}>设备</a><button class="tr-add on" id="side-adddev" title="添加设备" onclick="go('#/add')">${I('plus')}</button></div>
      <div class="tree">${tree}</div>
    </div>
    <div class="side-foot">
      <a class="me" href="#/settings/account"><span class="avatar ${s.out || s.unconfigured ? 'anon' : ''}">${s.out || s.unconfigured ? I('user') : esc(D.account.name)}</span><span class="grow"><b class="trunc">${me[0]}</b><small class="trunc">${me[1]}</small></span></a>
      <a class="btn ghost icon sm" href="#/settings/appearance" title="设置" ${active === 'settings' ? 'aria-current="page"' : ''}>${I('settings')}</a>
    </div></aside>`;
}
function tabbar(active) {
  const n = openAttn().length;
  const t = (href, ic, label, key, extra = '') => `<a href="${href}" ${active === key ? 'aria-current="page"' : ''}>${I(ic)}${label}${extra}</a>`;
  return `<nav class="tabbar" aria-label="主导航">${t('#/devices', 'monitor', '设备', 'devices')}${t('#/inbox', 'inbox', '待处理', 'inbox', n ? `<span class="badge">${n}</span>` : '')}${t('#/settings/appearance', 'settings', '设置', 'settings')}</nav>`;
}
// page = { active, dev, proj, current, crumbs, actions, body }；dev / proj / current 用于侧栏高亮
function shell(page) {
  return `<div class="window os-${ui.os}"><span class="traffic"><i></i><i></i><i></i></span>${sidebar(page)}
    <div class="main"><header class="topbar"><nav class="crumbs trunc grow" aria-label="位置">${page.crumbs || ''}</nav>${page.actions || ''}<span class="demo-pill" title="原型：所有操作只修改内存中的演示数据">演示数据</span>${WINCTL}</header>
      ${page.raw ? page.body : `<div class="scroll" id="main">${page.body}</div>`}</div>${tabbar(page.active)}</div>`;
}
// 手机宽度只显示「返回 + 当前标题」，返回到最近一个有链接的上级
const crumbs = (...xs) => {
  const up = xs.filter(Array.isArray).pop();
  const back = up ? `<a class="crumb-back" href="${up[1]}" title="返回${esc(up[0])}">${I('chev')}</a>` : '';
  return back + xs.map((x, i) => (Array.isArray(x) ? `<span class="crumb"><a href="${x[1]}">${esc(x[0])}</a>${I('chev')}</span>` : i === xs.length - 1 ? `<b class="trunc">${esc(x)}</b>` : `<span class="crumb">${esc(x)}${I('chev')}</span>`)).join('');
};
// 项目和会话的面包屑：设备 › 项目
const projCrumbs = (p) => [[mach(p.m).name, `#/devices/${p.m}`], [p.name, `#/projects/${p.id}`]];

/* ---------- 常用片段 ---------- */
const note = (t) => `<div class="design-note"><b>设计注释</b>${t}</div>`;
const notice = (kind, ic, title, desc = '', acts = '') => `<div class="notice ${kind}">${I(ic)}<div class="grow"><b>${title}</b>${desc ? `<div class="d">${desc}</div>` : ''}</div>${acts ? `<div class="acts">${acts}</div>` : ''}</div>`;
const empty = (ic, title, desc, acts = '') => `<div class="empty"><span class="glyph">${I(ic)}</span><b>${title}</b><span>${desc}</span>${acts ? `<div class="acts">${acts}</div>` : ''}</div>`;
const skel = (n = 4) => `<div class="list">${Array.from({ length: n }, () => `<div class="item static"><span class="dot"></span><div class="grow col" style="gap:8px"><div class="skel" style="width:55%"></div><div class="skel" style="width:30%;height:9px"></div></div></div>`).join('')}</div>`;
const techErr = (code, src) => `<details class="tech"><summary>技术详情</summary><pre>code: ${code}\nsource: ${src}\nat: 2026-10-16 18:40</pre></details>`;
const retry = (label = '重试') => `<button class="btn sm" onclick="this.innerHTML='正在重试…'">${I('refresh')}${label}</button>`;
// 会话行（SessionItem）。inProj：所在列表已经是一个项目里的会话，元信息只写 AI 工具；noDev：在设备页里，只写项目
function sessionItem(c, opt = {}) {
  const p = cProj(c), m = cMach(c), sep = '<span class="faint">·</span>';
  const sub = (opt.inProj ? [`<span class="nowrap">${agentName(c.agent)}</span>`]
    : [...(opt.noDev ? [] : [`${pcIcon(m)}<span class="trunc">${esc(m.name)}</span>`]), `${I('folder')}<span class="trunc">${esc(p.name)}</span>`])
    .concat(c.origin === 'adopted_native' ? [`<span class="nowrap">从 ${agentName(c.agent)} 导入</span>`] : []).join(sep);
  const acts = c.archived
    ? `<button class="btn ghost sm" onclick="toggleArchive('${c.id}')">${I('archive')}取消归档</button>`
    : `<button class="btn ghost icon sm" title="${c.pinned ? '取消置顶' : '置顶'}" onclick="togglePin('${c.id}')">${I('pin')}</button><button class="btn ghost icon sm" title="${busy(c) ? '这一轮结束后才能归档' : '归档'}" ${busy(c) ? 'disabled' : ''} onclick="toggleArchive('${c.id}')">${I('archive')}</button><button class="btn ghost icon sm" title="更多" onclick="openModal('rename:${c.id}')">${I('more')}</button>`;
  return `<a class="item" href="#/c/${c.id}">
    ${ag(c.agent, false)}
    <div class="grow"><div class="row"><span class="t trunc" title="${esc(c.title)}">${esc(c.title)}</span>${c.pinned ? `<span class="faint" title="已置顶">${I('pin')}</span>` : ''}</div>
      <div class="sub">${sub}</div></div>
    <div class="end">${status(c)}<span class="when">${esc(c.at)}</span>
      <span class="acts" onclick="event.preventDefault();event.stopPropagation()">${acts}</span></div></a>`;
}
// Host 规则：已归档的会话不能置顶，归档时清除置顶；有进行中的一轮（running / waiting）时不能归档
window.togglePin = (id) => { const c = conv(id); if (!c.archived) c.pinned = !c.pinned; render(); };
window.toggleArchive = (id) => { const c = conv(id); if (busy(c)) return; c.archived = !c.archived; if (c.archived) c.pinned = false; render(); };

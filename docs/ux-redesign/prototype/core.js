// CodeTether 原型 v3 — 公共层：数据访问、能力门控、主题、外壳（侧栏项目树 / 顶栏 / 手机 Tab）。
// 所有操作只修改内存中的演示数据，不调用真实接口。
const D = window.DEMO;
const Q = new URLSearchParams(location.search);
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hq = (k) => new URLSearchParams(location.hash.split('?')[1] || '').get(k);
// open：侧栏中展开的项目（含其他主机上的项目，键为 host_project）；more：已展开“显示全部”的文件夹（键为 project.machine）
const ui = { os: Q.get('os') || 'win', theme: Q.get('theme') || localStorage.getItem('ct-theme') || 'light', modal: null,
  f: { status: 'all', agent: 'all', p: '' }, pq: '', open: new Set(['p-web', 'p-api']), more: new Set() };

/* ---------- 数据 ---------- */
const mach = (id) => D.machines.find((m) => m.id === id);
const proj = (id) => D.projects.find((p) => p.id === id);
const host = (id) => D.hosts.find((h) => h.id === id);
// 原型场景：由路由和状态参数推出，让侧栏、Tab 和页面显示同一种状态
function scene() {
  const r = routePath(), st = hq('state'), step = hq('step');
  const out = !D.account.signedIn || hq('account') === 'out' || (r === 'signin' && step !== 'unconfigured');
  return { out, unconfigured: r === 'signin' && step === 'unconfigured', empty: r === 'projects' && st === 'empty', loading: r === 'projects' && st === 'loading', noAttn: st === 'empty' || hq('f') === 'none',
    hostErr: r === 'projects' && st === 'error' ? 'h-studio' : '', host: (r === 'settings/account' && hq('host')) || D.account.localHost };
}
const hostConvs = () => { const s = scene(); return s.out ? [] : D.hostConversations.filter((c) => host(c.host).access === 'authorized' && c.host !== s.hostErr); };
const conv = (id) => D.conversations.find((c) => c.id === id) || D.hostConversations.find((c) => c.id === id);
const isRO = (c) => !!c.host; // 其他主机上的会话：supervisor_read，只读
const cMach = (c) => isRO(c) ? host(c.host).machines.find((m) => m.id === c.m) : mach(c.m);
const cProj = (c) => isRO(c) ? host(c.host).projects.find((p) => p.id === c.p) : proj(c.p);
const allConvs = () => (scene().empty ? [] : [...D.conversations, ...hostConvs()].filter((c) => !c.archived).sort((a, b) => a.ago - b.ago));
const projects = () => (scene().empty ? [] : D.projects);
// 已授权且在线、可以读取的其他主机（只读）
const viewHosts = () => (scene().out ? [] : D.hosts.filter((h) => h.access === 'authorized'));
// 一个文件夹（项目 + 电脑）里的会话：置顶在前，其余按最近活动。归档的不在这里显示
const locConvs = (pid, mid, list = D.conversations) => list.filter((c) => c.p === pid && c.m === mid && !c.archived).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || a.ago - b.ago);
// 项目文件夹能不能新建会话：电脑离线 / 不能运行 AI 工具 / 文件夹无法访问（location availability）/ 可用
function locState(l) {
  const m = mach(l.m);
  if (m.kind === 'remote' && m.conn !== 'online') return { ok: false, k: 'off', text: '电脑离线', why: `${m.name} 离线 · ${m.lastSeen}` };
  if (!m.caps.providerExecution) return { ok: false, k: 'off', text: '不能运行', why: `${m.name} 当前不能运行 AI 工具` };
  if (!l.ok) return { ok: false, k: 'err', text: '无法访问', why: '这台电脑上找不到这个文件夹，或没有读取权限' };
  return { ok: true, k: 'ok', text: '可用' };
}
const busy = (c) => c.status === 'running' || c.status === 'waiting'; // 有进行中的一轮：不能归档，也不能再发送
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
// Claude Code 的推理强度（provider-discovery.ts）；Codex 当前没有模型和推理强度选项
const REASON = [['', '默认'], ['low', '低'], ['medium', '中'], ['high', '高'], ['xhigh', '很高'], ['max', '最高']];
const reasonName = (r) => (REASON.find((x) => x[0] === r) || REASON[0])[1];
const ag = (a, label = true, cls = '') => `<span class="ag ${a} ${cls}"><i>${I(a === 'codex' ? 'codex' : 'claude')}</i>${label ? agentName(a) : ''}</span>`;

/* ---------- 能力门控：与 conversation-controls.ts 一致 ---------- */
const canInterrupt = (c) => !isRO(c) && c.agent === 'codex' && mach(c.m).kind === 'local'; // 远程与 Claude Code 当前不支持中断
const canApprove = (c) => !isRO(c) && c.agent === 'codex' && mach(c.m).kind === 'local';   // 远程运行时没有审批原语
// 输入区状态：send（可发送）/ busy（这一轮还没结束，Host 对新消息返回 409）/ wait（等待审批）/ readonly（只读）/ offline（离线）
function gate(c) {
  if (isRO(c)) return { kind: 'readonly' };
  const m = mach(c.m);
  if (m.kind === 'remote' && m.conn !== 'online') return { kind: 'offline', m };
  if (!m.caps.providerExecution) return { kind: 'offline', m };
  if (c.status === 'waiting' && pendingApproval(c) && canApprove(c)) return { kind: 'wait' };
  if (busy(c)) return { kind: 'busy' };
  return { kind: 'send' };
}
// 一个会话的显示状态：直接取 ConversationRecord.status（waiting 即等待批准）
const cStatus = (c) => STATUS[c.status];
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
/* ---------- 侧栏项目树：项目 › 文件夹（项目在某台电脑上的位置）› 会话 ---------- */
const LOC_N = 4; // 每个文件夹默认显示的会话数
const sid = (s) => s.replace(/[^\w-]/g, '_');
window.twist = (k) => { ui.open.has(k) ? ui.open.delete(k) : ui.open.add(k); render(true); };
window.showMore = (k) => { ui.more.has(k) ? ui.more.delete(k) : ui.more.add(k); render(true); };
// 树里只给需要注意的会话显示圆点：运行中 / 等待批准 / 失败；其余留空位保持对齐
const treeDot = (c) => (['running', 'waiting', 'failed'].includes(c.status) ? dotFor(c) : '<span class="dot none"></span>');
const treeConv = (c, current) => `<a class="tree-row ses" href="#/c/${c.id}" ${current === c.id ? 'aria-current="page"' : ''} title="${esc(c.title)}${['running', 'waiting', 'failed'].includes(c.status) ? ' · ' + cStatus(c)[1] : ''}">${treeDot(c)}<span class="trunc grow">${esc(c.title)}</span>${c.pinned ? `<span class="tr-ic" title="已置顶">${I('pin')}</span>` : ''}</a>`;
// 一个文件夹下的会话：默认显示 4 个，当前打开的会话总是可见
function treeConvs(cs, key, current) {
  const all = ui.more.has(key), shown = all ? cs : cs.slice(0, LOC_N);
  if (!all && cs.some((c) => c.id === current) && !shown.some((c) => c.id === current)) shown.push(cs.find((c) => c.id === current));
  if (!cs.length) return '<p class="tree-row none">还没有会话</p>';
  return shown.map((c) => treeConv(c, current)).join('')
    + (cs.length > LOC_N ? `<button class="tree-row more" id="mo-${sid(key)}" onclick="showMore('${key}')">${all ? '收起' : `显示全部 ${cs.length} 个`}</button>` : '');
}
// 文件夹行：电脑图标 + 电脑名，悬停显示路径；可用时悬停出现“+”，否则显示原因
function treeLoc(p, l, current) {
  const m = mach(l.m), st = locState(l), key = `${p.id}.${l.m}`;
  return `<div class="tree-row loc ${st.ok ? '' : 'dim'}"><a class="grow row" href="#/projects/${p.id}?scroll=loc-${l.m}" title="${esc(m.name)} · ${esc(l.path)}">${pcIcon(m)}<span class="trunc">${esc(m.name)}</span></a>
    ${st.ok ? `<button class="tr-add" id="nl-${sid(key)}" title="在${nm(m.name)}的这个文件夹中新建会话" onclick="openModal('new:${p.id},${l.m}')">${I('plus')}</button>` : `<span class="tr-tag ${st.k}" title="${esc(st.why)}">${st.text}</span>`}</div>
    ${treeConvs(locConvs(p.id, l.m), key, current)}`;
}
// 收起的项目只显示一个最需要注意的状态
function hotDot(cs) {
  const k = ['waiting', 'running', 'failed'].find((s) => cs.some((c) => c.status === s));
  return k ? `<span class="dot ${STATUS[k][0]}" title="有会话${STATUS[k][1]}"></span>` : '';
}
function treeProj(p, pg) {
  const open = ui.open.has(p.id), cur = pg.proj === p.id && !pg.current;
  return `<div class="tree-row proj" ${cur ? 'data-current' : ''}><button class="twist" id="tw-${p.id}" aria-expanded="${open}" aria-label="${open ? '收起' : '展开'} ${esc(p.name)}" onclick="twist('${p.id}')">${I('chev')}</button>
    <a class="grow row" href="#/projects/${p.id}" ${cur ? 'aria-current="page"' : ''}><span class="trunc">${esc(p.name)}</span>${open ? '' : hotDot(D.conversations.filter((c) => c.p === p.id && !c.archived))}</a>
    <button class="tr-add" id="np-${p.id}" title="在${nm(p.name)}中新建会话" onclick="openModal('new:${p.id}')">${I('plus')}</button></div>
    ${open ? p.locations.map((l) => treeLoc(p, l, pg.current)).join('') : ''}`;
}
// 其他主机（只读）：项目 › 电脑 › 会话。读不到或连不上的主机只占一行，点进去看原因
function treeHost(h, pg, s) {
  if (h.id === s.hostErr) return `<a class="tree-row proj flat" href="#/computers/${h.id}">${I('alert')}<span class="trunc grow">${esc(h.name)}</span><span class="tr-tag err">读取失败</span></a>`;
  if (pcState(h).can !== 'view') return `<a class="tree-row proj flat dim" href="#/computers/${h.id}">${I(h.icon)}<span class="trunc grow">${esc(h.name)}</span><span class="tr-tag">无法连接</span></a>`;
  const cs = hostConvs().filter((c) => c.host === h.id);
  return h.projects.map((p) => {
    const k = `${h.id}_${p.id}`, open = ui.open.has(k), m = h.machines.find((x) => x.id === p.m), pc = locConvs(p.id, p.m, cs);
    return `<button class="tree-row proj" id="tw-${k}" aria-expanded="${open}" onclick="twist('${k}')"><span class="twist">${I('chev')}</span><span class="trunc">${esc(p.name)}</span><span class="tr-host trunc">${esc(h.name)}</span>${open ? '' : hotDot(pc)}</button>
      ${open ? `<div class="tree-row loc"><a class="grow row" href="#/computers/${h.id}?m=${m.id}" title="${esc(m.name)} · ${esc(p.path)}">${pcIcon(m)}<span class="trunc">${esc(m.name)}</span></a><span class="tr-ic" title="仅查看">${I('eye')}</span></div>${treeConvs(pc, k, pg.current)}` : ''}`;
  }).join('');
}
// 侧栏按钮和 Ctrl N：预选当前所在的项目和文件夹（~ 只预选，仍可改项目；树里的“+”用 : 固定项目）
const here = (pg = {}) => { const c = pg.current && conv(pg.current); return c && !isRO(c) ? `~${c.p},${c.m}` : pg.proj ? `~${pg.proj}` : ''; };
// 打开项目或会话时，在侧栏展开它所在的项目
function reveal() {
  const r = routePath(), mp = r.match(/^projects\/([\w-]+)/), mc = r.match(/^c\/([\w-]+)$/), c = mc && conv(mc[1]);
  if (mp) ui.open.add(mp[1]);
  if (c) ui.open.add(isRO(c) ? `${c.host}_${c.p}` : c.p);
}
function sidebar(pg) {
  const n = openAttn().length, s = scene(), active = pg.active;
  const item = (href, ic, label, on, extra = '') => `<a class="nav-item" href="${href}" ${on ? 'aria-current="page"' : ''}>${I(ic)}<span class="trunc">${label}</span>${extra}</a>`;
  const tree = s.loading ? [62, 48, 70].map((w) => `<div class="tree-row proj"><span class="skel" style="width:${w}%"></span></div>`).join('')
    : projects().map((p) => treeProj(p, pg)).join('') || `<div class="side-empty">还没有项目。<button class="btn sm" onclick="openModal('addproj')">${I('plus')}添加项目文件夹</button></div>`;
  const hs = s.loading || s.empty ? [] : viewHosts();
  // 账号行的第二行与“账号与共享”页一致；文字保持短，224px 侧栏下不换行
  const me = s.unconfigured ? ['未登录', '未配置账号服务'] : s.out ? ['未登录', '本机功能不需要登录']
    : [esc(D.account.email), { claimed: '已登录 · 本机已共享', enabled_unclaimed: '已登录 · 共享未完成', disabled: '已登录 · 本机未共享' }[s.host]];
  return `<aside class="side" aria-label="主导航">
    <div class="side-top"><span class="brand">${MARK}<b>CodeTether</b></span><span class="sp"></span>
      <button class="btn ghost icon sm" title="搜索（Ctrl K）" onclick="openModal('palette')">${I('search')}</button></div>
    <div class="side-new"><button class="btn new" onclick="openModal('new${here(pg)}')">${I('edit')}新建会话<kbd>Ctrl N</kbd></button></div>
    <div class="side-scroll" id="side-scroll">
      ${item('#/inbox', 'inbox', '待处理', active === 'inbox', n ? `<span class="badge">${n}</span>` : '')}
      ${item('#/computers', 'monitor', '我的电脑', active === 'computers')}
      <div class="side-label"><a href="#/projects" ${active === 'projects' && !pg.proj && !pg.current ? 'aria-current="page"' : ''}>项目</a><button class="tr-add on" id="side-addproj" title="添加项目文件夹" onclick="openModal('addproj')">${I('plus')}</button></div>
      <div class="tree">${tree}</div>
      ${hs.length ? `<div class="side-label"><span>其他主机 · 仅查看</span></div><div class="tree">${hs.map((h) => treeHost(h, pg, s)).join('')}</div>` : ''}
    </div>
    <div class="side-foot">
      <a class="me" href="#/settings/account"><span class="avatar ${s.out || s.unconfigured ? 'anon' : ''}">${s.out || s.unconfigured ? I('user') : esc(D.account.name)}</span><span class="grow"><b class="trunc">${me[0]}</b><small class="trunc">${me[1]}</small></span></a>
      <a class="btn ghost icon sm" href="#/settings/appearance" title="设置" ${active === 'settings' ? 'aria-current="page"' : ''}>${I('settings')}</a>
    </div></aside>`;
}
function tabbar(active) {
  const n = openAttn().length;
  const t = (href, ic, label, key, extra = '') => `<a href="${href}" ${active === key ? 'aria-current="page"' : ''}>${I(ic)}${label}${extra}</a>`;
  return `<nav class="tabbar" aria-label="主导航">${t('#/projects', 'folder', '项目', 'projects')}${t('#/inbox', 'inbox', '待处理', 'inbox', n ? `<span class="badge">${n}</span>` : '')}${t('#/computers', 'monitor', '电脑', 'computers')}${t('#/settings/appearance', 'settings', '设置', 'settings')}</nav>`;
}
// page = { active, proj, current, crumbs, actions, body }；proj / current 用于侧栏高亮
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

/* ---------- 常用片段 ---------- */
const note = (t) => `<div class="design-note"><b>设计注释</b>${t}</div>`;
const notice = (kind, ic, title, desc = '', acts = '') => `<div class="notice ${kind}">${I(ic)}<div class="grow"><b>${title}</b>${desc ? `<div class="d">${desc}</div>` : ''}</div>${acts ? `<div class="acts">${acts}</div>` : ''}</div>`;
const empty = (ic, title, desc, acts = '') => `<div class="empty"><span class="glyph">${I(ic)}</span><b>${title}</b><span>${desc}</span>${acts ? `<div class="acts">${acts}</div>` : ''}</div>`;
const skel = (n = 4) => `<div class="list">${Array.from({ length: n }, () => `<div class="item static"><span class="dot"></span><div class="grow col" style="gap:8px"><div class="skel" style="width:55%"></div><div class="skel" style="width:30%;height:9px"></div></div></div>`).join('')}</div>`;
const techErr = (code, src) => `<details class="tech"><summary>技术详情</summary><pre>code: ${code}\nsource: ${src}\nat: 2026-10-16 18:40</pre></details>`;
const retry = (label = '重试') => `<button class="btn sm" onclick="this.innerHTML='正在重试…'">${I('refresh')}${label}</button>`;
// 会话行（SessionItem）。hidePc / hideProj：所在列表已经按电脑或项目分组时省略
function sessionItem(c, opt = {}) {
  const p = cProj(c), sep = '<span class="faint">·</span>';
  const sub = [opt.hidePc ? '' : `${pcIcon(cMach(c))}<span class="trunc">${esc(opt.machOnly ? cMach(c).name : where(c))}</span>`,
    opt.hideProj ? '' : `${I('folder')}<span class="trunc">${esc(p.name)}</span>`,
    opt.hidePc && opt.hideProj ? `<span class="nowrap">${agentName(c.agent)}</span>` : '',
    c.origin === 'adopted_native' ? `<span class="nowrap">从 ${agentName(c.agent)} 导入</span>` : '',
    isRO(c) && !opt.noRO ? `<span class="ro-tag">${I('eye')}仅查看</span>` : ''].filter(Boolean).join(sep);
  const acts = c.archived
    ? `<button class="btn ghost sm" onclick="toggleArchive('${c.id}')">${I('archive')}取消归档</button>`
    : `<button class="btn ghost icon sm" title="${c.pinned ? '取消置顶' : '置顶'}" onclick="togglePin('${c.id}')">${I('pin')}</button><button class="btn ghost icon sm" title="${busy(c) ? '这一轮结束后才能归档' : '归档'}" ${busy(c) ? 'disabled' : ''} onclick="toggleArchive('${c.id}')">${I('archive')}</button><button class="btn ghost icon sm" title="更多" onclick="openModal('rename:${c.id}')">${I('more')}</button>`;
  return `<a class="item" href="#/c/${c.id}">
    ${ag(c.agent, false)}
    <div class="grow"><div class="row"><span class="t trunc" title="${esc(c.title)}">${esc(c.title)}</span>${c.pinned && !opt.noPin ? `<span class="faint" title="已置顶">${I('pin')}</span>` : ''}</div>
      <div class="sub">${sub}</div></div>
    <div class="end">${status(c)}<span class="when">${esc(c.at)}</span>
      ${isRO(c) ? '' : `<span class="acts" onclick="event.preventDefault();event.stopPropagation()">${acts}</span>`}</div></a>`;
}
// Host 规则：已归档的会话不能置顶，归档时清除置顶；有进行中的一轮（running / waiting）时不能归档
window.togglePin = (id) => { const c = conv(id); if (!c.archived) c.pinned = !c.pinned; render(); };
window.toggleArchive = (id) => { const c = conv(id); if (busy(c)) return; c.archived = !c.archived; if (c.archived) c.pinned = false; render(); };

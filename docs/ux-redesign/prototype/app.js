// CodeTether 可点击原型 — hash 路由。所有操作仅修改内存中的演示数据。
const D = window.DEMO;
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mach = (id) => D.machines.find((m) => m.id === id);
const proj = (id) => D.projects.find((p) => p.id === id);
const conv = (id) => D.conversations.find((c) => c.id === id);
const tag = (cls, text) => `<span class="tag ${cls}">${esc(text)}</span>`;
const st = (s) => tag(STATUS[s][0], STATUS[s][1]);
const cn = (m) => tag(CONN[m.conn][0], CONN[m.conn][1]);
const agent = (a) => a === 'codex' ? '<span class="agent codex"><b>C</b>Codex</span>' : '<span class="agent claude"><b>✱</b>Claude Code</span>';
const osIcon = (m) => I(m.kind === 'local' ? 'monitor' : m.platform === 'Linux' ? 'server' : 'laptop');
const openCount = () => D.attention.filter((a) => a.open).length;
let ui = { os: new URLSearchParams(location.search).get('os') || 'win', filter: 'all', agentF: 'all', devF: 'all', q: '', modal: null };

/* ---------- 执行能力：与 conversation-controls.ts 的门控一致 ---------- */
function canCompose(c) {
  const m = mach(c.m);
  if (m.kind === 'remote' && m.conn !== 'online') return { ok: false, why: `${m.name} 当前离线，恢复连接后才能发送。历史仍可阅读。`, act: ['重试连接', `#/devices/${m.id}`] };
  if (!m.caps.providerExecution) return { ok: false, why: `${m.name} 目前不能运行 AI 工具。`, act: ['查看设备', `#/devices/${m.id}`] };
  // Provider descriptor 没有排队 / 运行中补充指令能力（packages/protocol/src/providers.ts），运行中只能等待或中断
  if (c.status === 'running') return { ok: false, why: `${c.agent === 'codex' ? 'Codex' : 'Claude Code'} 正在执行本轮，暂不支持排队或补充指令。${canInterrupt(c) ? '可以等待完成，或中断后重新发送。' : '请等待本轮完成后再发送。'}`, busy: true };
  return { ok: true };
}
const host = (id) => D.hosts.find((h) => h.id === id);
const acc = (h) => tag(ACCESS[h.access][0], ACCESS[h.access][1]);
const pres = (h) => h.access === 'authorized' ? tag(PRESENCE[h.presence][0], PRESENCE[h.presence][1]) : '';
const hostIcon = (h) => I(h.platform === 'Windows' ? 'monitor' : 'laptop');
const note = (t) => `<div class="design-note"><b>设计注释</b>${t}</div>`;
function canInterrupt(c) { const m = mach(c.m); return c.agent === 'codex' && m.kind === 'local'; } // 远程与 Claude Code 当前不支持中断
function canApprove(c) { const m = mach(c.m); return c.agent === 'codex' && m.kind === 'local'; }   // 远程运行时无审批原语

/* ---------- Shell ---------- */
function titlebar(crumbs) {
  return `<header class="titlebar drag" title="可拖动区域">
    <span class="traffic"><i></i><i></i><i></i></span>
    <span class="crumbs trunc">${crumbs}</span><span class="sp"></span>
    <button class="btn ghost sm" style="-webkit-app-region:no-drag" onclick="go('#/search')">${I('search')}搜索会话 <kbd>Ctrl K</kbd></button>
    <span class="winctl"><span>—</span><span>☐</span><span>✕</span></span></header>`;
}
function nav(active) {
  const item = (href, ic, label, key, extra = '') => `<a class="nav-item" href="${href}" ${active === key ? 'aria-current="page"' : ''}>${I(ic)}<span class="trunc">${label}</span>${extra}</a>`;
  const n = openCount();
  return `<nav class="nav" aria-label="主导航">
    <div class="brand"><span class="mark">C</span><span class="nav-label">CodeTether</span></div>
    <button class="btn primary" style="margin:0 4px 10px" onclick="openModal('new')">${I('plus')}<span class="nav-label">新建会话</span></button>
    ${item('#/sessions', 'chat', '会话', 'sessions')}
    ${item('#/devices', 'monitor', '设备', 'devices')}
    ${item('#/inbox', 'inbox', '待处理', 'inbox', n ? `<span class="count">${n}</span>` : '')}
    <div class="nav-sec nav-label">浏览</div>
    ${item('#/projects', 'folder', '项目', 'projects')}
    ${item('#/sessions?view=archived', 'archive', '已归档', 'archived')}
    <div class="nav-sec nav-label">本机主机</div>
    ${D.machines.map((m) => `<a class="nav-item" href="#/devices/${m.id}" ${active === m.id ? 'aria-current="page"' : ''}>${osIcon(m)}<span class="trunc grow">${esc(m.name)}</span><span class="dot ${CONN[m.conn][0]}"></span></a>`).join('')}
    <div class="nav-sec nav-label">其他主机 · 只读</div>
    ${D.hosts.filter((h) => h.access === 'authorized').map((h) => `<a class="nav-item" href="#/hosts/${h.id}" ${active === h.id ? 'aria-current="page"' : ''}>${hostIcon(h)}<span class="trunc grow">${esc(h.name)}</span><span class="dot ${PRESENCE[h.presence][0]}"></span></a>`).join('')}
    <div class="nav-foot">${item('#/settings/general', 'settings', '设置', 'settings')}</div></nav>`;
}
function shell(active, crumbs, body) {
  return `<div class="window os-${ui.os}">${titlebar(crumbs)}<div class="shell">${nav(active)}<main class="main" id="main">${body}</main></div></div>`;
}
/* ---------- 会话行（共享组件 SessionRow） ---------- */
function sessionRow(c, opts = {}) {
  const m = mach(c.m), p = proj(c.p);
  return `<div class="srow" role="link" tabindex="0" onclick="go('#/c/${c.id}')" onkeydown="if(event.key==='Enter')go('#/c/${c.id}')">
    <div class="col" style="gap:3px;min-width:0">
      <div class="row" style="min-width:0">${c.pinned ? `<span class="faint" title="已置顶">${I('pin')}</span>` : ''}<span class="t trunc" title="${esc(c.title)}">${esc(c.title)}</span></div>
      <div class="meta">${agent(c.agent)}<span class="sep"></span>${I('folder')}<span class="trunc">${esc(p.name)}</span>${opts.hideDevice ? '' : `<span class="sep"></span>${osIcon(m)}<span class="trunc">${esc(m.name)}</span>`}${c.origin === 'adopted_native' ? '<span class="sep"></span><span>已导入</span>' : ''}</div>
    </div>
    <div class="right">${st(c.status)}<span>${esc(c.at)}</span></div>
    <div class="hover-act" onclick="event.stopPropagation()">
      <button class="btn ghost sm icon-btn" title="${c.pinned ? '取消置顶' : '置顶'}" onclick="togglePin('${c.id}')">${I('pin')}</button>
      <button class="btn ghost sm icon-btn" title="${c.archived ? '恢复' : '归档'}" ${c.status === 'running' ? 'disabled' : ''} onclick="toggleArchive('${c.id}')">${I('archive')}</button>
      <button class="btn ghost sm icon-btn" title="重命名" onclick="openModal('rename:${c.id}')">${I('more')}</button></div></div>`;
}
window.togglePin = (id) => { const c = conv(id); c.pinned = !c.pinned; render(); };
window.toggleArchive = (id) => { const c = conv(id); if (c.status === 'running') return; c.archived = !c.archived; render(); };

/* ---------- 会话首页 ---------- */
function sessionsPage(params) {
  const archived = params.get('view') === 'archived';
  const state = params.get('state'); // demo: loading | error | empty
  let list = D.conversations.filter((c) => !!c.archived === archived);
  if (ui.filter !== 'all') list = list.filter((c) => c.status === ui.filter);
  if (ui.agentF !== 'all') list = list.filter((c) => c.agent === ui.agentF);
  if (ui.devF !== 'all') list = list.filter((c) => c.m === ui.devF);
  if (ui.q) list = list.filter((c) => c.title.includes(ui.q));
  const chip = (k, v, label) => `<button class="chip" aria-pressed="${ui[k] === v}" onclick="setF('${k}','${v}')">${label}</button>`;
  const active = list.filter((c) => c.status === 'running' || c.status === 'waiting');
  const pinned = list.filter((c) => c.pinned && !active.includes(c));
  const rest = list.filter((c) => !active.includes(c) && !pinned.includes(c));
  const group = (title, ic, arr) => arr.length ? `<div class="group-h">${I(ic)}${title}<span class="faint">${arr.length}</span></div><div class="card list">${arr.map((c) => sessionRow(c)).join('')}</div>` : '';
  let body;
  if (state === 'loading') body = `<div class="card card-b col">${[1, 2, 3, 4].map(() => '<div class="skel" style="width:70%"></div><div class="skel" style="width:40%;height:10px;margin-bottom:12px"></div>').join('')}</div>`;
  else if (state === 'error') body = errorBlock('部分设备的会话暂时无法读取', 'build-server 离线。其他设备的会话已正常显示。', '重试 build-server');
  else if (!list.length || state === 'empty') body = `<div class="card empty">${I('chat')}<b>${archived ? '没有已归档的会话' : ui.q ? `没有找到“${esc(ui.q)}”` : '还没有会话'}</b><span>${archived ? '归档的会话会显示在这里，可随时恢复。' : '选择一台设备上的项目，开始第一个会话。'}</span>${archived ? '' : `<button class="btn primary" onclick="openModal('new')">${I('plus')}新建会话</button>`}</div>`;
  else body = archived ? `<div class="card list">${list.map((c) => sessionRow(c)).join('')}</div>` : group('进行中', 'clock', active) + group('已置顶', 'pin', pinned) + group('最近', 'chat', rest);
  return `<div class="page">
    <div class="page-head"><div class="grow"><h1>${archived ? '已归档会话' : '会话'}</h1><p>${archived ? '归档不会删除历史，恢复后回到会话列表。' : '所有设备上的会话。点击即可继续。'}</p></div>
      ${archived ? `<a class="btn" href="#/sessions">${I('back')}返回会话</a>` : `<button class="btn primary" onclick="openModal('new')">${I('plus')}新建会话</button>`}</div>
    <div class="row" style="margin-bottom:12px;gap:12px;flex-wrap:wrap">
      <div class="search-wrap" style="width:340px">${I('search')}<input class="search" id="q" placeholder="筛选标题" value="${esc(ui.q)}" oninput="ui.q=this.value;render(true)"></div>
      <div class="chips">${chip('filter', 'all', '全部')}${chip('filter', 'running', '运行中')}${chip('filter', 'waiting', '需要处理')}${chip('filter', 'completed', '已完成')}${chip('filter', 'failed', '失败')}</div>
      <span class="sp"></span>
      <select class="input" style="width:auto" onchange="setF('agentF',this.value)" aria-label="Agent"><option value="all">全部 Agent</option><option value="codex" ${ui.agentF === 'codex' ? 'selected' : ''}>Codex</option><option value="claude" ${ui.agentF === 'claude' ? 'selected' : ''}>Claude Code</option></select>
      <select class="input" style="width:auto" onchange="setF('devF',this.value)" aria-label="设备"><option value="all">全部设备</option>${D.machines.map((m) => `<option value="${m.id}" ${ui.devF === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
    <p class="help" style="margin:-4px 0 12px">范围：本机主机的 ${D.machines.length} 台电脑 · ${D.projects.length} 个项目。其他主机的会话在“设备 → 其他主机”中只读查看。搜索框只匹配已加载的标题；搜索发送过的内容请用 <a href="#/search">按项目搜索</a>。</p>
    ${note('列表由前端按项目逐个读取后合并（D1）。项目很多时需要 Host 聚合接口。')}
    ${body}</div>`;
}
window.setF = (k, v) => { ui[k] = v; render(); };
function errorBlock(title, detail, action) {
  return `<div class="banner err">${I('alert')}<div class="grow"><b>${esc(title)}</b><span class="muted">${esc(detail)}</span>
    <details class="tech" style="margin-top:6px"><summary>技术详情</summary><pre>code: machine_offline\nsource: machine_transport\nat: 2026-10-16 18:40</pre></details></div>
    <button class="btn sm" onclick="this.textContent='正在重试…'">${I('refresh')}${esc(action)}</button></div>`;
}
/* ---------- 设备列表 ---------- */
function nextStep(m) {
  if (m.kind === 'local') return [`${I('check')}可以在这台电脑上新建会话`, '打开'];
  if (m.conn === 'online' && m.caps.providerExecution) return [`${I('check')}可以查看和继续会话${m.transport === 'relay' ? '（经 Internet Relay）' : ''}`, '打开'];
  if (m.conn === 'offline') return [`${I('wifi_off')}离线。可阅读已保存的历史；上次在线 ${m.lastSeen || '未知'}`, '查看'];
  if (m.conn === 'recovery_required') return [`${I('alert')}地址已变化，需要更新连接地址`, '更新地址'];
  return [`${I('alert')}需要处理连接问题`, '查看'];
}
function deviceCard(m) {
  const projects = D.projects.filter((p) => p.locations.some((l) => l.m === m.id));
  const [next, cta] = nextStep(m);
  return `<article class="card dev" tabindex="0" onclick="go('#/devices/${m.id}')" onkeydown="if(event.key==='Enter')go('#/devices/${m.id}')">
    <div class="row"><span class="os">${osIcon(m)}</span><div class="grow"><div class="row"><b class="trunc">${esc(m.name)}</b>${m.kind === 'local' ? tag('info nodot', '这台电脑') : ''}</div>
      <div class="faint" style="font-size:12px">${esc(m.platform)} · ${esc(m.arch)}</div></div></div>
    <dl class="facts">
      <dt>连接</dt><dd>${cn(m)}${m.kind === 'remote' && m.transport !== 'unavailable' ? ` <span class="faint">${m.transport === 'relay' ? '经 Relay' : '局域网直连'}</span>` : ''}</dd>
      <dt>访问</dt><dd>${m.kind === 'local' ? '<span class="muted">本机，完全访问</span>' : '<span class="muted">已配对 · 可查看与发送</span>'}</dd>
      <dt>AI 工具</dt><dd class="row" style="gap:6px;flex-wrap:wrap">${m.providers.map((p) => `<span class="agent ${p.id}"><b>${p.id === 'codex' ? 'C' : '✱'}</b>${p.label}</span>`).join('')}${m.observed === 'last_known' ? '<span class="faint">（上次已知）</span>' : ''}</dd>
      <dt>项目</dt><dd class="muted">${projects.length} 个已登记</dd></dl>
    <div class="next"><span class="grow row">${next}</span><span class="btn sm">${cta}${I('chev')}</span></div></article>`;
}
function hostCard(h) {
  const a = h.access;
  const body = a === 'authorized'
    ? h.presence === 'online' ? `${I('eye')}可以查看 Machine、项目和会话（只读）` : `${I('wifi_off')}已授权，但现在连不上这台主机`
    : a === 'pending' ? `${I('clock')}申请已发送。对方下次打开 CodeTether 时会看到。`
      : a === 'denied' ? `${I('x')}对方拒绝了申请。可以联系对方后重新申请。`
        : a === 'expired' || a === 'cancelled' ? `${I('clock')}申请已${a === 'expired' ? '过期' : '取消'}，可以重新申请。` : `${I('shield')}申请只读访问后才能查看这台主机。`;
  const cta = a === 'authorized' ? (h.presence === 'online' ? `<a class="btn sm primary" href="#/hosts/${h.id}">打开${I('chev')}</a>` : `<button class="btn sm" onclick="event.stopPropagation();this.textContent='正在重试…'">${I('refresh')}重试</button>`)
    : a === 'pending' ? `<button class="btn sm ghost" onclick="event.stopPropagation();setAccess('${h.id}','cancelled')">取消申请</button>`
      : `<button class="btn sm primary" onclick="event.stopPropagation();setAccess('${h.id}','pending')">${a === 'none' ? '申请访问' : '重新申请'}</button>`;
  return `<article class="card dev" ${a === 'authorized' && h.presence === 'online' ? `tabindex="0" onclick="go('#/hosts/${h.id}')"` : ''}>
    <div class="row"><span class="os">${hostIcon(h)}</span><div class="grow"><b class="trunc">${esc(h.name)}</b><div class="faint" style="font-size:12px">${esc(h.platform)} · 其他主机</div></div></div>
    <dl class="facts"><dt>访问</dt><dd>${acc(h)}</dd><dt>连接</dt><dd>${a === 'authorized' ? pres(h) + (h.transport ? ` <span class="faint">${h.transport === 'relay' ? '经 Relay' : '局域网直连'}</span>` : '') : '<span class="faint">授权后检查</span>'}</dd></dl>
    <div class="next"><span class="grow row">${body}</span>${cta}</div></article>`;
}
window.setAccess = (id, v) => { host(id).access = v; render(); };
function accessRequestsBlock() {
  const open = D.accessRequests.filter((r) => r.open);
  if (!open.length) return '';
  return `<section id="requests" style="margin-top:28px"><div class="group-h">${I('shield')}访问申请<span class="faint">${open.length}</span><span class="sp"></span><span class="help">有设备申请查看这台电脑（只读）</span></div>
    <div class="card list">${open.map((r) => `<div class="srow" style="cursor:default"><div class="col" style="gap:3px;min-width:0"><span class="t">${esc(r.device)} <span class="faint">· ${esc(r.platform)}</span></span>
      <span class="meta"><span>权限：只读查看工作区</span><span class="sep"></span><span>${esc(r.expires)}过期</span><span class="sep"></span><span class="mono trunc" title="设备身份">${esc(r.fp)}</span></span></div>
      <div class="right" style="flex-direction:row;align-items:center"><button class="btn sm danger" onclick="reqDone('${r.id}')">拒绝</button><button class="btn sm primary" onclick="reqDone('${r.id}')">允许</button></div></div>`).join('')}</div>
    <p class="help">允许后，对方可以查看这台主机的 Machine、项目和会话，不能发送、审批或中断。目前还不能在界面中撤销已授权的设备（见 05 · 后续规划）。</p></section>`;
}
window.reqDone = (id) => { D.accessRequests.find((r) => r.id === id).open = false; render(); };
function devicesPage(params) {
  const signedIn = D.account.signedIn && params.get('account') !== 'out';
  const hostsBlock = signedIn ? `<div class="dev-grid">${D.hosts.map(hostCard).join('')}
      <button class="card dev empty" style="border-style:dashed;background:none;cursor:pointer" onclick="go('#/connect?mode=desktop')">${I('plus')}<b>添加另一台主机</b><span>在那台电脑上安装 CodeTether Desktop，登录同一账号并启用“作为主机”。</span></button></div>`
    : `<div class="card empty">${I('key')}<b>登录后查看其他主机</b><span>同一账号下启用了“作为主机”的电脑会出现在这里，申请后可以只读查看。本机主机不需要登录。</span><a class="btn primary" href="#/account">登录账号</a></div>`;
  return `<div class="page"><div class="page-head"><div class="grow"><h1>设备</h1><p>这台 CodeTether 管理的电脑，以及你账号下的其他主机。</p></div>
    <a class="btn primary" href="#/connect">${I('link')}连接另一台电脑</a></div>
    <div class="group-h">${I('monitor')}本机主机<span class="faint">${D.machines.length} 台电脑</span><span class="sp"></span><span class="help">可以查看并继续会话</span></div>
    <div class="dev-grid">${D.machines.map(deviceCard).join('')}
      <button class="card dev empty" style="border-style:dashed;background:none;cursor:pointer" onclick="go('#/pair')">${I('server')}<b>添加 CodeTether Node</b><span>Linux 服务器或无界面的电脑：运行 Node，输入它显示的地址和 6 位配对码。</span></button></div>
    <div class="group-h" id="hosts" style="margin-top:28px">${I('globe')}其他主机<span class="faint">${signedIn ? D.hosts.length : ''}</span><span class="sp"></span><span class="help">${signedIn ? `账号 ${esc(D.account.email)} · 只读访问` : '需要登录账号'}</span></div>
    ${hostsBlock}${signedIn ? accessRequestsBlock() : ''}
    <p class="help" style="margin-top:16px">连接状态、访问权限和会话运行状态分别显示。会话数量需要聚合接口，当前未展示。</p></div>`;
}

/* ---------- 设备详情（含 Machine 上下文） ---------- */
function deviceDetail(id, params) {
  const m = mach(id); if (!m) return notFound();
  const tab = params.get('tab') || 'overview';
  const projects = D.projects.filter((p) => p.locations.some((l) => l.m === m.id));
  const convs = D.conversations.filter((c) => c.m === m.id && !c.archived);
  const projState = params.get('proj'); const convState = params.get('conv');
  const t = (k, l) => `<button class="tab" role="tab" aria-selected="${tab === k}" onclick="go('#/devices/${id}?tab=${k}')">${l}</button>`;
  const offlineNote = m.conn === 'offline' ? `<div class="banner warn" style="margin-bottom:16px">${I('wifi_off')}<div class="grow"><b>${esc(m.name)} 当前离线</b><span class="muted">下面是上次同步的内容（${esc(m.lastSeen)}）。可以阅读历史，不能发送新消息。</span></div><button class="btn sm">${I('refresh')}重试连接</button><button class="btn sm ghost" onclick="openModal('addr')">更新地址</button></div>` : '';
  const projBlock = projState === 'error' ? errorBlock('项目列表加载失败', '无法读取这台设备的项目登记。', '重试') : projState === 'loading' ? '<div class="card card-b col"><div class="skel"></div><div class="skel" style="width:60%"></div></div>'
    : projects.length ? `<div class="card list">${projects.map((p) => { const l = p.locations.find((x) => x.m === m.id); return `<div class="srow" onclick="go('#/projects/${p.id}?m=${m.id}')"><div class="col" style="gap:2px;min-width:0"><span class="t">${esc(p.name)}</span><span class="mono faint trunc" title="${esc(l.path)}">${esc(l.path)}</span></div><div class="right">${l.ok ? tag('ok', '可用') : tag('warn', '不可用')}</div></div>`; }).join('')}</div>`
      : `<div class="card empty">${I('folder')}<b>这台设备还没有项目</b><span>添加一个文件夹后即可在这台设备上创建会话。</span><button class="btn" onclick="openModal('addloc')">${I('plus')}添加项目文件夹</button></div>`;
  const convBlock = convState === 'error' ? errorBlock('最近会话加载失败', '项目列表已正常显示，可单独重试会话。', '重试') : convState === 'empty' || !convs.length
    ? `<div class="card empty">${I('chat')}<b>还没有会话</b><span>在下方任意项目中新建会话。</span></div>`
    : `<div class="card list">${convs.slice(0, 5).map((c) => sessionRow(c, { hideDevice: true })).join('')}</div>`;
  const overview = `${offlineNote}<div style="display:grid;grid-template-columns:1.4fr 1fr;gap:20px">
      <section><div class="row" style="margin-bottom:8px"><h3 style="margin:0;font-size:14px">最近会话</h3><span class="sp"></span><a class="btn ghost sm" href="#/sessions">在会话中查看全部${I('chev')}</a></div>${convBlock}</section>
      <section><div class="row" style="margin-bottom:8px"><h3 style="margin:0;font-size:14px">项目</h3><span class="sp"></span><button class="btn ghost sm" onclick="openModal('addloc')">${I('plus')}添加</button></div>${projBlock}</section></div>`;
  const info = `<div class="card"><div class="card-h">设备信息</div><div class="card-b"><dl class="dev facts" style="padding:0">
      <dt>名称</dt><dd>${esc(m.name)}</dd><dt>类型</dt><dd>${m.kind === 'local' ? '本地电脑' : '远程电脑'}</dd><dt>系统</dt><dd>${esc(m.platform)} · ${esc(m.arch)}</dd>
      <dt>连接</dt><dd>${cn(m)}</dd>${m.addr ? `<dt>地址</dt><dd class="mono">${esc(m.addr)}</dd>` : ''}</dl>
      <details class="tech" style="margin-top:12px"><summary>高级信息</summary><pre>machineId: ${m.id}-7f3c…\nnode fingerprint: SHA256:4f:9a:…:c1\ntransport: ${m.transport}\nprovider snapshot: ${m.observed}</pre></details></div></div>`;
  const tools = `<div class="card list">${m.providers.map((p) => `<div class="srow" style="cursor:default"><div class="col" style="gap:2px"><span class="agent ${p.id}"><b>${p.id === 'codex' ? 'C' : '✱'}</b>${p.label}</span><span class="faint" style="font-size:12px">安装：${p.inst === 'available' ? '可用' : '不可用'} · 执行健康：${{ healthy: '正常', degraded: '最近有异常', unknown: '尚未观察' }[p.health]}${m.observed === 'last_known' ? '（上次已知）' : ''}</span></div><div class="right"><button class="btn sm">选择安装</button></div></div>`).join('')}</div>`;
  const conn = m.kind === 'local' ? `<div class="card card-b muted">本机由 CodeTether Desktop 直接管理，无需配对。</div>` : `<div class="col" style="gap:16px">
      <div class="card"><div class="card-h">访问权限</div><div class="card-b col"><div class="row">${tag('ok', '已配对')}<span class="muted">这台电脑信任本机的 CodeTether，可以查看会话、发送消息、登记项目文件夹。</span></div>
        <p class="help">Node 配对是完整访问（本机主机内）。通过账号授权的“其他主机”只有只读权限，在设备 → 其他主机中查看。</p></div></div>
      <div class="card"><div class="card-h">连接方式</div><div class="card-b col"><div class="row"><span class="grow">局域网直连优先，失败时经 Internet Relay</span>${tag(m.relay === 'connected' ? 'ok' : 'offline', m.relay === 'connected' ? 'Relay 已连接' : 'Relay 离线')}</div>
        <div class="row"><button class="btn sm" onclick="openModal('addr')">更新连接地址</button><button class="btn sm">配置 Internet Relay</button><button class="btn sm">${I('refresh')}重试连接</button></div></div></div>
      <div class="card"><div class="card-h" style="color:#f87171">取消配对</div><div class="card-b row"><span class="grow muted">取消后需要重新配对才能访问。仍有项目文件夹登记时不能取消。</span><button class="btn danger sm" ${projects.length ? 'disabled title="请先移除这台设备上的项目文件夹"' : ''} onclick="openModal('unpair')">取消配对</button></div></div></div>`;
  return `<div class="page"><div class="row" style="margin-bottom:6px;flex-wrap:wrap"><a class="btn ghost sm" href="#/devices">${I('back')}设备</a><span class="sp"></span>
      <div class="chips" aria-label="切换电脑">${D.machines.map((x) => `<a class="chip" aria-pressed="${x.id === m.id}" href="#/devices/${x.id}${tab !== 'overview' ? `?tab=${tab}` : ''}"><span class="dot ${CONN[x.conn][0]}"></span> ${esc(x.name)}</a>`).join('')}</div></div>
    <div class="page-head"><span class="os dev" style="padding:0"><span class="os" style="width:44px;height:44px">${osIcon(m)}</span></span><div class="grow"><h1 class="row">${esc(m.name)} ${cn(m)}</h1><p>${esc(m.platform)} · ${m.kind === 'local' ? '这台电脑' : '远程电脑'}${m.transport === 'relay' ? ' · 经 Internet Relay' : ''}</p></div>
      <button class="btn primary" ${m.kind === 'remote' && m.conn !== 'online' ? 'disabled title="设备离线"' : ''} onclick="openModal('new:${m.id}')">${I('plus')}在这台设备上新建会话</button></div>
    <div class="tabs" role="tablist">${t('overview', '概览')}${t('tools', 'AI 工具')}${t('access', '连接与访问')}${t('info', '设备信息')}</div>
    ${{ overview, tools, access: conn, info }[tab]}</div>`;
}
/* ---------- 其他主机（只读，supervisor_read） ---------- */
const READONLY_NOTE = '只读访问：可以查看 Machine、项目、会话历史和正在运行的输出。不能发送消息、审批或中断。';
function hostDetail(id, params) {
  const h = host(id); if (!h || h.access !== 'authorized') return notFound();
  if (h.presence !== 'online' || params.get('state') === 'disconnected') return `<div class="page"><a class="btn ghost sm" href="#/devices">${I('back')}设备</a>
    <div class="card empty" style="margin-top:12px">${I('wifi_off')}<b>暂时连不上 ${esc(h.name)}</b><span>访问授权仍然有效。那台电脑可能已关机、休眠或断网。</span><div class="row"><button class="btn primary" onclick="this.textContent='正在重试…'">${I('refresh')}重试连接</button><a class="btn" href="#/devices">返回设备</a></div></div></div>`;
  const mf = params.get('m') || 'all';
  const convs = h.conversations.filter((c) => mf === 'all' || c.m === mf);
  const hm = (mid) => h.machines.find((x) => x.id === mid), hp = (pid) => h.projects.find((x) => x.id === pid);
  const chip = (v, l) => `<a class="chip" aria-pressed="${mf === v}" href="#/hosts/${h.id}${v === 'all' ? '' : `?m=${v}`}">${l}</a>`;
  return `<div class="page"><a class="btn ghost sm" href="#/devices">${I('back')}设备</a>
    <div class="page-head" style="margin-top:6px"><span class="os" style="width:44px;height:44px">${hostIcon(h)}</span><div class="grow"><h1 class="row">${esc(h.name)} ${pres(h)} ${acc(h)}</h1><p>其他主机 · 身份已验证 · ${h.transport === 'relay' ? '经 Internet Relay' : '局域网直连'}</p></div></div>
    <div class="banner info" style="margin-bottom:16px">${I('eye')}<div><b>只读查看</b><span class="muted">${READONLY_NOTE}查看不会启动 AI 工具或恢复会话。</span></div></div>
    <div class="row" style="margin-bottom:10px"><span class="help">Machine：</span><div class="chips">${chip('all', '全部')}${h.machines.map((m) => chip(m.id, m.name)).join('')}</div></div>
    <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:20px">
      <section><h3 style="margin:0 0 8px;font-size:14px">会话</h3><div class="card list">${convs.map((c) => `<div class="srow" role="link" tabindex="0" onclick="go('#/hosts/${h.id}/c/${c.id}')"><div class="col" style="gap:3px;min-width:0"><span class="t trunc">${esc(c.title)}</span>
        <div class="meta">${agent(c.agent)}<span class="sep"></span>${I('folder')}<span class="trunc">${esc(hp(c.p).name)}</span><span class="sep"></span>${I(hm(c.m).kind === 'local' ? 'monitor' : 'server')}<span class="trunc">${esc(hm(c.m).name)}</span></div></div><div class="right">${st(c.status)}<span>${esc(c.at)}</span></div></div>`).join('') || `<div class="empty">${I('chat')}这台 Machine 上还没有会话</div>`}</div></section>
      <section class="col" style="gap:16px"><div><h3 style="margin:0 0 8px;font-size:14px">Machine</h3><div class="card list">${h.machines.map((m) => `<a class="srow" href="#/hosts/${h.id}?m=${m.id}"><span class="row">${I(m.kind === 'local' ? 'monitor' : 'server')}${esc(m.name)}<span class="faint">${esc(m.platform)}</span></span><span class="right">${m.kind === 'local' ? tag('info nodot', '主机本身') : tag('idle nodot', '已配对')}</span></a>`).join('')}</div></div>
        <div><h3 style="margin:0 0 8px;font-size:14px">项目</h3><div class="card list">${h.projects.filter((p) => mf === 'all' || p.m === mf).map((p) => `<div class="srow" style="cursor:default"><span class="t">${esc(p.name)}</span><span class="right faint">${esc(hm(p.m).name)}</span></div>`).join('')}</div></div>
        <div><h3 style="margin:0 0 8px;font-size:14px">AI 工具</h3><div class="card card-b row" style="gap:8px">${h.providers.map((p) => `<span class="agent ${p.id}"><b>${p.id === 'codex' ? 'C' : '✱'}</b>${p.label}</span>`).join('')}<span class="faint">已安装</span></div></div></section></div></div>`;
}
function remoteConv(hid, cid, params) {
  const h = host(hid), c = h && h.conversations.find((x) => x.id === cid); if (!c) return notFound();
  const m = h.machines.find((x) => x.id === c.m), p = h.projects.find((x) => x.id === c.p);
  const live = params.get('live') || c.live;
  const liveLine = { idle: [I('check'), '没有正在运行的轮次'], connecting: [I('clock'), '正在连接实时输出…'], live: [I('eye'), '正在实时查看本轮输出'], disconnected: [I('wifi_off'), '实时输出已断开'] }[live];
  return `<div style="display:grid;grid-template-rows:auto 1fr auto;grid-template-columns:minmax(0,1fr);height:100%;min-height:0">
    <header style="padding:12px 24px;border-bottom:1px solid var(--ct-border)"><div class="row"><a class="btn ghost sm icon-btn" href="#/hosts/${h.id}" title="返回 ${esc(h.name)}">${I('back')}</a><h1 class="trunc grow" style="font-size:17px;margin:0" title="${esc(c.title)}">${esc(c.title)}</h1>${st(c.status)}${tag('readonly', '只读')}</div>
      <div style="margin-top:8px"><div class="ctxbar" aria-label="会话所属"><a class="seg switch" href="#/hosts/${h.id}">${hostIcon(h)}${esc(h.name)} ${pres(h)}</a><span class="slash">/</span><a class="seg switch" href="#/hosts/${h.id}?m=${m.id}">${I(m.kind === 'local' ? 'monitor' : 'server')}${esc(m.name)}</a><span class="slash">/</span><span class="seg">${I('folder')}${esc(p.name)}</span><span class="slash">/</span><span class="seg">${agent(c.agent)}</span></div></div></header>
    <div style="overflow:auto;padding:16px 24px">
      <div class="msg user"><div class="bubble">${esc(c.title)}，保持现有 API 不变。</div></div>
      <div class="msg ai"><div class="row faint" style="font-size:12px;margin-bottom:6px">${agent(c.agent)}<span>· 09:12</span></div><div class="body">已读取 12 个组件，开始替换颜色和间距 Token。${live === 'live' ? '<span class="faint">▍</span>' : ''}</div>
        <div class="tool" style="margin:10px 0"><div class="th">${I('file')}<span class="grow">变更：Button.tsx、tokens.ts</span></div></div></div>
      <div class="msg"><div class="banner ${live === 'disconnected' ? 'warn' : ''}">${liveLine[0]}<div class="grow"><b>${liveLine[1]}</b>${live === 'disconnected' ? '<span class="muted">历史仍可阅读。重试会重新连接，不会发送任何内容。</span>' : ''}</div>${live === 'disconnected' ? `<button class="btn sm">${I('refresh')}重新连接</button>` : ''}</div></div></div>
    <footer style="padding:12px 24px 16px"><div style="max-width:760px;margin:0 auto"><div class="readonly-bar">${I('eye')}<span class="grow">只读查看：你对 ${esc(h.name)} 的访问不包含发送、审批或中断。要继续这个会话，请在 ${esc(h.name)} 上操作。</span><a class="btn sm" href="#/hosts/${h.id}">返回主机</a></div></div></footer></div>`;
}
/* ---------- 账号 ---------- */
function accountPage(params) {
  const step = params.get('step') || (D.account.signedIn ? 'in' : 'email');
  const hostState = params.get('host') || D.account.localHost;
  const card = (inner) => `<div class="card card-b col" style="max-width:520px;gap:14px">${inner}</div>`;
  const body = {
    email: card(`<b style="font-size:16px">登录 CodeTether 账号</b><span class="muted">登录后可以发现同一账号下的其他主机，并申请只读访问。本机功能不需要登录。</span>
      <label class="field">邮箱<input class="input" value="dev@example.com"></label><div class="row"><span class="sp"></span><a class="btn primary" href="#/account?step=code">发送登录码</a></div><span class="help">只能登录已有账号，不能在这里注册。</span>`),
    code: card(`<b style="font-size:16px">输入登录码</b><span class="muted">登录码已发送到 dev@example.com。</span><label class="field">一次性登录码<input class="input mono" style="letter-spacing:.3em" value="824 615"></label>
      <div class="row"><a class="btn ghost" href="#/account?step=email">更换邮箱</a><span class="sp"></span><a class="btn primary" href="#/account?step=in">验证并登录</a></div>`),
    in: `<div class="col" style="gap:16px;max-width:640px">${card(`<div class="row"><b class="grow">账号</b>${tag('ok', '已登录')}</div><div class="row"><span class="muted" style="width:56px">邮箱</span><span>${esc(D.account.email)}</span></div><div class="row"><a class="btn" href="#/devices">查看其他主机</a><span class="sp"></span><a class="btn ghost" href="#/account?step=email">退出登录</a></div>`)}
      ${card(`<div class="row"><b class="grow">把这台电脑作为主机</b>${hostState === 'claimed' ? tag('ok', '已启用') : hostState === 'enabled_unclaimed' ? tag('warn', '设置未完成') : tag('idle', '未启用')}</div>
        <span class="muted">启用后，同一账号下的其他电脑可以申请只读查看这台电脑上的 Machine、项目和会话。每个申请都需要你在这里批准。</span>
        <div class="row">${hostState === 'claimed' ? `<a class="btn" href="#/devices?scroll=requests">查看访问申请</a>` : `<a class="btn primary" href="#/account?step=in&host=claimed">${hostState === 'disabled' ? '启用主机' : '完成主机设置'}</a>`}</div>`)}</div>`,
    unconfigured: card(`<b>此版本未配置账号服务</b><span class="muted">本机主机和 Node 配对仍可正常使用。需要跨主机访问时，请使用已配置账号服务的正式安装包。</span>`),
  }[step];
  return `<div class="page"><a class="btn ghost sm" href="#/settings/account">${I('back')}设置</a><div class="page-head" style="margin-top:6px"><div class="grow"><h1>账号与主机</h1><p>账号只用于发现其他主机和处理访问申请。</p></div></div>${body}</div>`;
}
/* ---------- 连接另一台电脑：三种方式分开 ---------- */
function connectPage(params) {
  const mode = params.get('mode');
  const opt = (href, ic, t, d, who) => `<a class="card card-b col" style="gap:8px;color:inherit" href="${href}"><span class="row"><span class="os">${I(ic)}</span><b class="grow">${t}</b>${I('chev')}</span><span class="muted">${d}</span><span class="help">${who}</span></a>`;
  if (mode === 'desktop') return `<div class="page"><a class="btn ghost sm" href="#/connect">${I('back')}连接另一台电脑</a><div class="page-head" style="margin-top:6px"><div class="grow"><h1>添加另一台主机</h1><p>适用于装有 CodeTether Desktop 的 Mac 或 Windows 电脑。</p></div></div>
    <ol class="col" style="gap:12px;max-width:640px;padding-left:20px">
      <li><b>在那台电脑上安装 CodeTether Desktop</b><div class="help">安装正式发布的安装包。</div></li>
      <li><b>用同一个账号登录</b><div class="help">设置 → 账号与主机 → 登录。</div></li>
      <li><b>在那台电脑上启用“作为主机”</b><div class="help">启用后它会出现在这台电脑的“设备 → 其他主机”中。</div></li>
      <li><b>回到这里申请访问</b><div class="help">对方批准后，你可以只读查看它的 Machine、项目和会话。</div></li></ol>
    <div class="row" style="margin:16px 0"><a class="btn primary" href="#/devices?scroll=hosts">查看其他主机</a>${D.account.signedIn ? '' : '<a class="btn" href="#/account">登录账号</a>'}</div>
    ${note('这条路径不使用 Node 命令、地址或 6 位配对码。')}</div>`;
  return `<div class="page"><a class="btn ghost sm" href="#/devices">${I('back')}设备</a><div class="page-head" style="margin-top:6px"><div class="grow"><h1>连接另一台电脑</h1><p>按那台电脑的类型选择方式。</p></div></div>
    <div class="dev-grid">${opt('#/connect?mode=desktop', 'laptop', '另一台装有 CodeTether 的电脑', '登录同一账号，在那台电脑上启用“作为主机”，然后申请访问。', '结果：只读查看 · 需要账号')}
      ${opt('#/pair', 'server', 'Linux 服务器（CodeTether Node）', '在服务器上运行 Node，输入它显示的地址和 6 位配对码。', '结果：成为本机主机下的一台电脑，可查看并继续会话 · 不需要账号')}
      ${opt('#/devices', 'shield', '已经出现在“其他主机”中', '直接在设备页对那台主机申请访问，或查看申请状态。', '结果：只读查看')}</div></div>`;
}
const notFound = () => `<div class="page"><div class="card empty">${I('alert')}<b>找不到这个页面</b><span>它可能已被移除，或你没有访问权限。</span><div class="row"><a class="btn" href="#/sessions">回到会话</a><a class="btn ghost" href="#/devices">查看设备</a></div></div></div>`;
/* ---------- 会话详情 ---------- */
function convDetail(id, params) {
  const c = conv(id); if (!c) return notFound();
  const m = mach(c.m), p = proj(c.p), loc = p.locations.find((l) => l.m === m.id);
  const gate = canCompose(c);
  const rail = D.conversations.filter((x) => x.p === c.p && !x.archived);
  const inspector = params.get('panel') === 'files';
  const approval = D.attention.find((a) => a.c === c.id && a.type === 'approval' && a.open);
  const ctx = `<div class="ctxbar" aria-label="会话所属">
      <a class="seg switch" href="#/devices" title="所属主机">${I('shield')}本机主机</a><span class="slash">/</span>
      <a class="seg switch" href="#/devices/${m.id}" title="所属电脑（Machine）">${osIcon(m)}${esc(m.name)} ${cn(m)}</a><span class="slash">/</span>
      <a class="seg switch" href="#/projects/${p.id}?m=${m.id}" title="${esc(loc.path)}">${I('folder')}${esc(p.name)}</a><span class="slash">/</span>
      <span class="seg">${agent(c.agent)}</span>${c.origin === 'adopted_native' ? tag('info nodot', '已导入的本机会话') : ''}</div>`;
  const composer = gate.ok ? `<div class="composer"><textarea placeholder="继续和 ${c.agent === 'codex' ? 'Codex' : 'Claude Code'} 对话…  Enter 发送，Shift+Enter 换行" aria-label="消息"></textarea>
      <div class="row"><span class="faint" style="font-size:12px">在 ${esc(m.name)} · ${esc(p.name)} 上运行</span><span class="sp"></span>
      ${c.agent === 'claude' ? '<span class="chip">思考强度：中</span>' : '<span class="chip">gpt-5-codex · 推理：中</span>'}
      <button class="btn primary sm" onclick="this.textContent='演示：未发送'">${I('send')}发送</button></div></div>`
    : `<div class="readonly-bar">${I(gate.busy ? 'clock' : 'eye')}<span class="grow">${esc(gate.why)}</span>${gate.act ? `<a class="btn sm" href="${gate.act[1]}">${gate.act[0]}</a>` : ''}${gate.busy && canInterrupt(c) ? `<button class="btn sm">${I('stop')}中断</button>` : ''}</div>`;
  const msgs = `
    <div class="msg user"><div class="bubble">${esc(c.title)}，先定位原因再修改，改完跑一下相关测试。</div></div>
    <div class="msg ai"><div class="row faint" style="font-size:12px;margin-bottom:6px">${agent(c.agent)}<span>· 10:42</span></div>
      <div class="body">我先查看会话列表的布局实现，确认截断发生在哪一层。</div>
      <div class="tool" style="margin:10px 0"><div class="th">${I('search')}<span class="grow">已搜索 3 个文件、读取 2 个文件</span><span class="faint">展开</span></div></div>
      <div class="body">问题在于标题容器没有 <code class="mono">min-width: 0</code>，flex 子元素撑开了整行。修改如下：</div>
      <div class="code" style="margin-top:8px">- &lt;div className="flex gap-2"&gt;
+ &lt;div className="flex min-w-0 gap-2"&gt;</div></div>
    ${approval && canApprove(c) ? `<div class="msg"><div class="card" style="border-color:#f59e0b66"><div class="card-h" style="color:#fbbf24">${I('shield')}需要批准：运行命令</div><div class="card-b col"><div class="code">pnpm --filter @codetether/web test</div><div class="muted" style="font-size:12px">在 ${esc(m.name)} · ${esc(loc.path)} 中执行</div><div class="row"><span class="sp"></span><button class="btn sm danger">拒绝</button><button class="btn sm primary">允许一次</button></div></div></div></div>` : ''}
    ${c.status === 'running' ? `<div class="msg"><span class="tag running">正在运行</span></div>` : ''}
    ${c.status === 'failed' ? `<div class="msg"><div class="fail-card"><b class="row">${I('alert')}本轮未能开始</b><p class="muted" style="margin:6px 0">${esc(m.name)} 离线，消息没有发送给 Agent，历史保持不变。</p><div class="row"><a class="btn sm" href="#/devices/${m.id}">查看设备</a><details class="tech grow"><summary>技术详情</summary><pre>code: machine_offline · source: machine_transport</pre></details></div></div></div>` : ''}
    ${c.status === 'waiting' ? `<div class="msg"><div class="banner info">${I('check')}<div class="grow"><b>本轮已完成，等待你查看</b><span class="muted">查看后会从“待处理”中移除。</span></div><button class="btn sm" onclick="resolveFor('${c.id}')">标记为已查看</button></div></div>` : ''}`;
  return `<div style="display:grid;grid-template-columns:260px minmax(0,1fr) ${inspector ? '340px' : ''};height:100%;min-height:0">
    <aside style="border-right:1px solid var(--ct-border);overflow:auto;background:var(--ct-nav)" aria-label="同项目会话">
      <div style="padding:12px"><div class="row" style="margin-bottom:8px"><b class="trunc grow">${esc(p.name)}</b><button class="btn ghost sm icon-btn" title="在此项目新建会话" onclick="openModal('new:${m.id}')">${I('plus')}</button></div>
      <div class="search-wrap">${I('search')}<input class="search" placeholder="在此项目中搜索"></div></div>
      <div class="list">${rail.map((x) => `<a class="srow" style="grid-template-columns:1fr;min-height:48px;padding:8px 12px" href="#/c/${x.id}" ${x.id === c.id ? 'aria-selected="true"' : ''}><span class="trunc" style="font-size:13px">${x.pinned ? '📌 ' : ''}${esc(x.title)}</span><span class="meta">${tag(STATUS[x.status][0], STATUS[x.status][1])}<span>${esc(x.at)}</span></span></a>`).join('')}</div></aside>
    <section style="display:grid;grid-template-rows:auto 1fr auto;grid-template-columns:minmax(0,1fr);min-height:0;min-width:0">
      <header style="padding:12px 24px;border-bottom:1px solid var(--ct-border)"><div class="row"><h1 class="trunc grow" style="font-size:17px;margin:0" title="${esc(c.title)}">${esc(c.title)}</h1>${st(c.status)}
        ${c.status === 'running' ? canInterrupt(c) ? `<button class="btn sm">${I('stop')}中断</button>` : `<span class="faint" style="font-size:12px" title="${m.kind === 'remote' ? '远程会话' : 'Claude Code'}当前不支持中断">不可中断</span>` : ''}
        <button class="btn ghost sm icon-btn" title="文件与变更" onclick="go('#/c/${c.id}${inspector ? '' : '?panel=files'}')">${I('panel')}</button>
        <button class="btn ghost sm icon-btn" title="更多：重命名、置顶、归档" onclick="openModal('rename:${c.id}')">${I('more')}</button></div>
        <div style="margin-top:8px">${ctx}</div></header>
      <div style="overflow:auto;padding:16px 24px">${m.conn === 'offline' ? `<div class="banner warn" style="max-width:760px;margin:0 auto 8px">${I('clock')}<div>显示的是上次同步的内容 · 更新于 ${esc(m.lastSeen)}</div></div>` : ''}${msgs}</div>
      <footer style="padding:12px 24px 16px"><div style="max-width:760px;margin:0 auto">${composer}</div></footer></section>
    ${inspector ? `<aside style="border-left:1px solid var(--ct-border);padding:16px;overflow:auto"><div class="tabs"><button class="tab" aria-selected="true">文件</button>${c.agent === 'codex' ? '<button class="tab">变更</button><button class="tab">工具输出</button>' : ''}</div>
      <div class="list col" style="gap:6px">${['apps/web/src/components/conversations/conversation-group.tsx', 'packages/ui/src/components/product/conversation-item.tsx'].map((f) => `<div class="row mono" title="${f}">${I('file')}<span class="trunc">${f}</span></div>`).join('')}</div>
      ${c.agent === 'claude' ? '<p class="help" style="margin-top:12px">Claude Code 当前只提供读取/搜索工具，不提供变更与差异视图。</p>' : ''}</aside>` : ''}</div>`;
}
window.resolveFor = (cid) => { D.attention.filter((a) => a.c === cid).forEach((a) => (a.open = false)); const c = conv(cid); if (c.status === 'waiting') c.status = 'completed'; render(); };
/* ---------- 项目 ---------- */
function projectsPage() {
  return `<div class="page"><div class="page-head"><div class="grow"><h1>项目</h1><p>项目是一个代码库，可以在多台设备上各登记一个文件夹。</p></div><button class="btn primary" onclick="openModal('addproj')">${I('plus')}添加项目</button></div>
    <div class="card list">${D.projects.map((p) => `<div class="srow" onclick="go('#/projects/${p.id}')"><div class="col" style="gap:4px;min-width:0"><span class="t">${esc(p.name)}</span>
      <div class="meta" style="flex-wrap:wrap">${p.locations.map((l) => `<span class="row" style="gap:4px" title="${esc(l.path)}">${osIcon(mach(l.m))}${esc(mach(l.m).name)}</span>`).join('<span class="sep"></span>')}</div></div>
      <div class="right"><span>${D.conversations.filter((c) => c.p === p.id && !c.archived).length} 个会话</span></div></div>`).join('')}</div></div>`;
}
function projectDetail(id, params) {
  const p = proj(id); if (!p) return notFound();
  const convs = D.conversations.filter((c) => c.p === p.id && !c.archived);
  return `<div class="page"><a class="btn ghost sm" href="#/projects">${I('back')}项目</a>
    <div class="page-head" style="margin-top:6px"><div class="grow"><h1>${esc(p.name)}</h1><p>${p.locations.length} 台设备上有此项目</p></div><button class="btn" onclick="openModal('addloc')">${I('plus')}在另一台设备添加文件夹</button><button class="btn primary" onclick="openModal('new')">${I('plus')}新建会话</button></div>
    <h3 style="font-size:14px">文件夹位置</h3><div class="card list" style="margin-bottom:20px">${p.locations.map((l) => { const m = mach(l.m); return `<div class="srow" style="cursor:default"><div class="col" style="gap:3px;min-width:0"><span class="row">${osIcon(m)}<b>${esc(m.name)}</b>${cn(m)}</span>
      <span class="row" style="min-width:0"><span class="mono faint trunc" title="${esc(l.path)}">${esc(l.path)}</span><button class="btn ghost sm icon-btn" title="复制完整路径">${I('copy')}</button></span></div>
      <div class="right" style="flex-direction:row;align-items:center">${l.ok ? tag('ok', '可用') : tag('warn', '不可用')}${m.kind === 'remote' ? '<button class="btn ghost sm">移除位置</button>' : ''}</div></div>`; }).join('')}</div>
    <div class="row"><h3 style="font-size:14px" class="grow">会话</h3><a class="btn ghost sm" href="#/sessions?view=archived">已归档</a></div>
    <div class="card list">${convs.map((c) => sessionRow(c)).join('') || `<div class="empty">${I('chat')}还没有会话</div>`}</div>
    <div class="row" style="margin-top:20px"><span class="grow help">移除项目只删除 CodeTether 中的登记，不会删除任何文件。仍有会话时不能移除。</span><button class="btn danger sm" disabled>移除项目</button></div></div>`;
}

/* ---------- 待处理（Inbox） ---------- */
function inboxPage(params) {
  const f = params.get('f') || 'all';
  const items = D.attention.filter((a) => a.open && (f === 'all' || a.type === f));
  const label = { approval: ['waiting', '需要批准'], completed_review: ['info', '完成待查看'], failed: ['failed', '失败'] };
  const chip = (v, l, n) => `<a class="chip" aria-pressed="${f === v}" href="#/inbox?f=${v}">${l} <span class="faint">${n}</span></a>`;
  const cnt = (t) => D.attention.filter((a) => a.open && a.type === t).length;
  return `<div class="page"><div class="page-head"><div class="grow"><h1>待处理</h1><p>需要你决定或查看的事项。处理后自动移出。</p></div></div>
    <div class="chips" style="margin-bottom:14px">${chip('all', '全部', openCount())}${chip('approval', '需要批准', cnt('approval'))}${chip('completed_review', '完成待查看', cnt('completed_review'))}${chip('failed', '失败', cnt('failed'))}</div>
    ${items.length ? `<div class="col" style="gap:10px">${items.map((a) => { const c = conv(a.c), m = mach(c.m), p = proj(c.p); const approvable = a.type === 'approval' && canApprove(c);
      return `<article class="card" style="padding:14px 16px"><div class="row" style="align-items:flex-start;gap:14px"><div class="grow col" style="gap:6px">
        <div class="row">${tag(...label[a.type])}<span class="faint" style="font-size:12px">${esc(a.at)}</span></div>
        <a href="#/c/${c.id}" class="t" style="color:var(--ct-text);font-weight:500">${esc(c.title)}</a>
        <div class="meta faint row" style="font-size:12px">${agent(c.agent)} · ${esc(p.name)} · ${esc(m.name)}</div>
        ${a.type === 'approval' ? `<div class="code">${esc(a.text.replace('运行 ', ''))}</div>` : `<div class="muted">${esc(a.text)}</div>`}</div>
        <div class="row" style="gap:6px">${a.type === 'approval' ? approvable ? `<button class="btn sm danger" onclick="resolve('${a.id}')">拒绝</button><button class="btn sm primary" onclick="resolve('${a.id}')">允许一次</button>` : `<span class="help">${m.kind === 'remote' ? '远程会话不支持审批' : 'Claude Code 不支持审批'}</span><a class="btn sm" href="#/c/${c.id}">打开会话</a>`
          : a.type === 'completed_review' ? `<button class="btn sm primary" onclick="resolve('${a.id}');go('#/c/${c.id}')">查看结果</button>` : `<a class="btn sm" href="#/c/${c.id}">打开会话</a><button class="btn sm ghost" onclick="resolve('${a.id}')">知道了</button>`}</div></div></article>`; }).join('')}</div>`
      : `<div class="card empty">${I('check')}<b>没有待处理的事项</b><span>需要批准、完成待查看或运行失败的会话会出现在这里。</span></div>`}
    <p class="help" style="margin-top:14px">当前事项类型：审批、完成待查看、运行失败。没有“已读/未读”状态，处理即移出。</p></div>`;
}
window.resolve = (id) => { const a = D.attention.find((x) => x.id === id); a.open = false; render(); };

/* ---------- 连接另一台电脑（配对） ---------- */
function pairPage(params) {
  const step = params.get('step') || '1';
  const steps = ['准备另一台电脑', '输入地址和配对码', '核对验证码', '已连接'];
  const bar = `<ol class="row" style="list-style:none;padding:0;margin:0 0 20px;gap:10px">${steps.map((s, i) => `<li class="row" style="gap:6px;color:${i + 1 <= +step ? 'var(--ct-text)' : 'var(--ct-text-3)'}"><span class="tag ${i + 1 < +step ? 'ok' : i + 1 == step ? 'info' : 'idle'} nodot">${i + 1 < +step ? '✓' : i + 1}</span>${s}</li>`).join(`<span class="faint">—</span>`)}</ol>`;
  const body = {
    1: `<div class="dev-grid"><div class="card card-b col"><b class="row">${I('server')}在另一台电脑上运行 CodeTether Node</b><span class="muted">当前发布 Linux x64 / arm64 与 macOS arm64 版本。在那台电脑的终端运行：</span><div class="code">codetether-node --pair</div><span class="help">命令会输出地址（或 codetether-pairing:// 链接）和 6 位配对码，有效期较短。</span></div>
        <div class="card card-b col"><b class="row">${I('info')}需要长期在线？</b><span class="muted">配对完成后可安装为用户服务：</span><div class="code">codetether-node service install</div><span class="help">依据 apps/node/src/service-installation.ts（systemd 用户服务）。</span></div></div>
        <div class="row" style="margin-top:20px"><a class="btn ghost" href="#/connect?mode=desktop">那台电脑装的是 CodeTether Desktop？</a><span class="sp"></span><a class="btn primary" href="#/pair?step=2">已显示配对码，下一步${I('chev')}</a></div>`,
    2: `<div class="card card-b col" style="max-width:520px;gap:16px"><label class="field">地址或配对链接<input class="input mono" value="192.168.1.42:4318"><span class="help">局域网地址，或 Node 输出的 codetether-pairing://relay/v1?… 链接（经 Internet Relay）。</span></label>
        <label class="field">6 位配对码<input class="input mono" style="letter-spacing:.3em" value="482731" maxlength="6"></label>
        <div class="row"><a class="btn ghost" href="#/pair?step=1">上一步</a><span class="sp"></span><a class="btn primary" href="#/pair?step=3">连接</a></div></div>`,
    3: `<div class="card card-b col" style="max-width:520px;gap:14px"><b>确认是你的电脑</b><span class="muted">两台电脑上显示的验证码一致时再确认。不一致请取消。</span>
        <div style="font:600 32px var(--ct-mono);letter-spacing:.15em;text-align:center;padding:12px;background:var(--ct-inset);border-radius:8px">391 044</div>
        <dl class="dev facts" style="padding:0"><dt>名称</dt><dd>MacBook Pro</dd><dt>系统</dt><dd>macOS 15 · arm64</dd></dl>
        <details class="tech"><summary>高级信息</summary><pre>node fingerprint: SHA256:4f:9a:…:c1</pre></details>
        <div class="row"><a class="btn ghost" href="#/pair?step=1">取消</a><span class="sp"></span><a class="btn primary" href="#/pair?step=4">验证码一致，确认</a></div></div>`,
    4: `<div class="card card-b col" style="max-width:520px;gap:12px;align-items:flex-start">${tag('ok', '已连接')}<b style="font-size:16px">MacBook Pro 已连接</b><span class="muted">你现在可以查看它上面的会话，或登记一个项目文件夹。</span>
        <div class="row"><a class="btn primary" href="#/devices/m-mac">打开 MacBook Pro</a><button class="btn" onclick="openModal('addloc')">添加项目文件夹</button></div></div>`,
  }[step];
  return `<div class="page"><a class="btn ghost sm" href="#/connect">${I('back')}连接另一台电脑</a><div class="page-head" style="margin-top:6px"><div class="grow"><h1>添加 CodeTether Node</h1><p>适用于 Linux 服务器等没有 Desktop 的电脑。配对后它成为本机主机下的一台电脑，不需要账号。</p></div></div>${bar}${body}
    <div class="banner" style="margin-top:20px">${I('shield')}<div><b>配对授予的权限</b><span class="muted">查看会话与历史、发送消息让 Agent 在那台电脑上运行（Codex 与受限的 Claude Code 读取/搜索）、登记项目文件夹。不能浏览任意文件、运行终端、远程审批或中断。可随时在设备详情中取消配对。</span></div></div></div>`;
}
/* ---------- 设置 ---------- */
function settingsPage(sec) {
  const s = (k, l, ic) => `<a class="nav-item" href="#/settings/${k}" ${sec === k ? 'aria-current="page"' : ''}>${I(ic)}${l}</a>`;
  const toggle = (l, d, on = true) => `<label class="row" style="padding:12px 0;border-bottom:1px solid var(--ct-border);align-items:flex-start"><span class="grow col" style="gap:2px"><span>${l}</span><span class="help">${d}</span></span><input type="checkbox" ${on ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--ct-primary)"></label>`;
  const content = {
    general: `<h2>常规</h2><div class="card card-b col"><b>设置与检查</b><span class="muted">重新检查这台电脑、AI 工具和远程设备的状态。</span><div class="row"><a class="btn" href="#/doctor">${I('stetho')}打开检查状态</a><a class="btn ghost" href="#/onboarding">重新运行设置</a></div></div>
      <div class="card card-b col" style="margin-top:12px"><b>外观与语言</b><span class="muted">深色主题 · 简体中文。目前没有其他主题或语言可选。</span></div>`,
    account: `<h2>账号与主机</h2><div class="card card-b col"><div class="row"><b class="grow">${esc(D.account.email)}</b>${tag('ok', '已登录')}</div><span class="muted">账号用于发现其他主机、申请访问和批准别人对这台电脑的访问。本机主机和 Node 配对不需要账号。</span>
      <div class="row"><a class="btn" href="#/account">管理账号与主机</a><a class="btn ghost" href="#/devices#requests">访问申请 ${D.accessRequests.filter((r) => r.open).length ? `<span class="count">${D.accessRequests.filter((r) => r.open).length}</span>` : ''}</a></div></div>`,
    notify: `<h2>通知</h2><div class="card card-b">${toggle('需要批准', 'Agent 请求运行命令或修改文件时提醒。')}${toggle('工作完成', '一轮工作完成、等待你查看时提醒。')}${toggle('执行失败', '一轮工作失败时提醒。通知中不包含会话标题。')}</div><p class="help">仅 CodeTether Desktop 提供系统通知。浏览器中请查看“待处理”。</p>`,
    background: `<h2>后台运行</h2><div class="card card-b col"><span>关闭窗口（✕ / Alt+F4）后，CodeTether 会继续在系统托盘运行，正在进行的工作、审批和通知不会中断。</span>
        <span class="muted">从托盘选择“打开 CodeTether”恢复窗口，选择“退出 CodeTether”结束全部工作并退出。</span><span class="help">这是固定行为，没有开关。开机自动启动尚未实现。</span></div>`,
    devices: `<h2>设备与连接</h2><div class="card list">${D.machines.map((m) => `<a class="srow" href="#/devices/${m.id}?tab=access"><span class="row">${osIcon(m)}${esc(m.name)}</span><span class="right">${cn(m)}</span></a>`).join('')}</div><p class="help">Internet Relay 按设备配置，在设备详情 → 连接与访问中管理。</p>`,
    advanced: `<h2>高级</h2><div class="card card-b col"><dl class="dev facts" style="padding:0"><dt>Host</dt><dd class="mono">127.0.0.1:4317</dd><dt>协议</dt><dd class="mono">v1</dd><dt>界面语言</dt><dd>简体中文</dd><dt>主题</dt><dd>深色（浅色主题尚未提供）</dd></dl></div>`,
  }[sec] || '';
  return `<div class="page" style="display:grid;grid-template-columns:200px 1fr;gap:28px;max-width:960px"><nav class="col" style="gap:2px"><h1 style="font-size:22px;margin:0 0 12px">设置</h1>${s('general', '常规', 'settings')}${s('account', '账号与主机', 'key')}${s('notify', '通知', 'bell')}${s('background', '后台运行', 'clock')}${s('devices', '设备与连接', 'monitor')}${s('advanced', '高级', 'wrench')}</nav><section>${content}</section></div>`;
}
function doctorPage() {
  const row = (l, t, d) => `<div class="srow" style="cursor:default"><div class="col" style="gap:2px"><b>${l}</b><span class="faint" style="font-size:12px">${d}</span></div><div class="right">${t}</div></div>`;
  return `<div class="page"><a class="btn ghost sm" href="#/settings/general">${I('back')}设置</a><div class="page-head" style="margin-top:6px"><div class="grow"><h1>检查状态</h1><p>部分功能受限，见下方说明。</p></div><button class="btn">${I('refresh')}重新检查</button></div>
    <div class="card list">${row('这台电脑', tag('ok', '正常'), 'Windows 11 · x64 · 应用服务运行中')}${row('Codex', tag('ok', '可用'), '本机安装已验证')}${row('Claude Code', tag('unknown', '尚未观察'), '已安装，还没有运行记录')}${row('MacBook Pro', tag('ok', '在线'), '经 Internet Relay · AI 工具 2 个')}${row('build-server', tag('offline', '离线'), '上次已知 · 2 小时前')}</div>
    <details class="tech" style="margin-top:12px"><summary>诊断代码</summary><pre>host: ready · relay: connected · node presence: offline(build-server)</pre></details></div>`;
}

/* ---------- 首次启动 ---------- */
function onboarding(params) {
  const step = params.get('step') || 'welcome';
  const order = ['welcome', 'computer', 'tools', 'project', 'previous', 'remote', 'ready'];
  const labels = ['欢迎', '这台电脑', 'AI 工具', '项目', '以前的会话', '另一台电脑', '完成'];
  const i = order.indexOf(step), next = `#/onboarding?step=${order[i + 1]}`;
  const card = (inner) => `<div class="card" style="width:min(640px,92vw);padding:32px">${inner}</div>`;
  const body = {
    welcome: card(`<div class="brand" style="padding:0 0 16px"><span class="mark" style="width:40px;height:40px;font-size:22px">C</span></div><h1 style="margin:0 0 8px;font-size:26px">在任何一台电脑上继续你的 Coding Agent 会话</h1>
      <p class="muted" style="margin:0 0 20px">CodeTether 把这台电脑和你的其他电脑连在一起。你可以查看 Codex、Claude Code 的会话，并在原来那台电脑上继续。</p>
      <ol class="col muted" style="padding-left:18px;margin:0 0 24px"><li>检查这台电脑和 AI 工具</li><li>选择一个项目文件夹</li><li>（可选）连接另一台电脑</li></ol>
      <div class="row"><a class="btn primary lg" href="${next}">开始设置</a><span class="sp"></span><span class="help">约 1 分钟 · 本机使用不需要账号</span></div>`),
    computer: card(`<h2 style="margin-top:0">这台电脑已连接</h2><div class="row">${tag('ok', '就绪')}<span class="muted">Windows 11 · x64</span></div><div class="row" style="margin-top:24px"><span class="sp"></span><a class="btn primary" href="${next}">检查 AI 工具</a></div>`),
    tools: card(`<h2 style="margin-top:0">AI 工具</h2><div class="col">${[['codex', 'Codex', tag('ok', '可用')], ['claude', 'Claude Code', tag('warn', '需要登录')]].map(([id, n, t]) => `<div class="card card-b row"><span class="agent ${id}"><b>${id === 'codex' ? 'C' : '✱'}</b>${n}</span><span class="sp"></span>${t}${id === 'claude' ? '<a class="btn sm">查看登录说明</a>' : ''}</div>`).join('')}</div>
      <div class="row" style="margin-top:20px"><button class="btn ghost">${I('refresh')}重新检查</button><span class="sp"></span><a class="btn primary" href="${next}">继续</a></div>`),
    project: card(`<h2 style="margin-top:0">选择一个项目</h2><p class="muted">Agent 只能在你选择的文件夹中工作。</p><div class="col"><button class="btn lg">${I('folder')}选择文件夹…</button><button class="btn lg ghost" onclick="go('#/pair')">${I('link')}使用另一台电脑上的项目</button></div>
      <div class="row" style="margin-top:20px"><span class="sp"></span><a class="btn primary" href="${next}">继续</a></div>`),
    previous: card(`<h2 style="margin-top:0">导入以前的会话（可选）</h2><p class="muted">在这个项目中找到 3 个可继续的本机会话。导入后可在 CodeTether 中继续。</p>${['重构登录模块 · Codex · 3 天前', '整理 README · Claude Code · 上周', '修复 CI · Codex · 已导入'].map((t, k) => `<label class="row" style="padding:8px 0"><input type="checkbox" ${k === 2 ? 'disabled checked' : ''}>${t}</label>`).join('')}
      <div class="row" style="margin-top:20px"><a class="btn ghost" href="${next}">跳过</a><span class="sp"></span><a class="btn primary" href="${next}">导入所选</a></div>`),
    remote: card(`<h2 style="margin-top:0">连接另一台电脑（可选）</h2><p class="muted">也可以稍后在“设备”中完成。</p>
      <div class="col"><a class="card card-b row" style="color:inherit" href="#/account">${I('laptop')}<span class="grow"><b>另一台装有 CodeTether 的电脑</b><br><span class="help">登录账号，发现并申请只读访问</span></span>${I('chev')}</a>
        <a class="card card-b row" style="color:inherit" href="#/pair">${I('server')}<span class="grow"><b>Linux 服务器（CodeTether Node）</b><br><span class="help">输入 Node 显示的地址和 6 位配对码</span></span>${I('chev')}</a></div>
      <div class="row" style="margin-top:20px"><span class="sp"></span><a class="btn ghost" href="${next}">暂时跳过</a></div>`),
    ready: card(`${tag('ok', '设置完成')}<h2>CodeTether 设置完成</h2><p class="muted">接下来：在“会话”里打开最近的会话，或在“设备”里找到另一台电脑。</p><div class="row"><a class="btn primary lg" href="#/sessions">打开 CodeTether</a></div>`),
  }[step];
  return `<div class="window os-${ui.os}"><header class="titlebar"><span class="traffic"><i></i><i></i><i></i></span><span>CodeTether</span><span class="sp"></span><span class="winctl"><span>—</span><span>☐</span><span>✕</span></span></header>
    <main style="display:grid;place-items:center;gap:20px;align-content:center;overflow:auto;padding:24px"><ol class="row" style="list-style:none;padding:0;margin:0;gap:6px;flex-wrap:wrap;justify-content:center">${labels.map((l, k) => `<li class="tag ${k < i ? 'ok' : k === i ? 'info' : 'idle'} nodot">${l}</li>`).join('')}</ol>${body}</main></div>`;
}
/* ---------- 05 · Remote Agent Control 后续规划（与现有页面隔离） ---------- */
function roadmapPage() {
  const item = (t, d, dep, s) => `<div class="card card-b col"><div class="row"><b class="grow">${t}</b>${tag(s === '部分实现' ? 'warn nodot' : 'idle nodot', s)}</div><span class="muted">${d}</span><span class="help">依赖：${dep}</span></div>`;
  return `<div class="page"><div class="banner warn" style="margin-bottom:16px">${I('alert')}<div><b>后续规划，不属于当前可实现范围</b><span class="muted">以下交互仅为方向示意，开发本轮重构时不要实现。</span></div></div>
    <div class="page-head"><div class="grow"><h1>Remote Agent Control</h1><p>远程会话的完整控制能力规划。</p></div></div>
    <div class="dev-grid">${item('其他主机的控制权限（发送 / 新建会话）', '对已授权主机申请“查看并控制”，批准后远程只读页显示发送框和新建会话。', 'supervisor_control 授权：协议枚举与 Host 端 host_supervisor_control 已存在，但账号服务只签发 supervisor_read，Web 无批准入口', '部分实现')}
      ${item('撤销已授权的设备', '主机所有者在访问列表中撤销某台设备，对方立即失去只读访问。', '账号服务撤销接口与界面；当前客户端只清理已过期/已撤销的授权', '尚未实现')}
      ${item('访问申请通知', '收到访问申请时发送系统通知并进入“待处理”。', '新的 Attention 类型；当前只在设备页轮询显示', '尚未实现')}
      ${item('远程中断 / 取消', '运行中的远程 Turn 显示“中断”。', 'Node 执行档与 supervisor 协议均无 interrupt 操作', '尚未实现')}
      ${item('远程工具审批', '远程会话内联审批卡与待处理同步。', 'Node 执行档固定 never 审批；supervisor 协议无审批操作', '尚未实现')}
      ${item('运行中排队 / 补充指令', '运行中可追加下一条指令或排队。', 'ProviderDescriptor 无对应能力；AGENTS.md 明确不做 Turn queueing / steering', '尚未实现')}
      ${item('全局会话聚合与跨项目搜索', '会话首页一次请求取得所有设备会话；搜索不限项目。', 'Host 聚合列表与跨项目搜索接口（AGENTS.md 当前不授权全局搜索）', '尚未实现')}
      ${item('Claude Code 编辑 / Shell / Diff', '变更面板对 Claude Code 开放。', 'Provider 能力扩展（明确延后）', '尚未实现')}
      ${item('开机启动、浅色主题、托盘快捷入口', '设置中提供开关。', 'Tauri autostart 插件；主题当前固定 data-theme=dark', '尚未实现')}</div>
    <h3 style="margin-top:28px;font-size:14px">远程控制会话示意</h3>
    <div class="card card-b col" style="max-width:760px"><div class="msg ai"><div class="body">正在运行测试…<span class="faint">▍</span></div></div>
      <div class="card" style="border-color:#f59e0b66"><div class="card-h" style="color:#fbbf24">${I('shield')}MacBook Pro 请求批准：运行命令</div><div class="card-b row"><code class="mono grow">pnpm test</code><button class="btn sm danger">拒绝</button><button class="btn sm primary">允许一次</button></div></div>
      <div class="banner warn">${I('wifi_off')}<div class="grow"><b>连接中断，正在恢复</b><span class="muted">已发送的消息不会重复发送。恢复后继续显示输出。</span></div><button class="btn sm">${I('stop')}中断</button></div></div></div>`;
}
function searchPage() {
  return `<div class="page"><div class="page-head"><div class="grow"><h1>搜索会话</h1><p>在一个项目内，按标题和你发送过的内容搜索。</p></div></div>
    <div class="row" style="margin-bottom:10px;gap:8px"><label class="field" style="flex-direction:row;align-items:center;gap:8px"><span class="help">搜索范围</span><select class="input" style="width:auto"><option>agenthub · 本地电脑、MacBook Pro</option><option>payments-api · MacBook Pro</option><option>model-eval · build-server</option></select></label>
      <span class="sp"></span><select class="input" style="width:auto" aria-label="归档"><option>未归档</option><option>已归档</option><option>全部</option></select></div>
    <div class="search-wrap" style="max-width:560px">${I('search')}<input class="search" style="height:40px" autofocus placeholder="在 agenthub 中搜索" value="重连"></div>
    <p class="help" style="margin:8px 0 10px">只搜索所选项目。不搜索 Agent 回复、工具输出或其他主机。</p>
    <div class="card list">${[conv('c2')].map((c) => `<div class="srow" onclick="go('#/c/${c.id}')"><div class="col" style="gap:3px"><span class="t">为 Relay <mark>重连</mark>添加退避测试</span><span class="meta">标题匹配 · ${agent(c.agent)} · ${esc(mach(c.m).name)}</span></div><div class="right">${st(c.status)}</div></div>
      <div class="srow" onclick="go('#/c/${c.id}')"><div class="col" style="gap:3px"><span class="t">${esc(c.title)}</span><span class="meta">你曾问：“…断网后<mark>重连</mark>要不要指数退避…”</span></div><div class="right"><span>3 分钟前</span></div></div>`).join('')}</div>
    <button class="btn" style="margin-top:10px">加载更多（每次 25 条）</button></div>`;
}

/* ---------- 弹窗 ---------- */
window.openModal = (k) => { ui.modal = k; render(); };
window.closeModal = () => { ui.modal = null; render(); };
function modal() {
  if (!ui.modal) return '';
  const [k, arg] = ui.modal.split(':');
  const wrap = (title, body, foot) => `<div class="scrim" onclick="if(event.target===this)closeModal()"><div class="dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="dh"><h2>${esc(title)}</h2></div><div class="db">${body}</div><div class="df">${foot}</div></div></div>`;
  const cancel = `<button class="btn ghost" onclick="closeModal()">取消</button>`;
  if (k === 'new') {
    const ms = D.machines;
    return wrap('新建会话', `<label class="field">设备<select class="input">${ms.map((m) => `<option ${m.id === (arg || 'm-local') ? 'selected' : ''} ${m.kind === 'remote' && m.conn !== 'online' ? 'disabled' : ''}>${esc(m.name)}${m.conn === 'offline' ? '（离线，不可用）' : ''}</option>`).join('')}</select></label>
      <label class="field">项目<select class="input"><option>agenthub</option><option>payments-api</option></select><span class="help">只列出在所选设备上登记了文件夹的项目。</span></label>
      <div class="field">Agent<div class="row"><label class="chip" aria-pressed="true"><input type="radio" name="a" checked hidden>Codex</label><label class="chip"><input type="radio" name="a" hidden>Claude Code</label><span class="chip" style="opacity:.5" title="build-server 离线">OpenCode · 不可用</span></div></div>
      <div class="row"><label class="field grow">模型<select class="input"><option>默认</option></select></label><label class="field grow">推理强度<select class="input"><option>中</option></select></label></div>
      <p class="help">会话创建后固定在这台设备和这个 Agent 上，不能切换。</p>`, `${cancel}<button class="btn primary" onclick="closeModal()">创建（演示）</button>`);
  }
  if (k === 'rename') { const c = conv(arg); return wrap('会话操作', `<label class="field">名称<input class="input" value="${esc(c.title)}"></label><div class="row"><button class="btn" onclick="togglePin('${c.id}');closeModal()">${I('pin')}${c.pinned ? '取消置顶' : '置顶'}</button><button class="btn" ${c.status === 'running' ? 'disabled title="运行中的会话暂时不能归档"' : ''} onclick="toggleArchive('${c.id}');closeModal()">${I('archive')}${c.archived ? '恢复' : '归档'}</button></div>`, `${cancel}<button class="btn primary" onclick="closeModal()">保存</button>`); }
  if (k === 'unpair') return wrap('取消配对 MacBook Pro？', `<p class="muted" style="margin:0">取消后，这台电脑将不能再访问 MacBook Pro 上的会话。会话历史保留在本机。要重新访问，需要再次配对。</p>`, `${cancel}<button class="btn danger" onclick="closeModal()">取消配对</button>`);
  if (k === 'addr') return wrap('更新连接地址', `<label class="field">新地址<input class="input mono" placeholder="192.168.1.50:4318"></label><p class="help">只有当新地址上的电脑通过身份验证后才会保存，不会改变配对关系。</p>`, `${cancel}<button class="btn primary" onclick="closeModal()">验证并保存</button>`);
  if (k === 'addloc') return wrap('添加项目文件夹', `<label class="field">设备<select class="input">${D.machines.map((m) => `<option>${esc(m.name)}</option>`).join('')}</select></label><label class="field">文件夹路径<input class="input mono" placeholder="/Users/dev/code/project"><span class="help">远程设备会验证路径并返回规范路径。本机可使用文件夹选择器。</span></label><label class="field">登记到项目<select class="input"><option>新项目</option><option>agenthub</option></select></label>`, `${cancel}<button class="btn primary" onclick="closeModal()">添加</button>`);
  if (k === 'addproj') return wrap('添加项目', `<button class="btn lg">${I('folder')}选择文件夹…</button><label class="field">显示名称（可选）<input class="input"></label>`, `${cancel}<button class="btn primary" onclick="closeModal()">添加</button>`);
  return '';
}

/* ---------- 路由 ---------- */
window.go = (h) => { location.hash = h; };
function render(keepFocus) {
  const [path, qs] = (location.hash.slice(1) || '/sessions').split('?');
  const params = new URLSearchParams(qs || ''); const seg = path.split('/').filter(Boolean);
  const crumb = (...xs) => xs.map(esc).join(' <span class="faint">/</span> ');
  let html;
  switch (seg[0]) {
    case 'onboarding': html = onboarding(params); break;
    case 'devices': html = seg[1] ? shell(seg[1], crumb('设备', '本机主机', mach(seg[1])?.name || ''), deviceDetail(seg[1], params)) : shell('devices', crumb('设备'), devicesPage(params)); break;
    case 'hosts': { const h = host(seg[1]); html = seg[2] === 'c' ? shell(seg[1], crumb('设备', h?.name || '', '会话'), remoteConv(seg[1], seg[3], params)) : shell(seg[1], crumb('设备', '其他主机', h?.name || ''), hostDetail(seg[1], params)); break; }
    case 'account': html = shell('settings', crumb('设置', '账号与主机'), accountPage(params)); break;
    case 'connect': html = shell('devices', crumb('设备', '连接另一台电脑'), connectPage(params)); break;
    case 'c': { const c = conv(seg[1]); html = shell('sessions', c ? crumb(mach(c.m).name, proj(c.p).name, c.title) : '', convDetail(seg[1], params)); break; }
    case 'inbox': html = shell('inbox', crumb('待处理'), inboxPage(params)); break;
    case 'projects': html = seg[1] ? shell('projects', crumb('项目', proj(seg[1])?.name || ''), projectDetail(seg[1], params)) : shell('projects', crumb('项目'), projectsPage()); break;
    case 'pair': html = shell('devices', crumb('设备', '添加 CodeTether Node'), pairPage(params)); break;
    case 'settings': html = shell('settings', crumb('设置'), settingsPage(seg[1] || 'general')); break;
    case 'doctor': html = shell('settings', crumb('设置', '检查状态'), doctorPage()); break;
    case 'search': html = shell('sessions', crumb('搜索'), searchPage()); break;
    case 'roadmap': html = shell('', crumb('后续规划'), roadmapPage()); break;
    default: html = shell(params.get('view') === 'archived' ? 'archived' : 'sessions', crumb('会话'), sessionsPage(params));
  }
  const pos = keepFocus && document.activeElement?.id === 'q' ? document.activeElement.selectionStart : null;
  $('#app').innerHTML = html + modal() + '<div class="demo-flag">演示数据 · 不调用真实接口</div>';
  if (pos !== null) { const q = $('#q'); q.focus(); q.setSelectionRange(pos, pos); }
  const sc = params.get('scroll'); if (sc) document.getElementById(sc)?.scrollIntoView();
}
window.addEventListener('hashchange', () => render());
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); go('#/search'); } if (e.key === 'Escape' && ui.modal) closeModal(); });
render();

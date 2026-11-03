// 共用的小组件：状态、会话行、侧栏、导航栏。图标沿用电脑原型的 icons.js（P 是它的图标表）。
Object.assign(P, {
  pin: 'M12 17v5M9 3h6l-1 6 4 4H6l4-4-1-6Z',
  sidebar: 'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM9 4v16',
  wifi: 'M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0M12 20h.01',
  battery: 'M3 8h15a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1ZM22 11v2M5 11h9v2H5Z',
  tablet: 'M6 2h12a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1ZM11 18h2',
});
const D = window.DEMO;
const S = (window.S = { exp: {}, sideOpen: false, sheet: null, picked: {}, seg: {}, chips: {}, text: '' });
const CTX = (window.CTX = { port: false, collapsed: false });
const $m = (id) => D.machines.find((m) => m.id === id);
const $p = (id) => D.projects.find((p) => p.id === id);
const $c = (id) => D.conversations.find((c) => c.id === id);
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const ST = { running: ['run', '运行中'], waiting: ['warn', '等待批准'], completed: ['ok', '已完成'], failed: ['err', '失败'], idle: ['', '空闲'] };
const AG = { codex: 'Codex', claude: 'Claude Code' };
const reach = (m) => m.conn === 'online' && (!m.via || reach($m(m.via)));
const projectsOf = (mid) => D.projects.filter((p) => p.m === mid);
const convsOf = (pid, all) =>
  D.conversations.filter((c) => c.p === pid && (all || !c.archived)).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || a.ago - b.ago);
const machineOfConv = (c) => $m($p(c.p).m);
// 批准、停止、逐行变更只有电脑本机上的 Codex；经由电脑访问的设备上的 Codex 只能对话；Claude Code 只读
const canControl = (c) => c.agent === 'codex' && !machineOfConv(c).via;

const ag = (a) => `<span class="agent ${a}">${AG[a]}</span>`;
const dot = (s) => `<span class="dot ${ST[s][0]}"></span>`;
const tag = (s) => `<span class="tag ${ST[s][0]}">${ST[s][1]}</span>`;
function mStatus(m) {
  if (m.via && !reach($m(m.via))) return `离线 · 要等 ${$m(m.via).name} 上线`;
  if (m.conn === 'offline') return `离线 · ${m.seen}在线`;
  return '在线';
}
const mSub = (m) => [mStatus(m), m.via ? `经由 ${$m(m.via).name}` : ''].filter(Boolean).join(' · ');

function convRow(c, withDevice) {
  const p = $p(c.p);
  const where = withDevice ? `${machineOfConv(c).name} · ${p.name}` : p.name;
  const st = c.status === 'idle' ? '' : ` · ${ST[c.status][1]}`;
  return `<a class="row" href="#/c/${c.id}">${dot(c.status)}<span class="t"><b>${c.pinned ? I('pin', 'sm pinic') : ''}${esc(c.title)}</b>
    <small>${ag(c.agent)} · ${esc(where)}${st}</small></span><span class="r">${c.at}${I('chev', 'sm')}</span></a>`;
}
const sec = (title, act = '', sub = '') => `<div class="sec"><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}${act ? `<span class="act">${act}</span>` : ''}</div>`;

function srow(href, icon, label, sel, extra = '') {
  return `<a class="srow ${sel ? 'sel' : ''}" href="${href}">${I(icon)}<span class="t">${label}</span>${extra}</a>`;
}
function sidebar(r) {
  const activeP = r.p || (r.c && $c(r.c)?.p);
  let h = `<div class="side-head"><span class="brand">&gt;_</span><h1>CodeTether</h1>${CTX.port || CTX.collapsed ? `<button class="tb" data-side aria-label="收起侧栏">${I('sidebar')}</button>` : ''}</div>
    <button class="side-search" data-sheet="search">${I('search', 'sm')}搜索会话</button><div class="side-scroll">
    ${srow('#/home', 'home', '最近的会话', r.sel === 'home')}
    ${srow('#/inbox', 'inbox', '待处理', r.sel === 'inbox', `<span class="badge">${D.attention.length}</span>`)}
    <div class="shead">设备<a href="#/devices">全部设备</a></div>`;
  for (const m of D.machines) {
    const open = S.exp[m.id] !== false;
    const dim = reach(m) ? '' : ' style="opacity:.55"';
    h += `<div${dim}><div class="srow ${r.sel === 'm:' + m.id ? 'sel' : ''}"><button class="tw" data-tw="${m.id}" data-open="${open ? 1 : 0}" aria-label="展开或收起">${I(open ? 'chevd' : 'chev', 'sm')}</button>
      <a class="sl" href="#/devices/${m.id}">${I(m.icon)}<span class="t">${m.name}<small>${mSub(m)}</small></span></a>
      <button class="plus" data-sheet="addproj:${m.id}" aria-label="在 ${m.name} 上添加项目">${I('plus', 'sm')}</button></div>`;
    if (open)
      for (const p of projectsOf(m.id)) {
        const list = convsOf(p.id);
        const pOpen = S.exp[p.id] ?? p.id === activeP;
        h += `<div class="srow l2 ${r.sel === 'p:' + p.id ? 'sel' : ''}"><button class="tw" data-tw="${p.id}" data-open="${pOpen ? 1 : 0}" aria-label="展开或收起">${I(pOpen ? 'chevd' : 'chev', 'sm')}</button>
          <a class="sl" href="#/projects/${p.id}">${I('folder', 'sm')}<span class="t">${p.name}</span><span class="cnt">${list.length}</span></a></div>`;
        if (pOpen) for (const c of list.slice(0, 5)) h += `<a class="srow l3 ${r.sel === 'c:' + c.id ? 'sel' : ''}" href="#/c/${c.id}">${dot(c.status)}<span class="t">${esc(c.title)}</span></a>`;
      }
    h += '</div>';
  }
  return h + `</div><div class="side-foot">${srow('#/settings', 'settings', '设置', r.sel === 'settings')}</div>`;
}
// 导航栏：侧栏收起时（竖屏、打开变更面板时）左边显示侧栏按钮
function nav({ title = '', sub = '', left = '', right = '', lined = false, inner = false } = {}) {
  const toggle = !inner && (CTX.port || CTX.collapsed) ?`<button class="tb" data-side aria-label="显示侧栏">${I('sidebar')}</button>` : '';
  return `<div class="nav ${lined ? 'lined' : ''}"><div class="left">${toggle}${left}</div>
    <div class="center">${title ? `<b>${title}</b>` : ''}${sub ? `<small>${sub}</small>` : ''}</div><div class="right">${right}</div></div>`;
}
const tb = (icon, label, attrs = '') => `<button class="tb" aria-label="${label}" title="${label}" ${attrs}>${I(icon)}</button>`;
const page = (inner) => `<div class="body"><div class="page">${inner}</div></div>`;

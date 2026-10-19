// 路由、浮层（新建会话 / 添加项目 / 命令面板 / 会话设置 / 移除项目 / 取消配对 / 更新地址）与快捷键。
const ROUTES = [
  [/^inbox$/, pageInbox], [/^devices$/, pageDevices], [/^devices\/([\w-]+)$/, pageDevice],
  [/^projects\/([\w-]+)$/, pageProject], [/^projects\/([\w-]+)\/search$/, pageProjectSearch],
  [/^add$/, pageAdd], [/^add\/node$/, pageAddNode], [/^signin$/, pageSignin],
  [/^c\/([\w-]+)$/, pageConv], [/^settings\/?([\w-]*)$/, pageSettings], [/^onboarding$/, pageOnboarding], [/^roadmap$/, pageRoadmap],
];
// 起始页是“设备”；v3 的项目列表、我的电脑都并入设备
const ALIAS = { '': 'devices', home: 'devices', sessions: 'devices', search: 'devices', projects: 'devices', computers: 'devices', hosts: 'devices',
  account: 'settings/account', pair: 'add/node', connect: 'add', 'add/desktop': 'add', doctor: 'settings/about', settings: 'settings/appearance' };
const routePath = () => { const p = location.hash.replace(/^#\/?/, '').split('?')[0].replace(/^computers\//, 'devices/'); return ALIAS[p] ?? p; };
const notFound = () => ({ active: '', crumbs: crumbs('找不到页面'), body: `<div class="page narrow">${empty('map', '找不到这个页面', '链接可能已失效，或者对应的项目已被移除。', `<a class="btn primary" href="#/devices">回到设备</a>`)}</div>` });

function render(keepFocus) {
  const a = document.activeElement, fid = keepFocus && a && a.id, sel = fid && a.selectionStart;
  // 同一页面内的操作（展开、筛选、置顶）保持侧栏和内容的滚动位置；换页时才跳到 ?scroll= 指定的位置
  const sideTop = $('#side-scroll')?.scrollTop || 0, mainTop = $('#main')?.scrollTop || 0, moved = ui.hash !== location.hash;
  ui.hash = location.hash;
  const path = routePath();
  let page = null;
  for (const [re, fn] of ROUTES) { const m = path.match(re); if (m) { page = fn(m[1]); break; } }
  page = page || notFound();
  ui.pg = page;
  $('#app').innerHTML = (page.bare ? page.body : shell(page)) + modal();
  if ($('#side-scroll')) $('#side-scroll').scrollTop = sideTop;
  if (fid && $('#' + fid)) { const el = $('#' + fid); el.focus(); if (sel != null && el.setSelectionRange) el.setSelectionRange(sel, sel); }
  else if (ui.modal === 'palette') $('#pq').focus();
  if (!keepFocus) {
    const st = $('#stream'); if (st) st.scrollTop = st.scrollHeight;
    const to = hq('scroll');
    if (!moved && $('#main')) $('#main').scrollTop = mainTop;
    else if (to && $('#' + to)) $('#' + to).scrollIntoView({ block: 'start' });
  }
  if (moved) $('#side-scroll [aria-current="page"], #side-scroll [data-current]')?.scrollIntoView({ block: 'nearest' });
  // 内容滚动后顶栏出现分隔线
  const sc = $('#main') || $('#stream'), mn = $('.main');
  if (sc && mn) { const f = () => mn.classList.toggle('scrolled', sc.scrollTop > 0); sc.addEventListener('scroll', f, { passive: true }); f(); }
}
window.go = (h) => { if (location.hash === h) render(); else location.hash = h; };
window.openModal = (id) => { ui.modal = id; ui.pq = ''; if (id.startsWith('new')) initNew(id); if (id.startsWith('addproj')) initAdd(id); render(); };
window.closeModal = () => { ui.modal = null; render(); };
window.addEventListener('hashchange', () => { ui.modal = null; reveal(); render(); });

/* ---------- 浮层 ---------- */
const dlg = (title, sub, body, foot, w = '') => `<div class="scrim sheet" onclick="if(event.target===this)closeModal()"><div class="dialog" role="dialog" aria-modal="true" aria-label="${title}" ${w ? `style="--dlg-w:${w}px"` : ''}>
  <div class="dh"><div class="row"><h2 class="grow">${title}</h2><button class="btn ghost icon sm" title="关闭（Esc）" onclick="closeModal()">${I('x')}</button></div>${sub ? `<p>${sub}</p>` : ''}</div>
  <div class="db">${body}</div><div class="df">${foot}</div></div></div>`;
const cancel = `<button class="btn" onclick="closeModal()">取消</button>`;
const archNote = (cs) => { const a = cs.filter((c) => c.archived).length; return a ? `（其中 ${a} 个已归档）` : ''; };
function modal() {
  const [k, arg] = (ui.modal || '').split(/[:~@]/);
  if (!k) return '';
  if (k === 'palette') return palette();
  if (k === 'new') return newDlg();
  if (k === 'addproj') return addDlg();
  if (k === 'rename') {
    // Host 规则：已归档的会话不能置顶，归档会清除置顶；有进行中的一轮时不能归档
    const c = conv(arg), p = cProj(c);
    return dlg('会话设置', '', `<label class="field">名称<input class="input" id="rn" value="${esc(c.title)}"></label>
      <div class="field">位置<div class="pathbox">${esc(cMach(c).name)} · ${esc(p.name)}<br>${esc(p.path)}</div><span class="help">会话创建后固定在这个项目文件夹和 ${agentName(c.agent)} 上，不能移动。</span></div>
      <div class="set-group" style="margin:0"><div class="set-row"><div class="l"><b>置顶</b><span>${c.archived ? '已归档的会话不能置顶。' : '在侧栏和项目中显示在最上面。'}</span></div><button class="switch" role="switch" aria-checked="${!!c.pinned}" ${c.archived ? 'disabled' : ''} onclick="togglePin('${c.id}')"></button></div>
        <div class="set-row"><div class="l"><b>归档</b><span>${busy(c) ? '这一轮结束后才能归档。' : '从列表中隐藏，可在项目的“已归档”中找回。归档会取消置顶。'}</span></div><button class="switch" role="switch" aria-checked="${!!c.archived}" ${busy(c) ? 'disabled' : ''} onclick="toggleArchive('${c.id}')"></button></div></div>`,
      `${cancel}<button class="btn primary" onclick="conv('${c.id}').title=$('#rn').value.trim()||conv('${c.id}').title;closeModal()">保存</button>`, 480);
  }
  if (k === 'unpair') {
    // 基线：设备上还有项目时不能取消配对（machine_has_project_locations），需要先移除这些项目
    const m = mach(arg), ps = D.projects.filter((p) => p.m === arg);
    if (ps.length) return dlg(`取消配对 ${esc(m.name)}`, '', `<p class="muted">${esc(m.name)} 上还有 ${ps.length} 个项目。请先移除这些项目，取消配对不会自动移除它们。只有没有会话的项目才能移除。</p>
      <div class="list">${ps.map((p) => `<a class="item" href="#/projects/${p.id}"><span class="glyph sm">${I('folder')}</span><div class="grow"><div class="t">${esc(p.name)}</div><div class="sub">${ofProj(p.id).length} 个会话</div></div><div class="end">${I('chev')}</div></a>`).join('')}</div>`,
      `${cancel}<button class="btn danger solid" disabled>取消配对</button>`, 460);
    return dlg(`取消配对 ${esc(m.name)}？`, '', `<p class="muted">CodeTether 会先请求 ${esc(m.name)} 撤销信任，确认后才从这里移除。${esc(m.name)} 需要在线；不会删除那台设备上的文件。要重新使用，需要再次配对。</p>`,
      `${cancel}<button class="btn danger solid" onclick="closeModal()">取消配对</button>`, 460);
  }
  if (k === 'rmproj') {
    // 基线 remove-project-dialog.tsx：只移除项目登记；Host 拒绝移除仍有会话（含已归档）的项目（project_has_conversations）
    const p = proj(arg), cs = ofProj(p.id);
    if (cs.length) return dlg('暂时不能移除项目', '', `<p class="muted">“${esc(p.name)}”中还有 ${cs.length} 个会话${archNote(cs)}。只有没有会话的项目才能移除，目前还不能删除会话，见<a href="#/roadmap" onclick="closeModal()">后续规划</a>。</p>`,
      `<button class="btn" onclick="closeModal()">知道了</button>`, 440);
    return dlg('移除项目', `将“${esc(p.name)}”从 CodeTether 中移除。`, `<div class="pathbox">${esc(mach(p.m).name)} · ${esc(p.path)}</div><p class="muted">只移除 CodeTether 中的项目登记，不会删除文件夹、Git 仓库或源文件，也不会改动 Codex、Claude Code 自己的会话记录。</p>`,
      `${cancel}<button class="btn danger solid" onclick="rmProj('${p.id}')">移除项目</button>`, 460);
  }
  if (k === 'addr') {
    const m = mach(arg || 'm-mac');
    return dlg('更新地址', `${esc(m.name)} 的地址变了时使用。`, `<label class="field">新地址<input class="input mono" value="${esc(m.addr || '')}"><span class="help">只有当新地址上的设备通过身份验证后才会保存，不会改变配对关系。</span></label>`,
      `${cancel}<button class="btn primary" onclick="closeModal()">验证并保存</button>`, 480);
  }
  return '';
}
window.rmProj = (pid) => { const p = proj(pid); D.projects.splice(D.projects.indexOf(p), 1); ui.modal = null; go(`#/devices/${p.m}`); };

/* ---------- 添加项目：设备 › 文件夹，然后自动查找以前的会话 ---------- */
// addproj:m-x 固定设备（设备行的“+”、设备页）；addproj 让你选设备。:found 直接打开第二步（演示用）
// 这台电脑可以用系统窗口选择文件夹；配对的设备只能输入完整路径（Node 没有列目录接口）
const ad = { m: '', fixM: false, step: 'pick', pid: '', path: '', name: '' };
const addable = () => D.machines.filter(canAddProj);
const samplePath = (m) => (m.kind === 'local' ? 'D:\\Projects\\Software\\new-app' : m.platform.startsWith('macOS') ? '/Users/lin/code/new-app' : '/srv/workspaces/new-app');
function initAdd(id) {
  const [, arg = '', step = 'pick'] = id.split(':');
  const m = mach(arg) && canAddProj(mach(arg)) ? mach(arg) : addable()[0];
  Object.assign(ad, { m: m?.id || '', fixM: !!mach(arg), step: 'pick', pid: '', path: m ? samplePath(m) : '', name: '' });
  if (step === 'found' && m) addProj();
}
window.setAdd = (k, v) => { ad[k] = v; if (k === 'm') ad.path = samplePath(mach(v)); render(); };
// 演示：登记文件夹（createProject / createRemoteProject），然后用 provider-sessions 扫描这个文件夹
window.addProj = () => {
  const m = mach(ad.m), path = (ad.path || samplePath(m)).trim(), name = (ad.name || path.split(/[\\/]/).pop()).trim();
  const old = D.projects.find((p) => p.m === m.id && p.path === path);
  if (old) { ad.pid = old.id; } else {
    const pid = 'p-' + Date.now().toString(36);
    D.projects.push({ id: pid, name, m: m.id, path, ok: true });
    NATIVE[pid] = { items: NATIVE.new.items.map((n) => ({ ...n })) };
    ad.pid = pid; ui.open.add(m.id); ui.open.add(pid);
  }
  ad.step = 'found'; if (ui.modal) render();
};
window.finishAdd = (doImport) => { if (doImport) adopt(ad.pid, [...document.querySelectorAll(`[data-nat="${ad.pid}"]:checked`)].map((x) => x.value)); ui.modal = null; go(`#/projects/${ad.pid}`); };
function addDlg() {
  const m = mach(ad.m);
  if (!m) return dlg('添加项目', '', `<p class="muted">现在没有在线的设备。设备恢复在线后才能添加项目。</p>`, `<button class="btn" onclick="closeModal()">知道了</button>`, 480);
  if (ad.step === 'found') {
    const p = proj(ad.pid), items = NATIVE[p.id]?.items || [], can = items.filter((n) => n.resume && !n.adopted);
    const groups = ['codex', 'claude'].map((a) => [a, items.filter((n) => n.agent === a)]).filter(([, xs]) => xs.length);
    const body = items.length ? `<p class="muted">在这个文件夹里找到 ${items.length} 个以前的会话。导入后可以在 CodeTether 中继续，导入不会启动 AI 工具。</p>
      ${groups.map(([a, xs]) => `<div class="field">${agentName(a)} <span class="faint">${xs.length}</span><div class="list">${xs.map((n) => natRow(p.id, n)).join('')}</div></div>`).join('')}`
      : `<div class="card">${empty('clock', '没有找到以前的会话', '你仍可以直接新建会话。')}</div>`;
    return dlg(`已添加 ${esc(p.name)}`, '', `${notice('ok', 'check', '项目已添加', `${esc(m.name)} · ${esc(p.path)}`)}${body}`,
      `<button class="btn" onclick="finishAdd(false)">跳过</button>${can.length ? `<button class="btn primary" onclick="finishAdd(true)">导入所选</button>` : ''}`, 560);
  }
  const ms = addable();
  const pcF = ad.fixM ? `<div class="input fixed">${pcIcon(m)}<span class="trunc">${esc(m.name)}</span></div>`
    : `<select class="input" onchange="setAdd('m',this.value)">${ms.map((x) => `<option value="${x.id}" ${x.id === ad.m ? 'selected' : ''}>${esc(x.name)}${x.kind === 'local' ? '（这台电脑）' : ''}</option>`).join('')}</select>${ms.length < D.machines.length ? '<span class="help">离线的设备恢复在线后才能添加项目。</span>' : ''}`;
  const dirF = m.kind === 'local' ? `<div class="row"><input class="input mono grow" id="ad-path" value="${esc(ad.path)}" oninput="ad.path=this.value"><button class="btn">浏览…</button></div>`
    : `<input class="input mono" id="ad-path" value="${esc(ad.path)}" oninput="ad.path=this.value"><span class="help">输入${nm(m.name)}上的完整路径。选择文件夹的窗口只能浏览这台电脑。</span>`;
  return dlg('添加项目', '选择你平时用 Codex 或 Claude Code 打开的文件夹。添加后会自动找出你以前在里面的会话。',
    `<div class="field">设备${pcF}</div><div class="field">文件夹${dirF}<span class="help">AI 工具只会在这个文件夹里工作。同一台设备上已经添加过的文件夹会直接打开原来的项目。</span></div>
    <label class="field">名称<input class="input" id="ad-name" placeholder="默认使用文件夹名" value="${esc(ad.name)}" oninput="ad.name=this.value"></label>`,
    `${cancel}<button class="btn primary" onclick="addProj()">添加</button>`, 540);
}

/* ---------- 新建会话：项目（按设备分组）› AI 工具 ---------- */
// new:p-x 固定项目（项目行的“+”、项目页）；new~p-x 只预选（侧栏按钮、Ctrl N）；new@m-x 预选这台设备上第一个可用的项目
// 与基线一致：设备离线、不能运行或文件夹无法访问时不能选；没有首条消息，创建后进入会话
const nw = { p: '', a: 'codex', r: '', lock: false };
const installed = (m) => m.providers.filter((x) => x.inst === 'available').map((x) => x.id);
function fixNew() { const p = proj(nw.p); if (!p) return; const as = installed(mach(p.m)); if (!as.includes(nw.a)) nw.a = as[0] || 'codex'; }
function initNew(id) {
  const sep = id[3], arg = id.slice(4), first = (ps) => (ps.find((p) => projState(p).ok) || ps[0] || {}).id || '';
  Object.assign(nw, { p: first(D.projects), a: 'codex', r: '', lock: false });
  if (sep === '@') nw.p = first(projects(arg)) || nw.p;
  else if (arg && proj(arg)) Object.assign(nw, { p: arg, lock: sep === ':' });
  fixNew();
}
window.setNew = (k, v) => { nw[k] = v; fixNew(); render(); };
function newDlg() {
  const p = proj(nw.p);
  if (!p) return dlg('新建会话', '', notice('', 'folder', '先添加一个项目', '会话总是在某台设备的某个项目文件夹里进行。', `<button class="btn sm" onclick="openModal('addproj')">添加项目</button>`), cancel, 520);
  const m = mach(p.m), st = projState(p);
  // 项目下拉按设备分组；不可用的项目仍列出，选中后说明原因
  const pjF = nw.lock ? `<div class="input fixed">${I('folder')}<span class="trunc">${esc(p.name)}</span><span class="faint nowrap" style="margin-left:auto">${esc(m.name)}</span></div>`
    : `<select class="input" onchange="setNew('p',this.value)">${D.machines.map((x) => { const ps = projects(x.id); return ps.length ? `<optgroup label="${esc(x.name)}">${ps.map((q) => { const s = projState(q);
        return `<option value="${q.id}" ${q.id === p.id ? 'selected' : ''}>${esc(q.name)}${s.ok ? '' : `（${s.text}）`}</option>`; }).join('')}</optgroup>` : ''; }).join('')}</select>`;
  const where = `<div class="help row" style="gap:6px;min-width:0">${pcIcon(m)}<span class="nowrap">${esc(m.name)}</span><span class="faint">·</span><span class="mono trunc" title="${esc(p.path)}">${esc(p.path)}</span></div>`;
  const as = installed(m);
  const ags = ['codex', 'claude'].map((a) => `<div class="choice" role="radio" aria-checked="${st.ok && nw.a === a}" ${as.includes(a) ? `onclick="setNew('a','${a}')"` : 'aria-disabled="true"'}>${ag(a, false, 'lg')}
    <div class="grow"><b>${agentName(a)}</b><div class="small faint">${!as.includes(a) ? `${nm(m.name, false)}上没有安装` : a === 'codex' ? '可以编辑文件和运行命令' : '只读取和搜索文件'}</div></div></div>`).join('');
  const remoteCodex = st.ok && nw.a === 'codex' && m.kind === 'remote';
  const body = `<div class="field">项目${pjF}${where}</div>
    ${st.ok ? `<div class="field">AI 工具<div class="choices two">${ags}</div>${remoteCodex ? `<span class="help">在${nm(m.name)}上运行时，这里不能停止或审批命令。</span>` : ''}</div>`
      : notice('warn', 'alert', st.why, '换一个项目，或者等设备恢复。', `<a class="btn sm" href="#/devices/${m.id}" onclick="ui.modal=null">查看设备</a>`)}
    ${st.ok && nw.a === 'claude' ? `<label class="field">推理强度<select class="input" style="width:auto" onchange="nw.r=this.value">${REASON.map(([v, l]) => `<option value="${v}" ${nw.r === v ? 'selected' : ''}>${l}</option>`).join('')}</select><span class="help">“默认”使用 Claude Code 自己的设置。</span></label>` : ''}`;
  return dlg('新建会话', 'CodeTether 会在项目文件夹里启动 AI 工具，不用先在终端里切换目录。', body,
    `<span class="help grow df-note">会话创建后固定在这个项目和 AI 工具上，不能切换。</span>${cancel}<button class="btn primary" ${st.ok ? '' : 'disabled'} onclick="createConv()">创建</button>`, 560);
}
window.createConv = () => {
  const id = 'n' + Date.now().toString(36);
  D.conversations.unshift({ id, title: '新会话', agent: nw.a, p: nw.p, status: 'idle', at: '刚刚', ago: -1, fresh: true, ...(nw.a === 'claude' && nw.r ? { reasoning: nw.r } : {}) });
  ui.modal = null; go(`#/c/${id}`);
};

/* ---------- 命令面板（Ctrl K） ---------- */
function palette() {
  const q = ui.pq.trim().toLowerCase(), hit = (s) => !q || s.toLowerCase().includes(q);
  const cs = allConvs().filter((c) => hit(c.title)).slice(0, q ? 6 : 4);
  const ds = D.machines.filter((x) => hit(x.name)), pjs = projects().filter((p) => hit(p.name));
  const pg = ui.pg || {}, curM = pg.dev || (pg.proj && proj(pg.proj)?.m) || (pg.current && cMach(conv(pg.current)).id) || '';
  const acts = [['edit', '新建会话', `openModal('new${here(pg)}')`, 'Ctrl N'], ['folder', '添加项目', `openModal('addproj${curM ? ':' + curM : ''}')`], ['plus', '添加设备', "closeModal();go('#/add')"],
    [ui.theme === 'dark' ? 'sun' : 'moon', ui.theme === 'dark' ? '切换到浅色主题' : '切换到深色主题', `closeModal();setTheme('${ui.theme === 'dark' ? 'light' : 'dark'}')`], ['settings', '打开设置', "closeModal();go('#/settings/appearance')"]].filter((x) => hit(x[1]));
  let n = 0; const sel = () => (n++ === 0 ? 'aria-selected="true"' : '');
  const grp = (l, xs) => (xs.length ? `<div class="pl">${l}</div>${xs.join('')}` : '');
  const res = grp(q ? '会话' : '最近的会话', cs.map((c) => `<a class="po" href="#/c/${c.id}" ${sel()}>${dotFor(c)}<span class="trunc">${esc(c.title)}</span><span class="r nowrap">${esc(cMach(c).name)} · ${esc(cProj(c).name)}</span></a>`))
    + grp('项目', pjs.map((p) => `<a class="po" href="#/projects/${p.id}" ${sel()}>${I('folder')}<span class="trunc">${esc(p.name)}</span><span class="r">${esc(mach(p.m).name)}</span></a>`))
    + grp('设备', ds.map((x) => `<a class="po" href="#/devices/${x.id}" ${sel()}>${pcIcon(x)}<span class="trunc">${esc(x.name)}</span><span class="r">${esc(devState(x).text)}</span></a>`))
    + grp('操作', acts.map(([ic, l, fn, kb]) => `<button class="po" onclick="${fn}" ${sel()}>${I(ic)}<span>${l}</span>${kb ? `<span class="r"><kbd>${kb}</kbd></span>` : ''}</button>`));
  // 按内容搜索只在一个项目里：当前所在的项目，否则第一个项目
  const pid = pg.proj || D.projects[0]?.id, sq = encodeURIComponent(ui.pq.trim());
  return `<div class="scrim" onclick="if(event.target===this)closeModal()"><div class="palette" role="dialog" aria-modal="true" aria-label="搜索">
    <div class="pi">${I('search')}<input id="pq" placeholder="搜索会话、项目、设备或操作" value="${esc(ui.pq)}" oninput="ui.pq=this.value;render(true)" onkeydown="if(event.key==='Enter'){const o=document.querySelector('.po[aria-selected]');if(o)o.click()}"><kbd>Esc</kbd></div>
    <div class="pg">${res || `<div class="empty" style="padding:32px">${I('search')}<span>没有找到“${esc(ui.pq)}”</span></div>`}</div>
    <div class="pf"><span><kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span><span class="sp"></span><span>这里只匹配标题。${pid ? `<a href="#/projects/${pid}/search${sq ? `?q=${sq}` : ''}">在 ${esc(proj(pid).name)} 中按内容搜索</a>` : ''}</span></div></div></div>`;
}

/* ---------- 快捷键与启动 ---------- */
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openModal('palette'); }
  else if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); openModal('new' + here(ui.pg)); }
  else if (e.key === 'Escape' && ui.modal) closeModal();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (ui.theme === 'system') applyTheme(); });
applyTheme();
const m0 = Q.get('modal') || hq('modal');
if (m0) { ui.modal = m0; if (m0.startsWith('new')) initNew(m0); if (m0.startsWith('addproj')) initAdd(m0); }
reveal();
render();

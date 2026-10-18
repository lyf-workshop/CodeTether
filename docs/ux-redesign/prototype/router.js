// 路由、浮层（新建会话 / 命令面板 / 会话设置 / 取消配对 / 更新地址 / 添加文件夹）与快捷键。
const ROUTES = [
  [/^inbox$/, pageInbox], [/^projects$/, pageProjects], [/^projects\/([\w-]+)$/, pageProject], [/^projects\/([\w-]+)\/search$/, pageProjectSearch],
  [/^computers$/, pageComputers], [/^computers\/([\w-]+)$/, pageComputer],
  [/^add$/, pageAdd], [/^add\/desktop$/, pageAddDesktop], [/^add\/node$/, pageAddNode], [/^signin$/, pageSignin],
  [/^c\/([\w-]+)$/, pageConv], [/^settings\/?([\w-]*)$/, pageSettings], [/^onboarding$/, pageOnboarding], [/^roadmap$/, pageRoadmap],
];
// 起始页是“项目”；v2 的首页、全部会话、全局搜索并入项目
const ALIAS = { '': 'projects', home: 'projects', sessions: 'projects', search: 'projects', devices: 'computers', hosts: 'computers', account: 'settings/account', pair: 'add/node', connect: 'add', doctor: 'settings/about', settings: 'settings/appearance' };
const routePath = () => { const p = location.hash.replace(/^#\/?/, '').split('?')[0]; return ALIAS[p] ?? p; };
const notFound = () => ({ active: '', crumbs: crumbs('找不到页面'), body: `<div class="page narrow">${empty('map', '找不到这个页面', '链接可能已失效，或者对应的项目、文件夹已被移除。', `<a class="btn primary" href="#/projects">回到项目</a>`)}</div>` });

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
window.openModal = (id) => { ui.modal = id; ui.pq = ''; if (id.startsWith('new')) initNew(id); if (id.startsWith('add')) initAdd(id); render(); };
window.closeModal = () => { ui.modal = null; render(); };
window.addEventListener('hashchange', () => { ui.modal = null; reveal(); render(); });

/* ---------- 浮层 ---------- */
const dlg = (title, sub, body, foot, w = '') => `<div class="scrim sheet" onclick="if(event.target===this)closeModal()"><div class="dialog" role="dialog" aria-modal="true" aria-label="${title}" ${w ? `style="--dlg-w:${w}px"` : ''}>
  <div class="dh"><div class="row"><h2 class="grow">${title}</h2><button class="btn ghost icon sm" title="关闭（Esc）" onclick="closeModal()">${I('x')}</button></div>${sub ? `<p>${sub}</p>` : ''}</div>
  <div class="db">${body}</div><div class="df">${foot}</div></div></div>`;
const cancel = `<button class="btn" onclick="closeModal()">取消</button>`;
// 移除项目/文件夹前检查的会话数，包含已归档
const refConvs = (pid, mid) => D.conversations.filter((c) => c.p === pid && (!mid || c.m === mid));
const archNote = (cs) => { const a = cs.filter((c) => c.archived).length; return a ? `（其中 ${a} 个已归档）` : ''; };
function modal() {
  const [k, arg] = (ui.modal || '').split(/[:~]/);
  if (!k) return '';
  if (k === 'palette') return palette();
  if (k === 'new') return newDlg();
  if (k === 'rename') {
    // Host 规则：已归档的会话不能置顶，归档会清除置顶；有进行中的一轮时不能归档
    const c = conv(arg), loc = cProj(c).locations.find((l) => l.m === c.m);
    return dlg('会话设置', '', `<label class="field">名称<input class="input" id="rn" value="${esc(c.title)}"></label>
      <div class="field">位置<div class="pathbox">${esc(cProj(c).name)} · ${esc(cMach(c).name)}<br>${esc(loc.path)}</div><span class="help">会话创建后固定在这个文件夹和 ${agentName(c.agent)} 上，不能移动。</span></div>
      <div class="set-group" style="margin:0"><div class="set-row"><div class="l"><b>置顶</b><span>${c.archived ? '已归档的会话不能置顶。' : '在侧栏和项目中显示在这个文件夹的最上面。'}</span></div><button class="switch" role="switch" aria-checked="${!!c.pinned}" ${c.archived ? 'disabled' : ''} onclick="togglePin('${c.id}')"></button></div>
        <div class="set-row"><div class="l"><b>归档</b><span>${busy(c) ? '这一轮结束后才能归档。' : '从列表中隐藏，可在项目的“已归档”中找回。归档会取消置顶。'}</span></div><button class="switch" role="switch" aria-checked="${!!c.archived}" ${busy(c) ? 'disabled' : ''} onclick="toggleArchive('${c.id}')"></button></div></div>`,
      `${cancel}<button class="btn primary" onclick="conv('${c.id}').title=$('#rn').value.trim()||conv('${c.id}').title;closeModal()">保存</button>`, 480);
  }
  if (k === 'unpair') {
    // 基线：电脑上还有项目文件夹时不能取消配对（unpair-machine-dialog.tsx），需要先在项目详情中移除
    const m = mach(arg), locs = D.projects.filter((p) => p.locations.some((l) => l.m === arg));
    if (locs.length) return dlg(`取消配对 ${esc(m.name)}`, '', `<p class="muted">${esc(m.name)} 上还有 ${locs.length} 个项目文件夹。请先在项目中移除这些文件夹，取消配对不会自动移除它们。</p>
      <div class="list">${locs.map((p) => `<a class="item" href="#/projects/${p.id}?scroll=loc-${arg}"><span class="glyph sm">${I('folder')}</span><div class="grow"><div class="t">${esc(p.name)}</div></div><div class="end">${I('chev')}</div></a>`).join('')}</div>`,
      `${cancel}<button class="btn danger solid" disabled>取消配对</button>`, 460);
    return dlg(`取消配对 ${esc(m.name)}？`, '', `<p class="muted">CodeTether 会先请求 ${esc(m.name)} 撤销信任，确认后才从这里移除。${esc(m.name)} 需要在线；不会删除那台电脑上的文件。要重新使用，需要再次配对。</p>`,
      `${cancel}<button class="btn danger solid" onclick="closeModal()">取消配对</button>`, 460);
  }
  if (k === 'rmproj') {
    // 基线 remove-project-dialog.tsx：只移除项目注册；Host 拒绝移除仍有会话（含已归档）的项目（project_has_conversations）
    const p = proj(arg), n = refConvs(p.id).length;
    if (n) return dlg('暂时不能移除项目', '', `<p class="muted">“${esc(p.name)}”中还有 ${n} 个会话${archNote(refConvs(p.id))}。只有没有会话的项目才能移除，目前还不能删除会话，见<a href="#/roadmap" onclick="closeModal()">后续规划</a>。</p>`,
      `<button class="btn" onclick="closeModal()">知道了</button>`, 440);
    return dlg('移除项目', `将“${esc(p.name)}”从 CodeTether 中移除。`, `<p class="muted">只移除 CodeTether 中的项目登记，不会删除任何电脑上的文件夹、Git 仓库或源文件。</p>`,
      `${cancel}<button class="btn danger solid" onclick="closeModal()">移除项目</button>`, 440);
  }
  if (k === 'rmloc') {
    // 基线：只能移除配对电脑上的文件夹，且这个文件夹里没有会话（project_location_has_conversations）
    const [pid, mid] = arg.split(','), p = proj(pid), l = p.locations.find((x) => x.m === mid), cs = refConvs(pid, mid);
    if (cs.length) return dlg('暂时不能移除文件夹', '', `<div class="pathbox">${esc(l.path)}</div>
      <p class="muted">${esc(mach(mid).name)} 上的这个文件夹还有 ${cs.length} 个会话${archNote(cs)}。只有没有会话的文件夹才能移除，目前还不能删除会话。</p>`,
      `<button class="btn" onclick="closeModal()">知道了</button>`, 480);
    return dlg('移除项目文件夹', `从 ${esc(p.name)} 中移除 ${esc(mach(mid).name)} 上的文件夹。`, `<div class="pathbox">${esc(l.path)}</div>
      <p class="muted">文件夹和里面的文件不会被删除。不会删除项目，也不会取消与这台电脑的配对。</p>`,
      `${cancel}<button class="btn danger solid" onclick="rmLoc('${pid}','${mid}')">移除</button>`, 480);
  }
  if (k === 'addr') {
    const m = mach(arg || 'm-mac');
    return dlg('更新地址', `${esc(m.name)} 的地址变了时使用。`, `<label class="field">新地址<input class="input mono" value="${esc(m.addr || '')}"><span class="help">只有当新地址上的电脑通过身份验证后才会保存，不会改变配对关系。</span></label>`,
      `${cancel}<button class="btn primary" onclick="closeModal()">验证并保存</button>`, 480);
  }
  if (k === 'addloc' || k === 'addproj') return addDlg(k, arg);
  return '';
}
/* ---------- 添加项目 / 添加文件夹 ---------- */
// addproj：新项目或已有项目；addloc:p-x 给项目添加另一台电脑上的文件夹；addloc:m-x 在这台电脑上添加
// 一个项目在每台电脑上最多一个文件夹；系统选择文件夹的窗口只在这台电脑上可用，其他电脑需要输入完整路径
const ad = { k: 'addproj', p: '', m: '', fixP: false, fixM: false };
const freeMachs = (pid) => D.machines.filter((m) => (m.kind === 'local' || m.conn === 'online') && !(pid && proj(pid).locations.some((l) => l.m === m.id)));
function initAdd(id) {
  const [k, arg = ''] = id.split(':');
  Object.assign(ad, { k, p: '', m: '', fixP: false, fixM: false });
  if (arg.startsWith('p-')) Object.assign(ad, { p: arg, fixP: true, m: freeMachs(arg)[0]?.id || '' });
  else if (arg.startsWith('m-')) Object.assign(ad, { m: arg, fixM: true });
  else ad.m = 'm-local';
}
window.setAdd = (k, v) => { ad[k] = v; render(); };
function addDlg() {
  const ms = freeMachs(ad.fixP ? ad.p : ''), m = mach(ad.m);
  const title = '添加项目文件夹', sub = ad.fixP ? `在另一台电脑上添加“${esc(proj(ad.p).name)}”的文件夹。` : 'AI 工具只会在你登记的文件夹里工作。';
  if (ad.fixP && !m) return dlg(title, '', `<p class="muted">在线的电脑上都已经有“${esc(proj(ad.p).name)}”的文件夹了。离线的电脑恢复在线后才能添加。</p>`, `<button class="btn" onclick="closeModal()">知道了</button>`, 480);
  const fixed = (ic, t) => `<div class="input fixed">${ic}<span class="trunc">${t}</span></div>`;
  const pcF = ad.fixM ? fixed(pcIcon(m), esc(m.name))
    : `<select class="input" onchange="setAdd('m',this.value)">${ms.map((x) => `<option value="${x.id}" ${x.id === ad.m ? 'selected' : ''}>${esc(x.name)}${x.kind === 'local' ? '（这台电脑）' : ''}</option>`).join('')}</select>`;
  const path = m.kind === 'local' ? 'D:\\Projects\\Software\\new-app' : m.platform.startsWith('macOS') ? '/Users/lin/code/new-app' : '/srv/workspaces/new-app';
  const dirF = m.kind === 'local' ? `<div class="row"><input class="input mono grow" value="${esc(path)}"><button class="btn">浏览…</button></div>`
    : `<input class="input mono" value="${esc(path)}"><span class="help">输入${nm(m.name)}上的完整路径。选择文件夹的窗口只能浏览这台电脑。</span>`;
  const opts = D.projects.filter((p) => !p.locations.some((l) => l.m === m.id));
  const pjF = ad.fixP ? fixed(I('folder'), esc(proj(ad.p).name))
    : `<select class="input"><option>新项目（以文件夹命名）</option>${opts.map((p) => `<option>${esc(p.name)}</option>`).join('')}</select><span class="help">加到已有项目时，这个文件夹就是那个项目在${nm(m.name)}上的位置。每台电脑上一个项目只能有一个文件夹。</span>`;
  return dlg(title, sub, `<div class="field">电脑${pcF}</div><div class="field">文件夹${dirF}</div><div class="field">项目${pjF}</div>`,
    `${cancel}<button class="btn primary" onclick="closeModal()">添加</button>`, 520);
}
window.rmLoc = (pid, mid) => { const p = proj(pid); p.locations = p.locations.filter((l) => l.m !== mid); closeModal(); };

/* ---------- 新建会话：项目 › 文件夹 › AI 工具 ---------- */
// new:p-x[,m-x[,codex|claude]] 从项目或文件夹打开，项目固定；new~p-x[,m-x] 只预选（侧栏按钮、Ctrl N）；new:m-x 从电脑详情打开
// 与基线一致：只列出这个项目的文件夹，电脑离线、不能运行或文件夹无法访问时不能选；没有首条消息，创建后进入会话
const nw = { p: '', m: '', a: 'codex', r: '', lock: false };
const installed = (m) => m.providers.filter((x) => x.inst === 'available').map((x) => x.id);
function fixNew() {
  const p = proj(nw.p); if (!p) return;
  const ok = p.locations.filter((l) => locState(l).ok);
  if (!p.locations.some((l) => l.m === nw.m && locState(l).ok)) nw.m = (ok[0] || p.locations[0]).m;
  const as = installed(mach(nw.m)); if (!as.includes(nw.a)) nw.a = as[0] || 'codex';
}
function initNew(id) {
  const lock = id[3] === ':', arg = id.slice(4);
  Object.assign(nw, { p: D.projects[0]?.id || '', m: '', a: 'codex', r: '', lock: false });
  if (arg.startsWith('m-')) {
    const ps = D.projects.filter((p) => p.locations.some((l) => l.m === arg));
    nw.m = arg; nw.p = (ps.find((p) => locState(p.locations.find((l) => l.m === arg)).ok) || ps[0] || {}).id || nw.p;
  } else if (arg) { const [p, m = '', a = 'codex'] = arg.split(','); Object.assign(nw, { p, m, a, lock }); }
  fixNew();
}
window.setNew = (k, v) => { nw[k] = v; fixNew(); render(); };
function newDlg() {
  const p = proj(nw.p);
  if (!p) return dlg('新建会话', '', notice('', 'folder', '先添加一个项目文件夹', '会话总是在某个项目文件夹里进行。', `<button class="btn sm" onclick="openModal('addproj')">添加项目文件夹</button>`), cancel, 520);
  const m = mach(nw.m), usable = p.locations.some((l) => locState(l).ok);
  const pjF = nw.lock ? `<div class="input fixed">${I('folder')}<span class="trunc">${esc(p.name)}</span></div>`
    : `<select class="input" onchange="setNew('p',this.value)">${D.projects.map((x) => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`;
  const locs = p.locations.map((l) => {
    const lm = mach(l.m), st = locState(l), on = st.ok && nw.m === l.m;
    return `<div class="choice" role="radio" aria-checked="${on}" ${st.ok ? `onclick="setNew('m','${l.m}')"` : `aria-disabled="true" title="${esc(st.why)}"`}>
      <span class="glyph sm">${pcIcon(lm)}</span><div class="grow" style="min-width:0"><b>${esc(lm.name)}</b><div class="small faint mono trunc" title="${esc(l.path)}">${esc(l.path)}</div></div>${st.ok ? (on ? I('check') : '') : `<span class="pill ${st.k}">${st.text}</span>`}</div>`;
  }).join('');
  const as = installed(m);
  const ags = ['codex', 'claude'].map((a) => `<div class="choice" role="radio" aria-checked="${usable && nw.a === a}" ${as.includes(a) ? `onclick="setNew('a','${a}')"` : 'aria-disabled="true"'}>${ag(a, false, 'lg')}
    <div class="grow"><b>${agentName(a)}</b><div class="small faint">${!as.includes(a) ? `${nm(m.name, false)}上没有安装` : a === 'codex' ? '可以编辑文件和运行命令' : '只读取和搜索文件'}</div></div></div>`).join('');
  const remoteCodex = usable && nw.a === 'codex' && m.kind === 'remote';
  const body = `<div class="field">项目${pjF}</div>
    <div class="field">文件夹<div class="choices">${locs}</div>
      ${usable ? '' : notice('warn', 'alert', '这个项目现在没有可用的文件夹', '等电脑恢复在线，或者在另一台电脑上添加这个项目的文件夹。', `<button class="btn sm" onclick="openModal('addloc:${p.id}')">添加文件夹</button>`)}</div>
    ${usable ? `<div class="field">AI 工具<div class="choices two">${ags}</div>${remoteCodex ? `<span class="help">在${nm(m.name)}上运行时，这里不能停止或审批命令。</span>` : ''}</div>` : ''}
    ${usable && nw.a === 'claude' ? `<label class="field">推理强度<select class="input" style="width:auto" onchange="nw.r=this.value">${REASON.map(([v, l]) => `<option value="${v}" ${nw.r === v ? 'selected' : ''}>${l}</option>`).join('')}</select><span class="help">“默认”使用 Claude Code 自己的设置。</span></label>` : ''}`;
  return dlg('新建会话', '选好文件夹后，CodeTether 会在那里启动 AI 工具，不用先在终端里切换目录。', body,
    `<span class="help grow df-note">会话创建后固定在这个文件夹和 AI 工具上，不能切换。</span>${cancel}<button class="btn primary" ${usable ? '' : 'disabled'} onclick="createConv()">创建</button>`, 580);
}
window.createConv = () => {
  const id = 'n' + Date.now().toString(36);
  D.conversations.unshift({ id, title: '新会话', agent: nw.a, p: nw.p, m: nw.m, status: 'idle', at: '刚刚', ago: -1, fresh: true, ...(nw.a === 'claude' && nw.r ? { reasoning: nw.r } : {}) });
  ui.modal = null; go(`#/c/${id}`);
};

/* ---------- 命令面板（Ctrl K） ---------- */
function palette() {
  const q = ui.pq.trim().toLowerCase(), hit = (s) => !q || s.toLowerCase().includes(q);
  const cs = allConvs().filter((c) => hit(c.title)).slice(0, q ? 6 : 4);
  const pcs = [...D.machines, ...viewHosts()].filter((x) => hit(x.name));
  const pjs = projects().filter((p) => hit(p.name));
  const acts = [['edit', '新建会话', `openModal('new${here(ui.pg)}')`, 'Ctrl N'], ['folder', '添加项目文件夹', "openModal('addproj')"], ['plus', '添加电脑', "closeModal();go('#/add')"],
    [ui.theme === 'dark' ? 'sun' : 'moon', ui.theme === 'dark' ? '切换到浅色主题' : '切换到深色主题', `closeModal();setTheme('${ui.theme === 'dark' ? 'light' : 'dark'}')`], ['settings', '打开设置', "closeModal();go('#/settings/appearance')"]].filter((x) => hit(x[1]));
  let n = 0; const sel = () => (n++ === 0 ? 'aria-selected="true"' : '');
  const grp = (l, xs) => (xs.length ? `<div class="pl">${l}</div>${xs.join('')}` : '');
  const res = grp(q ? '会话' : '最近的会话', cs.map((c) => `<a class="po" href="#/c/${c.id}" ${sel()}>${dotFor(c)}<span class="trunc">${esc(c.title)}</span><span class="r nowrap">${esc(cProj(c).name)} · ${esc(cMach(c).name)}</span></a>`))
    + grp('项目', pjs.map((p) => `<a class="po" href="#/projects/${p.id}" ${sel()}>${I('folder')}<span class="trunc">${esc(p.name)}</span><span class="r">${p.locations.length} 个文件夹</span></a>`))
    + grp('电脑', pcs.map((x) => `<a class="po" href="#/computers/${x.id}" ${sel()}>${pcIcon(x)}<span class="trunc">${esc(x.name)}</span><span class="r">${esc(pcState(x).text)}</span></a>`))
    + grp('操作', acts.map(([ic, l, fn, kb]) => `<button class="po" onclick="${fn}" ${sel()}>${I(ic)}<span>${l}</span>${kb ? `<span class="r"><kbd>${kb}</kbd></span>` : ''}</button>`));
  // 按内容搜索只在一个项目里：当前所在的项目，否则第一个项目
  const pid = ui.pg?.proj || D.projects[0]?.id, sq = encodeURIComponent(ui.pq.trim());
  return `<div class="scrim" onclick="if(event.target===this)closeModal()"><div class="palette" role="dialog" aria-modal="true" aria-label="搜索">
    <div class="pi">${I('search')}<input id="pq" placeholder="搜索会话、项目、电脑或操作" value="${esc(ui.pq)}" oninput="ui.pq=this.value;render(true)" onkeydown="if(event.key==='Enter'){const o=document.querySelector('.po[aria-selected]');if(o)o.click()}"><kbd>Esc</kbd></div>
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
if (m0) { ui.modal = m0; if (m0.startsWith('new')) initNew(m0); if (m0.startsWith('add')) initAdd(m0); }
reveal();
render();

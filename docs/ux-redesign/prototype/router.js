// 路由、浮层（新建会话 / 命令面板 / 重命名 / 取消配对 / 更新地址 / 添加文件夹）与快捷键。
const ROUTES = [
  [/^home$/, pageHome], [/^inbox$/, pageInbox], [/^sessions$/, pageSessions], [/^search$/, pageSearch],
  [/^projects$/, pageProjects], [/^projects\/([\w-]+)$/, pageProject], [/^computers$/, pageComputers], [/^computers\/([\w-]+)$/, pageComputer],
  [/^add$/, pageAdd], [/^add\/desktop$/, pageAddDesktop], [/^add\/node$/, pageAddNode], [/^signin$/, pageSignin],
  [/^c\/([\w-]+)$/, pageConv], [/^settings\/?([\w-]*)$/, pageSettings], [/^onboarding$/, pageOnboarding], [/^roadmap$/, pageRoadmap],
];
const ALIAS = { '': 'home', devices: 'computers', hosts: 'computers', account: 'settings/account', pair: 'add/node', connect: 'add', doctor: 'settings/about', settings: 'settings/appearance' };
const routePath = () => { const p = location.hash.replace(/^#\/?/, '').split('?')[0]; return ALIAS[p] ?? p; };
const notFound = () => ({ active: '', crumbs: crumbs('找不到页面'), body: `<div class="page narrow">${empty('map', '找不到这个页面', '链接可能已失效，或者这个会话已被删除。', `<a class="btn primary" href="#/home">回到首页</a>`)}</div>` });

function render(keepFocus) {
  const a = document.activeElement, fid = keepFocus && a && a.id, sel = fid && a.selectionStart;
  const path = routePath();
  let page = null;
  for (const [re, fn] of ROUTES) { const m = path.match(re); if (m) { page = fn(m[1]); break; } }
  page = page || notFound();
  $('#app').innerHTML = (page.bare ? page.body : shell(page)) + modal();
  if (fid && $('#' + fid)) { const el = $('#' + fid); el.focus(); if (sel != null && el.setSelectionRange) el.setSelectionRange(sel, sel); }
  else if (ui.modal === 'palette') $('#pq').focus();
  if (!keepFocus) {
    const st = $('#stream'); if (st) st.scrollTop = st.scrollHeight;
    const to = hq('scroll'); if (to && $('#' + to)) $('#' + to).scrollIntoView({ block: 'start' });
  }
  // 内容滚动后顶栏出现分隔线
  const sc = $('#main') || $('#stream'), mn = $('.main');
  if (sc && mn) { const f = () => mn.classList.toggle('scrolled', sc.scrollTop > 0); sc.addEventListener('scroll', f, { passive: true }); f(); }
}
window.go = (h) => { if (location.hash === h) render(); else location.hash = h; };
window.openModal = (id) => { ui.modal = id; ui.pq = ''; if (id.startsWith('new')) initNew(id); render(); };
window.closeModal = () => { ui.modal = null; render(); };
window.addEventListener('hashchange', () => { ui.modal = null; render(); });

/* ---------- 浮层 ---------- */
const dlg = (title, sub, body, foot, w = '') => `<div class="scrim sheet" onclick="if(event.target===this)closeModal()"><div class="dialog" role="dialog" aria-modal="true" aria-label="${title}" ${w ? `style="--dlg-w:${w}px"` : ''}>
  <div class="dh"><div class="row"><h2 class="grow">${title}</h2><button class="btn ghost icon sm" title="关闭（Esc）" onclick="closeModal()">${I('x')}</button></div>${sub ? `<p>${sub}</p>` : ''}</div>
  <div class="db">${body}</div><div class="df">${foot}</div></div></div>`;
const cancel = `<button class="btn" onclick="closeModal()">取消</button>`;
// 移除项目/文件夹前检查的会话数，包含已归档
const refConvs = (pid, mid) => D.conversations.filter((c) => c.p === pid && (!mid || c.m === mid));
const archNote = (cs) => { const a = cs.filter((c) => c.archived).length; return a ? `（其中 ${a} 个已归档）` : ''; };
function modal() {
  const [k, arg] = (ui.modal || '').split(':');
  if (!k) return '';
  if (k === 'palette') return palette();
  if (k === 'new') return newDlg();
  if (k === 'rename') {
    const c = conv(arg);
    return dlg('会话设置', '', `<label class="field">名称<input class="input" id="rn" value="${esc(c.title)}"></label>
      <div class="set-group" style="margin:0"><div class="set-row"><div class="l"><b>置顶</b><span>显示在会话列表最上面。</span></div><button class="switch" role="switch" aria-checked="${!!c.pinned}" onclick="togglePin('${c.id}')"></button></div>
        <div class="set-row"><div class="l"><b>归档</b><span>${c.status === 'running' ? '运行中的会话不能归档。' : '从列表中隐藏，可在“已归档”中找回。'}</span></div><button class="switch" role="switch" aria-checked="${!!c.archived}" ${c.status === 'running' ? 'disabled' : ''} onclick="toggleArchive('${c.id}')"></button></div></div>`,
      `${cancel}<button class="btn primary" onclick="conv('${c.id}').title=$('#rn').value.trim()||conv('${c.id}').title;closeModal()">保存</button>`, 480);
  }
  if (k === 'unpair') {
    // 基线：电脑上还有项目文件夹时不能取消配对（unpair-machine-dialog.tsx），需要先在项目详情中移除
    const m = mach(arg), locs = D.projects.filter((p) => p.locations.some((l) => l.m === arg));
    if (locs.length) return dlg(`取消配对 ${esc(m.name)}`, '', `<p class="muted">${esc(m.name)} 上还有 ${locs.length} 个项目文件夹。请先在项目中移除这些文件夹，取消配对不会自动移除它们。</p>
      <div class="list">${locs.map((p) => `<a class="item" href="#/projects/${p.id}"><span class="glyph sm">${I('folder')}</span><div class="grow"><div class="t">${esc(p.name)}</div></div><div class="end">${I('chev')}</div></a>`).join('')}</div>`,
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
  if (k === 'addloc' || k === 'addproj') {
    const ms = D.machines.filter((m) => m.kind === 'local' || m.conn === 'online');
    return dlg(k === 'addproj' ? '添加项目' : '添加项目文件夹', 'AI 工具只会在你登记的文件夹里工作。',
      `<label class="field">电脑<select class="input">${ms.map((m) => `<option>${esc(m.name)}</option>`).join('')}</select></label>
      <label class="field">文件夹<div class="row"><input class="input mono grow" value="D:\\Projects\\Software\\new-app"><button class="btn">浏览…</button></div><span class="help">其他电脑上的文件夹需要手动输入路径。</span></label>
      <label class="field">项目<select class="input"><option>新项目（以文件夹命名）</option>${D.projects.map((p) => `<option>${esc(p.name)}</option>`).join('')}</select><span class="help">同一个项目可以在多台电脑上各有一个文件夹。</span></label>`,
      `${cancel}<button class="btn primary" onclick="closeModal()">添加</button>`, 520);
  }
  return '';
}

/* ---------- 新建会话 ---------- */
const nw = { m: 'm-local', p: 'p-web', a: 'codex' };
function initNew(id) {
  const arg = id.split(':')[1] || '';
  Object.assign(nw, { m: 'm-local', p: 'p-web', a: 'codex' });
  if (arg.startsWith('m-')) { nw.m = arg; nw.p = (D.projects.find((p) => p.locations.some((l) => l.m === arg)) || {}).id; }
  if (arg.startsWith('p-')) { nw.p = arg; nw.m = proj(arg).locations.map((l) => mach(l.m)).find((m) => gate({ m: m.id }).kind !== 'offline')?.id || proj(arg).locations[0].m; }
}
window.rmLoc = (pid, mid) => { const p = proj(pid); p.locations = p.locations.filter((l) => l.m !== mid); closeModal(); };
window.setNew = (k, v) => { nw[k] = v; if (k === 'm' && !proj(nw.p)?.locations.some((l) => l.m === v)) nw.p = (D.projects.find((p) => p.locations.some((l) => l.m === v)) || {}).id; render(); };
function newDlg() {
  const off = (m) => m.kind === 'remote' && m.conn !== 'online';
  const pcs = D.machines.map((m) => `<div class="choice" role="radio" aria-checked="${nw.m === m.id}" ${off(m) ? 'aria-disabled="true"' : `onclick="setNew('m','${m.id}')"`}>
    <span class="glyph sm">${pcIcon(m)}</span><div class="grow"><b>${esc(m.name)}</b><div class="small faint">${off(m) ? `离线 · ${esc(m.lastSeen)}` : m.kind === 'local' ? '这台电脑' : '已配对 · 在线'}</div></div>${nw.m === m.id ? I('check') : ''}</div>`).join('');
  const projs = D.projects.filter((p) => p.locations.some((l) => l.m === nw.m)), cur = projs.find((p) => p.id === nw.p) || projs[0];
  const ags = ['codex', 'claude'].map((a) => `<div class="choice" role="radio" aria-checked="${nw.a === a}" onclick="setNew('a','${a}')">${ag(a, false, 'lg')}<div class="grow"><b>${agentName(a)}</b><div class="small faint">${a === 'codex' ? '可以编辑文件和运行命令' : '在这里只读取和搜索文件'}</div></div></div>`).join('');
  const body = `<div class="field">电脑<div class="choices">${pcs}</div><span class="help">其他主机上的会话只能查看，需要在那台电脑上新建。</span></div>
    <label class="field">项目${projs.length ? `<select class="input" onchange="setNew('p',this.value)">${projs.map((p) => `<option value="${p.id}" ${p.id === cur.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      <span class="help mono trunc" title="${esc(cur.locations.find((l) => l.m === nw.m).path)}">${esc(cur.locations.find((l) => l.m === nw.m).path)}</span>`
      : `<div class="notice">${I('folder')}<div class="grow"><b>这台电脑上还没有项目</b><div class="d">先登记一个项目文件夹。</div></div><div class="acts"><button class="btn sm" onclick="openModal('addloc')">添加文件夹</button></div></div>`}</label>
    <div class="field">AI 工具<div class="choices two">${ags}</div></div>
    ${nw.a === 'codex' ? `<div class="row" style="gap:12px"><label class="field grow">模型<select class="input"><option>默认模型</option></select></label><label class="field grow">推理强度<select class="input"><option>中</option><option>低</option><option>高</option></select></label></div>` : ''}`;
  return dlg('新建会话', '', body, `<span class="help grow df-note">会话创建后固定在这台电脑和这个 AI 工具上，不能切换。</span>${cancel}<button class="btn primary" ${projs.length ? '' : 'disabled'} onclick="createConv()">创建</button>`, 580);
}
window.createConv = () => {
  const id = 'n' + Date.now().toString(36);
  D.conversations.unshift({ id, title: '新会话', agent: nw.a, p: nw.p, m: nw.m, status: 'idle', at: '刚刚', ago: -1, fresh: true });
  ui.modal = null; go(`#/c/${id}`);
};

/* ---------- 命令面板（Ctrl K） ---------- */
function palette() {
  const q = ui.pq.trim().toLowerCase(), hit = (s) => !q || s.toLowerCase().includes(q);
  const cs = allConvs().filter((c) => hit(c.title)).slice(0, q ? 6 : 4);
  const pcs = [...D.machines, ...D.hosts.filter((h) => h.access === 'authorized')].filter((x) => hit(x.name));
  const pjs = D.projects.filter((p) => hit(p.name));
  const acts = [['edit', '新建会话', "openModal('new')", 'Ctrl N'], ['plus', '添加电脑', "closeModal();go('#/add')"], [ui.theme === 'dark' ? 'sun' : 'moon', ui.theme === 'dark' ? '切换到浅色主题' : '切换到深色主题', `closeModal();setTheme('${ui.theme === 'dark' ? 'light' : 'dark'}')`], ['settings', '打开设置', "closeModal();go('#/settings/appearance')"]].filter((x) => hit(x[1]));
  let n = 0; const sel = () => (n++ === 0 ? 'aria-selected="true"' : '');
  const grp = (l, xs) => (xs.length ? `<div class="pl">${l}</div>${xs.join('')}` : '');
  const res = grp(q ? '会话' : '最近的会话', cs.map((c) => `<a class="po" href="#/c/${c.id}" ${sel()}>${dotFor(c)}<span class="trunc">${esc(c.title)}</span><span class="r">${esc(where(c))}</span></a>`))
    + grp('电脑', pcs.map((x) => `<a class="po" href="#/computers/${x.id}" ${sel()}>${pcIcon(x)}<span class="trunc">${esc(x.name)}</span><span class="r">${esc(pcState(x).text)}</span></a>`))
    + grp('项目', pjs.map((p) => `<a class="po" href="#/projects/${p.id}" ${sel()}>${I('folder')}<span class="trunc">${esc(p.name)}</span><span class="r">${p.locations.length} 台电脑</span></a>`))
    + grp('操作', acts.map(([ic, l, fn, kb]) => `<button class="po" onclick="${fn}" ${sel()}>${I(ic)}<span>${l}</span>${kb ? `<span class="r"><kbd>${kb}</kbd></span>` : ''}</button>`));
  return `<div class="scrim" onclick="if(event.target===this)closeModal()"><div class="palette" role="dialog" aria-modal="true" aria-label="搜索">
    <div class="pi">${I('search')}<input id="pq" placeholder="搜索会话、电脑、项目或操作" value="${esc(ui.pq)}" oninput="ui.pq=this.value;render(true)" onkeydown="if(event.key==='Enter'){const o=document.querySelector('.po[aria-selected]');if(o)o.click()}"><kbd>Esc</kbd></div>
    <div class="pg">${res || `<div class="empty" style="padding:32px">${I('search')}<span>没有找到“${esc(ui.pq)}”</span></div>`}</div>
    <div class="pf"><span><kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span><span class="sp"></span><span>会话搜索只匹配标题。按内容搜索请用<a href="#/search">项目内搜索</a></span></div></div></div>`;
}

/* ---------- 快捷键与启动 ---------- */
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openModal('palette'); }
  else if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); openModal('new'); }
  else if (e.key === 'Escape' && ui.modal) closeModal();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (ui.theme === 'system') applyTheme(); });
applyTheme();
const m0 = Q.get('modal') || hq('modal');
if (m0) { ui.modal = m0; if (m0.startsWith('new')) initNew(m0); }
render();

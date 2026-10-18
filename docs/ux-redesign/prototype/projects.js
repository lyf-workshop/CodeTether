// 项目（起始页）、项目详情（按文件夹分组的会话）、项目内搜索。
// 层级与 Host 一致：项目 › 文件夹（项目在某台电脑上的位置，每台电脑最多一个）› 会话
const projConvs = (pid) => D.conversations.filter((c) => c.p === pid && !c.archived).sort((a, b) => a.ago - b.ago);
const locPill = (st) => (st.ok ? '' : `<span class="pill ${st.k}" title="${esc(st.why)}">${st.text}</span>`);

/* ---------- 项目列表 ---------- */
function locRow(p, l) {
  const m = mach(l.m), st = locState(l), n = locConvs(p.id, l.m).length;
  return `<a class="item loc-item ${st.ok ? '' : 'dim'}" href="#/projects/${p.id}?scroll=loc-${l.m}">${pcIcon(m)}<div class="grow"><div class="t">${esc(m.name)}</div>
    <div class="sub mono"><span class="trunc" title="${esc(l.path)}">${esc(l.path)}</span></div></div><div class="end">${locPill(st)}<span class="faint">${n} 个会话</span></div></a>`;
}
function projCard(p) {
  const cs = projConvs(p.id), run = cs.filter(busy).length, fail = cs.filter((c) => c.status === 'failed').length;
  const meta = [`${p.locations.length} 个文件夹`, `${cs.length} 个会话`, run && `${run} 个进行中`, fail && `${fail} 个失败`].filter(Boolean).join(' · ');
  return `<div class="card proj-card"><a class="pj-h" href="#/projects/${p.id}"><span class="glyph sm">${I('folder')}</span><div class="grow"><div class="name trunc">${esc(p.name)}</div><div class="small faint">${meta}</div></div>${hotDot(cs)}<span class="faint">${I('chev')}</span></a>
    <div class="list flush">${p.locations.map((l) => locRow(p, l)).join('')}</div></div>`;
}
// 其他主机上的项目：只读，点进去是那台主机的会话
function hostProjRows(h, s) {
  if (h.id === s.hostErr) return `<a class="item" href="#/computers/${h.id}"><span class="glyph sm">${I('alert')}</span><div class="grow"><div class="t">${esc(h.name)}</div><div class="sub">暂时读不到这台主机上的项目和会话</div></div><div class="end"><span class="pill err">读取失败</span></div></a>`;
  if (pcState(h).can !== 'view') return `<a class="item dim" href="#/computers/${h.id}"><span class="glyph sm">${I(h.icon)}</span><div class="grow"><div class="t">${esc(h.name)}</div><div class="sub">上次在线 ${esc(h.lastSeen)}</div></div><div class="end"><span class="pill">无法连接</span></div></a>`;
  return h.projects.map((p) => {
    const m = h.machines.find((x) => x.id === p.m), n = hostConvs().filter((c) => c.host === h.id && c.p === p.id).length;
    return `<a class="item" href="#/computers/${h.id}?m=${m.id}"><span class="glyph sm">${I('folder')}</span><div class="grow"><div class="t">${esc(p.name)}</div>
      <div class="sub">${pcIcon(m)}<span class="nowrap">${esc(h.name)}${m.name !== h.name ? ` › ${esc(m.name)}` : ''}</span><span class="faint">·</span><span class="mono trunc">${esc(p.path)}</span></div></div>
      <div class="end"><span>${n} 个会话</span>${I('chev')}</div></a>`;
  }).join('');
}
function pageProjects() {
  const s = scene(), att = openAttn(), hs = s.loading || s.empty ? [] : viewHosts();
  const head = `<div class="head"><div class="grow"><h1>项目</h1><p>会话按项目和文件夹整理。新建会话时选好文件夹，CodeTether 会在那个文件夹里启动 Codex 或 Claude Code，不用先在终端里打开目录。</p></div>
    <div class="row" style="gap:var(--s3)"><button class="btn" onclick="openModal('addproj')">${I('plus')}添加项目文件夹</button>${s.empty ? '' : `<button class="btn primary" onclick="openModal('new')">${I('edit')}新建会话</button>`}</div></div>`;
  let body;
  if (s.loading) body = `<section class="sec"><div class="grid2">${'<div class="card pad col" style="gap:12px"><div class="skel" style="width:40%"></div><div class="skel"></div><div class="skel" style="width:70%"></div></div>'.repeat(4)}</div></section>`;
  else if (s.empty) body = `<div class="card">${empty('folder', '先添加一个项目文件夹', '选择你平时用 Codex 或 Claude Code 打开的那个文件夹。<br>以后在这里按项目和文件夹查看所有会话，不用再到终端里切换目录。',
    `<button class="btn primary" onclick="openModal('addproj')">${I('plus')}添加项目文件夹</button><a class="btn" href="#/add">${I('plus')}添加电脑</a>`)}</div>`;
  else {
    const n = (t) => att.filter((a) => a.type === t).length;
    const sum = [n('approval') && `${n('approval')} 个等待批准`, n('completed_review') && `${n('completed_review')} 个待查看`, n('failed') && `${n('failed')} 个失败`].filter(Boolean).join(' · ');
    body = `${s.hostErr ? notice('warn', 'wifi_off', '暂时读不到 Studio Mac 上的会话', '其他项目已正常显示，恢复后会自动补上。', retry()) + '<div style="height:16px"></div>' : ''}
      ${att.length ? notice(n('approval') ? 'warn' : '', 'inbox', `${att.length} 件事需要你处理`, sum, `<a class="btn sm" href="#/inbox">查看待处理</a>`) : ''}
      <section class="sec" style="${att.length || s.hostErr ? 'margin-top:24px' : ''}"><div class="grid2">${projects().map(projCard).join('')}</div></section>
      ${hs.length ? `<section class="sec"><div class="sec-h"><h2>其他主机</h2><span class="pill line">${I('eye')}仅查看</span></div><div class="list">${hs.map((h) => hostProjRows(h, s)).join('')}</div></section>` : ''}
      ${note('“项目”取代了 v2 的首页和全部会话。基线侧栏已经是“项目 › 会话”，这一稿在中间加了“文件夹”（项目在某台电脑上的位置）。会话列表按项目读取，没有按电脑过滤，按文件夹分组由前端完成。')}`;
  }
  return { active: 'projects', crumbs: crumbs('项目'), body: `<div class="page">${head}${body}</div>` };
}

/* ---------- 项目详情：每个文件夹一节 ---------- */
function pageProject(id) {
  const p = proj(id); if (!p) return null;
  if (ui.f.p !== id) ui.f = { status: 'all', agent: 'all', p: id };
  const f = ui.f, arch = hq('view') === 'archived';
  const live = D.conversations.filter((c) => c.p === id && !c.archived), archived = D.conversations.filter((c) => c.p === id && c.archived);
  const all = arch ? archived : live, filtered = !arch && (f.status !== 'all' || f.agent !== 'all');
  const shown = all.filter((c) => arch || ((f.status === 'all' || c.status === f.status) && (f.agent === 'all' || c.agent === f.agent)));
  const sb = (k, l) => `<button aria-pressed="${f.status === k}" onclick="ui.f.status='${k}';render()">${l}<span class="n">${all.filter((c) => k === 'all' || c.status === k).length}</span></button>`;
  const order = (a, b) => (arch ? 0 : (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)) || a.ago - b.ago;
  const sec = (l) => {
    const m = mach(l.m), st = locState(l), cs = shown.filter((c) => c.m === l.m).sort(order);
    if (arch && !cs.length) return '';
    // 基线：只能移除配对电脑上的文件夹，且项目至少保留一个；仍有会话时弹窗说明原因
    const rm = !arch && m.kind === 'remote' && p.locations.length > 1 ? `<button class="btn ghost sm" onclick="openModal('rmloc:${id},${l.m}')">移除文件夹</button>` : '';
    const why = arch || st.ok ? '' : st.k === 'err'
      ? notice('err', 'alert', '找不到这个文件夹', `${nm(m.name, false)}上没有这个路径，或者 CodeTether 没有读取权限。确认文件夹还在；没有会话时可以移除后重新添加。`)
      : notice('warn', 'wifi_off', st.text === '电脑离线' ? `${nm(m.name, false)}已离线` : `${nm(m.name, false)}现在不能运行 AI 工具`, `${m.lastSeen ? `上次在线 ${esc(m.lastSeen)}。` : ''}可以查看以前的会话，恢复后才能继续或新建。`, `<a class="btn sm" href="#/computers/${m.id}">查看电脑</a>`);
    const total = all.filter((c) => c.m === l.m).length;
    const list = cs.length ? `<div class="list">${cs.map((c) => sessionItem(c, { hidePc: true, hideProj: true })).join('')}</div>`
      : `<div class="card loc-empty"><span class="grow">${total || filtered ? '这个文件夹里没有符合条件的会话。' : '这个文件夹里还没有会话。'}</span>${!total && !filtered && st.ok ? `<button class="btn sm" onclick="openModal('new:${id},${l.m}')">${I('plus')}新建会话</button>` : ''}</div>`;
    return `<section class="sec loc-sec" id="loc-${l.m}"><div class="loc-h"><span class="glyph sm">${pcIcon(m)}</span>
      <div class="grow"><div class="row" style="gap:8px"><b class="trunc">${esc(m.name)}</b>${m.kind === 'local' ? '<span class="faint small nowrap">这台电脑</span>' : ''}${locPill(st)}<span class="n">${cs.length}</span></div>
        <div class="mono small faint trunc" title="${esc(l.path)}">${esc(l.path)}</div></div>
      ${rm}${!arch && st.ok ? `<button class="btn sm" title="在${nm(m.name)}的这个文件夹中新建会话" onclick="openModal('new:${id},${l.m}')">${I('plus')}新建会话</button>` : ''}</div>
      ${why ? `<div style="margin-bottom:12px">${why}</div>` : ''}${list}</section>`;
  };
  const head = `<div class="head with-glyph"><span class="glyph xl">${I('folder')}</span><div class="grow"><h1>${esc(p.name)}</h1><p>${p.locations.length} 个文件夹 · ${live.length} 个会话${archived.length ? ` · ${archived.length} 个已归档` : ''}</p></div>
    <div class="row" style="gap:var(--s3)"><div class="seg"><a href="#/projects/${id}" aria-pressed="${!arch}">会话</a><a href="#/projects/${id}?view=archived" aria-pressed="${arch}">已归档<span class="n">${archived.length}</span></a></div>
      <button class="btn primary" onclick="openModal('new:${id}')">${I('plus')}新建会话</button></div></div>`;
  const tools = `<div class="toolbar"><label class="search narrow">${I('search')}<input id="ps" class="input" placeholder="搜索这个项目的会话" maxlength="160" onkeydown="if(event.key==='Enter'&&this.value.trim())go('#/projects/${id}/search?q='+encodeURIComponent(this.value.trim()))"></label>
    ${arch ? '' : `<div class="seg">${sb('all', '全部')}${sb('running', '运行中')}${sb('waiting', '等待批准')}${sb('completed', '已完成')}${sb('failed', '失败')}</div><span class="sp"></span>
      ${filtered ? `<button class="btn ghost sm" onclick="ui.f.status='all';ui.f.agent='all';render()">清除筛选</button>` : ''}
      <select class="input" style="width:auto" aria-label="AI 工具" onchange="ui.f.agent=this.value;render()"><option value="all">所有 AI 工具</option><option value="codex" ${f.agent === 'codex' ? 'selected' : ''}>Codex</option><option value="claude" ${f.agent === 'claude' ? 'selected' : ''}>Claude Code</option></select>`}</div>`;
  const secs = p.locations.map(sec).join('');
  const foot = arch ? '' : `<section class="sec"><div class="grid2">
      <div class="card pad row" style="gap:12px"><span class="glyph sm">${I('plus')}</span><div class="grow"><b>在另一台电脑上添加文件夹</b><div class="small muted">同一个项目在每台电脑上可以有一个文件夹，比如 Mac 上的同一个仓库。</div></div><button class="btn sm" onclick="openModal('addloc:${id}')">添加</button></div>
      <div class="card pad row" style="gap:12px"><span class="glyph sm">${I('archive')}</span><div class="grow"><b>移除项目</b><div class="small muted">${refConvs(id).length ? '还有会话（包括已归档）时不能移除。' : '只从 CodeTether 中移除，不删除任何文件。'}</div></div><button class="btn sm danger" onclick="openModal('rmproj:${id}')">移除</button></div></div></section>`;
  const body = `<div class="page">${head}${tools}${secs || `<div class="card">${empty('archive', '没有已归档的会话', '归档的会话会出现在这里，可以随时取消归档。')}</div>`}${foot}
    ${note('会话固定在创建时选择的文件夹上（projectId + machineId），Host 用这个文件夹作为 AI 工具的工作目录。会话列表按项目读取，按文件夹分组由前端完成。')}</div>`;
  return { active: 'projects', proj: id, crumbs: arch ? crumbs(['项目', '#/projects'], [p.name, `#/projects/${id}`], '已归档') : crumbs(['项目', '#/projects'], p.name), body };
}

/* ---------- 项目内搜索：标题和你发送过的内容 ---------- */
function pageProjectSearch(id) {
  const p = proj(id); if (!p) return null;
  const q = (hq('q') || '').trim(), mark = `<mark>${esc(q)}</mark>`, hl = (s) => esc(s).split(esc(q)).join(mark);
  // 演示：标题按真实数据匹配；“重连”另外演示消息命中。同一会话的标题和消息都匹配时合并成一行
  const said = q === '重连' ? { c2: `你发送过：“…断网后${mark}要不要指数退避，上限设多少合适…”`, c8: `你发送过：“…${mark}之后也要继续采样…”` } : {};
  const hits = q ? D.conversations.filter((c) => c.p === id && (c.title.includes(q) || said[c.id])).sort((a, b) => a.ago - b.ago) : [];
  const row = (c) => `<a class="item" href="#/c/${c.id}">${ag(c.agent, false)}<div class="grow"><div class="t trunc">${hl(c.title)}</div>
    <div class="sub">${pcIcon(mach(c.m))}<span class="nowrap">${esc(mach(c.m).name)}</span>${said[c.id] ? `<span class="faint">·</span><span class="trunc">${said[c.id]}</span>` : ''}${c.archived ? '<span class="faint">·</span><span class="nowrap">已归档</span>' : ''}</div></div>
    <div class="end">${status(c)}<span class="when">${esc(c.at)}</span></div></a>`;
  const body = `<div class="page narrow"><div class="head"><div class="grow"><h1>在 ${esc(p.name)} 中搜索</h1><p>搜索这个项目里的会话标题和你发送过的内容。</p></div></div>
    <div class="toolbar"><label class="search grow">${I('search')}<input id="sq" class="input" value="${esc(q)}" maxlength="160" placeholder="输入关键词，按 Enter 搜索" onkeydown="if(event.key==='Enter')go('#/projects/${id}/search?q='+encodeURIComponent(this.value.trim()))"></label></div>
    ${!q ? `<div class="card">${empty('search', '输入关键词', `在 ${esc(p.name)} 的所有文件夹中搜索。`)}</div>`
      : `<p class="help" style="margin:-4px 0 16px">${hits.length} 条结果 · 范围：${esc(p.name)}（${p.locations.map((l) => esc(mach(l.m).name)).join('、')}）。不搜索 AI 回复、工具输出和其他项目。</p>
      ${hits.length ? `<div class="list">${hits.map(row).join('')}</div>` : `<div class="card">${empty('search', `没有找到“${esc(q)}”`, `在 ${esc(p.name)} 中没有匹配的会话标题或消息。`)}</div>`}`}</div>`;
  return { active: 'projects', proj: id, crumbs: crumbs(['项目', '#/projects'], [p.name, `#/projects/${id}`], '搜索'), body };
}

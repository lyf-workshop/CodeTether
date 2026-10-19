// 项目详情（一台设备上的一个文件夹）、以前的会话（发现与导入）、项目内搜索。
const ofProj = (pid) => D.conversations.filter((c) => c.p === pid);

/* ---------- 以前的会话：provider-sessions 发现结果 ---------- */
// 演示的导入：把候选变成一个 origin = adopted_native 的会话。真实产品逐个调用 adopt，不启动 AI 工具、不发送提示词
window.adopt = (pid, ids) => {
  const items = NATIVE[pid]?.items || [];
  for (const n of items.filter((x) => ids.includes(x.id) && x.resume && !x.adopted)) {
    const id = 'a' + n.id;
    D.conversations.push({ id, title: n.title, agent: n.agent, p: pid, status: 'idle', at: n.at, ago: 3000 + D.conversations.length, origin: 'adopted_native' });
    n.adopted = id;
  }
};
window.importSel = (pid) => { adopt(pid, [...document.querySelectorAll(`[data-nat="${pid}"]:checked`)].map((x) => x.value)); render(); };
// 一行候选：可以导入（复选框）/ 已在 CodeTether 中（打开）/ 只能查看，无法继续
function natRow(pid, n, checked = true) {
  const lead = n.adopted ? `<span class="nat-ic ok">${I('check')}</span>` : n.resume ? `<input type="checkbox" class="check" data-nat="${pid}" value="${n.id}" ${checked ? 'checked' : ''} aria-label="选择 ${esc(n.title)}">` : '<span class="nat-ic"></span>';
  const sub = n.adopted ? '已在 CodeTether 中' : n.resume ? `${esc(n.at)} · 可继续` : '这个版本的记录格式不支持继续';
  return `<label class="item ${n.resume && !n.adopted ? '' : 'static'}">${lead}${ag(n.agent, false)}<div class="grow"><div class="t trunc">${esc(n.title)}</div><div class="sub">${agentName(n.agent)} · ${sub}</div></div>
    ${n.adopted ? `<a class="btn ghost sm" href="#/c/${n.adopted}">打开</a>` : ''}</label>`;
}
// 扫描失败、设备离线时的说明（previous-conversations-step.tsx 的 providerProblemText）
function natFail(pid) {
  const f = NATIVE[pid]?.fail, m = mach(proj(pid).m);
  if (f === 'machine_offline') return notice('', 'wifi_off', `${nm(m.name, false)}离线，暂时无法查找以前的会话`, '设备恢复在线后重新扫描。');
  if (f === 'unreadable') return notice('warn', 'alert', '读不到这个文件夹', '文件夹找不到或没有权限时，无法查找以前的会话。CodeTether 不会修改 AI 工具自己的记录文件。');
  return '';
}
// 项目页的“以前的会话”：还没导入、可以继续的会话
function natSection(p) {
  const all = NATIVE[p.id]?.items || [], fresh = all.filter((n) => !n.adopted), can = fresh.filter((n) => n.resume), fail = natFail(p.id);
  if (!fresh.length && !fail) return '';
  const h = `<div class="sec-h"><h2>以前的会话</h2>${fresh.length ? `<span class="n">${fresh.length}</span>` : ''}<span class="sp"></span><button class="btn ghost sm" ${projState(p).ok ? '' : 'disabled'} onclick="this.innerHTML='正在扫描…'">${I('refresh')}重新扫描</button></div>`;
  if (fail) return `<section class="sec" id="native">${h}${fail}</section>`;
  return `<section class="sec" id="native">${h}<p class="help" style="margin:-4px 0 12px">在这个文件夹里找到的 Codex 和 Claude Code 会话，还没有加到 CodeTether。导入后可以在这里继续，导入本身不会启动 AI 工具。</p>
    <div class="list">${fresh.map((n) => natRow(p.id, n)).join('')}</div>
    ${can.length ? `<div class="row" style="margin-top:12px"><span class="sp"></span><button class="btn primary sm" onclick="importSel('${p.id}')">导入所选</button></div>` : ''}</section>`;
}

/* ---------- 项目详情 ---------- */
function pageProject(id) {
  const p = proj(id); if (!p) return null;
  if (ui.f.p !== id) ui.f = { status: 'all', agent: 'all', p: id };
  const f = ui.f, arch = hq('view') === 'archived', m = mach(p.m), st = projState(p), dev = devState(m);
  const live = projConvs(id), archived = ofProj(id).filter((c) => c.archived);
  const all = arch ? archived : live, filtered = !arch && (f.status !== 'all' || f.agent !== 'all');
  const shown = all.filter((c) => arch || ((f.status === 'all' || c.status === f.status) && (f.agent === 'all' || c.agent === f.agent)));
  const sb = (k, l) => `<button aria-pressed="${f.status === k}" onclick="ui.f.status='${k}';render()">${l}<span class="n">${all.filter((c) => k === 'all' || c.status === k).length}</span></button>`;
  const head = `<div class="head with-glyph"><span class="glyph xl">${I('folder')}</span><div class="grow" style="min-width:0"><h1>${esc(p.name)}</h1>
      <p class="row" style="gap:10px;min-width:0"><a class="nowrap row" style="gap:6px;color:inherit" href="#/devices/${m.id}">${pcIcon(m)}${esc(m.name)}</a><span class="faint">·</span><span class="mono small trunc" title="${esc(p.path)}">${esc(p.path)}</span></p></div>
    <div class="row" style="gap:var(--s3)"><div class="seg"><a href="#/projects/${id}" aria-pressed="${!arch}">会话</a><a href="#/projects/${id}?view=archived" aria-pressed="${arch}">已归档<span class="n">${archived.length}</span></a></div>
      ${st.ok ? `<button class="btn primary" onclick="openModal('new:${id}')">${I('plus')}新建会话</button>` : ''}</div></div>`;
  // 不能新建会话的原因：设备离线 / 不能运行，或者文件夹不可用
  const why = arch || st.ok ? '' : !dev.ok
    ? notice('warn', 'wifi_off', st.text === '离线' ? `${nm(m.name, false)}已离线` : st.why, `${m.lastSeen ? `上次在线 ${esc(m.lastSeen)}。` : ''}可以查看以前的会话，恢复后才能继续或新建。`, `<a class="btn sm" href="#/devices/${m.id}">查看设备</a>`)
    : notice('err', 'alert', '找不到这个文件夹', `${nm(m.name, false)}上没有这个路径，或者 CodeTether 没有读取权限。确认文件夹还在；没有会话时可以移除这个项目后重新添加。`);
  const tools = `<div class="toolbar"><label class="search narrow">${I('search')}<input id="ps" class="input" placeholder="搜索这个项目的会话" maxlength="160" onkeydown="if(event.key==='Enter'&&this.value.trim())go('#/projects/${id}/search?q='+encodeURIComponent(this.value.trim()))"></label>
    ${arch ? '' : `<div class="seg">${sb('all', '全部')}${sb('running', '运行中')}${sb('waiting', '等待批准')}${sb('completed', '已完成')}${sb('failed', '失败')}</div><span class="sp"></span>
      ${filtered ? `<button class="btn ghost sm" onclick="ui.f.status='all';ui.f.agent='all';render()">清除筛选</button>` : ''}
      <select class="input" style="width:auto" aria-label="AI 工具" onchange="ui.f.agent=this.value;render()"><option value="all">所有 AI 工具</option><option value="codex" ${f.agent === 'codex' ? 'selected' : ''}>Codex</option><option value="claude" ${f.agent === 'claude' ? 'selected' : ''}>Claude Code</option></select>`}</div>`;
  const list = shown.length ? `<div class="list">${shown.map((c) => sessionItem(c, { inProj: true })).join('')}</div>`
    : `<div class="card">${arch ? empty('archive', '没有已归档的会话', '归档的会话会出现在这里，可以随时取消归档。')
      : all.length || filtered ? empty('search', '没有符合条件的会话', '换个筛选条件试试。')
      : empty('sparkle', '还没有会话', `新建一个会话，CodeTether 会在 <span class="mono">${esc(p.path)}</span> 里启动 AI 工具。`, st.ok ? `<button class="btn primary" onclick="openModal('new:${id}')">${I('plus')}新建会话</button>` : '')}</div>`;
  const n = ofProj(id).length;
  const foot = arch ? '' : `<section class="sec"><div class="card pad row" style="gap:12px"><span class="glyph sm">${I('archive')}</span><div class="grow"><b>移除项目</b><div class="small muted">${n ? '还有会话（包括已归档）时不能移除。' : '只从 CodeTether 中移除，不删除任何文件。'}</div></div><button class="btn sm danger" onclick="openModal('rmproj:${id}')">移除</button></div></section>`;
  const body = `<div class="page">${head}${why ? `<div style="margin-bottom:20px">${why}</div>` : ''}${tools}${list}${arch ? '' : natSection(p)}${foot}
    ${note('一个项目就是一台设备上的一个文件夹。会话按项目读取，Host 用这个文件夹作为 AI 工具的工作目录。“以前的会话”调用 provider-sessions，按文件夹精确匹配那台设备上 Codex 和 Claude Code 的原生记录。')}</div>`;
  const cr = projCrumbs(p);
  return { active: 'devices', proj: id, crumbs: arch ? crumbs(...cr, '已归档') : crumbs(cr[0], p.name), body };
}

/* ---------- 项目内搜索：标题和你发送过的内容 ---------- */
function pageProjectSearch(id) {
  const p = proj(id); if (!p) return null;
  const q = (hq('q') || '').trim(), mark = `<mark>${esc(q)}</mark>`, hl = (s) => esc(s).split(esc(q)).join(mark);
  // 演示：标题按真实数据匹配；“重试”另外演示消息命中。同一会话的标题和消息都匹配时合并成一行
  const said = q === '重试' ? { c3: `你发送过：“…回调失败${mark}时，幂等键要保证不会重复入账…”` } : {};
  const hits = q ? ofProj(id).filter((c) => c.title.includes(q) || said[c.id]).sort((a, b) => a.ago - b.ago) : [];
  const row = (c) => `<a class="item" href="#/c/${c.id}">${ag(c.agent, false)}<div class="grow"><div class="t trunc">${hl(c.title)}</div>
    <div class="sub"><span class="nowrap">${agentName(c.agent)}</span>${said[c.id] ? `<span class="faint">·</span><span class="trunc">${said[c.id]}</span>` : ''}${c.archived ? '<span class="faint">·</span><span class="nowrap">已归档</span>' : ''}</div></div>
    <div class="end">${status(c)}<span class="when">${esc(c.at)}</span></div></a>`;
  const body = `<div class="page narrow"><div class="head"><div class="grow"><h1>在 ${esc(p.name)} 中搜索</h1><p>搜索这个项目里的会话标题和你发送过的内容。</p></div></div>
    <div class="toolbar"><label class="search grow">${I('search')}<input id="sq" class="input" value="${esc(q)}" maxlength="160" placeholder="输入关键词，按 Enter 搜索" onkeydown="if(event.key==='Enter')go('#/projects/${id}/search?q='+encodeURIComponent(this.value.trim()))"></label></div>
    ${!q ? `<div class="card">${empty('search', '输入关键词', `在 ${esc(p.name)} 的会话中搜索。`)}</div>`
      : `<p class="help" style="margin:-4px 0 16px">${hits.length} 条结果 · 范围：${esc(p.name)}（${esc(mach(p.m).name)}）。不搜索 AI 回复、工具输出和其他项目。</p>
      ${hits.length ? `<div class="list">${hits.map(row).join('')}</div>` : `<div class="card">${empty('search', `没有找到“${esc(q)}”`, `在 ${esc(p.name)} 中没有匹配的会话标题或消息。`)}</div>`}`}</div>`;
  return { active: 'devices', proj: id, crumbs: crumbs(...projCrumbs(p), '搜索'), body };
}

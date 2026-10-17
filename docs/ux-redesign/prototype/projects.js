// 项目列表、项目详情、搜索结果页。
const projConvs = (pid) => D.conversations.filter((c) => c.p === pid && !c.archived).sort((a, b) => a.ago - b.ago);

function projCard(p) {
  const cs = projConvs(p.id), bad = p.locations.some((l) => !l.ok);
  return `<a class="card click pc" href="#/projects/${p.id}">
    <div class="row"><span class="glyph">${I('folder')}</span><span class="sp"></span>${bad ? `<span class="pill err">${I('alert')}有文件夹无法访问</span>` : ''}</div>
    <div><div class="name">${esc(p.name)}</div><div class="meta trunc mono" title="${esc(p.locations[0].path)}">${esc(p.locations[0].path)}</div></div>
    <div class="row wrap" style="gap:6px">${p.locations.map((l) => { const m = mach(l.m); return `<span class="pill line">${pcIcon(m)}${esc(m.name)}</span>`; }).join('')}</div>
    <div class="foot"><span>${cs.length} 个会话</span>${cs[0] ? `<span class="sp"></span><span class="trunc">最近：${esc(cs[0].at)}</span>` : ''}</div></a>`;
}
function pageProjects() {
  const hp = D.hosts.filter((h) => h.access === 'authorized').flatMap((h) => h.projects.map((p) => ({ ...p, h })));
  const body = `<div class="page"><div class="head"><div class="grow"><h1>项目</h1><p>AI 工具只在你登记的项目文件夹里工作。一个项目可以在多台电脑上各有一个文件夹。</p></div>
      <button class="btn" onclick="openModal('addloc')">${I('plus')}添加项目文件夹</button></div>
    <section class="sec"><div class="sec-h"><h2>你的项目</h2><span class="n">${D.projects.length}</span></div><div class="grid3">${D.projects.map(projCard).join('')}</div></section>
    ${hp.length ? `<section class="sec"><div class="sec-h"><h2>其他主机</h2><span class="n">${hp.length}</span><span class="pill line">${I('eye')}仅查看</span></div>
      <div class="list">${hp.map((p) => { const m = p.h.machines.find((x) => x.id === p.m); return `<a class="item" href="#/computers/${p.h.id}"><span class="glyph sm">${I('folder')}</span>
        <div class="grow"><div class="t">${esc(p.name)}</div><div class="sub">${I(p.h.icon)}<span>${esc(p.h.name)}${m.name !== p.h.name ? ` › ${esc(m.name)}` : ''}</span><span class="faint">·</span><span class="mono trunc">${esc(p.path)}</span></div></div>
        <div class="end">${I('chev')}</div></a>`; }).join('')}</div></section>` : ''}</div>`;
  return { active: 'projects', crumbs: crumbs('项目'), body };
}
function pageProject(id) {
  const p = proj(id); if (!p) return null;
  const cs = projConvs(id);
  const loc = (l) => {
    const m = mach(l.m), off = m.kind === 'remote' && m.conn !== 'online';
    const s = !l.ok ? `<span class="status err">无法访问</span>` : off ? `<span class="status off">电脑离线</span>` : `<span class="status ok">可用</span>`;
    // 基线只允许移除配对电脑上的文件夹，且不能是最后一个；仍有会话时弹窗说明原因（rmloc）
    const rm = m.kind === 'remote' && p.locations.length > 1 ? `<button class="btn sm" onclick="openModal('rmloc:${p.id},${m.id}')">移除</button>` : '';
    return `<div class="item static" style="align-items:flex-start"><span class="glyph sm">${pcIcon(m)}</span><div class="grow"><div class="t">${esc(m.name)}</div>
      <div class="sub mono" style="word-break:break-all;white-space:normal">${esc(l.path)}</div>${!l.ok ? `<div class="help" style="margin-top:6px;color:var(--ct-err-text)">文件夹不存在或没有读取权限。</div>` : ''}</div>
      <div class="col" style="align-items:flex-end;gap:8px">${s}${rm}</div></div>`;
  };
  const body = `<div class="page"><div class="head with-glyph"><span class="glyph xl">${I('folder')}</span><div class="grow"><h1>${esc(p.name)}</h1><p>${p.locations.length} 个文件夹 · ${cs.length} 个会话</p></div>
      <button class="btn primary" onclick="openModal('new:${id}')">${I('plus')}在这个项目中新建会话</button></div>
    <div class="split"><section><div class="sec-h"><h2>会话</h2><span class="n">${cs.length}</span></div>
        ${cs.length ? `<div class="list">${cs.map((c) => sessionItem(c)).join('')}</div>` : `<div class="card">${empty('sparkle', '还没有会话', '在这个项目中新建一个会话。')}</div>`}</section>
      <aside class="col" style="gap:16px"><div class="card"><div class="card-h">文件夹<span class="sp"></span><button class="btn ghost sm" onclick="openModal('addloc')">${I('plus')}添加</button></div>
        <div class="list flush" style="margin-top:8px;border-top:1px solid var(--ct-line)">${p.locations.map(loc).join('')}</div></div>
        <p class="help">同一个项目在不同电脑上的文件夹各自独立，会话固定在创建时所在的电脑。</p>
        <div class="card pad row" style="gap:12px"><div class="grow"><b>移除项目</b><div class="small muted">${refConvs(id).length ? '还有会话时不能移除。' : '只从 CodeTether 中移除，不删除任何文件。'}</div></div><button class="btn sm danger" onclick="openModal('rmproj:${p.id}')">移除</button></div></aside></div></div>`;
  return { active: 'projects', crumbs: crumbs(['项目', '#/projects'], p.name), body };
}

/* ---------- 搜索结果（单个项目范围） ---------- */
function pageSearch() {
  const q = hq('q') || '重连', pid = hq('p') || 'p-web', p = proj(pid);
  const hl = (s) => esc(s).split(esc(q)).join(`<mark>${esc(q)}</mark>`);
  const c = conv('c2');
  const hits = pid === 'p-web' ? [
    // 同一会话的标题和消息都匹配时合并成一行：标题高亮，下一行显示消息片段
    { c, t: hl(c.title), sub: `你发送过：“…断网后${`<mark>${esc(q)}</mark>`}要不要指数退避，上限设多少合适…”` },
    { c: conv('c8'), t: esc(conv('c8').title), sub: `你发送过：“…${`<mark>${esc(q)}</mark>`}之后也要继续采样…”` },
  ] : [];
  const body = `<div class="page narrow"><div class="head"><div class="grow"><h1>搜索</h1><p>在一个项目里搜索会话标题和你发送过的内容。</p></div></div>
    <div class="toolbar"><label class="search grow">${I('search')}<input id="sq" class="input" value="${esc(q)}" onkeydown="if(event.key==='Enter')go('#/search?p=${pid}&q='+encodeURIComponent(this.value))"></label>
      <select class="input" style="width:auto" aria-label="项目" onchange="go('#/search?q=${encodeURIComponent(q)}&p='+this.value)">${D.projects.map((x) => `<option value="${x.id}" ${x.id === pid ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
    <p class="help" style="margin:-4px 0 16px">${hits.length} 条结果 · 范围：${esc(p.name)}（${p.locations.map((l) => esc(mach(l.m).name)).join('、')}）。不搜索 AI 回复、工具输出和其他主机。</p>
    ${hits.length ? `<div class="list">${hits.map((h) => `<a class="item" href="#/c/${h.c.id}">${ag(h.c.agent, false)}<div class="grow"><div class="t trunc">${h.t}</div><div class="sub"><span class="trunc">${h.sub}</span></div></div><div class="end">${status(h.c)}<span class="when">${esc(h.c.at)}</span></div></a>`).join('')}</div>`
      : `<div class="card">${empty('search', `没有找到“${esc(q)}”`, `在 ${esc(p.name)} 中没有匹配的会话标题或消息。`)}</div>`}</div>`;
  return { active: '', crumbs: crumbs('搜索'), body };
}

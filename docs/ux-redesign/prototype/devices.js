// 设备（起始页）与设备详情。结构：设备 › 项目（这台设备上的一个文件夹）› 会话。
// 设备 = 这台电脑 + 通过 CodeTether Node 配对的设备，都可以完整使用：添加项目、新建会话、发送消息、查看历史。
const HEALTH = { healthy: ['ok', '正常'], degraded: ['warn', '最近有异常'], unknown: ['off', '尚未运行过'] };
// 这个项目里还没导入的以前的会话（可以继续的）
const nativeNew = (pid) => (NATIVE[pid]?.items || []).filter((n) => n.resume && !n.adopted);

/* ---------- 项目卡片 ---------- */
function projCard(p) {
  const st = projState(p), cs = projConvs(p.id), run = cs.filter(busy).length, nn = nativeNew(p.id).length;
  const meta = [`${cs.length} 个会话`, run && `${run} 个进行中`, nn && `${nn} 个可导入`].filter(Boolean).join(' · ');
  const last = cs.slice().sort((a, b) => a.ago - b.ago)[0];
  return `<a class="card click pj ${st.ok ? '' : 'dim'}" href="#/projects/${p.id}">
    <div class="row"><span class="faint">${I('folder')}</span><span class="name trunc grow">${esc(p.name)}</span>${st.ok ? hotDot(cs) : `<span class="pill ${st.k}" title="${esc(st.why)}">${st.text}</span>`}</div>
    <div class="path trunc" title="${esc(p.path)}">${esc(p.path)}</div>
    <div class="foot"><span class="trunc grow">${meta}</span>${last ? `<span class="nowrap">${esc(last.at)}</span>` : ''}</div></a>`;
}
const addProjCard = (m) => `<button class="card click pj add" onclick="openModal('addproj:${m.id}')"><span class="glyph sm">${I('plus')}</span><b>添加项目</b><span class="small faint">选择${nm(m.name)}上的一个文件夹</span></button>`;
// 设备一节：设备标题行 + 它的项目
function devSec(m) {
  const st = devState(m), ps = projects(m.id);
  const head = `<div class="dev-h"><a class="glyph sm" href="#/devices/${m.id}" title="查看设备">${pcIcon(m)}</a>
    <div class="grow" style="min-width:0"><div class="row" style="gap:10px"><a class="dev-name trunc" href="#/devices/${m.id}">${esc(m.name)}</a>${devLine(m)}</div><div class="meta">${esc(m.platform)} · ${m.arch}${m.kind === 'local' ? '' : m.transport === 'relay' ? ' · 通过 Relay' : ' · 配对'}</div></div>
    ${canAddProj(m) ? `<button class="btn sm" onclick="openModal('addproj:${m.id}')">${I('plus')}添加项目</button>` : ''}</div>`;
  const off = st.ok ? '' : `<p class="help" style="margin:-4px 0 12px">${esc(st.why)}。可以查看以前的会话，恢复后才能继续或新建。</p>`;
  const grid = ps.length || canAddProj(m) ? `<div class="grid3">${ps.map(projCard).join('')}${canAddProj(m) ? addProjCard(m) : ''}</div>` : `<div class="card loc-empty">这台设备上还没有项目。</div>`;
  return `<section class="sec dev-sec" id="dev-${m.id}">${head}${off}${grid}</section>`;
}

/* ---------- 设备（起始页） ---------- */
function pageDevices() {
  const s = scene(), att = openAttn();
  const head = `<div class="head"><div class="grow"><h1>设备</h1><p>每台设备下面是你在上面添加的项目文件夹。打开项目就能看到它的会话，在里面新建会话时 CodeTether 会直接在这个文件夹里启动 Codex 或 Claude Code。</p></div>
    <a class="btn" href="#/add">${I('plus')}添加设备</a></div>`;
  let body;
  if (s.loading) body = [3, 2].map((n) => `<section class="sec"><div class="dev-h"><span class="glyph sm"></span><div class="grow col" style="gap:8px"><div class="skel" style="width:22%"></div><div class="skel" style="width:14%;height:9px"></div></div></div>
    <div class="grid3">${'<div class="card pad col" style="gap:12px;min-height:132px"><div class="skel" style="width:50%"></div><div class="skel" style="width:80%;height:9px"></div></div>'.repeat(n)}</div></section>`).join('');
  else {
    const n = (t) => att.filter((a) => a.type === t).length;
    const sum = [n('approval') && `${n('approval')} 个等待批准`, n('completed_review') && `${n('completed_review')} 个待查看`, n('failed') && `${n('failed')} 个失败`].filter(Boolean).join(' · ');
    body = `${att.length ? notice(n('approval') ? 'warn' : '', 'inbox', `${att.length} 件事需要你处理`, sum, `<a class="btn sm" href="#/inbox">查看待处理</a>`) + '<div style="height:24px"></div>' : ''}
      ${s.empty ? notice('info', 'folder', '先在这台电脑上添加一个项目', '选择你平时用 Codex 或 Claude Code 打开的那个文件夹，CodeTether 会自动找出你以前在里面的会话。', `<button class="btn sm primary" onclick="openModal('addproj:m-local')">${I('plus')}添加项目</button>`) + '<div style="height:24px"></div>' : ''}
      ${D.machines.map(devSec).join('')}
      <p class="help" style="margin-top:var(--s8)">用同一账号登录的其他 Mac 或 Windows 电脑，目前还不能在这里使用，见<a href="#/roadmap">后续规划</a>。</p>
      ${note('“设备”取代了 v3 的“项目”起始页。一个项目只属于一台设备（ProjectRecord 只用一个 ProjectLocation）。设备 = 本机 + Node 配对的设备，两者在基线中都可以新建会话和发送消息。')}`;
  }
  return { active: 'devices', crumbs: crumbs('设备'), body: `<div class="page">${head}${body}</div>` };
}

/* ---------- 设备详情 ---------- */
function pageDevice(id) {
  const m = mach(id); if (!m) return null;
  const st = devState(m), off = m.kind === 'remote' && m.conn !== 'online', cs = machConvs(id).slice(0, 6), ps = projects(id);
  const usable = ps.some((p) => projState(p).ok);
  const tools = `<div class="card"><div class="card-h">AI 工具</div><div class="list flush">${m.providers.map((p) => `<div class="item static">${ag(p.id, false, 'lg')}
      <div class="grow"><div class="t">${p.label}</div><div class="sub">${p.id === 'claude' ? '只读取和搜索文件' : '编辑文件、运行命令'}</div></div><span class="status ${HEALTH[p.health][0]}">${HEALTH[p.health][1]}</span></div>`).join('')}</div>
    ${m.kind === 'remote' ? `<div class="card-b help" style="padding-top:0">${m.observed === 'last_known' ? '显示的是上次已知的状态。' : ''}这台设备上的会话暂不支持停止和审批。</div>` : ''}</div>`;
  const facts = m.kind === 'local' ? `<dt>连接</dt><dd>这台电脑</dd><dt>服务</dt><dd><span class="status ok">运行中</span></dd><dt>地址</dt><dd class="mono">127.0.0.1:4317</dd>`
    : `<dt>连接</dt><dd>${off ? '暂时无法连接' : m.transport === 'relay' ? '通过 Relay' : '局域网直连'}</dd><dt>地址</dt><dd class="mono trunc">${esc(m.addr)}</dd><dt>上次在线</dt><dd>${esc(m.lastSeen)}</dd><dt>配对方式</dt><dd>CodeTether Node</dd>`;
  const conn = `<div class="card"><div class="card-h">连接</div><div class="card-b"><dl class="facts">${facts}</dl>
    ${m.kind === 'remote' ? `<div class="row" style="margin-top:16px"><button class="btn sm" onclick="openModal('addr:${id}')">更新地址</button><span class="sp"></span><button class="btn sm ghost danger" onclick="openModal('unpair:${id}')">取消配对</button></div>` : ''}</div></div>`;
  const pj = hq('proj') === 'error' ? `${notice('err', 'alert', '读不到项目列表', '这台设备上的项目暂时无法读取。', retry())}${techErr('project_list_unavailable', 'host · projects')}`
    : ps.length ? `<div class="list">${ps.map((p) => { const s2 = projState(p), n = projConvs(p.id).length;
      return `<a class="item ${s2.ok ? '' : 'dim'}" href="#/projects/${p.id}"><span class="glyph sm">${I('folder')}</span><div class="grow"><div class="t">${esc(p.name)}</div><div class="sub mono"><span class="trunc" title="${esc(p.path)}">${esc(p.path)}</span></div></div>
        <div class="end">${s2.ok || !devState(m).ok ? '' : `<span class="status err">${s2.text}</span>`}<span>${n} 个会话</span>${I('chev')}</div></a>`; }).join('')}</div>`
    : `<div class="card">${empty('folder', '还没有项目', `选择${nm(m.name)}上的一个文件夹，以前在里面的 Codex 和 Claude Code 会话会被自动找到。`, canAddProj(m) ? `<button class="btn primary" onclick="openModal('addproj:${id}')">${I('plus')}添加项目</button>` : '')}</div>`;
  const body = `<div class="page"><div class="head with-glyph"><span class="glyph xl">${pcIcon(m)}</span><div class="grow"><h1>${esc(m.name)}</h1><p class="row" style="gap:12px">${devLine(m)}<span class="faint">${esc(m.platform)} · ${m.arch}</span></p></div>
      <div class="row" style="gap:var(--s3)">${canAddProj(m) ? `<button class="btn" onclick="openModal('addproj:${id}')">${I('plus')}添加项目</button>` : ''}${usable ? `<button class="btn primary" onclick="openModal('new@${id}')">${I('edit')}新建会话</button>` : ''}</div></div>
    ${off ? notice('warn', 'wifi_off', `${nm(m.name, false)}已离线`, `上次在线 ${esc(m.lastSeen)}。可以查看以前的会话，但不能发送消息、新建会话或添加项目。重新上线后会自动恢复。`, retry('重试连接')) + '<div style="height:24px"></div>'
      : st.ok ? '' : notice('warn', 'alert', st.why, '可以查看以前的会话。', '') + '<div style="height:24px"></div>'}
    <div class="split"><div><section class="sec"><div class="sec-h"><h2>项目</h2><span class="n">${ps.length}</span></div>${pj}</section>
      <section class="sec"><div class="sec-h"><h2>最近的会话</h2><span class="n">${machConvs(id).length}</span></div>${cs.length ? `<div class="list">${cs.map((c) => sessionItem(c, { noDev: true })).join('')}</div>` : `<div class="card">${empty('sparkle', '还没有会话', '打开一个项目，在里面新建会话。')}</div>`}</section></div>
      <aside class="col" style="gap:16px">${tools}${conn}</aside></div></div>`;
  return { active: 'devices', dev: id, crumbs: crumbs(['设备', '#/devices'], m.name), body };
}

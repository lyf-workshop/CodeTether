// 我的电脑：列表、本机主机下的电脑详情、其他主机详情。
const machConvs = (id) => D.conversations.filter((c) => c.m === id && !c.archived).sort((a, b) => a.ago - b.ago);

function pcCard(x) {
  const s = pcState(x), isHost = !x.kind;
  const cs = isHost ? hostConvs().filter((c) => c.host === x.id) : machConvs(x.id);
  const run = cs.filter((c) => c.status === 'running').length;
  const kind = isHost ? `其他主机${x.machines.length > 1 ? ` · 含 ${x.machines.length} 台电脑` : ''}` : x.kind === 'local' ? '本机' : '已配对';
  const provs = isHost ? x.providers || [] : x.providers;
  return `<a class="card click pc ${s.can === 'none' || s.can === 'history' ? 'dim' : ''}" href="#/computers/${x.id}">
    <div class="row"><span class="glyph">${pcIcon(x)}</span><span class="sp"></span>${isHost ? canPill('view') : run ? `<span class="status run">${run} 个运行中</span>` : ''}</div>
    <div><div class="name trunc">${esc(x.name)}</div><div class="meta">${esc(x.platform)} · ${kind}</div></div>
    <div class="foot"><span class="status ${s.dot} trunc">${esc(s.text)}</span><span class="sp"></span>${s.can === 'none' ? '' : `<span>${cs.length} 个会话</span>`}${provs.length ? `<span class="ags">${provs.map((p) => ag(p.id, false)).join('')}</span>` : ''}</div></a>`;
}
function hostRow(h) {
  const [k, t] = ACCESS[h.access];
  const d = { pending: '已发送申请，等对方在那台电脑上批准。', denied: '对方拒绝了申请。可以联系对方后重新申请。', expired: '申请已过期，可以重新申请。',
    cancelled: '申请已取消，可以重新申请。', none: '申请后，对方批准即可查看这台电脑上的会话。' }[h.access];
  const act = h.access === 'pending' ? `<button class="btn sm" onclick="setAccess('${h.id}','cancelled')">取消申请</button>`
    : `<button class="btn sm ${h.access === 'none' ? 'primary' : ''}" onclick="setAccess('${h.id}','pending')">${h.access === 'none' ? '申请查看' : '重新申请'}</button>`;
  return `<div class="item static"><span class="glyph sm">${I(h.icon)}</span><div class="grow"><div class="t">${esc(h.name)}</div><div class="sub"><span>${esc(h.platform)}</span><span class="faint">·</span><span class="trunc">${d}</span></div></div>
    <div class="end"><span class="status ${k}">${t}</span>${act}</div></div>`;
}
window.setAccess = (id, a) => { host(id).access = a; render(); };
window.reqDone = (id) => { D.accessRequests.find((r) => r.id === id).open = false; render(); };

function pageComputers() {
  const out = hq('account') === 'out' || !D.account.signedIn;
  const reqs = out ? [] : D.accessRequests.filter((r) => r.open);
  const authed = out ? [] : D.hosts.filter((h) => h.access === 'authorized'), others = out ? [] : D.hosts.filter((h) => h.access !== 'authorized');
  const body = `<div class="page"><div class="head"><div class="grow"><h1>我的电脑</h1><p>这些电脑上的 Codex 和 Claude Code 会话都会汇总到 CodeTether。</p></div><a class="btn primary" href="#/add">${I('plus')}添加电脑</a></div>
    ${reqs.map((r) => notice('info', 'shield', `${esc(r.device)} 想查看这台电脑`, `${esc(r.platform)} · 只能查看项目和会话，不能发送、审批或中断 · ${esc(r.expires)}`,
      `<button class="btn sm" onclick="reqDone('${r.id}')">拒绝</button><button class="btn sm primary" onclick="reqDone('${r.id}')">允许</button>`)).join('')}
    <section class="sec" style="${reqs.length ? 'margin-top:24px' : ''}"><div class="grid3">${[...D.machines, ...authed].map(pcCard).join('')}
      <a class="card click pc add" href="#/add"><span class="glyph">${I('plus')}</span><b>添加电脑</b><span class="small faint">Mac、Windows 或 Linux 服务器</span></a></div></section>
    ${others.length ? `<section class="sec" id="more"><div class="sec-h"><h2>同一账号下的其他电脑</h2><span class="n">${others.length}</span></div><div class="list">${others.map(hostRow).join('')}</div></section>` : ''}
    ${out ? `<section class="sec"><div class="card">${empty('user', '登录后查看你的其他电脑', '同一账号下的 Mac 和 Windows 电脑会出现在这里，对方批准后可以查看它们的会话。<br>这台电脑和已配对的服务器不需要登录。', `<a class="btn primary" href="#/signin">登录</a>`)}</div></section>` : ''}
    <section class="sec"><div class="grid2">
      <div class="card pad"><div class="row">${I('link')}<b>配对的电脑</b><span class="sp"></span><span class="pill ok">${I('check')}可以继续工作</span></div><p class="help" style="margin-top:10px">通过 CodeTether Node 配对，例如 Linux 服务器。可以查看会话、发送消息、在上面新建会话。不需要账号。</p></div>
      <div class="card pad"><div class="row">${I('eye')}<b>其他主机</b><span class="sp"></span><span class="pill line">${I('eye')}仅查看</span></div><p class="help" style="margin-top:10px">同一账号下其他电脑上的桌面版 CodeTether。对方批准后可以查看会话和进度，不能发送消息、审批或中断。</p></div></div></section></div>`;
  return { active: 'computers', crumbs: crumbs('我的电脑'), body };
}

/* ---------- 电脑详情（本机主机下） ---------- */
const HEALTH = { healthy: ['ok', '正常'], degraded: ['warn', '最近有异常'], unknown: ['off', '尚未运行过'] };
function pageComputer(id) {
  const m = mach(id); if (!m) { const h = host(id); return h ? pageHost(h) : null; }
  const s = pcState(m), off = m.kind === 'remote' && m.conn !== 'online', cs = machConvs(id);
  const projs = D.projects.flatMap((p) => p.locations.filter((l) => l.m === id).map((l) => ({ p, l })));
  const tools = `<div class="card"><div class="card-h">AI 工具</div><div class="list flush">${m.providers.map((p) => `<div class="item static">${ag(p.id, false, 'lg')}
      <div class="grow"><div class="t">${p.label}</div><div class="sub">${p.id === 'claude' ? '只读取和搜索文件' : '编辑文件、运行命令'}</div></div><span class="status ${HEALTH[p.health][0]}">${HEALTH[p.health][1]}</span></div>`).join('')}</div>
    ${m.kind === 'remote' ? `<div class="card-b help" style="padding-top:0">${m.observed === 'last_known' ? '显示的是上次已知的状态。' : ''}这台电脑上的会话暂不支持停止和审批。</div>` : ''}</div>`;
  const pj = `<div class="card"><div class="card-h">项目文件夹<span class="sp"></span>${off ? '' : `<button class="btn ghost sm" onclick="openModal('addloc:${id}')">${I('plus')}添加</button>`}</div>
    ${hq('proj') === 'error' ? `<div class="card-b">${notice('err stack', 'alert', '读不到项目列表', '这台电脑上的项目暂时无法读取。', retry())}${techErr('project_list_unavailable', 'host · projects')}</div>`
      : `<div class="list flush">${projs.map(({ p, l }) => `<a class="item" href="#/projects/${p.id}?scroll=loc-${id}"><span class="glyph sm">${I('folder')}</span><div class="grow"><div class="t">${esc(p.name)}</div><div class="sub mono"><span class="trunc">${esc(l.path)}</span></div></div>${l.ok ? '' : '<span class="status err">无法访问</span>'}</a>`).join('')}</div>`}</div>`;
  const facts = m.kind === 'local' ? `<dt>连接</dt><dd>这台电脑</dd><dt>服务</dt><dd><span class="status ok">运行中</span></dd><dt>地址</dt><dd class="mono">127.0.0.1:4317</dd>`
    : `<dt>连接</dt><dd>${off ? '暂时无法连接' : m.transport === 'relay' ? '通过 Relay' : '局域网直连'}</dd><dt>地址</dt><dd class="mono trunc">${esc(m.addr)}</dd><dt>上次在线</dt><dd>${esc(m.lastSeen)}</dd><dt>权限</dt><dd>完整访问（已配对）</dd>`;
  const conn = `<div class="card"><div class="card-h">连接</div><div class="card-b"><dl class="facts">${facts}</dl>
    ${m.kind === 'remote' ? `<div class="row" style="margin-top:16px"><button class="btn sm" onclick="openModal('addr')">更新地址</button><span class="sp"></span><button class="btn sm ghost danger" onclick="openModal('unpair:${id}')">取消配对</button></div>` : ''}</div></div>`;
  const body = `<div class="page"><div class="head with-glyph"><span class="glyph xl">${pcIcon(m)}</span><div class="grow"><h1>${esc(m.name)}</h1><p class="row" style="gap:12px"><span class="status ${s.dot}">${esc(s.text)}</span><span class="faint">${esc(m.platform)} · ${m.arch}</span></p></div>
      ${off ? '' : `<button class="btn primary" onclick="openModal('new:${id}')">${I('plus')}新建会话</button>`}</div>
    ${off ? notice('warn', 'wifi_off', `${nm(m.name, false)}已离线`, `上次在线 ${esc(m.lastSeen)}。可以查看以前的会话，但不能发送消息或新建会话。重新上线后会自动恢复。`, retry('重试连接')) + '<div style="height:24px"></div>' : ''}
    <div class="split"><section><div class="sec-h"><h2>会话</h2><span class="n">${cs.length}</span></div>${cs.length ? `<div class="list">${cs.map((c) => sessionItem(c, { hidePc: true })).join('')}</div>` : `<div class="card">${empty('sparkle', '还没有会话', '在这台电脑上新建一个会话。')}</div>`}</section>
      <aside class="col" style="gap:16px">${tools}${pj}${conn}</aside></div></div>`;
  return { active: 'computers', crumbs: crumbs(['我的电脑', '#/computers'], m.name), body };
}

/* ---------- 其他主机详情（仅查看） ---------- */
function pageHost(h) {
  const s = pcState(h), crumb = crumbs(['我的电脑', '#/computers'], h.name);
  if (h.access !== 'authorized') return { active: 'computers', crumbs: crumb, body: `<div class="page narrow"><div class="head with-glyph"><span class="glyph xl">${I(h.icon)}</span><div class="grow"><h1>${esc(h.name)}</h1><p>${esc(h.platform)} · 其他主机</p></div></div><div class="list">${hostRow(h)}</div></div>` };
  const mf = hq('m'), un = h.presence === 'unreachable';
  const cs = hostConvs().filter((c) => c.host === h.id && (!mf || c.m === mf)).sort((a, b) => a.ago - b.ago);
  const chips = h.machines.length > 1 ? `<div class="seg" style="margin-bottom:12px"><a href="#/computers/${h.id}" aria-pressed="${!mf}">全部</a>${h.machines.map((m) => `<a href="#/computers/${h.id}?m=${m.id}" aria-pressed="${mf === m.id}">${I(m.icon)}${esc(m.name)}</a>`).join('')}</div>` : '';
  const side = un ? '' : `<aside class="col" style="gap:16px"><div class="card"><div class="card-h">电脑</div><div class="list flush">${h.machines.map((m) => `<div class="item static"><span class="glyph sm">${I(m.icon)}</span><div class="grow"><div class="t">${esc(m.name)}</div><div class="sub">${esc(m.platform)}</div></div></div>`).join('')}</div></div>
    <div class="card"><div class="card-h">项目</div><div class="list flush">${h.projects.map((p) => `<div class="item static"><span class="glyph sm">${I('folder')}</span><div class="grow"><div class="t">${esc(p.name)}</div><div class="sub mono"><span class="trunc">${esc(p.path)}</span></div></div></div>`).join('')}</div></div>
    <div class="card"><div class="card-h">访问</div><div class="card-b"><dl class="facts"><dt>权限</dt><dd>仅查看</dd><dt>连接</dt><dd>通过 Relay</dd></dl><p class="help" style="margin-top:12px">授权由${nm(h.name)}的主人管理。</p></div></div></aside>`;
  const body = `<div class="page"><div class="head with-glyph"><span class="glyph xl">${I(h.icon)}</span><div class="grow"><h1>${esc(h.name)}</h1><p class="row" style="gap:12px"><span class="status ${s.dot}">${esc(s.text)}</span><span class="faint">${esc(h.platform)} · 其他主机</span></p></div>${canPill('view')}</div>
    ${un ? notice('warn', 'wifi_off', `暂时连不上${nm(h.name, true, false)}`, `上次在线 ${esc(h.lastSeen)}。那台电脑可能已关机或断网。授权仍然有效，恢复连接后会自动显示会话。`, retry('重试'))
      : notice('', 'eye', '你可以查看这台电脑上的会话和进度', '发送消息、审批和中断需要在那台电脑上进行。')}
    <div style="height:24px"></div>
    <div class="${un ? '' : 'split'}"><section><div class="sec-h"><h2>会话</h2><span class="n">${un ? '' : cs.length}</span></div>${chips}
      ${un ? `<div class="card">${empty('wifi_off', '连接恢复后显示会话', `CodeTether 会自动重试连接${nm(h.name, true, false)}。`)}</div>` : `<div class="list">${cs.map((c) => sessionItem(c, { hidePc: h.machines.length < 2, machOnly: true, noRO: true })).join('')}</div>`}</section>${side}</div></div>`;
  return { active: 'computers', crumbs: crumb, body };
}

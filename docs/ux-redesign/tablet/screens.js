// 列表类页面：最近的会话、待处理、设备、设备详情、项目、项目内搜索。每个函数返回 { sel, main }
const newBtn = (p = '') => `<button class="btn fill sm" data-sheet="new${p ? ':' + p : ''}">${I('plus', 'sm')}新建会话</button>`;

function scrHome(q) {
  if (q.removed) return { sel: 'home', main: nav() + page(`<h1 class="large">最近的会话</h1>
    <div class="note err" style="margin-top:14px">${I('alert')}<span><b>Windows 台式机 已把这台平板移除</b><br>要再用它，到那台电脑上打开 设备 › 添加设备，生成新的配对码，然后在这里输入。</span></div>
    <div style="margin-top:14px;display:flex;gap:10px"><button class="btn fill" data-sheet="pair">输入配对码</button><a class="btn gray" href="#/devices">看其他电脑</a></div>`) };
  // 需要你处理 = 待处理（等待批准、已完成待查看、失败），数字和侧栏角标一致；运行中的不需要你动手，单列一节
  const todo = D.attention.map((a) => $c(a.c));
  const running = D.conversations.filter((c) => c.status === 'running').sort((a, b) => a.ago - b.ago);
  let h = `<h1 class="large">最近的会话</h1><p class="lead">所有电脑和设备上的会话，按设备分组。</p>`;
  h += sec('需要你处理', '<a href="#/inbox">全部</a>', `${todo.length} 个`) + `<div class="group">${todo.map((c) => convRow(c, true)).join('')}</div>`;
  if (running.length) h += sec('正在运行', '', `${running.length} 个`) + `<div class="group">${running.map((c) => convRow(c, true)).join('')}</div>`;
  for (const m of D.machines) {
    const list = D.projects.filter((p) => p.m === m.id).flatMap((p) => convsOf(p.id)).sort((a, b) => a.ago - b.ago);
    h += sec(`${m.name}`, list.length > 5 ? `<a href="#/devices/${m.id}">查看全部</a>` : '', mSub(m));
    h += `<div class="group ${reach(m) ? '' : 'dim'}">${list.slice(0, 5).map((c) => convRow(c)).join('') || '<div class="row"><span class="t"><small>还没有会话</small></span></div>'}</div>`;
    if (!reach(m)) h += `<div class="foot">${m.via ? `要等 ${$m(m.via).name} 上线才能打开。` : '离线时只能看到上次读取的列表，打开会话要等它上线。'}</div>`;
  }
  return { sel: 'home', main: nav({ right: newBtn() }) + page(h) };
}

const ATT = { approval: ['warn', 'shield', '等待批准'], completed_review: ['ok', 'check', '已完成，等你查看'], failed: ['err', 'alert', '执行失败'] };
function scrInbox(q) {
  const f = q.f || 'all';
  const keys = { all: null, approval: 'approval', completed_review: 'completed_review', failed: 'failed' };
  const list = D.attention.filter((a) => !keys[f] || a.type === keys[f]);
  const seg = [['all', '全部', D.attention.length], ['approval', '等待批准', 1], ['completed_review', '已完成待查看', 1], ['failed', '失败', 1]]
    .map(([k, l, n]) => `<button class="${k === f ? 'on' : ''}" data-go="#/inbox?f=${k}">${l} ${n}</button>`).join('');
  let h = `<h1 class="large">待处理</h1><p class="lead">处理后会从这里移除。</p><div class="seg">${seg}</div>`;
  h += `<div class="group">${list.map((a) => {
    const c = $c(a.c), p = $p(c.p), m = $m(p.m), [k, icon, label] = ATT[a.type];
    const acts = a.type === 'approval'
      ? `<div class="cmd" style="background:var(--code);border-radius:10px;padding:8px 12px">${esc(a.cmd)}</div>
         <div class="acts"><button class="btn fill sm" data-flash="已允许一次（演示：先解锁平板）">允许一次</button><button class="btn gray sm" data-flash="已拒绝">拒绝</button><a class="btn plain sm" href="#/c/${c.id}">打开会话</a></div>`
      : `<div class="acts"><a class="btn tint sm" href="#/c/${c.id}">${a.type === 'failed' ? '打开会话' : '查看'}</a><button class="btn gray sm" data-flash="已从待处理移除">知道了</button></div>`;
    return `<div class="row stack"><div style="display:flex;gap:12px;align-items:center"><span class="lead-ic" style="color:var(--${k})">${I(icon)}</span>
      <span class="t"><b>${esc(c.title)}</b><small><span class="tag ${k}">${label}</span> ${ag(c.agent)} · ${m.name} · ${p.name}</small></span><span class="r">${a.at}</span></div>${acts}</div>`;
  }).join('') || '<div class="row"><span class="t"><small>没有待处理的事</small></span></div>'}</div>`;
  if (f === 'all' || f === 'approval') h += `<div class="foot">批准前要先解锁平板（可以在 设置 里关掉）。通知上不能直接批准。</div>`;
  return { sel: 'inbox', main: nav() + page(h) };
}

function scrDevices() {
  let h = `<h1 class="large">设备</h1><p class="lead">能运行 AI 工具的电脑和服务器。每台设备一节，节里是它上面的项目。</p>`;
  for (const m of D.machines) {
    const ps = projectsOf(m.id);
    h += sec(m.name, reach(m) ? `<a href="#" data-sheet="addproj:${m.id}">添加项目</a>` : '', mSub(m));
    h += `<div class="group ${reach(m) ? '' : 'dim'}"><a class="row" href="#/devices/${m.id}"><span class="lead-ic">${I(m.icon)}</span><span class="t"><b>${m.name}</b><small>${m.os}</small></span><span class="r">${I('chev', 'sm')}</span></a>
      ${ps.map((p) => `<a class="row ind" href="#/projects/${p.id}"><span class="lead-ic">${I('folder', 'sm')}</span><span class="t"><b>${p.name}</b><small>${convsOf(p.id).length} 个会话 · ${esc(p.path)}</small></span><span class="r">${I('chev', 'sm')}</span></a>`).join('')}</div>`;
  }
  h += sec('添加电脑') + `<div class="group"><button class="row" data-sheet="pair"><span class="lead-ic accent">${I('plus', 'sm')}</span><span class="t"><b>输入配对码</b><small>在那台电脑上打开 设备 › 添加设备，会显示 6 位配对码</small></span></button></div>
    <div class="foot">这台平板是 ${D.tablet.name}。电脑可以在它的设备页里随时移除这台平板。</div>`;
  return { sel: 'devices', main: nav() + page(h) };
}

const TOOL = { ok: ['ok', '可以使用'], login: ['warn', '需要在电脑上登录'], missing: ['', '没有安装'] };
function scrDevice(id) {
  const m = $m(id), ps = projectsOf(id);
  const recent = ps.flatMap((p) => convsOf(p.id)).sort((a, b) => a.ago - b.ago).slice(0, 5);
  let h = `<h1 class="large">${m.name}</h1><p class="lead">${m.os} · ${mSub(m)}</p>`;
  if (!reach(m)) h += `<div class="note">${I('wifi_off')}<span>${m.via ? `${m.name} 经由 ${$m(m.via).name} 访问，要等那台电脑上线。` : '这台电脑现在连不上，请确认它开着并且联网。'} 下面是上次读取的内容。</span></div>`;
  h += sec('项目', reach(m) ? `<a href="#" data-sheet="addproj:${id}">添加项目</a>` : '') + `<div class="group">${ps.map((p) => `<a class="row" href="#/projects/${p.id}"><span class="lead-ic">${I('folder', 'sm')}</span><span class="t"><b>${p.name}</b><small>${esc(p.path)}</small></span><span class="r">${convsOf(p.id).length} 个会话${I('chev', 'sm')}</span></a>`).join('')}</div>`;
  h += sec('最近的会话') + `<div class="group">${recent.map((c) => convRow(c)).join('')}</div>`;
  h += sec('AI 工具') + `<div class="group">${Object.entries(m.tools).map(([k, v]) => `<div class="row"><span class="t"><b>${AG[k]}</b></span><span class="tag ${TOOL[v][0]}">${TOOL[v][1]}</span></div>`).join('')}</div>
    <div class="foot">安装和登录 AI 工具要在那台电脑上做。</div>`;
  const how = m.via ? `经由 ${$m(m.via).name}` : m.link === 'same_network' ? '同一网络，直接连接' : '经互联网连接';
  h += sec('连接') + `<div class="group"><div class="row"><span class="t"><b>连接方式</b></span><span class="r">${how}</span></div>${m.paired ? `<div class="row"><span class="t"><b>配对时间</b></span><span class="r">${m.paired}</span></div>` : ''}</div>`;
  return { sel: 'm:' + id, main: nav({ right: reach(m) ? newBtn('@' + id) : '' }) + page(h) };
}

function scrProject(id, q) {
  const p = $p(id), m = $m(p.m), ok = reach(m), view = q.view || 'active';
  const all = convsOf(id, true), arch = all.filter((c) => c.archived);
  let list = view === 'archived' ? arch : all.filter((c) => !c.archived);
  const fs = q.s || 'all';
  if (fs !== 'all') list = list.filter((c) => c.status === fs);
  let h = `<h1 class="large">${p.name}</h1><p class="lead">${m.name} · ${esc(p.path)}</p>`;
  if (!ok) h += `<div class="note">${I('wifi_off')}<span>${m.name} 离线，现在不能新建和发送。会话历史仍然可以阅读。</span></div>`;
  h += `<div class="seg" style="max-width:360px"><button class="${view === 'active' ? 'on' : ''}" data-go="#/projects/${id}">会话 ${all.length - arch.length}</button><button class="${view === 'archived' ? 'on' : ''}" data-go="#/projects/${id}?view=archived">已归档 ${arch.length}</button></div>`;
  h += `<div class="chips">${[['all', '全部'], ['running', '运行中'], ['waiting', '等待批准'], ['completed', '已完成'], ['failed', '失败']].map(([k, l]) => `<button class="chip ${k === fs ? 'on' : ''}" data-go="#/projects/${id}?s=${k}">${l}</button>`).join('')}</div>`;
  h += `<div class="group">${list.map((c) => convRow(c)).join('') || '<div class="row"><span class="t"><small>没有符合条件的会话</small></span></div>'}</div>`;
  const nat = NATIVE[id];
  if (nat && view === 'active') {
    h += sec('以前的会话', ok ? `<a href="#" data-flash="已重新扫描">重新扫描</a>` : '', '这个文件夹里在 CodeTether 之外开过的会话');
    h += `<div class="group">${nat.map((n) => `<button class="row" ${n.unsupported ? 'disabled' : `data-check="${n.id}"`}>${n.unsupported ? `<span class="check"></span>` : `<span class="check ${S.picked[n.id] !== false ? 'on' : ''}">${I('check', 'sm')}</span>`}
      <span class="t"><b>${esc(n.title)}</b><small>${ag(n.agent)} · ${n.at}${n.unsupported ? ' · 这个格式还不能导入' : ''}</small></span></button>`).join('')}</div>
      <div style="margin-top:12px"><button class="btn tint sm" data-flash="已导入 2 个会话" ${ok ? '' : 'disabled'}>导入所选</button></div>`;
  }
  const right = `${tb('search', '在项目里搜索', `data-go="#/projects/${id}/search?q=测试"`)}${tb('more', '更多', 'data-menu="proj"')}${ok ? newBtn(id) : ''}`;
  const menu = q.menu === 'proj' || S.menu === 'proj'
    ? `<div class="menu" style="right:150px"><button data-sheet="rename-p:${id}">${I('edit', 'sm')}重命名项目</button><button class="danger" data-sheet="rmproj:${id}">${I('x', 'sm')}移除项目</button></div>` : '';
  return { sel: 'p:' + id, main: nav({ right }) + menu + page(h) };
}

function scrSearch(id, q) {
  const p = $p(id), term = q.q || '';
  const hits = convsOf(id, true).filter((c) => c.title.includes(term) || term === '测试');
  const h = `<div style="display:flex;gap:10px;align-items:center;margin-top:8px"><div class="side-search" style="margin:0;flex:1;width:auto;color:var(--text)">${I('search', 'sm')}${esc(term)}</div><a class="btn plain" href="#/projects/${id}">取消</a></div>
    <p class="foot" style="padding:8px 4px 0">在 ${p.name} 里搜索标题和你发送过的内容。</p>${sec('结果', '', `${hits.length} 个`)}<div class="group">${hits.map((c) => convRow(c)).join('')}</div>`;
  return { sel: 'p:' + id, main: nav({ title: '搜索', sub: p.name }) + page(h) };
}

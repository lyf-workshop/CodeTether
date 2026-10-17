// 首页、全部会话、待处理、项目、搜索。
const hq = (k) => new URLSearchParams(location.hash.split('?')[1] || '').get(k);

/* ---------- 需要你处理（Attention） ---------- */
// 三行：会话标题 / 要你做什么 / 在哪台电脑、哪个项目
function attnItem(a) {
  const c = conv(a.c), p = cProj(c);
  const v = {
    approval: { tile: 'warn', ic: 'shield', what: `<span class="nowrap">${agentName(c.agent)} 请求运行命令</span><span class="cmd trunc">${esc(a.cmd)}</span>`,
      acts: canApprove(c) ? `<button class="btn sm" onclick="decide('${a.id}','deny')">拒绝</button><button class="btn sm primary" onclick="decide('${a.id}','allow')">${I('check')}允许一次</button>`
        : `<a class="btn sm" href="#/c/${c.id}">打开会话</a>` },
    completed_review: { tile: 'info', ic: 'check', what: `<span class="trunc">${agentName(c.agent)} 已完成，等你查看</span>`, acts: `<a class="btn sm" href="#/c/${c.id}">查看结果</a>` },
    failed: { tile: 'err', ic: 'alert', what: `<span class="trunc">${esc(a.text)}</span>`, acts: `<a class="btn sm" href="#/c/${c.id}">查看</a>` },
  }[a.type];
  return `<div class="item attn" onclick="if(!event.target.closest('.btn'))go('#/c/${c.id}')"><span class="tile ${v.tile}">${I(v.ic)}</span>
    <div class="grow"><div class="t trunc" title="${esc(c.title)}">${esc(c.title)}</div><div class="what">${v.what}</div>
      <div class="sub">${pcIcon(cMach(c))}<span class="trunc">${esc(where(c))}</span><span class="faint">·</span>${I('folder')}<span class="trunc">${esc(p.name)}</span></div></div>
    <div class="end"><span class="when">${esc(a.at)}</span><span class="row" style="gap:6px">${v.acts}</span></div></div>`;
}
window.decide = (id, how) => {
  const a = D.attention.find((x) => x.id === id); a.open = false; a.decided = how;
  const c = conv(a.c); c.step = how === 'allow' ? '已允许，正在运行测试' : '已拒绝，等待 Codex 调整';
  render();
};

/* ---------- 正在运行卡片 ---------- */
function runCard(c) {
  const wait = !!pendingApproval(c), m = cMach(c);
  return `<a class="card click runcard ${wait ? 'wait' : ''}" href="#/c/${c.id}">
    <div class="row top">${ag(c.agent)}<span class="sp"></span>${isRO(c) ? `<span class="pill line">${I('eye')}仅查看</span>` : `<span class="faint small">${esc(c.elapsed || '')}</span>`}</div>
    <div class="t">${esc(c.title)}</div>
    <div class="step">${wait ? `<span class="status warn">${esc(c.step)}</span>` : `<span class="dot run"></span><span class="trunc">${esc(c.step)}</span>`}</div>
    <div class="foot">${pcIcon(m)}<span class="trunc">${esc(where(c))}</span><span>·</span>${I('folder')}<span class="trunc">${esc(cProj(c).name)}</span></div></a>`;
}

/* ---------- 首页 ---------- */
function pageHome() {
  const st = hq('state'), att = openAttn(), running = allConvs().filter((c) => c.status === 'running');
  const recent = allConvs().filter((c) => c.status !== 'running').slice(0, 5);
  const sub = st === 'empty' ? '从一个会话开始。' : st === 'loading' ? '正在读取各台电脑上的会话…' : [running.length && `${running.length} 个会话正在运行`, att.length && `${att.length} 件事需要你处理`].filter(Boolean).join('，') + '。';
  const head = `<div class="head"><div class="grow"><h1>下午好，${esc(D.account.name)}</h1><p>${sub}</p></div><button class="btn primary" onclick="openModal('new')">${I('plus')}新建会话</button></div>`;
  let body;
  if (st === 'loading') body = `<section class="sec"><div class="sec-h"><h2>需要你处理</h2></div>${skel(2)}</section>
    <section class="sec"><div class="sec-h"><h2>正在运行</h2></div><div class="grid3">${'<div class="card runcard"><div class="skel" style="width:40%"></div><div class="skel"></div><div class="skel" style="width:70%"></div></div>'.repeat(3)}</div></section>
    <section class="sec"><div class="sec-h"><h2>最近</h2></div>${skel(4)}</section>`;
  else if (st === 'empty') body = `<div class="card">${empty('sparkle', '开始第一个会话', '选择一台电脑和一个项目，让 Codex 或 Claude Code 开始工作。<br>以后在这里就能看到所有电脑上正在进行的工作。',
    `<button class="btn primary" onclick="openModal('new')">${I('plus')}新建会话</button><a class="btn" href="#/add">${I('plus')}添加电脑</a>`)}</div>`;
  else body = `${st === 'error' ? notice('warn', 'wifi_off', '暂时读不到 Studio Mac 上的会话', '其他电脑的会话已正常显示，恢复后会自动补上。', retry()) + '<div style="height:24px"></div>' : ''}
    ${att.length ? `<section class="sec"><div class="sec-h"><h2>需要你处理</h2><span class="n">${att.length}</span><a class="more" href="#/inbox">全部${I('chev')}</a></div><div class="list">${att.map((a) => attnItem(a)).join('')}</div></section>` : ''}
    <section class="sec"><div class="sec-h"><h2>正在运行</h2><span class="n">${running.length}</span></div><div class="grid3">${running.map(runCard).join('')}</div></section>
    <section class="sec"><div class="sec-h"><h2>最近</h2><a class="more" href="#/sessions">全部会话${I('chev')}</a></div><div class="list">${recent.map((c) => sessionItem(c)).join('')}</div></section>
    ${note('首页把各台电脑、各个项目的会话合并显示。基线中会话列表按项目读取，合并由前端完成；跨电脑聚合接口见 02 交接文档 D1。')}`;
  return { active: 'home', crumbs: crumbs('首页'), body: `<div class="page">${head}${body}</div>` };
}

/* ---------- 全部会话 ---------- */
function groups(list) {
  const g = [['已置顶', list.filter((c) => c.pinned)], ['今天', list.filter((c) => !c.pinned && c.ago < 720)], ['昨天', list.filter((c) => !c.pinned && c.ago >= 720 && c.ago < 2880)], ['更早', list.filter((c) => !c.pinned && c.ago >= 2880)]];
  return g.filter(([, xs]) => xs.length).map(([l, xs]) => `<div class="side-label" style="padding-left:4px">${l}</div><div class="list">${xs.map((c) => sessionItem(c, { noPin: true })).join('')}</div>`).join('');
}
function pageSessions() {
  const arch = hq('view') === 'archived', f = ui.f;
  const pcKey = (c) => (isRO(c) ? c.host : c.m);
  let list = arch ? D.conversations.filter((c) => c.archived) : allConvs();
  const counts = { all: list.length, running: list.filter((c) => c.status === 'running').length, waiting: list.filter((c) => c.status === 'waiting' || pendingApproval(c)).length,
    completed: list.filter((c) => c.status === 'completed').length, failed: list.filter((c) => c.status === 'failed').length };
  list = list.filter((c) => (f.status === 'all' || (f.status === 'waiting' ? c.status === 'waiting' || pendingApproval(c) : c.status === f.status))
    && (f.agent === 'all' || c.agent === f.agent) && (f.pc === 'all' || pcKey(c) === f.pc) && (!f.q || c.title.includes(f.q)));
  const sb = (k, l, n) => `<button aria-pressed="${f.status === k}" onclick="ui.f.status='${k}';render()">${l}${n != null ? `<span class="n">${n}</span>` : ''}</button>`;
  const opt = (id, n) => `<option value="${id}" ${f.pc === id ? 'selected' : ''}>${esc(n)}</option>`;
  const body = `<div class="page"><div class="head"><div class="grow"><h1>${arch ? '已归档' : '全部会话'}</h1><p>${arch ? '归档的会话不出现在首页和最近列表中，可以随时恢复。' : '所有电脑、所有项目里的会话，包括其他主机上你可以查看的会话。'}</p></div>
      <div class="seg"><a href="#/sessions" aria-pressed="${!arch}">进行中</a><a href="#/sessions?view=archived" aria-pressed="${arch}">已归档</a></div></div>
    <div class="toolbar"><label class="search" style="width:200px">${I('search')}<input id="q" class="input" placeholder="筛选标题" value="${esc(f.q)}" oninput="ui.f.q=this.value;render(true)"></label>
      ${arch ? '' : `<div class="seg">${sb('all', '全部', counts.all)}${sb('running', '运行中', counts.running)}${sb('waiting', '待查看', counts.waiting)}${sb('completed', '已完成', counts.completed)}${sb('failed', '失败', counts.failed)}</div>`}<span class="sp"></span>
      <div class="row" style="gap:var(--s3)"><select class="input" style="width:auto" aria-label="AI 工具" onchange="ui.f.agent=this.value;render()"><option value="all">所有 AI 工具</option><option value="codex" ${f.agent === 'codex' ? 'selected' : ''}>Codex</option><option value="claude" ${f.agent === 'claude' ? 'selected' : ''}>Claude Code</option></select>
      <select class="input" style="width:auto" aria-label="电脑" onchange="ui.f.pc=this.value;render()"><option value="all">所有电脑</option><optgroup label="我的电脑">${D.machines.map((m) => opt(m.id, m.name)).join('')}</optgroup><optgroup label="其他主机 · 仅查看">${D.hosts.filter((h) => h.access === 'authorized').map((h) => opt(h.id, h.name)).join('')}</optgroup></select></div></div>
    ${list.length ? (arch ? `<div class="list">${list.map((c) => sessionItem(c)).join('')}</div>` : groups(list)) : `<div class="card">${empty('search', '没有符合条件的会话', '换一个筛选条件试试。', `<button class="btn" onclick="ui.f={status:'all',agent:'all',pc:'all',q:''};render()">清除筛选</button>`)}</div>`}
    <p class="help" style="margin-top:16px">“筛选标题”只在已加载的列表中过滤。按内容搜索请用 Ctrl K，搜索范围是一个项目。</p></div>`;
  return { active: 'sessions', crumbs: arch ? crumbs(['全部会话', '#/sessions'], '已归档') : crumbs('全部会话'), body };
}

/* ---------- 待处理 ---------- */
function pageInbox() {
  const f = hq('f') || 'all', all = hq('f') === 'none' ? [] : openAttn();
  const list = f === 'all' || f === 'none' ? all : all.filter((a) => a.type === f);
  const n = (t) => all.filter((a) => a.type === t).length;
  const sb = (k, l, c) => `<a href="#/inbox${k === 'all' ? '' : `?f=${k}`}" aria-pressed="${f === k}">${l}<span class="n">${c}</span></a>`;
  const body = `<div class="page narrow"><div class="head"><div class="grow"><h1>待处理</h1><p>需要你批准、查看或处理失败的事情。处理完会自动消失。</p></div></div>
    ${all.length ? `<div class="toolbar"><div class="seg">${sb('all', '全部', all.length)}${sb('approval', '需要批准', n('approval'))}${sb('completed_review', '待查看', n('completed_review'))}${sb('failed', '失败', n('failed'))}</div></div>
      <div class="list">${list.map((a) => attnItem(a)).join('')}</div>
      <p class="help" style="margin-top:12px">只有这台电脑上的 Codex 会话可以在这里批准。其他电脑上的会话和 Claude Code 会话没有审批入口。</p>`
      : `<div class="card">${empty('check', '都处理完了', '需要批准的命令、已完成的工作和失败都会出现在这里。')}</div>`}</div>`;
  return { active: 'inbox', crumbs: crumbs('待处理'), body };
}

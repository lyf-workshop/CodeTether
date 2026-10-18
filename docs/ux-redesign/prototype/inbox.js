// 待处理（Attention）：需要批准的命令、已完成待查看、失败。

/* ---------- 一条待处理 ---------- */
// 三行：会话标题 / 要你做什么 / 在哪个项目、哪台电脑上的文件夹
function attnItem(a) {
  const c = conv(a.c), p = cProj(c);
  const ok = `<button class="btn sm ghost" onclick="resolveAttn('${a.id}')">知道了</button>`;
  const v = {
    approval: { tile: 'warn', ic: 'shield', what: `<span class="nowrap">${agentName(c.agent)} 请求运行命令</span><span class="cmd trunc">${esc(a.cmd)}</span>`,
      acts: canApprove(c) ? `<button class="btn sm" onclick="decide('${a.id}','deny')">拒绝</button><button class="btn sm primary" onclick="decide('${a.id}','allow')">${I('check')}允许一次</button>`
        : `<a class="btn sm" href="#/c/${c.id}">打开会话</a>` },
    completed_review: { tile: 'info', ic: 'check', what: `<span class="trunc">${agentName(c.agent)} 已完成，等你查看</span>`, acts: `${ok}<a class="btn sm" href="#/c/${c.id}">查看结果</a>` },
    failed: { tile: 'err', ic: 'alert', what: `<span class="trunc">${esc(a.text)}</span>`, acts: `${ok}<a class="btn sm" href="#/c/${c.id}">查看</a>` },
  }[a.type];
  return `<div class="item attn" onclick="if(!event.target.closest('.btn'))go('#/c/${c.id}')"><span class="tile ${v.tile}">${I(v.ic)}</span>
    <div class="grow"><div class="t trunc" title="${esc(c.title)}">${esc(c.title)}</div><div class="what">${v.what}</div>
      <div class="sub">${I('folder')}<span class="trunc">${esc(p.name)}</span><span class="faint">·</span>${pcIcon(cMach(c))}<span class="trunc">${esc(where(c))}</span></div></div>
    <div class="end"><span class="when">${esc(a.at)}</span><span class="row" style="gap:6px">${v.acts}</span></div></div>`;
}
// 审批结果交给 Codex 后这一轮继续运行
window.decide = (id, how) => {
  const a = D.attention.find((x) => x.id === id); a.open = false; a.decided = how;
  const c = conv(a.c); c.status = 'running'; c.step = how === 'allow' ? '已允许，正在运行测试' : '已拒绝，等待 Codex 调整';
  render();
};
// Host 的 resolve：只把这一条从待处理中移除，不改变会话
window.resolveAttn = (id) => { D.attention.find((a) => a.id === id).open = false; render(); };

/* ---------- 待处理 ---------- */
function pageInbox() {
  const f = hq('f') || 'all', all = hq('f') === 'none' ? [] : openAttn();
  const list = f === 'all' || f === 'none' ? all : all.filter((a) => a.type === f);
  const n = (t) => all.filter((a) => a.type === t).length;
  const sb = (k, l, c) => `<a href="#/inbox${k === 'all' ? '' : `?f=${k}`}" aria-pressed="${f === k}">${l}<span class="n">${c}</span></a>`;
  const body = `<div class="page narrow"><div class="head"><div class="grow"><h1>待处理</h1><p>需要你批准、查看或处理失败的事情。处理完会自动消失，也可以点“知道了”。</p></div></div>
    ${all.length ? `<div class="toolbar"><div class="seg">${sb('all', '全部', all.length)}${sb('approval', '等待批准', n('approval'))}${sb('completed_review', '待查看', n('completed_review'))}${sb('failed', '失败', n('failed'))}</div></div>
      <div class="list">${list.map((a) => attnItem(a)).join('')}</div>
      <p class="help" style="margin-top:12px">只有这台电脑上的 Codex 会话可以在这里批准。其他电脑上的会话和 Claude Code 会话没有审批入口。</p>`
      : `<div class="card">${empty('check', '都处理完了', '需要批准的命令、已完成的工作和失败都会出现在这里。')}</div>`}</div>`;
  return { active: 'inbox', crumbs: crumbs('待处理'), body };
}

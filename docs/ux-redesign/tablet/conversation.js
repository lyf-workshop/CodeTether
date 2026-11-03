// 会话页：时间线、审批卡、失败卡、输入框、变更面板
const TOOLIC = { file: 'file', edit: 'edit', terminal: 'terminal', search: 'search' };

function timeline(c) {
  const msgs = MSGS[c.id] || DEFAULT_MSGS;
  let h = '';
  for (const msg of msgs) {
    if (msg.imported) h += `<div class="ctx"><span class="tag">从 ${msg.imported} 导入</span><span>导入前的历史只读，可以接着对话</span></div>`;
    else if (msg.u) h += `<div class="msg user"><div class="bubble">${esc(msg.u)}</div></div>`;
    else h += `<div class="msg ai"><div class="who">${ag(c.agent)}</div><p>${esc(msg.a)}</p>${msg.tools ? `<div class="tools">${msg.tools.map(([k, l, t, r]) =>
      `<div class="tool">${I(TOOLIC[k], 'sm')}<span>${l}</span><code>${esc(t)}</code>${r ? `<span class="r ${r.startsWith('+') ? 'add' : ''}">${r}</span>` : ''}</div>`).join('')}</div>` : ''}</div>`;
  }
  const att = D.attention.find((a) => a.c === c.id && a.type === 'approval');
  if (c.status === 'waiting' && att) {
    const m = machineOfConv(c);
    h += `<div class="card approve"><h3>${I('shield', 'sm')}需要你批准：运行命令</h3><div class="meta">${m.name} · ${$p(c.p).name}</div><code class="cmd">${esc(att.cmd)}</code>
      <div class="acts"><button class="btn fill" data-flash="已允许一次（演示：先解锁平板）">允许一次</button><button class="btn gray" data-flash="已拒绝">拒绝</button></div></div>`;
  }
  if (c.status === 'failed') {
    const [why, next] = FAIL[c.failure];
    h += `<div class="card fail"><h3>${I('alert', 'sm')}${why}</h3><div class="meta">${next}</div>
      <div class="acts"><button class="btn tint" data-flash="已把上一条指令放进输入框，确认后再发送">重试</button><button class="btn plain" data-flash="演示：展开技术详情">技术详情</button></div></div>`;
  }
  if (c.status === 'running') h += `<div class="msg ai"><div class="who">${ag(c.agent)}<span class="spin"></span></div><p style="color:var(--text-2)">${c.step}……</p></div>`;
  return h;
}

function composer(c) {
  const m = machineOfConv(c);
  if (!reach(m)) return `<div class="cnote">${I('wifi_off', 'sm')}<span class="grow">${m.via ? `要等 ${$m(m.via).name} 上线才能发送` : `${m.name} 离线，上线后才能发送`}</span></div>`;
  if (c.status === 'waiting') return `<div class="cnote">${I('shield', 'sm')}<span class="grow">先处理上面的批准，这一轮结束后再发送</span></div>`;
  if (c.status === 'running') {
    const stop = canControl(c) ? `<button class="btn danger sm" data-flash="已请求停止（演示：先解锁平板）">${I('stop', 'sm')}停止</button>` : '<span style="font-size:13px;color:var(--text-3);padding-right:10px">这台设备上不能停止</span>';
    return `<div class="cnote"><span class="spin"></span><span class="grow">${c.step} · ${c.elapsed}</span>${stop}</div>`;
  }
  return `<div class="cbox"><textarea rows="1" placeholder="回复 ${AG[c.agent]}……"></textarea><button class="send" data-flash="演示：不会真的发送" aria-label="发送">${I('send', 'sm')}</button></div>
    <div class="hint">外接键盘：Ctrl Enter 发送</div>`;
}

function inspector(c, q) {
  if (!canControl(c)) return `<div class="inspector">${nav({ title: '变更', right: tb('x', '关闭', `data-go="#/c/${c.id}"`), lined: true, inner: true })}<div class="ibody"><div class="note" style="margin-top:14px">${I('info')}<span>${c.agent === 'claude' ? 'Claude Code 只读取和搜索文件，不修改文件，所以没有变更。' : '经由电脑访问的设备上还不能查看变更。'}</span></div></div></div>`;
  const sel = Number(q.f || 0), f = DIFF[sel];
  return `<div class="inspector">${nav({ title: '变更', sub: `${DIFF.length} 个文件 · +9 −3`, right: tb('x', '关闭', `data-go="#/c/${c.id}"`), lined: true, inner: true })}<div class="ibody">
    <div class="group" style="margin-top:14px">${DIFF.map((d, i) => `<button class="frow ${i === sel ? 'on' : ''}" data-go="#/c/${c.id}?panel=changes&f=${i}">${I('file', 'sm')}<code>${d.f.split('/').pop()}</code><span class="add">+${d.add}</span><span class="del">−${d.del}</span></button>`).join('')}</div>
    <div class="diff"><div class="h">${f.f}</div>${f.lines.map(([k, t]) => `<div class="l ${k}">${k === 'a' ? '+' : k === 'd' ? '−' : k === 'at' ? '' : ' '}${esc(t)}</div>`).join('')}</div></div></div>`;
}

function scrConv(id, q) {
  const c = $c(id);
  if (!c) return { sel: '', main: nav() + page(`<h1 class="large">找不到这个会话</h1><p class="lead">它可能已经被移除，或者属于一台已经不能访问的电脑。</p><a class="btn tint" href="#/home">回到最近的会话</a>`) };
  const p = $p(c.p), m = machineOfConv(c), panel = q.panel === 'changes';
  const sub = `${m.name} › ${p.name} · ${AG[c.agent]}${c.imported ? ' · 导入的会话' : ''}`;
  const right = `${tb('panel', '变更', `data-go="#/c/${id}${panel ? '' : '?panel=changes'}" ${panel ? 'class="tb on"' : ''}`)}${tb('more', '更多', 'data-menu="conv"')}`;
  const busy = c.status === 'running' || c.status === 'waiting';
  const menu = S.menu === 'conv' || q.menu === 'conv'
    ? `<div class="menu"><button data-flash="已置顶">${I('pin', 'sm')}${c.pinned ? '取消置顶' : '置顶'}</button><button data-sheet="rename:${id}">${I('edit', 'sm')}重命名</button>
       <button ${busy ? 'disabled' : `data-sheet="archive:${id}"`}>${I('archive', 'sm')}归档${busy ? '<small>运行中和等待批准时不能归档</small>' : ''}</button></div>` : '';
  const main = `<div class="conv-main">${nav({ title: esc(c.title), sub, right, lined: true })}${menu}
    <div class="timeline"><div class="inner"><div class="ctx">${tag(c.status)}<span>${c.at}</span></div>${timeline(c)}</div></div>
    <div class="composer"><div class="inner">${composer(c)}</div></div></div>`;
  return { sel: 'c:' + id, canvas: true, panel, main: `<div class="conv">${main}${panel ? inspector(c, q) : ''}</div>` };
}

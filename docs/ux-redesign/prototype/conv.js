// 会话页：消息流、审批卡、输入区四种状态、右侧面板。会话固定在一个项目（某台设备上的一个文件夹）和一个 AI 工具上。
// 只有这台电脑上的 Codex 会话报告文件差异（变更），其他会话只显示读取、编辑等步骤。
const U = (t, by = '') => `<div class="msg user">${by ? `<div class="by">${by}</div>` : ''}<div class="bubble">${t}</div></div>`;
const A = (c, inner) => `<div class="msg ai"><div class="who">${ag(c.agent, false)}<b>${agentName(c.agent)}</b></div>${inner}</div>`;
const T = (ic, t, st = 'done', r = '') => `<div class="toolcall ${st}">${st === 'live' ? '<span class="working mini"><i></i><i></i><i></i></span>' : I(ic)}<span class="trunc">${t}</span><span class="r">${r}</span>${st === 'done' ? I('check', 'ok') : ''}</div>`;
const DIFF = (file, add, del, lines) => `<div class="diff"><div class="fh">${I('file')}<span class="grow trunc">${file}</span><span class="plus">+${add}</span><span class="minus">−${del}</span></div>
  ${lines.map(([k, s]) => `<div class="ln ${k}">${k === 'add' ? '+' : k === 'del' ? '−' : ' '} ${esc(s)}</div>`).join('')}</div>`;
const WORK = (t) => `<div class="working"><i></i><i></i><i></i>${t}</div>`;
const PR = (...ps) => `<div class="prose">${ps.map((p) => (p.startsWith('<') ? p : `<p>${p}</p>`)).join('')}</div>`;
const extra = {}; // 原型中发送的消息

function approveCard(c, a) {
  const m = cMach(c), p = cProj(c);
  if (a.decided) return `<div class="toolcall"><span class="pill ${a.decided === 'allow' ? 'ok' : 'err'}">${a.decided === 'allow' ? '已允许' : '已拒绝'}</span><span class="cmd trunc">${esc(a.cmd)}</span></div>
    ${a.decided === 'allow' ? T('terminal', `运行 ${esc(a.cmd)}`, 'live') : A(c, PR('好的，我不运行测试。改动已经保存，你可以自己运行测试确认。'))}`;
  return `<div class="approve"><div class="ah">${I('shield')}Codex 请求运行命令</div><div class="ab"><div class="term">${esc(a.cmd)}</div>
    <div class="small faint">在${nm(m.name)}的 <span class="mono">${esc(p.path)}</span> 中运行</div></div>
    <div class="af"><span class="small faint">${esc(a.at)}</span><span class="sp"></span><button class="btn sm" onclick="decide('${a.id}','deny')">拒绝</button><button class="btn sm primary" onclick="decide('${a.id}','allow')">${I('check')}允许一次</button></div></div>`;
}
function script(c) {
  switch (c.id) {
    case 'c1': return U('会话列表在窗口变窄时，标题会把右边的状态和时间挤出去。帮我修一下，长标题应该截断。')
      + A(c, PR('我先看一下列表项的布局。') + T('search', '搜索 SessionItem', 'done', '3 个结果') + T('file', '读取 session-item.tsx') + T('file', '读取 session-list.css')
        + PR('原因是标题所在的 flex 子项缺少 <code>min-width: 0</code>，它的最小宽度等于整段标题，右侧的状态就被挤出去了。')
        + DIFF('apps/web/src/sessions/session-list.css', 3, 1, [['', '.session-row .title-col {'], ['del', '  flex: 1;'], ['add', '  flex: 1 1 auto;'], ['add', '  min-width: 0;'], ['', '}'], ['add', '.session-row .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }']])
        + PR('改好了。接下来运行这个包的测试，确认没有影响其他地方。'))
      + approveCard(c, D.attention.find((a) => a.id === 'a1'));
    case 'c8': return U('给 Webhook 重试加耗时统计：每次投递记录耗时，按商户汇总 P50 和 P95。')
      + A(c, PR('我在每次投递前后记录时间，按商户保留最近 200 次，用来计算 P50 和 P95。') + T('file', '读取 webhook-retry.ts') + T('search', '搜索 deliverWebhook', 'done', '5 个结果')
        + T('edit', '新增 latency-window.ts') + T('edit', '编辑 webhook-metrics.ts') + T('edit', '编辑 webhook-retry.ts', 'live'));
    case 'c2': return U('帮我评审一下 Webhook 重试的退避策略，先不要改代码。')
      + A(c, PR('我读了重试相关的代码。') + T('file', '读取 webhook-retry.ts') + T('file', '读取 backoff.ts') + T('search', '搜索 attempt', 'done', '6 个结果')
        + PR('有两个问题值得处理：', '<ul><li><b>收到 429 时没有使用对方返回的 Retry-After。</b>现在总是按自己的退避时间重试，可能早于对方要求的时间再次请求。建议优先等待 Retry-After 指定的时间。</li><li><b>重试次数没有上限。</b>商户长期不可用时会一直重试。建议最多重试 8 次，之后标记为失败并通知商户。</li></ul>',
          '其余部分（指数增长、随机抖动、幂等键）没有问题。按你的要求，这次只做了分析，没有改代码。'));
    case 'c3': return U('重构支付回调的签名校验，并补齐幂等键的边界测试。')
      + A(c, T('edit', '编辑 signature.ts') + T('edit', '新增 idempotency.test.ts') + T('terminal', '运行 pnpm test', 'done', '42 个通过')
        + PR('签名校验改为常量时间比较，并检查时间戳窗口。新增 6 个幂等键测试，覆盖重复请求、过期键和并发写入。全部 42 个测试通过。'));
    case 'c4': return U('分析评测流水线的显存峰值，找出占用最高的步骤。');
    case 'c5': return U('梳理一下 AI 工具安装检测的文档缺口。')
      + A(c, T('search', '搜索 provider-installation', 'done', '12 个结果') + T('file', '读取 docs/providers.md')
        + PR('文档缺三块内容：', '<ul><li>“已安装”和“可用”的区别。</li><li>健康状态要在工具实际运行过一次后才会显示。</li><li>多个安装路径同时存在时，选择的优先级。</li></ul>'));
    case 'c6': return U('升级 TanStack Router 并处理类型告警。') + A(c, T('edit', '编辑 8 个文件') + T('terminal', '运行 pnpm typecheck', 'done', '无告警') + PR('已升级，14 个类型告警全部处理完，构建通过。'));
    default: return c.fresh ? '' : U(esc(c.title));
  }
}
function pageConv(id) {
  const c = conv(id); if (!c) return null;
  const g = gate(c), m = cMach(c), p = cProj(c), panel = hq('panel');
  const href = (x) => `#/c/${id}${x ? `?panel=${x}` : ''}`;
  // 会话所在：设备 › 项目（悬停看完整路径）
  const head = `<div class="conv-head"><h1>${esc(c.title)}</h1><div class="ctx">
    <a class="cx" href="#/devices/${m.id}">${pcIcon(m)}${esc(m.name)}</a><span class="arrow">${I('chev')}</span><a class="cx" href="#/projects/${p.id}" title="${esc(p.path)}">${I('folder')}${esc(p.name)}</a>
    <span class="cx">${ag(c.agent, false)}${agentName(c.agent)}${c.reasoning ? ` · 推理 ${reasonName(c.reasoning)}` : ''}</span>${c.origin === 'adopted_native' ? `<span class="pill line">从 ${agentName(c.agent)} 导入</span>` : ''}</div></div>`;
  const rev = D.attention.find((a) => a.c === id && a.type === 'completed_review' && a.open);
  const pre = rev ? notice('info', 'check', `${agentName(c.agent)} 已完成，等你查看`, '看完后标记为已查看，它会从待处理中移除。', `<button class="btn sm" onclick="reviewed('${rev.id}')">标记为已查看</button>`) : '';
  const fail = c.status === 'failed' ? `<div class="failcard"><b>${I('alert')}这一轮没有开始</b><p class="small" style="margin-top:6px">${nm(m.name, false)}在发送前离线了，消息没有送达。设备恢复在线后可以重试。</p>${techErr('machine_offline', 'node · ' + m.name)}</div>` : '';
  const stream = `<div class="stream" id="stream"><div class="read">${head}${pre ? `<div class="col" style="gap:10px;margin-bottom:24px">${pre}</div>` : ''}${script(c)}${fail}${extra[id] || ''}${c.fresh && !extra[id] ? empty(c.agent === 'codex' ? 'codex' : 'claude', `告诉 ${agentName(c.agent)} 要做什么`, `它会在${nm(m.name)}的${nm(p.name)}中工作。`) : ''}</div></div>`;
  const body = `<div class="conv ${panel ? 'with-panel' : ''}"><div class="conv-main">${stream}<div class="dock"><div class="dock-in">${dock(c, g)}</div></div></div>${panel ? filePanel(c) : ''}</div>`;
  const actions = `${status(c)}<button class="btn ghost icon sm" title="${hasDiff(c) ? '变更、文件和工具输出' : '文件和工具输出'}" onclick="go('${href(panel ? '' : 'files')}')" ${panel ? 'aria-pressed="true"' : ''}>${I('panel')}</button><button class="btn ghost icon sm" title="更多" onclick="openModal('rename:${id}')">${I('more')}</button>`;
  return { active: 'devices', proj: c.p, current: id, crumbs: crumbs(...projCrumbs(p), c.title), actions, body, raw: true };
}
// 标记为已查看只关闭这条待处理（resolve attention），不改变会话状态
window.reviewed = (id) => { D.attention.find((a) => a.id === id).open = false; render(); };

/* ---------- 输入区：始终在同一位置 ---------- */
function dock(c, g) {
  const gt = (cls, tile, ic, b, s, acts = '') => `<div class="gate ${cls}"><span class="tile ${tile}">${ic}</span><div class="txt"><b>${b}</b><span>${s}</span></div>${acts}</div>`;
  if (g.kind === 'offline') { const d = devState(g.m); return gt('', '', I('wifi_off'), d.text === '离线' ? `${nm(g.m.name, false)}已离线` : esc(d.why), g.m.lastSeen ? `上次在线 ${esc(g.m.lastSeen)}。恢复后可以继续这个会话。` : '恢复后可以继续这个会话。', `${retry('重试连接')}<a class="btn sm ghost" href="#/devices/${g.m.id}">查看设备</a>`); }
  const stop = canInterrupt(c) ? `<button class="btn sm" onclick="this.innerHTML='正在停止…'">${I('stop')}停止</button>` : '';
  if (g.kind === 'wait') return gt('wait', 'warn', I('shield'), '等你批准一条命令', '批准或拒绝后，Codex 会继续。也可以停止这一轮。', stop);
  if (g.kind === 'busy') return gt('run', 'info', '<span class="working mini"><i></i><i></i><i></i></span>', `${agentName(c.agent)} 正在工作`, canInterrupt(c) ? '这一轮完成后可以发送下一条消息。' : `这一轮完成后可以发送下一条消息。${c.agent === 'claude' ? 'Claude Code 会话' : '在配对设备上运行的会话'}暂不支持停止。`, stop);
  return `<div class="composer"><textarea id="msg" rows="2" placeholder="继续和 ${agentName(c.agent)} 对话…" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendMsg('${c.id}')}"></textarea>
    <div class="bar"><span class="chipbtn static" title="${esc(cProj(c).path)}">${I('folder')}${esc(cProj(c).name)} · ${esc(cMach(c).name)}</span><span class="sp"></span><button class="send" title="发送（Enter）" onclick="sendMsg('${c.id}')">${I('send')}</button></div></div>
    <div class="hint">${c.agent === 'claude' ? 'Claude Code 在这里只读取和搜索文件，不会修改代码。' : 'Enter 发送，Shift Enter 换行'}</div>`;
}
window.sendMsg = (id) => {
  const t = $('#msg').value.trim(); if (!t) return; const c = conv(id);
  extra[id] = (extra[id] || '') + U(esc(t)) + A(c, WORK('正在思考…'));
  if (c.fresh) { c.fresh = false; c.title = t.slice(0, 28); }
  c.status = 'running'; c.step = '正在思考'; c.elapsed = '刚刚开始'; render();
};

/* ---------- 右侧面板：变更 / 文件 / 工具输出（inspector-panel.tsx） ---------- */
// “变更”只在报告文件差异的会话里出现：这台电脑上的 Codex。Claude Code 只用 Read、Glob、Grep，没有变更
const hasDiff = (c) => c.agent === 'codex' && cMach(c).kind === 'local';
function filePanel(c) {
  const tabs = [...(hasDiff(c) ? [['changes', '变更']] : []), ['files', '文件'], ['output', '工具输出']];
  const t = tabs.some(([k]) => k === hq('tab')) ? hq('tab') : tabs[0][0];
  const fr = (ic, n, r = '') => `<div class="frow">${I(ic)}<span class="trunc">${n}</span><span class="n">${r}</span></div>`;
  const help = (s) => `<p class="help" style="padding:12px 10px">${s}</p>`;
  const term = (s) => `<div class="term-block" style="margin:4px 6px;align-items:flex-start;white-space:pre-wrap;font-size:12px">${esc(s)}</div>`;
  const files = { c2: ['src/webhooks/webhook-retry.ts', 'src/webhooks/retry-after.ts'], c5: ['docs/providers.md', 'apps/host/src/provider-installation.ts'], c8: ['src/webhooks/webhook-retry.ts', 'src/webhooks/latency-window.ts', 'src/webhooks/webhook-metrics.ts'] }[c.id]
    || ['apps/web/src/sessions/session-item.tsx', 'apps/web/src/sessions/session-list.css', 'apps/web/src/sessions/session-list.test.tsx'];
  const out = c.agent === 'claude' ? 'Grep "attempt"  src/webhooks/\nsrc/webhooks/webhook-retry.ts:41\nsrc/webhooks/webhook-retry.ts:88\nsrc/webhooks/retry-after.ts:12'
    : c.id === 'c8' ? 'rg -n "deliverWebhook" src\n7 个结果' : 'rg -n "title-col" apps/web/src\napps/web/src/sessions/session-list.css:12\napps/web/src/sessions/session-item.tsx:48';
  const content = {
    changes: fr('file', 'session-list.css', '<span class="plus">+3</span> <span class="minus">−1</span>') + fr('file', 'session-item.tsx', '<span class="plus">+1</span>') + help('本轮共修改 2 个文件。'),
    files: files.map((f) => fr('file', esc(f))).join('') + (c.agent === 'claude' ? help('Claude Code 在这里只读取和搜索文件，所以没有“变更”。') : hasDiff(c) ? '' : help('在配对设备上运行的会话暂不报告文件差异，所以没有“变更”。')),
    output: term(out),
  }[t];
  return `<aside class="panel"><div class="panel-h"><div class="tabs grow">${tabs.map(([k, l]) => `<button class="tab" aria-selected="${k === t}" onclick="go('#/c/${c.id}?panel=files&tab=${k}')">${l}</button>`).join('')}</div>
    <button class="btn ghost icon sm" title="关闭" onclick="go('#/c/${c.id}')">${I('x')}</button></div><div class="panel-b">${content}</div></aside>`;
}

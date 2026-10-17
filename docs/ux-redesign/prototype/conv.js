// 会话页：消息流、审批卡、输入区五种状态、右侧文件面板。
const U = (t, by = '') => `<div class="msg user">${by ? `<div class="by">${by}</div>` : ''}<div class="bubble">${t}</div></div>`;
const A = (c, inner) => `<div class="msg ai"><div class="who">${ag(c.agent, false)}<b>${agentName(c.agent)}</b></div>${inner}</div>`;
const T = (ic, t, st = 'done', r = '') => `<div class="toolcall ${st}">${st === 'live' ? '<span class="working mini"><i></i><i></i><i></i></span>' : I(ic)}<span class="trunc">${t}</span><span class="r">${r}</span>${st === 'done' ? I('check', 'ok') : ''}</div>`;
const DIFF = (file, add, del, lines) => `<div class="diff"><div class="fh">${I('file')}<span class="grow trunc">${file}</span><span class="plus">+${add}</span><span class="minus">−${del}</span></div>
  ${lines.map(([k, s]) => `<div class="ln ${k}">${k === 'add' ? '+' : k === 'del' ? '−' : ' '} ${esc(s)}</div>`).join('')}</div>`;
const WORK = (t) => `<div class="working"><i></i><i></i><i></i>${t}</div>`;
const PR = (...ps) => `<div class="prose">${ps.map((p) => (p.startsWith('<') ? p : `<p>${p}</p>`)).join('')}</div>`;
const extra = {}; // 原型中发送的消息

function approveCard(c, a) {
  const m = cMach(c), loc = cProj(c).locations.find((l) => l.m === c.m);
  if (a.decided) return `<div class="toolcall"><span class="pill ${a.decided === 'allow' ? 'ok' : 'err'}">${a.decided === 'allow' ? '已允许' : '已拒绝'}</span><span class="cmd trunc">${esc(a.cmd)}</span></div>
    ${a.decided === 'allow' ? T('terminal', `运行 ${esc(a.cmd)}`, 'live') : A(c, PR('好的，我不运行测试。改动已经保存，你可以自己运行测试确认。'))}`;
  return `<div class="approve"><div class="ah">${I('shield')}Codex 请求运行命令</div><div class="ab"><div class="term">${esc(a.cmd)}</div>
    <div class="small faint">在${nm(m.name)}的 <span class="mono">${esc(loc.path)}</span> 中运行</div></div>
    <div class="af"><span class="small faint">${esc(a.at)}</span><span class="sp"></span><button class="btn sm" onclick="decide('${a.id}','deny')">拒绝</button><button class="btn sm primary" onclick="decide('${a.id}','allow')">${I('check')}允许一次</button></div></div>`;
}
function script(c) {
  const by = isRO(c) ? `${nm(host(c.host).name, false)}上的消息` : '';
  switch (c.id) {
    case 'c1': return U('会话列表在窗口变窄时，标题会把右边的状态和时间挤出去。帮我修一下，长标题应该截断。')
      + A(c, PR('我先看一下列表项的布局。') + T('search', '搜索 SessionItem', 'done', '3 个结果') + T('file', '读取 session-item.tsx') + T('file', '读取 session-list.css')
        + PR('原因是标题所在的 flex 子项缺少 <code>min-width: 0</code>，它的最小宽度等于整段标题，右侧的状态就被挤出去了。')
        + DIFF('apps/web/src/sessions/session-list.css', 3, 1, [['', '.session-row .title-col {'], ['del', '  flex: 1;'], ['add', '  flex: 1 1 auto;'], ['add', '  min-width: 0;'], ['', '}'], ['add', '.session-row .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }']])
        + PR('改好了。接下来运行这个包的测试，确认没有影响其他地方。'))
      + approveCard(c, D.attention.find((a) => a.id === 'a1'));
    case 'c8': return U('给 Relay 连接加一个往返延迟统计，在电脑详情的“连接”里显示最近一次和平均值。')
      + A(c, PR('我在心跳包上记录发送时间，收到回复时计算往返延迟，保留最近 20 次做滑动平均。') + T('file', '读取 relay-connection.ts') + T('search', '搜索 heartbeat', 'done', '7 个结果')
        + DIFF('packages/relay/src/relay-connection.ts', 9, 0, [['', 'export class RelayConnection {'], ['add', '  private rttSamples: number[] = [];'], ['add', '  lastRttMs: number | null = null;'], ['', '  private onPong(sentAt: number) {'], ['add', '    this.lastRttMs = Date.now() - sentAt;'], ['add', '    this.rttSamples = [...this.rttSamples, this.lastRttMs].slice(-20);']])
        + T('edit', '编辑 connection-facts.tsx', 'live'));
    case 'c2': return U('帮我评审一下 Relay 断线重连的退避策略，先不要改代码。')
      + A(c, PR('我读了重连相关的代码。') + T('file', '读取 reconnect.ts') + T('file', '读取 backoff.ts') + T('search', '搜索 retryCount', 'done', '4 个结果')
        + PR('有两个问题值得处理：', '<ul><li><b>重试计数在连接成功后没有清零。</b>短暂恢复后再次断线，会直接从 30 秒的上限开始等待。建议在 <code>onOpen</code> 里重置。</li><li><b>30 秒上限没有加随机抖动。</b>Relay 重启时，所有电脑会在同一时刻重连。建议加入 ±20% 的随机量。</li></ul>',
          '其余部分（指数增长、最大值、取消逻辑）没有问题。按你的要求，这次只做了分析，没有改代码。'));
    case 'c3': return U('重构支付回调的签名校验，并补齐幂等键的边界测试。')
      + A(c, T('edit', '编辑 signature.ts') + T('edit', '新增 idempotency.test.ts') + T('terminal', '运行 pnpm test', 'done', '42 个通过')
        + PR('签名校验改为常量时间比较，并检查时间戳窗口。新增 6 个幂等键测试，覆盖重复请求、过期键和并发写入。全部 42 个测试通过。'));
    case 'c4': return U('分析评测流水线的显存峰值，找出占用最高的步骤。');
    case 'c5': return U('梳理一下 AI 工具安装检测的文档缺口。')
      + A(c, T('search', '搜索 provider-installation', 'done', '12 个结果') + T('file', '读取 docs/providers.md')
        + PR('文档缺三块内容：', '<ul><li>“已安装”和“可用”的区别。</li><li>健康状态要在工具实际运行过一次后才会显示。</li><li>多个安装路径同时存在时，选择的优先级。</li></ul>'));
    case 'c6': return U('升级 TanStack Router 并处理类型告警。') + A(c, T('edit', '编辑 8 个文件') + T('terminal', '运行 pnpm typecheck', 'done', '无告警') + PR('已升级，14 个类型告警全部处理完，构建通过。'));
    case 'rc1': return U('把按钮组件迁移到新的 Token 体系。', by)
      + A(c, PR('我把颜色换成语义 Token（<code>--ct-ink</code>、<code>--ct-accent</code>），尺寸换成间距刻度。') + T('file', '读取 Button.tsx') + T('search', '搜索 #1d1c1a', 'done', '23 个结果')
        + DIFF('src/components/Button.tsx', 2, 2, [['del', "  background: '#1d1c1a',"], ['add', "  background: 'var(--ct-ink)',"], ['del', "  padding: '0 14px',"], ['add', "  padding: '0 var(--s4)',"]])
        + (hq('live') === 'disconnected' ? `<div class="faint small synced">${I('clock')}以上是 18:42 同步的内容</div>` : T('edit', '编辑 Button.tsx', 'live')));
    case 'rc2': return U('给训练流水线加断点续跑。', by) + A(c, PR('已完成。中断后会从最近一次保存的检查点继续。'));
    default: return c.fresh ? '' : U(esc(c.title));
  }
}
function pageConv(id) {
  const c = conv(id); if (!c) return null;
  const g = gate(c), ro = isRO(c), m = cMach(c), p = cProj(c), panel = hq('panel');
  const href = (x) => `#/c/${id}${x ? `?panel=${x}` : ''}`;
  const pcHref = ro ? `#/computers/${c.host}` : `#/computers/${c.m}`, pjHref = ro ? `#/computers/${c.host}` : `#/projects/${c.p}`;
  const head = `<div class="conv-head"><h1>${esc(c.title)}</h1><div class="ctx">
    <a class="cx" href="${pcHref}">${pcIcon(m)}${esc(where(c))}</a><span class="arrow">${I('chev')}</span><a class="cx" href="${pjHref}">${I('folder')}${esc(p.name)}</a>
    <span class="cx">${ag(c.agent, false)}${agentName(c.agent)}${c.agent === 'codex' ? ' · 默认模型' : ''}</span>${c.origin === 'adopted_native' ? '<span class="pill line">从 Claude Code 导入</span>' : ''}</div></div>`;
  const rev = D.attention.find((a) => a.c === id && a.type === 'completed_review' && a.open);
  const pre = [ro && hq('live') === 'disconnected' ? notice('warn', 'wifi_off', `与${nm(host(c.host).name)}的实时连接已断开`, '显示的是最后同步的内容。恢复后会自动更新。', retry('重新连接')) : '',
    rev ? notice('info', 'check', 'Claude Code 已完成评审', '看完后标记为已查看，它会从待处理中移除。', `<button class="btn sm" onclick="reviewed('${rev.id}')">标记为已查看</button>`) : ''].filter(Boolean).join('');
  const fail = c.status === 'failed' ? `<div class="failcard"><b>${I('alert')}这一轮没有开始</b><p class="small" style="margin-top:6px">${nm(m.name, false)}在发送前离线了，消息没有送达。电脑恢复在线后可以重试。</p>${techErr('machine_offline', 'node · ' + m.name)}</div>` : '';
  const stream = `<div class="stream" id="stream"><div class="read">${head}${pre ? `<div class="col" style="gap:10px;margin-bottom:24px">${pre}</div>` : ''}${script(c)}${fail}${extra[id] || ''}${c.fresh && !extra[id] ? empty(c.agent === 'codex' ? 'codex' : 'claude', `告诉 ${agentName(c.agent)} 要做什么`, `它会在${nm(m.name)}的${nm(p.name)}中工作。`) : ''}</div></div>`;
  const body = `<div class="conv ${panel ? 'with-panel' : ''}"><div class="conv-main">${stream}<div class="dock"><div class="dock-in">${dock(c, g)}</div></div></div>${panel ? filePanel(c, panel) : ''}</div>`;
  const stale = ro && hq('live') === 'disconnected';
  const actions = `${stale ? `<span class="status off" title="实时连接已断开">已断开 · 18:42</span>` : status(c)}<button class="btn ghost icon sm" title="文件与变更" onclick="go('${href(panel ? '' : 'files')}')" ${panel ? 'aria-pressed="true"' : ''}>${I('panel')}</button>${ro ? '' : `<button class="btn ghost icon sm" title="更多" onclick="openModal('rename:${id}')">${I('more')}</button>`}`;
  return { active: '', current: id, crumbs: crumbs([where(c), pcHref], [p.name, pjHref], c.title), actions, body, raw: true };
}
window.reviewed = (id) => { D.attention.find((a) => a.id === id).open = false; const c = conv(D.attention.find((a) => a.id === id).c); c.status = 'completed'; render(); };

/* ---------- 输入区：始终在同一位置 ---------- */
function dock(c, g) {
  const gt = (cls, tile, ic, b, s, acts = '') => `<div class="gate ${cls}"><span class="tile ${tile}">${ic}</span><div class="txt"><b>${b}</b><span>${s}</span></div>${acts}</div>`;
  if (g.kind === 'readonly') return gt('', '', I('eye'), `你对${nm(host(c.host).name)}只有查看权限`, '可以查看会话和进度。发送消息、审批或中断需要在那台电脑上进行。');
  if (g.kind === 'offline') return gt('', '', I('wifi_off'), `${nm(g.m.name, false)}已离线`, `上次在线 ${esc(g.m.lastSeen)}。重新上线后可以继续这个会话。`, `${retry('重试连接')}<a class="btn sm ghost" href="#/computers/${g.m.id}">查看电脑</a>`);
  const stop = canInterrupt(c) ? `<button class="btn sm" onclick="this.innerHTML='正在停止…'">${I('stop')}停止</button>` : '';
  if (g.kind === 'wait') return gt('wait', 'warn', I('shield'), '等你批准一条命令', '批准或拒绝后，Codex 会继续。也可以停止这一轮。', stop);
  if (g.kind === 'busy') return gt('run', 'info', '<span class="working mini"><i></i><i></i><i></i></span>', `${agentName(c.agent)} 正在工作`, canInterrupt(c) ? '这一轮完成后可以发送下一条消息。' : `这一轮完成后可以发送下一条消息。${c.agent === 'claude' ? 'Claude Code 会话' : '在其他电脑上运行的会话'}暂不支持停止。`, stop);
  return `<div class="composer"><textarea id="msg" rows="2" placeholder="继续和 ${agentName(c.agent)} 对话…" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendMsg('${c.id}')}"></textarea>
    <div class="bar"><span class="chipbtn">${I('folder')}${esc(cProj(c).name)}</span>${c.agent === 'codex' ? `<span class="chipbtn">${I('sparkle')}默认模型 · 推理 中</span>` : ''}<span class="sp"></span><button class="send" title="发送（Enter）" onclick="sendMsg('${c.id}')">${I('send')}</button></div></div>
    <div class="hint">${c.agent === 'claude' ? 'Claude Code 在这里只读取和搜索文件，不会修改代码。' : `在${nm(cMach(c).name)}上运行 · Enter 发送，Shift Enter 换行`}</div>`;
}
window.sendMsg = (id) => {
  const t = $('#msg').value.trim(); if (!t) return; const c = conv(id);
  extra[id] = (extra[id] || '') + U(esc(t)) + A(c, WORK('正在思考…'));
  if (c.fresh) { c.fresh = false; c.title = t.slice(0, 28); }
  c.status = 'running'; c.step = '正在思考'; c.elapsed = '刚刚开始'; render();
};

/* ---------- 右侧面板：文件 / 变更 / 工具输出 ---------- */
function filePanel(c, tab) {
  const cl = c.agent === 'claude', tabs = cl ? [['files', '文件']] : [['changes', '变更'], ['files', '文件'], ['output', '工具输出']];
  const t = cl ? 'files' : tab === 'files' && !hq('tab') ? 'changes' : hq('tab') || 'changes';
  const fr = (ic, n, r = '') => `<div class="frow">${I(ic)}<span class="trunc">${n}</span><span class="n">${r}</span></div>`;
  const content = {
    changes: fr('file', 'session-list.css', '<span class="plus">+3</span> <span class="minus">−1</span>') + fr('file', 'session-item.tsx', '<span class="plus">+1</span>') + `<p class="help" style="padding:12px 10px">本轮共修改 2 个文件。</p>`,
    files: fr('folder', 'apps/web/src/sessions') + fr('file', '  session-item.tsx') + fr('file', '  session-list.css') + fr('file', '  session-list.test.tsx') + fr('folder', 'packages/ui/src')
      + (cl ? `<p class="help" style="padding:12px 10px">Claude Code 只读取文件，这里没有变更和工具输出。</p>` : ''),
    output: `<div class="term-block" style="margin:4px 6px;align-items:flex-start;white-space:pre-wrap;font-size:12px">pnpm --filter @codetether/web test\n✓ 128 passed (3.4s)</div>`,
  }[t];
  return `<aside class="panel"><div class="panel-h"><div class="tabs grow">${tabs.map(([k, l]) => `<button class="tab" aria-selected="${k === t}" onclick="go('#/c/${c.id}?panel=files&tab=${k}')">${l}</button>`).join('')}</div>
    <button class="btn ghost icon sm" title="关闭" onclick="go('#/c/${c.id}')">${I('x')}</button></div><div class="panel-b">${content}</div></aside>`;
}

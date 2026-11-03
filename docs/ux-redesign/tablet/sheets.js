// 表单：新建会话、添加项目（选设备 › 浏览文件夹 › 名称 › 以前的会话）、重命名、归档、移除项目、移除电脑、输入配对码、搜索
const sheetNav = (title, ok = '', okAttr = '') =>
  `<div class="nav"><div class="left"><button class="tb txt" data-close>取消</button></div><div class="center"><b>${title}</b></div><div class="right">${ok ? `<button class="tb txt" style="font-weight:600" ${okAttr}>${ok}</button>` : ''}</div></div>`;
const sheet = (inner, wide) => `<div class="scrim" data-close-bg><div class="sheet ${wide ? 'wide' : ''}">${inner}</div></div>`;
const pickRow = (on, title, sub, attrs, disabled) =>
  `<button class="row" ${disabled ? 'disabled style="opacity:.5"' : attrs}><span class="t"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span>${on ? `<span style="color:var(--accent)">${I('check')}</span>` : ''}</button>`;

function shNew(arg) {
  // new:p-web 固定项目；new@m-win 预选这台设备上的第一个项目；new 预选最近用过的项目
  const fixed = arg && arg.startsWith(':') ? arg.slice(1) : null;
  const pre = fixed || (arg && arg.startsWith('@') ? projectsOf(arg.slice(1))[0]?.id : null) || S.newP || 'p-web';
  const p = $p(pre), m = $m(p.m), agent = S.newAgent || 'codex';
  let h = sheetNav('新建会话', '开始', 'data-flash="演示：会在电脑上创建会话并发出第一条消息"') + '<div class="sbody">';
  h += sec('项目') + `<div class="group">${fixed ? pickRow(true, p.name, `${m.name} · ${esc(p.path)}`)
    : D.projects.map((x) => pickRow(x.id === pre, x.name, `${$m(x.m).name}${reach($m(x.m)) ? '' : ' · 离线，现在不能新建'}`, `data-newp="${x.id}"`, !reach($m(x.m)))).join('')}</div>`;
  const tools = Object.entries(m.tools);
  h += sec('AI 工具') + `<div class="seg">${tools.map(([k, v]) => `<button class="${k === agent ? 'on' : ''}" ${v === 'ok' ? `data-agent="${k}"` : 'disabled style="opacity:.45"'}>${AG[k]}${v === 'ok' ? '' : v === 'login' ? '（要在电脑上登录）' : '（没有安装）'}</button>`).join('')}</div>`;
  if (agent === 'claude') h += sec('推理强度') + `<div class="seg"><button>低</button><button class="on">中</button><button>高</button></div>`;
  h += sec('第一条消息') + `<textarea class="field" rows="4" placeholder="想让 ${AG[agent]} 做什么？"></textarea>
    <div class="foot">${agent === 'claude' ? 'Claude Code 只读取和搜索文件，不修改文件、不执行命令。' : m.via ? `${m.name} 上的 Codex 只能对话，不能批准和停止。` : 'Codex 需要时会请你批准。'}</div>`;
  return sheet(h + '</div>');
}

function shAddProject(arg) {
  const [mid, step = 'folder'] = arg.split(':');
  const m = $m(mid);
  if (step === 'found') {
    return sheet(sheetNav('以前的会话', '导入所选', 'data-flash="已导入 3 个会话（演示）"') + `<div class="sbody">
      <div class="note info" style="margin-top:14px">${I('check')}<span>已添加 <b>landing-page</b>，在这个文件夹里找到 3 个以前的会话。导入不会启动 AI 工具。</span></div>
      <div class="group" style="margin-top:14px">${NATIVE.new.map((n) => `<button class="row" data-check="${n.id}"><span class="check ${S.picked[n.id] !== false ? 'on' : ''}">${I('check', 'sm')}</span><span class="t"><b>${n.title}</b><small>${ag(n.agent)} · ${n.at}</small></span></button>`).join('')}</div>
      <div style="margin-top:14px"><button class="btn plain" data-close>跳过</button></div></div>`, true);
  }
  if (step === 'name') {
    return sheet(sheetNav('添加项目', '添加', `data-sheet="addproj:${mid}:found"`) + `<div class="sbody">${sec('文件夹')}<div class="group"><div class="row"><span class="t"><b>landing-page</b><small>D:\\Projects\\Software\\landing-page</small></span></div></div>
      ${sec('名称')}<input class="field" value="landing-page"><div class="foot">项目就是 ${m.name} 上的这个文件夹。移除项目只取消登记，不删除文件。</div></div>`);
  }
  const f = FOLDERS;
  return sheet(sheetNav(`在 ${m.name} 上添加项目`) + `<div class="sbody"><div class="crumbs">${f.crumbs.map((c, i) => `${i ? '›' : ''}<a href="#">${c}</a>`).join(' ')}</div>
    <div class="group" style="margin-top:10px">${f.items.map((x) => x.project
      ? `<a class="row" href="#/projects/${x.project}"><span class="lead-ic">${I('folder', 'sm')}</span><span class="t"><b>${x.name}</b><small>已经是项目 ${$p(x.project).name}，点开直接打开</small></span><span class="r">${I('chev', 'sm')}</span></a>`
      : `<button class="row"><span class="lead-ic">${I('folder', 'sm')}</span><span class="t"><b>${x.name}</b></span>${x.name === f.pick ? `<span class="btn tint sm" data-sheet="addproj:${mid}:name">选这个文件夹</span>` : `<span class="r">${I('chev', 'sm')}</span>`}</button>`).join('')}</div>
    <div class="foot">只列文件夹名，不显示文件内容。点文件夹进入下一层。</div></div>`, true);
}

function shRename(id, isProject) {
  const name = isProject ? $p(id).name : $c(id).title;
  return sheet(sheetNav(isProject ? '重命名项目' : '重命名会话', '完成', 'data-flash="已重命名（演示）"') + `<div class="sbody"><div style="height:14px"></div><input class="field" value="${esc(name)}"></div>`);
}
function confirmSheet(title, body, okLabel, danger) {
  return sheet(`<div class="sbody" style="padding-top:22px;text-align:center"><h3 style="margin:0 0 8px;font-size:18px">${title}</h3><p class="lead" style="margin-bottom:18px">${body}</p>
    <div style="display:flex;gap:10px;justify-content:center"><button class="btn gray" data-close>取消</button>${okLabel ? `<button class="btn ${danger ? 'danger' : 'fill'}" data-flash="演示：没有真的执行">${okLabel}</button>` : ''}</div></div>`);
}
function shRmProject(id) {
  const p = $p(id), n = convsOf(id, true).length;
  if (n) return confirmSheet(`不能移除 ${p.name}`, `这个项目还有 ${n} 个会话（包括已归档的）。现在还不能删除会话，所以有会话的项目不能移除。`, '');
  return confirmSheet(`移除 ${p.name}？`, '只取消登记，不删除电脑上的文件。', '移除', true);
}
function shUnpair(id) {
  const m = $m(id), via = D.machines.filter((x) => x.via === id).map((x) => x.name);
  return confirmSheet(`移除 ${m.name}？`, `这台平板会立刻断开 ${m.name}${via.length ? `，经由它访问的 ${via.join('、')} 也会一起断开` : ''}。电脑上正在运行的工作不受影响。要再用，需要在那台电脑上生成新的配对码。`, '移除', true);
}
function shPair() {
  return sheet(sheetNav('添加电脑', '连接', 'data-flash="演示：已连接"') + `<div class="sbody"><p class="lead" style="margin-top:14px">在那台电脑上的 CodeTether 里打开 设备 › 添加设备 › 添加手机或平板，输入屏幕上的 6 位配对码。</p>${code6('')}<p class="foot" style="text-align:center">那台电脑要登录同一个账号。</p></div>`);
}
function shSearch() {
  const hits = D.conversations.filter((c) => !c.archived).slice(0, 6);
  return sheet(`<div class="sbody" style="padding-top:16px"><div style="display:flex;gap:10px;align-items:center"><div class="side-search" style="margin:0;flex:1;width:auto">${I('search', 'sm')}按标题找会话</div><button class="btn plain" data-close>取消</button></div>
    ${sec('最近')}<div class="group">${hits.map((c) => convRow(c, true)).join('')}</div><div class="foot">在已读取的会话里按标题找。项目里的内容搜索在项目页。</div></div>`, true);
}
function renderSheet(s) {
  if (!s) return '';
  const [k, ...rest] = s.split(':'), a = rest.join(':');
  if (s.startsWith('new')) return shNew(s.slice(3));
  return ({ addproj: () => shAddProject(a), rename: () => shRename(a), 'rename-p': () => shRename(a, true), archive: () => confirmSheet('归档这个会话？', '归档后在项目的“已归档”里，可以随时恢复。', '归档'),
    rmproj: () => shRmProject(a), unpair: () => shUnpair(a), pair: shPair, search: shSearch }[k] || (() => ''))();
}

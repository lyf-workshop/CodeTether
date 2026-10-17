// 设置、首次启动、后续规划。
function pageSettings(sec) {
  sec = sec || 'appearance';
  // 第四项是手机宽度下标签栏的短名称
  const nav = [['appearance', 'sun', '外观', '外观'], ['account', 'user', '账号与共享', '账号'], ['notify', 'bell', '通知', '通知'], ['background', 'power', '后台运行', '后台'], ['about', 'info', '关于与检查', '关于']];
  const row = (l, d, r) => `<div class="set-row"><div class="l"><b>${l}</b>${d ? `<span>${d}</span>` : ''}</div>${r}</div>`;
  const sw = (on, dis = false) => `<button class="switch" role="switch" aria-checked="${on}" ${dis ? 'disabled' : ''} onclick="this.setAttribute('aria-checked',this.getAttribute('aria-checked')!=='true')"></button>`;
  const mini = (t) => `<span class="mini" data-theme="${t}"><span class="s"><i></i><i></i><i></i></span><span class="c"><i></i><i class="a"></i><i></i></span></span>`;
  const tile = (t, l, pv) => `<button class="theme" aria-pressed="${ui.theme === t}" onclick="setTheme('${t}')"><span class="pv">${pv}</span><span>${l}${ui.theme === t ? I('check') : ''}</span></button>`;
  const out = hq('account') === 'out' || !D.account.signedIn, hs = hq('host') || D.account.localHost, reqs = D.accessRequests.filter((r) => r.open);
  const content = {
    appearance: `<h2>外观</h2><div class="set-group"><div class="set-row" style="display:block"><div class="l" style="margin-bottom:14px"><b>主题</b><span>默认浅色。选择“跟随系统”会随系统的深浅色设置切换。</span></div>
      <div class="themes">${tile('light', '浅色', mini('light'))}${tile('dark', '深色', mini('dark'))}${tile('system', '跟随系统', `<span class="pv-split">${mini('light')}${mini('dark')}</span>`)}</div></div>
      ${row('语言', '目前只提供简体中文。', '<span class="muted">简体中文</span>')}</div>
      ${note('主题切换是新增的前端能力：当前产品固定 data-theme="dark"。浅色与深色两套 Token 见 tokens.css，实现前需要确认范围。')}`,
    account: out ? `<h2>账号与共享</h2><div class="set-group">${row('未登录', '这台电脑和配对的服务器不需要账号。登录后可以查看同一账号下的其他电脑，或允许它们查看这台电脑。', `<a class="btn primary" href="#/signin">登录</a>`)}</div>`
      : `<h2>账号与共享</h2><div class="set-group"><div class="set-row"><span class="avatar" style="width:40px;height:40px;font-size:16px">${esc(D.account.name)}</span><div class="l"><b>${esc(D.account.email)}</b><span>邮箱登录码登录</span></div><button class="btn">${I('logout')}退出登录</button></div></div>
      <h2>这台电脑</h2><div class="set-group">${row('允许其他电脑查看这台电脑', '同一账号下的其他电脑可以申请查看这里的会话和进度。每个申请都需要你在这里批准，对方不能发送消息、审批或中断。', sw(hs !== 'disabled'))}
        ${hs === 'enabled_unclaimed' ? `<div class="set-row fill">${notice('warn', 'alert', '设置还没有完成', '这台电脑还没有登记到你的账号，其他电脑暂时找不到它。', `<button class="btn sm primary">完成设置</button>`)}</div>` : ''}
        ${hs === 'claimed' ? reqs.map((r) => row(`${esc(r.device)} 想查看这台电脑`, `${esc(r.platform)} · ${esc(r.expires)}<br><span class="mono">${esc(r.fp)}</span>`, `<div class="row"><button class="btn sm" onclick="reqDone('${r.id}')">拒绝</button><button class="btn sm primary" onclick="reqDone('${r.id}')">允许</button></div>`)).join('')
          || row('访问申请', '没有等待处理的申请。', '') : ''}</div>
      <p class="set-cap">已批准的设备暂时不能在这里撤销，见<a href="#/roadmap">后续规划</a>。</p>`,
    notify: `<h2>通知</h2><div class="set-group">${row('需要批准', 'Codex 请求运行命令或修改文件时提醒。', sw(true))}${row('工作完成', '一轮工作完成、等你查看时提醒。', sw(true))}${row('执行失败', '一轮工作失败时提醒。', sw(true))}</div>
      <p class="set-cap">通知中不包含会话标题。只有桌面版 CodeTether 提供系统通知，浏览器中请查看“待处理”。</p>`,
    background: `<h2>后台运行</h2><div class="set-group">${row('关闭窗口后继续运行', `关闭窗口（${ui.os === 'mac' ? '⌘ W' : '✕ 或 Alt F4'}）后，CodeTether 会留在${ui.os === 'mac' ? '菜单栏' : '系统托盘'}，正在进行的工作、审批和通知不会中断。`, '<span class="pill line">始终开启</span>')}
      ${row('打开或退出', `从${ui.os === 'mac' ? '菜单栏' : '托盘'}图标选择“打开 CodeTether”恢复窗口，选择“退出 CodeTether”结束全部工作。`, '')}${row('开机自动启动', '目前还不支持，需要时请手动打开 CodeTether。', '<a class="btn sm ghost" href="#/roadmap">查看后续规划</a>')}</div>`,
    about: `<h2>关于与检查</h2><div class="set-group"><div class="set-row"><span class="mark" style="width:40px;height:40px;border-radius:11px">${MARK_SVG}</span><div class="l"><b>CodeTether</b><span>简体中文 · Host 127.0.0.1:4317 · 协议 v1</span></div><a class="btn" href="#/onboarding">重新运行设置</a></div></div>
      <div class="row" style="margin:-4px 0 12px"><h2 class="grow" style="margin:0">状态检查</h2><button class="btn sm" onclick="this.innerHTML='正在检查…'">${I('refresh')}重新检查</button></div>
      <div class="set-group">${[['这台电脑', 'Windows 11 · x64 · 应用服务运行中', 'ok', '正常'], ['Codex', '本机安装已验证', 'ok', '可用'], ['Claude Code', '已安装，还没有运行记录', 'off', '尚未观察'], ['MacBook Pro', '经 Relay 连接', 'ok', '在线'], ['build-server', '上次已知 · 2 小时前', 'off', '离线']]
        .map(([l, d, k, t]) => row(l, d, `<span class="status ${k}">${t}</span>`)).join('')}</div>
      <details class="tech"><summary>诊断代码</summary><pre>host: ready · relay: connected · node presence: offline(build-server)</pre></details>`,
  }[sec];
  if (!content) return null;
  const body = `<div class="settings"><nav class="col" style="gap:2px"><h1>设置</h1>${nav.map(([k, ic, l]) => `<a class="nav-item" href="#/settings/${k}" ${sec === k ? 'aria-current="page"' : ''}>${I(ic)}${l}</a>`).join('')}
      <a class="nav-item" href="#/roadmap" style="margin-top:12px">${I('map')}<span class="faint">后续规划</span></a></nav>
    <section><div class="seg set-tabs">${nav.map(([k, , , l]) => `<a href="#/settings/${k}" aria-pressed="${sec === k}">${l}</a>`).join('')}</div>${content}</section></div>`;
  return { active: 'settings', crumbs: crumbs(['设置', '#/settings/appearance'], nav.find((n) => n[0] === sec)[2]), body };
}

/* ---------- 首次启动（无侧栏窗口） ---------- */
function pageOnboarding() {
  const order = ['welcome', 'tools', 'project', 'previous', 'remote', 'ready'], step = order.includes(hq('step')) ? hq('step') : 'welcome', i = order.indexOf(step);
  const nx = `#/onboarding?step=${order[i + 1]}`, back = i ? `<a class="btn ghost" href="#/onboarding?step=${order[i - 1]}">上一步</a>` : '';
  const foot = (main, alt = '') => `<div class="foot">${back}<span class="sp"></span>${alt}${main}</div>`;
  const feat = (ic, t, d) => `<div class="feat"><span class="glyph sm">${I(ic)}</span><div><b>${t}</b><span>${d}</span></div></div>`;
  const opt = (href, ic, t, d, pill) => `<a class="card click pad row" style="gap:14px" href="${href}"><span class="glyph">${I(ic)}</span><div class="grow"><b>${t}</b><p class="help" style="margin-top:2px">${d}</p></div>${pill}<span class="faint">${I('chev')}</span></a>`;
  const v = {
    welcome: `<span class="mark xl">${MARK_SVG}</span><h1 style="margin-top:24px">你的 AI 编程助手，<br>在每台电脑上都能接着用</h1><p class="lead">CodeTether 把 Codex 和 Claude Code 的会话集中到一个地方，换一台电脑也能看到进度。</p>
      <div style="margin-top:28px">${feat('monitor', '在这台电脑上工作', '用 Codex 或 Claude Code 处理你的项目。')}${feat('server', '连接你的其他电脑', '配对的服务器可以继续工作，其他电脑可以查看。')}${feat('inbox', '需要你的时候提醒你', '需要批准的命令、完成和失败都集中在“待处理”。')}</div>
      ${foot(`<a class="btn primary lg" href="${nx}">开始设置${I('arrowr')}</a>`, '<span class="help" style="margin-right:8px">大约 1 分钟 · 在这台电脑上使用不需要账号</span>')}`,
    tools: `<h1>检查 AI 工具</h1><p class="lead">CodeTether 使用这台电脑上已经安装的工具。</p><div class="list" style="margin-top:28px">
      <div class="item static">${ag('codex', false, 'lg')}<div class="grow"><div class="t">Codex</div><div class="sub">已安装</div></div><span class="status ok">可用</span></div>
      <div class="item static">${ag('claude', false, 'lg')}<div class="grow"><div class="t">Claude Code</div><div class="sub">已安装，需要先在终端登录</div></div><span class="status warn">需要登录</span><a class="btn sm" href="#/onboarding?step=tools">查看登录说明</a></div></div>
      ${foot(`<a class="btn primary lg" href="${nx}">继续</a>`, `<button class="btn ghost" onclick="this.innerHTML='正在检查…'">${I('refresh')}重新检查</button>`)}`,
    project: `<h1>选择一个项目</h1><p class="lead">Codex 和 Claude Code 只会在你选择的文件夹里工作。</p><div class="card pad row" style="margin-top:28px;gap:14px"><span class="glyph">${I('folder')}</span><div class="grow"><b>agenthub</b><p class="help mono trunc">D:\\Projects\\Software\\agenthub</p></div><span class="pill ok">${I('check')}已选择</span><button class="btn sm ghost">更换</button></div>
      ${foot(`<a class="btn primary lg" href="${nx}">继续</a>`)}`,
    previous: `<h1>继续以前的会话</h1><p class="lead">在 agenthub 中找到 3 个以前的会话。导入后可以在 CodeTether 中继续。</p><div class="list" style="margin-top:28px">
      ${[['codex', '重构登录模块', '3 天前', 1], ['claude', '整理 README', '上周', 1], ['codex', '修复 CI', '已导入', 0]].map(([a, t, w, can]) => `<label class="item ${can ? '' : 'static'}"><input type="checkbox" class="check" ${can ? 'checked' : 'checked disabled'}>${ag(a, false)}<div class="grow"><div class="t">${t}</div><div class="sub">${agentName(a)} · ${w}</div></div></label>`).join('')}</div>
      ${foot(`<a class="btn primary lg" href="${nx}">导入 2 个会话</a>`, `<a class="btn ghost" href="${nx}">跳过</a>`)}`,
    remote: `<h1>还有其他电脑吗？</h1><p class="lead">可选。以后也可以在“我的电脑”里添加。</p><div class="col" style="margin-top:28px;gap:10px">
      ${opt('#/add/desktop', 'laptop', 'Mac 或 Windows 电脑', '登录同一个账号，申请查看', `<span class="pill line">${I('eye')}仅查看</span>`)}${opt('#/add/node?step=1', 'server', '服务器（CodeTether Node）', '运行一条命令，输入配对码', `<span class="pill ok">${I('check')}可以继续工作</span>`)}</div>
      ${foot(`<a class="btn primary lg" href="${nx}">以后再说</a>`)}`,
    ready: `<span class="glyph xl ok">${I('check')}</span><h1 style="margin-top:24px">一切就绪</h1><p class="lead">从“新建会话”开始，或者打开刚导入的会话。</p>
      <div style="margin-top:28px">${feat('edit', '新建会话', '按 Ctrl N，选择电脑、项目和 AI 工具。')}${feat('search', '快速跳转', '按 Ctrl K 搜索会话、电脑和项目。')}</div>${foot(`<a class="btn primary lg" href="#/home">打开 CodeTether</a>`)}`,
  }[step];
  const body = `<div class="window bare os-${ui.os}"><span class="traffic"><i></i><i></i><i></i></span><header class="bare-top"><span class="demo-pill">演示数据</span>${WINCTL}</header>
    <div class="onb"><div class="onb-in"><div class="progress">${order.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div>${v}</div></div></div>`;
  return { bare: true, body };
}

/* ---------- 后续规划：与当前功能分开 ---------- */
function pageRoadmap() {
  const it = (t, d, dep, part) => `<div class="card pad col" style="gap:8px"><div class="row"><b class="grow">${t}</b><span class="pill ${part ? 'warn' : 'line'}">${part ? '部分实现' : '尚未实现'}</span></div><p class="muted small">${d}</p><p class="dep"><b>设计注释</b>依赖：${dep}</p></div>`;
  const body = `<div class="page"><div class="head"><div class="grow"><h1>后续规划</h1><p>远程控制和其他尚未提供的能力。</p></div></div>
    ${notice('info', 'map', '这些功能还在规划中', '以下是后续可能提供的能力，目前还不能使用，也没有确定的时间。')}
    <section class="sec" style="margin-top:24px"><div class="grid2">${it('控制其他主机（发送、新建会话）', '申请“查看并控制”，批准后远程会话显示输入框。', 'supervisor_control 已在协议与 Host 中定义，但账号服务只签发 supervisor_read，也没有批准入口', 1)}
      ${it('撤销已授权的设备', '在“账号与共享”中撤销某台设备，对方立即失去查看权限。', '账号服务撤销接口与界面')}
      ${it('访问申请通知', '收到访问申请时发送系统通知，并进入“待处理”。', '新的 Attention 类型；当前只在“我的电脑”中显示')}
      ${it('远程停止', '在其他电脑上运行的会话也可以停止。', 'Node 执行与 supervisor 协议都没有 interrupt')}
      ${it('远程审批', '远程会话中显示审批卡，并同步到“待处理”。', 'Node 执行固定不审批；supervisor 协议没有审批操作')}
      ${it('删除会话', '永久删除已归档的会话；删完后可以移除对应的项目或文件夹。', 'Host 没有删除会话的接口；仍有会话的项目和文件夹不能移除')}
      ${it('运行中排队、补充指令', '运行时可以追加下一条消息。', 'ProviderDescriptor 没有对应能力；AGENTS.md 明确不做排队和插话')}
      ${it('全局会话与跨项目搜索', '首页一次取得所有电脑的会话；搜索不限项目。', 'Host 聚合列表与跨项目搜索接口')}
      ${it('Claude Code 编辑、终端与变更', '变更面板对 Claude Code 开放。', 'Provider 能力扩展（明确延后）')}
      ${it('开机启动、托盘快捷入口', '在设置中提供开关和常用入口。', 'Tauri autostart 插件')}</div></section>
    <section class="sec"><div class="sec-h"><h2>远程控制示意</h2><span class="pill line">仅示意</span></div><div class="card pad col" style="max-width:740px;gap:14px">
      <div class="approve"><div class="ah">${I('shield')}MacBook Pro 请求批准：运行命令</div><div class="ab"><div class="term">pnpm test</div></div><div class="af"><span class="sp"></span><button class="btn sm" disabled>拒绝</button><button class="btn sm primary" disabled>允许一次</button></div></div>
      <div class="gate run"><span class="tile info"><span class="working mini"><i></i><i></i><i></i></span></span><div class="txt"><b>Codex 正在 MacBook Pro 上工作</b><span>可以停止，或补充下一条指令。</span></div><button class="btn sm" disabled>${I('stop')}停止</button></div></div></section>
    ${note('这一页只是方向示意，不属于当前版本，本轮前端重构不要实现。')}</div>`;
  return { active: '', crumbs: crumbs('后续规划'), body };
}

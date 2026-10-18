// 添加电脑（两条路径分开）与登录。
function pageAdd() {
  const opt = (href, ic, t, d, pills) => `<a class="card click pad col" style="gap:14px;color:inherit" href="${href}"><span class="glyph">${I(ic)}</span>
    <div><b style="font-size:var(--fs-lg)">${t}</b><p class="muted" style="margin-top:6px">${d}</p></div><div class="row wrap" style="gap:6px;margin-top:auto">${pills}</div></a>`;
  const body = `<div class="page narrow"><div class="head"><div class="grow"><h1>添加电脑</h1><p>那台电脑是什么类型？</p></div></div>
    <div class="grid2">${opt('#/add/desktop', 'laptop', 'Mac 或 Windows 电脑', '在那台电脑上安装 CodeTether，用同一个账号登录，然后申请查看。', `<span class="pill line">${I('eye')}仅查看</span><span class="pill line">${I('user')}需要账号</span>`)}
      ${opt('#/add/node?step=1', 'server', '服务器（CodeTether Node）', '适合 Linux 服务器。运行一条命令，输入它显示的配对码。', `<span class="pill ok">${I('check')}可以继续工作</span><span class="pill line">不需要账号</span>`)}</div>
    ${note('两条路径的结果不同：账号授权只有查看权限（supervisor_read）；Node 配对成为本机主机下的一台电脑，可以发送消息和新建会话。')}</div>`;
  return { active: 'computers', crumbs: crumbs(['我的电脑', '#/computers'], '添加电脑'), body };
}
function pageAddDesktop() {
  const li = (t, d) => `<li><span class="num"></span><div><b>${t}</b><p class="help" style="margin-top:4px">${d}</p></div></li>`;
  const can = (ok, t) => `<div class="row" style="padding:6px 0">${ok ? `<span class="tile ok" style="width:22px;height:22px;border-radius:6px">${I('check')}</span>` : `<span class="tile" style="width:22px;height:22px;border-radius:6px">${I('x')}</span>`}<span class="${ok ? '' : 'faint'}">${t}</span></div>`;
  const body = `<div class="page"><div class="head"><div class="grow"><h1>添加 Mac 或 Windows 电脑</h1><p>大约需要 2 分钟。不需要命令行或配对码。</p></div></div>
    <div class="split"><div class="card pad"><ol class="vsteps num-auto">${li('在那台电脑上安装 CodeTether', '下载并安装正式版本。')}${li('用同一个账号登录', `在那台电脑上打开 设置 › 账号，登录 ${esc(D.account.email)}。`)}
      ${li('允许其他电脑查看', '在那台电脑的 设置 › 账号 中打开“允许其他电脑查看这台电脑”。')}${li('回到这里申请查看', '它会出现在“我的电脑”里。点“申请查看”，在那台电脑上批准。')}</ol>
      <div class="row" style="margin-top:4px">${D.account.signedIn ? `<a class="btn primary" href="#/computers?scroll=more">${I('arrowr')}去申请查看</a>` : `<a class="btn primary" href="#/signin">登录</a>`}<a class="btn ghost" href="#/add">返回</a></div></div>
      <div class="card pad"><b>批准后你可以</b><div style="margin-top:10px">${can(true, '查看那台电脑上的会话和进度')}${can(true, '查看它的电脑和项目')}${can(false, '发送消息、新建会话')}${can(false, '审批命令、中断运行')}</div>
        <p class="help" style="margin-top:12px">需要在那台电脑上继续工作？请在那台电脑上操作，或改用 Node 配对。</p></div></div></div>`;
  return { active: 'computers', crumbs: crumbs(['我的电脑', '#/computers'], ['添加电脑', '#/add'], 'Mac 或 Windows'), body };
}
function pageAddNode() {
  const step = +(hq('step') || 1), names = ['运行命令', '输入配对码', '核对验证码', '完成'];
  const bar = `<div class="steps">${names.map((n, i) => `${i ? '<span class="bar"></span>' : ''}<span class="st ${i + 1 === step ? 'on' : i + 1 < step ? 'done' : ''}"><i>${i + 1 < step ? I('check') : i + 1}</i>${n}</span>`).join('')}</div>`;
  const nav = (back, next, label) => `<div class="row" style="margin-top:24px">${back ? `<a class="btn ghost" href="${back}">上一步</a>` : ''}<span class="sp"></span><a class="btn primary" href="${next}">${label}</a></div>`;
  const term = (cmd) => `<div class="term-block"><span class="grow">${cmd}</span><button class="btn sm" onclick="this.innerHTML='已复制'">${I('copy')}复制</button></div>`;
  const panel = {
    1: `<b style="font-size:var(--fs-lg)">在服务器的终端里运行</b><p class="muted" style="margin:6px 0 16px">需要先安装 CodeTether Node（Linux x64 / arm64、macOS arm64）。</p>${term('codetether-node --pair')}
      <p class="help" style="margin-top:10px">命令会显示一个地址（或 <span class="mono">codetether-pairing://</span> 链接）和 6 位配对码，几分钟内有效。</p>
      <details class="tech" style="margin-top:20px"><summary>需要长期在线？</summary><div style="margin-top:10px">${term('codetether-node service install')}<p class="help" style="margin-top:8px">配对后安装为 systemd 用户服务，开机后自动运行。</p></div></details>
      ${nav('', '#/add/node?step=2', '已显示配对码，下一步')}`,
    2: `<div class="col" style="gap:18px"><label class="field">地址或配对链接<input class="input mono" value="10.0.0.12:4318"><span class="help">局域网地址，或 Node 显示的 <span class="mono">codetether-pairing://relay/v1?…</span> 链接（通过 Relay）。</span></label>
      <label class="field">6 位配对码<input class="input code" value="482731" maxlength="6" inputmode="numeric"></label></div>${nav('#/add/node?step=1', '#/add/node?step=3', '连接')}`,
    3: `<b style="font-size:var(--fs-lg)">确认是你的服务器</b><p class="muted" style="margin:6px 0 16px">服务器终端里显示的验证码和这里一致时再确认。不一致请取消。</p><div class="bigcode">391 044</div>
      <dl class="facts" style="margin-top:18px"><dt>名称</dt><dd>dev-box</dd><dt>系统</dt><dd>Ubuntu 24.04 · x64</dd></dl>
      <details class="tech"><summary>技术详情</summary><pre>node fingerprint: SHA256:4f:9a:…:c1</pre></details>
      <div class="row" style="margin-top:24px"><a class="btn ghost" href="#/add">取消</a><span class="sp"></span><a class="btn primary" href="#/add/node?step=4">${I('check')}验证码一致</a></div>`,
    4: `<div class="col" style="align-items:center;text-align:center;gap:10px;padding:12px 0"><span class="tile ok" style="width:48px;height:48px;border-radius:14px">${I('check', 'lg')}</span>
      <b style="font-size:var(--fs-xl)">dev-box 已连接</b><p class="muted">现在可以在它上面登记项目文件夹，然后新建会话。</p>
      <div class="row" style="margin-top:12px"><button class="btn primary" onclick="openModal('addloc')">${I('folder')}添加项目文件夹</button><a class="btn" href="#/computers">回到我的电脑</a></div></div>`,
  }[step];
  const body = `<div class="page narrow" style="max-width:680px"><div class="head"><div class="grow"><h1>配对服务器</h1><p>用 CodeTether Node 把服务器加入这台电脑。配对后可以在上面继续工作，不需要账号。</p></div></div>
    ${bar}<div class="card pad" style="padding:28px">${panel}</div>
    ${step < 4 ? `<div style="margin-top:16px">${notice('', 'shield', '配对后这台电脑可以', '查看服务器上的会话、发送消息让 Codex 或 Claude Code 在服务器上运行、登记项目文件夹。不能浏览任意文件或打开终端。可以随时在电脑详情中取消配对。')}</div>` : ''}</div>`;
  return { active: 'computers', crumbs: crumbs(['我的电脑', '#/computers'], ['添加电脑', '#/add'], '配对服务器'), body };
}

/* ---------- 登录（Supabase 邮箱一次性登录码） ---------- */
function pageSignin() {
  const step = hq('step') || 'email';
  const v = {
    email: `<h1>登录 CodeTether</h1><p class="muted">登录后可以看到同一账号下的其他电脑。只用这台电脑不需要登录。</p>
      <label class="field">邮箱<input class="input" value="lin@example.com" type="email"></label><a class="btn primary lg block" href="#/signin?step=code">发送登录码</a><p class="help">只能登录已有账号。</p>`,
    code: `<h1>输入登录码</h1><p class="muted">登录码已发送到 lin@example.com，10 分钟内有效。</p>
      <input class="input code" value="824615" maxlength="6" aria-label="登录码" inputmode="numeric"><a class="btn primary lg block" href="#/settings/account">验证并登录</a>
      <div class="row small"><a href="#/signin">更换邮箱</a><span class="sp"></span><span class="faint">52 秒后可重新发送</span></div>`,
    unconfigured: `<span class="tile warn" style="width:44px;height:44px;border-radius:12px">${I('info', 'lg')}</span><h1>这个版本没有配置账号服务</h1>
      <p class="muted">这台电脑和配对的服务器仍可正常使用。需要查看其他电脑时，请安装正式版本。</p><a class="btn lg block" href="#/projects">知道了</a>`,
  }[step];
  const body = `<div class="page" style="max-width:440px;padding-top:56px"><div class="card col signin" style="padding:32px;gap:16px">${step === 'unconfigured' ? '' : `<span class="mark xl" style="margin-bottom:4px">${MARK_SVG}</span>`}${v}</div></div>`;
  return { active: 'settings', crumbs: crumbs(['设置', '#/settings/account'], '登录'), body };
}

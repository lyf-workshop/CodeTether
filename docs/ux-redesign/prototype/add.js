// 添加设备（CodeTether Node 配对）与登录。
// 基线里同一账号的其他桌面端只拿到 supervisor_read，这一版不做只读设备，所以这里只有 Node 配对
function pageAdd() {
  const body = `<div class="page narrow"><div class="head"><div class="grow"><h1>添加设备</h1><p>配对后，这台设备会和“这台电脑”一样出现在“设备”里：可以给它添加项目、新建会话、继续以前的会话。</p></div></div>
    <a class="card click pad col" style="gap:14px;color:inherit" href="#/add/node?step=1"><span class="glyph">${I('server')}</span>
      <div><b style="font-size:var(--fs-lg)">用 CodeTether Node 配对</b><p class="muted" style="margin-top:6px">适合 Linux 服务器（x64 / arm64）和 Apple 芯片的 Mac。在那台设备上运行一条命令，再输入它显示的配对码。</p></div>
      <div class="row wrap" style="gap:6px;margin-top:auto"><span class="pill ok">${I('check')}可以继续工作</span><span class="pill line">不需要账号</span></div></a>
    <div class="card pad row" style="gap:14px;margin-top:12px"><span class="glyph">${I('laptop')}</span><div class="grow"><b>Windows 电脑，或用同一账号登录的其他电脑</b>
      <p class="help" style="margin-top:4px">目前还不能添加：CodeTether Node 不支持 Windows，同一账号下的桌面版之间也还不能互相控制。见<a href="#/roadmap">后续规划</a>。</p></div></div>
    ${note('基线：Node 配对只支持 Linux x64 / arm64 和 macOS arm64。账号服务对同账号的其他 Host 只签发 supervisor_read，没有 supervisor_control，所以 v4 不再提供“仅查看”的设备。')}</div>`;
  return { active: 'devices', crumbs: crumbs(['设备', '#/devices'], '添加设备'), body };
}
function pageAddNode() {
  const step = +(hq('step') || 1), names = ['运行命令', '输入配对码', '核对验证码', '完成'];
  const bar = `<div class="steps">${names.map((n, i) => `${i ? '<span class="bar"></span>' : ''}<span class="st ${i + 1 === step ? 'on' : i + 1 < step ? 'done' : ''}"><i>${i + 1 < step ? I('check') : i + 1}</i>${n}</span>`).join('')}</div>`;
  const nav = (back, next, label) => `<div class="row" style="margin-top:24px">${back ? `<a class="btn ghost" href="${back}">上一步</a>` : ''}<span class="sp"></span><a class="btn primary" href="${next}">${label}</a></div>`;
  const term = (cmd) => `<div class="term-block"><span class="grow">${cmd}</span><button class="btn sm" onclick="this.innerHTML='已复制'">${I('copy')}复制</button></div>`;
  const panel = {
    1: `<b style="font-size:var(--fs-lg)">在那台设备的终端里运行</b><p class="muted" style="margin:6px 0 16px">需要先安装 CodeTether Node（Linux x64 / arm64、macOS arm64）。</p>${term('codetether-node --pair')}
      <p class="help" style="margin-top:10px">命令会显示一个地址（或 <span class="mono">codetether-pairing://</span> 链接）和 6 位配对码，几分钟内有效。</p>
      <details class="tech" style="margin-top:20px"><summary>需要长期在线？</summary><div style="margin-top:10px">${term('codetether-node service install')}<p class="help" style="margin-top:8px">配对后安装为 systemd 用户服务，开机后自动运行。</p></div></details>
      ${nav('', '#/add/node?step=2', '已显示配对码，下一步')}`,
    2: `<div class="col" style="gap:18px"><label class="field">地址或配对链接<input class="input mono" value="10.0.0.12:4318"><span class="help">局域网地址，或 Node 显示的 <span class="mono">codetether-pairing://relay/v1?…</span> 链接（通过 Relay）。</span></label>
      <label class="field">6 位配对码<input class="input code" value="482731" maxlength="6" inputmode="numeric"></label></div>${nav('#/add/node?step=1', '#/add/node?step=3', '连接')}`,
    3: `<b style="font-size:var(--fs-lg)">确认是你的设备</b><p class="muted" style="margin:6px 0 16px">那台设备的终端里显示的验证码和这里一致时再确认。不一致请取消。</p><div class="bigcode">391 044</div>
      <dl class="facts" style="margin-top:18px"><dt>名称</dt><dd>dev-box</dd><dt>系统</dt><dd>Ubuntu 24.04 · x64</dd></dl>
      <details class="tech"><summary>技术详情</summary><pre>node fingerprint: SHA256:4f:9a:…:c1</pre></details>
      <div class="row" style="margin-top:24px"><a class="btn ghost" href="#/add">取消</a><span class="sp"></span><a class="btn primary" href="#/add/node?step=4">${I('check')}验证码一致</a></div>`,
    4: `<div class="col" style="align-items:center;text-align:center;gap:10px;padding:12px 0"><span class="tile ok" style="width:48px;height:48px;border-radius:14px">${I('check', 'lg')}</span>
      <b style="font-size:var(--fs-xl)">dev-box 已连接</b><p class="muted">选择它上面的项目文件夹，CodeTether 会找出你以前在里面的会话。</p>
      <div class="row" style="margin-top:12px"><button class="btn primary" onclick="openModal('addproj')">${I('folder')}添加项目</button><a class="btn" href="#/devices">回到设备</a></div></div>`,
  }[step];
  const body = `<div class="page narrow" style="max-width:680px"><div class="head"><div class="grow"><h1>配对设备</h1><p>用 CodeTether Node 把服务器或 Mac 加入“设备”。配对后可以在上面继续工作，不需要账号。</p></div></div>
    ${bar}<div class="card pad" style="padding:28px">${panel}</div>
    ${step < 4 ? `<div style="margin-top:16px">${notice('', 'shield', '配对后可以', '给它添加项目、读取以前的会话、发送消息让 Codex 或 Claude Code 在它上面运行。不能浏览任意文件或打开终端。可以随时在设备详情中取消配对。')}</div>` : ''}</div>`;
  return { active: 'devices', crumbs: crumbs(['设备', '#/devices'], ['添加设备', '#/add'], '配对设备'), body };
}

/* ---------- 登录（Supabase 邮箱一次性登录码） ---------- */
function pageSignin() {
  const step = hq('step') || 'email';
  const v = {
    email: `<h1>登录 CodeTether</h1><p class="muted">只用这台电脑和配对的设备不需要登录。</p>
      <label class="field">邮箱<input class="input" value="lin@example.com" type="email"></label><a class="btn primary lg block" href="#/signin?step=code">发送登录码</a><p class="help">只能登录已有账号。</p>`,
    code: `<h1>输入登录码</h1><p class="muted">登录码已发送到 lin@example.com，10 分钟内有效。</p>
      <input class="input code" value="824615" maxlength="6" aria-label="登录码" inputmode="numeric"><a class="btn primary lg block" href="#/settings/account">验证并登录</a>
      <div class="row small"><a href="#/signin">更换邮箱</a><span class="sp"></span><span class="faint">52 秒后可重新发送</span></div>`,
    unconfigured: `<span class="tile warn" style="width:44px;height:44px;border-radius:12px">${I('info', 'lg')}</span><h1>这个版本没有配置账号服务</h1>
      <p class="muted">这台电脑和配对的设备仍可正常使用。</p><a class="btn lg block" href="#/devices">知道了</a>`,
  }[step];
  const body = `<div class="page" style="max-width:440px;padding-top:56px"><div class="card col signin" style="padding:32px;gap:16px">${step === 'unconfigured' ? '' : `<span class="mark xl" style="margin-bottom:4px">${MARK_SVG}</span>`}${v}</div></div>`;
  return { active: 'settings', crumbs: crumbs(['设置', '#/settings/account'], '登录'), body };
}

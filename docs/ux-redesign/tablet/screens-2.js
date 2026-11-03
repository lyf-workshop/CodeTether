// 设置、后续规划、登录和第一次配对
const sw = (on) => `<span class="sw ${on ? 'on' : ''}" data-sw></span>`;
const srowS = (label, right, sub = '') => `<div class="row"><span class="t"><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span>${right}</div>`;

function scrSettings(q) {
  const paired = D.machines.filter((m) => m.paired);
  let h = `<h1 class="large">设置</h1>`;
  h += sec('账号') + `<div class="group">${srowS(D.account.email, `<button class="btn plain sm" data-flash="演示：不会真的退出">退出登录</button>`, '已登录')}</div>`;
  h += sec('可以使用的电脑', `<a href="#" data-sheet="pair">输入配对码</a>`) + `<div class="group">${paired.map((m) =>
    srowS(m.name, `<button class="btn danger sm" data-sheet="unpair:${m.id}">移除</button>`, `${m.paired} 配对 · 上次使用 ${m.used}`)).join('')}</div>
    <div class="foot">经由这些电脑访问的设备（例如 build-server）会跟着出现。移除一台电脑后，要在那台电脑上生成新的配对码才能再用。</div>`;
  h += sec('通知') + `<div class="group">${srowS('等待批准', sw(true))}${srowS('工作完成', sw(true))}${srowS('执行失败', sw(true))}</div>
    <div class="foot">通知只写类型和 设备 · 项目，不含会话标题、提示词、命令和路径。锁屏上只显示类型和数量。</div>`;
  h += sec('后台保持连接') + `<div class="group">${srowS('后台保持连接', sw(true), '平板在后台也能收到提醒。系统会常驻一条“正在保持连接”的通知')}
    ${srowS('通知权限', '<span class="tag ok">已允许</span>')}${srowS('电池优化', '<span class="tag warn">未关闭</span> <a class="btn plain sm" href="#" data-flash="演示：会打开系统设置">去关闭</a>')}</div>
    <div class="foot">平板关掉、断网都不会影响电脑上正在运行的工作。</div>`;
  h += sec('安全') + `<div class="group">${srowS('批准和停止前先解锁', sw(true), '用指纹、面容或锁屏密码确认。发送消息不用确认')}</div>`;
  const th = q.th || 'system';
  h += sec('外观') + `<div class="group"><div class="row"><div class="seg" style="flex:1;margin:4px 0">${[['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']].map(([k, l]) => `<button class="${k === th ? 'on' : ''}" data-go="#/settings?th=${k}">${l}</button>`).join('')}</div></div></div>`;
  h += sec('关于') + `<div class="group">${srowS('版本', '<span class="r">0.1.0 · 平板</span>')}
    <a class="row" href="#/settings/connection"><span class="t"><b>连接检查</b><small>每台电脑现在怎么连上的</small></span><span class="r">${I('chev', 'sm')}</span></a>
    <a class="row" href="#/roadmap"><span class="t"><b>后续规划</b><small>还没做的功能</small></span><span class="r">${I('chev', 'sm')}</span></a></div>`;
  return { sel: 'settings', main: nav() + page(h) };
}

function scrConnection() {
  const h = `<h1 class="large">连接检查</h1><p class="lead">连接是自动的：同一网络里直接连，不在一起时经互联网连接。</p><div class="group">${D.machines.map((m) => {
    const how = !reach(m) ? (m.via ? `要等 ${$m(m.via).name} 上线` : `连不上 · ${m.seen}在线`) : m.via ? `经由 ${$m(m.via).name}` : m.link === 'same_network' ? '同一网络，直接连接' : '经互联网连接';
    return srowS(m.name, `<span class="tag ${reach(m) ? 'ok' : ''}">${reach(m) ? '已连接' : '离线'}</span>`, how);
  }).join('')}</div><div style="margin-top:14px"><button class="btn tint sm" data-flash="已重新检查">重新检查</button></div>`;
  return { sel: 'settings', main: nav({ left: `<a class="tb txt" href="#/settings">${I('back', 'sm')}设置</a>` }) + page(h) };
}

function scrRoadmap() {
  const h = `<h1 class="large">后续规划</h1><p class="lead">这些功能还没做，界面上其他地方不会出现它们的按钮。</p>
    <div class="group">${ROADMAP.map(([t, d]) => `<div class="row"><span class="lead-ic">${I('map', 'sm')}</span><span class="t"><b>${t}</b><small style="white-space:normal">${d}</small></span></div>`).join('')}</div>`;
  return { sel: 'settings', main: nav({ left: `<a class="tb txt" href="#/settings">${I('back', 'sm')}设置</a>` }) + page(h) };
}

// 6 位码的显示：digits 已输入的数字
const code6 = (digits) => `<div class="code6">${[0, 1, 2, 3, 4, 5].map((i) => `<span class="${i === digits.length ? 'cur' : ''}">${digits[i] || ''}</span>`).join('')}</div>`;
function center(inner) {
  return `<div class="center-page"><div class="center-card"><div style="text-align:center;margin-bottom:14px"><span class="brand" style="width:56px;height:56px;border-radius:14px;font-size:20px;display:inline-grid">&gt;_</span></div>${inner}</div></div>`;
}
function scrSignin(q) {
  if (q.step === 'code') return center(`<h2>输入登录码</h2><p class="lead">登录码已发到 ${D.account.email}。</p>${code6('4829')}
    <a class="btn fill" style="width:100%;margin-top:14px" href="#/pair">登录</a><p class="foot" style="text-align:center">没收到？<a href="#">58 秒后重新发送</a></p>`);
  return center(`<h2>登录 CodeTether</h2><p class="lead">用电脑上登录的同一个账号。</p>
    <input class="field" value="lin@example.com" aria-label="邮箱"><a class="btn fill" style="width:100%;margin-top:14px" href="#/signin?step=code">发送登录码</a>
    <p class="foot" style="text-align:center">现在只能登录已有账号。</p>`);
}
function scrPair(q) {
  if (q.step === 'done') return center(`<div style="text-align:center"><span class="lead-ic" style="width:56px;height:56px;border-radius:28px;background:var(--ok-soft);color:var(--ok);display:inline-grid;place-items:center">${I('check', 'lg')}</span>
    <h2>已连接 Windows 台式机</h2><p class="lead">经由它访问的 build-server 也可以用了。</p><a class="btn fill" style="width:100%" href="#/home">开始使用</a></div>`);
  const bad = q.step === 'wrong' ? `<div class="note err">${I('alert')}<span>配对码不对，还可以试 3 次</span></div>`
    : q.step === 'expired' ? `<div class="note err">${I('alert')}<span>配对码已过期，请在电脑上重新生成</span></div>` : '';
  return center(`<h2>连接你的电脑</h2><p class="lead">在电脑上的 CodeTether 里打开 设备 › 添加设备 › 添加手机或平板，输入屏幕上的 6 位配对码。</p>
    ${code6(q.step === 'wrong' ? '482910' : '482')}${bad}<a class="btn fill" style="width:100%;margin-top:14px" href="#/pair?step=done">连接</a>
    <p class="foot" style="text-align:center">配对码 5 分钟内有效，只能用一次。</p>`);
}

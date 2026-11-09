// 路由：#/home #/inbox?f= #/devices #/devices/:id #/projects/:id(?view=archived&s=) #/projects/:id/search?q= #/c/:id(?panel=changes&f=&wrap=0)
//       #/settings #/settings/connection #/roadmap #/signin(?step=code) #/pair(?step=wrong|expired|done) #/home?removed=1
// 页面参数（写在 ? 里，截图用）：theme=light|dark  o=land|port  bezel=1  side=1  modal=new|new:p-web|addproj:m-win(:name|:found)|rename:c1|archive:c9|stop|rmproj:p-web|unpair:m-mac|pair|search  menu=conv|proj
const QS = new URLSearchParams(location.search);
document.documentElement.dataset.theme = QS.get('theme') || 'light';
if (QS.get('bezel')) document.body.classList.add('bezel');
if (QS.get('modal')) S.sheet = QS.get('modal');
if (QS.get('side')) S.sideOpen = true;
if (QS.get('menu')) S.menu = QS.get('menu');

function parse() {
  const [path, qs = ''] = (location.hash.slice(1) || '/home').split('?');
  return { parts: path.split('/').filter(Boolean), q: Object.fromEntries(new URLSearchParams(qs)) };
}
function route({ parts: [a, b, c], q }) {
  if (a === 'signin') return { full: scrSignin(q) };
  if (a === 'pair') return { full: scrPair(q) };
  if (a === 'inbox') return scrInbox(q);
  if (a === 'devices') return b ? scrDevice(b) : scrDevices();
  if (a === 'projects') return c === 'search' ? scrSearch(b, q) : scrProject(b, q);
  if (a === 'c') return scrConv(b, q);
  if (a === 'settings') return b === 'connection' ? scrConnection() : scrSettings(q);
  if (a === 'roadmap') return scrRoadmap();
  return scrHome(q);
}
const statusbar = () => `<div class="statusbar"><span>9:41</span><span class="icons">${I('wifi')}${I('battery')}</span></div>`;

function render() {
  const r = parse();
  CTX.port = QS.get('o') === 'port';
  const peek = route(r);
  CTX.collapsed = !CTX.port && !!peek.panel;
  const v = peek.full ? peek : route(r); // 第二次渲染时导航栏已经知道侧栏是否收起
  const sel = v.sel || '';
  const ctx = { sel, p: r.parts[0] === 'projects' ? r.parts[1] : null, c: r.parts[0] === 'c' ? r.parts[1] : null };
  const app = v.full ? `<div class="app">${v.full}</div>`
    : `<div class="app ${CTX.collapsed ? 'collapsed' : ''}">${(CTX.port || CTX.collapsed) && S.sideOpen ? '<div class="side-scrim" data-side></div>' : ''}
        <aside class="side ${S.sideOpen ? 'open' : ''}">${sidebar(ctx)}</aside><main class="main ${v.canvas ? 'canvas' : ''}">${v.main}</main></div>`;
  document.getElementById('root').innerHTML = `<div class="screen ${CTX.port ? 'port' : ''}">${statusbar()}${app}<div class="gesture"><i></i></div>
    ${renderSheet(S.sheet)}<span class="demo">演示数据</span></div>`;
}
function flash(text) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  document.querySelector('.screen').appendChild(t);
  setTimeout(() => t.remove(), 1800);
}

document.addEventListener('click', (e) => {
  const el = (sel) => e.target.closest(sel);
  if (e.target.matches('[data-close-bg]') || el('[data-close]')) { S.sheet = null; return render(); }
  const x = el('[data-side]'); if (x) { S.sideOpen = !S.sideOpen; return render(); }
  const tw = el('[data-tw]'); if (tw) { S.exp[tw.dataset.tw] = tw.dataset.open !== '1'; return render(); }
  const mn = el('[data-menu]'); if (mn) { S.menu = S.menu === mn.dataset.menu ? null : mn.dataset.menu; return render(); }
  const sh = el('[data-sheet]'); if (sh) { e.preventDefault(); S.sheet = sh.dataset.sheet; S.menu = null; S.sideOpen = false; return render(); }
  const np = el('[data-newp]'); if (np) { S.newP = np.dataset.newp; return render(); }
  const agt = el('[data-agent]'); if (agt) { S.newAgent = agt.dataset.agent; return render(); }
  const ck = el('[data-check]'); if (ck) { const id = ck.dataset.check; S.picked[id] = S.picked[id] === false; return render(); }
  const s = el('[data-sw]'); if (s) { s.classList.toggle('on'); return; }
  const fl = el('[data-flash]'); if (fl) { e.preventDefault(); if (S.sheet) { S.sheet = null; render(); } return flash(fl.dataset.flash); }
  const go = el('[data-go]'); if (go) { S.menu = null; location.hash = go.dataset.go; return; }
  if (el('a[href^="#/"]')) { S.sheet = null; S.menu = null; S.sideOpen = false; }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { S.sheet = null; S.menu = null; render(); }
  if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); S.sheet = 'new'; render(); }
  if (e.ctrlKey && e.key.toLowerCase() === 'k') { e.preventDefault(); S.sheet = 'search'; render(); }
});
window.addEventListener('hashchange', render);
render();

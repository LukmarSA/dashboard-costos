// Browser end-to-end checks for the login message, the stale-data banner and the
// session-redirect fix. Supabase responses are mocked (including the real 402 text); the real
// pages run in Chromium. Needs: Playwright installed, and the repo served on port 8765:
//   python3 -m http.server 8765 --bind 127.0.0.1     (from the repo root)
//   node tests/e2e-browser.cjs [screenshot-folder]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path'), os = require('os');
const ROOT = path.resolve(__dirname, '..');
const SP = process.argv[2] || os.tmpdir();   // where screenshots go
const VENDOR = path.join(ROOT, 'js', 'vendor') + path.sep;
const BASE = 'http://127.0.0.1:8765/';
const MSG402 = 'Service for this project is restricted due to the following violations: exceed_db_size_quota. The project owner must upgrade their plan or remove spend caps to restore service.';
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const ANON_KEY = require('fs').readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8').match(/anonKey:\s*'([^']+)'/)[1];
let failures = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' - ' + name + (extra ? '  [' + extra + ']' : '')); if (!ok) failures++; };
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');

async function newPage(browser, { fixedIso, session, restMode, datos, authMode }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  const rpcBearers = [];
  const consoleErrors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  if (fixedIso || session) {
    const fixed = new Date(fixedIso || '2026-11-06T15:00:00-05:00').getTime();
    const jwt = ['none', 'x'].map(() => b64({ alg: 'none' }))[0] + '.' + b64({ sub: '11111111-1111-1111-1111-111111111111', role: 'authenticated', exp: Math.floor(fixed / 1000) + 3600 }) + '.sig';
    await ctx.addInitScript(({ fixed, session, jwt }) => {
      const RealDate = Date;
      class FakeDate extends RealDate { constructor(...a) { if (a.length === 0) super(fixed); else super(...a); } static now() { return fixed; } }
      window.Date = FakeDate;
      if (session) {
        localStorage.setItem('sb-xupjkihkbvqtzmtrkfff-auth-token', JSON.stringify({ access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(fixed / 1000) + 3600, refresh_token: 'r',
          user: { id: '11111111-1111-1111-1111-111111111111', aud: 'authenticated', role: 'authenticated', email: 't@t.test', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } }));
        sessionStorage.setItem('dcp_rol', 'admin'); sessionStorage.setItem('dcp_nombre', 'Prueba'); sessionStorage.setItem('dcp_empresa', 'emp-1');
      }
    }, { fixed, session: !!session, jwt });
  }
  // CDN libs -> vendored copies; fonts blocked
  await page.route(/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js/, r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(VENDOR + 'supabase.min.js') }));
  await page.route(/cdn\.jsdelivr\.net\/npm\/xlsx/, r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(VENDOR + 'xlsx.full.min.js') }));
  await page.route(/cdnjs\.cloudflare\.com.*chart/i, r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(VENDOR + 'chart.umd.js') }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  // Supabase auth
  await page.route(/supabase\.co\/auth\/v1\//, r => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    if (authMode === '402') return r.fulfill({ status: 402, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ message: MSG402 }) });
    if (authMode === 'badpass') return r.fulfill({ status: 400, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }) });
    if (authMode === 'offline') return r.abort('failed');
    return r.fulfill({ status: 500, headers: cors, body: '{}' });
  });
  // Supabase REST
  await page.route(/supabase\.co\/rest\/v1\//, r => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    if (restMode === '402') return r.fulfill({ status: 402, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ message: MSG402 }) });
    // The cost RPCs are executable by signed-in users only (the real database revokes anon): answer 401 to the public anon key.
    if (/\/rpc\/get_costos_/.test(req.url())) {
      const bearer = (req.headers()['authorization'] || '').replace(/^Bearer /, '');
      rpcBearers.push(bearer);
      if (bearer === ANON_KEY) return r.fulfill({ status: 401, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ code: '42501', message: 'permission denied for function' }) });
      return r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify([{ corrida_id: 'c1', grupo: 'Balanceado', producto_codigo: 'P1', total_valor: 100 }]) });
    }
    const table = new URL(req.url()).pathname.split('/').pop();
    const wantsObject = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    const body = wantsObject ? (table === 'siembra_diaria' ? { fecha_reporte: datos.siembra } : table === 'costos_piscina' ? { fecha_reporte: datos.costos } : {}) : [];
    return r.fulfill({ status: 200, headers: { ...cors, 'content-type': wantsObject ? 'application/vnd.pgrst.object+json' : 'application/json' }, body: JSON.stringify(body) });
  });
  return { page, ctx, errors, rpcBearers, consoleErrors };
}

async function loginMessage(browser, authMode) {
  const { page, ctx, errors } = await newPage(browser, { authMode });
  await page.goto(BASE + 'index.html', { waitUntil: 'load' });
  await page.waitForSelector('#email', { timeout: 8000 });
  await page.fill('#email', 'alguien@lukmar.com.ec');
  await page.fill('#password', 'clave-de-prueba');
  await page.click('#btn-login');
  await page.waitForSelector('#msg-error.visible', { timeout: 8000 });
  const text = (await page.textContent('#msg-error')).trim();
  return { text, page, ctx, errors };
}

(async () => {
  const browser = await chromium.launch();

  // 1) Login against the exact 402 the service returns today
  let r = await loginMessage(browser, '402');
  check('login 402 -> friendly Spanish message', /suspendido temporalmente por límite de almacenamiento/.test(r.text) && !/exceed_db_size_quota/.test(r.text), r.text.slice(0, 90));
  await r.page.screenshot({ path: SP + '/shot_login_402.png' });
  await r.ctx.close();
  r = await loginMessage(browser, 'badpass');
  check('login wrong password -> "Correo o contraseña incorrectos."', r.text === 'Correo o contraseña incorrectos.', r.text);
  await r.ctx.close();
  r = await loginMessage(browser, 'offline');
  check('login offline -> connection message', /No hay conexión con el servidor/.test(r.text), r.text);
  await r.ctx.close();

  // 2) Dashboard with NO session must redirect to login (was: "navigateWithBuild is not defined")
  let p = await newPage(browser, {});
  await p.page.goto(BASE + 'pages/dashboard.html', { waitUntil: 'load' });
  await p.page.waitForTimeout(3000);
  check('dashboard without session redirects to index.html', /\/index\.html/.test(p.page.url()), p.page.url().replace(BASE, '/'));
  check('  ...and no "navigateWithBuild is not defined" error', !p.errors.some(e => /navigateWithBuild/.test(e)), JSON.stringify(p.errors));
  await p.ctx.close();

  // 3) Stale data: today 2026-11-06, last reports 2026-11-01 -> amber banner, 5 days
  p = await newPage(browser, { fixedIso: '2026-11-06T15:00:00-05:00', session: true, datos: { siembra: '2026-11-01', costos: '2026-11-01' } });
  await p.page.goto(BASE + 'pages/dashboard.html', { waitUntil: 'load' });
  await p.page.waitForFunction(() => { const e = document.getElementById('banner-frescura'); return e && e.style.display !== 'none'; }, null, { timeout: 8000 }).catch(() => {});
  let banner = await p.page.evaluate(() => { const e = document.getElementById('banner-frescura'); return { shown: e.style.display !== 'none', text: e.textContent.trim(), role: e.getAttribute('role'), bg: getComputedStyle(e).backgroundColor }; });
  check('stale 5 days -> banner shown (aviso, role=status)', banner.shown && banner.role === 'status', JSON.stringify(banner).slice(0, 220));
  check('  ...says siembra and costos are 5 days old', /hace 5 días/.test(banner.text) && /siembra/.test(banner.text) && /costos/.test(banner.text), banner.text);
  check('  ...no page errors', p.errors.length === 0, JSON.stringify(p.errors));
  await p.page.screenshot({ path: SP + '/shot_dashboard_stale.png' });
  await p.ctx.close();

  // 4) Critical: 9 days old -> red + role=alert
  p = await newPage(browser, { fixedIso: '2026-11-10T09:00:00-05:00', session: true, datos: { siembra: '2026-11-01', costos: '2026-11-01' } });
  await p.page.goto(BASE + 'pages/dashboard.html', { waitUntil: 'load' });
  await p.page.waitForFunction(() => { const e = document.getElementById('banner-frescura'); return e && e.style.display !== 'none'; }, null, { timeout: 8000 }).catch(() => {});
  banner = await p.page.evaluate(() => { const e = document.getElementById('banner-frescura'); return { shown: e.style.display !== 'none', role: e.getAttribute('role'), bg: getComputedStyle(e).backgroundColor }; });
  check('stale 9 days -> critical banner (role=alert, red background)', banner.shown && banner.role === 'alert' && banner.bg === 'rgb(255, 235, 238)', JSON.stringify(banner));
  await p.ctx.close();

  // 5) Fresh data (1 day old) -> no banner
  p = await newPage(browser, { fixedIso: '2026-11-02T10:00:00-05:00', session: true, datos: { siembra: '2026-11-01', costos: '2026-11-01' } });
  await p.page.goto(BASE + 'pages/dashboard.html', { waitUntil: 'load' });
  await p.page.waitForFunction(() => /Siembra:/.test(document.getElementById('lbl-fecha').textContent), null, { timeout: 8000 }).catch(() => {});
  await p.page.waitForTimeout(500);
  banner = await p.page.evaluate(() => ({ shown: document.getElementById('banner-frescura').style.display !== 'none', label: document.getElementById('lbl-fecha').textContent }));
  check('fresh data -> no banner', !banner.shown, JSON.stringify(banner));
  await p.ctx.close();

  // 6) Siembra and costos on different days, both recent -> warning about mismatch only
  p = await newPage(browser, { fixedIso: '2026-11-06T10:00:00-05:00', session: true, datos: { siembra: '2026-11-06', costos: '2026-11-03' } });
  await p.page.goto(BASE + 'pages/dashboard.html', { waitUntil: 'load' });
  await p.page.waitForFunction(() => { const e = document.getElementById('banner-frescura'); return e && e.style.display !== 'none'; }, null, { timeout: 8000 }).catch(() => {});
  banner = await p.page.evaluate(() => { const e = document.getElementById('banner-frescura'); return { shown: e.style.display !== 'none', text: e.textContent.trim() }; });
  check('different siembra/costos dates -> mismatch note, no "desactualizados"', banner.shown && /fechas distintas/.test(banner.text) && !/desactualizados/.test(banner.text), banner.text);
  await p.ctx.close();

  // 7) Service restricted mid-session (REST 402): must say so, NOT "Sin datos"
  p = await newPage(browser, { fixedIso: '2026-11-06T15:00:00-05:00', session: true, restMode: '402', datos: {} });
  await p.page.goto(BASE + 'pages/dashboard.html', { waitUntil: 'load' });
  await p.page.waitForSelector('#err-carga', { timeout: 8000 }).catch(() => {});
  const body = await p.page.evaluate(() => ({ sub: document.getElementById('topbar-sub').textContent, err: (document.getElementById('err-carga') || {}).textContent || '', tabla: document.getElementById('tabla-body').textContent }));
  check('REST 402 -> dashboard shows the service-suspended message', /suspendido temporalmente/.test(body.err) && body.sub === 'Error cargando datos', JSON.stringify(body).slice(0, 200));
  check('  ...and does NOT claim "Sin datos"', !/Sin datos/.test(body.tabla), body.tabla.slice(0, 80));
  await p.page.screenshot({ path: SP + '/shot_dashboard_402.png' });
  await p.ctx.close();

  // 8) The cost panel must call its RPCs with the signed-in user's token, never with the public anon key
  p = await newPage(browser, { fixedIso: '2026-11-06T15:00:00-05:00', session: true, datos: { siembra: '2026-11-01', costos: '2026-11-01' } });
  await p.page.goto(BASE + 'pages/dashboard.html', { waitUntil: 'load' });
  await p.page.waitForFunction(() => /Siembra:/.test(document.getElementById('lbl-fecha').textContent), null, { timeout: 8000 }).catch(() => {});
  await p.page.waitForTimeout(1500);
  check('cost RPCs were called', p.rpcBearers.length >= 2, 'calls=' + p.rpcBearers.length);
  check('  ...with the user session token, not the anon key', p.rpcBearers.length > 0 && p.rpcBearers.every(b => b !== ANON_KEY), 'anon-key calls=' + p.rpcBearers.filter(b => b === ANON_KEY).length);
  check('  ...and no "Error RPC" logged', !p.consoleErrors.some(e => /Error RPC/.test(e)), JSON.stringify(p.consoleErrors).slice(0, 160));
  await p.ctx.close();

  await browser.close();
  console.log(failures === 0 ? '\nALL BROWSER CHECKS PASSED' : '\n' + failures + ' CHECK(S) FAILED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });

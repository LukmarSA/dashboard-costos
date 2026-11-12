// Browser end-to-end checks for pages/inteligencia.html (cost intelligence). Supabase is mocked with invented
// numbers (no farm data); the real page, chart library and shared scripts run in Chromium.
// Needs Playwright and the repo served on port 8765:
//   python3 -m http.server 8765 --bind 127.0.0.1     (from the repo root)
//   node tests/e2e-inteligencia.cjs [screenshot-folder]
const { chromium } = require('playwright');
const path = require('path'), os = require('os'), fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const SP = process.argv[2] || os.tmpdir();
const BASE = 'http://127.0.0.1:8765/';
const MSG402 = 'Service for this project is restricted due to the following violations: exceed_db_size_quota.';
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const ANON_KEY = fs.readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8').match(/anonKey:\s*'([^']+)'/)[1];
let failures = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' - ' + name + (extra ? '  [' + extra + ']' : '')); if (!ok) failures++; };
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const json = (r, status, body) => r.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });

// ---- invented data in the shape inteligencia_costos() returns ----
function curvas() {
  const out = [];
  for (let e = 5; e <= 60; e++) {
    const m = 1500 + e * 150;
    out.push({ e, n: 30, x: [m * 0.8, m * 0.9, m, m * 1.1, m * 1.25], op: m - 1900, g: { bal: m * .4, lar: 1900, mo: m * .15, comb: m * .06, quim: m * .05, otros: m * .2 }, alim: [e * 130, e * 150, e * 170] });
  }
  return out;
}
function ciclo(o) {
  const edad = o.edad || 30, m = 1500 + edad * 150, op = m - 1900;
  return Object.assign({
    id: 'id-' + o.cod, cod: 'LM01-' + o.pis + '-EN-001', pis: o.pis, fsiembra: '2026-10-01', edad, has: 5, x: m, op: Math.max(op, 100), lar: 1900, alim: edad * 150,
    g: { bal: m * .4, lar: 1900, mo: m * .15, comb: m * .06, quim: m * .05, otros: m * .2 },
    resiembra: false, ref_n: 30, op_rank: 0.5, ref_x: [m * .8, m * .9, m, m * 1.1, m * 1.25], ref_op: [Math.max(op, 100) * .8, Math.max(op, 100) * .9, Math.max(op, 100), Math.max(op, 100) * 1.1, Math.max(op, 100) * 1.25],
    ref_alim: [edad * 130, edad * 150, edad * 170], ref_g: { bal: m * .4, lar: 1900, mo: m * .15, comb: m * .06, quim: m * .05, otros: m * .2 },
    tasa: 150, tasa_ref: 150, proy_n: 25, proy_dq: [1000, 1500, 2000]
  }, o.extra || {});
}
const DATOS = {
  fecha: '2026-11-11', edad_objetivo: 40, tipo: 'EN', curvas: curvas(),
  ciclos: [
    ciclo({ cod: 'N1', pis: 'N01' }),
    ciclo({ cod: 'A1', pis: 'A01', extra: { op: 5000, x: 7000, op_rank: 0.97, ref_op: [3000, 3300, 3600, 4000, 4400], g: { bal: 3200, lar: 1900, mo: 900, comb: 300, quim: 200, otros: 1000 }, ref_g: { bal: 2200, lar: 1900, mo: 800, comb: 300, quim: 200, otros: 900 } } }),
    ciclo({ cod: 'R1', pis: 'R01', extra: { resiembra: true } }),
    ciclo({ cod: 'B1', pis: 'B01', extra: { op: 800, x: 2700, op_rank: 0, ref_op: [3000, 3300, 3600, 4000, 4400] } }),
    ciclo({ cod: '<img src=x onerror=window.__xss=1>', pis: 'X01' })
  ]
};
const BACKTEST = [{ a: 20, h: 40, n: 56, error_pct: 7.4, error_lineal_pct: 11.3, cobertura_pct: 77, sesgo_pct: -0.2 }, { a: 35, h: 50, n: 12, error_pct: 4.4, error_lineal_pct: 6.2, cobertura_pct: 67, sesgo_pct: -1 }];
const GRAMAJE = [{ piscina_codigo: 'N01', sobrevivencia: 70, peso_gramos: 12, cantidad_larvas: 1000000, fecha_muestreo: '2026-10-25' }];

async function nuevaPagina(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [], rpc = [];
  page.on('pageerror', e => errors.push(e.message));
  const jwt = [b64({ alg: 'none' }), b64({ sub: '11111111-1111-1111-1111-111111111111', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 7200 }), 'sig'].join('.');
  await ctx.addInitScript(({ jwt }) => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('sb-xupjkihkbvqtzmtrkfff-auth-token', JSON.stringify({ access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'r',
      user: { id: '11111111-1111-1111-1111-111111111111', aud: 'authenticated', role: 'authenticated', email: 't@t.test', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } }));
    sessionStorage.setItem('dcp_rol', 'gerente'); sessionStorage.setItem('dcp_nombre', 'Prueba'); sessionStorage.setItem('dcp_empresa', 'emp-1');
  }, { jwt });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.route(/supabase\.co\/auth\/v1\//, r => r.request().method() === 'OPTIONS' ? r.fulfill({ status: 204, headers: cors }) : json(r, 500, {}));
  await page.route(/supabase\.co\/rest\/v1\//, r => {
    const req = r.request(), url = new URL(req.url());
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    const name = url.pathname.split('/').pop();
    if (opts.rest402) return json(r, 402, { message: MSG402 });
    if (url.pathname.includes('/rpc/')) {
      const bearer = (req.headers()['authorization'] || '').replace(/^Bearer /, '');
      rpc.push({ name, bearer, body: req.postData() });
      if (bearer === ANON_KEY) return json(r, 401, { code: '42501', message: 'permission denied for function' });
      if (opts.sinFuncion && name === 'inteligencia_costos') return json(r, 404, { code: 'PGRST202', message: 'Could not find the function public.inteligencia_costos(p_edad_objetivo) in the schema cache' });
      if (name === 'inteligencia_costos') return json(r, 200, opts.vacio ? Object.assign({}, DATOS, { ciclos: [] }) : DATOS);
      if (name === 'inteligencia_backtest') return json(r, 200, BACKTEST);
      return json(r, 404, {});
    }
    if (name === 'gramaje_muestreo') return json(r, 200, GRAMAJE);
    if (name === 'ciclo_curva_edad') {
      const rows = []; for (let e = 5; e <= 30; e++) rows.push({ edad: e, costo_ha: 1500 + e * 190, alim_lbs_ha: e * 170 });
      return json(r, 200, rows);
    }
    return json(r, 200, []);
  });
  return { page, ctx, errors, rpc };
}

(async () => {
  const browser = await chromium.launch();

  // 1) Normal load
  let p = await nuevaPagina(browser);
  await p.page.goto(BASE + 'pages/inteligencia.html', { waitUntil: 'load' });
  await p.page.waitForSelector('tr.ic-fila', { timeout: 10000 });
  const filas = await p.page.$$eval('tr.ic-fila', trs => trs.map(t => ({ txt: t.textContent.replace(/\s+/g, ' ').trim(), id: t.dataset.id })));
  check('table shows the 5 cycles', filas.length === 5, 'rows=' + filas.length);
  check('severity order: alert first, then low-cost, normal, re-stocked last', /A01/.test(filas[0].txt) && /B01/.test(filas[1].txt) && /R01/.test(filas[filas.length - 1].txt) || /R01/.test(filas[filas.length - 2].txt), filas.map(f => f.txt.slice(0, 12)).join(' | '));
  check('alert row says "Alerta alta", names Balanceado as the main cause', /Alerta alta/.test(filas[0].txt) && /Balanceado/.test(filas[0].txt), filas[0].txt.slice(0, 140));
  check('re-stocked cycle is labelled and has no forecast', /Resiembra/.test(filas.find(f => /R01/.test(f.txt)).txt) && /no aplica/.test(filas.find(f => /R01/.test(f.txt)).txt));
  const kpis = await p.page.$$eval('.kpi-card', cs => cs.map(c => c.textContent.replace(/\s+/g, ' ').trim()));
  check('4 KPI cards, first one counts 1 high alert out of 5', kpis.length === 4 && /Alertas altas\s*1/.test(kpis[0]) && /de 5 ciclos/.test(kpis[0]) && /11 nov 2026/.test(kpis[0]), kpis[0]);
  check('forecast KPI gives a range in dollars', /Pronóstico a los 40 d/.test(kpis[3]) && /\$[\d,]+ – \$[\d,]+/.test(kpis[3]), kpis[3]);
  const fcrCol = await p.page.$$eval('tr.ic-fila', trs => trs.map(t => ({ pis: t.querySelector('.ic-cod').textContent, fcr: t.children[9].textContent.trim() })));
  check('FCR shown for the cycle with a current sampling (N01 = 4,500 lb/ha x 5 ha / 18,520 lb = 1,21), dash for the others',
    fcrCol.find(r => r.pis === 'N01').fcr === '1,21' && fcrCol.filter(r => r.pis !== 'N01').every(r => r.fcr === '—'), JSON.stringify(fcrCol));
  check('sidebar has the new "Inteligencia de costos" entry, active', await p.page.$eval('.nav-item.active', e => /Inteligencia de costos/.test(e.textContent)).catch(() => false));
  check('existing sidebar entries are still there', await p.page.$$eval('.nav-item', es => es.some(e => /Resumen general/.test(e.textContent))));
  const bt = await p.page.$eval('#backtest-body', e => e.textContent.replace(/\s+/g, ' ').trim());
  check('reliability table lists the backtest with "pocos ciclos" on the 12-cycle row', /7,4 %/.test(bt) && /11,3 %/.test(bt) && /pocos ciclos/.test(bt), bt.slice(0, 160));
  check('markup in a cycle code is shown as text, not executed (XSS)', (await p.page.evaluate(() => window.__xss === undefined)) && (await p.page.$$eval('tr.ic-fila img', i => i.length)) === 0);
  check('RPCs were called with the user token, never the anon key', p.rpc.length >= 2 && p.rpc.every(c => c.bearer !== ANON_KEY), 'calls=' + p.rpc.length);
  check('forecast age is sent to the database (40 by default)', p.rpc.some(c => c.name === 'inteligencia_costos' && /"p_edad_objetivo":40/.test(c.body || '')), (p.rpc[0] || {}).body);
  await p.page.screenshot({ path: SP + '/shot_inteligencia_tabla.png', fullPage: true });

  // 2) Open a cycle: chart + reasons + causes
  await p.page.click('tr.ic-fila[data-id="id-A1"]');
  await p.page.waitForSelector('#detalle', { state: 'visible' });
  await p.page.waitForFunction(() => { const c = Chart.getChart('chart-detalle'); return c && c.data.datasets.length >= 7; }, null, { timeout: 8000 }).catch(() => {});
  const chart = await p.page.evaluate(() => { const c = Chart.getChart('chart-detalle'); return c ? { n: c.data.datasets.length, labels: c.data.datasets.map(d => d.label), propio: c.data.datasets.find(d => d.label === 'Este ciclo').data.length } : null; });
  check('detail chart: band + median + own curve + 3 forecast lines', chart && chart.n === 7 && chart.labels.includes('Este ciclo') && chart.labels.includes('Pronóstico (más probable)'), JSON.stringify(chart).slice(0, 200));
  check('own curve was loaded from the database (26 points)', chart && chart.propio === 26);
  const det = await p.page.evaluate(() => ({ t: document.getElementById('detalle-titulo').textContent, m: document.getElementById('detalle-motivos').textContent, c: document.getElementById('detalle-causas').textContent }));
  check('detail names the pond, the level, the reason and the leading cost group', /A01/.test(det.t) && /Alerta alta/.test(det.t) && /sobre lo típico/.test(det.m) && /Balanceado/.test(det.c), JSON.stringify(det).slice(0, 220));
  await p.page.screenshot({ path: SP + '/shot_inteligencia_detalle.png', fullPage: true });
  await p.page.selectOption('#chart-modo', 'alim');
  const alim = await p.page.evaluate(() => { const c = Chart.getChart('chart-detalle'); return { n: c.data.datasets.length, y: c.options.scales.y.title.text }; });
  check('feed view: no cost forecast lines, axis in lb/ha', alim.n === 4 && /lb/.test(alim.y), JSON.stringify(alim));

  // 3) Filter and search
  await p.page.selectOption('#filtro-nivel', 'alto');
  check('filter "Alerta alta" leaves one row', (await p.page.$$eval('tr.ic-fila', t => t.length)) === 1);
  await p.page.selectOption('#filtro-nivel', '');
  await p.page.fill('#filtro-texto', 'n01');
  check('search by pond code is case-insensitive', (await p.page.$$eval('tr.ic-fila', t => t.length)) === 1);
  await p.page.fill('#filtro-texto', 'zzz');
  check('no match -> friendly empty row', /Ningún ciclo coincide/.test(await p.page.textContent('#tabla-body')));

  // 4) Changing the forecast age asks the database again
  await p.page.fill('#filtro-texto', '');
  const antes = p.rpc.filter(c => c.name === 'inteligencia_costos').length;
  await p.page.selectOption('#sel-h', '45');
  await p.page.waitForFunction(() => /Pronóstico a los/.test(document.getElementById('th-proy').textContent), null, { timeout: 5000 });
  const llamadas = p.rpc.filter(c => c.name === 'inteligencia_costos');
  check('changing the age re-queries with 45', llamadas.length === antes + 1 && /"p_edad_objetivo":45/.test(llamadas[llamadas.length - 1].body || ''), 'calls=' + llamadas.length);
  check('no page errors in the whole flow', p.errors.length === 0, JSON.stringify(p.errors));
  await p.ctx.close();

  // 5) Mobile width: the table scrolls inside its box, the page itself must not scroll sideways
  p = await nuevaPagina(browser);
  await p.page.setViewportSize({ width: 390, height: 800 });
  await p.page.goto(BASE + 'pages/inteligencia.html', { waitUntil: 'load' });
  await p.page.waitForSelector('tr.ic-fila', { timeout: 10000 });
  const ancho = await p.page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  check('phone width: no horizontal page scroll', ancho.doc <= ancho.win + 1, JSON.stringify(ancho));
  await p.page.screenshot({ path: SP + '/shot_inteligencia_movil.png' });
  await p.ctx.close();

  // 6) Function not installed yet
  p = await nuevaPagina(browser, { sinFuncion: true });
  await p.page.goto(BASE + 'pages/inteligencia.html', { waitUntil: 'load' });
  await p.page.waitForSelector('#estado.error', { timeout: 8000 }).catch(() => {});
  check('missing database function -> clear message, not a raw error', /todavía no está instalado/.test(await p.page.textContent('#estado')));
  await p.ctx.close();

  // 7) Service restricted (402)
  p = await nuevaPagina(browser, { rest402: true });
  await p.page.goto(BASE + 'pages/inteligencia.html', { waitUntil: 'load' });
  await p.page.waitForSelector('#estado.error', { timeout: 8000 }).catch(() => {});
  check('402 -> the service-suspended message', /suspendido temporalmente/.test(await p.page.textContent('#estado')));
  await p.ctx.close();

  // 8) No active cycles
  p = await nuevaPagina(browser, { vacio: true });
  await p.page.goto(BASE + 'pages/inteligencia.html', { waitUntil: 'load' });
  await p.page.waitForFunction(() => /Ningún ciclo|Sin datos/.test(document.getElementById('tabla-body').textContent), null, { timeout: 8000 }).catch(() => {});
  check('no cycles -> empty message, no page errors', /Ningún ciclo coincide/.test(await p.page.textContent('#tabla-body')) && p.errors.length === 0, JSON.stringify(p.errors));
  await p.ctx.close();

  await browser.close();
  console.log(failures === 0 ? '\nALL INTELIGENCIA CHECKS PASSED' : '\n' + failures + ' CHECK(S) FAILED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });

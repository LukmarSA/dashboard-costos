// Run: node tests/estado-servicio.test.cjs   (no dependencies)
const assert = require('assert');
const { mensajeErrorServicio, describirFrescura, diasEntre, hoyLocalISO } = require('../js/estado-servicio.js');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

// --- mensajeErrorServicio ---------------------------------------------------
t('402 from the real Supabase auth response is explained in Spanish', () => {
  const real = { name: 'AuthApiError', status: 402,
    message: 'Service for this project is restricted due to the following violations: exceed_db_size_quota. The project owner must upgrade their plan or remove spend caps to restore service.' };
  const out = mensajeErrorServicio(real);
  assert.match(out, /suspendido temporalmente/);
  assert.match(out, /administrador/);
  assert.doesNotMatch(out, /exceed_db_size_quota/);
});
t('402 embedded inside our own profile-restore error text is still recognised', () => {
  const e = new Error('No se pudo restaurar el perfil del usuario: Service for this project is restricted due to the following violations: exceed_db_size_quota.');
  assert.match(mensajeErrorServicio(e), /suspendido temporalmente/);
});
t('PostgREST-style 402 without status field (message only)', () => {
  assert.match(mensajeErrorServicio({ message: 'Payment Required' }), /suspendido temporalmente/);
});
t('wrong password', () => {
  assert.strictEqual(mensajeErrorServicio({ status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' }), 'Correo o contraseña incorrectos.');
  assert.strictEqual(mensajeErrorServicio({ message: 'Invalid login credentials' }), 'Correo o contraseña incorrectos.');
});
t('network failures', () => {
  for (const m of ['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed'])
    assert.match(mensajeErrorServicio(new TypeError(m)), /No hay conexión/);
});
t('5xx', () => {
  assert.match(mensajeErrorServicio({ status: 503, message: 'upstream' }), /código 503/);
});
t('unknown error keeps its own message; empty falls back', () => {
  assert.strictEqual(mensajeErrorServicio(new Error('algo raro')), 'algo raro');
  assert.strictEqual(mensajeErrorServicio(undefined), 'No se pudo completar la operación.');
  assert.strictEqual(mensajeErrorServicio(null), 'No se pudo completar la operación.');
});
t('402 check does not hijack other 4xx', () => {
  assert.strictEqual(mensajeErrorServicio({ status: 401, message: 'JWT expired' }), 'JWT expired');
});

// --- fechas -----------------------------------------------------------------
t('diasEntre basics, month and year boundaries, leap day', () => {
  assert.strictEqual(diasEntre('2026-11-01', '2026-11-06'), 5);
  assert.strictEqual(diasEntre('2026-10-31', '2026-11-01'), 1);
  assert.strictEqual(diasEntre('2026-12-31', '2027-01-01'), 1);
  assert.strictEqual(diasEntre('2028-02-28', '2028-03-01'), 2);   // 2028 is a leap year
  assert.strictEqual(diasEntre('2026-11-01T00:00:00+00:00', '2026-11-06'), 5);
});
t('diasEntre never negative and handles junk', () => {
  assert.strictEqual(diasEntre('2026-11-07', '2026-11-06'), 0);
  assert.strictEqual(diasEntre('nope', '2026-11-06'), null);
  assert.strictEqual(diasEntre(null, '2026-11-06'), null);
});
t('hoyLocalISO uses the local calendar day', () => {
  assert.strictEqual(hoyLocalISO(new Date(2026, 10, 6, 23, 59)), '2026-11-06');
  assert.strictEqual(hoyLocalISO(new Date(2026, 0, 5, 0, 1)), '2026-01-05');
});

// --- describirFrescura ------------------------------------------------------
t('fresh data: no banner', () => {
  const r = describirFrescura('2026-11-05', '2026-11-05', '2026-11-06');
  assert.strictEqual(r.nivel, 'ok'); assert.strictEqual(r.mostrar, false);
});
t('a normal weekend (3 days) is not an alarm', () => {
  const r = describirFrescura('2026-10-23', '2026-10-23', '2026-10-26');   // Fri -> Mon
  assert.strictEqual(r.nivel, 'ok'); assert.strictEqual(r.mostrar, false);
});
t('4 days -> aviso, 6 days -> critico (thresholds are inclusive)', () => {
  assert.strictEqual(describirFrescura('2026-11-02', '2026-11-02', '2026-11-06').nivel, 'aviso');
  assert.strictEqual(describirFrescura('2026-11-01', '2026-11-01', '2026-11-07').nivel, 'critico');
  assert.strictEqual(describirFrescura('2026-11-02', '2026-11-02', '2026-11-05').nivel, 'ok');
});
t('today in this very incident: last data 2026-11-01, today 2026-11-06 -> aviso, 5 days', () => {
  const r = describirFrescura('2026-11-01', '2026-11-01', '2026-11-06');
  assert.strictEqual(r.nivel, 'aviso'); assert.strictEqual(r.peor, 5); assert.strictEqual(r.mostrar, true);
});
t('the worst of the two dates drives the level', () => {
  const r = describirFrescura('2026-11-05', '2026-10-28', '2026-11-06');
  assert.strictEqual(r.nivel, 'critico'); assert.strictEqual(r.peor, 9);
});
t('siembra and costos from different days warns even when both are recent', () => {
  const r = describirFrescura('2026-11-06', '2026-11-03', '2026-11-06');
  assert.strictEqual(r.nivel, 'ok'); assert.strictEqual(r.desfase, 3); assert.strictEqual(r.desfaseAlto, true); assert.strictEqual(r.mostrar, true);
  assert.strictEqual(describirFrescura('2026-11-06', '2026-11-05', '2026-11-06').mostrar, false);
});
t('only one source available (no costs yet)', () => {
  const r = describirFrescura('2026-11-06', null, '2026-11-06');
  assert.strictEqual(r.nivel, 'ok'); assert.strictEqual(r.desfase, 0);
  assert.strictEqual(describirFrescura(null, null, '2026-11-06').nivel, 'sin_datos');
});
t('custom thresholds', () => {
  assert.strictEqual(describirFrescura('2026-11-05', '2026-11-05', '2026-11-06', { aviso: 1 }).nivel, 'aviso');
});

console.log(`\n${n} tests passed`);

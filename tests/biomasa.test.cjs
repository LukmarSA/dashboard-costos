// Run: node tests/biomasa.test.cjs   (no dependencies)
// Differential test: js/biomasa.js must answer exactly like the biomass code written inline in pages/dashboard.html.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const B = require('../js/biomasa.js');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

// ---- extract the dashboard's inline implementation from its source and run it in isolation ----
const html = fs.readFileSync(path.join(__dirname, '..', 'pages', 'dashboard.html'), 'utf8');
const ini = html.indexOf('function corridaInicioISO(r)');
const finFn = html.indexOf('function lbValido(r)');
assert.ok(ini > 0 && finFn > ini, 'dashboard biomass block not found: the inline code moved, update this test');
const fin = html.indexOf('\n}\n', finFn) + 3;
const bloque = html.slice(ini, fin);
const constMatch = html.match(/const _MUESTREO_EDAD_MIN = \d+;[^\n]*\nconst _MUESTREO_SOBREV\s*= \d+;/);
assert.ok(constMatch, 'dashboard thresholds not found');
const LB = html.match(/const _LB_PESO_MIN = [\d.]+;/);
assert.ok(LB, 'dashboard _LB_PESO_MIN not found');
// The block comes from this repository's own page and runs in an isolated vm context; `_gramaje` is the
// dashboard's global sampling table, which the test reassigns for every case.
const vm = require('vm');
const dashCtx = vm.createContext({ _gramaje: {} });
vm.runInContext(bloque, dashCtx);   // the block already contains the thresholds (_MUESTREO_*, _LB_PESO_MIN)
const Dash = (gramaje) => { dashCtx._gramaje = gramaje; return dashCtx; };

t('the dashboard thresholds equal the shared module constants', () => {
  assert.strictEqual(Number(constMatch[0].match(/_MUESTREO_EDAD_MIN = (\d+)/)[1]), B.MUESTREO_EDAD_MIN);
  assert.strictEqual(Number(constMatch[0].match(/_MUESTREO_SOBREV\s*= (\d+)/)[1]), B.MUESTREO_SOBREV);
  assert.strictEqual(Number(LB[0].match(/= ([\d.]+)/)[1]), B.LB_PESO_MIN);
});

// ---- deterministic pseudo-random generator ----
let seed = 20261112;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const iso = d => d.toISOString().slice(0, 10);
const base = Date.UTC(2026, 7, 1);

function caso() {
  const fr = iso(new Date(base + Math.floor(rnd() * 100) * 864e5));
  const edad = pick([0, 1, 5, 20, 34, 35, 36, 45, 60, null, 'x', -3]);
  const cod = pick(['K09', 'L22', 'M05', undefined]);
  const fs = pick(['', fr, iso(new Date(base + Math.floor(rnd() * 100) * 864e5)), null, undefined]);
  const r = {
    corridas: pick([null, undefined, { fecha_siembra: fs, codigo_corrida: pick(['LM01-K09-EN-031', 'LM01-K09-PC-004', '', undefined]) }]),
    fecha_reporte: pick([fr, '', undefined]), edad_dias: edad, piscinas: pick([null, { codigo: cod }])
  };
  const sv = pick([0.55, 0.8, 0.85, 1, 1.5, 1.6, 56, 79.9, 80, 96, 100, null, 'abc', undefined]);
  const g = pick([null, undefined, {
    sobrev: sv, peso: pick([0, 0.5, 3, 2.99, 12.5, 40, null, 'z']), larvas: pick([0, 334600, 858903, null]),
    fmuestreo: pick(['', fr, iso(new Date(base + Math.floor(rnd() * 100) * 864e5)), null, undefined])
  }]);
  const gramaje = {};
  if (cod && g !== undefined) gramaje[cod] = g;
  return { r, gramaje };
}

t('identical answers to the dashboard inline code on 20,000 generated cases', () => {
  let distintos = 0, conBiomasa = 0, total = 20000;
  for (let i = 0; i < total; i++) {
    const { r, gramaje } = caso();
    const dash = Dash(gramaje);
    for (const fn of ['corridaInicioISO', 'gramajeEsViejo', 'biomasaCalc', 'pesoVigente', 'lbValido']) {
      const esperado = dash[fn](r, ...(fn === 'gramajeEsViejo' ? [gramaje[(r.piscinas || {}).codigo] || {}] : []));
      const obtenido = B[fn](r, ...(fn === 'corridaInicioISO' ? [] : fn === 'gramajeEsViejo' ? [gramaje[(r.piscinas || {}).codigo] || {}] : [gramaje]));
      try { assert.deepStrictEqual(obtenido, esperado); } catch (e) { distintos++; if (distintos < 4) console.log('MISMATCH', fn, JSON.stringify({ r, gramaje }), obtenido, esperado); }
    }
    if (B.biomasaCalc(r, gramaje) > 0) conBiomasa++;
  }
  assert.strictEqual(distintos, 0);
  assert.ok(conBiomasa > 300, 'the generator must exercise the positive-biomass branch too (' + conBiomasa + ')');
});

// ---- readable examples of the rules ----
const gram = (o) => ({ K09: Object.assign({ sobrev: 70, peso: 12, larvas: 1000000, fmuestreo: '2026-10-20' }, o) });
const r0 = (o) => Object.assign({ corridas: { fecha_siembra: '2026-10-01', codigo_corrida: 'LM01-K09-EN-031' }, fecha_reporte: '2026-11-01', edad_dias: 31, piscinas: { codigo: 'K09' } }, o);

t('biomass = larvae x survival x weight / 453.592 for a current, plausible sampling', () => {
  const lb = B.biomasaCalc(r0(), gram());
  assert.ok(Math.abs(lb - 1000000 * 0.70 * 12 / 453.592) < 1e-6);
});
t('survival may come as a fraction or as a percentage', () => {
  assert.ok(Math.abs(B.biomasaCalc(r0(), gram({ sobrev: 0.7 })) - B.biomasaCalc(r0(), gram({ sobrev: 70 }))) < 1e-9);
});
t('a sampling older than the current cycle (re-stocked pond) gives no biomass', () => {
  assert.strictEqual(B.biomasaCalc(r0(), gram({ fmuestreo: '2026-09-01' })), 0);
});
t('mature pond whose survival is still the stocking default (>= 80) is excluded', () => {
  assert.strictEqual(B.biomasaCalc(r0({ edad_dias: 40 }), gram({ sobrev: 85 })), 0);
  assert.ok(B.biomasaCalc(r0({ edad_dias: 30 }), gram({ sobrev: 85 })) > 0);
});
t('pre-nursery (PC) cycles are exempt from the suspicious-survival rule', () => {
  const r = r0({ edad_dias: 40, corridas: { fecha_siembra: '2026-10-01', codigo_corrida: 'LM01-K09-PC-004' } });
  assert.ok(B.biomasaCalc(r, gram({ sobrev: 85 })) > 0);
});
t('weight below 3 g is not valid for $/lb or FCR', () => {
  assert.strictEqual(B.lbValido(r0(), gram({ peso: 2.9 })), false);
  assert.strictEqual(B.lbValido(r0(), gram({ peso: 3 })), true);
});

console.log(`\n${n} tests passed`);

// Run: node tests/inteligencia-costos.test.cjs   (no dependencies)
const assert = require('assert');
const IC = require('../js/inteligencia-costos.js');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

// Synthetic cycle as returned by inteligencia_costos().ciclos (numbers invented for the test, not farm data).
function ciclo(o) {
  return Object.assign({
    id: 'c1', cod: 'LM01-T01-EN-001', pis: 'T01', edad: 30, has: 5, x: 7000, op: 5000, lar: 2000, alim: 4400,
    g: { bal: 2500, lar: 2000, mo: 1000, comb: 400, quim: 300, otros: 800 },
    resiembra: false, ref_n: 40, op_rank: 0.5,
    ref_x: [5500, 6200, 7000, 7700, 8500],            // p10 p25 p50 p75 p90 of total $/ha
    ref_op: [3500, 4200, 5000, 5800, 6500],           // same, operating cost
    ref_alim: [3900, 4400, 4900],                     // p25 p50 p75 of accumulated feed lb/ha
    ref_g: { bal: 2500, lar: 2000, mo: 1000, comb: 400, quim: 300, otros: 800 },
    tasa: 100, tasa_ref: 100, proy_n: 30, proy_dq: [1500, 2200, 3000]
  }, o);
}

// ---- classification ----
t('a cycle at the median is normal', () => {
  const v = IC.clasificarCiclo(ciclo());
  assert.strictEqual(v.nivel, 'normal');
  assert.strictEqual(v.opDesvioPct, 0);
  assert.deepStrictEqual(v.motivos, []);
});
t('above the 90th percentile and >= 10 % over the median is alto, with the reason in Spanish', () => {
  const v = IC.clasificarCiclo(ciclo({ op: 6800, op_rank: 0.95 }));
  assert.strictEqual(v.nivel, 'alto');
  assert.strictEqual(Math.round(v.opDesvioPct), 36);
  assert.strictEqual(v.percentil, 95);
  assert.match(v.motivos[0], /36 % sobre lo típico a los 30 días \(percentil 95\)/);
});
t('between the 75th and 90th percentile is atencion; just above p75 but < 5 % over the median is normal', () => {
  assert.strictEqual(IC.clasificarCiclo(ciclo({ op: 6000 })).nivel, 'atencion');
  // percentile band wider than usual: p75 = 5100 is only 2 % above the median
  assert.strictEqual(IC.clasificarCiclo(ciclo({ op: 5200, ref_op: [3500, 4200, 5000, 5100, 6500] })).nivel, 'normal');
});
t('a high p90 does not turn a small gap into an alert (needs >= 10 % over the median too)', () => {
  assert.strictEqual(IC.clasificarCiclo(ciclo({ op: 5400, ref_op: [3500, 4200, 5000, 5100, 5300] })).nivel, 'atencion');
});
t('far below the typical cost is bajo, with a hint to check the data', () => {
  const v = IC.clasificarCiclo(ciclo({ op: 3000, op_rank: 0 }));
  assert.strictEqual(v.nivel, 'bajo');
  assert.match(v.motivos.join(' '), /completos|detenido/);
});
t('too few comparable cycles gives no verdict', () => {
  const v = IC.clasificarCiclo(ciclo({ ref_n: 7, op: 9000 }));
  assert.strictEqual(v.nivel, 'sin_referencia');
  assert.match(v.motivos[0], /Pocos ciclos comparables/);
  assert.strictEqual(IC.clasificarCiclo(ciclo({ ref_op: null })).nivel, 'sin_referencia');
});
t('a re-stocked cycle is never compared with the cohort', () => {
  const v = IC.clasificarCiclo(ciclo({ resiembra: true, op: 9000 }));
  assert.strictEqual(v.nivel, 'resiembra');
  assert.match(v.motivos[0], /re-sembrado/);
});

// ---- drivers, larva, pace, feed ----
t('drivers list the groups above the cohort median, largest first, larva excluded, max 3', () => {
  const v = IC.clasificarCiclo(ciclo({ op: 6800, g: { bal: 3400, lar: 3500, mo: 1300, comb: 750, quim: 300, otros: 1050 } }));
  assert.deepStrictEqual(v.drivers.map(d => d.clave), ['bal', 'comb', 'mo']);   // 'otros' (+250) is the 4th and is cut
  assert.strictEqual(v.drivers[0].usdHa, 900);
  assert.strictEqual(v.larvaDesvioUsdHa, 1500);   // reported apart: a stocking decision, not operating spend
});
t('pace alert needs both the ratio and a minimum $/ha/day gap', () => {
  assert.strictEqual(IC.clasificarCiclo(ciclo({ tasa: 130, tasa_ref: 100 })).aceleracion.alerta, true);
  assert.strictEqual(IC.clasificarCiclo(ciclo({ tasa: 124, tasa_ref: 100 })).aceleracion.alerta, false);
  assert.strictEqual(IC.clasificarCiclo(ciclo({ tasa: 6, tasa_ref: 4 })).aceleracion.alerta, false);   // 1.5x but only $2/ha/day
  assert.strictEqual(IC.clasificarCiclo(ciclo({ tasa: null })).aceleracion, null);
});
t('feed above 120 % or below 80 % of the typical is flagged', () => {
  assert.strictEqual(IC.clasificarCiclo(ciclo({ alim: 5400 })).alimento.nivel, 'alto');
  assert.strictEqual(IC.clasificarCiclo(ciclo({ alim: 3500 })).alimento.nivel, 'bajo');
  assert.strictEqual(IC.clasificarCiclo(ciclo({ alim: 4600 })).alimento.nivel, 'normal');
  assert.match(IC.clasificarCiclo(ciclo({ alim: 5400 })).motivos.join(' '), /Alimento acumulado 23 % sobre/);
});

// ---- forecast ----
t('forecast = today\'s cost per ha + the cohort\'s increments to the target age; total uses the hectares', () => {
  const p = IC.proyectar(ciclo(), 40);
  assert.deepStrictEqual(p.porHa, { p10: 8500, p50: 9200, p90: 10000 });
  assert.deepStrictEqual(p.total, { p10: 42500, p50: 46000, p90: 50000 });
  assert.strictEqual(p.dias, 10); assert.strictEqual(p.n, 30);
});
t('no forecast when the cycle reached the target age, is re-stocked, or lacks comparable cycles', () => {
  assert.strictEqual(IC.proyectar(ciclo({ edad: 40 }), 40), null);
  assert.strictEqual(IC.proyectar(ciclo({ edad: 45 }), 40), null);
  assert.strictEqual(IC.proyectar(ciclo({ resiembra: true }), 40), null);
  assert.strictEqual(IC.proyectar(ciclo({ proy_n: 7 }), 40), null);
  assert.strictEqual(IC.proyectar(ciclo({ proy_dq: null }), 40), null);
});

// ---- table and summary ----
t('rows are ordered alto, atencion, bajo, normal, resiembra, sin_referencia; ties by overspend in $', () => {
  const datos = { edad_objetivo: 40, ciclos: [
    ciclo({ cod: 'N1' }),
    ciclo({ cod: 'R1', resiembra: true }),
    ciclo({ cod: 'A2', op: 6800, has: 2 }),
    ciclo({ cod: 'S1', ref_n: 2 }),
    ciclo({ cod: 'A1', op: 6800, has: 6 }),
    ciclo({ cod: 'B1', op: 3000 }),
    ciclo({ cod: 'T1', op: 6000 })
  ] };
  const filas = IC.analizar(datos);
  assert.deepStrictEqual(filas.map(f => f.ciclo.cod), ['A1', 'A2', 'T1', 'B1', 'N1', 'R1', 'S1']);
});
t('summary counts levels, adds up the operating overspend and the forecast of those that have one', () => {
  const datos = { edad_objetivo: 40, ciclos: [ciclo({ cod: 'A1', op: 6800, has: 6 }), ciclo({ cod: 'N1' }), ciclo({ cod: 'R1', resiembra: true })] };
  const r = IC.resumir(IC.analizar(datos));
  assert.strictEqual(r.total, 3); assert.strictEqual(r.alto, 1); assert.strictEqual(r.normal, 1); assert.strictEqual(r.resiembra, 1);
  assert.strictEqual(r.sobrecostoUsd, (6800 - 5000) * 6);
  assert.strictEqual(r.proyeccion.n, 2);
  assert.strictEqual(r.proyeccion.p50, 9200 * 6 + 9200 * 5);
});
t('empty or missing data does not throw', () => {
  assert.deepStrictEqual(IC.analizar(null), []);
  assert.strictEqual(IC.resumir([]).total, 0);
});

// ---- FCR and formatting ----
t('feed conversion in progress = feed lb / biomass lb; null without reliable biomass', () => {
  assert.strictEqual(IC.fcrEnCurso({ has: 5, alim: 4400 }, 20000), 1.1);
  assert.strictEqual(IC.fcrEnCurso({ has: 5, alim: 4400 }, 0), null);
  assert.strictEqual(IC.fcrEnCurso({ has: 5, alim: 4400 }, null), null);
  assert.strictEqual(IC.fcrEnCurso({ has: 0, alim: 4400 }, 1000), null);
});
t('money and percent formatting', () => {
  assert.strictEqual(IC.usd(12345.6), '$12,346');
  assert.strictEqual(IC.usd(-50), '-$50');
  assert.strictEqual(IC.usd(null), '—');
  assert.strictEqual(IC.pctTxt(12.4, true), '+12 %');
  assert.strictEqual(IC.pctTxt(-8, true), '-8 %');
  assert.strictEqual(IC.pctTxt(undefined), '—');
});

console.log(`\n${n} tests passed`);

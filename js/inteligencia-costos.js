// Cost intelligence: classification, forecast and wording, as pure functions (no DOM, no network),
// so they can be unit-tested. The statistics themselves (cohort percentiles by age, cohort cost
// increments) come from the database function inteligencia_costos(); this file turns them into
// levels, reasons and forecasts. Run the tests with:  node tests/inteligencia-costos.test.cjs
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.InteligenciaCostos = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // Tunable thresholds. The cohort is "other engorde cycles of the same age, not re-stocked".
  var UMBRALES = {
    minRef: 8,          // fewer comparable cycles than this -> no verdict
    altoPct: 10,        // operating cost above the 90th percentile AND at least this % over the median -> alto
    atencionPct: 5,     // above the 75th percentile AND at least this % over the median -> atencion
    bajoPct: 10,        // below the 10th percentile AND at least this % under the median -> bajo
    aceleracion: 1.25,  // last-7-day spend rate vs the cohort's median rate
    aceleracionMinUsd: 5, // ... and at least this many $/ha/day above it (ignores trivial rates)
    alimAlto: 1.20,     // accumulated feed vs the cohort's median
    alimBajo: 0.80
  };

  var GRUPOS = {
    bal: 'Balanceado', mo: 'Mano de obra', comb: 'Combustible', quim: 'Insumos químicos', otros: 'Otros', lar: 'Larva / siembra'
  };

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function pct(a, b) { return (b && isFinite(a) && isFinite(b)) ? (a - b) / b * 100 : null; }

  // Classifies one active cycle against its cohort. `c` is one element of inteligencia_costos().ciclos.
  // ref_op = [p10, p25, p50, p75, p90] of the OPERATING cost per ha (total minus larva/stocking) at the same age.
  function clasificarCiclo(c, u) {
    u = u || UMBRALES;
    var out = {
      nivel: 'sin_referencia', refN: c.ref_n || 0, percentil: null,
      opDesvioPct: null, opDesvioUsdHa: null, totalDesvioPct: null, larvaDesvioUsdHa: null,
      aceleracion: null, alimento: null, drivers: [], motivos: []
    };
    if (c.resiembra) {
      out.nivel = 'resiembra';
      out.motivos.push('Ciclo re-sembrado: su costo incluye la fase anterior, no es comparable con el resto.');
      return out;
    }
    var rop = c.ref_op, op = num(c.op);
    if (!rop || (c.ref_n || 0) < u.minRef || op === null) {
      out.motivos.push('Pocos ciclos comparables a esta edad (' + (c.ref_n || 0) + ').');
      return out;
    }
    var p10 = rop[0], p25 = rop[1], p50 = rop[2], p75 = rop[3], p90 = rop[4];
    var dev = pct(op, p50);
    out.opDesvioPct = dev;
    out.opDesvioUsdHa = op - p50;
    out.percentil = c.op_rank === null || c.op_rank === undefined ? null : Math.round(c.op_rank * 100);
    if (c.ref_x && c.ref_x[2]) out.totalDesvioPct = pct(num(c.x), c.ref_x[2]);

    if (op > p90 && dev >= u.altoPct) out.nivel = 'alto';
    else if (op > p75 && dev >= u.atencionPct) out.nivel = 'atencion';
    else if (op < p10 && dev <= -u.bajoPct) out.nivel = 'bajo';
    else out.nivel = 'normal';

    // Larva / stocking is a decision taken on day 0, so it is reported apart from the operating overspend.
    if (c.ref_g && c.ref_g.lar !== undefined && c.g && c.g.lar !== undefined) out.larvaDesvioUsdHa = num(c.g.lar) - num(c.ref_g.lar);

    // Which cost groups explain the operating gap (positive differences only, larva excluded).
    if (c.ref_g && c.g) {
      Object.keys(GRUPOS).forEach(function (k) {
        if (k === 'lar') return;
        var d = num(c.g[k]) - num(c.ref_g[k]);
        if (isFinite(d) && d > 0) out.drivers.push({ clave: k, grupo: GRUPOS[k], usdHa: d });
      });
      out.drivers.sort(function (a, b) { return b.usdHa - a.usdHa; });
      out.drivers = out.drivers.slice(0, 3);
    }

    var tasa = num(c.tasa), tref = num(c.tasa_ref);
    if (tasa !== null && tref !== null && tref > 0) {
      var ratio = tasa / tref;
      out.aceleracion = { usdHaDia: tasa, ref: tref, ratio: ratio, alerta: ratio >= u.aceleracion && (tasa - tref) >= u.aceleracionMinUsd };
    }
    var ra = c.ref_alim, alim = num(c.alim);
    if (ra && ra[1] > 0 && alim !== null) {
      var r = alim / ra[1];
      out.alimento = { lbHa: alim, mediana: ra[1], ratio: r, nivel: r >= u.alimAlto ? 'alto' : (r <= u.alimBajo ? 'bajo' : 'normal') };
    }

    // Wording
    if (out.nivel === 'alto' || out.nivel === 'atencion') {
      out.motivos.push('Costo operativo ' + dev.toFixed(0) + ' % sobre lo típico a los ' + c.edad + ' días' +
        (out.percentil !== null ? ' (percentil ' + out.percentil + ')' : '') + '.');
    } else if (out.nivel === 'bajo') {
      out.motivos.push('Costo operativo ' + Math.abs(dev).toFixed(0) + ' % bajo lo típico: confirme que los costos estén completos o que el ciclo no esté detenido.');
    }
    if (out.aceleracion && out.aceleracion.alerta) out.motivos.push('Gasto de los últimos 7 días ' + ratio_txt(out.aceleracion.ratio) + ' del ritmo típico.');
    if (out.alimento && out.alimento.nivel === 'alto') out.motivos.push('Alimento acumulado ' + Math.round((out.alimento.ratio - 1) * 100) + ' % sobre lo típico.');
    if (out.alimento && out.alimento.nivel === 'bajo' && out.nivel !== 'bajo') out.motivos.push('Alimento acumulado ' + Math.round((1 - out.alimento.ratio) * 100) + ' % bajo lo típico.');
    return out;
  }
  function ratio_txt(r) { return (r).toFixed(1).replace('.', ',') + ' veces'; }

  // Cost forecast at the target age: today's cost per ha + the cost increments that comparable cycles had between
  // this age and the target (additive method; backtested on closed cycles, see inteligencia_backtest()).
  // proy_dq = [p10, p50, p90] of those increments, per ha.
  function proyectar(c, h, u) {
    u = u || UMBRALES;
    if (c.resiembra || !c.proy_dq || (c.proy_n || 0) < u.minRef || !(c.edad < h)) return null;
    var x = num(c.x), has = num(c.has);
    if (x === null) return null;
    var q = c.proy_dq.map(function (d) { return x + d; });
    var porHa = { p10: q[0], p50: q[1], p90: q[2] };
    var total = has ? { p10: q[0] * has, p50: q[1] * has, p90: q[2] * has } : null;
    return { h: h, dias: h - c.edad, n: c.proy_n, porHa: porHa, total: total };
  }

  var ORDEN = { alto: 0, atencion: 1, resiembra: 4, sin_referencia: 5, normal: 3, bajo: 2 };

  // Rows for the table: each cycle with its verdict, sorted by severity and then by the size of the gap in $.
  function analizar(datos, u) {
    var ciclos = (datos && datos.ciclos) || [], h = datos && datos.edad_objetivo;
    var filas = ciclos.map(function (c) {
      var v = clasificarCiclo(c, u);
      var has = num(c.has) || 0;
      return { ciclo: c, veredicto: v, proyeccion: proyectar(c, h, u), sobrecostoUsd: (v.opDesvioUsdHa > 0 && (v.nivel === 'alto' || v.nivel === 'atencion')) ? v.opDesvioUsdHa * has : 0 };
    });
    filas.sort(function (a, b) {
      var d = ORDEN[a.veredicto.nivel] - ORDEN[b.veredicto.nivel];
      if (d) return d;
      d = b.sobrecostoUsd - a.sobrecostoUsd;
      return d || String(a.ciclo.cod).localeCompare(String(b.ciclo.cod));
    });
    return filas;
  }

  function resumir(filas) {
    var r = { total: filas.length, alto: 0, atencion: 0, normal: 0, bajo: 0, resiembra: 0, sin_referencia: 0, sobrecostoUsd: 0, proyeccion: { n: 0, p10: 0, p50: 0, p90: 0 } };
    filas.forEach(function (f) {
      r[f.veredicto.nivel]++;
      r.sobrecostoUsd += f.sobrecostoUsd;
      if (f.proyeccion && f.proyeccion.total) {
        r.proyeccion.n++; r.proyeccion.p10 += f.proyeccion.total.p10; r.proyeccion.p50 += f.proyeccion.total.p50; r.proyeccion.p90 += f.proyeccion.total.p90;
      }
    });
    return r;
  }

  // Feed conversion in progress = accumulated feed (lb) / current biomass (lb). Null when the biomass is not reliable.
  function fcrEnCurso(c, biomasaLbs) {
    var has = num(c.has), alimHa = num(c.alim), b = num(biomasaLbs);
    if (!has || alimHa === null || !b || b <= 0) return null;
    return (alimHa * has) / b;
  }

  function usd(n, dec) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    var s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 });
    return (n < 0 ? '-$' : '$') + s;
  }
  function pctTxt(n, signo) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return (signo && n > 0 ? '+' : '') + n.toFixed(0) + ' %';
  }

  return { UMBRALES: UMBRALES, GRUPOS: GRUPOS, clasificarCiclo: clasificarCiclo, proyectar: proyectar, analizar: analizar,
           resumir: resumir, fcrEnCurso: fcrEnCurso, usd: usd, pctTxt: pctTxt };
});

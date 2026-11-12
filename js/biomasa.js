// Biomass rules, as pure functions. This is the SAME logic the dashboard uses inline (pages/dashboard.html:
// corridaInicioISO .. lbValido), with the sampling table passed in instead of read from a global, so other pages
// (Inteligencia de costos) can compute the same biomass. tests/biomasa.test.cjs extracts the dashboard's inline code
// and checks both give identical answers on thousands of generated cases, so they cannot drift apart unnoticed.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Biomasa = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  var MUESTREO_EDAD_MIN = 35;   // only mature ponds (culture day above this)
  var MUESTREO_SOBREV   = 80;   // survival at/above this at an advanced age = suspicious (the default carried over from stocking)
  var LB_PESO_MIN       = 3;    // grams: below this the biomass is tiny and $/lb or FCR blow up

  // r: { corridas: { fecha_siembra, codigo_corrida }, fecha_reporte, edad_dias, piscinas: { codigo } }
  // g: { sobrev, peso, larvas, fmuestreo }   gramaje: piscina_codigo -> g
  function corridaInicioISO(r) {
    var inicio = ((r.corridas && r.corridas.fecha_siembra) || '').slice(0, 10);
    var fr = (r.fecha_reporte || '').slice(0, 10);
    var edad = Number(r.edad_dias);
    if (fr && isFinite(edad) && edad >= 0) {
      var d = new Date(fr + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() - edad);
      var derivada = d.toISOString().slice(0, 10);
      if (!inicio || derivada > inicio) inicio = derivada;
    }
    return inicio;
  }
  function gramajeEsViejo(r, g) {
    var inicio = corridaInicioISO(r);
    var fMuestreo = (g.fmuestreo || '').slice(0, 10);
    return !!(inicio && fMuestreo && fMuestreo < inicio);
  }
  function sobrevSospechosa(r, g) {
    var edad = Number(r.edad_dias) || 0;
    if (edad <= MUESTREO_EDAD_MIN) return false;
    if (((r.corridas && r.corridas.codigo_corrida) || '').includes('-PC-')) return false;
    var sv = Number(g && g.sobrev);
    var svPct = sv <= 1.5 ? sv * 100 : sv;
    return isFinite(svPct) && svPct >= MUESTREO_SOBREV;
  }
  // Biomass (lb) = larvae x survival(sampling) x weight / 453.592; 0 when the sampling is not trustworthy.
  function biomasaCalc(r, gramaje) {
    var cod = r.piscinas && r.piscinas.codigo;
    var g = cod ? gramaje[cod] : null;
    if (!g) return 0;
    if (gramajeEsViejo(r, g)) return 0;
    if (sobrevSospechosa(r, g)) return 0;
    var larv = Number(g.larvas) || 0, peso = Number(g.peso) || 0, sv = Number(g.sobrev);
    if (!larv || !peso || !isFinite(sv)) return 0;
    var frac = sv <= 1.5 ? sv : sv / 100;
    return larv * frac * peso / 453.592;
  }
  function pesoVigente(r, gramaje) {
    var cod = r.piscinas && r.piscinas.codigo;
    var g = cod ? gramaje[cod] : null;
    if (!g || gramajeEsViejo(r, g)) return null;
    var p = Number(g.peso);
    return (isFinite(p) && p > 0) ? p : null;
  }
  function lbValido(r, gramaje) {
    var p = pesoVigente(r, gramaje);
    return p != null && p >= LB_PESO_MIN;
  }

  return { corridaInicioISO: corridaInicioISO, gramajeEsViejo: gramajeEsViejo, sobrevSospechosa: sobrevSospechosa,
           biomasaCalc: biomasaCalc, pesoVigente: pesoVigente, lbValido: lbValido,
           MUESTREO_EDAD_MIN: MUESTREO_EDAD_MIN, MUESTREO_SOBREV: MUESTREO_SOBREV, LB_PESO_MIN: LB_PESO_MIN };
});

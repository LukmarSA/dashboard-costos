// ============================================================
// Estado del servicio y frescura de datos (helpers puros, sin DOM)
//  - mensajeErrorServicio(err): texto claro en español para errores de Supabase/red
//  - describirFrescura(...):    cuántos días de atraso tienen los datos y con qué severidad
// Se prueba con: node tests/estado-servicio.test.cjs
// ============================================================

// Convierte cualquier error de Supabase/red en un mensaje que el personal pueda entender.
function mensajeErrorServicio(err) {
  const msg    = String((err && err.message) || err || '');
  const status = err && (err.status != null ? err.status : err.statusCode);
  const code   = err && err.code;

  // 402 = proyecto Supabase restringido (p. ej. exceed_db_size_quota en el plan Free)
  if (status === 402 || /exceed_db_size_quota|service for this project is restricted|payment required/i.test(msg)) {
    return 'El servicio de datos está suspendido temporalmente por límite de almacenamiento. ' +
           'No es un problema de su usuario ni de su contraseña. Avise al administrador del sistema.';
  }
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) {
    return 'Correo o contraseña incorrectos.';
  }
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    return 'No hay conexión con el servidor. Revise su internet e intente de nuevo.';
  }
  if (typeof status === 'number' && status >= 500) {
    return 'El servidor no respondió correctamente (código ' + status + '). Intente de nuevo en unos minutos.';
  }
  return msg || 'No se pudo completar la operación.';
}

// 'YYYY-MM-DD' (o con hora) -> milisegundos UTC de ese día a medianoche
function _diaUTC(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
}

// Días completos entre dos fechas ISO (b - a). Nunca negativo: un reloj adelantado no cuenta como "futuro".
function diasEntre(aISO, bISO) {
  const d = Math.round((_diaUTC(bISO) - _diaUTC(aISO)) / 86400000);
  return Number.isFinite(d) ? Math.max(0, d) : null;
}

// Fecha de hoy según el reloj local del navegador, como 'YYYY-MM-DD'.
function hoyLocalISO(ahora) {
  const d = ahora || new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// Evalúa qué tan viejos son los datos mostrados.
// Un fin de semana sin carga es normal (3 días); más de eso es una señal.
//   ok       : hasta (aviso-1) días
//   aviso    : desde 4 días
//   critico  : desde 6 días
// También detecta cuando Siembra y Costos son de fechas distintas (desfase >= 2 días).
function describirFrescura(fechaSiembra, fechaCostos, hoyISO, umbrales) {
  const u  = Object.assign({ aviso: 4, critico: 6, desfase: 2 }, umbrales || {});
  const dS = fechaSiembra ? diasEntre(fechaSiembra, hoyISO) : null;
  const dC = fechaCostos  ? diasEntre(fechaCostos,  hoyISO) : null;
  const vistos = [dS, dC].filter(d => d != null);
  const peor   = vistos.length ? Math.max.apply(null, vistos) : null;

  let nivel = 'ok';
  if (peor == null)            nivel = 'sin_datos';
  else if (peor >= u.critico)  nivel = 'critico';
  else if (peor >= u.aviso)    nivel = 'aviso';

  const desfase = (dS != null && dC != null) ? Math.abs(dS - dC) : 0;
  return {
    nivel, peor,
    diasSiembra: dS, diasCostos: dC,
    desfase, desfaseAlto: desfase >= u.desfase,
    mostrar: nivel === 'aviso' || nivel === 'critico' || desfase >= u.desfase,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mensajeErrorServicio, describirFrescura, diasEntre, hoyLocalISO };
}

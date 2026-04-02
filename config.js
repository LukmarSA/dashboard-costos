// ============================================================
// Dashboard Costos Piscinas — LUKMAR S.A.
// Configuración central · Sprint 1
// ============================================================

const APP_CONFIG = {
  nombre: 'Dashboard Costos Piscinas',
  empresa: 'LUKMAR S.A.',
  version: '1.0.0-sprint1',
  supabase: {
    url: 'https://TU_PROJECT_ID.supabase.co',       // <-- reemplazar
    anonKey: 'TU_ANON_KEY',                          // <-- reemplazar
  },
};

// ---- Supabase client (CDN) ----------------------------------
// Requiere en el HTML:
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
function getSupabaseClient() {
  if (typeof supabase === 'undefined') {
    throw new Error('Supabase JS no cargado. Verifica el script CDN.');
  }
  return supabase.createClient(
    APP_CONFIG.supabase.url,
    APP_CONFIG.supabase.anonKey
  );
}

// ---- Roles --------------------------------------------------
const ROLES = {
  ADMIN:    'admin',
  CONTADOR: 'contador',
  GERENTE:  'gerente',
};

// ---- Constantes de negocio ----------------------------------
const NEGOCIO = {
  LBS_A_KG: 2.20462,
  PREFIJOS_PISCINA_VALIDOS: ['PS'],   // Solo piscinas PS en Fase 1
  EDAD_MINIMA_DIAS: 1,                // Excluir piscinas con Edad <= 1
};

// ---- Semáforo de días de cultivo ----------------------------
const SEMAFORO_DIAS = [
  { min: 0,  max: 30, clase: 'verde',    label: 'Etapa inicial'   },
  { min: 31, max: 60, clase: 'amarillo', label: 'Etapa media'     },
  { min: 61, max: 999,clase: 'rojo',     label: 'Próx. cosecha'   },
];

function getSemaforoDias(dias) {
  return SEMAFORO_DIAS.find(s => dias >= s.min && dias <= s.max) || SEMAFORO_DIAS[0];
}

// ---- Helpers de formato ------------------------------------
const fmt = {
  num:  (v, dec=2) => v == null ? '—' : Number(v).toLocaleString('es-EC', { minimumFractionDigits: dec, maximumFractionDigits: dec }),
  int:  (v)        => v == null ? '—' : Number(v).toLocaleString('es-EC'),
  usd:  (v, dec=2) => v == null ? '—' : '$' + fmt.num(v, dec),
  pct:  (v, dec=1) => v == null ? '—' : Number(v).toFixed(dec) + '%',
  date: (v)        => v ? new Date(v).toLocaleDateString('es-EC', { day:'2-digit', month:'short', year:'numeric' }) : '—',
};

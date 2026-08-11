// ============================================================
// Dashboard Costos Piscinas — LUKMAR S.A.
// Configuración central · Sprint 1
// ============================================================

const APP_CONFIG = {
  nombre: 'Dashboard Costos Piscinas',
  empresa: 'LUKMAR S.A.',
  version: '1.0.0-sprint1',
  supabase: {
    url: 'https://xupjkihkbvqtzmtrkfff.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1cGpraWhrYnZxdHptdHJrZmZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNDczMDgsImV4cCI6MjA5MDcyMzMwOH0.oBAu8R7n_Az9Pw0ShJABRzZ4bV9i5BQX2TWE-9RIbFo',
  },
};

// ---- Supabase client (CDN) ----------------------------------
// Requiere en el HTML:
// <script src="js/vendor/supabase.min.js?v=2026.08.11.3"></script>
function getSupabaseClient() {
  if (typeof supabase === 'undefined') {
    throw new Error('Supabase JS no cargado. Verifica el archivo local del cliente.');
  }
  return supabase.createClient(
    APP_CONFIG.supabase.url,
    APP_CONFIG.supabase.anonKey
  );
}

async function restaurarPerfilUsuario(sb, user) {
  if (!user?.id) {
    throw new Error('La sesión no contiene un usuario válido.');
  }

  const { data: usuario, error } = await sb.from('usuarios')
    .select('rol, nombre, empresa_id')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    const detalle = [error.message, error.details, error.hint]
      .filter(Boolean)
      .join(' · ');
    throw new Error(
      `No se pudo restaurar el perfil del usuario: ${detalle || error.code || 'error desconocido'}`
    );
  }

  if (!usuario?.empresa_id) {
    throw new Error('Usuario sin perfil o empresa asignada. Contacte al administrador.');
  }

  sessionStorage.setItem('dcp_rol', usuario.rol || 'gerente');
  sessionStorage.setItem('dcp_nombre', usuario.nombre || user.email || 'Usuario');
  sessionStorage.setItem('dcp_empresa', usuario.empresa_id);

  return usuario;
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

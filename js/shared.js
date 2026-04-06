// ============================================================
// Dashboard Costos Piscinas — LUKMAR S.A.
// JS compartido: sidebar, sesión, helpers UI · Sprint 2
// ============================================================

// ---- Sidebar HTML -----------------------------------------
function renderSidebar(paginaActiva) {
  const nombre = sessionStorage.getItem('dcp_nombre') || '—';
  const rol    = sessionStorage.getItem('dcp_rol')    || 'gerente';
  const esAdmin    = rol === 'admin';
  const esContador = rol === 'contador' || esAdmin;

  const items = [
    { seccion: 'Principal' },
    { id: 'dashboard',        href: 'dashboard.html',        icon: iconGrid,    label: 'Resumen general' },
    { id: 'piscinas_proceso', href: 'piscinas_proceso.html', icon: iconClock,   label: 'Piscinas en proceso' },
    ...(esContador ? [
      { seccion: 'Carga de datos' },
      { id: 'importar_siembra', href: 'importar_siembra.html', icon: iconUpload, label: 'Importar siembra' },
      { id: 'importar_costos',  href: 'importar_costos.html',  icon: iconUpload, label: 'Importar costos' },
      { id: 'importaciones',    href: 'importaciones.html',    icon: iconLog,    label: 'Log importaciones' },
    ] : []),
    ...(esContador ? [
      { id: 'presupuesto', href: 'presupuesto.html', icon: iconRubros, label: 'Presupuesto grupos' },
    ] : []),
    ...(esAdmin ? [
      { seccion: 'Administración' },
      { id: 'admin_piscinas',  href: 'admin_piscinas.html',  icon: iconTable,  label: 'Piscinas' },
      { id: 'admin_usuarios',  href: 'admin_usuarios.html',  icon: iconUsers,  label: 'Usuarios' },
      { id: 'admin_rubros',    href: 'admin_rubros.html',    icon: iconRubros, label: 'Rubros $/Has/Día' },
    ] : []),
  ];

  const html = `
    <aside class="sidebar">
      <div class="sidebar-logo">
        <img src="../Logo_Horizontal_Lukmar.png" alt="LUKMAR">
        <div>
          <div class="sidebar-sub">Dashboard Costos</div>
        </div>
      </div>
      ${items.map(item => {
        if (item.seccion) return `<span class="nav-section">${item.seccion}</span>`;
        return `<a class="nav-item ${item.id === paginaActiva ? 'active' : ''}" href="${item.href}">
          ${item.icon}
          ${item.label}
          ${item.badge ? `<span class="nav-badge">${item.badge}</span>` : ''}
        </a>`;
      }).join('')}
      <div class="sidebar-footer">
        <div class="user-chip">
          <div class="user-avatar">${nombre.slice(0,2).toUpperCase()}</div>
          <div>
            <div class="user-name">${nombre}</div>
            <div class="user-rol">${rol.charAt(0).toUpperCase() + rol.slice(1)}</div>
          </div>
        </div>
        <button class="btn-salir" onclick="cerrarSesion()">Cerrar sesión</button>
      </div>
    </aside>`;

  document.getElementById('sidebar-mount').innerHTML = html;
}

// ---- Iconos SVG inline ------------------------------------
const iconGrid    = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>`;
const iconClock   = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 1.5"/></svg>`;
const iconUpload  = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 10V3M5 6l3-3 3 3"/><path d="M2 12h12v2H2z"/></svg>`;
const iconLog     = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4h12M2 8h8M2 12h5"/></svg>`;
const iconTable   = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="3" width="14" height="10" rx="1.5"/><path d="M1 7h14"/></svg>`;
const iconUsers   = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6" cy="5" r="3"/><path d="M1 14c0-3 2-5 5-5h0c3 0 5 2 5 5"/><path d="M11 7c1.7 0 3 1.3 3 3v1"/></svg>`;
const iconRubros  = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4h10M3 8h7M3 12h4"/><circle cx="13" cy="10" r="2.5"/></svg>`;

// ---- Verificar sesión -------------------------------------
async function verificarSesion(sb) {
  const { data } = await sb.auth.getSession();
  if (!data.session) {
    window.location.href = '../index.html';
    return false;
  }
  return true;
}

// ---- Cerrar sesión ----------------------------------------
async function cerrarSesion() {
  const sb = getSupabaseClient();
  await sb.auth.signOut();
  sessionStorage.clear();
  window.location.href = '../index.html';
}

// ---- Toast ------------------------------------------------
function toast(msg, tipo = '') {
  let t = document.getElementById('toast-global');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast-global';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = 'toast visible ' + tipo;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('visible'), 3500);
}

// ---- Semáforo de días -------------------------------------
function semaforoDias(dias) {
  if (dias <= 30) return { clase: 'badge-verde',    label: `${dias} días`, title: 'Etapa inicial' };
  if (dias <= 60) return { clase: 'badge-amarillo', label: `${dias} días`, title: 'Etapa media' };
  return            { clase: 'badge-rojo',           label: `${dias} días`, title: 'Próx. cosecha' };
}

// ---- Formato números --------------------------------------
const F = {
  num:  (v, d=2) => v == null ? '—' : Number(v).toLocaleString('es-EC', { minimumFractionDigits: d, maximumFractionDigits: d }),
  int:  (v)      => v == null ? '—' : Number(v).toLocaleString('es-EC'),
  mill: (v)      => v == null ? '—' : (Number(v)/1000000).toFixed(2) + 'M',
  kg:   (v)      => v == null ? '—' : F.num(v, 0) + ' kg',
  has:  (v)      => v == null ? '—' : Number(v).toFixed(2) + ' has',
  date: (v)      => v ? new Date(v+'T00:00:00').toLocaleDateString('es-EC', { day:'2-digit', month:'short', year:'numeric' }) : '—',
  ts:   (v)      => v ? new Date(v).toLocaleString('es-EC', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '—',
};

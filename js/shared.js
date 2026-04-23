// ============================================================
// LUKMAR Platform — shared.js
// Sidebar escalable por módulos · Roles · Helpers UI
// ============================================================

// ---- MÓDULOS DE LA PLATAFORMA (escalable) ------------------
const MODULOS = [
  {
    id:     'costos_piscinas',
    label:  'Costos Piscinas',
    icon:   `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 12 Q4 6 8 8 Q12 10 14 4"/><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/></svg>`,
    activo: true,
    path:   'pages/',
  },
  {
    id:     'costos_mantenimiento',
    label:  'Costos Mantenimiento',
    icon:   `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13.5 2.5l-2 2-1.5-1.5 2-2a3 3 0 00-4 4L3 10.5a1.5 1.5 0 002 2L10 7.5a3 3 0 004-4z"/></svg>`,
    activo: false,
  },
  {
    id:     'registro_comidas',
    label:  'Registro de Comidas',
    icon:   `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 2v5a3 3 0 006 0V2M8 9v5M6 14h4"/></svg>`,
    activo: false,
  },
  {
    id:     'nomina',
    label:  'Nómina',
    icon:   `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6" cy="5" r="3"/><path d="M1 14c0-3 2-5 5-5"/><path d="M11 9l1.5 1.5L15 8"/></svg>`,
    activo: false,
  },
];

// ---- SIDEBAR -----------------------------------------------
function renderSidebar(paginaActiva) {
  const nombre     = sessionStorage.getItem('dcp_nombre') || '—';
  const rol        = sessionStorage.getItem('dcp_rol')    || 'gerente';
  const esAdmin    = rol === 'admin';
  const esContador = rol === 'contador' || esAdmin;

  const items = [
    { seccion: 'Principal' },
    { id: 'dashboard', href: 'dashboard.html', icon: iconGrid, label: 'Resumen general' },
    ...(esContador ? [
      { seccion: 'Carga de datos' },
      { id: 'importar_siembra',     href: 'importar_siembra.html',     icon: iconUpload, label: 'Importar siembra' },
      { id: 'importar_costos',      href: 'importar_costos.html',      icon: iconUpload, label: 'Importar costos' },
      { id: 'importaciones',        href: 'importaciones.html',        icon: iconLog,    label: 'Log importaciones' },
      { id: 'presupuesto',          href: 'presupuesto.html',          icon: iconRubros, label: 'Presupuesto grupos' },
      { id: 'clasificar_productos', href: 'clasificar_productos.html', icon: iconTable,  label: 'Clasificar productos' },
    ] : []),
    ...(esAdmin ? [
      { seccion: 'Administración' },
      { id: 'admin_piscinas', href: 'admin_piscinas.html', icon: iconTable,  label: 'Piscinas' },
      { id: 'admin_usuarios', href: 'admin_usuarios.html', icon: iconUsers,  label: 'Usuarios' },
      { id: 'admin_rubros',   href: 'admin_rubros.html',   icon: iconRubros, label: 'Rubros $/Has/Día' },
    ] : []),
  ];

  const html = `
    <aside class="sidebar">
      <div class="sidebar-logo">
        <img src="../Logo_Horizontal_Lukmar.png" alt="LUKMAR">
        <div><div class="sidebar-sub">Dashboard Costos</div></div>
      </div>
      <div class="sidebar-nav">
        ${items.map(item => {
          if (item.seccion) return `<span class="nav-section">${item.seccion}</span>`;
          return `<a class="nav-item ${item.id === paginaActiva ? 'active' : ''}" href="${item.href}">
            ${item.icon}${item.label}
          </a>`;
        }).join('')}
      </div>
      <div class="sidebar-footer">
        <div class="user-chip">
          <div class="user-avatar">${nombre.slice(0,2).toUpperCase()}</div>
          <div>
            <div class="user-name">${nombre}</div>
            <div class="user-rol">${rolLabel(rol)}</div>
          </div>
        </div>
        <button class="btn-salir" onclick="cerrarSesion()">Cerrar sesión</button>
      </div>
    </aside>`;

  document.getElementById('sidebar-mount').innerHTML = html;
}

function rolLabel(rol) {
  const labels = { admin: 'Administrador', contador: 'Contador Costos', gerente: 'Gerente' };
  return labels[rol] || rol;
}

function cambiarModulo(moduloId) {
  sessionStorage.setItem('dcp_modulo', moduloId);
  window.location.href = 'dashboard.html';  // ya estamos en pages/
}

function mostrarProximamente() {
  // Toast informativo
  if (typeof toast === 'function') toast('Este módulo estará disponible próximamente.', 'info');
}

// ---- ICONOS SVG --------------------------------------------
const iconGrid    = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>`;
const iconClock   = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 1.5"/></svg>`;
const iconUpload  = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 10V3M5 6l3-3 3 3"/><path d="M2 12h12v2H2z"/></svg>`;
const iconLog     = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4h12M2 8h8M2 12h5"/></svg>`;
const iconTable   = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="3" width="14" height="10" rx="1.5"/><path d="M1 7h14"/></svg>`;
const iconUsers   = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6" cy="5" r="3"/><path d="M1 14c0-3 2-5 5-5h0c3 0 5 2 5 5"/><path d="M11 7c1.7 0 3 1.3 3 3v1"/></svg>`;
const iconRubros  = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4h10M3 8h7M3 12h4"/><circle cx="13" cy="10" r="2.5"/></svg>`;
const iconShield  = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2L3 4v4c0 3 2.5 5 5 6 2.5-1 5-3 5-6V4L8 2z"/></svg>`;

// ---- VERIFICAR SESIÓN --------------------------------------
async function verificarSesion(sb) {
  const { data } = await sb.auth.getSession();
  if (!data.session) { window.location.href = '../index.html'; return false; }
  const emp = sessionStorage.getItem('dcp_empresa');
  if (!emp) { window.location.href = '../index.html'; return false; }
  return true;
}

// ---- GUARD DE ROL ------------------------------------------
function requireRol(rolesPermitidos) {
  const rol = sessionStorage.getItem('dcp_rol') || 'gerente';
  if (!rolesPermitidos.includes(rol)) {
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:'Montserrat',sans-serif">
        <div style="text-align:center;color:#213653">
          <div style="font-size:48px;margin-bottom:16px">🔒</div>
          <div style="font-size:18px;font-weight:700;margin-bottom:8px">Acceso restringido</div>
          <div style="font-size:13px;color:#7A8FA6;margin-bottom:24px">No tienes permisos para acceder a esta sección.</div>
          <a href="dashboard.html" style="background:#213653;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:12px;font-weight:600">Volver al dashboard</a>
        </div>
      </div>`;
    return false;
  }
  return true;
}

// ---- CERRAR SESIÓN -----------------------------------------
async function cerrarSesion() {
  const sb = getSupabaseClient();
  await sb.auth.signOut();
  sessionStorage.clear();
  window.location.href = '../index.html';
}

// ---- HELPERS UI --------------------------------------------
const F = {
  num:  (v, d=0) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }),
  abr:  v => v >= 1e6 ? '$' + (v/1e6).toFixed(2) + 'M' : v >= 1e3 ? '$' + (v/1e3).toFixed(1) + 'K' : '$' + Number(v).toFixed(2),
  date: s => s ? new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : '—',
  pct:  (v, t) => t > 0 ? (v/t*100).toFixed(1) + '%' : '—',
};

function semaforoDias(dias) {
  if (dias <= 0)  return { clase: 'badge-gris',    label: 'Preparación' };
  if (dias <= 30) return { clase: 'badge-azul',    label: 'Cría' };
  if (dias <= 60) return { clase: 'badge-verde',   label: 'Engorde' };
  if (dias <= 90) return { clase: 'badge-amarillo',label: 'Cosecha próxima' };
  return             { clase: 'badge-rojo',     label: 'Cosecha urgente' };
}

function toast(msg, tipo = 'info') {
  const colores = { success: '#27AE60', error: '#E74C3C', warning: '#F39C12', info: '#2980B9' };
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:24px;right:24px;background:${colores[tipo]||colores.info};color:white;padding:10px 18px;border-radius:8px;font-family:'Montserrat',sans-serif;font-size:12px;font-weight:600;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.15);animation:slideUp 0.2s ease`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

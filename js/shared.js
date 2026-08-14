// ============================================================
// LUKMAR Platform — shared.js
// Sidebar escalable por módulos · Roles · Helpers UI
// ============================================================

// ---- Cache-busting: propaga el ?build= de la pagina actual a los links del sidebar ----
function withBuild(href) {
  try {
    var b = new URLSearchParams(location.search).get('build');
    return b ? href + (href.indexOf('?') >= 0 ? '&' : '?') + 'build=' + b : href;
  } catch (e) { return href; }
}


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
    { id: 'dashboard', href: 'dashboard.html', icon: iconDashboard, label: 'Resumen general' },
    ...(esContador ? [
      { seccion: 'Carga de datos' },
      { id: 'importar_siembra',     href: 'importar_siembra.html',     icon: iconSprout,  label: 'Importar siembra' },
      { id: 'importar_costos',      href: 'importar_costos.html',      icon: iconCoins,   label: 'Importar costos' },
      { id: 'importaciones',        href: 'importaciones.html',        icon: iconHistory, label: 'Log importaciones' },
      { id: 'presupuesto',          href: 'presupuesto.html',          icon: iconPie,     label: 'Presupuesto grupos' },
      { id: 'clasificar_productos', href: 'clasificar_productos.html', icon: iconTags,    label: 'Clasificar productos' },
    ] : []),
    ...(esAdmin ? [
      { seccion: 'Administración' },
      { id: 'admin_piscinas', href: 'admin_piscinas.html', icon: iconWaves,   label: 'Piscinas' },
      { id: 'admin_usuarios', href: 'admin_usuarios.html', icon: iconUsers,   label: 'Usuarios' },
      { id: 'admin_rubros',   href: 'admin_rubros.html',   icon: iconSliders, label: 'Rubros $/Has/Día' },
    ] : []),
  ];

  const html = `
    <div class="sidebar-backdrop" onclick="closeSidebar()"></div>
    <aside class="sidebar" id="appDrawer">
      <div class="sidebar-head">
        <div class="sidebar-logo">
          <img src="../Logo_Horizontal_Lukmar.png" alt="LUKMAR">
          <div class="sidebar-sub">Dashboard Costos</div>
        </div>
        <button class="sidebar-close" onclick="closeSidebar()" aria-label="Cerrar menú">${iconClose}</button>
      </div>
      <nav class="sidebar-nav">
        ${items.map(item => {
          if (item.seccion) return `<span class="nav-section">${item.seccion}</span>`;
          return `<a class="nav-item ${item.id === paginaActiva ? 'active' : ''}" href="${withBuild(item.href)}">
            <span class="nav-ico">${item.icon}</span><span class="nav-label">${item.label}</span>
          </a>`;
        }).join('')}
      </nav>
      <div class="sidebar-footer">
        <div class="user-chip">
          <div class="user-avatar">${nombre.slice(0,2).toUpperCase()}</div>
          <div style="min-width:0">
            <div class="user-name">${nombre}</div>
            <div class="user-rol">${rolLabel(rol)}</div>
          </div>
        </div>
        <button class="btn-salir" onclick="cerrarSesion()">${iconLogout}Cerrar sesión</button>
      </div>
    </aside>`;

  document.getElementById('sidebar-mount').innerHTML = html;

  // Inyecta el botón hamburguesa al inicio de la cabecera (sin tocar cada HTML).
  // Preferimos .topbar-brand para que quede agrupado con el logo a la izquierda.
  const host = document.querySelector('.topbar-brand') || document.querySelector('.topbar');
  if (host && !host.querySelector('.sidebar-toggle')) {
    host.insertAdjacentHTML('afterbegin',
      `<button class="sidebar-toggle" onclick="toggleSidebar()" aria-label="Abrir menú">${iconMenu}</button>`);
  }
}

// ---- DRAWER: abrir / cerrar --------------------------------
function toggleSidebar() {
  const d = document.getElementById('appDrawer');
  if (!d) return;
  const abierto = d.classList.toggle('open');
  document.querySelector('.sidebar-backdrop')?.classList.toggle('open', abierto);
  document.body.classList.toggle('drawer-open', abierto);
}
function closeSidebar() {
  document.getElementById('appDrawer')?.classList.remove('open');
  document.querySelector('.sidebar-backdrop')?.classList.remove('open');
  document.body.classList.remove('drawer-open');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSidebar(); });

function rolLabel(rol) {
  const labels = { admin: 'Administrador', contador: 'Contador Costos', gerente: 'Gerente' };
  return labels[rol] || rol;
}

function cambiarModulo(moduloId) {
  sessionStorage.setItem('dcp_modulo', moduloId);
  navigateWithBuild('dashboard.html');  // ya estamos en pages/
}

function mostrarProximamente() {
  // Toast informativo
  if (typeof toast === 'function') toast('Este módulo estará disponible próximamente.', 'info');
}

// ---- ICONOS SVG (estilo Lucide: 24x24, stroke 2, redondeado) ----
const _sv = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const iconDashboard = `<svg ${_sv}><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>`;
const iconSprout    = `<svg ${_sv}><path d="M7 20h10"/><path d="M10 20c5.5-2.5.8-6.4 3-10"/><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z"/><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z"/></svg>`;
const iconCoins     = `<svg ${_sv}><circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/></svg>`;
const iconHistory   = `<svg ${_sv}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>`;
const iconPie       = `<svg ${_sv}><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>`;
const iconTags      = `<svg ${_sv}><path d="m15 5 6.3 6.3a2.4 2.4 0 0 1 0 3.4L17 19"/><path d="M9.586 5.586A2 2 0 0 0 8.172 5H3a1 1 0 0 0-1 1v5.172a2 2 0 0 0 .586 1.414L8.29 18.29a2.426 2.426 0 0 0 3.42 0l3.58-3.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="6.5" cy="9.5" r=".5" fill="currentColor"/></svg>`;
const iconWaves     = `<svg ${_sv}><path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/></svg>`;
const iconUsers     = `<svg ${_sv}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
const iconSliders   = `<svg ${_sv}><line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/></svg>`;
const iconMenu      = `<svg ${_sv}><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/></svg>`;
const iconClose     = `<svg ${_sv}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
const iconLogout    = `<svg ${_sv}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>`;

// ---- VERIFICAR SESIÓN --------------------------------------
async function verificarSesion(sb) {
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  if (!data.session) { navigateWithBuild('../index.html'); return false; }

  const perfilCompleto = [
    'dcp_rol',
    'dcp_nombre',
    'dcp_empresa',
  ].every(key => sessionStorage.getItem(key));

  if (!perfilCompleto) {
    await restaurarPerfilUsuario(sb, data.session.user);
  }

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
          <a href="${withBuild('dashboard.html')}" style="background:#213653;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:12px;font-weight:600">Volver al dashboard</a>
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
  navigateWithBuild('../index.html');
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

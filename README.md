# Dashboard Costos Piscinas — LUKMAR S.A.
**Sprint 1 · Fundación del proyecto**

---

## Estructura de archivos

```
dashboard-costos-piscinas/
├── index.html                    ← Login (punto de entrada)
├── js/
│   └── config.js                 ← Configuración central (Supabase keys, helpers)
├── pages/
│   ├── admin_piscinas.html       ← Admin inclusión/exclusión de piscinas ✅
│   ├── dashboard.html            ← Resumen general (Sprint 2)
│   ├── piscinas_proceso.html     ← Vista piscinas activas (Sprint 3)
│   ├── admin_usuarios.html       ← Gestión de usuarios (Sprint 7)
│   ├── importaciones.html        ← Log de importaciones (Sprint 2)
│   └── admin_rubros.html         ← Configuración rubros $/Has/Día (Sprint 5)
└── supabase_schema_sprint1.sql   ← Script SQL completo para Supabase
```

---

## Pasos para activar el Sprint 1

### 1. Crear proyecto en Supabase
- Ir a https://supabase.com → New project
- Nombre: `dashboard-costos-piscinas`
- Región: `us-east-1` (más cercana a Ecuador)
- Anotar: **Project URL** y **anon public key**

### 2. Ejecutar el schema SQL
- En Supabase → SQL Editor → pegar contenido de `supabase_schema_sprint1.sql`
- Ejecutar. Verificar que las 6 tablas se crearon sin errores.

### 3. Configurar las credenciales
- Abrir `js/config.js`
- Reemplazar:
  ```js
  url: 'https://TU_PROJECT_ID.supabase.co',
  anonKey: 'TU_ANON_KEY',
  ```

### 4. Crear el usuario administrador
- En Supabase → Authentication → Users → Add user
  - Email: `oscar@eqsoluciones.com` (o el que prefieras)
  - Password: contraseña segura
  - Copiar el UUID generado
- En SQL Editor ejecutar:
  ```sql
  insert into usuarios (id, empresa_id, nombre, rol)
  select
    '<UUID-DEL-USER>',
    id,
    'Oscar Ramírez',
    'admin'
  from empresas where nombre = 'LUKMAR S.A.' limit 1;
  ```

### 5. Publicar en GitHub Pages
```bash
git init
git add .
git commit -m "Sprint 1: fundación, login y admin piscinas"
git remote add origin https://github.com/TU_USUARIO/dashboard-costos-piscinas.git
git push -u origin main
```
- En GitHub → Settings → Pages → Source: `main` → `/root`
- URL resultante: `https://TU_USUARIO.github.io/dashboard-costos-piscinas/`

---

## Tablas creadas en Sprint 1

| Tabla | Propósito |
|---|---|
| `empresas` | Multiempresa (LUKMAR S.A. inicial) |
| `usuarios` | Extiende auth.users con rol y empresa |
| `piscinas` | Maestro de piscinas con flag `incluida` |
| `corridas` | Ciclos de cultivo por piscina |
| `siembra_diaria` | Snapshot diario por piscina (Fase 1) |
| `importaciones_log` | Auditoría de cargas de archivos |

## Roles

| Rol | Acceso |
|---|---|
| `admin` | Todo: configuración, usuarios, piscinas, importaciones |
| `contador` | Carga de reportes, asignación de clasificaciones |
| `gerente` | Solo lectura: dashboard y reportes |

---

## Próximo — Sprint 2
- Parser JS para `ListadoResumenSiembra_*.xlsx` (SheetJS)
- UI de carga manual (drag-and-drop)
- Upsert a tabla `siembra_diaria`
- Log de importaciones con detalle de piscinas omitidas
- Primera versión del dashboard con datos reales de LUKMAR

---

## Transformaciones clave del reporte de siembra

| Campo | Columna ACOSUX | Fórmula |
|---|---|---|
| Has | `Has.` | Directo |
| Días | `Edad` + `Días Secos` | Suma |
| Larvas Totales | `N.Larvas` | Directo |
| Kg Balanceado | `Balanceado` (lbs) | ÷ 2.20462 |

**Filtro de piscinas**: solo filas donde `Pisc.` empieza con `PS` y `Edad > 1`.

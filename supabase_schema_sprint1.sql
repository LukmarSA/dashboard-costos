-- ============================================================
-- Dashboard Costos Piscinas — LUKMAR S.A.
-- Schema Supabase · Sprint 1
-- Ejecutar en: Supabase > SQL Editor
-- ============================================================

-- ---- 1. EMPRESAS -------------------------------------------
create table if not exists empresas (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  ruc         text,
  activa      boolean default true,
  created_at  timestamptz default now()
);

-- Insertar LUKMAR S.A. como empresa inicial
insert into empresas (nombre, ruc)
values ('LUKMAR S.A.', '0992839473001')
on conflict do nothing;

-- ---- 2. USUARIOS -------------------------------------------
-- Extiende auth.users de Supabase
create table if not exists usuarios (
  id          uuid primary key references auth.users(id) on delete cascade,
  empresa_id  uuid references empresas(id),
  nombre      text,
  rol         text not null check (rol in ('admin', 'contador', 'gerente')),
  activo      boolean default true,
  created_at  timestamptz default now()
);

-- ---- 3. PISCINAS -------------------------------------------
-- Maestro de piscinas con flag de inclusión/exclusión
create table if not exists piscinas (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid references empresas(id),
  codigo          text not null,          -- ej: PS605
  nombre          text,                   -- nombre descriptivo opcional
  sector          text,                   -- ej: LKM
  has_referencia  numeric(6,2),           -- Has de referencia (puede variar por corrida)
  incluida        boolean default true,   -- FALSE = excluida del dashboard
  motivo_exclusion text,                  -- Razón de exclusión (visible para admin)
  excluida_por    uuid references usuarios(id),
  excluida_en     timestamptz,
  created_at      timestamptz default now(),
  unique (empresa_id, codigo)
);

-- ---- 4. CORRIDAS -------------------------------------------
-- Cada ciclo de cultivo de una piscina
create table if not exists corridas (
  id              uuid primary key default gen_random_uuid(),
  piscina_id      uuid references piscinas(id),
  codigo_corrida  text not null,          -- ej: PS605-E-32
  fecha_siembra   date,
  fecha_desde     date,                   -- inicio seguimiento ACOSUX
  estado          text default 'en_proceso' check (estado in ('en_proceso','cosechada','cancelada')),
  created_at      timestamptz default now(),
  unique (piscina_id, codigo_corrida)
);

-- ---- 5. SIEMBRA DIARIA -------------------------------------
-- Una fila por piscina por fecha de reporte
create table if not exists siembra_diaria (
  id              uuid primary key default gen_random_uuid(),
  corrida_id      uuid references corridas(id),
  piscina_id      uuid references piscinas(id),
  empresa_id      uuid references empresas(id),
  fecha_reporte   date not null,          -- fecha del archivo cargado
  -- Campos del reporte de siembra (transformados)
  has             numeric(6,2),
  edad_dias       integer,                -- columna "Edad"
  dias_secos      integer,                -- columna "Días Secos"
  dias_totales    integer,                -- edad_dias + dias_secos
  larvas_totales  bigint,                 -- columna "N.Larvas"
  balanceado_lbs  numeric(12,2),          -- columna "Balanceado" (original en lbs)
  balanceado_kg   numeric(12,2),          -- balanceado_lbs / 2.20462
  -- Metadatos
  importacion_id  uuid,                   -- referencia al log de importación
  created_at      timestamptz default now(),
  unique (piscina_id, fecha_reporte)      -- una foto por piscina por día
);

-- ---- 6. IMPORTACIONES LOG ----------------------------------
create table if not exists importaciones_log (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid references empresas(id),
  tipo            text not null check (tipo in ('siembra', 'costos')),
  nombre_archivo  text,
  fecha_reporte   date,
  usuario_id      uuid references usuarios(id),
  registros_total integer,
  registros_ok    integer,
  registros_omitidos integer,
  estado          text default 'ok' check (estado in ('ok','error','parcial')),
  detalle_error   text,
  created_at      timestamptz default now()
);

-- ---- ROW LEVEL SECURITY ------------------------------------

alter table empresas        enable row level security;
alter table usuarios        enable row level security;
alter table piscinas        enable row level security;
alter table corridas        enable row level security;
alter table siembra_diaria  enable row level security;
alter table importaciones_log enable row level security;

-- Función helper: obtener rol del usuario autenticado
create or replace function get_mi_rol()
returns text language sql security definer as $$
  select rol from usuarios where id = auth.uid()
$$;

-- Función helper: obtener empresa del usuario autenticado
create or replace function get_mi_empresa()
returns uuid language sql security definer as $$
  select empresa_id from usuarios where id = auth.uid()
$$;

-- Políticas: todos los roles autenticados leen su empresa
create policy "usuarios leen piscinas de su empresa"
  on piscinas for select
  using (empresa_id = get_mi_empresa());

create policy "admin y contador escriben piscinas"
  on piscinas for all
  using (empresa_id = get_mi_empresa() and get_mi_rol() in ('admin','contador'));

create policy "usuarios leen corridas de su empresa"
  on corridas for select
  using (piscina_id in (select id from piscinas where empresa_id = get_mi_empresa()));

create policy "usuarios leen siembra de su empresa"
  on siembra_diaria for select
  using (empresa_id = get_mi_empresa());

create policy "contador y admin insertan siembra"
  on siembra_diaria for insert
  with check (empresa_id = get_mi_empresa() and get_mi_rol() in ('admin','contador'));

create policy "todos leen su log de importaciones"
  on importaciones_log for select
  using (empresa_id = get_mi_empresa());

create policy "admin lee todos los usuarios de su empresa"
  on usuarios for select
  using (empresa_id = get_mi_empresa() and get_mi_rol() = 'admin');

create policy "usuario lee su propio registro"
  on usuarios for select
  using (id = auth.uid());

-- ---- ÍNDICES -----------------------------------------------
create index if not exists idx_siembra_piscina_fecha on siembra_diaria(piscina_id, fecha_reporte desc);
create index if not exists idx_siembra_empresa_fecha on siembra_diaria(empresa_id, fecha_reporte desc);
create index if not exists idx_piscinas_empresa      on piscinas(empresa_id, incluida);
create index if not exists idx_corridas_piscina      on corridas(piscina_id, estado);

-- ============================================================
-- INSTRUCCIONES POST-EJECUCIÓN
-- ============================================================
-- 1. En Supabase > Authentication > Users: crear usuario admin
--    Email: oscar@eqsoluciones.com · contraseña segura
-- 2. Insertar registro en tabla usuarios:
--    insert into usuarios (id, empresa_id, nombre, rol)
--    values ('<uuid-del-user-auth>', '<uuid-de-lukmar>', 'Oscar Ramírez', 'admin');
-- 3. Verificar en Table Editor que las tablas existen correctamente
-- ============================================================

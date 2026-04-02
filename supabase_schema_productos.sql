-- ============================================================
-- Dashboard Costos Piscinas — LUKMAR S.A.
-- Schema complemento: Maestro de Productos y Clasificación
-- Ejecutar en: Supabase > SQL Editor > New query
-- ============================================================

-- ---- 1. CATÁLOGO DE CLASIFICACIÓN -------------------------
-- Tabla normalizada de Grupos, Subgrupos y Categorías
-- Permite agregar nuevas combinaciones sin tocar el código

create table if not exists clasificacion_catalogo (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid references empresas(id),
  grupo       text not null,
  subgrupo    text,
  categoria   text,
  activo      boolean default true,
  orden       integer default 0,        -- para ordenar en UI
  created_at  timestamptz default now(),
  unique (empresa_id, grupo, subgrupo, categoria)
);

-- Valores iniciales para LUKMAR S.A. (basados en el Excel analizado)
insert into clasificacion_catalogo (empresa_id, grupo, subgrupo, categoria, orden)
select
  e.id,
  v.grupo, v.subgrupo, v.categoria, v.orden
from empresas e,
(values
  ('Larva',            null,           'Materia Prima',          1),
  ('Juveniles',        null,           'Materia Prima',          2),
  ('Balanceado',       null,           'Materia Prima',          3),
  ('Insumos Quimicos', null,           'Materia Prima',          4),
  ('Personal',         null,           'Costos de Producción',   5),
  ('Operativo',        null,           'Costos de Producción',   6),
  ('Mantenimiento',    null,           'Costos de Producción',   7),
  ('Depreciación',     null,           'Costos de Producción',   8),
  ('Otros Costos',     null,           'Costos de Producción',   9),
  ('Gastos',           null,           'Costos de Producción',  10)
) as v(grupo, subgrupo, categoria, orden)
where e.nombre = 'LUKMAR S.A.'
on conflict do nothing;

-- ---- 2. MAESTRO DE PRODUCTOS ------------------------------
-- Productos importados desde ACOSUX (hoja "Base Codigos")
-- La clasificación Grupo/Subgrupo/Categoría es manual (contador)

create table if not exists productos (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid references empresas(id),
  -- Datos que vienen de ACOSUX (no editar manualmente)
  codigo              text not null,
  nombre              text not null,
  detalle             text,
  medida              text,             -- KILOGRAMOS, UNIDAD, etc.
  categoria_acosux    text,             -- Categoría original en ACOSUX
  tipo_acosux         text,             -- INVENTARIO / MATERIAL DIRECTO, etc.
  cuenta_consumo      text,             -- Código contable de consumo
  cuenta_nombre       text,             -- Nombre de la cuenta contable
  inactivo            boolean default false,
  -- Clasificación manual asignada por el Contador
  grupo               text,             -- ej: Balanceado, Personal, Operativo
  subgrupo            text,             -- opcional
  categoria           text,             -- ej: Materia Prima, Costos de Producción
  clasificado_por     uuid references usuarios(id),
  clasificado_en      timestamptz,
  -- Control
  fuente              text default 'acosux',
  ultima_importacion  timestamptz,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  unique (empresa_id, codigo)
);

-- ---- 3. CONFIGURACIÓN DE RUBROS $/Has/Día -----------------
-- Define qué grupos componen cada rubro de análisis
-- Permite cambiar el agrupamiento sin tocar el código

create table if not exists rubros_config (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid references empresas(id),
  rubro       text not null,            -- ej: 'Indirectos'
  grupo       text not null,            -- ej: 'Personal', 'Operativo'
  activo      boolean default true,
  orden       integer default 0,
  vigente_desde date default current_date,
  created_by  uuid references usuarios(id),
  created_at  timestamptz default now(),
  unique (empresa_id, rubro, grupo)
);

-- Configuración inicial: Indirectos = Personal + Operativo + Mantenimiento
-- + Depreciación + Otros Costos + Gastos  (exactamente como el Excel)
insert into rubros_config (empresa_id, rubro, grupo, orden)
select
  e.id,
  'Indirectos' as rubro,
  v.grupo,
  v.orden
from empresas e,
(values
  ('Personal',      1),
  ('Operativo',     2),
  ('Mantenimiento', 3),
  ('Depreciación',  4),
  ('Otros Costos',  5),
  ('Gastos',        6)
) as v(grupo, orden)
where e.nombre = 'LUKMAR S.A.'
on conflict do nothing;

-- ---- 4. LOG DE CAMBIOS EN CLASIFICACIÓN -------------------
-- Auditoría: quién cambió qué y cuándo en la clasificación

create table if not exists productos_clasificacion_log (
  id              uuid primary key default gen_random_uuid(),
  producto_id     uuid references productos(id),
  usuario_id      uuid references usuarios(id),
  campo           text,                 -- 'grupo', 'subgrupo', 'categoria'
  valor_anterior  text,
  valor_nuevo     text,
  created_at      timestamptz default now()
);

-- ---- RLS PARA TABLAS NUEVAS --------------------------------

alter table clasificacion_catalogo      enable row level security;
alter table productos                   enable row level security;
alter table rubros_config               enable row level security;
alter table productos_clasificacion_log enable row level security;

-- Todos los roles de la empresa leen el catálogo
create policy "todos leen clasificacion catalogo"
  on clasificacion_catalogo for select
  using (empresa_id = get_mi_empresa());

create policy "admin gestiona clasificacion catalogo"
  on clasificacion_catalogo for all
  using (empresa_id = get_mi_empresa() and get_mi_rol() = 'admin');

-- Todos los roles leen productos
create policy "todos leen productos"
  on productos for select
  using (empresa_id = get_mi_empresa());

-- Admin y contador pueden insertar/actualizar productos
create policy "admin y contador gestionan productos"
  on productos for all
  using (empresa_id = get_mi_empresa() and get_mi_rol() in ('admin','contador'));

-- Rubros: todos leen, solo admin modifica
create policy "todos leen rubros config"
  on rubros_config for select
  using (empresa_id = get_mi_empresa());

create policy "admin gestiona rubros config"
  on rubros_config for all
  using (empresa_id = get_mi_empresa() and get_mi_rol() = 'admin');

-- Log: todos pueden leer, sistema inserta
create policy "todos leen log clasificacion"
  on productos_clasificacion_log for select
  using (producto_id in (
    select id from productos where empresa_id = get_mi_empresa()
  ));

create policy "contador y admin insertan log"
  on productos_clasificacion_log for insert
  with check (get_mi_rol() in ('admin','contador'));

-- ---- ÍNDICES -----------------------------------------------
create index if not exists idx_productos_empresa       on productos(empresa_id, codigo);
create index if not exists idx_productos_grupo         on productos(empresa_id, grupo);
create index if not exists idx_productos_sin_clasificar on productos(empresa_id) where grupo is null;
create index if not exists idx_rubros_empresa_rubro    on rubros_config(empresa_id, rubro, activo);

-- ---- TRIGGER: updated_at en productos ----------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_productos_updated_at
  before update on productos
  for each row execute function set_updated_at();

-- ============================================================
-- RESUMEN DE TABLAS AHORA DISPONIBLES
-- ============================================================
-- Schema Sprint 1 (anterior):
--   empresas, usuarios, piscinas, corridas,
--   siembra_diaria, importaciones_log
--
-- Complemento (este script):
--   clasificacion_catalogo   → catálogo de Grupo/Subgrupo/Categoría
--   productos                → maestro ACOSUX + clasificación manual
--   rubros_config            → agrupamiento $/Has/Día (Indirectos, etc.)
--   productos_clasificacion_log → auditoría de cambios
-- ============================================================

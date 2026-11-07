-- Consolidated, FINAL form of what was applied to project xupjkihkbvqtzmtrkfff on 2026-11-06/07 (several steps, see below).
--
-- WHY: the Free plan limit is 500 MB and the database had reached 1,421 MB: costos_piscina alone was 1,390 MB
-- (4.05M rows = 124 daily snapshots of ~32k rows, each repeating ~78% of the previous day). The disk was so full that a
-- query failed with "No space left on device". The robot adds ~11 MB per day, so a one-off prune would only buy weeks.
--
-- WHAT: a compact, LOSSLESS history that stores only the rows that CHANGE from one snapshot to the next (costos_hist),
-- a registry with a fingerprint of every original snapshot (costos_hist_fechas), and a daily job that registers old
-- snapshot dates and then deletes full snapshots outside a 7-date window, but only after checking that the original rows
-- AND the rows rebuilt from the history still match the fingerprint taken at registration. Any day can be rebuilt with
-- costos_asof(fecha). Not preserved: the surrogate columns id and created_at of old rows.
--
-- STEP 0 (emergency, applied first): free disk by dropping indexes of the big table. They are rebuilt after the prune.
--   drop index idx_costos_piscina_fecha, idx_costos_producto, idx_costos_corrida, idx_costos_grupo,
--             idx_costos_piscina_emp_fecha, idx_costos_empresa_fecha;     -- the last two were exact duplicates
--   alter table costos_piscina drop constraint costos_piscina_pkey;
--   alter table costos_piscina drop constraint costos_piscina_corrida_id_producto_codigo_fecha_reporte_key;
--   create index idx_costos_fecha_empresa on costos_piscina (fecha_reporte, empresa_id);   -- date lookups
--
-- LESSONS (each cost hours; kept here so they are not repeated):
--  * plpgsql switches to a generic plan after ~5 executions in a session. For date-filtered queries on a 4M-row table
--    that is orders of magnitude slower, so every function below sets plan_cache_mode = force_custom_plan.
--  * "select distinct fecha_reporte" over 4M rows takes 8 s warm; costos_fechas() probes the index per date (0.2 s).
--  * "v_prev is null or fecha_reporte > v_prev" cannot be folded in a generic plan and scanned millions of index entries;
--    the guard is written as two plain range conditions.
--  * Verification at registration must not re-read the history table: entries are staged in a temp table first.
--  * A day-by-day replay of the history into a scratch table bloats it (autovacuum is throttled); do not use it here.
--  * The Free-plan instance has bursty, throttled CPU/disk: run heavy work one statement at a time.

create table if not exists public.costos_hist (
  corrida_id      uuid    not null,
  producto_codigo text    not null,
  fecha_desde     date    not null,                 -- first snapshot date with this state
  presente        boolean not null default true,    -- false = the row no longer appears from this date on
  valor           numeric,
  grupo           text,
  subgrupo        text,
  categoria       text,
  piscina_id      uuid,   -- stored because 17,957 rows have a piscina_id different from their cycle's
  empresa_id      uuid,
  primary key (corrida_id, producto_codigo, fecha_desde)
);
create index if not exists costos_hist_fecha_desde_idx on public.costos_hist (fecha_desde);

create table if not exists public.costos_hist_fechas (
  fecha          date primary key,
  filas          bigint  not null,
  suma_valor     numeric not null,
  huella         text    not null,
  compactada_en  timestamptz not null default now()
);

-- Direct full-rebuild checks (see verificar_costos_muestra)
create table if not exists public.costos_hist_verif (
  fecha         date primary key,
  ok            boolean not null,
  filas_rebuilt bigint,
  filas_reg     bigint,
  verificada_en timestamptz not null default now()
);

alter table public.costos_hist        enable row level security;
alter table public.costos_hist_fechas enable row level security;
alter table public.costos_hist_verif  enable row level security;
revoke all on public.costos_hist, public.costos_hist_fechas, public.costos_hist_verif from public, anon, authenticated;

comment on table public.costos_hist is
  'Historial compacto de costos_piscina: solo filas que cambian entre snapshots. Reconstruir un dia con costos_asof(fecha).';

-- Snapshot dates, found by probing the (fecha_reporte, empresa_id) index once per date.
create or replace function public.costos_fechas()
 returns setof date
 language sql
 stable
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode to 'force_custom_plan'
as $$
  with recursive d(f) as (
    (select min(c0.fecha_reporte) from public.costos_piscina c0)
    union all
    select (select min(c.fecha_reporte) from public.costos_piscina c where c.fecha_reporte > d.f)
    from d where d.f is not null
  )
  select f from d where f is not null
$$;

-- Fingerprint (row count, sum of valor, md5 over every business column) of the ORIGINAL snapshot of one date.
create or replace function public.costos_huella(p_fecha date)
 returns table(filas bigint, suma numeric, huella text)
 language sql stable
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode to 'force_custom_plan'
as $$
  select count(*), coalesce(sum(c.valor), 0),
         md5(coalesce(string_agg(
           coalesce(c.corrida_id::text, '\N') || '|' || c.producto_codigo || '|' || coalesce(c.valor::text, '\N') || '|' ||
           coalesce(c.grupo, '\N') || '|' || coalesce(c.subgrupo, '\N') || '|' || coalesce(c.categoria, '\N') || '|' ||
           coalesce(c.piscina_id::text, '\N') || '|' || coalesce(c.empresa_id::text, '\N'),
           E'\n' order by c.corrida_id, c.producto_codigo), ''))
  from public.costos_piscina c
  where c.fecha_reporte = p_fecha
$$;

-- The snapshot of a date rebuilt from the history.
create or replace function public.costos_asof(p_fecha date)
 returns table(corrida_id uuid, producto_codigo text, valor numeric, grupo text, subgrupo text,
               categoria text, piscina_id uuid, empresa_id uuid)
 language sql stable
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode to 'force_custom_plan'
as $$
  select h.corrida_id, h.producto_codigo, h.valor, h.grupo, h.subgrupo, h.categoria, h.piscina_id, h.empresa_id
  from (
    select distinct on (x.corrida_id, x.producto_codigo) x.*
    from public.costos_hist x
    where x.fecha_desde <= p_fecha
    order by x.corrida_id, x.producto_codigo, x.fecha_desde desc
  ) h
  where h.presente
$$;

create or replace function public.costos_huella_hist(p_fecha date)
 returns table(filas bigint, suma numeric, huella text)
 language sql stable
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode to 'force_custom_plan'
as $$
  select count(*), coalesce(sum(a.valor), 0),
         md5(coalesce(string_agg(
           coalesce(a.corrida_id::text, '\N') || '|' || a.producto_codigo || '|' || coalesce(a.valor::text, '\N') || '|' ||
           coalesce(a.grupo, '\N') || '|' || coalesce(a.subgrupo, '\N') || '|' || coalesce(a.categoria, '\N') || '|' ||
           coalesce(a.piscina_id::text, '\N') || '|' || coalesce(a.empresa_id::text, '\N'),
           E'\n' order by a.corrida_id, a.producto_codigo), ''))
  from public.costos_asof(p_fecha) a
$$;

-- Register one snapshot date. Must run in date order. Verifies BEFORE writing: (previous original snapshot with this date's
-- entries applied) must equal the original snapshot of this date (rows, sum, md5 of every business column).
create or replace function public.compactar_costos_fecha(p_fecha date)
 returns json
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode to 'force_custom_plan'
as $function$
declare
  v_prev   date;
  v_nuevos bigint := 0;
  v_gone   bigint := 0;
  v_o      record;
  v_rf     bigint;
  v_rs     numeric;
  v_rh     text;
begin
  if exists (select 1 from public.costos_hist_fechas hf where hf.fecha = p_fecha) then
    return json_build_object('fecha', p_fecha, 'estado', 'ya_registrada');
  end if;
  if not exists (select 1 from public.costos_piscina cp where cp.fecha_reporte = p_fecha) then
    raise exception 'No hay snapshot de costos para %', p_fecha;
  end if;

  select max(hf.fecha) into v_prev from public.costos_hist_fechas hf where hf.fecha < p_fecha;

  -- order guard: no unregistered snapshot between the previous registered date and this one
  if v_prev is null then
    if exists (select 1 from public.costos_piscina cp where cp.fecha_reporte < p_fecha) then
      raise exception 'Hay fechas sin registrar antes de %; registrar en orden', p_fecha;
    end if;
  else
    if exists (select 1 from public.costos_piscina cp where cp.fecha_reporte > v_prev and cp.fecha_reporte < p_fecha) then
      raise exception 'Hay fechas sin registrar antes de %; registrar en orden', p_fecha;
    end if;
  end if;

  create temp table if not exists pg_temp._e (like public.costos_hist) on commit drop;
  truncate pg_temp._e;

  if v_prev is null then
    insert into pg_temp._e(corrida_id, producto_codigo, fecha_desde, presente, valor, grupo, subgrupo, categoria, piscina_id, empresa_id)
    select cur.corrida_id, cur.producto_codigo, p_fecha, true, cur.valor, cur.grupo, cur.subgrupo, cur.categoria, cur.piscina_id, cur.empresa_id
    from public.costos_piscina cur
    where cur.fecha_reporte = p_fecha;
    get diagnostics v_nuevos = row_count;
  else
    insert into pg_temp._e(corrida_id, producto_codigo, fecha_desde, presente, valor, grupo, subgrupo, categoria, piscina_id, empresa_id)
    select cur.corrida_id, cur.producto_codigo, p_fecha, true, cur.valor, cur.grupo, cur.subgrupo, cur.categoria, cur.piscina_id, cur.empresa_id
    from public.costos_piscina cur
    left join public.costos_piscina prv
      on prv.corrida_id = cur.corrida_id and prv.producto_codigo = cur.producto_codigo and prv.fecha_reporte = v_prev
    where cur.fecha_reporte = p_fecha
      and (prv.id is null
           or (cur.valor, cur.grupo, cur.subgrupo, cur.categoria, cur.piscina_id, cur.empresa_id)
              is distinct from (prv.valor, prv.grupo, prv.subgrupo, prv.categoria, prv.piscina_id, prv.empresa_id));
    get diagnostics v_nuevos = row_count;

    insert into pg_temp._e(corrida_id, producto_codigo, fecha_desde, presente)
    select prv.corrida_id, prv.producto_codigo, p_fecha, false
    from public.costos_piscina prv
    left join public.costos_piscina cur
      on cur.corrida_id = prv.corrida_id and cur.producto_codigo = prv.producto_codigo and cur.fecha_reporte = p_fecha
    where prv.fecha_reporte = v_prev and cur.id is null;
    get diagnostics v_gone = row_count;
  end if;

  analyze pg_temp._e;

  select * into v_o from public.costos_huella(p_fecha);

  select count(*), coalesce(sum(x.valor), 0),
         md5(coalesce(string_agg(
           coalesce(x.corrida_id::text, '\N') || '|' || x.producto_codigo || '|' || coalesce(x.valor::text, '\N') || '|' ||
           coalesce(x.grupo, '\N') || '|' || coalesce(x.subgrupo, '\N') || '|' || coalesce(x.categoria, '\N') || '|' ||
           coalesce(x.piscina_id::text, '\N') || '|' || coalesce(x.empresa_id::text, '\N'),
           E'\n' order by x.corrida_id, x.producto_codigo), ''))
    into v_rf, v_rs, v_rh
  from (
    select pr.corrida_id, pr.producto_codigo, pr.valor, pr.grupo, pr.subgrupo, pr.categoria, pr.piscina_id, pr.empresa_id
    from public.costos_piscina pr
    where v_prev is not null and pr.fecha_reporte = v_prev
      and not exists (select 1 from pg_temp._e e
                      where e.corrida_id = pr.corrida_id and e.producto_codigo = pr.producto_codigo)
    union all
    select e.corrida_id, e.producto_codigo, e.valor, e.grupo, e.subgrupo, e.categoria, e.piscina_id, e.empresa_id
    from pg_temp._e e
    where e.presente
  ) x;

  if v_o.filas is distinct from v_rf or v_o.suma is distinct from v_rs or v_o.huella is distinct from v_rh then
    raise exception 'El historial no reproduce el snapshot de % (filas % vs %)', p_fecha, v_o.filas, v_rf;
  end if;

  insert into public.costos_hist(corrida_id, producto_codigo, fecha_desde, presente, valor, grupo, subgrupo, categoria, piscina_id, empresa_id)
  select corrida_id, producto_codigo, fecha_desde, presente, valor, grupo, subgrupo, categoria, piscina_id, empresa_id
  from pg_temp._e;

  insert into public.costos_hist_fechas(fecha, filas, suma_valor, huella) values (p_fecha, v_o.filas, v_o.suma, v_o.huella);
  return json_build_object('fecha', p_fecha, 'estado', 'registrada', 'filas_snapshot', v_o.filas,
                           'entradas_nuevas_o_cambiadas', v_nuevos, 'entradas_ausentes', v_gone);
end;
$function$;

-- Registers pending dates oldest-first (at most p_max per call), leaving the newest p_fechas_recientes dates alone.
create or replace function public.registrar_costos_pendientes(p_max integer default 10, p_fechas_recientes integer default 3)
 returns json
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode to 'force_custom_plan'
as $function$
declare
  v_fecha date;
  v_lim   date;
  v_n     int := 0;
  v_res   jsonb := '[]'::jsonb;
begin
  select t.f into v_lim from public.costos_fechas() as t(f) order by t.f desc offset p_fechas_recientes limit 1;
  if v_lim is null then
    return json_build_object('registradas', 0, 'pendientes', 0);
  end if;

  for v_fecha in
    select d.f from public.costos_fechas() as d(f)
    where d.f <= v_lim
      and not exists (select 1 from public.costos_hist_fechas h where h.fecha = d.f)
    order by d.f
    limit p_max
  loop
    v_res := v_res || to_jsonb(public.compactar_costos_fecha(v_fecha));
    v_n := v_n + 1;
  end loop;

  return json_build_object(
    'registradas', v_n,
    'pendientes', (select count(*) from public.costos_fechas() as d(f)
                   where d.f <= v_lim and not exists (select 1 from public.costos_hist_fechas h where h.fecha = d.f)),
    'detalle', v_res);
end;
$function$;

-- Daily maintenance: register old dates, then delete full snapshots outside the newest p_ventana dates, but only when the
-- original rows AND the rows rebuilt from the history still match the fingerprint taken at registration.
-- Anything else is reported in 'conflictos' and NOT deleted (e.g. an old file was imported again).
create or replace function public.mantener_costos(p_ventana integer default 7, p_fechas_recientes integer default 3)
 returns json
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode to 'force_custom_plan'
as $function$
declare
  v_fecha  date;
  v_lim    date;
  v_reg    json;
  v_borr   int := 0;
  v_filas  bigint := 0;
  v_n      bigint;
  v_conf   text[] := '{}';
  v_o      record;
  v_r      record;
  v_g      record;
begin
  if p_ventana < 5 or p_fechas_recientes < 2 then
    raise exception 'p_ventana debe ser >= 5 y p_fechas_recientes >= 2';
  end if;

  v_reg := public.registrar_costos_pendientes(100000, p_fechas_recientes);

  select t.f into v_lim from public.costos_fechas() as t(f) order by t.f desc offset p_ventana limit 1;

  for v_fecha in
    select d.f from public.costos_fechas() as d(f)
    where v_lim is not null and d.f <= v_lim
    order by d.f
  loop
    select * into v_g from public.costos_hist_fechas hf where hf.fecha = v_fecha;
    if not found then
      v_conf := v_conf || (v_fecha::text || ':sin_registro');
      continue;
    end if;
    select * into v_o from public.costos_huella(v_fecha);
    if v_o.filas is distinct from v_g.filas or v_o.suma is distinct from v_g.suma_valor or v_o.huella is distinct from v_g.huella then
      v_conf := v_conf || (v_fecha::text || ':cambio_despues_de_registrar');
      continue;
    end if;
    select * into v_r from public.costos_huella_hist(v_fecha);
    if v_r.filas is distinct from v_g.filas or v_r.suma is distinct from v_g.suma_valor or v_r.huella is distinct from v_g.huella then
      v_conf := v_conf || (v_fecha::text || ':historial_no_coincide');
      continue;
    end if;
    delete from public.costos_piscina cp where cp.fecha_reporte = v_fecha;
    get diagnostics v_n = row_count;
    v_filas := v_filas + v_n;
    v_borr  := v_borr + 1;
  end loop;

  return json_build_object('registro', v_reg, 'fechas_borradas', v_borr, 'filas_borradas', v_filas,
                           'conflictos', to_json(v_conf), 'ventana', p_ventana);
end;
$function$;

-- Direct full-rebuild check of a few dates from the inductive range (dates registered by the incremental check).
create or replace function public.verificar_costos_muestra(p_max integer default 1)
 returns json
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode to 'force_custom_plan'
as $function$
declare
  v_muestra date[] := array['2026-09-26', '2026-10-05', '2026-10-15', '2026-10-28']::date[];
  v_fecha   date;
  v_n       int := 0;
  g         record;
  r         record;
begin
  for v_fecha in
    select d from unnest(v_muestra) as d
    where not exists (select 1 from public.costos_hist_verif v where v.fecha = d)
    order by d
    limit p_max
  loop
    select * into g from public.costos_hist_fechas hf where hf.fecha = v_fecha;
    select * into r from public.costos_huella_hist(v_fecha);
    insert into public.costos_hist_verif(fecha, ok, filas_rebuilt, filas_reg)
    values (v_fecha, r.filas = g.filas and r.suma = g.suma_valor and r.huella = g.huella, r.filas, g.filas);
    v_n := v_n + 1;
  end loop;
  return json_build_object('verificadas_ahora', v_n,
    'ok',        (select count(*) from public.costos_hist_verif where ok),
    'fallidas',  (select count(*) from public.costos_hist_verif where not ok),
    'pendientes', (select count(*) from unnest(v_muestra) d where not exists (select 1 from public.costos_hist_verif v where v.fecha = d)));
end;
$function$;

revoke execute on function public.costos_fechas(), public.costos_huella(date), public.costos_asof(date),
  public.costos_huella_hist(date), public.compactar_costos_fecha(date), public.registrar_costos_pendientes(integer, integer),
  public.mantener_costos(integer, integer), public.verificar_costos_muestra(integer) from public, anon, authenticated;
grant execute on function public.costos_fechas(), public.costos_huella(date), public.costos_asof(date),
  public.costos_huella_hist(date), public.compactar_costos_fecha(date), public.registrar_costos_pendientes(integer, integer),
  public.mantener_costos(integer, integer), public.verificar_costos_muestra(integer) to service_role;

-- STATE AT THE TIME OF WRITING (2026-11-07): the 121 snapshot dates older than the newest 3 are registered; the prune of
-- costos_piscina and the daily schedule of mantener_costos() have NOT been executed yet (see 20261107_costos_hist_chain_verify.sql
-- for the later changes: entries checksum, cheaper daily gate, chain verification, verificar_costos_muestra dropped).
-- While the prune is pending, costos_piscina has no primary key and no unique upsert key (dropped in STEP 0 to free disk):
-- they must be recreated after the prune:
--   alter table public.costos_piscina add constraint costos_piscina_pkey primary key (id);
--   alter table public.costos_piscina add constraint costos_piscina_corrida_id_producto_codigo_fecha_reporte_key
--     unique (corrida_id, producto_codigo, fecha_reporte);
--   create index idx_costos_corrida on public.costos_piscina (corrida_id, fecha_reporte);
--   create index idx_costos_grupo   on public.costos_piscina (empresa_id, grupo);

-- Applied to project xupjkihkbvqtzmtrkfff on 2026-11-07. Apply AFTER 20261107_costos_hist_chain_verify.sql.
-- Sections 1, 3 and 4 are migrations that were applied as-is. Section 2 is DOCUMENTATION of a ONE-TIME operation that was
-- already executed: do NOT run it again.

-- 1) Helpers (migration costos_hist_verify_one_date_20261107)
create or replace function public.verificar_costos_fecha(p_fecha date)
 returns json
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode to 'force_custom_plan'
as $function$
declare
  v_prev date;
  v_f    bigint;
  v_s    numeric;
  v_h    text;
  v_g    record;
  v_ok   boolean;
begin
  select * into v_g from public.costos_hist_fechas h where h.fecha = p_fecha;
  if not found then
    raise exception 'La fecha % no esta registrada', p_fecha;
  end if;
  select max(h.fecha) into v_prev from public.costos_hist_fechas h where h.fecha < p_fecha;

  create temp table if not exists pg_temp._c (like public.costos_hist) on commit drop;
  truncate pg_temp._c;
  insert into pg_temp._c(corrida_id, producto_codigo, fecha_desde, presente, valor, grupo, subgrupo, categoria, piscina_id, empresa_id)
  select e.corrida_id, e.producto_codigo, e.fecha_desde, e.presente, e.valor, e.grupo, e.subgrupo, e.categoria, e.piscina_id, e.empresa_id
  from public.costos_hist e where e.fecha_desde = p_fecha;
  analyze pg_temp._c;

  select count(*), coalesce(sum(x.valor), 0),
         md5(coalesce(string_agg(
           coalesce(x.corrida_id::text, '\N') || '|' || x.producto_codigo || '|' || coalesce(x.valor::text, '\N') || '|' ||
           coalesce(x.grupo, '\N') || '|' || coalesce(x.subgrupo, '\N') || '|' || coalesce(x.categoria, '\N') || '|' ||
           coalesce(x.piscina_id::text, '\N') || '|' || coalesce(x.empresa_id::text, '\N'),
           E'\n' order by x.corrida_id, x.producto_codigo), ''))
    into v_f, v_s, v_h
  from (
    select pr.corrida_id, pr.producto_codigo, pr.valor, pr.grupo, pr.subgrupo, pr.categoria, pr.piscina_id, pr.empresa_id
    from public.costos_piscina pr
    where v_prev is not null and pr.fecha_reporte = v_prev
      and not exists (select 1 from pg_temp._c c where c.corrida_id = pr.corrida_id and c.producto_codigo = pr.producto_codigo)
    union all
    select c.corrida_id, c.producto_codigo, c.valor, c.grupo, c.subgrupo, c.categoria, c.piscina_id, c.empresa_id
    from pg_temp._c c where c.presente
  ) x;

  v_ok := v_f = v_g.filas and v_s = v_g.suma_valor and v_h = v_g.huella;
  insert into public.costos_hist_verif(fecha, ok, filas_rebuilt, filas_reg) values (p_fecha, v_ok, v_f, v_g.filas)
  on conflict (fecha) do update set ok = excluded.ok, filas_rebuilt = excluded.filas_rebuilt, filas_reg = excluded.filas_reg, verificada_en = now();
  return json_build_object('fecha', p_fecha, 'ok', v_ok, 'filas_reconstruidas', v_f, 'filas_registro', v_g.filas);
end;
$function$;

create or replace function public.completar_huella_entradas(p_max integer default 20)
 returns json
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode to 'force_custom_plan'
as $function$
declare
  v_fecha date;
  v_n     int := 0;
begin
  for v_fecha in
    select h.fecha from public.costos_hist_fechas h where h.huella_entradas is null order by h.fecha limit p_max
  loop
    update public.costos_hist_fechas h set huella_entradas = public.costos_huella_entradas(v_fecha) where h.fecha = v_fecha;
    v_n := v_n + 1;
  end loop;
  return json_build_object('completadas_ahora', v_n,
    'pendientes', (select count(*) from public.costos_hist_fechas h where h.huella_entradas is null));
end;
$function$;

revoke execute on function public.verificar_costos_fecha(date), public.completar_huella_entradas(integer) from public, anon, authenticated;
grant  execute on function public.verificar_costos_fecha(date), public.completar_huella_entradas(integer) to service_role;

-- 2) ONE-TIME prune, ALREADY EXECUTED (documentation only). Result: costos_piscina went from 4,049,780 rows (124 dates) to
--    224,231 rows (7 dates, 2026-10-23 .. 2026-11-01); database 1,421 MB -> 391 MB (375 MB after step 3).
--    a) copy the newest 7 dates aside and compare fingerprints (all 7 identical):
--         create table public.costos_keep as
--           select * from public.costos_piscina
--           where fecha_reporte in (select t.f from public.costos_fechas() as t(f) order by t.f desc limit 7);
--    b) one transaction (DO block): gates (>= 121 registered dates, every registered date independently verified,
--       entries checksum present, every date to be removed registered) -> TRUNCATE costos_piscina ->
--       INSERT INTO costos_piscina SELECT * FROM costos_keep -> compare row count and per-date md5 fingerprint with the copy.
--       Any failed gate or mismatch raises and rolls back the TRUNCATE too (TRUNCATE is transactional in PostgreSQL).

-- 3) Restore what was dropped in the disk emergency (migration costos_piscina_restore_constraints_20261107)
alter table public.costos_piscina add constraint costos_piscina_pkey primary key (id);
alter table public.costos_piscina add constraint costos_piscina_corrida_id_producto_codigo_fecha_reporte_key
  unique (corrida_id, producto_codigo, fecha_reporte);          -- the robot's ON CONFLICT upsert key
create index if not exists idx_costos_corrida on public.costos_piscina (corrida_id, fecha_reporte);
create index if not exists idx_costos_grupo   on public.costos_piscina (empresa_id, grupo);
-- idx_costos_fecha_empresa (fecha_reporte, empresa_id) already exists and replaces the two duplicate (empresa_id, fecha_reporte) indexes.
-- Not recreated: idx_costos_piscina_fecha (0 scans in its lifetime) and idx_costos_producto (3 scans).
drop table if exists public.costos_keep;
analyze public.costos_piscina;

-- 4) Daily maintenance at 12:00 UTC (07:00 Ecuador). To stop: select cron.unschedule('mantener-costos');
select cron.schedule('mantener-costos', '0 12 * * *', $cron$select public.mantener_costos()$cron$);

-- Applied to project xupjkihkbvqtzmtrkfff on 2026-11-07 (migration name: costos_hist_chain_verify_20261107).
-- Apply AFTER 20261106_costos_hist.sql. It supersedes compactar_costos_fecha and mantener_costos from that file and drops
-- verificar_costos_muestra (a direct full rebuild takes over 2 minutes on the Free-plan instance, so it is unusable).
--
-- 1) Cheap, strong gates that do not need the heavy full rebuild.
-- 2) verificar_costos_cadena: independent check of the PERSISTED entries, date by date (previous original + entries == original).
-- 3) Registration also stores a checksum of the entries (huella_entradas).
-- 4) Daily maintenance gate: original rows still match the registry AND stored entries still match the certified checksum.
--
-- NOT applied yet (waiting for approval): verificar_costos_fecha(date) and completar_huella_entradas(integer).
-- The existing 121 registered dates still have huella_entradas = NULL; mantener_costos reports them as 'sin_huella_de_entradas'
-- (and deletes nothing) until completar_huella_entradas has filled them after verification.

alter table public.costos_hist_fechas add column if not exists huella_entradas text;

-- md5 of one date's stored history entries
create or replace function public.costos_huella_entradas(p_fecha date)
 returns text
 language sql
 stable
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode to 'force_custom_plan'
as $$
  select md5(coalesce(string_agg(
    coalesce(e.corrida_id::text, '\N') || '|' || e.producto_codigo || '|' || e.presente::text || '|' ||
    coalesce(e.valor::text, '\N') || '|' || coalesce(e.grupo, '\N') || '|' || coalesce(e.subgrupo, '\N') || '|' ||
    coalesce(e.categoria, '\N') || '|' || coalesce(e.piscina_id::text, '\N') || '|' || coalesce(e.empresa_id::text, '\N'),
    E'\n' order by e.corrida_id, e.producto_codigo), ''))
  from public.costos_hist e
  where e.fecha_desde = p_fecha
$$;

create or replace function public.verificar_costos_cadena(p_max integer default 10)
 returns json
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode to 'force_custom_plan'
as $function$
declare
  v_fecha date;
  v_prev  date;
  v_n     int := 0;
  v_f     bigint;
  v_s     numeric;
  v_h     text;
  v_g     record;
  v_ok    boolean;
begin
  for v_fecha in
    select h.fecha from public.costos_hist_fechas h
    where not exists (select 1 from public.costos_hist_verif v where v.fecha = h.fecha)
    order by h.fecha
    limit p_max
  loop
    select max(h.fecha) into v_prev from public.costos_hist_fechas h where h.fecha < v_fecha;

    create temp table if not exists pg_temp._c (like public.costos_hist) on commit drop;
    truncate pg_temp._c;
    insert into pg_temp._c(corrida_id, producto_codigo, fecha_desde, presente, valor, grupo, subgrupo, categoria, piscina_id, empresa_id)
    select e.corrida_id, e.producto_codigo, e.fecha_desde, e.presente, e.valor, e.grupo, e.subgrupo, e.categoria, e.piscina_id, e.empresa_id
    from public.costos_hist e where e.fecha_desde = v_fecha;
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

    select * into v_g from public.costos_hist_fechas h where h.fecha = v_fecha;
    v_ok := v_f = v_g.filas and v_s = v_g.suma_valor and v_h = v_g.huella;
    insert into public.costos_hist_verif(fecha, ok, filas_rebuilt, filas_reg) values (v_fecha, v_ok, v_f, v_g.filas);
    v_n := v_n + 1;
    exit when not v_ok;
  end loop;

  return json_build_object('verificadas_ahora', v_n,
    'ok',        (select count(*) from public.costos_hist_verif where ok),
    'fallidas',  (select count(*) from public.costos_hist_verif where not ok),
    'pendientes', (select count(*) from public.costos_hist_fechas h where not exists (select 1 from public.costos_hist_verif v where v.fecha = h.fecha)));
end;
$function$;

-- Registration now stores the entries checksum too.
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
  v_he     text;
begin
  if exists (select 1 from public.costos_hist_fechas hf where hf.fecha = p_fecha) then
    return json_build_object('fecha', p_fecha, 'estado', 'ya_registrada');
  end if;
  if not exists (select 1 from public.costos_piscina cp where cp.fecha_reporte = p_fecha) then
    raise exception 'No hay snapshot de costos para %', p_fecha;
  end if;

  select max(hf.fecha) into v_prev from public.costos_hist_fechas hf where hf.fecha < p_fecha;

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

  select md5(coalesce(string_agg(
    coalesce(e.corrida_id::text, '\N') || '|' || e.producto_codigo || '|' || e.presente::text || '|' ||
    coalesce(e.valor::text, '\N') || '|' || coalesce(e.grupo, '\N') || '|' || coalesce(e.subgrupo, '\N') || '|' ||
    coalesce(e.categoria, '\N') || '|' || coalesce(e.piscina_id::text, '\N') || '|' || coalesce(e.empresa_id::text, '\N'),
    E'\n' order by e.corrida_id, e.producto_codigo), ''))
    into v_he
  from pg_temp._e e;

  insert into public.costos_hist(corrida_id, producto_codigo, fecha_desde, presente, valor, grupo, subgrupo, categoria, piscina_id, empresa_id)
  select corrida_id, producto_codigo, fecha_desde, presente, valor, grupo, subgrupo, categoria, piscina_id, empresa_id
  from pg_temp._e;

  insert into public.costos_hist_fechas(fecha, filas, suma_valor, huella, huella_entradas)
  values (p_fecha, v_o.filas, v_o.suma, v_o.huella, v_he);
  return json_build_object('fecha', p_fecha, 'estado', 'registrada', 'filas_snapshot', v_o.filas,
                           'entradas_nuevas_o_cambiadas', v_nuevos, 'entradas_ausentes', v_gone);
end;
$function$;

-- Daily maintenance gate: the original rows must still match the registry fingerprint AND the stored entries must still
-- match the checksum certified at registration. (No heavy rebuild.)
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
    if v_g.huella_entradas is null then
      v_conf := v_conf || (v_fecha::text || ':sin_huella_de_entradas');
      continue;
    end if;
    select * into v_o from public.costos_huella(v_fecha);
    if v_o.filas is distinct from v_g.filas or v_o.suma is distinct from v_g.suma_valor or v_o.huella is distinct from v_g.huella then
      v_conf := v_conf || (v_fecha::text || ':cambio_despues_de_registrar');
      continue;
    end if;
    if public.costos_huella_entradas(v_fecha) is distinct from v_g.huella_entradas then
      v_conf := v_conf || (v_fecha::text || ':entradas_del_historial_modificadas');
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

drop function if exists public.verificar_costos_muestra(integer);

revoke execute on function public.costos_huella_entradas(date), public.verificar_costos_cadena(integer)
  from public, anon, authenticated;
grant  execute on function public.costos_huella_entradas(date), public.verificar_costos_cadena(integer) to service_role;

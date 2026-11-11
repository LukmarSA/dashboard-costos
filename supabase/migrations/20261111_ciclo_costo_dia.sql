-- Cost intelligence, layer 1: cumulative cost of every cycle on every report date.
--
-- Why: curves by cycle age, deviation alerts and forecasts need "how much had this cycle cost on day N". That is
-- derivable from costos_hist (change log) and from the newest full snapshots in costos_piscina, but not cheaply: this
-- table stores it once (about 25k rows, a few MB) and the daily job appends to it BEFORE the prune can remove the
-- newest snapshots.
--
-- costo_acum is the cycle's cumulative cost on that date (what ACOSUX reports as "Costo Total"); the six c_* columns
-- split it by group (c_otros is everything not listed, so the six always add up to costo_acum).
-- Validated against ACOSUX's own harvest report (54 closed EN cycles): the last stored value is 95-100% of the final
-- "Costo Total" (the report adds the last days before harvest).
--
-- Applied to project xupjkihkbvqtzmtrkfff on 2026-11-11.

create table if not exists public.ciclo_costo_dia (
  corrida_id     uuid          not null references public.corridas(id) on delete cascade,
  fecha          date          not null,
  empresa_id     uuid          not null,
  costo_acum     numeric(14,2) not null,
  c_balanceado   numeric(14,2) not null default 0,
  c_larva        numeric(14,2) not null default 0,   -- groups 'Siembra' + 'Larva' (larvae bought or transferred in)
  c_mano_obra    numeric(14,2) not null default 0,
  c_combustible  numeric(14,2) not null default 0,
  c_quimicos     numeric(14,2) not null default 0,   -- 'Insumos Quimicos'
  c_otros        numeric(14,2) not null default 0,
  primary key (corrida_id, fecha)
);
create index if not exists ciclo_costo_dia_empresa_fecha_idx on public.ciclo_costo_dia (empresa_id, fecha);
comment on table public.ciclo_costo_dia is
  'Costo acumulado de cada ciclo por fecha de reporte (total y por grupo). Lo mantiene actualizar_ciclo_costo_dia().';

alter table public.ciclo_costo_dia enable row level security;
drop policy if exists "usuarios leen ciclo_costo_dia de su empresa" on public.ciclo_costo_dia;
create policy "usuarios leen ciclo_costo_dia de su empresa" on public.ciclo_costo_dia
  for select to authenticated using (empresa_id = (select public.get_mi_empresa()));
revoke all on public.ciclo_costo_dia from public, anon, authenticated;
grant select on public.ciclo_costo_dia to authenticated;
grant all on public.ciclo_costo_dia to service_role;

-- Group -> column class. Kept in one place so the two builders below cannot drift apart.
create or replace function public.grupo_costo_clase(p_grupo text)
 returns text language sql immutable set search_path to 'public', 'pg_temp'
as $$
  select case p_grupo
    when 'Balanceado'       then 'bal'
    when 'Siembra'          then 'larva'
    when 'Larva'            then 'larva'
    when 'Mano de Obra'     then 'mo'
    when 'Combustible'      then 'comb'
    when 'Insumos Quimicos' then 'quim'
    else 'otros' end
$$;

-- 1) ONE-TIME backfill from the change log, a slice of `corridas` at a time (ordered by id). Idempotent (upsert).
--    A product's entry changes its running total by (new value - previous value) in its group; tombstones count as 0.
--    The running total per cycle and class is carried over the registered snapshot dates, and a row is kept only
--    while the cycle's total is positive (a harvested cycle disappears from the reports).
create or replace function public.ciclo_costo_dia_desde_historial(p_offset integer, p_limit integer)
 returns json
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode to 'force_custom_plan'
as $function$
declare
  v_n bigint;
begin
  perform set_config('statement_timeout', '50s', true);
  with b as (
    select c.id as corrida_id from public.corridas c order by c.id offset p_offset limit p_limit
  ),
  e as (
    select h.corrida_id, h.producto_codigo, h.fecha_desde, h.empresa_id,
           case when h.presente then h.valor else 0 end as v,
           h.grupo as g,
           lag(case when h.presente then h.valor else 0 end) over w as v_prev,
           lag(h.grupo) over w as g_prev
    from public.costos_hist h join b on b.corrida_id = h.corrida_id
    window w as (partition by h.corrida_id, h.producto_codigo order by h.fecha_desde)
  ),
  d as (
    select e.corrida_id, e.fecha_desde as fecha, public.grupo_costo_clase(e.g) as cls, e.v as dv
    from e where e.v <> 0
    union all
    select e.corrida_id, e.fecha_desde, public.grupo_costo_clase(e.g_prev), -e.v_prev
    from e where e.v_prev is not null and e.v_prev <> 0
  ),
  dg as (select corrida_id, fecha, cls, sum(dv) as dv from d group by 1, 2, 3),
  emp as (select e.corrida_id, min(e.empresa_id::text)::uuid as empresa_id from e group by 1),
  cc as (select corrida_id, cls, min(fecha) as f0 from dg group by 1, 2),
  cal as (select cc.corrida_id, cc.cls, f.fecha from cc join public.costos_hist_fechas f on f.fecha >= cc.f0),
  x as (
    select cal.corrida_id, cal.cls, cal.fecha,
           sum(coalesce(dg.dv, 0)) over (partition by cal.corrida_id, cal.cls order by cal.fecha) as acum
    from cal left join dg on dg.corrida_id = cal.corrida_id and dg.cls = cal.cls and dg.fecha = cal.fecha
  ),
  r as (
    select x.corrida_id, x.fecha, sum(x.acum) as total,
           coalesce(sum(x.acum) filter (where x.cls = 'bal'),   0) as bal,
           coalesce(sum(x.acum) filter (where x.cls = 'larva'), 0) as larva,
           coalesce(sum(x.acum) filter (where x.cls = 'mo'),    0) as mo,
           coalesce(sum(x.acum) filter (where x.cls = 'comb'),  0) as comb,
           coalesce(sum(x.acum) filter (where x.cls = 'quim'),  0) as quim,
           coalesce(sum(x.acum) filter (where x.cls = 'otros'), 0) as otros
    from x group by 1, 2 having sum(x.acum) > 0.005
  )
  insert into public.ciclo_costo_dia (corrida_id, fecha, empresa_id, costo_acum, c_balanceado, c_larva, c_mano_obra,
                                      c_combustible, c_quimicos, c_otros)
  select r.corrida_id, r.fecha, emp.empresa_id, r.total, r.bal, r.larva, r.mo, r.comb, r.quim, r.otros
  from r join emp on emp.corrida_id = r.corrida_id
  on conflict (corrida_id, fecha) do update set
    empresa_id = excluded.empresa_id, costo_acum = excluded.costo_acum, c_balanceado = excluded.c_balanceado,
    c_larva = excluded.c_larva, c_mano_obra = excluded.c_mano_obra, c_combustible = excluded.c_combustible,
    c_quimicos = excluded.c_quimicos, c_otros = excluded.c_otros;
  get diagnostics v_n = row_count;
  return json_build_object('offset', p_offset, 'limit', p_limit, 'filas', v_n);
end;
$function$;

-- 2) From a full snapshot that is still in costos_piscina (the newest dates). Replaces that date's rows.
create or replace function public.ciclo_costo_dia_desde_snapshot(p_fecha date)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode to 'force_custom_plan'
as $function$
declare
  v_n bigint;
begin
  delete from public.ciclo_costo_dia where fecha = p_fecha;
  insert into public.ciclo_costo_dia (corrida_id, fecha, empresa_id, costo_acum, c_balanceado, c_larva, c_mano_obra,
                                      c_combustible, c_quimicos, c_otros)
  select cp.corrida_id, p_fecha, min(cp.empresa_id::text)::uuid, sum(cp.valor),
         coalesce(sum(cp.valor) filter (where public.grupo_costo_clase(cp.grupo) = 'bal'),   0),
         coalesce(sum(cp.valor) filter (where public.grupo_costo_clase(cp.grupo) = 'larva'), 0),
         coalesce(sum(cp.valor) filter (where public.grupo_costo_clase(cp.grupo) = 'mo'),    0),
         coalesce(sum(cp.valor) filter (where public.grupo_costo_clase(cp.grupo) = 'comb'),  0),
         coalesce(sum(cp.valor) filter (where public.grupo_costo_clase(cp.grupo) = 'quim'),  0),
         coalesce(sum(cp.valor) filter (where public.grupo_costo_clase(cp.grupo) = 'otros'), 0)
  from public.costos_piscina cp
  where cp.fecha_reporte = p_fecha and cp.corrida_id is not null and cp.empresa_id is not null
    and exists (select 1 from public.corridas c where c.id = cp.corrida_id)
  group by cp.corrida_id
  having sum(cp.valor) > 0.005;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

-- 3) Daily job. Computes every snapshot date still held in costos_piscina that has no rows yet, and refreshes the
--    newest 3 (the robot may re-upload the current day several times). Must run BEFORE mantener_costos() (12:00 UTC)
--    prunes old snapshots; it is scheduled at 11:50 UTC.
create or replace function public.actualizar_ciclo_costo_dia()
 returns json
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode to 'force_custom_plan'
as $function$
declare
  v_fecha date;
  v_fechas date[] := '{}';
  v_filas bigint := 0;
begin
  for v_fecha in
    select f from public.costos_fechas() as t(f)
    where f >= (select coalesce(max(fecha) - 5, date '2000-01-01') from public.ciclo_costo_dia)
    order by f
  loop
    if not exists (select 1 from public.ciclo_costo_dia where fecha = v_fecha)
       or v_fecha in (select t.f from public.costos_fechas() as t(f) order by t.f desc limit 3) then
      v_filas := v_filas + public.ciclo_costo_dia_desde_snapshot(v_fecha);
      v_fechas := v_fechas || v_fecha;
    end if;
  end loop;
  return json_build_object('fechas', to_json(v_fechas), 'filas', v_filas);
end;
$function$;

-- 4) Applied after the migration above (documentation of what was run on the live project, do not repeat):
--    a) one-time backfill, 6 slices:  select public.ciclo_costo_dia_desde_historial(<0|150|300|450|600|750>, 150);
--       -> 12,582 rows in 2.2 MB. Validation: for all 121 registered dates, sum(costo_acum) equals the fingerprint
--       registry's suma_valor to the cent (0 differences).
--    b) newest full snapshots:        select public.actualizar_ciclo_costo_dia();   -> 436 rows (2026-10-29, 10-31, 11-01, 11-11).
--       Cross-check: for 2026-10-23..10-28 (present both in the history and as full snapshots) the two independent
--       builders agree on 436 of 436 cycle-days, totals and group split.
--    c) daily schedule at 11:50 UTC (before mantener-costos at 12:00). To stop: select cron.unschedule('ciclo-costo-dia');
--       select cron.schedule('ciclo-costo-dia', '50 11 * * *', $cron$select public.actualizar_ciclo_costo_dia()$cron$);

revoke execute on function public.grupo_costo_clase(text),
  public.ciclo_costo_dia_desde_historial(integer, integer), public.ciclo_costo_dia_desde_snapshot(date),
  public.actualizar_ciclo_costo_dia() from public, anon, authenticated;
grant execute on function public.grupo_costo_clase(text),
  public.ciclo_costo_dia_desde_historial(integer, integer), public.ciclo_costo_dia_desde_snapshot(date),
  public.actualizar_ciclo_costo_dia() to service_role;

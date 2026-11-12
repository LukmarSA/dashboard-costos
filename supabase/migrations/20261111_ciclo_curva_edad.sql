-- Cost intelligence, layer 2: each cycle's curve by AGE (day of culture), per hectare, on whole-day ages.
--
-- ciclo_costo_dia is indexed by report date; to compare cycles that started on different days they must be lined up
-- by age. ACOSUX's own clock is siembra_diaria.edad_dias (it equals the "Dias" column of the harvest report; checked
-- on 54 closed cycles). Snapshots are not daily (the robot skips days, and the early months are weekly), so values for
-- the ages in between are linearly interpolated; ages outside a cycle's observed range are never extrapolated.
--
-- Cycles that were re-stocked (edad_dias drops by more than 3 between consecutive reports; 38 of ~800) keep only the
-- observations of their LAST phase and are flagged resiembra = true: their cost still includes the earlier phase, so
-- they must not be mixed into reference curves.
--
-- Rebuilt completely by ciclo_curva_edad_recalcular() (about 12k source rows, a couple of seconds); the daily job calls it.
--
-- Applied to project xupjkihkbvqtzmtrkfff on 2026-11-12 (after 20261111_ciclo_costo_dia.sql), then
--   select public.ciclo_curva_edad_recalcular();   -> 13,491 rows, 648 cycles (checksum f2082ab5a4adcd63151fc83fc48349fe).
-- What is LIVE is the first version of ciclo_curva_edad_recalcular(), which takes 42 s. The version in this file is the
-- optimised one (observations go to an indexed temp table before interpolation); its apply_migration approval timed out
-- on 2026-11-12 and is PENDING. After applying it, the rebuilt table must give the same row count and checksum:
--   select count(*), md5(string_agg(c::text, '|' order by c.corrida_id, c.edad)) from public.ciclo_curva_edad c;

create table if not exists public.ciclo_curva_edad (
  corrida_id      uuid          not null references public.corridas(id) on delete cascade,
  edad            smallint      not null,
  empresa_id      uuid          not null,
  fecha           date,                         -- report date of the real observation; null when interpolated
  has             numeric(8,2)  not null,
  costo_ha        numeric(12,2) not null,
  c_balanceado_ha numeric(12,2) not null default 0,
  c_larva_ha      numeric(12,2) not null default 0,
  c_mano_obra_ha  numeric(12,2) not null default 0,
  c_combustible_ha numeric(12,2) not null default 0,
  c_quimicos_ha   numeric(12,2) not null default 0,
  c_otros_ha      numeric(12,2) not null default 0,
  alim_lbs_ha     numeric(12,1),                -- cumulative feed (lbs) per hectare, from siembra_diaria
  resiembra       boolean       not null default false,
  primary key (corrida_id, edad)
);
create index if not exists ciclo_curva_edad_empresa_idx on public.ciclo_curva_edad (empresa_id, edad);
comment on table public.ciclo_curva_edad is
  'Curva de cada ciclo por edad (dias de cultivo), por hectarea, interpolada a dias enteros. La reconstruye ciclo_curva_edad_recalcular().';

alter table public.ciclo_curva_edad enable row level security;
drop policy if exists "usuarios leen ciclo_curva_edad de su empresa" on public.ciclo_curva_edad;
create policy "usuarios leen ciclo_curva_edad de su empresa" on public.ciclo_curva_edad
  for select to authenticated using (empresa_id = (select public.get_mi_empresa()));
revoke all on public.ciclo_curva_edad from public, anon, authenticated;
grant select on public.ciclo_curva_edad to authenticated;
grant all on public.ciclo_curva_edad to service_role;

-- Linear interpolation of v at age a between (e0, v0) and (e1, v1); null-safe for the feed column.
create or replace function public.lerp_edad(a integer, e0 integer, v0 numeric, e1 integer, v1 numeric)
 returns numeric language sql immutable set search_path to 'public', 'pg_temp'
as $$
  select case when e1 = e0 or v1 is null then v0
              when v0 is null then null
              else v0 + (v1 - v0) * (a - e0)::numeric / (e1 - e0) end
$$;

create or replace function public.ciclo_curva_edad_recalcular()
 returns json
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode to 'force_custom_plan'
as $function$
declare
  v_n bigint;
begin
  perform set_config('statement_timeout', '100s', true);
  delete from public.ciclo_curva_edad;

  drop table if exists pg_temp._p;
  create temp table _p on commit drop as
  with sd as (   -- stocked reports, with the date of the last age reset (re-stocking) of each cycle
    select s.corrida_id, s.fecha_reporte, s.edad_dias, s.has, s.balanceado_lbs,
           case when s.edad_dias < lag(s.edad_dias) over (partition by s.corrida_id order by s.fecha_reporte) - 3
                then s.fecha_reporte end as f_reset
    from public.siembra_diaria s
    where s.corrida_id is not null and s.sembrada and s.edad_dias > 0 and s.has > 0
  ),
  rs as (select corrida_id, max(f_reset) as f_reset from sd group by 1)
  select distinct on (t.corrida_id, sd.edad_dias)   -- one observation per cycle and age (latest report date), last phase only
         t.corrida_id, t.empresa_id, t.fecha, sd.edad_dias as edad, sd.has,
         t.costo_acum / sd.has as costo_ha,
         t.c_balanceado / sd.has as bal, t.c_larva / sd.has as lar, t.c_mano_obra / sd.has as mo,
         t.c_combustible / sd.has as comb, t.c_quimicos / sd.has as quim, t.c_otros / sd.has as otros,
         sd.balanceado_lbs / sd.has as alim, (rs.f_reset is not null) as resiembra
  from public.ciclo_costo_dia t
  join sd on sd.corrida_id = t.corrida_id and sd.fecha_reporte = t.fecha
  join rs on rs.corrida_id = t.corrida_id
  where rs.f_reset is null or t.fecha >= rs.f_reset
  order by t.corrida_id, sd.edad_dias, t.fecha desc;
  create unique index on pg_temp._p (corrida_id, edad);
  analyze pg_temp._p;

  with rng as (select corrida_id, min(edad) as e_min, max(edad) as e_max from pg_temp._p group by 1),
  g as (select r.corrida_id, a from rng r, lateral generate_series(r.e_min, r.e_max) as a),
  j as (
    select g.corrida_id, g.a, lo.edad as e0, hi.edad as e1,
           lo.empresa_id, lo.resiembra, lo.has as has0,
           lo.costo_ha c0, hi.costo_ha c1, lo.bal b0, hi.bal b1, lo.lar l0, hi.lar l1, lo.mo m0, hi.mo m1,
           lo.comb k0, hi.comb k1, lo.quim q0, hi.quim q1, lo.otros o0, hi.otros o1, lo.alim f0, hi.alim f1,
           case when lo.edad = g.a then lo.fecha end as fecha_obs
    from g
    cross join lateral (select * from pg_temp._p p where p.corrida_id = g.corrida_id and p.edad <= g.a order by p.edad desc limit 1) lo
    cross join lateral (select * from pg_temp._p p where p.corrida_id = g.corrida_id and p.edad >= g.a order by p.edad asc limit 1) hi
  )
  insert into public.ciclo_curva_edad (corrida_id, edad, empresa_id, fecha, has, costo_ha, c_balanceado_ha, c_larva_ha,
                                       c_mano_obra_ha, c_combustible_ha, c_quimicos_ha, c_otros_ha, alim_lbs_ha, resiembra)
  select j.corrida_id, j.a, j.empresa_id, j.fecha_obs, j.has0,
         round(public.lerp_edad(j.a, j.e0, j.c0, j.e1, j.c1), 2),
         round(public.lerp_edad(j.a, j.e0, j.b0, j.e1, j.b1), 2),
         round(public.lerp_edad(j.a, j.e0, j.l0, j.e1, j.l1), 2),
         round(public.lerp_edad(j.a, j.e0, j.m0, j.e1, j.m1), 2),
         round(public.lerp_edad(j.a, j.e0, j.k0, j.e1, j.k1), 2),
         round(public.lerp_edad(j.a, j.e0, j.q0, j.e1, j.q1), 2),
         round(public.lerp_edad(j.a, j.e0, j.o0, j.e1, j.o1), 2),
         round(public.lerp_edad(j.a, j.e0, j.f0, j.e1, j.f1), 1),
         j.resiembra
  from j;
  get diagnostics v_n = row_count;
  return json_build_object('filas', v_n, 'ciclos', (select count(distinct corrida_id) from public.ciclo_curva_edad));
end;
$function$;

-- The daily job now rebuilds the age curves right after refreshing the cumulative costs.
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
  v_curva json;
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
  v_curva := public.ciclo_curva_edad_recalcular();
  return json_build_object('fechas', to_json(v_fechas), 'filas', v_filas, 'curva', v_curva);
end;
$function$;

revoke execute on function public.lerp_edad(integer, integer, numeric, integer, numeric),
  public.ciclo_curva_edad_recalcular(), public.actualizar_ciclo_costo_dia() from public, anon, authenticated;
grant execute on function public.lerp_edad(integer, integer, numeric, integer, numeric),
  public.ciclo_curva_edad_recalcular(), public.actualizar_ciclo_costo_dia() to service_role;

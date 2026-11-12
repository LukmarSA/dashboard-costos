-- Cost intelligence, layer 3: the two functions the page "Inteligencia de costos" calls.
-- Statistics only; the verdict wording and thresholds live in js/inteligencia-costos.js (unit tested).
-- Read-only for signed-in users of the company (the cohort tables are RLS-protected as well); not callable by anon.
--
-- STATUS: written 2026-11-12, applied to project xupjkihkbvqtzmtrkfff only after the user's approval (see the commit log).
-- The body of inteligencia_costos() was first run as a plain SELECT on the live data: 55 ages in the cohort curves,
-- 71 active engorde cycles, 63 KB of JSON.
--
-- Method (cohort = engorde cycles that were NOT re-stocked, compared at the SAME age in days, the cycle itself excluded):
--  * operating cost per ha = total cost per ha - larva/stocking cost per ha (larva is decided on day 0, not operating spend)
--  * percentiles p10 p25 p50 p75 p90 of operating cost, of each cost group, and of accumulated feed (lb/ha) at that age
--  * pace = operating cost spent per ha per day over the last 7 days, vs the cohort's median pace at that age
--  * forecast to the target age h = today's cost/ha + percentiles p10 p50 p90 of the cost increments (age -> h) that
--    cohort cycles had. Backtested with leave-one-out on closed cycles; see inteligencia_backtest().

create or replace function public.inteligencia_costos(p_edad_objetivo integer default 40)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode to 'force_custom_plan'
as $function$
declare
  v_emp   uuid := (select public.get_mi_empresa());
  v_fecha date;
  v_h     int  := coalesce(p_edad_objetivo, 40);
begin
  if v_emp is null then
    raise exception 'Sin acceso: usuario sin empresa asociada';
  end if;
  if v_h < 20 or v_h > 70 then
    raise exception 'edad_objetivo fuera de rango (20 a 70)';
  end if;
  select max(cc.fecha) into v_fecha from public.ciclo_curva_edad cc where cc.empresa_id = v_emp;
  if v_fecha is null then
    return jsonb_build_object('fecha', null, 'edad_objetivo', v_h, 'tipo', 'EN', 'curvas', '[]'::jsonb, 'ciclos', '[]'::jsonb);
  end if;
  return (
  with p as (select v_emp as emp, v_fecha as fecha, v_h as h),
  k as (
    select cc.corrida_id, cc.edad, cc.costo_ha as x, cc.costo_ha - cc.c_larva_ha as op, cc.c_larva_ha as lar,
           cc.c_balanceado_ha as bal, cc.c_mano_obra_ha as mo, cc.c_combustible_ha as comb, cc.c_quimicos_ha as quim,
           cc.c_otros_ha as otros, cc.alim_lbs_ha as alim
    from public.ciclo_curva_edad cc
    join public.corridas co on co.id = cc.corrida_id and co.codigo_corrida like '%-EN-%'
    where cc.empresa_id = (select emp from p) and not cc.resiembra
  ),
  curvas as (
    select k.edad, count(*) as n,
           percentile_cont(array[0.1,0.25,0.5,0.75,0.9]) within group (order by k.x) as x,
           percentile_cont(0.5) within group (order by k.op) as op,
           percentile_cont(0.5) within group (order by k.bal) as bal, percentile_cont(0.5) within group (order by k.lar) as lar,
           percentile_cont(0.5) within group (order by k.mo) as mo, percentile_cont(0.5) within group (order by k.comb) as comb,
           percentile_cont(0.5) within group (order by k.quim) as quim, percentile_cont(0.5) within group (order by k.otros) as otros,
           percentile_cont(array[0.25,0.5,0.75]) within group (order by k.alim) as alim
    from k group by k.edad having count(*) >= 5
  ),
  act as (
    select cc.corrida_id, co.codigo_corrida as cod, pi.codigo as pis, co.fecha_siembra as fsiembra, cc.edad, cc.has, cc.costo_ha as x, cc.c_larva_ha as lar,
           cc.costo_ha - cc.c_larva_ha as op, cc.c_balanceado_ha as bal, cc.c_mano_obra_ha as mo, cc.c_combustible_ha as comb,
           cc.c_quimicos_ha as quim, cc.c_otros_ha as otros, cc.alim_lbs_ha as alim, cc.resiembra
    from public.ciclo_curva_edad cc
    join public.corridas co on co.id = cc.corrida_id and co.codigo_corrida like '%-EN-%'
    join public.piscinas pi on pi.id = co.piscina_id
    where cc.empresa_id = (select emp from p) and cc.fecha = (select fecha from p)
  ),
  ciclos as (
    select a.*,
      r.n, r.x_q, r.op_q, r.op_rank, r.alim_q, r.g_med,
      case when own7.op7 is not null then (a.op - own7.op7) / 7.0 end as tasa, t.tasa_ref,
      f.fn, f.dq
    from act a
    left join lateral (
      select count(*) as n,
        percentile_cont(array[0.1,0.25,0.5,0.75,0.9]) within group (order by k.x) as x_q,
        percentile_cont(array[0.1,0.25,0.5,0.75,0.9]) within group (order by k.op) as op_q,
        (count(*) filter (where k.op <= a.op))::float8 / nullif(count(*), 0) as op_rank,
        percentile_cont(array[0.25,0.5,0.75]) within group (order by k.alim) as alim_q,
        jsonb_build_object('bal', percentile_cont(0.5) within group (order by k.bal), 'lar', percentile_cont(0.5) within group (order by k.lar),
          'mo', percentile_cont(0.5) within group (order by k.mo), 'comb', percentile_cont(0.5) within group (order by k.comb),
          'quim', percentile_cont(0.5) within group (order by k.quim), 'otros', percentile_cont(0.5) within group (order by k.otros)) as g_med
      from k where k.edad = a.edad and k.corrida_id <> a.corrida_id
    ) r on true
    left join lateral (select o.op as op7 from k o where o.corrida_id = a.corrida_id and o.edad = a.edad - 7) own7 on true
    left join lateral (
      select percentile_cont(0.5) within group (order by (k.op - k7.op) / 7.0) as tasa_ref
      from k join k k7 on k7.corrida_id = k.corrida_id and k7.edad = a.edad - 7
      where k.edad = a.edad and k.corrida_id <> a.corrida_id
    ) t on true
    left join lateral (
      select count(*) as fn,
        percentile_cont(array[0.1,0.5,0.9]) within group (order by kh.x - ka.x) as dq
      from k ka join k kh on kh.corrida_id = ka.corrida_id and kh.edad = (select h from p)
      where ka.edad = a.edad and ka.corrida_id <> a.corrida_id and a.edad < (select h from p) and not a.resiembra
    ) f on true
  )
  select jsonb_build_object(
    'fecha', (select fecha from p), 'edad_objetivo', (select h from p), 'tipo', 'EN',
    'curvas', coalesce((select jsonb_agg(jsonb_build_object('e', c.edad, 'n', c.n, 'x', c.x, 'op', c.op,
        'g', jsonb_build_object('bal', c.bal, 'lar', c.lar, 'mo', c.mo, 'comb', c.comb, 'quim', c.quim, 'otros', c.otros), 'alim', c.alim) order by c.edad) from curvas c), '[]'::jsonb),
    'ciclos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.corrida_id, 'cod', c.cod, 'pis', c.pis, 'fsiembra', c.fsiembra, 'edad', c.edad, 'has', c.has, 'x', c.x, 'op', c.op, 'lar', c.lar, 'alim', c.alim,
        'g', jsonb_build_object('bal', c.bal, 'lar', c.lar, 'mo', c.mo, 'comb', c.comb, 'quim', c.quim, 'otros', c.otros),
        'resiembra', c.resiembra, 'ref_n', coalesce(c.n, 0), 'ref_x', c.x_q, 'ref_op', c.op_q, 'op_rank', c.op_rank,
        'ref_alim', c.alim_q, 'ref_g', c.g_med, 'tasa', c.tasa, 'tasa_ref', c.tasa_ref,
        'proy_n', coalesce(c.fn, 0), 'proy_dq', c.dq) order by c.cod) from ciclos c), '[]'::jsonb)
  ) as r
  );
end;
$function$;

-- Backtest on closed cycles: for every cycle that reached the target age h, forecast its cost at h from age a using only
-- the OTHER cycles, and compare with what it really cost. error_pct = mean absolute % error of the median forecast;
-- error_lineal_pct = the same for the naive "keep the last 7-day pace" forecast; cobertura_pct = how often the real cost
-- fell inside the p10-p90 range; sesgo_pct = mean signed error (0 = no systematic over/under-forecast).
create or replace function public.inteligencia_backtest()
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode to 'force_custom_plan'
as $function$
declare
  v_emp uuid := (select public.get_mi_empresa());
begin
  if v_emp is null then
    raise exception 'Sin acceso: usuario sin empresa asociada';
  end if;
  return coalesce((
  with c as (
    select cc.corrida_id, cc.edad, cc.costo_ha as x
    from public.ciclo_curva_edad cc
    join public.corridas co on co.id = cc.corrida_id and co.codigo_corrida like '%-EN-%'
    where cc.empresa_id = v_emp and not cc.resiembra
  ),
  prm(a, h) as (values (15, 35), (20, 40), (30, 40), (20, 45), (30, 45), (35, 50)),
  pr as (
    select prm.a, prm.h, ca.corrida_id, ca.x as xa, ch.x as xh, c7.x as x7
    from prm
    join c ca on ca.edad = prm.a
    join c ch on ch.corrida_id = ca.corrida_id and ch.edad = prm.h
    join c c7 on c7.corrida_id = ca.corrida_id and c7.edad = prm.a - 7
  )
  select jsonb_agg(jsonb_build_object('a', a, 'h', h, 'n', n, 'error_pct', error_pct, 'error_lineal_pct', error_lineal_pct,
                                      'cobertura_pct', cobertura_pct, 'sesgo_pct', sesgo_pct) order by a, h)
  from (
    select a, h, count(*) as n,
      round((avg(abs(xa + ad[2] - xh) / xh) * 100)::numeric, 1) as error_pct,
      round((avg(abs(xa + (xa - x7) / 7 * (h - a) - xh) / xh) * 100)::numeric, 1) as error_lineal_pct,
      round((avg((xa + ad[1] <= xh and xh <= xa + ad[3])::int) * 100)::numeric) as cobertura_pct,
      round((avg((xa + ad[2] - xh) / xh) * 100)::numeric, 1) as sesgo_pct
    from (
      select j.a, j.h, j.xa::float8 as xa, j.xh::float8 as xh, j.x7::float8 as x7,
             percentile_cont(array[0.1, 0.5, 0.9]) within group (order by (k.xh - k.xa)::float8) as ad
      from pr j join pr k on k.a = j.a and k.h = j.h and k.corrida_id <> j.corrida_id
      group by j.a, j.h, j.corrida_id, j.xa, j.xh, j.x7
    ) loo
    group by a, h
  ) z
  ), '[]'::jsonb);
end;
$function$;

revoke execute on function public.inteligencia_costos(integer), public.inteligencia_backtest() from public, anon;
grant execute on function public.inteligencia_costos(integer), public.inteligencia_backtest() to authenticated, service_role;

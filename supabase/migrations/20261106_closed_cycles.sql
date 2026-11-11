-- Applied to project xupjkihkbvqtzmtrkfff on 2026-11-06 as two migrations:
--   closed_cycles_function_20261106   (column + function)
--   schedule_closed_cycles_20261106   (pg_cron job)
--
-- Why: all 793 cycles (corridas) were still 'en_proceso' although only 109 appear in the latest report, so the
-- system had no record of finished cycles. This keeps `estado` current and records each cycle's last report date
-- (fecha_ultimo_reporte), which the planned prune of costos_piscina uses to keep each cycle's final snapshot.
--
-- Evidence behind the 60-day default: 45 cycles vanished from the reports for 2-40 days (45 days between the
-- last and next sighting at most) and then came back, so a short grace period would close live cycles.
-- Tested in a rolled-back transaction: anon and browser roles are denied; grace < 3 is rejected;
-- first run = 789 dates updated, 500 closed, 0 reopened; second run changes nothing; no cycle in the newest
-- report is closed; a simulated returning cycle is reopened. First real run: 500 'cosechada', 293 'en_proceso'.
-- 'cosechada' means "no longer appears in the reports": it can also be a cycle that ended by transfer.

alter table public.corridas add column if not exists fecha_ultimo_reporte date;
comment on column public.corridas.fecha_ultimo_reporte is
  'Ultima fecha de reporte de siembra en la que aparecio este ciclo. La mantiene actualizar_estado_corridas().';

-- Closes cycles ('cosechada') absent from the reports for >= p_dias_gracia days, measured against the NEWEST
-- report of their company (a robot outage never closes anything), and reopens ('en_proceso') any closed cycle
-- that shows up again. 'cancelada' is never touched.
create or replace function public.actualizar_estado_corridas(p_dias_gracia integer default 60)
 returns json
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_fechas     int;
  v_cerradas   int;
  v_reabiertas int;
begin
  if p_dias_gracia is null or p_dias_gracia < 3 then
    raise exception 'p_dias_gracia debe ser >= 3';
  end if;

  -- 1) last report date per cycle
  update public.corridas c
  set fecha_ultimo_reporte = s.lf
  from (select corrida_id, max(fecha_reporte) as lf
        from public.siembra_diaria
        where corrida_id is not null
        group by corrida_id) s
  where s.corrida_id = c.id
    and c.fecha_ultimo_reporte is distinct from s.lf;
  get diagnostics v_fechas = row_count;

  -- 2) close
  with latest as (
    select empresa_id, max(fecha_reporte) as lr from public.siembra_diaria group by empresa_id
  )
  update public.corridas c
  set estado = 'cosechada'
  from public.piscinas p
  join latest l on l.empresa_id = p.empresa_id
  where p.id = c.piscina_id
    and c.estado = 'en_proceso'
    and c.fecha_ultimo_reporte is not null
    and c.fecha_ultimo_reporte <= l.lr - p_dias_gracia;
  get diagnostics v_cerradas = row_count;

  -- 3) reopen cycles that came back
  with latest as (
    select empresa_id, max(fecha_reporte) as lr from public.siembra_diaria group by empresa_id
  )
  update public.corridas c
  set estado = 'en_proceso'
  from public.piscinas p
  join latest l on l.empresa_id = p.empresa_id
  where p.id = c.piscina_id
    and c.estado = 'cosechada'
    and c.fecha_ultimo_reporte > l.lr - p_dias_gracia;
  get diagnostics v_reabiertas = row_count;

  return json_build_object(
    'fechas_actualizadas', v_fechas,
    'cerradas', v_cerradas,
    'reabiertas', v_reabiertas,
    'dias_gracia', p_dias_gracia);
end;
$function$;

-- Not callable from the browser: only the service role (robot) and the owner (cron).
revoke execute on function public.actualizar_estado_corridas(integer) from public, anon, authenticated;
grant  execute on function public.actualizar_estado_corridas(integer) to service_role;

-- Daily at 11:30 UTC (06:30 Ecuador). To remove: select cron.unschedule('actualizar-estado-corridas');
create extension if not exists pg_cron with schema pg_catalog;

do $$
begin
  perform cron.unschedule('actualizar-estado-corridas');
exception when others then
  null;  -- not scheduled yet
end $$;

select cron.schedule(
  'actualizar-estado-corridas',
  '30 11 * * *',
  $cron$select public.actualizar_estado_corridas()$cron$
);

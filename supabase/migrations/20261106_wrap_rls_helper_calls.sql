-- Applied to project xupjkihkbvqtzmtrkfff on 2026-11-06 (migration name: wrap_rls_helper_calls_20261106).
--
-- Performance: evaluate get_mi_empresa() / get_mi_rol() once per statement instead of once per row.
-- Before: Filter: (empresa_id = get_mi_empresa()) ran for every row. Counting the 32,581 rows of the latest
-- costos_piscina snapshot as a signed-in user took 1,196 ms (9 ms without RLS). After: 10.8 ms (InitPlan).
--
-- Rewrites all 31 policies that call the helpers. Semantics are unchanged. Verified with a per-role snapshot
-- (row counts of 15 tables + insert/update attempts as admin, contador, gerente, a user without profile and anon):
-- the md5 of the whole snapshot was identical before and after (2f921b787ff395185e11d11e2dfd2eac).
--
-- Idempotent: Postgres stores a wrapped call as "( SELECT get_mi_x() AS get_mi_x)", so a policy is skipped
-- when nothing is left after removing those wrapped forms. (The first version applied to the live project used
-- a text guard that missed that form; it ran once, correctly. This corrected guard returns 0 rows on re-run.)
do $$
declare
  p record;
  new_qual text;
  new_chk  text;
  stmt     text;
  n        int := 0;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (qual ilike '%get_mi_%' or with_check ilike '%get_mi_%')
      and regexp_replace(
            coalesce(qual, '') || ' ' || coalesce(with_check, ''),
            '\(\s*select\s+(public\.)?get_mi_(empresa|rol)\(\)(\s+as\s+get_mi_(empresa|rol))?\s*\)', '', 'gi')
          ~* 'get_mi_(empresa|rol)\(\)'
    order by tablename, policyname
  loop
    new_qual := case when p.qual is null then null else
      replace(replace(p.qual, 'get_mi_empresa()', '(select public.get_mi_empresa())'),
              'get_mi_rol()',     '(select public.get_mi_rol())') end;
    new_chk := case when p.with_check is null then null else
      replace(replace(p.with_check, 'get_mi_empresa()', '(select public.get_mi_empresa())'),
              'get_mi_rol()',       '(select public.get_mi_rol())') end;
    stmt := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename)
         || case when new_qual is not null then ' using (' || new_qual || ')' else '' end
         || case when new_chk  is not null then ' with check (' || new_chk || ')' else '' end;
    execute stmt;
    n := n + 1;
  end loop;
  raise notice 'policies rewritten: %', n;
end $$;

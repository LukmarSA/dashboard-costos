-- Applied to project xupjkihkbvqtzmtrkfff on 2026-11-11 (migration name: restore_anon_cost_rpcs_20261111).
--
-- WHAT BROKE: the dashboard panel "Costos por grupo / Distribucion de costos" calls get_costos_por_corrida_grupo and
-- get_costos_por_grupo_producto with fetch() using the PUBLIC anon key as the bearer token (pages/dashboard.html,
-- rpcPaginado), i.e. as role anon. The security hardening of 2026-11-06 (20261106_harden_rpc_security.sql) revoked anon
-- EXECUTE on them, so the panel came back empty (HTTP 401 "permission denied for function"). It stayed hidden while the
-- project was blocked by the Free-plan restriction, and surfaced as soon as service returned.
--
-- WHAT THIS DOES: restores EXECUTE for anon on ONLY those two read-only functions. Still locked for anon:
-- crear_usuario_auth, actualizar_password_usuario, get_usuarios_empresa, get_costos_agrupados, propagar_grupos_costos.
-- Remaining exposure while this grant exists: anyone holding the public anon key AND the company's secret id can read
-- aggregated cost totals (the situation before 2026-11-06 for these two functions).
grant execute on function public.get_costos_por_corrida_grupo(uuid, date) to anon;
grant execute on function public.get_costos_por_grupo_producto(uuid, date) to anon;

-- PERMANENT FIX (on branch claude/vibrant-galileo-2rg72r, needs merge to main + deploy): rpcPaginado now sends the signed-in
-- user's session token, so these functions run as role authenticated. After that is live, close the exposure again with:
--   revoke execute on function public.get_costos_por_corrida_grupo(uuid, date), public.get_costos_por_grupo_producto(uuid, date) from anon;
-- tests/e2e-browser.cjs (check 8) fails if the panel goes back to calling the RPCs with the anon key.

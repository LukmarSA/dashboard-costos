-- Applied to project xupjkihkbvqtzmtrkfff on 2026-11-06 (migration name: harden_rpc_security_20261106).
-- Security hardening: close anon access to SECURITY DEFINER RPCs and add caller checks.
--
-- Before: crear_usuario_auth and actualizar_password_usuario were executable by the public `anon`
-- role (the anon key is public in js/config.js) and checked nothing about the caller, so any
-- signed-in user could create admin accounts or reset anyone's password.
-- Verified after applying (inside a rolled-back transaction): anon -> permission denied;
-- signed-in non-admin -> "No autorizado"; admin on own company -> works; admin with another
-- company's id -> blocked.

-- 1) crear_usuario_auth: only an authenticated admin, only for their own company.
CREATE OR REPLACE FUNCTION public.crear_usuario_auth(p_email text, p_password text, p_nombre text, p_rol text, p_empresa_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'auth', 'public', 'extensions'
AS $function$
declare
  v_user_id uuid := gen_random_uuid();
  v_email   text := lower(trim(p_email));
begin
  -- Authorization (raises a real error; not swallowed by the inner handler)
  if auth.uid() is null or coalesce(public.get_mi_rol(), '') <> 'admin' then
    raise exception 'No autorizado: solo un administrador puede crear usuarios.' using errcode = '42501';
  end if;
  if p_empresa_id is distinct from public.get_mi_empresa() then
    raise exception 'No autorizado: la empresa no coincide con la del administrador.' using errcode = '42501';
  end if;
  if p_rol is null or p_rol not in ('admin', 'contador', 'gerente') then
    raise exception 'Rol invalido.' using errcode = '22023';
  end if;
  if p_password is null or length(p_password) < 8 then
    raise exception 'La contrasena debe tener al menos 8 caracteres.' using errcode = '22023';
  end if;

  begin
    -- Evitar duplicados
    if exists (select 1 from auth.users where email = v_email) then
      return json_build_object('error', 'Ya existe un usuario con ese correo.');
    end if;

    -- 3.1 Crear usuario en auth.users
    --     IMPORTANTE: los tokens van como '' (cadena vacia), nunca NULL.
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, recovery_token,
      email_change, email_change_token_new, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token
    )
    values (
      '00000000-0000-0000-0000-000000000000',
      v_user_id, 'authenticated', 'authenticated',
      v_email, crypt(p_password, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('nombre', p_nombre),
      now(), now(),
      '', '', '', '', '', '', '', ''
    );

    -- 3.2 Crear identidad (best-effort)
    begin
      insert into auth.identities (
        provider_id, user_id, identity_data, provider,
        last_sign_in_at, created_at, updated_at
      )
      values (
        v_user_id::text, v_user_id,
        jsonb_build_object('sub', v_user_id::text, 'email', v_email),
        'email', now(), now(), now()
      );
    exception when others then
      null;
    end;

    -- 3.3 Registrar en tabla de negocio
    insert into public.usuarios (id, empresa_id, nombre, email, rol, activo)
    values (v_user_id, p_empresa_id, p_nombre, v_email, p_rol, true);

    return json_build_object('id', v_user_id, 'email', v_email);
  exception when others then
    return json_build_object('error', SQLERRM);
  end;
end;
$function$;

-- 2) actualizar_password_usuario: only an admin, only for users of their own company.
CREATE OR REPLACE FUNCTION public.actualizar_password_usuario(p_user_id uuid, p_new_password text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'auth', 'public', 'extensions'
AS $function$
begin
  if auth.uid() is null or coalesce(public.get_mi_rol(), '') <> 'admin' then
    raise exception 'No autorizado: solo un administrador puede cambiar contrasenas.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.usuarios u
    where u.id = p_user_id and u.empresa_id = public.get_mi_empresa()
  ) then
    raise exception 'No autorizado: el usuario no pertenece a su empresa.' using errcode = '42501';
  end if;
  if p_new_password is null or length(p_new_password) < 8 then
    raise exception 'La contrasena debe tener al menos 8 caracteres.' using errcode = '22023';
  end if;

  update auth.users
  set encrypted_password = crypt(p_new_password, gen_salt('bf')),
      updated_at = now()
  where id = p_user_id;
end;
$function$;

-- 3) get_usuarios_empresa: lists emails, so admin-only and own company only.
CREATE OR REPLACE FUNCTION public.get_usuarios_empresa(p_empresa_id uuid)
 RETURNS TABLE(id uuid, nombre text, email text, rol text, activo boolean, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
  select
    u.id,
    u.nombre,
    coalesce(u.email, a.email) as email,
    u.rol,
    u.activo,
    u.created_at
  from public.usuarios u
  join auth.users a on a.id = u.id
  where u.empresa_id = p_empresa_id
    and p_empresa_id = public.get_mi_empresa()
    and public.get_mi_rol() = 'admin'
  order by u.nombre;
$function$;

-- 4) Pin search_path on the other SECURITY DEFINER functions.
ALTER FUNCTION public.get_mi_rol() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_mi_empresa() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_costos_agrupados(uuid, date) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_costos_por_corrida_grupo(uuid, date) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_costos_por_grupo_producto(uuid, date) SET search_path = public, pg_temp;

-- 5) Remove anonymous/public execution; keep signed-in users and the service role.
--    (get_mi_rol / get_mi_empresa stay executable: RLS policies call them.)
REVOKE EXECUTE ON FUNCTION public.crear_usuario_auth(text, text, text, text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.actualizar_password_usuario(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_usuarios_empresa(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_costos_agrupados(uuid, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_costos_por_corrida_grupo(uuid, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_costos_por_grupo_producto(uuid, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.propagar_grupos_costos(uuid, date) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.crear_usuario_auth(text, text, text, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.actualizar_password_usuario(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_usuarios_empresa(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_costos_agrupados(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_costos_por_corrida_grupo(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_costos_por_grupo_producto(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.propagar_grupos_costos(uuid, date) TO authenticated, service_role;

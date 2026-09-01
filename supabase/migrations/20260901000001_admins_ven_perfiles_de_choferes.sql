-- El panel necesita mostrar el correo de cada chofer, pero `profiles` sólo
-- dejaba a cada usuario leer su propia fila (profiles_select_own).
--
-- Se abre lo mínimo: un admin puede leer los perfiles de los usuarios que son
-- choferes DE SUS EMPRESAS. Nada más — ni otros admins, ni usuarios sueltos.
-- La subconsulta a `choferes` corre con el RLS del propio admin, así que ya
-- viene acotada a sus empresas; el filtro explícito por empresa_id la vuelve
-- a decir por si esa política cambiara algún día.

create policy profiles_select_choferes_admin on public.profiles
  for select to authenticated
  using (
    (select public.es_admin())
    and id in (
      select c.user_id
      from public.choferes c
      where c.empresa_id in (select public.empresa_ids_actual())
    )
  );

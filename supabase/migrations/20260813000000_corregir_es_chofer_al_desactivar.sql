-- Desactivar a un chofer le daba acceso a TODA la contabilidad.
--
-- `es_chofer()` exigía `activo`, y esa función es la que hace que la política
-- restrictiva `sin_acceso_choferes` bloquee las 37 tablas del resto de `dash`.
-- Al desactivarlo dejaba de "ser chofer", la restricción ya no le aplicaba, y
-- caía en las políticas permisivas `USING (true)` del resto del sistema.
-- O sea: el botón para quitarle acceso se lo ampliaba.
--
-- Verificado antes del arreglo: un chofer desactivado leía 1 534 filas de
-- vf_cuentas_cobrar y 1 744 de vf_ventas_producto.
--
-- La separación correcta son dos preguntas distintas:
--   es_chofer()          -> ¿esta persona es un chofer? Si figura en la tabla,
--                           lo es, activo o no. Decide qué NO puede ver.
--   chofer_ids_actual()  -> ¿con qué chofer puede operar HOY? Sólo si está
--                           activo. Decide qué SÍ puede escribir.

create or replace function public.es_chofer()
returns boolean
language sql stable security definer set search_path = public
as $$
  -- Sin filtro por `activo` a propósito: desactivar restringe, nunca amplía.
  select exists (
    select 1 from public.choferes c where c.user_id = (select auth.uid())
  );
$$;

-- Un chofer desactivado tampoco puede crear registros nuevos: hasta ahora
-- podía hacerlo por API aunque la app le negara el ingreso.
create or replace function public.chofer_ids_actual()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select c.id from public.choferes c
  where c.user_id = (select auth.uid()) and c.activo;
$$;

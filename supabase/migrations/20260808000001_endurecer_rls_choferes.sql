-- =====================================================================
-- Endurecimiento de RLS para convivir con la app de choferes
-- proyecto `dash` (uqgcjyopoaisuglljnuc)
-- =====================================================================
-- NO modifica ni borra ninguna política existente. Sólo AGREGA políticas
-- RESTRICTIVAS, que en Postgres se combinan con AND sobre las permisivas:
--
--   admin  → permisiva(true) AND restrictiva(no es chofer = true)  → pasa
--   chofer → permisiva(true) AND restrictiva(no es chofer = false) → bloqueado
--
-- Por qué esto es necesario: `dash` tiene 27 tablas con `USING (true)` para
-- `authenticated`, incluida la contabilidad. La anon key va dentro del APK y
-- se extrae descomprimiéndolo; con un login de chofer cualquiera le pega
-- directo a la API REST sin pasar por el dashboard. RLS es lo único que
-- separa a un chofer de `vf_cuentas_cobrar`.
--
-- Reversible por completo:  DROP POLICY sin_acceso_choferes ON public.<tabla>;
-- =====================================================================

begin;

-- =====================================================================
-- 1 · Cerrar la auto-promoción de rol
-- =====================================================================
-- `profiles_update_own` permite UPDATE con `id = auth.uid()` sin restringir
-- columnas, así que hoy CUALQUIER usuario puede ponerse `rol = 'admin'`.
-- Eso ya es un problema con los usuarios actuales; con choferes volvería
-- trivial saltarse todo lo de abajo.
--
-- Lectura sin RLS (security definer) para no recursar sobre `profiles`.
create or replace function public.rol_actual_raw()
returns text
language sql stable security definer set search_path = public
as $$
  select p.rol from public.profiles p where p.id = (select auth.uid());
$$;

create or replace function public.empresas_permitidas_raw()
returns text[]
language sql stable security definer set search_path = public
as $$
  select p.empresas_permitidas from public.profiles p where p.id = (select auth.uid());
$$;

revoke all on function public.rol_actual_raw()          from public;
revoke all on function public.empresas_permitidas_raw() from public;
grant execute on function public.rol_actual_raw()          to authenticated;
grant execute on function public.empresas_permitidas_raw() to authenticated;

-- El usuario sigue pudiendo editar su nombre, teléfono, etc. Lo único que
-- queda congelado es su propio rol y sus empresas. Un UPDATE que reenvíe
-- esos campos sin cambiarlos pasa igual, así que no rompe flujos existentes.
drop policy if exists profiles_rol_inmutable on public.profiles;
create policy profiles_rol_inmutable on public.profiles
  as restrictive for update to authenticated
  using (true)
  with check (
    rol = public.rol_actual_raw()
    and empresas_permitidas is not distinct from public.empresas_permitidas_raw()
  );

-- =====================================================================
-- 2 · Negar al chofer todo lo que no es su app
-- =====================================================================
-- Se listan explícitamente. Una tabla nueva que se cree más adelante NO
-- queda protegida automáticamente: hay que agregarla acá.

do $$
declare
  t text;
  tablas text[] := array[
    -- núcleo operativo
    'app_config', 'registros', 'clientes', 'proveedores', 'productos',
    'pedidos', 'compras', 'cobros', 'gastos', 'pagos_compra', 'envios',
    'cotizaciones', 'inventario_bodega', 'movimientos_inventario',
    'precios_proveedor', 'precios_venta',
    -- finanzas
    'operaciones_financieras', 'partidas_financieras', 'caja_financiera',
    'entidades_caja', 'historial_operaciones',
    -- VerdFrut
    'vf_clientes', 'vf_productos', 'vf_flujo_caja', 'vf_ventas_producto',
    'vf_cuentas_cobrar', 'vf_proveedores', 'vf_empleados',
    'vf_facturas_proveedor', 'vf_neto_tiendas', 'vf_neto_productos',
    'vf_neto_factores', 'vf_neto_ordenes', 'vf_neto_orden_items',
    'vf_neto_equivalencias', 'vf_precios_cliente', 'vf_precios_proveedor'
  ];
begin
  foreach t in array tablas loop
    -- Saltar las que no existan, para que la migración no dependa del orden
    -- exacto del esquema.
    if not exists (
      select 1 from pg_tables where schemaname = 'public' and tablename = t
    ) then
      raise notice 'omitida (no existe): %', t;
      continue;
    end if;

    -- Una política restrictiva sobre una tabla con RLS apagado no hace nada.
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relrowsecurity
    ) then
      raise warning 'RLS DESACTIVADO en %: queda expuesta, revisar aparte', t;
      continue;
    end if;

    -- `es_chofer()` va envuelto en (select ...) para que Postgres lo evalúe
    -- una vez por consulta (InitPlan) y no una vez por fila. Sin eso, un
    -- SELECT sobre vf_neto_orden_items (12 318 filas) llamaría a la función
    -- 12 318 veces.
    execute format('drop policy if exists sin_acceso_choferes on public.%I', t);
    execute format(
      'create policy sin_acceso_choferes on public.%I '
      'as restrictive for all to authenticated '
      'using (not (select public.es_chofer())) '
      'with check (not (select public.es_chofer()))',
      t
    );
  end loop;
end $$;

-- =====================================================================
-- 3 · Bodegas: el chofer las lee, no las toca
-- =====================================================================
-- La app necesita la lista para el campo "Base / Centro" del check list.
-- Hoy `bodegas` tiene USING(true) en las cuatro operaciones, o sea que un
-- chofer podría borrar almacenes. Se restringe sólo la escritura.

drop policy if exists bodegas_sin_escritura_choferes_ins on public.bodegas;
create policy bodegas_sin_escritura_choferes_ins on public.bodegas
  as restrictive for insert to authenticated
  with check (not (select public.es_chofer()));

drop policy if exists bodegas_sin_escritura_choferes_upd on public.bodegas;
create policy bodegas_sin_escritura_choferes_upd on public.bodegas
  as restrictive for update to authenticated
  using (not (select public.es_chofer()))
  with check (not (select public.es_chofer()));

drop policy if exists bodegas_sin_escritura_choferes_del on public.bodegas;
create policy bodegas_sin_escritura_choferes_del on public.bodegas
  as restrictive for delete to authenticated
  using (not (select public.es_chofer()));

commit;

-- =====================================================================
-- PENDIENTE APARTE — no se toca acá
-- =====================================================================
-- Estas tres tablas tienen RLS DESACTIVADO, o sea que quedan accesibles
-- incluso sin iniciar sesión, con sólo la anon key:
--
--   vf_flujo_caja_detalle     (0 filas)
--   vf_chat_conversaciones    (11 filas)
--   vf_chat_mensajes          (54 filas — conversaciones del bot de captura)
--
-- Activar RLS sin políticas las dejaría inaccesibles para todos y podría
-- romper lo que hoy las consulta, así que requiere revisar antes quién las
-- usa. Mientras sigan así, un chofer (y cualquiera con la anon key) las lee.

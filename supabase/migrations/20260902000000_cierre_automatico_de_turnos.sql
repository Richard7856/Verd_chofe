-- Cierre automático de los turnos que el chofer dejó abiertos.
--
-- Un turno abierto no es sólo un registro incompleto: mientras siga
-- `en_progreso` el chofer no puede abrir el del día siguiente, así que un
-- olvido de una noche arrastra el problema toda la semana.
--
-- A las 23:59 (hora de la Ciudad de México) se cierran los que sigan
-- abiertos. Se cierran SIN kilometraje final a propósito: inventar un número
-- sería peor que no tenerlo, y el hueco es justamente lo que hay que ver.

alter table public.checklists_unidad
  add column if not exists cierre_automatico     boolean not null default false,
  add column if not exists cerrado_automatico_el timestamptz;

comment on column public.checklists_unidad.cierre_automatico is
  'El chofer no lo cerró: lo cerró el sistema a las 23:59. Cuenta como falta.';

-- Parcial: los cierres automáticos son la excepción, no la norma.
create index if not exists checklists_unidad_cierre_automatico_idx
  on public.checklists_unidad (chofer_id, fecha desc)
  where cierre_automatico;

-- =====================================================================
-- La tarea
-- =====================================================================
-- `p_hasta` existe para poder correrla a mano sobre un día pasado y para
-- ponerse al día con turnos viejos que quedaron abiertos.
create or replace function public.cerrar_turnos_vencidos(p_hasta date default null)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_hasta   date;
  v_cerrados integer;
begin
  -- SECURITY DEFINER se salta RLS, así que la función comprueba por su
  -- cuenta: pg_cron corre sin JWT (auth.uid() es null) y desde el panel sólo
  -- puede llamarla un admin. Sin esto, cualquier chofer podría cerrar los
  -- turnos de toda la flota.
  if (select auth.uid()) is not null and not (select public.es_admin()) then
    raise exception 'Sólo un administrador puede cerrar turnos vencidos';
  end if;

  -- Por defecto, el día que está terminando en piso. La función corre a las
  -- 05:59 UTC, que son las 23:59 del día anterior en México: `now()` en esa
  -- zona da justamente ese día.
  v_hasta := coalesce(p_hasta, (now() at time zone 'America/Mexico_City')::date);

  with vencidos as (
    update public.checklists_unidad k
       set estado                = 'completado',
           cierre_automatico     = true,
           cerrado_automatico_el = now(),
           completado_el         = now(),
           -- La salida se sella a las 23:59 del día del turno, no a la hora
           -- en que corre la tarea: el turno terminó ese día, no después.
           salida_el = coalesce(
             k.salida_el,
             ((k.fecha + time '23:59') at time zone 'America/Mexico_City')
           )
     where k.estado = 'en_progreso'
       and k.fecha <= v_hasta
    returning k.id, k.chofer_id, k.empresa_id, k.fecha
  ),
  avisados as (
    insert into public.avisos_chofer
      (empresa_id, chofer_id, titulo, cuerpo, tipo, origen, clave)
    select v.empresa_id, v.chofer_id,
           'Tu turno se cerró solo: cuenta como falta',
           'No cerraste tu turno del ' || to_char(v.fecha, 'DD/MM/YYYY') ||
           ' antes de las 11:59 de la noche, así que el sistema lo cerró sin ' ||
           'kilometraje final ni firma. Queda registrado como falta y puede ' ||
           'aplicarse una penalización. Cerrá tu turno al terminar la ruta.',
           'urgente', 'automatico',
           'cierre_automatico:' || v.id::text
    from vencidos v
    on conflict (chofer_id, clave) do nothing
    returning 1
  )
  select count(*) into v_cerrados from vencidos;

  return v_cerrados;
end;
$$;

revoke all on function public.cerrar_turnos_vencidos(date) from public;
-- El panel la puede disparar a mano; RLS no aplica dentro de una SECURITY
-- DEFINER, así que la función comprueba por su cuenta quién llama.
grant execute on function public.cerrar_turnos_vencidos(date) to authenticated;

-- =====================================================================
-- Tarea programada
-- =====================================================================
-- Ciudad de México es UTC-6 todo el año, así que 05:59 UTC son las 23:59 del
-- día anterior en piso. Todos los días.
-- Para cambiar el horario:
--   select cron.unschedule('cierre-automatico-turnos');
--   select cron.schedule('cierre-automatico-turnos', '59 <hora-utc> * * *',
--                        $$ select public.cerrar_turnos_vencidos(); $$);
select cron.schedule(
  'cierre-automatico-turnos',
  '59 5 * * *',
  $$ select public.cerrar_turnos_vencidos(); $$
);

-- Avisos que el administrador manda al chofer, y recordatorios automáticos
-- para quien no abrió turno.
--
-- Se guarda una fila por destinatario en vez de una sola con destinatario
-- "todos": así cada chofer tiene su propio estado de leído, que es lo que
-- permite saber quién realmente lo vio.

create table public.avisos_chofer (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas (id),
  chofer_id   uuid not null references public.choferes (id) on delete cascade,

  titulo      text not null check (char_length(titulo) between 3 and 120),
  cuerpo      text not null check (char_length(cuerpo) between 1 and 2000),
  tipo        text not null default 'aviso' check (tipo in ('aviso', 'recordatorio', 'urgente')),
  origen      text not null default 'manual' check (origen in ('manual', 'automatico')),

  creado_por  uuid references auth.users (id),

  -- Evita que el recordatorio automático se duplique si la tarea corre más de
  -- una vez el mismo día. En los avisos manuales queda NULL, y Postgres
  -- permite múltiples NULL en un índice único, así que no los limita.
  clave       text,

  leido_el    timestamptz,
  created_at  timestamptz not null default now(),

  unique (chofer_id, clave)
);

create index avisos_chofer_pendientes_idx
  on public.avisos_chofer (chofer_id, created_at desc) where leido_el is null;
create index avisos_chofer_empresa_idx
  on public.avisos_chofer (empresa_id, created_at desc);

alter table public.avisos_chofer enable row level security;

-- El chofer ve los suyos, incluso desactivado: si le avisan que su acceso se
-- suspendió, tiene que poder leerlo.
create policy avisos_select on public.avisos_chofer
  for select to authenticated
  using (
    empresa_id in (select public.empresa_ids_actual())
    and (
      (select public.es_admin())
      or chofer_id in (select c.id from public.choferes c where c.user_id = (select auth.uid()))
    )
  );

create policy avisos_admin_insert on public.avisos_chofer
  for insert to authenticated
  with check (empresa_id in (select public.empresa_ids_actual()) and (select public.es_admin()));

create policy avisos_admin_delete on public.avisos_chofer
  for delete to authenticated
  using (empresa_id in (select public.empresa_ids_actual()) and (select public.es_admin()));

create policy avisos_update on public.avisos_chofer
  for update to authenticated
  using (
    empresa_id in (select public.empresa_ids_actual())
    and (
      (select public.es_admin())
      or chofer_id in (select c.id from public.choferes c where c.user_id = (select auth.uid()))
    )
  )
  with check (
    empresa_id in (select public.empresa_ids_actual())
    and (
      (select public.es_admin())
      or chofer_id in (select c.id from public.choferes c where c.user_id = (select auth.uid()))
    )
  );

-- =====================================================================
-- Recordatorio automático para quien no abrió turno
-- =====================================================================
create or replace function public.generar_recordatorios_sin_registro(p_fecha date default current_date)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_creados integer;
begin
  insert into public.avisos_chofer (empresa_id, chofer_id, titulo, cuerpo, tipo, origen, clave)
  select c.empresa_id, c.id,
         'No registraste tu entrada',
         'Todavía no abriste tu turno de hoy. Hacé el registro de entrada antes de salir a ruta.',
         'recordatorio', 'automatico',
         'sin_registro:' || p_fecha::text
  from public.choferes c
  where c.activo
    and not exists (
      select 1 from public.checklists_unidad k
      where k.chofer_id = c.id and k.fecha = p_fecha
    )
  on conflict (chofer_id, clave) do nothing;

  get diagnostics v_creados = row_count;
  return v_creados;
end;
$$;

revoke all on function public.generar_recordatorios_sin_registro(date) from public;
grant execute on function public.generar_recordatorios_sin_registro(date) to authenticated;

-- =====================================================================
-- Tarea programada
-- =====================================================================
create extension if not exists pg_cron with schema extensions;

-- Ciudad de México es UTC-6 todo el año (ya no aplica horario de verano), así
-- que 16:00 UTC son las 10:00 de la mañana en piso. De lunes a sábado.
-- Para cambiar el horario:
--   select cron.unschedule('recordatorio-sin-registro');
--   select cron.schedule('recordatorio-sin-registro', '0 <hora-utc> * * 1-6',
--                        $$ select public.generar_recordatorios_sin_registro(); $$);
select cron.schedule(
  'recordatorio-sin-registro',
  '0 16 * * 1-6',
  $$ select public.generar_recordatorios_sin_registro(); $$
);

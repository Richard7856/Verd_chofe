-- Vínculo manual entre un turno y su ruta en TripDrive.
--
-- El cruce automático por placa no sirve: los dos sistemas se dieron de alta
-- por separado y no comparten identificadores. TripDrive nombra las unidades
-- VFR-002, VFR-T01… y a los choferes "Chofer 1", "Chofer 2"; acá son placas
-- reales y nombres completos. Ninguna de las 31 rutas del primer rango cruzó.
-- Mientras no exista un identificador común, lo une una persona.
--
-- Tabla aparte y no columnas en `checklists_unidad` porque un chofer puede
-- hacer dos tiros en el día: el turno es uno y las rutas, varias.

create table public.turno_rutas_tripdrive (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas (id),
  checklist_id  uuid not null references public.checklists_unidad (id) on delete cascade,

  -- El id que usa TripDrive. Es texto: es su identificador, no uno nuestro.
  ruta_id       text not null,
  ruta_fecha    date not null,

  -- Copia de lo que decía la ruta al vincularla. La API puede re-optimizar
  -- (cambia `updated_at`) y puede no responder: esto deja el histórico en pie
  -- sin depender de ella. El número vigente sigue saliendo de la API.
  ruta_nombre   text,
  ruta_placa    text,
  ruta_chofer   text,
  km_planned    numeric(10,2),

  vinculado_por uuid references auth.users (id),
  created_at    timestamptz not null default now(),

  -- Una ruta pertenece a un solo turno: si no, se contaría dos veces.
  constraint turno_rutas_tripdrive_ruta_uniq unique (empresa_id, ruta_id)
);

create index turno_rutas_tripdrive_checklist_idx
  on public.turno_rutas_tripdrive (checklist_id);
create index turno_rutas_tripdrive_fecha_idx
  on public.turno_rutas_tripdrive (empresa_id, ruta_fecha desc);

alter table public.turno_rutas_tripdrive enable row level security;

-- Sólo el admin: es una tarea de escritorio, el chofer no vincula nada.
create policy turno_rutas_tripdrive_admin on public.turno_rutas_tripdrive
  for all to authenticated
  using (empresa_id in (select public.empresa_ids_actual()) and (select public.es_admin()))
  with check (empresa_id in (select public.empresa_ids_actual()) and (select public.es_admin()));

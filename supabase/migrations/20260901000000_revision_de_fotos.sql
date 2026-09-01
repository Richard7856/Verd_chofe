-- Revisión de la evidencia fotográfica: el admin aprueba o rechaza una foto,
-- y la rechazada vuelve a la app del chofer para tomarse de nuevo.
--
-- Una tabla aparte, y no columnas en cada origen, porque la foto vive en tres
-- lugares distintos (check list, ticket de combustible, ticket de gasto) y el
-- flujo de revisión es idéntico para los tres. La llave real es la RUTA del
-- objeto en el bucket: la re-subida escribe sobre la misma ruta, así que los
-- registros que la referencian no cambian.

create table public.revisiones_foto (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas (id),
  chofer_id     uuid not null references public.choferes (id) on delete cascade,

  origen        text not null check (origen in ('checklist', 'combustible', 'gasto')),
  referencia_id uuid not null,  -- checklist_id, id de la carga o del gasto
  etiqueta      text not null,  -- lo que ve el chofer: "Llantas", "Ticket de combustible"…
  ruta          text not null,

  estado        text not null default 'aprobada'
                check (estado in ('aprobada', 'rechazada', 'resubida')),
  motivo        text,
  revisada_por  uuid references auth.users (id),
  revisada_el   timestamptz not null default now(),
  resubida_el   timestamptz,

  created_at    timestamptz not null default now(),

  -- Un rechazo sin motivo no le dice al chofer qué corregir.
  constraint revisiones_foto_rechazo_explicado
    check (estado <> 'rechazada' or (motivo is not null and char_length(trim(motivo)) >= 3)),

  -- Una revisión por foto: aprobar o rechazar de nuevo reutiliza la fila.
  unique (ruta)
);

create index revisiones_foto_chofer_idx  on public.revisiones_foto (chofer_id, estado);
create index revisiones_foto_empresa_idx on public.revisiones_foto (empresa_id, estado);

alter table public.revisiones_foto enable row level security;

create policy revisiones_foto_select on public.revisiones_foto
  for select to authenticated
  using (
    empresa_id in (select public.empresa_ids_actual())
    and (
      (select public.es_admin())
      or chofer_id in (select public.chofer_ids_actual())
    )
  );

create policy revisiones_foto_admin on public.revisiones_foto
  for all to authenticated
  using (empresa_id in (select public.empresa_ids_actual()) and (select public.es_admin()))
  with check (empresa_id in (select public.empresa_ids_actual()) and (select public.es_admin()));

-- El chofer sólo puede pasar SU foto de 'rechazada' a 'resubida'; el resto de
-- las columnas y estados son del admin.
create policy revisiones_foto_resubir on public.revisiones_foto
  for update to authenticated
  using (
    chofer_id in (select public.chofer_ids_actual())
    and estado = 'rechazada'
  )
  with check (
    chofer_id in (select public.chofer_ids_actual())
    and estado = 'resubida'
  );

-- Rechazar elimina la foto del bucket (lo pidió el cliente: la evidencia mala
-- no debe quedarse). Hasta ahora ninguna política permitía DELETE en storage;
-- se abre sólo para admins y sólo dentro de las carpetas de sus empresas.
create policy checklist_evidencias_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'checklist-evidencias'
    and (select public.es_admin())
    and exists (
      select 1 from public.empresa_ids_actual() e
      where e::text = (storage.foldername(name))[1]
    )
  );
